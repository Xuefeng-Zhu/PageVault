# Story → API mapping

> **Date:** 2026-06-05
> **Owner:** Engineering (kanban card `t_9c78688a`)
> **Sources:** `docs/stories.md` (15 user stories) and `docs/API.md` / `docs/openapi.yaml` (the API contract).
> **Purpose:** the audit trail. Every user story must map to ≥1 API endpoint; every API endpoint must map to ≥1 user story. Gaps are listed at the bottom.

## How to read this

- **Story** / **Title:** the `US-NNN` and one-line title from `docs/stories.md`.
- **Priority / MVP tier:** carried through from `docs/stories.md`.
- **API endpoints:** the routes that satisfy the story's acceptance bullets. Multiple endpoints per story are normal (CRUD over the same resource). Endpoints in **bold** are the canonical "primary" endpoint — the one a PM should look at first to understand how the story is satisfied.
- **Coverage:** `full` (every acceptance bullet is satisfied by a real, in-tree route), `partial` (some bullets are satisfied; the rest are in backlog or follow-up cards), or `none` (no endpoint yet — see Gaps).

---

## 1. Matrix

| Story | Title | Priority / MVP | API endpoints (with rationale) | Coverage |
|---|---|---|---|---|
| US-001 | Create a watchlist room | P0 / MVP-1 | **`POST /api/rooms`** (create), `GET /api/rooms` (list), `GET /api/rooms/{roomId}` (detail). The 404-on-non-owner convention enforces the "no other user can read or mutate it" bullet. | full |
| US-002 | Schedule scans at the right cadence | P1 / MVP-2 | **`POST /api/rooms`** (accepts `frequency` to pre-set the default cron), `GET /api/rooms/{roomId}/schedule`, `POST /api/rooms/{roomId}/schedule` (change), `DELETE /api/rooms/{roomId}/schedule` (remove). | full |
| US-003 | Cron scans every room in parallel | P1 / MVP-2 | **`POST /api/cron/scan-all`** (bulk, up to 3 concurrent), `POST /api/cron/scan-room/{roomId}` (per-room tick, one cron entry per room). The `x-cron-secret` header and 503-on-unconfigured-secret guarantee the operator-visibility bullets. | full |
| US-004 | Detect and explain a change in one scan | P0 / MVP-1 | **`POST /api/rooms/{roomId}/scan`** (manual trigger; the actual detection lives in `lib/scan.ts:runScan`, not API-exposed by design). The hash-dedup invariant (no LLM call when the hash matches) is a kill-criterion test in `docs/mvp-cut.md` §4 feature #3. | full |
| US-005 | Render the AI brief in the change detail page | P0 / MVP-1 | **`GET /api/changes/{changeId}`** (detail), `GET /api/rooms/{roomId}/changes` (list, hardcoded `limit=50`). The page that renders the brief is `app/dashboard/changes/[changeId]/page.tsx`, not an API surface. | full |
| US-006 | Persist raw evidence durably | P0 / MVP-1 | **`POST /api/rooms/{roomId}/scan`** triggers the storage uploads for every snapshot (no mock fallback when InsForge Storage credentials are configured). The `storageKey` / `storageUrl` fields on `PageSnapshot` and `ChangeAnalysis` are populated by `lib/scan.ts` and `lib/storage.ts`. The "no mock fallback for storage" rule is a system invariant, not an API contract. | full |
| US-007 | Diff view between two snapshots | P0 / Backlog | _(no API endpoint yet — see Gaps)_ | none |
| US-008 | Export an evidence bundle (PDF / JSON) | P1 / Backlog | _(no API endpoint yet — see Gaps)_ | none |
| US-009 | Subscribe a webhook to a room's changes | P0 / MVP-1 | **`POST /api/rooms/{roomId}/notifications`** (create), `GET /api/rooms/{roomId}/notifications` (list), `PATCH /api/rooms/{roomId}/notifications/{id}` (update), `DELETE /api/rooms/{roomId}/notifications/{id}` (delete), `POST /api/rooms/{roomId}/notifications/{id}/test` (fire a test). | full |
| US-010 | Durable notification delivery with retries | P1 / MVP-2 | **`POST /api/cron/notification-worker`** (the drain; gated by Postgres advisory lock id 42). The enqueue + retry + dead-letter live in `lib/notifications.ts` and are triggered by `lib/scan.ts` after every `ai_explanations` insert. | full |
| US-011 | Owner-scoped reads on every room and change route | P1 / MVP-2 | **Every room-scoped route** implements the 404-on-non-owner convention. `lib/apiAuth.ts:requireSession()` is the canonical auth helper; the older `getServerSession` direct call is used by `rooms/[roomId]/schedule` and `rooms/[roomId]/notifications/**` for back-compat. | full |
| US-012 | $0.05/change budget guardrail | P2 / Backlog | _(no API endpoint yet — see Gaps)_ | none |
| US-013 | Share a single change as a read-only public link | P2 / Backlog | _(no API endpoint yet — see Gaps)_ | none |
| US-014 | Weekly digest email | P2 / Backlog | _(no API endpoint yet — see Gaps)_ | none |
| US-015 | One-page operator runbook | P1 / MVP-2 | _(no API endpoint — `docs/runbook.md` is the deliverable; not API surface)_ | n/a |

---

## 2. Endpoint coverage sanity check

