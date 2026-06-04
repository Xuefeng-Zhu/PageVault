# Data Model

> **Last updated:** 2026-06-02 · view this against commit `3b0f2ca` for accuracy.
> **Source of truth:** the SQL in [`db/migration.sql`](../db/migration.sql) and
> the per-feature files in [`db/migrations/`](../db/migrations). This doc is a
> commentary, not a replacement.

## ER diagram

```
                            ┌──────────────┐
                            │  auth.users  │  (managed by InsForge)
                            └──────┬───────┘
                                   │  owner_id
                                   ▼
                            ┌──────────────┐
                            │   projects   │
                            │  (rooms)     │
                            └──────┬───────┘
                                   │  1:N
                                   ▼
                            ┌──────────────┐         ┌──────────────────┐
                            │tracked_pages │         │  scan_schedules  │  1:1 (project)
                            └──────┬───────┘         └──────────────────┘
                                   │  1:N
                                   ▼
                            ┌──────────────┐
                            │snapshot_jobs │
                            └──────┬───────┘
                                   │  1:N
                                   ▼
                            ┌──────────────┐         ┌──────────────────┐
                            │  snapshots   │◄────────│  ai_explanations │  1:1
                            └──────┬───────┘ previous └────────┬─────────┘
                                   │  1:N                     │  1:N
                                   ▼                          ▼
                            ┌──────────────┐         ┌──────────────────────┐
                            │  artifacts   │         │ notification_outbox  │
                            └──────────────┘         └──────────┬───────────┘
                                                              │  N:1
                                                              ▼
                                                   ┌──────────────────────────┐
                                                   │ notification_subscriptions│
                                                   └──────────────────────────┘

(separate) ┌──────────────────┐
           │ webhook_events   │  inbound-webhook idempotency log
           └──────────────────┘
```

## Tables

### `public.projects` — a user's "memory room"

A **project** is a watchlist of URLs the user wants to monitor. The term
"room" is used interchangeably in the UI; "project" is the schema name.

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | Internal id |
| `owner_id` | `uuid` | NOT NULL, FK → `auth.users(id)` | The user who owns the room |
| `name` | `text` | NOT NULL | Display name (e.g. "Linear pricing, weekly") |
| `box_root_folder_id` | `text` | nullable | **InsForge Storage folder path** (e.g. `pagevault/aws-infrastructure-monitor`). Column name kept for back-compat. |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | |

**Indexes:** `(owner_id)`.
**RLS:** `projects_owner_select` — `owner_id = auth.uid()`.

### `public.tracked_pages` — one URL inside a project

A URL the user wants monitored. Uniqueness on `(project_id, normalized_url)`
prevents double-listing the same URL inside a room.

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | Internal id |
| `project_id` | `uuid` | NOT NULL, FK → `projects(id)` ON DELETE CASCADE | Owning room |
| `source_url` | `text` | NOT NULL | The full URL as the user typed it |
| `normalized_url` | `text` | NOT NULL | Lowercased, scheme-stripped, no trailing slash — used for dedup |
| `slug` | `text` | NOT NULL | URL-derived kebab-case identifier (≤50 chars) |
| `box_page_folder_id` | `text` | nullable | **InsForge Storage path** for this page's snapshots |
| `active` | `boolean` | NOT NULL, default `true` | Soft-delete flag — `false` means the URL is "paused" |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | |
| | | `UNIQUE (project_id, normalized_url)` | |

**Indexes:** `(project_id)`.
**RLS:** `tracked_pages_owner_select` — join via `projects` to `owner_id = auth.uid()`.

### `public.snapshot_jobs` — a single scan run

