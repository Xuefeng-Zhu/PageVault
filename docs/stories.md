# PageVault User Stories

> **Date:** 2026-06-05
> **Owner:** Engineering (kanban card `t_9c78688a`)
> **Source:** `docs/story-traceability.md` (PM card `t_bd0007e7`) and `docs/mvp-cut.md` §3.
> **Purpose:** canonical product-readable list of what the system does for its users. Engineering specs (API.md, openapi.yaml) trace back to the story ids in this file.

## How to read this

- **Id:** `US-NNN`. Stable across the PRD, the API spec, and the kanban board.
- **Title:** one-line summary, used in the dashboard and the share cards.
- **Priority:** `P0` (must ship in beta), `P1` (must ship in v1), `P2` (backlog / nice-to-have).
- **MVP tier:** `MVP-1` (in the first release cut), `MVP-2` (in the second cut), `Backlog` (no cut yet).
- **As a / I want / so that:** the user-voice line, used in product reviews and customer-facing docs.
- **Acceptance:** the testable bullet list. Every bullet is a unit test, a Playwright step, or a manual QA check.
- **Implementation notes:** the existing modules, tables, and API endpoints that satisfy the bullets. If a story has no implementation notes, it has not been built yet.

Priority and MVP tier sometimes disagree (a P0 story can still be Backlog if no cut has picked it up). Both fields are intentional; the gap is recorded in `docs/story-traceability.md` §2.

---

## US-001 — Create a watchlist room (competitor-watcher)

