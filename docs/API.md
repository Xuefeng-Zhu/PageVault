# API Reference

> **Last updated:** 2026-06-02 · view this against commit `3b0f2ca` for accuracy.
> **Source of truth:** the route handlers under [`app/api/`](../app/api/).

## Conventions

### Auth

Every route has an explicit auth check. There are three patterns:

| Pattern | Used by | Failure response |
|---|---|---|
| `await requireSession()` from `lib/apiAuth.ts` | User routes under `/api/rooms/**`, `/api/changes/**` | `401 { error: { code: "UNAUTHORIZED", message: "Authentication required" } }` |
| `requireCronSecret(request)` from `lib/cron-auth.ts` | `/api/cron/**` | `401 { error: { code: "UNAUTHORIZED", message: "Invalid cron secret" } }` |
| NextAuth's `withAuth` middleware (via `middleware.ts`) | Browser pages under `/dashboard/**` (not `/api`) | Redirect to `/login?callbackUrl=...` |

> **The middleware does NOT cover `/api/*`.** Every API route must call
> `requireSession()` itself. The audit at
> `docs/audits/2026-06-02-codebase-audit.md` (S-1) flagged this; the
> fix is in `security/p0-fixes`.

### Error envelope

All routes return errors in the same shape (defined in `types/index.ts:255`):

```ts
interface ErrorResponse {
  error: {
    code: string;        // machine-readable, UPPER_SNAKE_CASE
    message: string;     // human-readable
    field?: string;      // for validation errors, which input field failed
  };
}
```

### Caching

All routes opt out of caching with `cache: 'no-store'` on the
`fetch()` call from the client. The server responses are dynamic and
must not be cached by intermediaries.

---

## Routes

### `GET /api/rooms` — list all rooms

**Auth:** `requireSession()`
**Handler:** [`app/api/rooms/route.ts`](../app/api/rooms/route.ts)

Returns the user's rooms with stats (high-severity count, medium count,
last scan time).

**Response (200):**
```ts
type Response = RoomWithStats[];  // see types/index.ts:44
```

**Response (500):**
```json
{ "error": { "code": "INTERNAL_ERROR", "message": "Failed to fetch rooms" } }
```

---

### `POST /api/rooms` — create a room

**Auth:** `requireSession()`
**Handler:** [`app/api/rooms/route.ts`](../app/api/rooms/route.ts)

**Request body:**
```ts
interface CreateRoomInput {
  name: string;          // 1-200 chars, required
  targetName: string;    // 1-200 chars, required
  category?: string;     // 'competitor' | 'vendor' | 'policy' | 'docs' | 'custom', default 'competitor'
  urls?: UrlEntryInput[];  // 0-100 entries
}
```

**Response (201):**
```ts
{ room: MemoryRoom, createdUrls: WatchedUrl[] }
```

**Response (400, validation):**
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "field": "name" } }
```

---

### `GET /api/rooms/[roomId]` — get a room's details

**Auth:** `requireSession()`
**Handler:** [`app/api/rooms/[roomId]/route.ts`](../app/api/rooms/[roomId]/route.ts)

**Response (200):**
```ts
interface RoomDetailResponse {
  room: MemoryRoom;
  watchedUrls: WatchedUrl[];
  latestScan: ScanRun | null;
  changes: ChangeAnalysis[];
}
```

**Response (404):**
```json
{ "error": { "code": "NOT_FOUND", "message": "Room not found" } }
```

---

### `POST /api/rooms/[roomId]/urls` — add URLs to a room

**Auth:** `requireSession()`
**Handler:** [`app/api/rooms/[roomId]/urls/route.ts`](../app/api/rooms/[roomId]/urls/route.ts)

**Request body:**
```ts
interface AddUrlsInput {
  urls: UrlEntryInput[];  // 1-100 entries
}
```

Validation: each URL must be a valid `http://` or `https://` URL. The
`pageType` is normalized to one of the `PageType` enum values
(`homepage`, `pricing`, `docs`, `changelog`, `careers`, `terms`,
`privacy`, `trust`, `unknown`).

**Response (201):**
```ts
{ urls: WatchedUrl[] }
```

