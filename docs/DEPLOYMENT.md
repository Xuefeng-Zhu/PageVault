# Deployment

> **Last updated:** 2026-06-02 · view this against commit `3b0f2ca` for accuracy.
> **Pair with:** [ENVIRONMENT.md](ENVIRONMENT.md) for the env vars and
> [OPERATIONS.md](OPERATIONS.md) for the post-deploy monitoring posture.

## Deployment target: Vercel + InsForge

PageVault's intended production deployment is:

- **Next.js app** → Vercel (or any platform that runs Node + Next 14 App
  Router). Vercel is the path of least resistance.
- **Postgres + Auth + Storage** → InsForge (the project this repo
  talks to is at `wga6k9at.us-east.insforge.app`).
- **Scheduled scans + notification worker** → InsForge Schedules (cron).

Vercel + InsForge is the pairing the project was designed for. You can
run the app on any Node host (Render, Fly, Railway, ECS, k8s, a
VPS) — the only constraints are:

1. The host can run Next.js 14.
2. The host can make outbound HTTPS to `INSFORGE_API_URL`,
   `api.apify.com`, and the LLM base URL.
3. The host's clock is reasonably accurate (cron auth uses
   `x-cron-secret` — timestamps aren't checked, but `last_run_at`
   is set from the server clock, and that drifts your "next scan"
   expectation).

## Deploy to Vercel (recommended)

```bash
# 1. Install the Vercel CLI if you haven't
npm i -g vercel

# 2. From the repo root
cd /home/azureuser/workspace/PageVault
vercel link           # link to a Vercel project
vercel env add INSFORGE_API_URL production       # paste value
vercel env add INSFORGE_SERVICE_ROLE_KEY production
vercel env add INSFORGE_ANON_KEY production
vercel env add NEXT_PUBLIC_INSFORGE_URL production
vercel env add NEXT_PUBLIC_INSFORGE_ANON_KEY production
vercel env add NEXTAUTH_SECRET production
vercel env add NEXTAUTH_URL production           # https://your-domain.vercel.app
vercel env add OPENAI_API_KEY production
vercel env add APIFY_API_TOKEN production
vercel env add APIFY_ACTOR_ID production
vercel env add CRON_SHARED_SECRET production

# 3. Deploy
vercel --prod

# 4. Run migrations against the production InsForge project
#    (use the InsForge SQL editor — see README)
```

## Required env vars (production)

These MUST be set or the app refuses to start:

| Var | Reason |
|---|---|
| `NEXTAUTH_SECRET` | JWT signing — no safe default |
| `INSFORGE_API_URL` | DB backend — `lib/scan.ts` throws at import time |
| `INSFORGE_ANON_KEY` | SDK init |
| `INSFORGE_SERVICE_ROLE_KEY` | Used by the cron worker and the scan pipeline writes |
| `CRON_SHARED_SECRET` | All cron requests are 401 without it |

These are strongly recommended:

| Var | Reason |
|---|---|
| `NEXTAUTH_URL` | Without it, NextAuth derives the canonical URL from request headers, which can break behind reverse proxies |
| `OPENAI_API_KEY` or `OPENROUTER_API_KEY` | The LLM is the value-add; without it, scans run but don't produce change analyses |
| `APIFY_API_TOKEN` + `APIFY_ACTOR_ID` | Without Apify, the app falls back to direct `fetch()` + HTML→Markdown. Works fine for low-volume use. |

See [ENVIRONMENT.md](ENVIRONMENT.md) for the full table.

## Configuring InsForge Schedules (cron)

Two InsForge Schedules are required for the scheduled-scan and
notification flows. They fire every 1 minute against the deployed
app.

```bash
# 1. Log in to the InsForge CLI
npx @insforge/cli login --user-api-key uak_<your-user-api-key>

# 2. Create the scan-all schedule
npx @insforge/cli schedules create scan-all \
  --cron "*/1 * * * *" \
  --target "https://<your-host>/api/cron/scan-all" \
  --method POST \
  --headers '{"x-cron-secret": "<CRON_SHARED_SECRET>"}'

# 3. Create the notification-worker schedule
npx @insforge/cli schedules create notification-worker \
  --cron "*/1 * * * *" \
  --target "https://<your-host>/api/cron/notification-worker" \
  --method POST \
  --headers '{"x-cron-secret": "<CRON_SHARED_SECRET>"}'

# 4. Verify
npx @insforge/cli schedules list
```

**Cadence rationale:** 1 minute is the minimum InsForge supports and
is fine for a low-volume production. If you're firing >100 scans/min
you'll want to throttle or move the worker to a different cadence.

