# Runbook

> **Audience:** on-call engineer responding to a PageVault incident,
> or a maintainer performing a deploy or rollback.
> **Pair with:** [DEPLOYMENT.md](DEPLOYMENT.md) (architecture + env vars),
> [OPERATIONS.md](OPERATIONS.md) (incident classes), [SECURITY.md](../SECURITY.md).

This runbook is the operational source of truth. When something is
broken, do the steps here before improvising. When improvising is
required, **update this file afterwards** so the next on-call inherits
your learning.

---

## Contents

1. [Deploy procedure](#1-deploy-procedure)
2. [Rollback procedure](#2-rollback-procedure)
3. [Stop everything (incident brake)](#3-stop-everything-incident-brake)
4. [Inspect a deployment](#4-inspect-a-deployment)
5. [Database rollback](#5-database-rollback)
6. [Cron worker failure](#6-cron-worker-failure)
7. [Secrets rotation](#7-secrets-rotation)

---

## 1. Deploy procedure

### 1.1 Staging (push to `main`)

Triggers automatically via `.github/workflows/deploy-staging.yml`.
No human action required beyond merging the PR.

**Watch for:** the `deploy / Deploy to Vercel preview (staging)` job
in the GitHub Actions UI. The step summary will show the preview URL.
Smoke checks (200/200/307/401) run against the deployed URL and
fail the job if any regress.

**To redeploy without a code change:** re-run the workflow from the
Actions UI. Do not re-tag — staging has no tag gating.

### 1.2 Production (tag a release)

Prod deploys are gated by a manual approval on the `production`
GitHub Environment. The flow:

```bash
# 1. Make sure main is green.
git checkout main
git pull --ff-only origin main

# 2. Bump the version. Use `npm version` for code releases so
#    package.json + package-lock.json + the tag all stay in sync.
#    Doc-only releases: edit package.json by hand.
npm version 0.1.1 --no-git-tag-version

# 3. Commit the version bump.
git add package.json package-lock.json
git commit -m "chore(release): 0.1.1"

# 4. Tag. Use an annotated tag (not lightweight) so the GitHub
#    release page has authorship + a message.
git tag -a v0.1.1 -m "Release 0.1.1"

# 5. Push the tag. The workflow triggers on tag push.
git push origin main --follow-tags
```

**Watch for:** the `deploy / Deploy to Vercel production` job. It
will pause at the "Waiting" state and page the `production`
environment's required reviewers. Approve in the GitHub UI.

**Pre-deploy checklist:**
- [ ] `ci / build` was green on the commit the tag points to.
- [ ] The version in `package.json` matches the tag (`v0.1.1` → `0.1.1`).
- [ ] The tag is annotated (`git show v0.1.1` shows a tagger line).
- [ ] No open incident that would make a prod deploy unwise.
- [ ] A second maintainer is online to approve (you can't approve
      your own deploy if branch protection is set to "require
      non-author approval").

---

## 2. Rollback procedure

> **Pick the smallest blast radius that fixes the incident.** A code
> rollback is almost always cheaper and faster than a database one.

### 2.1 Vercel deployment rollback (preferred for app-only regressions)

This is the fast path. It rolls the app back to the previous Vercel
deployment without touching git or the database. Use it for: a bad
release, a routing bug, an SSR regression, a 5xx spike tied to a
specific commit.

**Option A — Vercel dashboard (recommended):**

1. Open the Vercel project → **Deployments**.
2. Find the last-known-good deployment (look for the most recent
   green one before the incident started).
3. Open the ⋮ menu → **Promote to Production**.
4. Vercel re-points the production alias to that deployment. Takes
   ~30 seconds. No build, no PR.
5. Watch the **Post-deploy commit status** check on the rolled-back
   commit go green in GitHub.
6. Open an incident ticket with: the SHA you rolled back to, the
   commit you rolled back from, and the reason.

**Option B — CLI:**

```bash
# Install once: npm i -g vercel
vercel login

# List the last 5 deployments with their URLs
vercel ls --prod | head -10

# Roll back to a specific deployment URL
vercel rollback <deployment-url>
```

**When to do this instead of `git revert`:** the incident is
app-only (no schema or storage change), you want the rollback in
under a minute, and you don't need a permanent commit that says
"this was reverted". A Vercel rollback is reversible — re-promote
the newer deployment once the underlying bug is fixed.

**When NOT to do this:** if the bad release included a database
migration or an evidence-storage schema change (see §5). Rolling
back the app to an older commit while leaving the new schema in
place can crash the older code on first request. In that case,
roll forward (fix forward) or do a coordinated `git revert` +
redeploy of the same SHA, not a Vercel rollback.

### 2.2 `git revert` + redeploy (when you need a paper trail)

Use this when the rollback needs to be visible in the git history
(e.g. for compliance, when the bad commit had a destructive side
effect you want to neutralize, or when the team is reviewing the
incident post-mortem).

```bash
# 1. Identify the bad commit. GitHub shows it in the deploy
#    status check; you can also find it in the Vercel dashboard.
BAD_SHA=abc1234

# 2. Revert it on a new branch. Use --no-edit to take the default
#    commit message; add context if you need it.
git checkout main
git pull --ff-only origin main
git revert --no-edit $BAD_SHA

# 3. Push. The normal staging deploy workflow fires.
git push origin main
```

If the revert is urgent and you don't want to wait for the
staging-to-prod path, tag the revert as a patch release
(`v0.1.2`) so the prod workflow can ship it through the
approval gate quickly. Document in the incident ticket that the
prod deploy is a revert, not a forward change.

### 2.3 Decision tree

```
Incident
├── Bad release, app-only, no schema change
│   └── Vercel rollback (Option A or B)        ← fastest
├── Bad release with a non-destructive schema change
│   └── Vercel rollback to the previous deployment
│       (the schema change is additive and the older code tolerates it)
├── Bad release with a destructive schema change
│   └── STOP. Read §5 first.
│       Coordinated revert + manual verification.
└── Security incident (credential leak, RCE, etc.)
    └── §3 (stop everything) FIRST, then §2.
```

---

## 3. Stop everything (incident brake)

When a deploy has already shipped and the rollback is the only
remaining move, but you need to **freeze** the system — no more
scans, no more notifications, no more prod deploys — do this:

1. **Lock down the production GitHub Environment**:
   Repo → Settings → Environments → `production` → add the
   on-call team as required reviewers with a **deployment
   branch policy of "Only protected branches"**. While the lock
   is in effect, `deploy-prod.yml` cannot run because no
   branch is allowed.
2. **Pause the scheduled-scans cron**:
   In the InsForge dashboard, open the `scheduled-scans` schedule
   and click **Pause**. This stops new scan jobs from being
   created. Already-running jobs will finish; that's fine.
3. **Pause the notification-worker cron**:
   Same as above for the `notification-worker` schedule.
4. **Optionally: revert the latest prod deploy** via §2.1.

To unfreeze, reverse each step in order. Don't forget to unpause
the cron schedules — the most common incident-after-the-incident
is "why did scans silently stop for 3 hours?" because someone
forgot to flip the schedule back on.

---

## 4. Inspect a deployment

```bash
# What is currently serving prod?
vercel ls --prod

# Tail the runtime logs of a specific deployment
vercel logs <deployment-url> --follow

# Pull the build log of a specific deployment
vercel inspect <deployment-url>

# List the Vercel env vars actually set on the project
vercel env ls production
```

For a deeper view (InsForge function logs, storage operations,
Postgres slow queries) use the InsForge dashboard:
https://insforge.dev → open the `PageVault` project →
**Logs** / **Database** / **Storage**.

---

## 5. Database rollback

> **Last resort.** Schema changes in production require a
> coordinated plan, not a `git revert`.

PageVault persists everything in InsForge Postgres (via the
`@insforge/sdk`) and in an InsForge storage bucket
(`pagevault-evidence`). The schema lives in `db/*.sql` and the
bucket is created on first deploy.

**If the bad release only changed the application code (no new
columns, no new tables, no new storage keys):** do a Vercel
rollback per §2.1. The database is unchanged and the older code
still speaks the same schema.

**If the bad release added a non-destructive migration
(new column with a default, new table, new index):** the
older code may or may not tolerate the new shape. Try the
Vercel rollback first. If the older code crashes on first
request with a schema-related error, fall through to:

1. **Forward-fix** the new column to be optional. Quickest
   path; preserves the data model.
2. Or, **drop the new column** with a hotfix migration:
   ```sql
   ALTER TABLE rooms DROP COLUMN new_thing;
   ```
   Apply via the InsForge SQL editor or `npx @insforge-cli sql`
   and immediately push a hotfix commit that removes the code
   that referenced the column.

**If the bad release added a destructive migration
(`DROP COLUMN`, `DROP TABLE`, type change, NOT NULL on a
column with existing NULLs):** you cannot roll the app back
without losing data. The choices are:

1. **Restore from a point-in-time backup.** InsForge Postgres
   supports PITR; reach out to InsForge support with the
   timestamp you need. Test the restore on a staging clone
   first; never restore over the live database.
2. **Forward-fix the destructive change.** If the destructive
   change was an accident (e.g. someone shipped a `DROP COLUMN`
   that wasn't supposed to be there), ship a hotfix that
   re-adds the column with the same shape. Coordinate with
   the on-call DBA.

**Evidence storage (the `pagevault-evidence` bucket)** is
immutable — files are never deleted by the app. A bad release
that uploaded garbage to the bucket cannot be rolled back by
deleting the files; the URLs in the database still point to
them. The path is:
1. Roll forward with a fix that ignores the bad evidence.
2. Tag the bad evidence files with a metadata key
   (e.g. `status=quarantined`) via the InsForge dashboard.
3. Purge the quarantine set after a 30-day grace period.

---

## 6. Cron worker failure

The scheduled-scan and notification-worker endpoints live in
`app/api/cron/`. They are called by the InsForge schedules
every N minutes. Each endpoint is authenticated with
`CRON_SHARED_SECRET` via the `x-cron-secret` header.

**Symptoms:**

- `vercel logs` shows repeated 401s from the InsForge scheduler
  IP — the secret has rotated or been unset.
- The `scheduled_scans` table stops growing new rows — the
  worker can't write.
- The `notification_outbox` table grows but `sent_at` stays
  NULL — the worker isn't draining it.

**Steps:**

1. **Confirm the secret is set** in the Vercel project:
   `vercel env ls production | grep CRON_SHARED_SECRET`. If
   missing, follow §7 to mint a new one.
2. **Confirm the InsForge schedule points at the right URL
   with the right header**. Open the schedule in the InsForge
   dashboard and verify:
   - URL: `https://<your-prod-domain>/api/cron/notification-worker`
   - Method: `POST`
   - Header: `x-cron-secret: <the same secret>`
3. **Tail the Vercel logs** for the cron endpoint and look for
   the actual error. Common ones:
   - `CRON_SHARED_SECRET unset` → the Vercel env var is missing.
     See §7.
   - `insforge 503 service_unconfigured` → the InsForge
     service-role key is missing or rotated. Same fix.
   - `insforge 401 invalid jwt` → the anon key is stale. See §7.
4. **Manual drain** (if notifications are backed up): call the
   worker endpoint by hand with the secret:
   ```bash
   curl -X POST -H "x-cron-secret: $CRON_SHARED_SECRET" \
     https://<your-prod-domain>/api/cron/notification-worker
   ```
   Repeat until `notification_outbox WHERE sent_at IS NULL`
   is empty. The endpoint is idempotent — duplicate calls
   are safe.

---

## 7. Secrets rotation

PageVault has four classes of secrets. Each is rotated differently.

### 7.1 Vercel project env vars

These live in the Vercel dashboard, not in GitHub. The deploy
workflows do not need them — only the running app does.

```bash
# List what's currently set
vercel env ls production

# Set a new value (creates the entry if it doesn't exist)
echo "<new-value>" | vercel env add CRON_SHARED_SECRET production

# Remove the old value (only if you minted a fresh one and
# both old and new are valid in the running app)
vercel env rm CRON_SHARED_SECRET production --yes
```

After any change, **trigger a no-op prod deploy** so the new
env vars are baked into the runtime. The deploy-staging
workflow on a no-op merge is the easiest way; it builds
against staging, but if the secret is production-only,
push an empty commit to main to fire staging and then
trigger a prod rebuild via the Vercel dashboard.

For **InsForge project keys** (`INSFORGE_API_URL`,
`INSFORGE_SERVICE_ROLE_KEY`, `INSFORGE_ANON_KEY`): rotate
in the InsForge dashboard first, then update the Vercel env
vars, then redeploy. The InsForge dashboard gives you a
"roll new key alongside old" window — use it. Cut over to
the new key in Vercel only after the new key has been live
in InsForge for at least one full cron tick.

### 7.2 Vercel account token (`VERCEL_TOKEN`)

Used by the deploy workflows. Rotate via the Vercel
dashboard: Settings → Tokens → Revoke + create new. Update
the GitHub repo secret `VERCEL_TOKEN` (Settings → Secrets
→ Actions) with the new value. Both deploy workflows pick
up the new value on their next run.

`VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` are not secret, but
they are config. They do not need to rotate; if the Vercel
project is moved to a new team, the values change and the
GitHub secrets need to be updated.

### 7.3 GitHub token (`GITHUB_TOKEN`)

Auto-issued per workflow run. No rotation needed. For
workflows that need a long-lived PAT (none currently do),
use a fine-grained token scoped to the `PageVault` repo
with `contents: write` and `deployments: write` only.

### 7.4 Cron shared secret (`CRON_SHARED_SECRET`)

Used by the InsForge scheduler to call the cron endpoints.
Rotate by:

1. Mint a new value: `openssl rand -hex 32`.
2. Set the new value in Vercel production env vars (§7.1).
3. Update the InsForge schedule's `x-cron-secret` header
   to the new value.
4. **Keep the old value valid in the app for at least one
   cron tick** (5 minutes) so any in-flight requests from
   the old schedule don't 401.
5. Remove the old value from Vercel env vars.

If you suspect the old value is compromised, skip step 4
and remove the old value immediately after step 3. The
brief 401 window is acceptable when the alternative is
keeping a leaked secret alive.

---

## Appendix A: quick-reference commands

```bash
# What's deployed right now?
vercel ls --prod

# Roll back to a specific deployment
vercel rollback <deployment-url>

# Tail prod logs
vercel logs <deployment-url> --follow

# Re-run the last failed CI job
gh run rerun <run-id> --failed

# Cancel an in-flight prod deploy that hasn't been approved yet
gh workflow run cancel deploy-prod

# Mint a new cron secret
openssl rand -hex 32

# Test the cron worker with a manual call
curl -X POST -H "x-cron-secret: $CRON_SHARED_SECRET" \
  https://<your-prod-domain>/api/cron/notification-worker
```

## Appendix B: who to page

- **Deploy is wedged / Vercel 5xx** → on-call devops (this rotation)
- **InsForge backend errors (auth, RLS, Postgres)** → InsForge
  support (status.insforge.dev for incident status)
- **Vercel platform outage** → status.vercel.com first, then
  escalate to on-call devops if the workaround is non-obvious
- **Security incident** (credential leak, suspected RCE) → on-call
  security (see `SECURITY.md` for the disclosure policy)