**Response (400):**
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "url must be a valid absolute HTTP or HTTPS URL", "field": "url" } }
```

---

### `POST /api/rooms/[roomId]/scan` — run a manual scan

**Auth:** `requireSession()`
**Handler:** [`app/api/rooms/[roomId]/scan/route.ts`](../app/api/rooms/[roomId]/scan/route.ts)

**Request body:** none.

**Response (200):**
```ts
interface ScanSummary {
  scanRunId: string;
  status: 'completed' | 'failed';
  snapshotsCaptured: number;
  changesCreated: number;
}
```

The scan runs synchronously in the route handler. A room with 10
watched URLs typically completes in 30-90 seconds (most of the time is
the LLM call for each URL that changed).

**Response (404):**
```json
{ "error": { "code": "NOT_FOUND", "message": "Room not found" } }
```

---

### `GET /api/rooms/[roomId]/schedule` — get the room's schedule

**Auth:** `requireSession()` (note: uses `getServerSession` directly
rather than `requireSession()` for back-compat)
**Handler:** [`app/api/rooms/[roomId]/schedule/route.ts`](../app/api/rooms/[roomId]/schedule/route.ts)

**Response (200):**
```ts
{
  schedule: {
    id: string;
    projectId: string;
    cronExpression: string;
    enabled: boolean;
    insforgeScheduleId: string | null;
    lastRunAt: string | null;
  } | null
}
```

---

### `POST /api/rooms/[roomId]/schedule` — set the room's schedule

**Auth:** `requireSession()`
**Handler:** [`app/api/rooms/[roomId]/schedule/route.ts`](../app/api/rooms/[roomId]/schedule/route.ts)

**Request body:**
```ts
{
  cronExpression: string;   // 5-field standard cron
  enabled?: boolean;        // default true
}
```

**Side effect:** shells out to the InsForge CLI to create or update
the underlying InsForge Schedule. The CLI call's exit code becomes the
HTTP status.

**Response (200):**
```ts
{ schedule: ScanScheduleRecord }
```

---

### `DELETE /api/rooms/[roomId]/schedule` — remove the room's schedule

**Auth:** `requireSession()`
**Handler:** same as above.

**Response (200):**
```ts
{ deleted: true }
```

---

### `GET /api/rooms/[roomId]/changes` — list changes for a room

**Auth:** `requireSession()`
**Handler:** [`app/api/rooms/[roomId]/changes/route.ts`](../app/api/rooms/[roomId]/changes/route.ts)

**Query params:**
- `limit?: number` (default 100, max 500)

**Response (200):**
```ts
{ changes: ChangeAnalysis[] }
```

---

### `GET /api/rooms/[roomId]/notifications` — list subscriptions

**Auth:** `requireSession()`
**Handler:** [`app/api/rooms/[roomId]/notifications/route.ts`](../app/api/rooms/[roomId]/notifications/route.ts)

**Response (200):**
```ts
{ subscriptions: NotificationSubscription[] }
```

---

### `POST /api/rooms/[roomId]/notifications` — create a subscription

**Auth:** `requireSession()`
**Handler:** same as above.

**Request body:**
```ts
{
  channel: 'webhook';
  config: {
    url: string;            // absolute https URL
    secret?: string;        // HMAC secret, optional
  };
  severityThreshold: 'low' | 'medium' | 'high';
}
```

**Response (201):**
```ts
{ subscription: NotificationSubscription }
```

---

### `PATCH /api/rooms/[roomId]/notifications/[id]` — update a subscription

**Auth:** `requireSession()`
**Handler:** [`app/api/rooms/[roomId]/notifications/[id]/route.ts`](../app/api/rooms/[roomId]/notifications/[id]/route.ts)

**Request body:** any subset of `{ enabled, severityThreshold, config }`.

**Response (200):**
```ts
{ subscription: NotificationSubscription }
```

---

### `DELETE /api/rooms/[roomId]/notifications/[id]` — delete a subscription

**Auth:** `requireSession()`
**Handler:** same as above.

**Response (200):**
```ts
{ deleted: true }
```

---

### `POST /api/rooms/[roomId]/notifications/[id]/test` — fire a test webhook

**Auth:** `requireSession()`
**Handler:** [`app/api/rooms/[roomId]/notifications/[id]/test/route.ts`](../app/api/rooms/[roomId]/notifications/[id]/test/route.ts)

Sends a synthetic webhook with `event: 'test.ping'` to the subscription's
URL. Returns the receiver's HTTP status (or an error string).

**Response (200):**
```ts
{
  ok: boolean;
  status: number | null;
  body: string | null;
  error?: string;
}
```

---

### `GET /api/changes/[changeId]` — get a change

**Auth:** `requireSession()`
**Handler:** [`app/api/changes/[changeId]/route.ts`](../app/api/changes/[changeId]/route.ts)

**Response (200):**
```ts
{ change: ChangeAnalysis }
```

**Response (404):**
```json
{ "error": { "code": "NOT_FOUND", "message": "Change not found" } }
```

---

### `POST /api/cron/scan-all` — run all enabled scheduled scans

**Auth:** `requireCronSecret(request)` — `x-cron-secret` header must
match `process.env.CRON_SHARED_SECRET`.
**Handler:** [`app/api/cron/scan-all/route.ts`](../app/api/cron/scan-all/route.ts)

This is the InsForge Schedule target. Configured in production via:

```bash
npx @insforge/cli schedules create scan-all \
  --cron "*/1 * * * *" \
  --target "https://<your-host>/api/cron/scan-all" \
  --method POST \
  --headers '{"x-cron-secret": "<CRON_SHARED_SECRET>"}'
