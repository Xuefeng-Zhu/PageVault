# Notifications

When a scheduled scan finds a material change, PageVault can fire an outbound webhook to a URL you provide. This is the integration point for Slack, Discord, PagerDuty, custom servers, or anything that accepts HTTP POSTs.

## Architecture

There are two tables and one background worker:

- **`notification_subscriptions`** (per-room) — one row per webhook you configure. Holds the URL, optional HMAC secret, severity threshold, and runtime state (failure count, last-triggered timestamp).
- **`notification_outbox`** (queue) — one row per change that needs to fire. Inserted by the scan worker after every `ai_explanations` row. Has a status (`pending` → `delivered` | `failed`).
- **`/api/cron/notification-worker`** — InsForge cron fires this every 30 seconds. It drains the outbox.

The cron worker uses a Postgres advisory lock (`pg_try_advisory_lock(42)`) to prevent two workers from draining the same row. In practice the lock is held for sub-second; if the connection is reclaimed mid-run, the lock evaporates and a second worker could enter — same risk as today, no worse.

## Webhook payload

For each detected change, PageVault POSTs JSON to the configured URL:

```json
{
  "event": "change.detected",
  "room": {
    "id": "11111111-1111-1111-1111-111111111111",
    "name": "AWS Infrastructure Monitor",
    "storageFolderPath": "pagevault/aws-infrastructure-monitor"
  },
  "change": {
    "id": "cc3ba321-1111-0000-0000-000000000001",
    "severity": "high",
    "changeType": "pricing",
    "summary": "AWS Lambda introduced a new 'Managed Instances' pricing model",
    "businessInterpretation": "This represents a significant shift in Lambda pricing...",
    "recommendedActions": ["Update cost models", "Review ARM roadmap"],
    "evidence": [
      { "type": "text", "old": "...", "new": "..." }
    ],
    "confidence": 0.85,
    "url": "https://aws.amazon.com/lambda/pricing/",
    "capturedAt": "2026-06-02T07:39:09.196+00:00"
  },
  "deliveredAt": "2026-06-02T07:39:10.123+00:00"
}
```

The `room.name` is the human-readable name from `projects.name`, not the UUID. `storageFolderPath` is the InsForge Storage folder where the evidence chain lives (raw markdown snapshots, screenshots). Use this to fetch the evidence via the `/api/storage/folder/{path}` route.

## Headers

Every request includes:

| Header | Value | Notes |
|---|---|---|
| `content-type` | `application/json` | Always |
| `user-agent` | `PageVault/1.0` | Distinguish from browser traffic if you log at the receiver |
| `x-pagevault-event` | `change.detected` | Reserved for future event types (`scan.failed`, `room.created`, etc.) |
| `x-pagevault-signature` | `sha256={hmac_hex}` | **Only if you set a secret on the subscription.** HMAC-SHA256 of the raw request body using the secret as the key. |

### Verifying the signature

```python
import hmac, hashlib
expected = hmac.new(secret.encode(), request.body, hashlib.sha256).hexdigest()
got = request.headers['X-Pagevault-Signature'].removeprefix('sha256=')
hmac.compare_digest(expected, got)
```

**Always use `hmac.compare_digest` (Python) / `crypto.timingSafeEqual` (Node), not `==`**, to prevent timing attacks. The `x-pagevault-signature` header is constructed using a constant-time comparison in our outbound code, so the receiver should match.

## Thresholds

Per-subscription, you pick a minimum severity: `low`, `medium`, or `high`. The webhook only fires if the change's severity is **greater than or equal to** the threshold. The default is `medium`.

| Subscription threshold | Fires on changes with severity |
|---|---|
| `low` | low, medium, high |
| `medium` | medium, high |
| `high` | high only |

If you want every change, set threshold to `low`. If you only want to be paged for serious changes, set it to `high`. The threshold is checked **at delivery time** — you can change it without losing pending notifications, but the next pending row will use the new threshold.

## Reliability

### Auto-disable

If a webhook fails 10 consecutive times within a 24-hour window, the subscription is auto-disabled (set to `enabled = false`). The 24h window is reset whenever there's a 24h+ gap between failures — so a flaky receiver that fails once a week doesn't accumulate toward disable. The "consecutive failures" counter resets to 0 on any successful delivery.