One row per scan invocation. A scan may produce many `snapshots` (one per
URL in the room), so the `trigger_type` is per-job, not per-snapshot.

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| `id` | `uuid` | PK | Job id (the first URL's id is reused — see the `scan_jobs` insert in `lib/scan.ts:404`) |
| `tracked_page_id` | `uuid` | NOT NULL, FK → `tracked_pages(id)` ON DELETE CASCADE | **Currently reused across all URLs in the scan** (see Open Questions below) |
| `trigger_type` | `text` | NOT NULL, CHECK in `('manual','schedule','box_webhook','retry')` | What caused the scan |
| `status` | `text` | NOT NULL, CHECK in `('queued','running','succeeded','failed','deduped')` | Job lifecycle |
| `apify_run_id` | `text` | nullable | The Apify run id (when Apify is the crawler) |
| `apify_dataset_id` | `text` | nullable | The Apify dataset id |
| `error_code` | `text` | nullable | Machine-readable error code (currently unused — see `error_message`) |
| `error_message` | `text` | nullable | Human-readable error message |
| `requested_at` | `timestamptz` | NOT NULL, default `now()` | |
| `finished_at` | `timestamptz` | nullable | |

**Indexes:** `(tracked_page_id, requested_at desc)`, `(status, requested_at desc)`.
**RLS:** not enabled — service-role-only writes (the cron worker and the API
route handler both use the service-role key).

> ⚠️ **Open question:** the current code writes one `snapshot_jobs` row
> per scan but `tracked_page_id` is set to the *first* URL's id. This
> is a data-model shortcut — the schema supports one job per URL but the
> current code reuses one job across all URLs. A future migration may
> split this out.

### `public.snapshots` — a captured page version

One row per crawl. The `markdown_hash` is the cost-saver: if the hash
matches the previous snapshot, no LLM call is made.

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | Internal id |
| `tracked_page_id` | `uuid` | NOT NULL, FK → `tracked_pages(id)` ON DELETE CASCADE | Which URL this snapshot is for |
| `job_id` | `uuid` | NOT NULL, FK → `snapshot_jobs(id)` ON DELETE CASCADE | Which scan produced this snapshot |
| `observed_at` | `timestamptz` | NOT NULL, default `now()` | When the crawl was made |
| `final_url` | `text` | nullable | After any HTTP redirects |
| `canonical_url` | `text` | nullable | The page's `<link rel="canonical">` |
| `page_title` | `text` | nullable | The `<title>` |
| `http_status` | `integer` | nullable | Last response status |
| `markdown_hash` | `text` | NOT NULL | SHA-256 of `normalizeText(markdown)` (see `lib/diff.ts`) |
| `html_hash` | `text` | nullable | SHA-256 of the raw HTML |
| `screenshot_phash` | `text` | nullable | Perceptual hash of the screenshot (when taken) |
| `change_type` | `text` | NOT NULL, CHECK in `('none','textual','visual','structural','error')` | Refined by the LLM when a change is detected |
| `dedup_of_snapshot_id` | `uuid` | nullable, FK → `snapshots(id)` | When the content is identical to a prior snapshot, this points to the canonical row |
| `box_snapshot_folder_id` | `text` | nullable | **InsForge Storage path** for the snapshot's folder |

**Indexes:** `(tracked_page_id, observed_at desc)`, `(markdown_hash)`,
`(change_type)`.
**RLS:** not enabled (service-role).

### `public.artifacts` — files linked to a snapshot

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| `id` | `uuid` | PK | |
| `snapshot_id` | `uuid` | NOT NULL, FK → `snapshots(id)` ON DELETE CASCADE | |
| `kind` | `text` | NOT NULL, CHECK in `('markdown','html','screenshot','snapshot_json','diff_json','explanation_json')` | |
| `box_file_id` | `text` | nullable | **InsForge Storage key** |
| `box_file_version_id` | `text` | nullable | **InsForge Storage version id** |
| `sha256` | `text` | NOT NULL | SHA-256 of the file contents |
| `bytes` | `bigint` | nullable | |
| `mime_type` | `text` | nullable | |
| `box_path` | `text` | nullable | |

**Indexes:** `(snapshot_id, kind)`, `(box_file_id)`.

> ⚠️ **Currently unused.** `lib/scan.ts` doesn't write to this table.
> It's reserved for the future case where we want to record the
> individual evidence files (markdown, HTML, screenshot, diff JSON)
> separately from the `snapshots` row.

### `public.ai_explanations` — the LLM's analysis of a diff

One row per snapshot that triggered an LLM call. `output_json` is the
strict JSON the model returned; `confidence` is the self-assessed
`confidence` field from the same JSON.

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| `id` | `uuid` | PK | |
| `snapshot_id` | `uuid` | NOT NULL UNIQUE, FK → `snapshots(id)` ON DELETE CASCADE | One explanation per snapshot |
| `previous_snapshot_id` | `uuid` | nullable, FK → `snapshots(id)` | The snapshot the diff is against |
| `model` | `text` | NOT NULL | E.g. `anthropic/claude-3.5-haiku` |
| `prompt_version` | `text` | NOT NULL | E.g. `v1` (the system prompt is in `lib/scan.ts:253-275`) |
| `output_json` | `jsonb` | NOT NULL | The full model response (see `lib/scan.ts:204-233` for the shape) |
| `confidence` | `numeric(4,3)` | nullable | The model's self-assessed confidence, 0.000–1.000 |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | |

**Indexes:** `(model, created_at desc)`.
**RLS:** not enabled (service-role).

**`output_json` shape** (the contract with the LLM):
```json
{
  "changed": true,
  "severity": "high" | "medium" | "low",
  "change_type": "pricing" | "positioning" | "feature" | "legal"
                  | "security" | "hiring" | "docs" | "minor" | "unknown",
  "summary": "one-sentence plain-English summary",
  "business_interpretation": "why this matters (1-2 sentences)",
  "recommended_actions": ["action 1", "action 2"],
  "evidence": [
    {"before": "old text or null", "after": "new text", "explanation": "why this matters"}
  ],
  "confidence": 0.87
}
```

### `public.webhook_events` — inbound-webhook idempotency log

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| `id` | `uuid` | PK | |
| `source` | `text` | NOT NULL, CHECK in `('apify','box')` | Where the webhook came from |
| `external_event_id` | `text` | NOT NULL | The source-system event id (for dedup) |
| `payload_sha256` | `text` | NOT NULL | Hash of the body for tamper detection |
| `received_at` | `timestamptz` | NOT NULL, default `now()` | |
| `processed_at` | `timestamptz` | nullable | |
| `status` | `text` | NOT NULL, CHECK in `('received','processed','ignored','failed')` | |
| | | `UNIQUE (source, external_event_id)` | |

**Indexes:** `(source, received_at desc)`.

> ⚠️ **Currently has no writer.** `functions/apify-webhook.ts` doesn't
> log there yet. The table exists for when the inbound-webhook flow is
> fully wired.

### `public.scan_schedules` — per-room scan schedule

One row per room. `insforge_schedule_id` is the id of the corresponding
InsForge Schedule (the actual cron entity).

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| `id` | `uuid` | PK | |
| `project_id` | `uuid` | NOT NULL UNIQUE, FK → `projects(id)` ON DELETE CASCADE | One schedule per room |
| `cron_expression` | `text` | NOT NULL | Standard 5-field cron (e.g. `*/15 * * * *`) |
| `enabled` | `boolean` | NOT NULL, default `true` | |
| `insforge_schedule_id` | `text` | nullable | The InsForge Schedule id (set after `insforge schedules create`) |
| `last_run_at` | `timestamptz` | nullable | Updated by `lib/insforge.ts:updateScheduleLastRun` |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | |
| `updated_at` | `timestamptz` | NOT NULL, default `now()` | |

**Indexes:** partial index on `(enabled) WHERE enabled = true` for the
`scan-all` cron worker to scan only enabled schedules efficiently.

### `public.notification_subscriptions` — outbound webhook subscription

A user can attach one or more webhook subscriptions to a room. When a
change is detected on a URL in that room, an outbox row is created per
subscription.

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| `id` | `uuid` | PK | |
| `project_id` | `uuid` | NOT NULL, FK → `projects(id)` ON DELETE CASCADE | |
| `channel` | `text` | NOT NULL, default `'webhook'`, CHECK in `('webhook')` | Currently only webhook is supported |
| `config` | `jsonb` | NOT NULL | Channel-specific config (e.g. `{ "url": "https://...", "secret": "..." }` for webhook) |
| `severity_threshold` | `text` | NOT NULL, default `'medium'`, CHECK in `('low','medium','high')` | The minimum severity that fires the webhook |
| `enabled` | `boolean` | NOT NULL, default `true` | Auto-set to `false` after 10 consecutive failures |
| `consecutive_failures` | `integer` | NOT NULL, default `0` | Reset to 0 on success or after a 24h gap |
| `failure_window_start` | `timestamptz` | nullable | The start of the current 24h failure window |
| `last_triggered_at` | `timestamptz` | nullable | |
| `last_failure_at` | `timestamptz` | nullable | |
| `last_failure_error` | `text` | nullable | Truncated to 500 chars |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | |
| `updated_at` | `timestamptz` | NOT NULL, default `now()` | |

**Indexes:** `(project_id, enabled)`.

### `public.notification_outbox` — durable outbox

Drained by the `notification-worker` cron. The advisory lock (lock id
`42`) prevents two concurrent workers from racing.

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| `id` | `uuid` | PK | |
| `subscription_id` | `uuid` | NOT NULL, FK → `notification_subscriptions(id)` ON DELETE CASCADE | |
| `ai_explanation_id` | `uuid` | NOT NULL, FK → `ai_explanations(id)` ON DELETE CASCADE | The change to deliver |
| `status` | `text` | NOT NULL, default `'pending'`, CHECK in `('pending','delivered','failed')` | |
| `attempts` | `integer` | NOT NULL, default `0` | |
| `last_error` | `text` | nullable | Truncated to 500 chars |
| `next_attempt_at` | `timestamptz` | NOT NULL, default `now()` | The worker only picks rows where `next_attempt_at <= now()` |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | |
| `delivered_at` | `timestamptz` | nullable | |

**Indexes:** partial index on `(status, next_attempt_at) WHERE status = 'pending'`.

### `public.acquire_notification_lock` / `release_notification_lock` (RPC)

Not tables — PostgREST-callable functions in the `public` schema that
wrap `pg_try_advisory_lock` and `pg_advisory_unlock`. They exist because
PostgREST only exposes functions in schemas it has in its `db-schemas`
config (here, `public`), not `pg_catalog`. Without this wrapper, calling
`/api/database/rpc/pg_try_advisory_lock` returns `404 PGRST202`.

```sql
public.acquire_notification_lock(arg integer) returns boolean
  language sql security definer set search_path = pg_catalog, public
public.release_notification_lock(arg integer) returns void
  language sql security definer set search_path = pg_catalog, public
```

Caller: `lib/notifications.ts:dbRpc()` with `arg = 42` (a magic number,
documented inline at the call site).

## RLS posture

RLS is enabled on `projects` and `tracked_pages` (the user-facing
read paths). The other tables (`snapshot_jobs`, `snapshots`,
`ai_explanations`, `notification_*`, `webhook_events`, `scan_schedules`,
`artifacts`) all rely on **service-role writes** by the Next.js API
routes or the cron worker, with no RLS. This is a deliberate posture
because:

- The API routes are the only entry point for user-driven writes.
- `requireSession()` in every mutating route is the access check.
- Adding RLS on the write tables would require each mutation to pass
  the owner's UUID, which `lib/scan.ts` doesn't currently track.

The audit at `docs/audits/2026-06-02-codebase-audit.md` (S-1) noted
that **until `requireSession()` is in every mutating route, RLS on
the write tables would be the only thing standing between a
malicious caller and a row insert**. The fix is in
`security/p0-fixes`; once landed, the RLS posture is safe.

## Migrations

Migrations live in `db/migrations/` and are **forward-only**. The
project does not have a migration runner; the operator runs each file
in order via the InsForge SQL editor or the CLI.

Order of application:

1. `db/migration.sql` — the seven base tables + RLS
2. `db/migrations/2026-06-02-scan-schedules.sql`
3. `db/migrations/2026-06-02-notification-tables.sql`
4. `db/migrations/2026-06-02-notification-advisory-lock.sql`

If you add a new migration, prefix the file with `YYYY-MM-DD-` and
append the file path to the list above.

## TypeScript ↔ SQL mapping

| SQL column | TypeScript field | Where |
|---|---|---|
| `projects.id` | `MemoryRoom.id` (string) | `types/index.ts:33` |
| `projects.name` | `MemoryRoom.name` | `types/index.ts:35` |
| `projects.box_root_folder_id` | `MemoryRoom.storageFolderPath` (and legacy `boxFolderId`) | `types/index.ts:38-40` |
| `tracked_pages.id` | `WatchedUrl.id` | `types/index.ts:52` |
| `tracked_pages.source_url` | `WatchedUrl.url` | `types/index.ts:54` |
| `snapshots.markdown_hash` | `PageSnapshot.contentHash` | `types/index.ts:67` |
| `ai_explanations.output_json` | `ChangeAnalysis.{severity, changeType, summary, businessInterpretation, recommendedActions, evidence}` | `types/index.ts:99-104` |
| `ai_explanations.confidence` | `ChangeAnalysis.<no field>` (not yet in the TS type) | ⚠️ open question |

The conversion functions live in `lib/insforge.ts:toMemoryRoom`,
`toWatchedUrl`, `toScanRun`, `toPageSnapshot`, `toChangeAnalysis`. Keep
them in sync when you add a column.
