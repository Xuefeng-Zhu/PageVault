# Legacy SQL — SUPERSEDED

> **Do not run these files.** They are preserved for `git blame` and historical
> reference only. The canonical, idempotent PageVault schema is
> [`../schema.sql`](../schema.sql) (see also [`../ER.md`](../ER.md) for the
> Mermaid ER diagram).

## Why these files exist

Before commit `0aea200` ("feat(db): canonical schema.sql + ER.md for
PageVault InsForge Postgres"), the PageVault schema was spread across four
loosely-coupled files:

| File (original path)                       | Date       | Contents                                              |
|--------------------------------------------|------------|-------------------------------------------------------|
| `db/migration.sql`                         | 2026-05-30 | 7-table scaffold (projects, tracked_pages, snapshot_jobs, snapshots, artifacts, ai_explanations, webhook_events) |
| `db/migrations/2026-06-02-scan-schedules.sql`            | 2026-06-02 | scan_schedules table                                |
| `db/migrations/2026-06-02-notification-tables.sql`       | 2026-06-02 | notification_subscriptions + notification_outbox tables |
| `db/migrations/2026-06-02-notification-advisory-lock.sql` | 2026-06-02 | advisory-lock RPC + GRANT/REVOKE statements          |

The first three were applied to the dev InsForge instance, but with two
documented defects:

1. **The `db import` multi-statement DDL pitfall** — every `ALTER TABLE ...
   ENABLE ROW LEVEL SECURITY` and `CREATE POLICY` line in the original
   `migration.sql` silently no-op'd when applied via `npx @insforge/cli db
   import`, because the CLI executed only the first statement of the file.
2. **Missing `created_at` / `updated_at` audit columns** — the P0 schema card
   required every table to expose those columns; the original `migration.sql`
   used semantically richer names like `requested_at`, `observed_at`, and
   `received_at`, which broke callers that expected the audit columns under
   the standard names.

`db/schema.sql` (commit `0aea200`) consolidates all four files into a single,
idempotent migration that:

* uses `CREATE TABLE IF NOT EXISTS` / `CREATE OR REPLACE FUNCTION` / `DO $$
   ... $$` blocks so it is safe to re-run on top of a partial application,
* has `created_at` + `updated_at` on every table (`updated_at` triggers added
   where the legacy name was semantically richer),
* applies all 9 RLS policies to user-scoped tables in one shot, and
* is the single source of truth used by the deploy pipeline (see
   `docs/DEPLOYMENT.md`).

## What to do if you find a reference to one of these files

If you see a doc, runbook, or comment pointing at `db/migration.sql` or
`db/migrations/2026-06-02-*.sql`:

1. **Do not run the file.** The schema in this directory is incomplete and
   broken (RLS missing, audit columns missing).
2. **Update the reference** to point at `db/schema.sql` instead.
3. **If the reference is in a historical artifact** (e.g. `docs/audits/`,
   `docs/plans/`, `docs/superpowers/specs/`, `.kiro/specs/`, or a commit
   message), leave it — those documents are a snapshot of how the codebase
   looked on that date and rewriting them would falsify the audit trail.

## File mapping (legacy → canonical)

Every construct in these four files has a corresponding statement in
`db/schema.sql`. Quick lookup:

* `migration.sql` projects / tracked_pages / snapshot_jobs / snapshots /
  artifacts / ai_explanations / webhook_events → `schema.sql` lines for the
  same table names (now with `created_at` + `updated_at` and the full RLS
  policy set)
* `2026-06-02-scan-schedules.sql` scan_schedules table → `schema.sql`
  scan_schedules section (with `created_at` + `updated_at` added)
* `2026-06-02-notification-tables.sql` notification_subscriptions +
  notification_outbox → `schema.sql` notification_* sections
* `2026-06-02-notification-advisory-lock.sql` `acquire_notification_lock` /
  `release_notification_lock` functions + GRANT/REVOKE → `schema.sql`
  notification RPC helpers section (with `updated_at` triggers)

If you ever need to rebuild the dev instance from scratch, the single command
is:

```bash
npx @insforge/cli db import db/schema.sql
```
