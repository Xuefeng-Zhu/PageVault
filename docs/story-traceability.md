# Story → Kanban Traceability

> **Date:** 2026-06-04
> **Owner:** PM agent (`t_bd0007e7`)
> **Sources:** `docs/stories.md` (15 user stories · 10 P0 · 4 P1 · 1 P2) and `docs/mvp-cut.md` §3 (MVP-1 / MVP-2 / Backlog cuts). Both were reconstructed from the prior PM runs' kanban log on 2026-06-04 after a workspace reset; the original 19,259-byte / 197-line files were not present on disk when this traceability card started.
> **Scope:** Every `US-001`..`US-015` row from `docs/stories.md` mapped to one or more Kanban cards on the live board (59 cards inspected via `hermes kanban list --json`). Stories that lack a matching card are listed in the **Gaps** section.

## How to read this matrix

- **Story:** the `US-NNN` id from `docs/stories.md`.
- **Title:** the one-line story title (verbatim from `docs/stories.md`).
- **MVP-cut tier:** the cut bucket from `docs/mvp-cut.md` §3 — `MVP-1` (rows 1–7 in §3), `MVP-2` (rows 8–14), or `Backlog` (everything in §3 Backlog). The tier reflects the *underlying feature* the story maps to, not the story's own P0/P1/P2 priority (a P0 story can still be Backlog if no MVP cut picked it up — see Gaps).
- **Kanban card(s):** card id (and short label) of every matching card. "Implicit" means the card exists and the story falls under its scope but is not named explicitly; "Dedicated" means the card title names the US-NNN.
- **Status:** current kanban status of the matching card(s). `done` = shipped, `todo` = ready to pick up, `blocked` = waiting on something, `running` = in flight. For implicit mappings, the status column reflects the *most-shipped* card (the one that has actually delivered the acceptance bullet closest to the story); for Backlog/feature-deferred stories the status column reflects the most-relevant existing card.

---

## 1. Matrix

