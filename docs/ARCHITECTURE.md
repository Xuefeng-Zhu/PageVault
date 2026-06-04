# Architecture

> **Last updated:** 2026-06-02 · view this against commit `3b0f2ca` for accuracy.
> **Pair with:** [`SYSTEM_DESIGN.md`](../SYSTEM_DESIGN.md) at the repo root —
> that doc is the design intent (Mermaid, contract examples, cost models);
> this doc is the **implementation** view (what's actually wired today).

## One-paragraph summary

PageVault is a Next.js 14 App Router application that runs scheduled web-page
scans, hashes the captured content, and asks an LLM to explain any change in
plain English. The control plane is InsForge Postgres (projects, rooms,
snapshots, change analyses, notification subscriptions, and the cron
outbox). The evidence plane is InsForge Storage (raw markdown snapshots
under `pagevault-evidence/<room>/snapshots/<date>/<file>`). The web-crawl
plane is Apify when credentials are present, or a built-in
HTML→Markdown extractor when they aren't. The LLM plane is an
OpenAI-compatible chat completions API — by default OpenRouter's
`anthropic/claude-3.5-haiku`, with `OPENAI_API_KEY` as a fallback. Two
InsForge cron jobs (`scan-all` and `notification-worker`) drive the
scheduled scan and outbound notification flows.

## The five planes

```
                        ┌─────────────────────┐
                        │      Browser        │
                        │  (Next.js RSC+CSR)  │
                        └─────────┬───────────┘
                                  │  HTTPS (Next.js route handlers)
                                  ▼
   ┌──────────────────────────────────────────────────────────────┐
   │                       Next.js App                            │
   │  ┌────────────────────┐  ┌────────────────────────────────┐  │
   │  │  app/dashboard/    │  │  app/api/                      │  │
   │  │  (RSC + client)    │  │  (route handlers)             │  │
   │  │  pages, layouts    │  │  requireSession + cron-secret  │  │
   │  └────────────────────┘  └────────┬───────────────────────┘  │
   └──────────────────────────────────┬─┴──────────────────────────┘
                                      │ SDK / fetch
        ┌─────────────────────────────┼─────────────────────────────┐
        │                             │                             │
        ▼                             ▼                             ▼
┌──────────────┐            ┌──────────────────┐         ┌──────────────────┐
│   InsForge   │            │      Apify       │         │  OpenAI-compat   │
│   Postgres   │            │   website-       │         │  Chat API        │
│  (PostgREST) │            │   content-       │         │  (OpenRouter /   │
│              │            │   crawler        │         │   OpenAI / other)│
└──────┬───────┘            └────────┬─────────┘         └────────┬─────────┘
       │                             │                            │
       │                             └─────────────┬──────────────┘
       │                                           │
       │             ┌──────────────────┐          │
       │             │  InsForge        │          │
       │             │  Storage         │          │
       │             │  (evidence)      │          │
       │             └──────────────────┘          │
       │                                          │
       │  ┌────────────────────┐                 │
       │  │ InsForge Schedules │ ←───────────────┘
       │  │ (cron triggers)    │
       │  │  /api/cron/scan-all     every 1 min
       │  │  /api/cron/notification-worker  every 1 min
       │  └────────────────────┘
       │
       ▼
   [ Webhook receiver → user's URL ]   (notification_subscriptions → notification_outbox)
```

## Component breakdown

### 1. Next.js app (`app/`, `components/`, `lib/`)

- **Pages** under `app/dashboard/` are server components that fetch via
  `/api/*` route handlers. Pages under `app/dashboard/*/[id]/page.tsx` are
  also client components because they need `useSession()` and run-scan
  buttons. See [COMPONENTS.md](COMPONENTS.md) for the visual layer.
- **Route handlers** under `app/api/` are the only place that talks to
  InsForge directly. Two auth patterns:
  - **User routes** (everything under `/api/rooms/...`, `/api/changes/...`)
    call `requireSession()` from `lib/apiAuth.ts` and 401 on failure.
  - **Cron routes** (`/api/cron/scan-all`, `/api/cron/notification-worker`)
    call `requireCronSecret(request)` from `lib/cron-auth.ts` and 401 on
    failure.
- **Middleware** (`middleware.ts`) only protects `/dashboard/*` via
  NextAuth's `withAuth`. It does **not** protect `/api/*` — that's the
  job of the route handlers' `requireSession()` calls.
- **Library layer** (`lib/`) is the business logic. See
  [COMPONENTS.md §lib](COMPONENTS.md) for the file-by-file map.

### 2. InsForge Postgres (control plane)

Seven base tables + two feature tables. Full reference in
[DATA_MODEL.md](DATA_MODEL.md). Quick map:

| Table | One-line purpose |
|---|---|
| `projects` | A user's "memory room" (a watchlist of URLs to track) |
| `tracked_pages` | One URL inside a project |
| `snapshot_jobs` | A single scan run (manual, schedule, or webhook) |
| `snapshots` | A captured page version (hash + raw markdown + metadata) |
| `artifacts` | Files in InsForge Storage linked to a snapshot (currently unused) |
| `ai_explanations` | The LLM's structured analysis of a snapshot-vs-snapshot diff |
| `webhook_events` | Idempotency log for inbound webhooks (Apify / Box) |
| `scan_schedules` | Per-project cron expression + InsForge schedule id |
| `notification_subscriptions` | Per-project outbound webhook subscriptions |
| `notification_outbox` | Durable outbox rows drained by the cron worker |

> **Note on `box_*` column names:** the schema was migrated from "Box" to
> "InsForge Storage" but column names like `box_root_folder_id`,
> `box_page_folder_id`, `box_file_id`, `report_box_file_id` are kept for
> back-compat. They now hold InsForge Storage paths/keys. Don't rename
> them in a new migration — both `lib/insforge.ts` and the legacy
> `boxFolderId`/`boxFileId` aliases depend on the names.

### 3. Apify (crawl plane)

`lib/scan.ts:crawlOne()` first tries Apify if both
`APIFY_API_TOKEN` and `APIFY_ACTOR_ID` are set, then falls back to a
direct `fetch()` + a built-in HTML→Markdown extractor. The Apify
integration is a thin shim: it calls
`https://api.apify.com/v2/acts/<ACTOR_ID>/run-sync-get-dataset-items` and
expects the actor to return cleaned markdown.

The legacy `lib/apify.ts` is **dead code** (no callers) and is scheduled
for removal in the post-P0 cleanup. Don't import from it.

### 4. LLM (explain plane)

`lib/scan.ts:callLlm()` is the only LLM caller. It:

1. Picks the key: `OPENAI_API_KEY` if it's a real key (length ≥ 30, no
   `...` placeholder), otherwise `OPENROUTER_API_KEY`.
