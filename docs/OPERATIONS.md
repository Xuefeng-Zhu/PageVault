# Operations

> **Last updated:** 2026-06-02 · view this against commit `3b0f2ca` for accuracy.
> **Pair with:** [DEPLOYMENT.md](DEPLOYMENT.md).

## What to watch

PageVault has four classes of incident you should care about. The
expected detection method is in **bold** under each.

### 1. The cron worker is wedged

**Detect:** `processed: 0, succeeded: 0, failed: 0` for >10 minutes
on the notification worker, **OR** the InsForge Schedule UI shows
consecutive failures.

**Triage:**

```bash
# Hit the worker directly with the shared secret
curl -i -X POST https://<host>/api/cron/notification-worker \
  -H "x-cron-secret: $CRON_SHARED_SECRET"
```

If 200 + zeros, the worker is healthy and the outbox is genuinely
empty. If 401, the secret rotated on one side but not the other. If
500, read the body — the most common cause is the advisory lock
wrapper function not being installed (see
[DATA_MODEL.md §notification-advisory-lock](DATA_MODEL.md)).

If the worker returns 200 but `notification_outbox` has pending rows
that aren't being drained, check the advisory lock:

```sql
SELECT * FROM pg_locks WHERE locktype = 'advisory';
```

If a stale lock is held, the most likely cause is a previous worker
process that crashed without releasing. The lock id is `42`. To
release it manually (don't do this in production without checking
nothing else is using it):

```sql
SELECT pg_advisory_unlock(42);
```

### 2. The scan is failing on every URL

**Detect:** the dashboard's "Last scan" timestamp stops updating, or
the response from `POST /api/rooms/[id]/scan` is `failed` with no
snapshots captured.

**Triage:**

1. Check `snapshot_jobs` for the most recent run:
   ```sql
   SELECT id, status, error_code, error_message, finished_at
   FROM snapshot_jobs
   ORDER BY requested_at DESC LIMIT 5;
   ```
2. If `error_message` mentions `INSFORGE_API_URL is not set`, your
   env vars drifted — restart the app.
3. If `error_message` mentions `LLM API error`, see [DEVELOPMENT.md
   §Why is the LLM call failing?](DEVELOPMENT.md).
4. If `error_message` mentions a 4xx/5xx from `api.apify.com`, check
   the Apify token. Apify tokens rotate; if yours is old, generate
   a new one and update the env var.
5. If the error is per-URL, check the room's URLs — a 4xx from
   the **target** site (e.g. 403 because the site blocks bots)
   surfaces as a per-URL error and the scan continues for the
   other URLs (see `lib/scan.ts:scanOne` — the catch is per-URL).

### 3. Notification webhook receivers are returning 5xx

**Detect:** the outbox has rows stuck in `pending` for >1 hour with
`attempts > 0` and `last_error` like `502 Bad Gateway`.

**Triage:**

```sql
SELECT id, subscription_id, attempts, last_error, next_attempt_at
FROM notification_outbox
WHERE status = 'pending' AND next_attempt_at < now() - interval '1 hour'
ORDER BY next_attempt_at ASC LIMIT 20;
```

The `next_attempt_at` field is the worker's "skip until" — it does
**not** currently implement exponential backoff; it's just
`attempts + 1` minutes. If you see a 5xx, the row will be retried
~1 minute later.

After 10 consecutive failures, the subscription is auto-disabled.
The user can re-enable from the room detail page.

**Action:** contact the receiver's owner. PageVault has no
out-of-band notification (no Slack, no email) — operators only
notice this if they're checking the DB.

### 4. LLM costs spike

**Detect:** your OpenAI/OpenRouter dashboard shows anomalous
spend. PageVault does not have a cost-tracker; you'll see this from
the upstream provider.

**Common causes:**

- A new room with 100s of URLs that all change on first scan
  (each one triggers an LLM call).
- A noisy URL (e.g. a page with rotating ads in the body) is
  triggering a new snapshot on every scan. The hash-dedup won't
  help because the content genuinely changes.
- An Apify Actor is misconfigured to re-capture screenshots
  every run, increasing the markdown size and the LLM input
  tokens.

**Mitigation:**

