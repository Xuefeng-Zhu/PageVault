# Notifications — Design

**Date:** 2026-06-02
**Status:** Approved (pending user review of this spec)
**Author:** Hermes (brainstorming session)
**Project:** PageVault

## Goal

Today, the only way to know about a detected change is to visit the dashboard. This feature adds **outbound notifications**: when a scan finds a material change, PageVault POSTs a JSON payload to a user-configured webhook URL. v1 supports webhooks only (generic — works with Slack, Discord, custom servers, anything). Email and Slack-specific channels are deferred.

## Decisions (from brainstorming)

| Question | Answer |
|---|---|
| Which channels? | **Generic webhook** (v1) — Slack/Email deferred |
| Severity threshold? | **Per-room threshold** with sensible default (`medium`) |
| Auto-disable on failure? | **Yes** — after 10 consecutive failures, disable the subscription |

## Architecture

```
┌──────────────────┐
│  lib/scan.ts      │  Scan completes, AI explanation ready
│  (existing)       │
└────────┬─────────┘
         │ ai_explanations row inserted
         ▼
┌──────────────────────────────────┐
│  lib/notifications.ts (new)      │
│  - Read change details            │
│  - Read room subscriptions        │
│  - For each, check threshold      │
│  - Call channel adapter            │
│  - Update success/failure counts  │
└────────┬─────────────────────────┘
         │
         ▼
┌──────────────────┐
│  WebhookChannel   │  POST to user URL with HMAC signature
└──────────────────┘
```

## Data model

```sql
-- A room can have multiple notification subscriptions
create table public.notification_subscriptions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  channel text not null default 'webhook' check (channel in ('webhook')),
  config jsonb not null,              -- { url, secret? }
  severity_threshold text not null default 'medium'
                                   check (severity_threshold in ('low','medium','high')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  last_triggered_at timestamptz,
  failure_count integer not null default 0
);

create index idx_notif_subscriptions_room on public.notification_subscriptions(project_id, enabled);
```

RATIONALE:
- 1:N relationship allows multiple webhooks per room (different teams, different channels)
- `channel` is constrained to `('webhook')` for now but the table shape supports adding `('email')`, `('slack')` later
- `config` is `jsonb` so each channel type can have its own fields (Slack: `{url, channel}`; Email: `{to, subject_template}`)
- `failure_count` and `last_triggered_at` live in the row for the auto-disable logic and UI

## API routes

### `GET /api/rooms/{roomId}/notifications`

List subscriptions for a room.

Response: `{ subscriptions: NotificationSubscription[] }`

### `POST /api/rooms/{roomId}/notifications`

Create a new subscription.

Request body:
```json
{
  "channel": "webhook",
  "config": { "url": "https://hooks.slack.com/...", "secret": "..." },
  "severityThreshold": "high"
}
```

Response: `{ subscription: NotificationSubscription }` (201)

Validation:
- `config.url` is a valid URL
- `config.url` starts with `https://` (no plain http)
- `severityThreshold` is one of `low|medium|high`

### `PATCH /api/rooms/{roomId}/notifications/{id}`

Update threshold, enabled, or config. Body: any subset of `{ config, severityThreshold, enabled }`.

### `DELETE /api/rooms/{roomId}/notifications/{id}`

Remove a subscription (204).

### `POST /api/rooms/{roomId}/notifications/{id}/test`

Sends a sample payload to the configured URL. Used by the UI's "Test" button. Returns the response status from the webhook endpoint (so the UI can show "Test passed" or "Test failed: 401").

Response: `{ status: number, body: string }`

## Notification payload

When a change is detected and the room has a matching subscription, the dispatcher POSTs:

```json
{
  "event": "change.detected",
  "room": {
    "id": "11111111-1111-1111-1111-111111111111",
    "name": "AWS Infrastructure Monitor",
    "storageFolderPath": "pagevault/aws-infrastructure-monitor/"
  },
  "change": {
    "id": "cc3ba321-1111-0000-0000-000000000001",
    "severity": "high",
    "changeType": "pricing",
    "summary": "AWS Lambda introduced a new 'Managed Instances' pricing model with complex multi-component charging",
    "businessInterpretation": "This represents a significant shift in Lambda pricing...",
    "recommendedActions": ["Update cost models", "Review ARM roadmap"],
    "evidence": [
      { "type": "text", "old": null, "new": "AWS Lambda Managed Instances pricing has three components..." }
    ],
    "confidence": 0.85,
    "url": "https://aws.amazon.com/lambda/pricing/",
    "capturedAt": "2026-06-02T07:39:09.196+00:00"
  },
  "deliveredAt": "2026-06-02T07:39:10.123+00:00"
}
```

**Headers:**
- `content-type: application/json`
- `user-agent: PageVault/1.0`
- `x-pagevault-event: change.detected`
- `x-pagevault-signature: sha256={hmac}` — only if subscription has a `secret`. HMAC is over the raw request body using `crypto.createHmac('sha256', secret)`.

**Receivers verify** by recomputing the HMAC over the raw body and comparing to the header (using `crypto.timingSafeEqual` to avoid timing attacks).

## Trigger logic

**Where:** Called from `lib/scan.ts` after the `ai_explanations` insert succeeds.

**Inside `dispatchNotifications(snapId, explId)`:**

```typescript
// lib/notifications.ts
export async function dispatchNotifications(snapId: string, explId: string): Promise<void> {
  // 1. Read the change + room
  const change = await getChangeWithRoom(explId);
  if (!change) return;
  const sev = severityToInt(change.severity);

  // 2. Read active subscriptions for the room
  const subs = await getActiveSubscriptions(change.roomId);

  // 3. For each, decide whether to fire
  for (const sub of subs) {
    if (sev < severityToInt(sub.severityThreshold)) continue;
    try {
      await getChannel(sub.channel).send(change, sub.config);
      await markTriggered(sub.id, true);
    } catch (err) {
      await markTriggered(sub.id, false, err);
    }
  }
}
```

