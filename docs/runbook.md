# Runbook

> **Last updated:** 2026-06-05 · view this against the current `main` for accuracy.
> **Pair with:** [DEPLOYMENT.md](DEPLOYMENT.md) for the topology and the
> deploy steps; [OPERATIONS.md](OPERATIONS.md) for ongoing monitoring; and
> [SECURITY.md](../SECURITY.md) for the threat model and secret handling.

This is the "what do I do when X breaks" doc. It's intentionally short on
philosophy and long on commands you can copy-paste. If something here is
wrong or missing, fix it in the same PR that broke it.

## 1. PageVault deployment topology

PageVault is four planes held together by env vars and a shared secret. The
Next.js app runs on Vercel, all persistent state lives in InsForge, the
crawl is delegated to Apify's cloud, and any uploaded snapshot/HTML is
written to an InsForge Storage bucket. There is no long-running worker
process inside the app itself — scheduled work and the notification drain
fire from InsForge Schedules (cron) into the deployed app's HTTP routes.

```
                          ┌──────────────────────────────┐
                          │           Browser            │
                          │      (Next.js client)        │
                          └──────────────┬───────────────┘
                                         │ HTTPS
                                         ▼
   ┌──────────────────────────────────────────────────────────────┐
   │                       Vercel (prod)                          │
   │  ┌───────────────────────────────────────────────────────┐  │
   │  │     Next.js 14 App Router  (app/)                     │  │
   │  │  ├── app/rooms/*        — UI                           │  │
   │  │  ├── app/api/*          — API routes                   │  │
   │  │  ├── app/api/cron/*     — cron entry points            │  │
   │  │  └── lib/{insforge,apify,box,ai,scan,notifications}   │  │
   │  └───────────────────────────────────────────────────────┘  │
   └────────┬───────────────┬───────────────┬─────────────┬──────┘
            │               │               │             │
            │ SQL/PostgREST │  HTTPS        │ HTTPS       │ HTTPS
            ▼               ▼               ▼             ▼
   ┌────────────────┐  ┌────────────┐  ┌─────────────┐  ┌──────────────────────┐
   │   InsForge     │  │   Apify    │  │  InsForge   │  │ InsForge Storage     │
   │   Postgres     │  │   cloud    │  │  Schedules  │  │ bucket:              │
   │   (managed)    │  │ (crawler)  │  │  (cron 1m)  │  │  pagevault-evidence  │
   │                │  │            │  │             │  │                      │
   │ 7 base tables  │  │ Actor:     │  │ scan-all    │  │ append-only;         │
   │ + RLS, advisory│  │ website-   │  │ scan-room/* │  │ raw HTML / markdown  │
   │   locks        │  │ content-   │  │ notification│  │ snapshots +          │
   │                │  │ crawler    │  │ -worker     │  │ diff evidence        │
   └────────────────┘  └────────────┘  └─────────────┘  └──────────────────────┘
                                                         ▲
                                                         │  uploads on
                                                         │  every scan
                                                         │
   (Vercel writes here via the scan pipeline) ───────────┘
```

Two things to notice in the picture:

- The Postgres box is the only one with persistent application state. The
  Next.js app is stateless (sessions are JWT). You can replace Vercel with
  any Node host that can reach the three HTTPS endpoints, and the system
  still works.
- The "InsForge Schedules" box is the heartbeat. If it stops firing, the
  app still serves the dashboard and you can still trigger manual scans —
  you just stop getting scheduled work and outbound webhook deliveries.

## 2. Deploy procedure

The K-17 deployment-pipeline card will own the automated version. This is
the manual fallback. Use it for the first deploy to a new environment, or
when the CI pipeline is broken and you need to push a hotfix.