- **Priority:** P0 · **MVP tier:** MVP-1
- As a product marketer I want to name a target (a competitor, a vendor, a regulator) and pick the pages I want watched so that every change on those pages is captured automatically.
- **Acceptance:**
  - The "new room" form accepts `name`, `targetName`, `category`, and 1–100 seed URLs.
  - The created room returns a unique `id` and a `storageFolderPath` in InsForge Storage.
  - The room appears in `GET /api/rooms` immediately after creation.
  - A default scan schedule is created on the room (cadence honours the wizard's frequency selection; falls back to daily 02:00 UTC).
  - The owner of the room is the signed-in user; no other user can read or mutate it.
- **Implementation:** `POST /api/rooms`, `GET /api/rooms`, `GET /api/rooms/[roomId]`. Owner scoping via `lib/apiAuth.ts:requireSession()` + the `room.userId === session.user.id` check.

## US-002 — Schedule scans at the right cadence

- **Priority:** P1 · **MVP tier:** MVP-2
- As a product marketer I want to pick a scan cadence (manual / hourly / every 6h / daily / weekly) so that the room's changes are captured on a schedule I control.
- **Acceptance:**
  - The room form's frequency picker maps to a 5-field cron expression: `0 * * * *` (hourly), `0 */6 * * *` (6h), `0 2 * * *` (daily 02:00 UTC), `0 2 * * 0` (weekly Sunday 02:00 UTC).
  - The room's schedule row is created on room creation and visible via `GET /api/rooms/[roomId]/schedule`.
  - The schedule can be changed (`POST`) and removed (`DELETE`) at any time.
  - When a schedule is enabled, an InsForge Schedules cron entry is registered that POSTs to `/api/cron/scan-room/[roomId]`.
- **Implementation:** `frequencyToCronExpression` in `lib/validation.ts`; `POST /api/rooms` (accepts `frequency`); `GET/POST/DELETE /api/rooms/[roomId]/schedule`.

## US-003 — Cron scans every room in parallel

- **Priority:** P1 · **MVP tier:** MVP-2
- As the solo operator I want the scheduled scan to fire automatically and in parallel so that one slow room does not block the others.
- **Acceptance:**
  - Every enabled room has an InsForge Schedules cron entry named `pagevault-room-{roomId}` that posts to `/api/cron/scan-room/[roomId]` with the `x-cron-secret` header.
  - The per-room tick scans only the specified room; up to 3 rooms run concurrently if a bulk tick is also configured.
  - When `CRON_SHARED_SECRET` is unset, cron endpoints return 503 (operator misconfig), not 401 (which would suggest a probe).
  - The bulk tick `POST /api/cron/scan-all` returns `{ scanned, results: [...] }` and skips rooms with no enabled schedule.
- **Implementation:** `POST /api/cron/scan-room/[roomId]`, `POST /api/cron/scan-all`. Auth via `lib/cron-auth.ts:requireCronSecret()` (discriminated 401/503).

## US-004 — Detect and explain a change in one scan

- **Priority:** P0 · **MVP tier:** MVP-1
- As a product marketer I want the system to crawl every watched URL, hash the result, and run an LLM comparison against the previous snapshot so that I see a human-readable explanation of every change.
- **Acceptance:**
  - A manual scan completes within 90 seconds for a room with 10 watched URLs (most of the time is the LLM call for URLs whose hash changed).
  - When the content hash matches the previous snapshot, no LLM call is made and no `ChangeAnalysis` row is created (the hash-dedup invariant).
  - When the hash differs, a `ChangeAnalysis` row is created with `severity`, `changeType`, `summary`, `businessInterpretation`, and `recommendedActions`.
  - Raw evidence (the markdown / text) is uploaded to InsForge Storage on every snapshot — there is no mock fallback for storage when credentials are configured.
- **Implementation:** `POST /api/rooms/[roomId]/scan`; the detection itself lives in `lib/scan.ts:runScan` (not API-exposed). The hash-dedup invariant is a kill-criterion test in `docs/mvp-cut.md` §4 feature #3.

## US-005 — Render the AI brief in the change detail page

- **Priority:** P0 · **MVP tier:** MVP-1
- As a product marketer I want to click into a change and see the AI brief, the evidence, and the recommended actions so that I can decide whether to act.
- **Acceptance:**
  - The change detail page renders the AI summary, severity badge, evidence list (before/after text snippets), and recommended actions.
  - The list view (`/api/rooms/[roomId]/changes`) returns the most recent 50 changes for the room, newest first.
  - A non-owner of the room receives a 404 on the change detail endpoint (no information leak).
- **Implementation:** `GET /api/changes/[changeId]`, `GET /api/rooms/[roomId]/changes`. The page is `app/dashboard/changes/[changeId]/page.tsx`. Owner scoping is enforced in the data layer via `getChangeForUser()`.

## US-006 — Persist raw evidence durably

- **Priority:** P0 · **MVP tier:** MVP-1
- As a product marketer I want every snapshot and every change report to be stored in InsForge Storage with a public URL so that the evidence is auditable and shareable.
- **Acceptance:**
  - Every `PageSnapshot` row has `storageKey` and `storageUrl` populated; legacy `boxFileId` is mirrored for back-compat.
  - Every `ChangeAnalysis` row has `storageKey` and `storageUrl` for the change report markdown; legacy `reportBoxFileId` is mirrored.
  - When InsForge Storage is configured and a write fails, the error propagates as a `BoxSystemError` and the scan fails — there is no silent mock fallback.
  - When InsForge Storage credentials are absent, the system runs in demo mode and the storage fields are `null`.
- **Implementation:** `lib/storage.ts:createStorageFolder()` is called from `POST /api/rooms`. Snapshot uploads happen in `lib/scan.ts:runScan` for every crawl. The "no mock fallback for storage" rule is documented in `AGENTS.md` under "Credential-Driven Mock Fallback".

## US-007 — Diff view between two snapshots (unified, +/- markers)

- **Priority:** P0 · **MVP tier:** Backlog
- As a product marketer I want to see a unified diff (red minus / green plus) between the previous and current snapshot on the change detail page so that I can scan what changed at a glance.
- **Acceptance:**
  - The change detail page renders a unified diff between the two snapshots using a library like `diff` (npm).
  - The diff is generated server-side and shipped as a string; the client renders it without further computation.
- **Implementation:** _no API endpoint yet_. The component card is `t_75632081` [Feature] Diff view component (US-007) and is `blocked`. Story priority P0 vs cut tier Backlog is a known mismatch (G3 in `docs/story-traceability.md`).

## US-008 — Export an evidence bundle (PDF / JSON) for a change

- **Priority:** P1 · **MVP tier:** Backlog
- As a product marketer I want to download a single file containing the change metadata, the AI brief, the unified diff, and the base64-encoded snapshots so that I can hand the evidence bundle to a colleague or attach it to a CRM note.
- **Acceptance:**
  - The export endpoint returns a ZIP with `manifest.json` (metadata + AI brief + diff) and `evidence/` (the two snapshot files), HMAC-signed with the project's notification secret.
  - The export is generated on demand and is not cached.
- **Implementation:** _no API endpoint yet_. The feature card is `t_5c5364a9` [Feature] Evidence bundle export (US-008), Backlog. Story says PDF/JSON; the card ships ZIP+manifest+HMAC. The shape divergence is G5 in `docs/story-traceability.md`.

## US-009 — Subscribe a webhook to a room's changes

- **Priority:** P0 · **MVP tier:** MVP-1
- As a product marketer I want to register a webhook URL with a severity threshold so that my downstream tool (Slack, Linear, PagerDuty) is notified when a high-severity change is detected.
- **Acceptance:**
  - A subscription has `channel: 'webhook'`, `config.url` (must be `https://`), optional `config.secret` (HMAC), and `severityThreshold` (low / medium / high).
  - Subscriptions are listed, created, patched (threshold / enabled / config), and deleted via the API.
  - A "send a test" endpoint POSTs a synthetic payload to the configured URL and returns `{ ok: true }` or `{ ok: false, error }` with 502 on receiver failure.
- **Implementation:** `GET/POST /api/rooms/[roomId]/notifications`, `PATCH/DELETE /api/rooms/[roomId]/notifications/[id]`, `POST /api/rooms/[roomId]/notifications/[id]/test`.

## US-010 — Durable notification delivery with retries

- **Priority:** P1 · **MVP tier:** MVP-2
- As the solo operator I want every notification to be delivered at-least-once with retries and a dead-letter so that a transient receiver outage does not lose any change alerts.
- **Acceptance:**
  - The scan pipeline enqueues one `notification_outbox` row per subscription per change after the AI explanation is inserted.
  - A cron worker (`/api/cron/notification-worker`) drains the outbox every minute; the drain is gated by a Postgres advisory lock (id 42) so only one worker runs at a time.
  - A receiver that returns 5xx gets the same payload again on the next tick; the `attempts` counter increments and the row is marked `dead` after the configured max attempts.
  - When the lock RPC endpoint is down, the worker returns 503 so operator alerting can fire.
- **Implementation:** `POST /api/cron/notification-worker`, `enqueueNotification` and `drainOutbox` in `lib/notifications.ts`. The MEDIUM-3 fix (`docs/qa-bug-hunt.md`) is what made the 503 path reliable.

## US-011 — Owner-scoped reads on every room and change route

- **Priority:** P1 · **MVP tier:** MVP-2
- As a security-conscious operator I want every room-scoped route to enforce that only the owner can read or mutate so that a horizontal-privilege-escalation probe returns no information.
- **Acceptance:**
  - Every room-scoped route calls `requireSession()` (or `getServerSession`) and rejects unauthenticated calls with 401.
  - On a non-owned room, every route returns 404 (NOT 403) so the response does not confirm the room exists.
  - The `lib/apiAuth.ts:requireSession()` helper is the canonical pattern; routes that use `getServerSession` directly are legacy and converging.
  - A negative test exists for the cross-user read case (in the testing card, not in this card).
- **Implementation:** `lib/apiAuth.ts:requireSession()`; the 404-on-non-owner check appears inline in the `rooms/[roomId]/**` routes and as `authorizeRoom()` in the schedule + notifications routes. Audit S-1 from `docs/audits/2026-06-02-codebase-audit.md` is what motivated this card.

## US-012 — Stay under the $0.05/change budget guardrail

- **Priority:** P2 · **MVP tier:** Backlog
- As the solo operator I want per-room monthly spend caps (default $5) and a global monthly cap (default $50) so that a runaway LLM cascade does not blow the operating budget.
- **Acceptance:**
  - A `cost_ledger` table records every LLM call (room id, change id, tokens in/out, USD cost).
  - When a room's trailing-30-day spend hits its cap, scans still run but skip the LLM call and surface a "budget exhausted" warning.
  - The dashboard shows a sparkline of the last 30 days' spend per room and a global total.
  - The hard kill-criterion (hash-dedup ⇒ no LLM call, from `docs/mvp-cut.md` §4 feature #3) is tested in CI.
- **Implementation:** _no API endpoint yet_. This is G1 in `docs/story-traceability.md` — the story exists, the cut implies it, but no engineering card owns the spend caps + dashboard surface.

## US-013 — Share a single change as a read-only public link

- **Priority:** P2 · **MVP tier:** Backlog
- As a product marketer I want to share a single change with a non-user (a sales engineer, a customer) via a signed token so that they can read the AI brief without signing in.
- **Acceptance:**
  - A share endpoint mints a 30-day signed token bound to a change id; the token is HMAC-signed with a server secret.
  - The public read page renders the change without exposing any other room data and never accepts the token in a cookie.
  - A revoke endpoint invalidates the token immediately.
- **Implementation:** _no API endpoint yet_. The feature card is `t_306b63c6` [Feature] Public read-only share link (US-013), Backlog. Story priority P2 vs cut tier Backlog is intentional.

## US-014 — "What changed this week" digest email

- **Priority:** P2 · **MVP tier:** Backlog
- As a product marketer I want a weekly email digest of all high-severity changes across all my rooms so that I can keep stakeholders informed without opening the app.
- **Acceptance:**
  - A weekly cron compiles the trailing-7-day high-severity changes per user and sends a digest via the configured mailer.
  - The digest includes a per-room count and a list of change summaries with deep links.
  - Users can opt out per room or globally.
- **Implementation:** _no API endpoint yet_. The feature card is `t_983bcb19` [Feature] Weekly digest email (US-014), Backlog.

## US-015 — One-page operator runbook for a solo PM

- **Priority:** P1 · **MVP tier:** MVP-2
- As the solo operator I want a one-page runbook covering alerts, incident responses, and demo bootstrap so that an on-call rotation (or a vacation handover) can keep the system healthy.
- **Acceptance:**
  - `docs/runbook.md` covers the eight standard sections: alerts, common errors, on-call rotation, rollback, demo bootstrap, credential rotation, data recovery, escalation.
  - Every alert named in the runbook has a corresponding measurable signal in `lib/log.ts` (structured logging) or in the InsForge dashboard.
  - The "demo bootstrap" section reproduces the demo seed in three steps from a fresh clone.
- **Implementation:** _no API endpoint_. `docs/runbook.md` is the deliverable; the runbook is not an API surface.

---

## Story-to-API mapping

The engineering counterpart of this file is `docs/STORY_TO_API.md` (the audit table the API spec must satisfy) and `docs/API.md` (the canonical API reference). Every story above maps to at least one endpoint in `docs/API.md`; stories with no implementation yet are listed in `docs/STORY_TO_API.md` under "Gaps (no endpoint yet)".

## Change log

- **2026-06-05** — First versioned copy on disk. 15 stories (US-001..US-015) reconstructed from `docs/story-traceability.md` (PM card `t_bd0007e7`) and `docs/mvp-cut.md` §3. The original 197-line / 19,259-byte file was reconstructed in-memory by the PM card but never persisted; this file is the durable source of truth going forward.
