# Notifications — Design

**Date:** 2026-06-02
**Status:** Approved (pending user review)
**Author:** Hermes (brainstorming + grill-me sessions)
**Project:** PageVault

## Goal

Today, the only way to know about a detected change is to visit the dashboard. This feature adds **outbound notifications**: when a scan finds a material change, PageVault POSTs a JSON payload to a user-configured webhook URL. v1 supports webhooks only. Email and Slack-specific channels are deferred.

## Decisions (from brainstorming + grill-me)

| Question | Answer |
|---|---|
| Which channels? | **Generic webhook** (v1) — Slack/Email deferred |
| Severity threshold? | **Per-room threshold** with sensible default (`medium`) |
| One event per change vs batched? | **One event per change** (most precise, matches user mental model) |
| Sync vs async delivery? | **Async via durable queue** (Postgres outbox + InsForge cron worker) |
| Auto-disable on failure? | **Yes** — 10 consecutive failures, 24h TTL |
| Failure tracking? | **Both** subscription-level (drives disable) + outbox-row-level (diagnostic) |
| Failure isolation? | **Per-row + per-run isolation** (per-worker-run failure doesn't penalize subscriptions) |

## Architecture

```
┌──────────────────┐
│  lib/scan.ts      │  Scan completes, AI explanation ready
│  (existing)       │
└────────┬─────────┘
         │ ai_explanations row inserted
         ▼
┌──────────────────────────────────┐
│  enqueueNotification              │  Insert into notification_outbox with status='pending'
│  (in lib/notifications.ts)       │
└────────┬─────────────────────────┘
         │
         ▼  (≤ 60s later)
┌──────────────────────────────────────────────────────────────┐
│  InsForge cron (every 1 min)                                    │
│  POST /api/cron/notification-worker                             │
│  Header: x-cron-secret: $CRON_SHARED_SECRET                    │
└────────┬─────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────┐
│  worker drains the outbox         │  SELECT ... WHERE status='pending' LIMIT 50 FOR UPDATE SKIP LOCKED
│  POST /api/cron/notification-worker │  For each, call the channel adapter
│  in lib/notifications/worker.ts   │  Update outbox row + subscription
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
  consecutive_failures integer not null default 0,
  failure_window_start timestamptz,  -- set on first failure in a streak
  last_triggered_at timestamptz,
  last_failure_at timestamptz,
  last_failure_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_notif_subscriptions_room on public.notification_subscriptions(project_id, enabled);

-- Outbox: one row per change × subscription that needs to fire
create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.notification_subscriptions(id) on delete cascade,
  ai_explanation_id uuid not null references public.ai_explanations(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','delivered','failed')),
  attempts integer not null default 0,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

create index idx_outbox_pending on public.notification_outbox(status, next_attempt_at)
  where status = 'pending';
```

RATIONALE:
- Two-table design: `notification_subscriptions` (config) + `notification_outbox` (queue). They serve different purposes.
- `outbox` uses `next_attempt_at` for backoff (deferred: v1 just retries every minute)
- Partial index `idx_outbox_pending` because most queries are "give me pending rows ordered by next_attempt_at"
- `consecutive_failures` + `failure_window_start`: window resets to null when count goes back to 0

## Auto-disable logic (per subscription)

```typescript
// In worker, after each delivery attempt
async function recordDeliveryAttempt(subId: string, success: boolean, err?: string) {
  const sub = await getSubscription(subId);
  if (success) {
    await dbUpdate('notification_subscriptions', subId, {
      consecutive_failures: 0,
      failure_window_start: null,
      last_triggered_at: new Date().toISOString(),
      last_failure_at: null,
      last_failure_error: null,
    });
  } else {
    const newCount = sub.consecutive_failures + 1;
    const updates: any = {
      consecutive_failures: newCount,
      last_failure_at: new Date().toISOString(),
      last_failure_error: err?.slice(0, 500),
    };
    if (sub.failure_window_start == null) {
      updates.failure_window_start = new Date().toISOString();
    }
    // Auto-disable at 10 consecutive failures within a 24h window
    if (newCount >= 10) {
      updates.enabled = false;
    }
    await dbUpdate('notification_subscriptions', subId, updates);
  }
}
```

**Why 24h TTL:** an old failure (yesterday's outage) shouldn't count toward today's disable. The `failure_window_start` field records when the current streak began; if the gap between failures exceeds 24h, the window resets (handled by a daily cleanup cron or by checking `now() - failure_window_start > 24h` before incrementing).

## API routes

### `GET /api/rooms/{roomId}/notifications`

List subscriptions for a room. (Auth: session)

### `POST /api/rooms/{roomId}/notifications`

Create a new subscription. Body:
```json
{
  "channel": "webhook",
  "config": { "url": "https://hooks.slack.com/...", "secret": "..." },
  "severityThreshold": "high"
}
```
Returns 201 with `{ subscription }`. Validates `config.url` is https.

### `PATCH /api/rooms/{roomId}/notifications/{id}`

Update threshold, enabled, or config.

### `DELETE /api/rooms/{roomId}/notifications/{id}`

Remove a subscription.

### `POST /api/rooms/{roomId}/notifications/{id}/test`

Sends a sample payload. Returns the receiver's response status.

### `POST /api/cron/notification-worker` (NEW)

The worker endpoint. **Auth: `x-cron-secret` header matches `process.env.CRON_SHARED_SECRET`.** If env not set, endpoint rejects all requests.

Behavior:
1. Acquire advisory lock `pg_try_advisory_lock(42)` to prevent concurrent workers
2. `SELECT ... FROM notification_outbox WHERE status='pending' AND next_attempt_at <= now() ORDER BY next_attempt_at LIMIT 50 FOR UPDATE SKIP LOCKED`
3. For each row: load subscription, call channel, update outbox + subscription
4. Return `{ processed: N, succeeded: X, failed: Y }`

**Auth note:** the secret is set in `.env.local` as `CRON_SHARED_SECRET`. The InsForge schedule is created with `--headers '{"x-cron-secret": "<value>"}'`. The worker checks the header against the env var.

## Notification payload

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
    "summary": "AWS Lambda introduced a new 'Managed Instances' pricing model...",
    "businessInterpretation": "...",
    "recommendedActions": ["...", "..."],
    "evidence": [{"type":"text","old":null,"new":"..."}],
    "confidence": 0.85,
    "url": "https://aws.amazon.com/lambda/pricing/",
    "capturedAt": "2026-06-02T07:39:09.196+00:00"
  },
  "deliveredAt": "2026-06-02T07:39:10.123+00:00"
}
```

Headers:
- `content-type: application/json`
- `user-agent: PageVault/1.0`
- `x-pagevault-event: change.detected`
- `x-pagevault-signature: sha256={hmac}` — only if subscription has a `secret`. HMAC over the raw body using `crypto.createHmac('sha256', secret)`.

## Failure model (defended)

- **Per-row failure** (e.g. webhook 4xx): increment `consecutive_failures`, set `last_failure_at`, mark outbox row `failed`. Continue with next row.
- **Per-subscription auto-disable:** when `consecutive_failures >= 10`, set `enabled = false`. Log warning. UI shows "auto-disabled" badge.
- **Per-worker-run failure** (e.g. Postgres down): log error, return 500. Do NOT increment any subscription's `consecutive_failures` — they didn't do anything wrong. The next cron tick will retry.
- **Advisory lock:** `pg_try_advisory_lock(42)` at the start of the worker. If another worker is already running, the second one returns 200 immediately and does nothing. Prevents double-dispatch.

## Channel adapter

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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(config.url, {
        method: 'POST', headers, body,
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Webhook returned ${res.status}: ${await res.text().catch(() => '')}`);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
```

**Timeout:** 10s per webhook call (via AbortController). Prevents one slow endpoint from blocking the worker.

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
└────────────────────────────────────────────────────┘
```