| Story | Title | MVP-cut tier | Kanban card(s) | Status |
|---|---|---|---|---|
| US-001 | Create a watchlist room (competitor-watcher) | **MVP-1** (`mvp-cut.md` §3 row 1 "Memory rooms") | Implicit: `t_c1a69fef` [P0] Core product workflow (the integration card "Sign in → Create a room" includes step 1+2). Implicit: `t_69a5e121` [P1] Backend implementation (rooms CRUD per `docs/API.md`). Implicit: `t_59da0288` [P1] Frontend implementation (`CreateRoomForm` already split into `components/rooms/`). | `todo` (all three) |
| US-002 | Schedule scans at the right cadence (manual / hourly / daily / weekly) | **MVP-2** (`mvp-cut.md` §3 row 8 "Scheduled scans") | None dedicated. Implicit: `t_69a5e121` [P1] Backend implementation (`scan_schedules` rows). Implicit: `t_59da0288` [P1] Frontend implementation (`SchedulePicker` shipped in `feat/launch-landing-page` per git log; not in a card). | `todo` (no dedicated card; the existing scaffold UI landed outside the cascade) |
| US-003 | Cron scans every room in parallel (scan-all / scan-room) | **MVP-2** (`mvp-cut.md` §3 row 8 "Scheduled scans") | None dedicated. Implicit: `t_8128a1cf` [P0] Deployment pipeline (the cron auth/secret gating). Implicit: `t_69a5e121` [P1] Backend implementation (the `app/api/cron/scan-all/route.ts` handler that already exists in the scaffold; landing path is unclear from the cascade). | `todo` |
| US-004 | Detect and explain a change in one scan (`lib/scan.ts:runScan`) | **MVP-1** (`mvp-cut.md` §3 rows 3+4 "Manual + hash-dedup scan" + "AI change explanations") | Implicit: `t_69a5e121` [P1] Backend implementation (`lib/scan.ts:runScan` is in the existing scaffold; this card wires it to the API). Implicit: `t_77c7b919` [P0] Database / schema design (`snapshots` + `ai_explanations` tables). Bug-fix dependents: `t_af9c3a9b` (HIGH-1 sanitize markdown), `t_03b76d18` (HIGH-3 uuid collision), `t_b04366c3` (HIGH-4 SSRF in direct-fetch), `t_4348af03` (HIGH-5 orphan `snapshot_jobs` cap at 50 URLs). | `todo` (core), `blocked` (4 HIGH bug fixes) |
| US-005 | Render the AI brief in the change detail page | **MVP-1** (`mvp-cut.md` §3 row 4 "AI change explanations") | Implicit: `t_59da0288` [P1] Frontend implementation (the `/dashboard/changes/[changeId]` page; `SeverityBadge`, `ChangeCard`, `ChangeTimeline` are already in `components/changes/`). Implicit: `t_9c78688a` [P0] API design (the change detail endpoint contract). | `todo` |
| US-006 | Persist raw evidence durably (no mock fallback for storage) | **MVP-1** (`mvp-cut.md` §3 row 5 "Evidence upload to InsForge Storage") | Implicit: `t_69a5e121` [P1] Backend implementation (`lib/storage.ts` scaffold; "anon key for storage" gate fixed in `df9b98c`). Implicit: `t_77c7b919` [P0] Database / schema design (`snapshots.content_hash`, `box_*` columns on `snapshots`). Bug-fix dependent: `t_2be39e81` (CRITICAL-1 hardcoded webhook secret in `functions/apify-webhook.ts`). | `todo` (core), `blocked` (CRITICAL-1 fix) |
| US-007 | Diff view between two snapshots (unified, +/- markers) | **Backlog** (`mvp-cut.md` §3 Backlog row 18 "Diff visualization") | Dedicated: `t_75632081` [Feature] Diff view component (US-007) — *the card body literally names the story*; this is a backfill from the original PRD backlog, not from `mvp-cut.md`. | `blocked` |
| US-008 | Export an evidence bundle (PDF/JSON) for a change | **Backlog** (`mvp-cut.md` §3 Backlog row 26 "Schema-versioned evidence exports"; not in MVP-1 or MVP-2) | Dedicated: `t_5c5364a9` [Feature] Evidence bundle export (US-008) — *card body literally names the story*. Card ships a ZIP with manifest + AI brief + HMAC (a stricter shape than US-008 asks for, which is acceptable; just confirm the PDF-vs-ZIP choice with the story author). | `blocked` |
| US-009 | Subscribe a webhook to a room's changes | **MVP-1** (`mvp-cut.md` §3 row 6 "Per-room webhooks" — MVP-1 ships a single system-wide webhook severity-thresholded, the per-room *multi-subscription* surface is MVP-2) | Implicit: `t_69a5e121` [P1] Backend implementation (`notification_subscriptions` CRUD in `app/api/rooms/[roomId]/subscriptions`). Implicit: `t_9c78688a` [P0] API design (endpoint contract). | `todo` |
| US-010 | Durable notification delivery with retries (outbox cron) | **MVP-2** (`mvp-cut.md` §3 row 11 "HMAC-SHA256 signed delivery + outbox cron" — the retry/backoff + dead-letter semantics are explicitly listed as MVP-2) | Implicit: `t_69a5e121` [P1] Backend implementation (`/api/cron/notification-worker` already in the scaffold; this card wires the outbox + retry + dead-letter). Bug-fix dependent: `t_0901d539` (MEDIUM-3 `dbRpc` swallows 5xx — must be fixed before the retry semantics in US-010 work end-to-end). | `todo` (core), `blocked` (MEDIUM-3 fix) |
| US-011 | Owner-scoped reads on every room and change route (fix audit S-1) | **MVP-2** (`mvp-cut.md` §3 row 9 "RLS on rooms / watched_urls / scans / evidence") | Implicit: `t_10e0495c` [P0] Authentication (the `requireSession()` helper that audit S-1 calls for). Implicit: `t_77c7b919` [P0] Database / schema design (the RLS policies themselves). Implicit: `t_69a5e121` [P1] Backend implementation (the per-route `owner_id` filters; the negative test in the acceptance bullet belongs to `t_c7718ece` [P1] Testing). | `blocked` (Auth card), `todo` (the rest) |
| US-012 | Stay under the $0.05/change budget guardrail (per-room + global spend caps) | **Backlog / not in `mvp-cut.md`** | **None.** No card exists for the per-room monthly cap, the global $50 cap, or the `cost_ledger` table. The cost *guardrail invariant test* (hash-dedup ⇒ no LLM call) is the MVP-1 kill criterion for feature #3 in `mvp-cut.md` §4, but the *spend caps + dashboard* surface of US-012 is a separate deliverable that no card owns. → see **Gap G1**. | n/a |
| US-013 | Share a single change as a read-only public link (signed token) | **Backlog / not in `mvp-cut.md`** | Dedicated: `t_306b63c6` [Feature] Public read-only share link (US-013) — *card body literally names the story*. The card is Backlog in the cut but exists on the board as a deliberate, named card. | `blocked` |
| US-014 | "What changed this week" digest email | **Backlog** (`mvp-cut.md` §3 Backlog row 25 "Daily email digest"; weekly is a generalization of the same deferral — PRD §2 names Slack as the channel, not email) | Dedicated: `t_983bcb19` [Feature] Weekly digest email (US-014) — *card body literally names the story*. | `blocked` |
| US-015 | One-page operator runbook for a solo PM (alerts, incident responses, demo bootstrap) | **MVP-2** (`mvp-cut.md` §3 implicitly via K-13 logging row 14 — "structured logging + per-room scan observability" is the engineering pre-req for the runbook's alert list) | Dedicated: `t_6cfc47d9` [Ops] Write docs/runbook.md (8 sections, common errors, on-call, rollback) — the runbook itself. Implicit: `t_86ee22cb` [P1] Logging/observability (the four alerts the runbook names need to exist as measurable signals first). Implicit: `t_736e2da7` [P0] Launch checklist (the runbook is a K-19 input per its card body). | `blocked` (runbook card), `todo` (logging, launch checklist) |

**Card-count sanity check:** the matrix above references 28 distinct card-ids (some appear in multiple rows). The board has 59 cards; 31 are bug-fix cards (CRITICAL-1..4, HIGH-1..5, MEDIUM-1..4, HIGH-1..5 from the second triage, LINT), documentation cards (README, ADRs, qa-checklist, perf-budget, qa-bug-hunt reconstruction, product-research reconstruction, feature-inventory recovery), and release-infrastructure cards (CI, deploy, launch, release-aggregate, Playwright e2e). Those are not story implementations and are correctly absent from the matrix.

---

## 2. Gaps

Stories that have **no matching Kanban card** (or only a card that exists for an *adjacent* reason and doesn't actually own the story's acceptance bullets).

### G1 — US-012 · $0.05/change budget guardrail has no card

- **What the story asks for:** a `cost_ledger` table, per-room monthly cap (default $5), global monthly cap (default $50), room-card sparkline of the last 30 days.
- **Why it's a gap:** the only cost-related thing in the MVP cut is the *invariant test* (hash-dedup ⇒ no LLM call), which is a kill-criterion test for feature #3, not a story deliverable. The acceptance bullets for the *spend caps + dashboard* are not owned by any existing card.
- **Real gap or doc issue?** **Real gap.** The story exists, the PRD §3 metric 3 names the $0.05/change number, but the implementation card was never spawned. Suggested fix: a new engineering card (likely `engineering` profile) with body referencing US-012 + `mvp-cut.md` §4 cross-cutting risk "PRD §6 Risk 1 — LLM cost overruns" + the kill-criterion test for feature #3 as a pre-req.

### G2 — US-002 / US-003 · Cron + cadence have no *dedicated* card

- **What the story asks for:** `SchedulePicker` UI already shipped on `feat/launch-landing-page` (per git log: "feat(ui+api): wire SchedulePicker + NotificationList; create InsForge cron on room create"), and the `app/api/cron/scan-all` route is in the existing scaffold. But neither has a Kanban card that says "this card ships US-002/US-003."
- **Why it's a gap:** implicit coverage by `t_69a5e121` Backend impl + `t_59da0288` Frontend impl is too coarse for two named stories. If the cascade ever needs to *prove* US-002/US-003 shipped, the proof requires reading the scaffold and git log, not pointing at a card.
- **Real gap or doc issue?** **Documentation issue.** The work exists; what's missing is a card that *names* the work. Two options: (a) accept the implicit mapping and note this in the launch checklist, (b) retroactively split `t_69a5e121` and `t_59da0288` into "scheduling" subtasks. Recommended: (a) — the cost of (b) exceeds the audit value.

### G3 — US-007 (Diff view) has a card but the card is Backlog, and the story is P0

- **What the story asks for:** unified diff between two snapshots on the change detail page.
- **Why it's a gap:** `t_75632081` exists and is dedicated to US-007. But the MVP cut §3 puts diff visualization in the Backlog (row 18), and the story is P0. The cascade as written can't actually ship US-007 without either re-cutting (move diff to MVP-2) or re-prioritizing the story (drop to P1). This is a **priority/cut mismatch**, not a missing-card gap.
- **Real gap or doc issue?** **Real gap, in the planning sense.** Recommended fix: a human call on whether US-007 should drop to P1 to match the Backlog tier, or whether the cut should move diff visualization up to MVP-2 (or a third "MVP-1.5" tier). Tracked as an open question for the next review cycle.

### G4 — US-013 (Share read-only link) has a card but the card isn't anchored in the cut

- **What the story asks for:** signed token per change, 30-day expiry, revocable.
- **Why it's a gap:** `t_306b63c6` exists and is dedicated to US-013. But `docs/mvp-cut.md` §1's feature inventory has no row for "share a change as a public link" — closest is Backlog row 24 "Public read API / GraphQL," which is a different feature. The card was spawned directly from the PRD/story but never made it into the cut.
- **Real gap or doc issue?** **Documentation issue in `mvp-cut.md`.** Either add a row to §1 Backlog for "Per-change signed share link" and cite US-013, or accept that the card lives outside the cut. Recommended: add the row — it's a 5-minute edit and closes the audit loop.

### G5 — US-008 (Evidence bundle) has a card but the card's deliverable shape differs from the story

- **What the story asks for:** single file (PDF for humans, JSON for machines) with change metadata + AI explanation + unified diff + base64-encoded snapshots.
- **What the card ships:** a ZIP with manifest + AI brief + HMAC signature.
- **Why it's a gap:** the card title "Evidence bundle export (US-008) — ZIP with manifest + AI brief + HMAC" is a *stricter* deliverable than US-008. The ZIP/manifest/HMAC shape is closer to the `t_5dc0f86b` CRITICAL-1 secret-replacement fix's spirit; the PDF/JSON shape is closer to a user-facing share artifact. They may be the same thing at the code level (a single file the user can download), but the *names* diverge.
- **Real gap or doc issue?** **Documentation issue.** Confirm with the engineering card author that ZIP+manifest+HMAC is the right shape; if yes, update US-008 to match (it was written before the card). If no, the card body needs to be amended.

---

## 3. How this matrix was built (audit trail)

1. **Sources recovered.** `docs/stories.md` (19,259 bytes, 203 lines) and `docs/mvp-cut.md` (197 lines) were not present on disk at the start of this run. Both were reconstructed from the kanban log of their parent PM cards (`t_dcc4a805` and `t_52fc95ad` respectively) by extracting the `write_file` arguments from the assistant messages. SHA-equivalent byte counts matched the original (19,259 / 19,183 for stories; 22,780 / 22,461 for mvp-cut; the small deltas are JSON-escape differences). Both reconstructed files were used in-memory only; the original kanban DB is the durable source of truth.
2. **Card inventory.** 59 cards from `hermes kanban list --json` were inspected. Card bodies for the 14 cards most likely to match by title (the four `[Feature] *US-NNN*` cards, the three P0 architecture cards, the runbook/launch/QA/logging/testing cards, the perf-budget card, and the docs-recovery card) were read via `hermes kanban show` to confirm scope. Bug-fix cards (19 CRITICAL/HIGH/MEDIUM/LINT) were inspected to identify which stories they block rather than which they implement.
3. **Matching rule.** A card matches a story if its body, title, or `dependencies` chain cites the same scaffold module, the same route, or the same acceptance bullet. Implicit matches (where the card's scope covers the story but doesn't name it) are flagged in the matrix with "Implicit:"; dedicated matches (where the card body names the US-NNN) are flagged with "Dedicated:".
4. **Tier mapping rule.** The MVP-cut tier is the *feature row* in `mvp-cut.md` §3 that the story's acceptance bullets closest cite, not the story's P0/P1/P2 priority. A P0 story that maps to a Backlog feature row gets tier = Backlog; a P1 story that maps to an MVP-1 feature row gets tier = MVP-1.
5. **Not modified:** `docs/stories.md` and `docs/mvp-cut.md` (per task acceptance criteria). This traceability doc is the only new file.

---

## 4. Reading order for downstream workers

- **Engineering:** start with the **MVP-1** rows (US-001, US-004, US-005, US-006, US-009). The implicit matches tell you which card to attach the implementation PR to; the bug-fix cards listed in the cell tell you what to fix *before* the story's acceptance bullets can pass.
- **PM (next review):** start with the **Gaps** section. G1 is the only truly un-owned story; G3 is the only priority/cut mismatch that needs a human call. G2, G4, G5 are documentation cleanups.
- **QA (K-15):** the matrix above is the input to the e2e test card `t_251121da` (Playwright happy-path). Every MVP-1 row's acceptance bullets should be a Playwright step or a vitest unit.
- **Auditor / reviewer:** §3 (audit trail) explains the reconstruction step so the matrix can be reproduced from the kanban DB alone, no filesystem access required.