- Pause the offending room (`PATCH /api/rooms/[id]/urls` with
  `active = false` for each URL, or disable the schedule).
- Drop the affected URLs from the room.
- Switch the LLM to a cheaper model (`OPENAI_MODEL=gpt-4o-mini`).

## Common queries

### "Show me all failed scans in the last 24h"

```sql
SELECT j.id, j.requested_at, j.finished_at, j.error_message,
       p.name AS room_name
FROM snapshot_jobs j
LEFT JOIN tracked_pages tp ON tp.id = j.tracked_page_id
LEFT JOIN projects p ON p.id = tp.project_id
WHERE j.status = 'failed'
  AND j.requested_at > now() - interval '24 hours'
ORDER BY j.requested_at DESC;
```

### "Show me the high-severity changes from yesterday"

```sql
SELECT ae.id, ae.created_at, ae.confidence,
       ae.output_json->>'severity' AS severity,
       ae.output_json->>'change_type' AS change_type,
       ae.output_json->>'summary' AS summary,
       p.name AS room_name,
       s.final_url
FROM ai_explanations ae
LEFT JOIN snapshots s ON s.id = ae.snapshot_id
LEFT JOIN tracked_pages tp ON tp.id = s.tracked_page_id
LEFT JOIN projects p ON p.id = tp.project_id
WHERE ae.output_json->>'severity' = 'high'
  AND ae.created_at > now() - interval '24 hours'
ORDER BY ae.created_at DESC;
```

### "Show me the notification outbox's current state"

```sql
SELECT status, COUNT(*),
       AVG(attempts)::numeric(5,2) AS avg_attempts,
       MAX(attempts) AS max_attempts
FROM notification_outbox
GROUP BY status
ORDER BY status;
```

### "Which subscriptions are in the failure-disable zone?"

```sql
SELECT id, project_id, consecutive_failures,
       last_failure_at, last_failure_error
FROM notification_subscriptions
WHERE consecutive_failures >= 8
  AND enabled = true
ORDER BY consecutive_failures DESC;
```

## Backups

- **Postgres (InsForge):** managed by InsForge. Contact their support
  for the snapshot/restore SLA on your plan.
- **InsForge Storage:** the `pagevault-evidence` bucket contains all
  raw markdown snapshots. InsForge's standard storage durability
  applies (>= 99.999999999% on the standard tier).
- **Application config:** env vars live in your deployment
  platform's secret store (Vercel env, GitHub Actions secrets, etc.)
  — back those up per your platform's procedure.

## Scaling notes

The current architecture is single-tenant and synchronous:

- A single scan is one HTTP request that blocks for 30-90s.
- A single cron worker drains up to 50 outbox rows per invocation
  (the `limit` parameter in `drainOutbox(limit = 50)`).

If you need to scale beyond that:

- **More rooms:** the cron worker already iterates all enabled
  schedules per minute. 100 rooms × 10 URLs each = 1000 LLM calls
  per minute, which will saturate the OpenAI rate limit on most
  plans. The natural fix is to batch by room and add a per-room
  rate limit. Not implemented today.
- **More outbound volume:** the worker limit is 50 rows per
  invocation. If your outbox has >50 pending rows, they'll drain
  in the next minute. If you sustain >50/min outbound, you'll
  need multiple workers — the advisory lock prevents overlap.
- **Horizontal app scaling:** the only shared state is the DB.
  Any number of app instances can run; the session is JWT, not
  server-side. Vercel's autoscaler handles this.

## On-call posture (recommended)

This project doesn't have a formal on-call rotation, but if you're
running it in production, the minimum sensible posture is:

1. **A daily check** that runs the smoke-test curl commands in
   [DEPLOYMENT.md](DEPLOYMENT.md).
2. **A weekly review** of the queries above — especially
   "outbox state" and "subscriptions near disable".
3. **A monthly cost review** of the upstream LLM provider.

The `lib/notifications.ts:drainOutbox` function emits no logs at
the success path — failures do, but not successes. If you want
metrics, the lowest-cost addition is a `console.log` per
processed/succeeded/failed summary at the end of each
invocation, and a daily aggregation in your log platform of
choice.