**Auth:** the schedule carries the shared secret in a header. The
endpoint at `/api/cron/scan-all` and `/api/cron/notification-worker`
verifies with constant-time comparison in
`lib/cron-auth.ts:requireCronSecret()`.

## Setting up a new room's schedule

After deploying, users create scan schedules from the room detail
page (the `<SchedulePicker>` component). Under the hood, the room
detail page calls `POST /api/rooms/[id]/schedule` which:

1. Validates the cron expression.
2. Inserts/updates the `scan_schedules` row.
3. Shells out to the InsForge CLI (`exec(...)`) to create or update
   the underlying InsForge Schedule.
4. Stores the `insforge_schedule_id` on the row for later updates.

> ⚠️ **The `exec()` call is the most fragile thing in the deploy
> story.** The route handler relies on the InsForge CLI being
> available on the host PATH. A future refactor should use a real
> SDK call instead.

## Setting up outbound webhooks

Users create outbound webhook subscriptions from the room detail page
(the `<NotificationList>` component). The subscription stores
`{ url, secret? }` in the `config` JSONB column.

When a scan detects a change:

1. `lib/scan.ts` inserts an `ai_explanations` row.
2. `lib/scan.ts` calls `enqueueNotification()`, which inserts
   `notification_outbox` rows for each enabled subscription.
3. Within the next minute, the InsForge `notification-worker` cron
   fires.
4. The worker acquires the advisory lock, picks up pending outbox
   rows, and POSTs the payload to the subscription URL.
5. On 2xx, the row is marked `delivered`. On 5xx, the row is
   marked `failed` and `attempts` is incremented. After 10
   consecutive failures the subscription is auto-disabled.

## Database migrations

The project does **not** have a migration runner. To apply a new
migration:

1. Use the InsForge SQL editor in the dashboard, or
2. Use the InsForge CLI:
   ```bash
   npx @insforge/cli db exec --file db/migrations/2026-06-02-*.sql
   ```

Migrations are forward-only. Order matters. Current order:

1. `db/migration.sql` (7 base tables + RLS)
2. `db/migrations/2026-06-02-scan-schedules.sql`
3. `db/migrations/2026-06-02-notification-tables.sql`
4. `db/migrations/2026-06-02-notification-advisory-lock.sql`

When you add a new migration, file it as
`db/migrations/YYYY-MM-DD-kebab-case.sql` and update
[DATA_MODEL.md §Migrations](DATA_MODEL.md).

## Smoke-testing the deploy

After every deploy, run through this checklist:

```bash
# 1. Home page is reachable
curl -i https://<your-host>/
# Expected: 200

# 2. Login page is reachable
curl -i https://<your-host>/login
# Expected: 200

# 3. Dashboard is gated
curl -i https://<your-host>/dashboard
# Expected: 307 → /login?callbackUrl=%2Fdashboard

# 4. API rooms requires auth
curl -i https://<your-host>/api/rooms
# Expected: 401

# 5. Cron worker accepts the secret
curl -i -X POST https://<your-host>/api/cron/notification-worker \
  -H "x-cron-secret: $CRON_SHARED_SECRET"
# Expected: 200 {"processed":0,"succeeded":0,"failed":0}

# 6. Cron worker rejects a missing/wrong secret
curl -i -X POST https://<your-host>/api/cron/notification-worker
# Expected: 401
```

For a deeper smoke test, sign in via the browser and:

1. Create a room
2. Add 1-2 URLs
3. Click "Run scan"
4. Wait ~30s
5. Verify a snapshot + change row exist (the dashboard
   "Morning brief" should show findings)

## Rollback procedure

PageVault has no formal rollback story. The recommended procedure:

1. **App rollback:** `vercel rollback` to the previous deployment.
2. **Cron disable:** `npx @insforge/cli schedules delete scan-all
   notification-worker` to stop the worker.
3. **DB rollback:** because migrations are forward-only, rolling back
   the DB requires writing a new migration that undoes the changes.
   Do not delete data without consulting the team.

For an emergency "stop everything" response, deleting both
schedules is the single highest-leverage action. The app will
continue to serve the dashboard and respond to manual scans; the
scheduled work and outbound notifications simply stop.

## CI / CD

There is no CI pipeline yet (the audit flagged this as HIGH). The
minimum viable CI for this project would run, on every PR:

1. `npm run typecheck` (fast, ~5s)
2. `npm run lint` (medium, ~15s)
3. `npm test` (currently exits 1 because no tests exist; add at
   least `lib/diff.test.ts` first)
4. `npm audit --audit-level=high` (catches the Next.js 14 < 14.2.32
   CVEs)

Recommended file: `.github/workflows/ci.yml`. Not in the repo today;
see the audit remediation list.