```

**Request body:** none (the secret is in the header).

**Response (200):**
```ts
{
  processedSchedules: number;
  succeeded: number;
  failed: number;
  results: Array<{ projectId: string; status: string; error?: string }>;
}
```

**Response (401):**
```json
{ "error": { "code": "UNAUTHORIZED", "message": "Invalid cron secret" } }
```

---

### `POST /api/cron/notification-worker` — drain the notification outbox

**Auth:** `requireCronSecret(request)`
**Handler:** [`app/api/cron/notification-worker/route.ts`](../app/api/cron/notification-worker/route.ts)

Configured identically to `scan-all` but with a different target URL.

**Response (200):**
```ts
{
  processed: number;   // outbox rows picked up
  succeeded: number;   // delivered
  failed: number;      // failed (recorded in last_error, attempt count incremented)
}
```

> **Concurrency:** only one worker can drain at a time. The
> `acquire_notification_lock` advisory lock (id `42`) is taken at the
> start of `drainOutbox()` and released in `finally`. If another worker
> is already draining, this call returns `{processed:0, succeeded:0, failed:0}`
> without doing work.

---

### `GET /api/auth/[...nextauth]` — NextAuth.js endpoints

**Auth:** NextAuth-managed
**Handler:** [`app/api/auth/[...nextauth]/route.ts`](../app/api/auth/[...nextauth]/route.ts)

Proxies `/api/auth/signin`, `/api/auth/signout`, `/api/auth/callback/*`,
`/api/auth/session`, `/api/auth/csrf`, `/api/auth/providers` through to
NextAuth. The credentials provider is configured in
[`lib/auth.ts`](../lib/auth.ts).

---

## Cross-cutting concerns

### Idempotency

- **Manual scan** is intentionally non-idempotent. A user clicking "Run
  scan" twice in quick succession will create two `snapshot_jobs` rows.
  The hash-based dedup in `scanOne` prevents the LLM cost but both jobs
  will be recorded.
- **Outbox delivery** is at-least-once. A webhook receiver that
  responds `5xx` will get the same payload again. Receivers must be
  idempotent (use the `change.id` field as a dedup key).

### Rate limiting

There is no rate limiting on the user-facing API routes. The cron
endpoints are protected by the shared secret. The audit at
`docs/audits/2026-06-02-codebase-audit.md` flagged this as a follow-up
item but it's not a P0.

### Timeouts

- `lib/scan.ts:crawlOne()` uses the default `fetch` timeout (no
  AbortController). A slow target will hold the request open. Long-term
  we want a 30s timeout per URL.
- The LLM call uses a 1500-token max output but no read timeout. Same
  caveat.

These are not P0 because the dev server is single-tenant and a single
slow scan blocks only the requesting user.