2. Picks the base URL: `OPENAI_BASE_URL` if set, otherwise
   `https://api.openai.com/v1` for OpenAI or `https://openrouter.ai/api/v1`
   for OpenRouter.
3. Picks the model: `OPENAI_MODEL` if set, otherwise
   `anthropic/claude-3.5-haiku` (the recommended model per
   [LLM_MODEL_RESEARCH.md](LLM_MODEL_RESEARCH.md)).
4. Sends the diff (previous + current markdown excerpt) and a strict
   system prompt that asks for `response_format: { type: 'json_object' }`.
5. Validates the response against the `ChangeAnalysisResult` type and
   truncates strings to fit DB column widths.

The current model recommendation, the rationale, and the eval harness are
all in [LLM_MODEL_RESEARCH.md](LLM_MODEL_RESEARCH.md).

### 5. InsForge Storage (evidence plane)

`lib/scan.ts:uploadEvidence()` uploads the raw markdown of every new
snapshot to the `pagevault-evidence` bucket under
`<storageFolderPath>/snapshots/<YYYY-MM-DD>/snapshot-<ms>.md`. The key
and public URL are persisted on the `snapshots` row (in legacy
`box_snapshot_folder_id` for back-compat).

If the upload fails the scan still completes — the snapshot is recorded
but the evidence file is missing. This is by design: a transient
Storage outage shouldn't fail the scan. Operators see the missing file
in the change detail page.

### 6. InsForge Schedules (cron plane)

Two cron jobs configured via the InsForge CLI:

| Endpoint | Cadence | Auth | Purpose |
|---|---|---|---|
| `POST /api/cron/scan-all` | every 1 minute | `x-cron-secret` header | Iterates all enabled `scan_schedules`, runs a scan for each, updates `last_run_at`. |
| `POST /api/cron/notification-worker` | every 1 minute | `x-cron-secret` header | Drains the `notification_outbox` table. |

Both are documented in detail in [DEPLOYMENT.md](DEPLOYMENT.md) and
the implementation plan in
[plans/2026-06-02-scheduled-scans-and-notifications.md](plans/2026-06-02-scheduled-scans-and-notifications.md).

## Authentication and authorization

Three distinct auth surfaces:

| Surface | Mechanism | Source of truth |
|---|---|---|
| **Browser → dashboard pages** | NextAuth `withAuth` middleware | `middleware.ts` |
| **Browser → API routes** | `requireSession()` helper | `lib/apiAuth.ts` |
| **InsForge cron → API routes** | `x-cron-secret` header check | `lib/cron-auth.ts` |

> **The middleware does NOT cover `/api/*`.** Every API route that mutates
> or returns user data must call `requireSession()` itself. The audit in
> `docs/audits/2026-06-02-codebase-audit.md` (S-1) flagged this; the
> fix is in `security/p0-fixes`.

For the NEXTAUTH_SECRET, see [ENVIRONMENT.md](ENVIRONMENT.md) and
[SECURITY.md](../SECURITY.md). The short version: there is no
hardcoded fallback. Missing secret in production throws at startup.
Dev-only opt-in via `INSFORGE_DEV_INSECURE_SECRET=1`.

## Request lifecycle: a manual scan

1. **User clicks "Run scan"** on the room detail page. The page calls
   `POST /api/rooms/<id>/scan`.
2. The route handler calls `requireSession()` (401 on miss) and
   `getRoom(id)` from `lib/insforge.ts` (404 on miss).
3. It calls `runScan(room)` from `lib/scan.ts`.
4. `runScan` creates a `snapshot_jobs` row with `status='running'`.
5. For each watched URL, it calls `scanOne`:
   - Crawls via Apify or direct fetch
   - SHA-256-hashes the markdown
   - If hash matches the previous snapshot, skips (cost-saver)
   - Uploads markdown to InsForge Storage
   - Inserts a `snapshots` row
   - Calls the LLM with the previous + current excerpt
   - Inserts an `ai_explanations` row
6. After the loop, `scan_jobs` is updated to `status='succeeded'`.
7. `lib/scan.ts` calls `enqueueNotification()` which inserts rows into
   `notification_outbox` for each enabled subscription on the project.
8. The route handler returns `{ scanRunId, status, snapshotsCaptured, changesCreated }`.
9. **Within the next minute** the InsForge `notification-worker` cron
   picks up the outbox rows, acquires the advisory lock, and dispatches
   the webhook(s) via the `webhook` channel.

## Key design decisions

### Why a Postgres outbox instead of firing the webhook inline?

Inline webhooks fail silently when the receiver is down. An outbox + cron
worker gives us:

- **At-least-once delivery** (rows aren't deleted until `delivered`).
- **Backoff / retry** (`attempts`, `next_attempt_at` columns).
- **Failure auto-disable** (10 consecutive failures → `enabled = false`).
- **Operator visibility** (`SELECT * FROM notification_outbox WHERE
  status = 'pending'`).

### Why an advisory lock in the worker?

Two cron workers can run concurrently (InsForge doesn't guarantee a
single in-flight invocation per schedule). Without the lock they'd race
on the same outbox rows. The lock id (`42`) is a magic number; the
`acquire_notification_lock` and `release_notification_lock` functions
are wrappers around `pg_try_advisory_lock` in the `public` schema
because PostgREST doesn't expose `pg_catalog` functions directly.

### Why a content-hash cost-saver before the LLM call?

Most pages don't change between scans. Hashing the markdown and skipping
the LLM call when the hash matches the previous snapshot saves the
dominant cost of a scan. This is documented in
SYSTEM_DESIGN.md §3.3 ("cascade architecture") and validated in
[LLM_MODEL_RESEARCH.md](LLM_MODEL_RESEARCH.md).

### Why OpenRouter as the default LLM?

`anthropic/claude-3.5-haiku` via OpenRouter is the best price/quality
ratio for the structured-output extraction task that `lib/scan.ts`
performs. Full rationale, with benchmarks, is in
[LLM_MODEL_RESEARCH.md](LLM_MODEL_RESEARCH.md).

## Open architecture questions

- ⚠️ **The "Artifacts" table is currently unused.** `lib/scan.ts` doesn't
  write to it. It exists for the future case where we want to record
  per-snapshot file metadata separately from the `snapshots` row.
- ⚠️ **`webhook_events` has no writer.** The Apify webhook handler in
  `functions/apify-webhook.ts` doesn't log there. It will, once the
  inbound-webhook flow is fully wired.
- ⚠️ **The `exec()` call in `app/api/rooms/[roomId]/schedule/route.ts`**
  is a known concern. It shells out to the InsForge CLI to manage
  schedules. Long-term we want a real SDK call. See
  `docs/audits/2026-06-02-codebase-audit.md` finding S-* for the
  remediation plan.