**Auto-disable:** If `failure_count >= 10`, set `enabled = false` in the same update.

**Idempotency:** Each successful send updates `last_triggered_at`. The dispatcher doesn't dedupe across calls — if the same change fires notifications twice (e.g. retried scan), both will trigger. (Future v2: add `notified_at` per change to dedupe.)

**Concurrency:** The dispatcher runs after the DB insert commits, so a failure in notification dispatch doesn't roll back the change. Notifications are best-effort.

## Channel adapters

```typescript
// lib/notifications/channels/webhook.ts
import { createHmac } from 'node:crypto';

export class WebhookChannel {
  async send(payload: NotificationPayload, config: WebhookConfig): Promise<void> {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'user-agent': 'PageVault/1.0',
      'x-pagevault-event': payload.event,
    };
    if (config.secret) {
      const hmac = createHmac('sha256', config.secret).update(body).digest('hex');
      headers['x-pagevault-signature'] = `sha256=${hmac}`;
    }
    const res = await fetch(config.url, { method: 'POST', headers, body });
    if (!res.ok) {
      throw new Error(`Webhook returned ${res.status}: ${await res.text().catch(() => '')}`);
    }
  }
}
```

Future channels (v2+) would be `EmailChannel` (SMTP), `SlackChannel` (Slack-specific formatting), `DiscordChannel` (webhook with embeds).

## UI

In `/dashboard/rooms/{roomId}`:

```
┌────────────────────────────────────────────────────┐
│  AWS Infrastructure Monitor                          │
│  ...                                                │
│  Notifications                                      │
│  ┌──────────────────────────────────────────────┐  │
│  │  🔔 Webhook              [Edit] [×]          │  │
│  │  https://hooks.slack.com/...                 │  │
│  │  Threshold: High                            │  │
│  │  Last sent: 6/2/2026 07:39 AM                │  │
│  │  2 successes · 0 failures                   │  │
│  └──────────────────────────────────────────────┘  │
│  [ + Add notification ]                              │
│                                                     │
│  (when adding:)                                      │
│  ┌──────────────────────────────────────────────┐  │
│  │  Channel: Webhook ▼                          │  │
│  │  URL:    [https://hooks.slack.com/...]       │  │
│  │  Secret: [optional, for HMAC]               │  │
│  │  Threshold: [High ▼]                        │  │
│  │  [Cancel]              [Test]  [Save]      │  │
│  └──────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────┘
```

## Error handling

| Failure | Behavior |
|---|---|
| Webhook URL returns 4xx/5xx | Mark `failure_count++`, return error |
| Webhook times out (>10s) | Mark `failure_count++`, abort |
| Network error (DNS, connect) | Mark `failure_count++` |
| Webhook returns 2xx | Mark `last_triggered_at = now()`, reset `failure_count = 0` |
| 10 consecutive failures | Auto-set `enabled = false`, log warning, UI shows "auto-disabled" |
| Dispatcher itself throws | Log error, don't break the scan flow (best-effort) |

## Security

- All webhook URLs must be `https://` (no plain http)
- HMAC signature with subscriber-supplied secret
- No PII or credentials are sent in the payload
- Webhook secret is stored in the DB as-is (encrypted at rest by InsForge's default encryption)

## What I'm NOT doing in v1

- **Email / Slack-specific channels** — deferred (users configure generic webhooks for Slack incoming webhooks)
- **Notification batching** — deferred (each change fires immediately)
- **In-app notifications** — deferred (the dashboard already shows changes)
- **Quiet hours / do-not-disturb** — deferred
- **Per-change dedup** — deferred (currently same change firing twice triggers twice; should be a v2 concern with `notified_at` per change)
- **Per-URL subscriptions** — deferred (a room is the natural unit)
- **Rate limiting outbound** — deferred (InsForge already has request limits)

## Files to add/modify

- `db/migrations/2026-06-02-notification-subscriptions.sql` — new table
- `app/api/rooms/[roomId]/notifications/route.ts` — GET, POST
- `app/api/rooms/[roomId]/notifications/[id]/route.ts` — PATCH, DELETE
- `app/api/rooms/[roomId]/notifications/[id]/test/route.ts` — POST
- `lib/notifications.ts` — dispatcher + helpers
- `lib/notifications/channels/webhook.ts` — channel adapter
- `lib/scan.ts` — call `dispatchNotifications` after the ai_explanations insert
- `components/dashboard/NotificationList.tsx` — UI component
- `app/dashboard/rooms/[roomId]/page.tsx` — wire in the new section
- `lib/insforge.ts` — add CRUD for notification_subscriptions

## Estimated scope

- 1 SQL migration (~25 lines)
- 4 new API routes (~80 lines each)
- 1 new library module `lib/notifications.ts` (~120 lines)
- 1 channel adapter (~50 lines)
- 1 new UI component (~150 lines)
- Modifications to 2 existing files (~50 lines total)
- ~480 LOC of new code

## Acceptance criteria

1. A user can add a webhook URL to any room
2. After a high-severity change is detected, the webhook receives a POST within 5 seconds
3. The webhook payload includes room name, change details, and a signature header if secret is configured
4. The UI lists all configured notifications and shows last-sent time + failure count
5. A "Test" button fires a sample payload and shows the response status
6. After 10 consecutive failures, the subscription is auto-disabled and the UI shows it
7. Manual scan from the UI also triggers notifications
8. Scheduled scans (when that feature ships) also trigger notifications
9. The dispatcher failures don't break the scan flow (the change still gets saved)
10. `npx tsc --noEmit` passes