When the subscription is auto-disabled, the UI shows an amber "Auto-disabled (10 consecutive failures)" badge with a "Re-enable" button.

## What I'm NOT doing in v1

- **Email / Slack-specific channels** — deferred
- **Notification batching** (multiple changes per scan) — deferred
- **Per-change dedup** — deferred (currently same change firing twice triggers twice)
- **Backoff between retries** (currently just retries every minute) — deferred
- **Quiet hours / do-not-disturb** — deferred
- **In-app notifications** — deferred (dashboard already shows changes)
- **Per-URL subscriptions** — deferred
- **Outbox retry with backoff** — deferred (just retries every cron tick)

## Files to add/modify

- `db/migrations/2026-06-02-notification-tables.sql` — both new tables
- `app/api/rooms/[roomId]/notifications/route.ts` — GET, POST
- `app/api/rooms/[roomId]/notifications/[id]/route.ts` — PATCH, DELETE
- `app/api/rooms/[roomId]/notifications/[id]/test/route.ts` — POST (test)
- `app/api/cron/notification-worker/route.ts` — POST (worker)
- `lib/cron-auth.ts` — shared `requireCronSecret(req)` helper (used by both this worker and the scan-all worker)
- `lib/notifications.ts` — enqueue + dispatcher
- `lib/notifications/channels/webhook.ts` — channel adapter
- `lib/scan.ts` — call `enqueueNotification` after the ai_explanations insert (~5 LOC)
- `components/dashboard/NotificationList.tsx` — UI component
- `app/dashboard/rooms/[roomId]/page.tsx` — wire in the new section
- `lib/insforge.ts` — add CRUD for both tables

## Estimated scope

- 1 SQL migration (~50 lines)
- 5 new API routes (~80 lines each)
- 1 new lib module `lib/cron-auth.ts` (~30 lines, shared with scheduled scans)
- 1 new lib module `lib/notifications.ts` (~150 lines)
- 1 channel adapter (~50 lines)
- 1 new UI component (~150 lines)
- Modifications to 2 existing files (~50 lines total)
- ~580 LOC of new code

## Acceptance criteria

1. A user can add a webhook URL to any room
2. After a high-severity change is detected, the webhook receives a POST within 60 seconds (outbox + worker)
3. The webhook payload includes room name, change details, and a signature header if secret is configured
4. The UI lists all configured notifications and shows last-sent time + failure count + auto-disabled state
5. A "Test" button fires a sample payload and shows the response status
6. After 10 consecutive failures (within 24h window), the subscription is auto-disabled and the UI shows it
7. Manual scan from the UI also triggers notifications
8. Scheduled scans (when that feature ships) also trigger notifications
9. The dispatcher failures don't break the scan flow (the change still gets saved)
10. `npx tsc --noEmit` passes
11. `/api/cron/notification-worker` rejects requests without a valid `x-cron-secret`
12. If the worker fails to acquire the advisory lock, it returns 200 immediately and does nothing