When a subscription is auto-disabled:
- The UI shows an amber "Auto-disabled" badge
- New outbox rows are still enqueued for that subscription but immediately marked `failed` with `last_error: "subscription_disabled_or_missing"`
- The per-room Notifications list still shows the subscription (with the auto-disabled badge) so you can re-enable it

To re-enable: click the "Test" button — if the receiver responds 2xx, the next delivery attempt will mark the subscription as healthy again (the `consecutive_failures` counter resets to 0 on the first success).

### Per-row + per-worker isolation

Failure handling has two layers:

- **Per-row failure** (e.g. webhook returns 4xx, or the receiver is down): the row is marked `failed` with the error message, the subscription's `consecutive_failures` is incremented, and the worker continues with the next row.
- **Per-worker-run failure** (e.g. Postgres query throws because the database is down): the worker returns 500 but **does not** increment any subscription's failure counter. The next cron tick (within 30 seconds) will retry.

This means a single Postgres hiccup doesn't penalize innocent subscribers.

### Webhook timeouts

Each webhook call has a **10-second timeout** via `AbortController`. A slow receiver doesn't block the worker; the row is marked `failed` with a "fetch aborted" or similar error.

### Delivery latency

From change detection to webhook delivery, the latency is up to **60 seconds** (the cron worker fires every 30 seconds; the worker also waits on the advisory lock for at most 30 seconds). The actual observed latency is typically 5-15 seconds.

If you need sub-second delivery, the dispatcher is intentionally not designed for that — PageVault is a memory layer, not a real-time event bus. If sub-second is required, the recommendation is to also subscribe to the underlying Apify actor's webhook (if using Apify for crawling) and let that drive real-time events, with PageVault as the slower but more thorough aggregator.

## Setting up notifications

### From the UI

1. Open a room at `/dashboard/rooms/{roomId}`
2. Scroll to the **Notifications** section at the bottom
3. Click **+ Add notification**
4. Fill in:
   - **Webhook URL**: your receiver (e.g. `https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXX`, `https://webhook.site/<uuid>`, or your custom endpoint)
   - **HMAC secret** (optional): a random string. If set, every delivery includes the `x-pagevault-signature` header. Pick something long (32+ chars) — the receiver stores this in their env or secret manager and uses it to verify each request.
   - **Severity threshold**: `Low` / `Medium` / `High` (default Medium)
5. Click **Save**
6. (Optional) Click the **Test** button next to the subscription to send a sample payload and verify the endpoint works

### From the API

```bash
curl -X POST https://pagevault.example.com/api/rooms/{roomId}/notifications \
  -H "Content-Type: application/json" \
  -b "<session cookie>" \
  -d '{
    "channel": "webhook",
    "config": {
      "url": "https://hooks.slack.com/services/.../...",
      "secret": "your-32-char-hmac-secret"
    },
    "severityThreshold": "medium"
  }'
```

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/rooms/{id}/notifications` | Session + owner | List subscriptions for the room |
| `POST` | `/api/rooms/{id}/notifications` | Session + owner | Create a new subscription. Validates `https://` URL and severity threshold. Returns 201 with the new row. |
| `PATCH` | `/api/rooms/{id}/notifications/{subId}` | Session + owner of the room containing the subscription | Update threshold, config, or enabled. |
| `DELETE` | `/api/rooms/{id}/notifications/{subId}` | Session + owner | Remove the subscription. |
| `POST` | `/api/rooms/{id}/notifications/{subId}/test` | Session + owner | Send a sample payload. Returns `{ ok: true }` if the receiver responded 2xx, or `{ ok: false, error: ... }` with 502 if it failed. |

All endpoints enforce ownership via the same `authorizeSubscription(roomId, subId, userId)` pattern: 404 if the room doesn't exist or isn't owned, then 404 if the subscription doesn't belong to the room, then the operation. (No room-existence leak.)

## End-to-end flow

When the LLM detects a material change during a scan:

1. **Scan** (`lib/scan.ts`) inserts an `ai_explanations` row.
2. **Enqueue** (`lib/notifications.ts:enqueueNotification`) finds all enabled subscriptions for the room and inserts one `notification_outbox` row per subscription. Best-effort: scan never fails on a notification error.
3. **Wait** (≤ 60s). InsForge cron fires `/api/cron/notification-worker` every 30 seconds.
4. **Drain** (`drainOutbox`): acquires advisory lock, reads up to 50 pending rows, processes each in a try/catch.
5. **Build payload** (`buildPayload`): loads the `ai_explanations` row, the `snapshots` row, the `projects` row (for `room.name`), constructs the `NotificationPayload`.
6. **Threshold check**: if change severity < subscription threshold, marks outbox row `delivered` (we did consider it, no need to fire) and moves on. (We don't enqueue another row for the same change when re-fired.)
7. **Send** (`WebhookChannel.send`): `fetch()` the URL with the 10s timeout. Adds `x-pagevault-signature` if a secret is configured.
8. **Update** the outbox row to `delivered` (with `delivered_at` timestamp) and the subscription's `last_triggered_at` + reset `consecutive_failures`.
9. **Or** if the fetch failed, mark the outbox `failed` with the error message, increment the subscription's `consecutive_failures` and possibly set `failure_window_start`. Disable the subscription at 10 consecutive failures within the window.

## Slack example

1. Create a Slack incoming webhook: https://api.slack.com/messaging/webhooks
2. In PageVault, add a notification with that URL and an optional secret
3. Slack will receive the raw JSON. To format it nicely, use a Slack Workflow that:
   - Parses the `change.summary` field for the message title
   - Uses `change.severity` to set the Slack message color (red for high, yellow for medium, gray for low)
   - Links `change.url` to the original page
4. (Optional) Set the HMAC secret in PageVault and in the Slack workflow's "Verify signature" step

## Verifying the worker is alive

The cron worker fires every 30 seconds. To check it's healthy:

```bash
npx @insforge/cli schedules list | grep pagevault-notification-worker
# Should show: Active=Yes, Next Run=~30s from now

# Trigger a manual delivery (after creating a subscription + outbox row)
curl -X POST http://localhost:3000/api/cron/notification-worker \
  -H "x-cron-secret: $(grep ^CRON_SHARED_SECRET .env.local | cut -d= -f2)"
# Returns: {"processed":N,"succeeded":N,"failed":0}
```

If the cron schedule is missing or inactive, register it:
```bash
npx @insforge/cli schedules create \
  --name "pagevault-notification-worker" \
  --cron "30 seconds" \
  --url "http://localhost:3000/api/cron/notification-worker" \
  --method POST \
  --headers '{"x-cron-secret":"<CRON_SHARED_SECRET>"}'
```

## What's NOT in scope for v1

- **Email channel** — deferred. Generic webhooks work for any system that accepts HTTP POSTs (Slack, Discord, email-to-webhook bridges, custom).
- **Slack-specific formatting** — the integration is via the generic Slack incoming webhook; Slack's UI parses the JSON. For formatted blocks, use a Slack Workflow.
- **Per-change dedup** — currently, the same change re-enqueued after a manual re-scan fires again. We don't have a "delivered for this ai_explanation_id" dedup.
- **Outbox retry with backoff** — every minute, every retry. If you want exponential backoff on persistent failures, that's v2.
- **Quiet hours / do-not-disturb** — not yet. You can manually disable a subscription via the UI when you don't want to be paged.
- **In-app notification inbox** — the dashboard already shows changes inline; the notification system is for outbound delivery only.

## Implementation details for the curious

- The advisory lock uses a Postgres function in the `public` schema: `acquire_notification_lock(arg integer)` and `release_notification_lock(arg integer)`. The `pg_catalog` originals (`pg_try_advisory_lock`, `pg_advisory_unlock`) can't be called via PostgREST's `/api/database/rpc/` endpoint because PostgREST only exposes functions in the configured `db-schemas` (here, `public`). The wrappers are `security definer` so they can reach the `pg_catalog` functions regardless of the caller's role.
- The single-statement CLI limitation means the migration was historically applied as 4 separate `npx @insforge/cli db query` calls: one per `create or replace function`, one per `revoke all`, one per `grant execute`. See the historical `db/legacy/2026-06-02-notification-advisory-lock.sql` for the original SQL; the canonical, consolidated version is in `db/schema.sql` (the `claim_notification_advisory_lock` function block), and the modern apply path is a single `npx @insforge/cli db import db/schema.sql` (or a series of `db query` calls if your CLI build doesn't expose `db import`).
- The dispatcher supports **one channel type** today: `webhook`. The schema has `channel text check (channel in ('webhook'))`. To add email, slack-direct, or discord in v2, extend the check constraint and add a channel adapter in `lib/notifications/channels/`.
- The outbox has an index on `(status, next_attempt_at) where status = 'pending'` for fast drains. Without this, the worker would full-scan the table on every tick.
