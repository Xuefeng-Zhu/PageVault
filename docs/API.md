# API Reference

> **Last updated:** 2026-06-05 · view this against the current commit for accuracy.
> **Source of truth:** the route handlers under `app/api/`. This document is regenerated from the code; if a route and this spec disagree, the code wins and the spec is a bug.
> **Public contract.** This document is reviewed by a human before any breaking change ships. Edits to error codes, response shapes, or status codes are breaking.

## Table of contents

1. [Conventions](#conventions) — error envelope, auth model, owner-scoping, caching
2. [User routes](#user-routes) — `/api/rooms/**`, `/api/changes/**`
3. [Cron routes](#cron-routes) — `/api/cron/**`
4. [Auth routes](#auth-routes) — `/api/auth/**`
5. [Cross-cutting concerns](#cross-cutting-concerns) — concurrency, idempotency, rate limiting, timeouts

---

## Conventions

### Error response envelope — SETTLED

Every user-facing API route returns errors in this shape (defined in `types/index.ts:264-269`):

```ts
interface ErrorResponse {
  error: {
    code: string;     // machine-readable, UPPER_SNAKE_CASE
    message: string;  // human-readable
    field?: string;   // for validation errors, which input field failed
  };
}
```

**Status code → error code map** (use this when writing client error handlers):

| Status | When | `error.code` examples |
|---|---|---|
| 400 | Request body fails validation | `VALIDATION_ERROR`, `INVALID_CRON`, `INVALID_CHANNEL`, `INVALID_URL`, `INVALID_THRESHOLD` |
| 401 | No valid session cookie | `UNAUTHORIZED` |
| 404 | Room not found OR not owned by caller | `NOT_FOUND` |
| 500 | Unexpected server failure | `INTERNAL_ERROR`, `STORAGE_ERROR`, `DB_ERROR`, `NO_SECRET`, `SCAN_FAILED` |
| 502 | Receiver error in `POST /api/rooms/[roomId]/notifications/[id]/test` | _envelope is deviated here — see test endpoint_ |
| 503 | `CRON_SHARED_SECRET` is unset on the server (cron endpoints only) | `service_unconfigured` (bare-string, not envelope) |

> **Deviation flagged.** The cron endpoints return a bare-string shape (`{ error: 'unauthorized' }` and `{ error: 'service_unconfigured', detail }`) for operator-visibility reasons — see the cron section below. The public spec does NOT bless this as an alternative envelope. Any new user-facing route MUST use the envelope.

### Auth — three patterns in use

| Pattern | Used by | Failure response |
|---|---|---|
| `await requireSession()` from `lib/apiAuth.ts` (canonical) | `rooms/**`, `rooms/[roomId]/urls`, `rooms/[roomId]/scan`, `rooms/[roomId]/changes`, `changes/[changeId]` | `401 { error: { code: "UNAUTHORIZED", message: "Authentication required" } }` |
| `getServerSession(authOptions)` direct (legacy) | `rooms/[roomId]/schedule`, `rooms/[roomId]/notifications/**` | same envelope; same status |
| `requireCronSecret(request)` from `lib/cron-auth.ts` | `/api/cron/**` | 401 `{ error: "unauthorized" }` (mismatch) or 503 `{ error: "service_unconfigured", detail: "..." }` (unconfigured) — bare-string deviation |

> **The middleware does NOT cover `/api/*`.** Every API route must call `requireSession()` (or one of the equivalents) itself. The audit at `docs/audits/2026-06-02-codebase-audit.md` (S-1) flagged this and the fix is in `security/p0-fixes`.

### Owner scoping — 404, not 403

Every room-scoped route returns 404 (not 403) on a non-owned room. The rationale: a 403 would confirm to a probe that the room exists for another user. Two patterns in use:

- **Inline check** (used by `rooms/[roomId]`, `rooms/[roomId]/urls`, `rooms/[roomId]/scan`, `rooms/[roomId]/changes`):
  ```ts
  const room = await getRoom(roomId);
  if (!room || room.userId !== session.user.id) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Room not found' } }, { status: 404 });
  }
  ```
- **`authorizeRoom(roomId, userId)` helper** (used by `rooms/[roomId]/schedule`, `rooms/[roomId]/notifications/**`, `rooms/[roomId]/notifications/[id]/test`). The helper additionally treats a `null` `userId` as unowned, defending against a horizontal-priv-esc bug that was the audit S-1 finding.

### Caching

All routes opt out of caching with `cache: 'no-store'` on the client-side `fetch()`. Server responses are dynamic and must not be cached by intermediaries. **Same-origin only** — no CORS headers are set.

---

## User routes

### `GET /api/rooms` — list all rooms

- **Auth:** `requireSession()`
- **Handler:** `app/api/rooms/route.ts`
- **Request body:** none
- **Response (200):** `RoomWithStats[]` — see `types/index.ts:44`. Fields: `id`, `userId`, `name`, `targetName`, `category`, `storageFolderPath`, `boxFolderId`, `createdAt`, `highCount`, `mediumCount`, `lastScanAt`, `watchedUrls: string[]`.
- **Response (500):**
  ```json
  { "error": { "code": "INTERNAL_ERROR", message": "Failed to retrieve rooms" } }
  ```
- **Rate limit:** none (known gap — see "Cross-cutting concerns" below).

### `POST /api/rooms` — create a room

- **Auth:** `requireSession()`
- **Handler:** `app/api/rooms/route.ts`
- **Request body:** `CreateRoomInput` (see `types/index.ts:183`):
  ```ts
  {
    name: string;          // 1-200 chars, required
    targetName: string;    // 1-200 chars, required
    category?: string;     // 'competitor' | 'vendor' | 'policy' | 'docs' | 'custom'; default 'competitor'
    frequency?: '1' | '6' | '24' | '168';  // NEW: pre-sets the default schedule cron.
                                            //   1=hourly, 6=every 6h, 24=daily 02:00 UTC, 168=weekly Sun 02:00 UTC.
                                            //   Unrecognised → falls back to daily 02:00 UTC.
    urls?: UrlEntryInput[];  // OPTIONAL in the type; the route currently ignores this field.
                             //   To add URLs, call POST /api/rooms/[roomId]/urls after creation.
  }
  ```
- **Side effects (in order):**
  1. Validate `name` and `targetName` (`lib/validation.ts:validateRoomField`).
  2. Create an InsForge Storage folder (path = `name.toLowerCase().replace(/\s+/g, '-')`); on failure, return 500 `STORAGE_ERROR`.
  3. Insert a row in `projects` with the session's user id as `owner_id`.
  4. Create a default schedule row in `scan_schedules` (uses the `frequency` field, or daily 02:00 UTC if absent).
  5. Best-effort: register an InsForge Schedules cron entry named `pagevault-room-{roomId}` that POSTs to `${NEXT_PUBLIC_APP_URL}/api/cron/scan-room/{roomId}` with the `x-cron-secret` header. If `NEXT_PUBLIC_APP_URL` or `CRON_SHARED_SECRET` is unset, this step is skipped and a warning is logged — the room is created anyway and the per-room schedule route can retry.
- **Response (201):** bare `MemoryRoom` (NOT wrapped in `{ room: ... }`).
  ```ts
  // see types/index.ts:31
  interface MemoryRoom {
    id: string;
    userId: string | null;
    name: string;
    targetName: string;
    category: Category;
    storageFolderPath: string | null;
    boxFolderId: string | null;   // deprecated back-compat mirror of storageFolderPath
    createdAt: string;
  }
  ```
- **Response (400, validation):**
  ```json
  { "error": { "code": "VALIDATION_ERROR", "message": "...", "field": "name" } }
  ```
- **Response (500, storage folder creation failure):**
  ```json
  { "error": { "code": "STORAGE_ERROR", "message": "Failed to create storage folder for the room" } }
  ```

### `GET /api/rooms/[roomId]` — get a room's details

- **Auth:** `requireSession()` + owner check (404 on non-owner)
- **Handler:** `app/api/rooms/[roomId]/route.ts`
- **Request body:** none
- **Response (200):** `RoomDetailResponse` (see `types/index.ts:255`):
  ```ts
  {
    room: MemoryRoom;
    watchedUrls: WatchedUrl[];
    latestScan: ScanRun | null;   // derived from the most recent successful `snapshot_jobs` row
                                  // for any tracked page in this room.
                                  // Fields populated: id, roomId, status, apifyRunId,
                                  // startedAt (always null in this code path),
                                  // completedAt, errorMessage (always null).
    changes: ChangeAnalysis[];    // most recent 50
  }
  ```
- **Response (404, on missing room or non-owner):**
  ```json
  { "error": { "code": "NOT_FOUND", "message": "Room not found" } }
  ```

### `POST /api/rooms/[roomId]/urls` — add watched URLs to a room

- **Auth:** `requireSession()` + owner check
- **Handler:** `app/api/rooms/[roomId]/urls/route.ts`
- **Request body:** `AddUrlsInput` (see `types/index.ts:196`):
  ```ts
  { urls: UrlEntryInput[] }   // 1-100 entries, all-or-nothing
  ```
  Each entry: `{ url: string (http/https absolute, required), label?: string (≤200 chars), pageType?: string }`. `pageType` is normalized to one of the `PageType` enum values (`homepage | pricing | docs | changelog | careers | terms | privacy | trust | unknown`).
- **Response (201):**
  ```ts
  { urls: WatchedUrl[] }
  ```
- **Response (400):**
  ```json
  { "error": { "code": "VALIDATION_ERROR", "message": "url must be a valid absolute HTTP or HTTPS URL", "field": "url" } }
  ```

### `POST /api/rooms/[roomId]/scan` — run a manual scan

- **Auth:** `requireSession()` + owner check
- **Handler:** `app/api/rooms/[roomId]/scan/route.ts`
- **Request body:** none
- **Side effects:** calls `lib/scan.ts:runScan(room)` synchronously. The scan iterates the room's `tracked_pages`, uploads each snapshot to InsForge Storage (no mock fallback), runs the LLM call for any URL whose hash changed, and inserts a `ChangeAnalysis` row + a `notification_outbox` row per enabled subscription.
- **Response (200):** `ScanSummary` (see `types/index.ts:123`):
  ```ts
  {
    scanRunId: string;
    status: 'queued' | 'running' | 'completed' | 'failed';  // ScanStatus enum
    snapshotsCaptured: number;
    changesCreated: number;
  }
  ```
- **Response (500):**
  ```json
  { "error": { "code": "SCAN_FAILED", "message": "<error message>" } }
  ```
- **Performance note:** a room with 10 watched URLs typically completes in 30-90 seconds (most of the time is the LLM call for URLs that changed). The route is synchronous — a slow LLM holds the request open. There is no `AbortController` timeout (known gap; see "Cross-cutting concerns").

### `GET /api/rooms/[roomId]/changes` — list changes for a room

- **Auth:** `requireSession()` + owner check
- **Handler:** `app/api/rooms/[roomId]/changes/route.ts`
- **Query params:** _none honored_. The route hardcodes `limit=50`. (An earlier spec advertised a `?limit=` query param; the code does NOT honor it. If you need pagination, that's a follow-up — see "Open questions" below.)
- **Response (200):**
  ```ts
  { changes: ChangeAnalysis[] }   // most recent 50, newest first
  ```
- **Response (404):** standard NOT_FOUND envelope.

### `GET /api/rooms/[roomId]/schedule` — get the room's schedule

- **Auth:** `getServerSession` (legacy pattern) + `authorizeRoom()` helper
- **Handler:** `app/api/rooms/[roomId]/schedule/route.ts`
- **Request body:** none
- **Response (200):** _Note: this shape is different from the earlier spec. The real response is:_
  ```ts
  {
    schedule: {
      roomId: string;              // was `projectId` in an older scaffold
      cronExpression: string;
      enabled: boolean;
      insforgeScheduleId: string | null;   // the InsForge Schedules cron id
    } | null   // null when the room has no schedule row
  }
  ```
- **Response (404):** standard NOT_FOUND envelope.

### `POST /api/rooms/[roomId]/schedule` — set the room's schedule

- **Auth:** `getServerSession` + `authorizeRoom()`
- **Handler:** `app/api/rooms/[roomId]/schedule/route.ts`
- **Request body:**
  ```ts
  {
    cronExpression: string;   // 5-field cron, required when enabled
    enabled?: boolean;        // default true
  }
  ```
- **Side effects:** validates the cron expression; if `enabled`, registers or updates an InsForge Schedules cron entry (the CLI call's success becomes the persisted `insforgeScheduleId`); persists a `scan_schedules` row (PATCH if it exists, POST if not).
- **Response (200):**
  ```ts
  { schedule: { roomId, cronExpression, enabled, insforgeScheduleId } }
  ```
- **Response (400):**
  ```json
  { "error": { "code": "INVALID_CRON", "message": "cronExpression must be 5 fields" } }
  ```
- **Response (500, server-side config):**
  ```json
  { "error": { "code": "NO_SECRET", "message": "CRON_SHARED_SECRET not configured on server" } }
  ```
  or
  ```json
  { "error": { "code": "INTERNAL_ERROR", "message": "NEXT_PUBLIC_APP_URL is not configured; cannot register InsForge schedule" } }
  ```

### `DELETE /api/rooms/[roomId]/schedule` — remove the room's schedule

- **Auth:** `getServerSession` + `authorizeRoom()`
- **Handler:** `app/api/rooms/[roomId]/schedule/route.ts`
- **Request body:** none
- **Side effects:** deletes the `scan_schedules` row; best-effort deletes the matching InsForge Schedules cron entry.
- **Response:** `204 No Content` _(NOT `{ deleted: true }` as in the earlier spec — the route returns 204)_.

### `GET /api/rooms/[roomId]/notifications` — list subscriptions for a room

- **Auth:** `getServerSession` + `authorizeRoom()`
- **Handler:** `app/api/rooms/[roomId]/notifications/route.ts`
- **Request body:** none
- **Response (200):**
  ```ts
  { subscriptions: NotificationSubscription[] }
  ```
  `NotificationSubscription` (see `lib/insforge.ts`): `id`, `projectId`, `channel`, `config: { url: string, secret?: string }`, `severityThreshold: 'low' | 'medium' | 'high'`, `enabled`, `consecutiveFailures`, `createdAt`, `updatedAt`.

### `POST /api/rooms/[roomId]/notifications` — create a subscription

- **Auth:** `getServerSession` + `authorizeRoom()`
- **Handler:** `app/api/rooms/[roomId]/notifications/route.ts`
- **Request body:**
  ```ts
  {
    channel: 'webhook';    // only value supported in v1
    config: {
      url: string;         // MUST be https://
      secret?: string;     // HMAC secret, optional
    };
    severityThreshold: 'low' | 'medium' | 'high';   // default 'medium' if omitted
  }
  ```
- **Response (201):** `{ subscription: NotificationSubscription }`
- **Response (400):**
  ```json
  { "error": { "code": "INVALID_CHANNEL", "message": "Only \"webhook\" supported in v1" } }
  { "error": { "code": "INVALID_URL", "message": "url must be https" } }
  { "error": { "code": "INVALID_THRESHOLD", "message": "severityThreshold must be low|medium|high" } }
  ```
- **Response (500, DB error):**
  ```json
  { "error": { "code": "DB_ERROR", "message": "<truncated body>" } }
  ```

### `PATCH /api/rooms/[roomId]/notifications/[id]` — update a subscription

- **Auth:** `getServerSession` + `authorizeSubscription()` (room + subscription must both belong to the caller)
- **Handler:** `app/api/rooms/[roomId]/notifications/[id]/route.ts`
- **Request body:** any subset of:
  ```ts
  {
    config?: { url?: string; secret?: string };
    severityThreshold?: 'low' | 'medium' | 'high';
    enabled?: boolean;
  }
  ```
  > **Known bug, documented here for reviewers:** the route guards `severityThreshold` with `if (body.severityThreshold)`, which is falsy for the string `'low'`. A client that explicitly sets `severityThreshold: 'low'` will be silently dropped. The fix is `if (body.severityThreshold !== undefined)`; tracked for the PATCH bug-fix card.
- **Response (200):** `{ subscription: NotificationSubscription }` (re-fetched from the DB so the client sees the canonical state, not the local PATCH projection)
- **Response (500, DB error):** _envelope deviation_:
  ```json
  { "error": "db_error" }                  // bare string, not { error: { code, message } }
  { "error": "not_found_after_update" }    // ditto
  ```
  These are bugs in the route; the public spec requires the envelope. A reviewer should treat these as deviations to fix, not to bless.

### `DELETE /api/rooms/[roomId]/notifications/[id]` — delete a subscription

- **Auth:** `getServerSession` + `authorizeSubscription()`
- **Handler:** `app/api/rooms/[roomId]/notifications/[id]/route.ts`
- **Request body:** none
- **Response (200):** `{ deleted: true }`

### `POST /api/rooms/[roomId]/notifications/[id]/test` — fire a test webhook

- **Auth:** `getServerSession` + `authorizeSubscription()`
- **Handler:** `app/api/rooms/[roomId]/notifications/[id]/test/route.ts`
- **Request body:** none
- **Side effects:** sends a synthetic payload with `event: 'change.detected'` to the subscription's URL.
- **Response (200, on success):**
  ```ts
  { ok: true }
  ```
- **Response (502, on receiver error):**
  ```ts
  { ok: false, error: string }
  ```
  The 502 status is intentional — the receiver is the upstream that failed, not the API. Body shape is `{ ok, error? }`, not the standard envelope; this is a per-route response shape, not a deviation from the error envelope.

### `GET /api/changes/[changeId]` — get a change

- **Auth:** `requireSession()` + owner check via `getChangeForUser()` (joins `ai_explanations → snapshots → tracked_pages → projects → owner_id`).
- **Handler:** `app/api/changes/[changeId]/route.ts`
- **Request body:** none
- **Response (200):** `{ change: ChangeAnalysis }` (see `types/index.ts:102`).
- **Response (404):** standard NOT_FOUND envelope. Note: 404 covers both "change does not exist" and "change belongs to a room not owned by the caller" — same rationale as the room routes (no information leak).

### `GET /api/auth/[...nextauth]` — NextAuth.js endpoints

- **Auth:** NextAuth-managed.
- **Handler:** `app/api/auth/[...nextauth]/route.ts`
- **Notes:** Proxies `/api/auth/signin`, `/api/auth/signout`, `/api/auth/callback/*`, `/api/auth/session`, `/api/auth/csrf`, `/api/auth/providers` through to NextAuth. The credentials provider is configured in `lib/auth.ts`. The CSRF token must accompany POST requests to `/api/auth/signin` and `/api/auth/callback/*`.

---

## Cron routes

> **Auth deviation (flagged):** the cron endpoints use `requireCronSecret(request)` from `lib/cron-auth.ts` and return a **bare-string** error shape, not the public envelope. The deviation exists because the cron endpoints are operator-only and we want a clear signal for `CRON_SHARED_SECRET` not being set (503) distinct from "wrong secret" (401) distinct from a stack-trace leak (500). The 503 path is from the MEDIUM-1 fix in `docs/qa-bug-hunt.md`.
>
> Cron response shapes (success) DO use the envelope or a documented per-route shape, not bare strings.

### `POST /api/cron/scan-all` — run all enabled scheduled scans

- **Auth:** `x-cron-secret` header matches `process.env.CRON_SHARED_SECRET` (constant-time).
- **Handler:** `app/api/cron/scan-all/route.ts`
- **Request body:** none.
- **Behaviour:** fetches all `scan_schedules` rows where `enabled = true`; runs up to 3 scans concurrently (MAX_CONCURRENT in `lib/scan.ts`); updates `last_run_at` best-effort.
- **Response (200, happy path):**
  ```ts
  {
    scanned: number;   // count of results returned
    results: Array<{
      roomId: string;
      scanRunId?: string;       // present when status === 'completed'
      status: 'completed' | 'failed' | 'skipped' | ScanStatus;
      snapshotsCaptured?: number;
      changesCreated?: number;
      reason?: string;         // when status === 'skipped' (e.g. 'room_not_found')
      error?: string;          // when status === 'failed'
    }>;
  }
  ```
  When no schedules are enabled: `{ scanned: 0, results: [] }`.
- **Response (401, wrong / missing secret):**
  ```json
  { "error": "unauthorized" }            // bare string, NOT the envelope
  ```
- **Response (503, server-side secret unset):**
  ```json
  { "error": "service_unconfigured", "detail": "CRON_SHARED_SECRET is not set on the server" }
  ```
- **Response (500, DB error fetching schedules):**
  ```json
  { "error": "db_error" }
  ```

### `POST /api/cron/scan-room/[roomId]` — per-room scheduled scan tick

> _NEW endpoint (not in the earlier spec)._ Added so each room can have its own cron cadence without a bulk-tick amplifier. The InsForge Schedules entry per room is `pagevault-room-{roomId}` and targets this route.

- **Auth:** `x-cron-secret` header.
- **Handler:** `app/api/cron/scan-room/[roomId]/route.ts`
- **Request body:** none.
- **Behaviour:** looks up the room; looks up the matching enabled `scan_schedules` row (gates the scan); calls `runScan(room, { triggerType: 'schedule' })`; awaits the `last_run_at` update.
- **Response (200, scan ran):**
  ```ts
  {
    roomId: string;
    scanRunId: string;
    status: ScanStatus;
    snapshotsCaptured: number;
    changesCreated: number;
    wrapperStatus: 'ok';
  }
  ```
- **Response (200, room has no enabled schedule):**
  ```ts
  { roomId: string; wrapperStatus: 'skipped'; reason: 'no_enabled_schedule' }
  ```
- **Response (404, room not found):**
  ```json
  { "error": "room_not_found", "roomId": "<id>" }
  ```
- **Response (500, scan failed):**
  ```ts
  { roomId: string; wrapperStatus: 'failed'; error: string }
  ```
- **Response (500, DB lookup failed):**
  ```ts
  { roomId: string; wrapperStatus: 'failed'; reason: 'db_lookup_failed' | 'room_lookup_failed'; error: string }
  ```
  The 5xx distinction is intentional: `room_lookup_failed` is the `projects` table failing, `db_lookup_failed` is the `scan_schedules` table failing.
- **Response (401, 503):** same as `scan-all` above.

### `POST /api/cron/notification-worker` — drain the notification outbox

- **Auth:** `x-cron-secret` header.
- **Handler:** `app/api/cron/notification-worker/route.ts`
- **Request body:** none.
- **Behaviour:** calls `drainOutbox(50)`. The drain is gated by a Postgres advisory lock (id 42) so only one worker runs at a time. The MEDIUM-3 fix in `docs/qa-bug-hunt.md` added the explicit 5xx path for RPC failures.
- **Response (200, healthy tick):**
  ```ts
  {
    acquired: boolean;   // true if this worker got the lock; false if a peer holds it
    processed: number;   // outbox rows picked up
    succeeded: number;   // delivered
    failed: number;      // failed (attempts incremented, retried next tick or marked dead)
  }
  ```
- **Response (500, RPC outage):** the full `DrainResult` is returned with `error` set:
  ```ts
  { acquired: true, processed: 0, succeeded: 0, failed: 0, error: string }
  ```
  (The `acquired: true` flag distinguishes "we attempted to acquire" from "another worker has the lock" — both are valid healthy outcomes, only the `error` field signals an outage.)
- **Response (401, 503):** same as `scan-all` above.

---

## Cross-cutting concerns

### Concurrency

- `POST /api/cron/scan-all` runs up to 3 rooms concurrently (MAX_CONCURRENT).
- `POST /api/cron/scan-room/[roomId]` is a single-room tick.
- `POST /api/cron/notification-worker` uses a Postgres advisory lock (id 42); only one worker drains at a time. The loser returns `{ acquired: false, processed: 0, succeeded: 0, failed: 0 }` without doing work.

### Idempotency

- **Manual scan** (`POST /api/rooms/[roomId]/scan`) is intentionally non-idempotent. A user clicking "Run scan" twice in quick succession creates two `snapshot_jobs` rows. Hash-dedup in `lib/scan.ts:runScan` prevents the LLM cost but both jobs are recorded.
- **Outbox delivery** is at-least-once. A webhook receiver that responds 5xx gets the same payload again. Receivers MUST be idempotent — use the `change.id` field as a dedup key.
- **Cron endpoints** are idempotent (re-running on the same tick is harmless; the work is gated by the lock or the schedule-row state).

### Rate limiting

There is no rate limiting on the user-facing API routes. The cron endpoints are protected by the shared secret only. The audit at `docs/audits/2026-06-02-codebase-audit.md` flagged this as a follow-up item but it is not P0 for the beta.

### Timeouts

- `lib/scan.ts:crawlOne()` uses the default `fetch` timeout (no `AbortController`). A slow target will hold the request open. A 30s-per-URL timeout is in the backlog.
- The LLM call uses a 1500-token max output but no read timeout. Same caveat.

These are not P0 because the dev server is single-tenant and a slow scan blocks only the requesting user.

### Open questions

1. **Pagination on `GET /api/rooms/[roomId]/changes`** — currently hardcoded `limit=50`. A `?limit=` and `?before=` query-param interface is the obvious follow-up; not yet specced.
2. **Envelope compliance audit** — the cron routes intentionally deviate; the `PATCH /api/rooms/[roomId]/notifications/[id]` route has accidental deviations (`{ error: "db_error" }` bare string). Both should converge to the envelope in a follow-up.
3. **`POST /api/rooms` `urls` field** — the `CreateRoomInput` type accepts `urls?: UrlEntryInput[]` but the route ignores it. Either the type should be narrowed or the route should honour it; the latter is the path of least surprise for the client.

---

## See also

- `docs/openapi.yaml` — machine-readable OpenAPI 3.1 spec for these endpoints.
- `docs/stories.md` — the 15 user stories this spec satisfies.
- `docs/STORY_TO_API.md` — the explicit story → endpoint mapping.
- `docs/story-traceability.md` — the broader card-level traceability (PM-owned).
- `docs/ARCHITECTURE.md` — system view, module boundaries, and data flow.
- `docs/DATA_MODEL.md` — table schemas, FKs, and RLS policies.
- `types/index.ts` — the source-of-truth TypeScript shapes for all response bodies.