```bash
# 1. Make sure you're on the commit you want to ship
cd /home/azureuser/workspace/PageVault
git log --oneline -1                # confirm the SHA
git diff main --stat                # see what changed

# 2. Typecheck, lint, and unit tests pass locally
npm run typecheck
npm run lint
npm test -- --run

# 3. Apply any new DB migrations against the production InsForge project
#    (the project this repo talks to is wga6k9at, but use your own in real life)
ls db/migrations/                   # see what hasn't been applied
# Apply via the InsForge SQL editor in the dashboard, OR:
npx @insforge/cli db exec --file db/migrations/<new-file>.sql

# 4. Push to Vercel
vercel link                         # one-time per machine
vercel --prod

# 5. Verify env vars on the production deployment
vercel env ls production | grep -E '^(INSFORGE|NEXTAUTH|CRON|APIFY|OPENAI)'
# Anything missing? Set it before smoke-testing.

# 6. Smoke-test (see DEPLOYMENT.md §Smoke-testing the deploy)
curl -i https://<your-host>/
curl -i -X POST https://<your-host>/api/cron/notification-worker \
  -H "x-cron-secret: $CRON_SHARED_SECRET"
```

**Two things that bite people on first deploy:**

- `NEXTAUTH_URL` and `NEXTAUTH_SECRET` must both be set in production. If
  `NEXTAUTH_URL` is wrong, NextAuth silently fails every login redirect
  and you get a stream of `/api/auth/error` hits with no obvious cause.
  See the [NEXTAUTH_URL / NEXTAUTH_SECRET](#5-on-call-rotation) section
  in the env-debug skill for the exact failure mode.
- `INSFORGE_DEV_INSECURE_SECRET=1` is a footgun. Never set it in prod.
  It auto-generates a per-process JWT secret, which means every Vercel
  cold start invalidates all user sessions. It's an opt-in to a debug
  behaviour, not a default.

## 3. Rollback procedure

Rollback is per-layer. You almost never need to roll back every layer at
once — usually the app layer is the broken one and the DB is fine. Match
the rollback to the layer that actually broke.

### 3.1 App (Vercel)

```bash
# Option A — CLI rollback to the previous production deployment
vercel rollback

# Option B — pick a specific older deployment in the Vercel dashboard
#   Deployments → click the SHA you want → "Promote to Production"
```

Vercel keeps every production deployment. The "Promote to Production"
button is the safest when you've made several deploys since the good one
and want to skip past the bad ones.

### 3.2 Database

Migrations are forward-only. There is no `migrate down`. Rolling back
the schema means writing a new migration that undoes the broken one.

```bash
# 1. See what's pending / recent
ls -lt db/migrations/ | head -10
#   -lt sorts by mtime; the most recent is the one most likely to be broken
```

If `db/migration.sql` (the base schema) is the broken file, you're
recovering from backup — go to §6. Otherwise:

```bash
# 2. Identify the broken migration
#    e.g. db/migrations/2026-06-05-weekly-digest-queue.sql is broken

# 3. Write a new file that undoes it
#    db/migrations/2026-06-05-weekly-digest-queue_rollback.sql
#    Start by copying the broken file and reverse the DDL:
#      CREATE TABLE x → DROP TABLE x;
#      ALTER TABLE y ADD COLUMN z → ALTER TABLE y DROP COLUMN z;
#      CREATE INDEX i ON t(c) → DROP INDEX i;
#      INSERT new rows → DELETE those rows (WHERE some marker)
#    Be explicit about data loss in a comment at the top of the file.

# 4. Apply the rollback migration against production
npx @insforge/cli db exec --file db/migrations/2026-06-05-weekly-digest-queue_rollback.sql

# 5. Verify
npx @insforge/cli db query "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name"
# The table/index/column you removed should be gone.

# 6. Apply the rollback app-side as well
vercel rollback   # or redeploy the last-known-good commit
```

**Don't try to be clever.** Forward-only is forward-only. Writing a
rollback file and committing it (`git add db/migrations/*_rollback.sql`)
keeps the audit trail intact and means the next person to read the
migration directory sees both halves of the story.

### 3.3 Edge functions

InsForge functions are versioned. If a deployed function is broken
(`/functions/apify-webhook` returning 500s, for instance), redeploy a
known-good version:

```bash
# List the current code
npx @insforge/cli functions code apify-webhook

# If you have a previous good version in the repo, redeploy it
npx @insforge/cli functions deploy apify-webhook \
  --file functions/apify-webhook.ts \
  --version=<previous-commit-sha>
```

In practice the function code lives in `functions/*.ts` in this repo. If
the deployed function is broken, the source in `main` is almost always
either the same (so redeploy doesn't help — the bug is in InsForge) or
already updated (so a fresh deploy from `main` is what you want). If
neither, you've found a case the docs don't cover — fix the function in
a new commit and redeploy.

### 3.4 Storage

InsForge Storage is append-only. There is no `DELETE` we should ever
call. If a corrupted file was uploaded (wrong content, truncated,
sensitive data that shouldn't have been there):

- **Don't** try to delete the old object.
- **Do** upload a corrected version with a new key, and update the
  `artifacts` row to point at the new key.
- The old object stays as evidence of what was wrong. That's the point
  of the bucket.

If sensitive data leaked into the bucket, that's a security incident —
see §8, and follow the data-handling section in
[SECURITY.md](../SECURITY.md).

## 4. Common errors and fixes

These are the ones we've actually hit. If you hit a new one, add it here
in the same PR that fixes it.

| Symptom | Likely cause | Fix |
|---|---|---|
| `InsforgeUnavailableError` on app boot | `INSFORGE_API_URL` or `INSFORGE_ANON_KEY` missing or placeholder | Verify `.env.local` (or Vercel env), restart `npm run dev` or redeploy. The error message names the missing var. |
| Cron returns 401 | `CRON_SHARED_SECRET` rotated on one side (Vercel env or the InsForge schedule header) but not the other | Update both: `vercel env add CRON_SHARED_SECRET production`, then `npx @insforge/cli schedules update <id> --headers '{"x-cron-secret":"<new>"}'`. |
| Scans return 0 changes for an hour | `APIFY_API_TOKEN` expired, or free-tier memory limit (8GB) hit on `apify/website-content-crawler` (402 status) | Verify token at [console.apify.com](https://console.apify.com). If 402 from Apify, switch the room to direct `fetch()` (set `APIFY_API_TOKEN=` empty in the env override) or upgrade the Apify plan. |
| LLM call returns `401 Incorrect API key provided: OPENAI_A****LDER` | `OPENAI_API_KEY` in `.env.local` is a placeholder (`OPENAI...LDER`); the app fell back to OpenAI rather than OpenRouter | Either set a real `OPENAI_API_KEY` (30+ chars, no `...`) or set `OPENROUTER_API_KEY` (via `npx @insforge/cli ai setup`). |
| `Webhook 401` in notification worker | A subscription's HMAC secret was rotated on the receiver side | Re-create the subscription from the room detail page; the new secret gets persisted to `notification_subscriptions.secret`. |
| Scan returns `failed` with `LLM API error` | OpenAI/OpenRouter 4xx — usually rate limit, expired key, or model name typo | Check the `error_message` column on `snapshot_jobs`. If it's a 429, the room is producing too many LLM calls (see [OPERATIONS.md §LLM costs spike](OPERATIONS.md)). |
| Scan returns `failed` with `INSFORGE_API_URL is not set` | Env var drifted; usually after a Vercel redeploy without env preservation | `vercel env ls production` to confirm; redeploy with `--build-env` or re-add the var. |
| Lint fails in CI on a fresh PR with `react/no-unescaped-entities` | 8 pre-existing unescaped-entity errors unrelated to your change | `npm run lint -- --fix` may auto-fix; if it doesn't, run the `fix-lint` card to land the cleanup. Do not `// eslint-disable` in a fresh PR to silence it. |
| `Permission denied` writing `/var/log/hermes-gateway/*.log` | systemd hardened the service unit; the runtime user can't write the default log path | Either move logs to a writable path (`StandardOutput=journal` is the default and the right answer), or `sudo setenforce 0` if SELinux is the cause. Check `~/.hermes/.env` permissions (`chmod 600`). |
| `Latest scan: Never` on a room that has a real scan job | `/api/rooms/[id]` route had `latestScan: null` hardcoded | Pull the most recent `snapshot_jobs` row with `status=eq.succeeded` for any `tracked_pages.id` in the room. See the `lib/insforge.ts:listRoomsWithStats` recipe in the insforge-debug skill. |
| `diff` extracts `Cannot read 'split' of undefined` | `snapshots` table has no `markdown_text` column, so `prev.text_content` is `undefined` | Run `ALTER TABLE public.snapshots ADD COLUMN IF NOT EXISTS markdown_text text`, then write `markdown_text` on every insert (50KB cap). |

## 5. On-call rotation

**Single-person MVP, founder is on-call.** This is a pre-launch product.
There is no rotation, no escalation tier, no backup. The founder (or
whoever the human is who set up the deploy) is the only person on the
hook.

When paged, follow the escalation path in order. Don't skip steps.

1. **Page** — the page arrives (a Slack notification from a Kanban
   worker, a Sentry alert, a "the app is down" message from a user,
   whatever). Acknowledge it, even if just to yourself.
2. **Check gateway status** — `curl -i https://<your-host>/` should
   return 200. If it 5xx's, you're looking at a Vercel outage or a
   process crash, not an application bug. Check
   [vercel.com/status](https://www.vercel-status.com).
3. **Check the kanban list** — is a worker currently running something
   that might be touching prod? `hermes kanban list` will show in-flight
   tasks.
4. **Check the workers' latest events** — `hermes kanban tail <task_id>`
   on anything that looks suspicious. Workers log every external call
   and every state transition.

If the page turns out to be a worker bug, the right move is to let the
worker fail, comment on the task with what you saw, and `kanban_block`
with a reason. The founder reads the board and decides what to do.

## 6. Backup and recovery

InsForge is a managed Postgres + managed object store, so the database
and the `pagevault-evidence` bucket are both backed up on InsForge's
schedule (their standard tier durability applies; get the snapshot
SLA from their support contract).

The things that are **not** automatically backed up:

- The app source (it's in git, on GitHub — that's the backup).
- The Vercel project (env vars, deployment history) — Vercel keeps
  these; you can `vercel env pull` to export.
- The InsForge Schedules (cron jobs) — these are *not* in code. If
  they're lost, you have to recreate them by hand using the commands
  in [DEPLOYMENT.md §Configuring InsForge Schedules](DEPLOYMENT.md).

### Full disaster recovery (new project, from scratch)

If the InsForge project is gone and you need to stand up a new one:

```bash
# 1. Create a new InsForge project, log the new keys somewhere safe
npx @insforge/cli login --user-api-key <new-user-key>
npx @insforge/cli link --project-id <new-project-id>

# 2. Apply the base schema
npx @insforge/cli db exec --file db/migration.sql

# 3. Apply every migration in order, oldest first
ls db/migrations/ | sort | while read f; do
  echo "Applying $f..."
  npx @insforge/cli db exec --file "db/migrations/$f"
done

# 4. Recreate the storage bucket
npx @insforge/cli storage create-bucket pagevault-evidence --private

# 5. Recreate the InsForge Schedules
npx @insforge/cli schedules create scan-all \
  --cron "*/1 * * * *" \
  --target "https://<your-host>/api/cron/scan-all" \
  --method POST \
  --headers '{"x-cron-secret":"<CRON_SHARED_SECRET>"}'

npx @insforge/cli schedules create notification-worker \
  --cron "*/1 * * * *" \
  --target "https://<your-host>/api/cron/notification-worker" \
  --method POST \
  --headers '{"x-cron-secret":"<CRON_SHARED_SECRET>"}'

# 6. Deploy the app
vercel --prod

# 7. Run the smoke-test checklist in DEPLOYMENT.md
```

**RTO / RPO targets (MVP, document these with the founder before going live):**

- **RTO (Recovery Time Objective):** 4 hours. The DR runbook above is the
  target; budget 2 hours of execution + 2 hours of debugging the
  inevitable environment drift.
- **RPO (Recovery Point Objective):** whatever InsForge's Postgres
  snapshot interval is (typically 24 hours for managed Postgres on the
  standard tier). For the storage bucket, RPO is effectively 0 — every
  scan writes the file before the DB row is committed.

If you tighten either target, you pay for it: point-in-time recovery on
Postgres costs more, and a multi-region storage bucket costs more. Make
the call before launch, not after an incident.

## 7. Secrets rotation

The five production secrets, in priority order:

| Secret | Where it lives | Cadence | How to rotate |
|---|---|---|---|
| `NEXTAUTH_SECRET` | Vercel env (prod) | On-demand. Rotate immediately if you suspect a leak. | `openssl rand -base64 32` → `vercel env rm NEXTAUTH_SECRET production && vercel env add NEXTAUTH_SECRET production` → redeploy. **All user sessions invalidate.** |
| `INSFORGE_SERVICE_ROLE_KEY` | Vercel env + `.insforge/project.json` | 90 days. | Rotate in the InsForge dashboard, update both locations, redeploy. The cron worker will 401 on the next attempt if the SRK is wrong — see the cron 401 row in §4. |
| `INSFORGE_ANON_KEY` | Vercel env + `.insforge/project.json` + `NEXT_PUBLIC_INSFORGE_ANON_KEY` | 90 days. | Same as SRK, but the public/anon key is safe to ship in client JS so a leak is less catastrophic. Update all three places (server anon, client NEXT_PUBLIC, `.insforge/project.json`). |
| `APIFY_API_TOKEN` | Vercel env | 90 days, or on-demand if Apify support flags something. | Generate at [console.apify.com](https://console.apify.com/settings/integrations), `vercel env add APIFY_API_TOKEN production`, redeploy. |
| `APIFY_WEBHOOK_SECRET` | Vercel env + the Apify webhook integration's "Shared secret" field | 90 days. | `openssl rand -base64 48`, set both sides (Vercel env and the Apify integration), restart the edge function (redeploy). |
| `CRON_SHARED_SECRET` | Vercel env + every InsForge schedule's `headers` JSON | 90 days. | `openssl rand -hex 32`, update Vercel, then for each schedule run `npx @insforge/cli schedules update <id> --headers '{"x-cron-secret":"<new>"}'`. See the cli-parse-output pitfall in the insforge-cli skill — `schedules list --json` output has nested braces. |
| `OPENAI_API_KEY` / `OPENROUTER_API_KEY` | Vercel env | On-demand. | Rotate in the provider's dashboard, update Vercel, redeploy. |

**Rotation rules:**

- Service keys (`INSFORGE_*`, `APIFY_*`, `CRON_*`, the LLM keys) get a
  hard 90-day cadence. Set a calendar reminder; don't wait until you
  suspect a leak.
- User-provided secrets (whatever a user plugs in via the room detail
  page) are the user's problem. We do not store them, and we do not
  rotate them. If a user rotates, they re-create the subscription from
  the UI.
- After every rotation, run the smoke-test in §DEPLOYMENT.md to make
  sure the new value actually took.

## 8. Incident response

Four steps. In order. Don't skip ahead.

1. **Check the kanban for the worker that's running.** `hermes kanban list`
   shows every in-flight task. If the broken thing is "the scan worker
   has been wedged for 20 minutes", look for a task with a long runtime
   and an unusual status.

2. **Read the gateway log.** `journalctl --user -u hermes-gateway -n 200`
   shows the last 200 lines of the gateway. If you don't see systemd
   managing the gateway (some installs use a different supervisor),
   substitute the right log path — `tail -200 ~/.hermes/logs/gateway.log`
   is the common fallback.

3. **`hermes kanban tail <task_id>` on the suspect task.** This streams
   the worker's last N events. Look for repeated error patterns, the
   last successful state transition, and the timestamp of the most
   recent log line. If the worker has been silent for >5 minutes on a
   long-running task, it's probably stuck, not "thinking".

4. **If it's a worker crash, `hermes kanban reclaim <id>`** and let the
   dispatcher retry. The reclaim transitions the task back to `ready`
   without incrementing the failure counter; the next dispatcher tick
   will re-spawn it. Only reclaim when you believe the crash was
   transient (network blip, OOM that won't repeat, InsForge rate limit).
   If the crash is deterministic — bad code, wrong env — fix the root
   cause first, then reclaim.

If after these four steps you still don't know what's wrong, comment on
the task with what you've seen, `kanban_block` with a one-line reason,
and ping the founder. The next worker that picks up the task will read
the comment thread first.

---

**Last reviewed:** the runbook was written against `main` at the time of
the K-17 / K-19 launch checklist work. If you change a deploy step, a
rollback procedure, or a recovery path, update this file in the same PR.