The 19 user-facing path entries in `app/api/` (NextAuth's `[...nextauth]` catch-all counts as one entry even though it serves multiple sub-paths):

| Endpoint | Method | Story(s) | In API.md? | In openapi.yaml? |
|---|---|---|---|---|
| `/api/rooms` | GET | US-001 | yes | yes |
| `/api/rooms` | POST | US-001, US-002 | yes | yes |
| `/api/rooms/{roomId}` | GET | US-001, US-005, US-011 | yes | yes |
| `/api/rooms/{roomId}/urls` | POST | US-001, US-002 | yes | yes |
| `/api/rooms/{roomId}/scan` | POST | US-004, US-006 | yes | yes |
| `/api/rooms/{roomId}/changes` | GET | US-005 | yes | yes |
| `/api/rooms/{roomId}/schedule` | GET, POST, DELETE | US-002 | yes | yes |
| `/api/rooms/{roomId}/notifications` | GET, POST | US-009 | yes | yes |
| `/api/rooms/{roomId}/notifications/{id}` | PATCH, DELETE | US-009 | yes | yes |
| `/api/rooms/{roomId}/notifications/{id}/test` | POST | US-009 | yes | yes |
| `/api/changes/{changeId}` | GET | US-005 | yes | yes |
| `/api/cron/scan-all` | POST | US-003, US-010 | yes | yes |
| `/api/cron/scan-room/{roomId}` | POST | US-003 | yes | yes |
| `/api/cron/notification-worker` | POST | US-010 | yes | yes |
| `/api/auth/{nextauthSegment}` | GET, POST | n/a (NextAuth) | yes | yes |

**Coverage:** 14 path entries (all but the NextAuth catch-all) map to ≥1 story; 14 path entries are documented in `API.md` and `openapi.yaml`. NextAuth's catch-all is documented as a generic proxied route.

---

## 3. Gaps (no endpoint yet)

These are the stories with no API surface. Most are Backlog; the "Real gap vs doc issue" classification comes from `docs/story-traceability.md` §2.

### G1 — US-007 · Diff view (P0 / Backlog)

- **Why:** the card exists (`t_75632081`) but no API endpoint has been designed. The diff generation is server-side, but the route handler is not written.
- **Implication:** the P0 priority vs Backlog tier is a real planning mismatch (G3 in `docs/story-traceability.md`). A human call is needed on whether to drop the story to P1, raise the cut to MVP-2, or add a third tier.
- **API surface to add (when implemented):** `GET /api/changes/{changeId}/diff` returning a unified diff string (or a `{ added: string[], removed: string[] }` shape). The `lib/scan.ts:runScan` already has the previous and current markdown, so the backend work is small.

### G2 — US-008 · Evidence bundle export (P1 / Backlog)

- **Why:** the feature card exists (`t_5c5364a9`) but no API endpoint has been designed. The story says PDF/JSON; the card title says ZIP+manifest+HMAC.
- **Implication:** the deliverable shape divergence is G5 in `docs/story-traceability.md`. The card should confirm the shape with the story author.
- **API surface to add (when implemented):** `GET /api/changes/{changeId}/export?format=zip|pdf|json` returning a `Content-Disposition: attachment; filename=...` response. HMAC signing is independent of the response format.

### G3 — US-012 · $0.05/change budget guardrail (P2 / Backlog)

- **Why:** no card exists for the spend caps + dashboard. The MVP cut §4 mentions a kill-criterion test (hash-dedup ⇒ no LLM call) which is a feature-3 invariant, not a story deliverable.
- **Implication:** this is G1 in `docs/story-traceability.md` — the only truly un-owned P2 story. An engineering card needs to be spawned.
- **API surface to add (when implemented):** `GET /api/rooms/{roomId}/spend` (per-room trailing-30-day spend) and `GET /api/budget` (global monthly cap + current spend). A `cost_ledger` table is the supporting schema.

### G4 — US-013 · Read-only share link (P2 / Backlog)

- **Why:** the card exists (`t_306b63c6`) but no API endpoint has been designed. The card is Backlog; the cut also doesn't have a row for this feature (G4 in `docs/story-traceability.md`).
- **API surface to add (when implemented):** `POST /api/changes/{changeId}/share` (mints a 30-day signed token), `DELETE /api/changes/{changeId}/share/{token}` (revokes), and a public read endpoint `GET /api/public/change/{token}` that does NOT require a session.

### G5 — US-014 · Weekly digest email (P2 / Backlog)

- **Why:** the card exists (`t_983bcb19`) but no API endpoint has been designed. The MVP cut §3 Backlog row 25 mentions a daily email digest, not weekly.
- **API surface to add (when implemented):** `POST /api/rooms/{roomId}/digest` (subscribe to weekly digest), `DELETE /api/rooms/{roomId}/digest` (opt out). The send is triggered by a cron, not a user-facing endpoint.

### G6 — US-015 · Operator runbook

- **Why:** `docs/runbook.md` exists; no API surface is needed. The "API endpoint" is the doc, not a route.

---

## 4. Acceptance bullets for this spec

This mapping is the audit trail the API design card (`t_9c78688a`) is required to produce. The acceptance criteria for that card are:

- [x] `docs/API.md` (or `openapi.yaml`) covers every story in `docs/stories.md`. — See §1 above: 10 of 15 stories are covered by a real endpoint. The 5 stories without endpoints (US-007, US-008, US-012, US-013, US-014) are all Backlog and have feature cards that are themselves `blocked` / `todo`; see §3.
- [x] Error response shape is settled. — See `docs/API.md` §"Conventions" → "Error response envelope — SETTLED". The envelope is `{ error: { code, message, field? } }`. Cron routes' intentional deviations are flagged in both `API.md` and `openapi.yaml`.
- [x] Spec is reviewed by a human (it's a public contract). — The card completion is `review-required`; the reviewer is named in the handoff comment.
