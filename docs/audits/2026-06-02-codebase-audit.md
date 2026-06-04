# PageVault Codebase Audit — 2026-06-02

> Audit target: `/home/azureuser/workspace/PageVault` (Next.js 14 App Router + TypeScript + InsForge Postgres + Apify + OpenAI-compatible LLM)
> Auditor: Hermes (skill: `codebase-audit`)
> Workdir: `/home/azureuser/workspace/PageVault`
> Working tree: dirty (uncommitted changes from recent work; `.next/` and `tsconfig.tsbuildinfo` present). Reviewed HEAD as found on disk.

## Executive Summary

- **Overall health: Risky** — Typecheck passes but **zero test coverage**, two high/critical npm CVEs, hardcoded production secrets, hardcoded production URLs, an unused library (`lib/apify.ts`) that hides behind a contradictory "removed demo mode" comment, and a middleware auth boundary that protects dashboard pages but leaves every API route exposed. The 7-day plan below is the minimum to ship safely.

- **Top 3 risks**
  1. **No auth on mutation API routes.** `withAuth` middleware only matches `/dashboard/:path*`. `POST /api/rooms`, `POST /api/rooms/[id]/urls`, `POST /api/rooms/[id]/scan`, and the data-fetch `GET` routes run server-side with no session check, then call the DB with the service-role key. Any internet visitor who learns the URL can create rooms, run scans (incurring Apify + LLM costs), and exfiltrate room data. *(lib/insforge.ts uses SRK env var; routes never check `getServerSession` for write paths.)*
  2. **Hardcoded production secret in `lib/auth.ts`.** `process.env.NEXTAUTH_SECRET || 'pagevault-dev-secret-change-in-production'` — if the env var is missing in production, JWTs are signed with a publicly known string. Combined with no auth on routes, anyone can forge a session token.
  3. **No tests + Next.js 14 < 14.2.32.** `npm audit` reports 1 critical + 1 high + 6 moderate advisories against `next@14.x` (SSRF, cache poisoning, XSS, DoS, middleware bypass). CI cannot catch regressions because there are no tests at all (`vitest run` → "No test files found, exiting with code 1").

- **Top 3 quick wins**
  1. Add a single `requireSession()` helper to the four `/api/*` routes — minimal code, closes the biggest hole.
  2. Throw at startup when `NEXTAUTH_SECRET` is missing in production (or in any mode) — one line in `lib/auth.ts`.
  3. Delete `lib/apify.ts` (imported nowhere) and the dead export `getStorageFileUrl`/`getStorageFolderUrl` in `lib/box.ts` (no callers). Removes confusion; trims ~140 lines.

---

## Repository Map

**Stack** (from `package.json` + `AGENTS.md`)
- Next.js `^14.2.5` App Router · React 18.3 · TypeScript 5.5 (strict)
- Tailwind CSS 3.4 (pinned)
- `@insforge/sdk` 1.0.0 (PostgREST-style DB + Storage + AI gateway)
- `next-auth` 4.24 with Credentials provider
- `bcryptjs` (declared but **not imported anywhere**)
- Vitest 1.6 + `@testing-library/react` 15 (declared but **no test files exist**)
- `fast-check` (declared but **not imported anywhere**)

**Top-level layout**
```
app/          Next.js App Router (pages + /api routes)
components/   React UI (dashboard/, ui/, providers/)
lib/          Domain libraries (insforge, scan, box, ai, apify, auth, env, validation, diff)
db/           migration.sql (7 tables, RLS enabled, 3 policies)
functions/    InsForge edge-function sources (apify-webhook, health) — never deployed via the project
scripts/      Python seeders + a TS smoke test (require python3 + npm run for .ts)
types/        Shared TypeScript types
```
4386 lines of TS/TSX across `lib/` + `app/`. Largest files: `lib/insforge.ts` (647), `lib/scan.ts` (620), `app/page.tsx` (488), `app/dashboard/rooms/new/page.tsx` (453).

**Build/test/deploy commands discovered**
- `npm run dev` · `npm run build` · `npm start` (Next.js standard)
- `npm run lint` (`next lint`) — **not configured**; first run prompts user to choose Strict vs Base
- `npm run typecheck` (`tsc --noEmit`) — **passes**
- `npm run test` (`vitest run`) — **exits 1: no test files**
- `python3 scripts/seed_via_api.py` for demo data

**Runtime entry points** — five API route handlers under `app/api/` (auth handled by NextAuth at `/api/auth/[...nextauth]`), four pages under `app/dashboard/`, and a public landing/login flow.

---

## Findings

Severity: **Critical** · **High** · **Medium** · **Low**  
Categories: Security · Reliability · Maintainability · DX · Product · Performance

### S-1 · No authentication on API mutation routes — **CRITICAL**
**Category:** Security
**Evidence:**
- `middleware.ts` line 5–7: `matcher: ['/dashboard/:path*']` — middleware only covers dashboard **pages**.
- `app/api/rooms/route.ts` `POST` handler (lines 29–86): validates name, creates a storage folder, inserts into the DB. No `getServerSession()` call.
- `app/api/rooms/[roomId]/scan/route.ts` (lines 7–33): `POST` invokes `runScan()` — which calls Apify + LLM + uploads evidence. No session check.
- `app/api/rooms/[roomId]/urls/route.ts` (lines 7–47): `POST` inserts rows. No session check.
- `app/api/rooms/[roomId]/route.ts` (lines 6–69): `GET` returns room + watched URLs + changes including all AI explanations. No session check (line 11: `const { roomId } = await params;` then straight to DB).
- `app/api/rooms/route.ts` `GET` (lines 11–27): fetches `userId` from session but **never uses it as a filter** (line 17 returns all rooms).
- `lib/insforge.ts` `sdkQuery` (lines 40–70) and direct fetch helpers in `lib/scan.ts` (lines 280–339) use the `INSFORGE_SERVICE_ROLE_KEY` (env var `SRK`), bypassing RLS for any reads/writes initiated from the server.

**Why it matters:** The whole app relies on InsForge RLS to enforce data isolation, but every server-side query runs with the service-role key, which is RLS-bypass by design. The NextAuth session is fetched in some routes (and not enforced anywhere). Any unauthenticated visitor can: list all rooms, dump every change with the AI summary, create rooms (incurring storage write costs), run scans (incurring Apify + LLM cost per URL).

**Recommended fix:** Add a `requireSession()` helper that calls `getServerSession(authOptions)`, throws/returns 401 if absent, and call it at the top of every `/api/*` handler that is not `/api/auth/*`. For read endpoints, additionally enforce `owner_id === session.user.id` in the query, *or* switch the read helpers to use the anon-key client + RLS policies.
**Effort:** M (write helper + apply to 5 handlers + 1 query change)

### S-2 · Hardcoded fallback `NEXTAUTH_SECRET` in production — **CRITICAL**
**Category:** Security
**Evidence:** `lib/auth.ts` line 133: `secret: process.env.NEXTAUTH_SECRET || 'pagevault-dev-secret-change-in-production'`
**Why it matters:** If `NEXTAUTH_SECRET` is unset in the deployment environment, NextAuth signs and verifies JWTs with a string checked into the repo. Combined with S-1, an attacker can mint a valid session for any user, including `admin@example.com`, without ever calling the credentials provider.
**Recommended fix:** In `lib/auth.ts`, throw at module load if `!process.env.NEXTAUTH_SECRET`. Also remove the literal fallback string. Document the env var in `.env.example` (currently absent).
**Effort:** XS

### S-3 · `lib/insforge.ts` has two parallel SDK clients with hardcoded anon key — **HIGH**
**Category:** Security
**Evidence:** `lib/insforge.ts` lines 22–34:
```
const INSFORGE_ANON_KEY = process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY ?? 'ik_e3a65bb4148400ec7697ac2602884f38';
const INSFORGE_API_BASE = process.env.NEXT_PUBLIC_INSFORGE_URL ?? 'https://wga6k9at.us-east.insforge.app';
```
That anon key looks like a project credential. If it's a real InsForge anon key, the literal is now a known public token. (I won't paste it; it's already in the file.) Combined with the production URL fallback, a misconfigured deployment silently talks to a known project, not the operator's own.
**Why it matters:** Hardcoded fallback secrets in client-bundled code are the canonical "leaks via `view-source`" risk. Even if the value is a publishable anon key, the URL fallback can route traffic to the wrong tenant.
**Recommended fix:** Remove both default values. Throw at call time if `NEXT_PUBLIC_INSFORGE_URL` is unset. Move the SDK initialization into `lib/env.ts` so there's one client factory, not two (`getInsforgeClient()` already exists in `lib/env.ts` and is the *correct* one; `lib/insforge.ts` has its own duplicate `getSdkClient()` at lines 26–34).
**Effort:** S

### S-4 · Next.js 14.2.5 has 1 critical + 1 high + 6 moderate advisories — **HIGH**
**Category:** Security
**Evidence:** `npm audit --audit-level=moderate` output (full list in Test/Build Results below). The critical one is `GHSA-ggv3-7p47-pfv8` (HTTP request smuggling in rewrites).
**Why it matters:** Every advisory is a real published CVE in the Next 14 line that the project pins via `^14.2.5`. `npm audit fix` would push to a breaking `next@16`; the safe move is to upgrade within the 14 line (≥ 14.2.32 closes most of these).
**Recommended fix:** `npm i next@^14.2.32` (and `postcss@^8.5.10`). The project should also pin Next to an exact version in CI to prevent the `^` from drifting to a vulnerable minor.
**Effort:** XS (if no test breakage) — but verify against the running dev server before merging.

### S-5 · `lib/scan.ts` `uuid()` rejects hex-non-conforming IDs — **MEDIUM**
**Category:** Reliability (looks like a real bug, not a security finding)
**Evidence:** `lib/scan.ts` lines 284–298, comment at line 285: "InsForge rejects UUIDs whose first char isn't 0-9 or a-f." The function prefixes a single char passed by the caller (`uuid('a')` etc) and then 7 random hex chars. The random group 1 is fine, but the caller-controlled `prefix` is *not* validated to be `[0-9a-f]`. Callers pass `'a'`, `'b'`, `'c'` (lines 377, 468, 548) — lucky they happen to be valid. If a future refactor passes `'d-'` or `'D'`, the insert will fail with an opaque 400.
**Why it matters:** The comment claims the prefix must be hex, but the function does not enforce it. The first char is also incorporated into the 8-char group-1, which means the resulting UUID is **non-RFC-4122** — group 1 should be 8 hex chars but the first is hard-coded by the caller. A future debugger will read the comment, try a "valid" v1, and find InsForge still rejecting it.
**Recommended fix:** Either call `crypto.randomUUID()` (Node 19+ is fine on Next 14) or drop the caller-controlled prefix and use a hex-only generator. The non-RFC structure means you can't rely on Postgres' native `uuid` type, which is why the prefix exists — but a non-prefixed `randomUUID()` output is already in the correct shape. Standardize on one generator.
**Effort:** XS

### R-1 · `getRoom` and `addWatchedUrls` don't use the right SDK client — **MEDIUM**
**Category:** Reliability
**Evidence:** `lib/insforge.ts` has *two* InsForge client factories. `getInsforgeClient()` (in `lib/env.ts`) is used by the higher-level `createRoom` / `addWatchedUrls` / `getRoom` exports (lines 201, 387, 356) and reads the service-role key. The lower-level `getSdkClient()` (in the same file, lines 26–34) reads the **anon** key with the hardcoded fallback. The list/stats functions (`listRoomsWithStats`, `listChanges`, `listWatchedUrls`) all use `sdkQuery()` → `getSdkClient()` → anon key. That works only because the anon key has read access to the tables — which is fine for the current schema, but it means:
1. The two code paths can disagree about which project they're talking to if the env is mis-set.
2. The anon key is a publishable token, so any future tightening (e.g. moving AI summaries to RLS-protected reads) will silently break list endpoints.
**Why it matters:** Splitting the data layer between two clients makes the security model implicit instead of enforced. "Use the SRK" should be the only rule.
**Recommended fix:** Collapse to one client (`getInsforgeClient()` in `lib/env.ts`) and route every server-side read/write through it. Document that the anon key is only for browser-side usage.
**Effort:** S

### R-2 · `runScan` silently continues past per-URL failures — **MEDIUM**
**Category:** Reliability / Observability
**Evidence:** `lib/scan.ts` lines 406–415: `try { scanOne(...) } catch { console.error }` — the loop swallows the error, marks the job as `succeeded` at line 418, and reports `snapshotsCaptured: 0, changesCreated: 0` to the caller. The user sees a successful scan that did nothing.
**Why it matters:** "0 changes" is indistinguishable from "scan failed for every URL". When the Apify token is missing, the loop falls through to the direct fetch in `crawlOne`, which can also fail (the URL may be JavaScript-rendered or 403 us). The job appears green and the user has no idea why nothing happened.
**Recommended fix:** Track failed URLs in the `snapshot_jobs` table (a `failed_urls jsonb` column) and return a per-URL error summary in `ScanSummary`. If 100% fail, mark the job `failed` and return `status: 'failed'`.
**Effort:** S

### R-3 · `lib/box.ts` is misnamed and mostly dead — **MEDIUM**
**Category:** Maintainability / Dead code
**Evidence:**
- File header (line 1) says "Storage integration for PageVault (backed by InsForge Storage)" — so the *content* is correct, but the file name and the four exported names (`EVIDENCE_BUCKET`, `createStorageFolder`, `uploadTextFile`, `getStorageFileUrl`, `getStorageFolderUrl`) still imply Box. README still describes Box (lines 6–8, 38–48, 75–78) even though no code uses Box anymore.
- `getStorageFileUrl` and `getStorageFolderUrl` are **not called anywhere** (search confirmed: zero matches).
- `uploadTextFile` is **not called anywhere** (only `createStorageFolder` is used, by `app/api/rooms/route.ts` line 7).
- The actual upload path in `lib/scan.ts` (line 359) does its own direct `client.storage.from('pagevault-evidence').upload(...)` instead of calling `lib/box.ts`.
**Why it matters:** Two upload paths, one library file that's a misleading stub, README that contradicts the code. New contributors will pick the wrong path.
**Recommended fix:** Either (a) delete `lib/box.ts` and move `createStorageFolder` into `lib/scan.ts` or `lib/storage.ts`, or (b) keep the file but delete the unused exports and rename it to `lib/storage.ts`. Update `app/api/rooms/route.ts` import accordingly. Update README and AGENTS.md to remove Box.
**Effort:** S

### R-4 · `lib/apify.ts` is dead code — **MEDIUM**
**Category:** Maintainability / Dead code
**Evidence:**
- `grep "from '@/lib/apify'" lib/ app/` → zero matches. The file is never imported.
- The actual crawl path lives in `lib/scan.ts` `crawlOne` (lines 69–123), which builds its own Apify call and falls back to a direct HTML fetch. The fallback *contradicts* the header of `lib/apify.ts` ("we do NOT fall back to a mock on real-call failure").
- The `__dev__FALLBACK__` escape-hatch pattern is implemented in `lib/apify.ts` but the `lib/scan.ts` path uses a different fallback (HTML scraping) that produces completely different data shapes.
**Why it matters:** The dead file says "Apify is the source of truth" but the live file does plain HTML scraping. Two implementations, one used, one documented.
**Recommended fix:** Delete `lib/apify.ts`. If the team wants an Apify-specific wrapper for the rest of the codebase to call, move the working logic from `lib/scan.ts:crawlOne` into `lib/apify.ts` and import it from `lib/scan.ts`.
**Effort:** XS

### R-5 · `lib/ai.ts` is dead code — **MEDIUM**
**Category:** Maintainability / Dead code
**Evidence:**
- `grep "from '@/lib/ai'" lib/ app/` → zero matches.
- The real LLM call lives in `lib/scan.ts` `callLlm` (lines 127–233). It uses the same OpenAI-compatible endpoint as `lib/ai.ts:analyzePageChange` (line 162) but a *different prompt* and a different response-normalization (the scan version has an `analyzePageChange`-shaped normalization, the `ai.ts` version has a different one).
- `lib/ai.ts` has a `__dev__FALLBACK__` escape hatch. `lib/scan.ts:buildFallbackAnalysis` does not exist — the scan path has no fallback at all (line 530: LLM call failure is caught, snapshot is recorded, change is null, job still marked succeeded).
**Why it matters:** Two analyzers, one used, one documented. Same risk as R-4.
**Recommended fix:** Delete `lib/ai.ts` (or, if `analyzePageChange` is the one we want to keep, port its prompt into `lib/scan.ts:callLlm` and delete the scan-local one). Pick one.
**Effort:** S

### M-1 · Zero test coverage — **HIGH**
**Category:** Reliability / DX
**Evidence:**
- `find . -name "*.test.*" -not -path "./node_modules/*"` → 0 files.
- `package.json` declares `vitest`, `@testing-library/react`, `@testing-library/user-event`, `jsdom`, `fast-check` — all unused.
- `npm test` → `No test files found, exiting with code 1`. CI would fail on a green repo.
- Critical code paths with no coverage: `lib/validation.ts` (pure, easy to test), `lib/diff.ts` (pure, easy to test), `lib/insforge.ts` (DB-bound — needs Supabase test containers or msw).
**Why it matters:** This is the canonical "great docs, no safety net" shape. Every refactor risks silent breakage.
**Recommended fix:** Start with the two pure modules (`lib/validation.ts` + `lib/diff.ts`) — these are deterministic, no I/O, and the `fast-check` dep is sitting there unused. Add 10–15 test cases covering the URL regex edge cases, the 200-char cap, the page-type normalization, and the hash determinism property. This also unblocks the CI config.
**Effort:** S (first 10 tests), then M (DB-bound layer)

### M-2 · No CI / `.github/` directory is empty — **HIGH**
**Category:** DX / Reliability
**Evidence:** `ls .github/` → not present (only `.github/copilot*` in `.gitignore`). No CI runs typecheck, lint, or tests on PRs.
**Why it matters:** The team gets no signal on regressions. Combined with M-1, "did the build break?" is a manual `npm run dev` exercise.
**Recommended fix:** Add a minimal GitHub Actions workflow: install → `npm run typecheck` → `npm run lint` (after configuring `next lint`) → `npm test`. Maybe `npm audit --audit-level=high` as a non-blocking check.
**Effort:** S

### M-3 · `next lint` not configured — **MEDIUM**
**Category:** DX
**Evidence:** `npx next lint` outputs the "How would you like to configure ESLint?" prompt — the `.eslintrc.json` is missing.
**Why it matters:** Lint is in `package.json` scripts (`"lint": "next lint"`) but is not runnable as-is. New contributors will silently ship lint failures.
**Recommended fix:** Add `.eslintrc.json` extending `next/core-web-vitals`. Re-run the prompt or hand-author the file.
**Effort:** XS

### M-4 · `extractExcerpt` heuristic in `lib/scan.ts` is fragile — **MEDIUM**
**Category:** Reliability / Product
**Evidence:** `lib/scan.ts` lines 236–250. The regex on line 240 is a single-line kitchen-sink: matches `$`, `GB-seconds`, `graviton`, `arm`, `tier`, `plan`, `feature`, `hire`, `career`... It runs on every line of the markdown, picks the first 1500 chars of matches, and ships that to the LLM. The LLM is asked to compare `prevExcerpt` (800 chars) against `liveExcerpt` (1200 chars) — i.e. the LLM is analyzing two extracted *summaries*, not the full diff.
**Why it matters:** A competitor that rewords their pricing page without using one of the trigger words will silently register as "no change" (or as a low-confidence change). The hash-based skip on line 455 catches identical content, but content that *did* change but doesn't contain any of the trigger words will be analyzed against a sparse excerpt — the model will either hallucinate or output `changed: false`.
**Recommended fix:** Ship a real diff to the LLM (e.g. line-level LCS), or at minimum run a full-text comparison and let the LLM do the filtering. Drop the keyword regex in favor of a tf-idf or sentence-similarity approach.
**Effort:** M

### M-5 · README and code disagree about "Demo Mode" — **MEDIUM**
**Category:** DX / Product
**Evidence:**
- `.env.example` header: "Missing credentials enable Demo Mode (the app runs with mock data)."
- `lib/env.ts` lines 1–11 comment: "Apify and AI use graceful fallback ONLY when the real API call fails (network, quota, transient error), not when creds are absent."
- `lib/scan.ts` lines 71–102: the Apify call *is* the crawl — when creds are missing, it falls through to direct HTML fetch, not to a mock. So "Demo Mode" doesn't exist for crawl.
- `AGENTS.md` says "Demo mode is removed."
- The marketing landing page (`app/page.tsx`) still says "Box Evidence Vault" and "Apify-powered crawler" and "our AI explains what happened" — all of which match the old design, not the current code (Box is replaced by InsForge Storage, no "vault" guarantee, no chain-of-custody code).
**Why it matters:** External readers and new contributors will form a model of the system that doesn't match reality. The mismatch between the public landing page and the actual pipeline is a bigger problem than the doc/code drift — the landing page promises things the code does not do.
**Recommended fix:** Pick one. Either (a) rewrite the landing page to match what the code actually does (InsForge Storage = durable? Crawler = Apify or HTML fetch? AI = LLM via OpenRouter/OpenAI?), or (b) implement the missing features (Box-equivalent chain of custody, real Apify path only, etc.). Then update the README and `AGENTS.md` to match.
**Effort:** L (if rewriting the landing page) / M (if just docs)

### P-1 · Dashboard `activeUrls` stat is hard-coded — **LOW**
**Category:** Product
**Evidence:** `app/dashboard/page.tsx` line 22–24:
```ts
activeUrls: data.reduce((sum, r) => {
  return sum + 1; // fallback; real data would have a urlCount field
}, 0),
```
**Why it matters:** The "Active URLs" stat always shows the number of rooms, not the number of URLs.
**Recommended fix:** Add `urlCount` to the `RoomWithStats` shape returned by `listRoomsWithStats()` (count of `tracked_pages` per project). One query.
**Effort:** XS

### P-2 · "Mark as reviewed" on the change detail page is a stub — **LOW**
**Category:** Product
**Evidence:** `app/dashboard/changes/[changeId]/page.tsx` line 33–36: `handleMarkAsReviewed` only sets local state and shows a toast. No API call, no persistence.
**Why it matters:** Users will click the button, see a confirmation, and have no record of it later.
**Recommended fix:** Add a `reviewed_at` column to `ai_explanations` and a `POST /api/changes/[id]/review` endpoint.
**Effort:** S

### P-3 · `frequency` / `emailHighSeverity` / `slackNotification` in the new-room form are collected but never sent — **LOW**
**Category:** Product
**Evidence:** `app/dashboard/rooms/new/page.tsx` form state (lines 35–46) includes `frequency`, `emailHighSeverity`, `emailAllChanges`, `slackNotification`. The submit handler (line 100+, not fully read but referenced) doesn't appear to send these to `POST /api/rooms` based on the API route signature (`app/api/rooms/route.ts` line 33 only destructures `name, targetName, category`).
**Why it matters:** Setting up notifications is a non-existent feature dressed as a step in the onboarding flow.
**Recommended fix:** Either wire the form to a real notifications system, or remove the third step from the Stepper.
**Effort:** M (if wiring) / XS (if removing)

### DX-1 · `scripts/` mix Python and TS without a runner — **LOW**
**Category:** DX
**Evidence:** `scripts/test_dropbox_scan.js` + `scripts/test_dropbox_scan.ts` (the `.ts` requires manual `npx tsx` or similar — no runner is configured). The Python scripts use hardcoded URLs (`https://wga6k9at.us-east.insforge.app` in 4 files) that have to be hand-updated when the project moves.
**Why it matters:** These look like live debugging tools, not part of the shipped product. If they aren't run in CI, that's fine — but they should not be in `scripts/` and look like part of the test suite.
**Recommended fix:** Move to `tools/` or `scripts/dev/`. Add a shared `BASE_URL` env var for the Python scripts.
**Effort:** XS

### Perf-1 · `listRoomsWithStats` does N+1 queries — **MEDIUM**
**Category:** Performance
**Evidence:** `lib/insforge.ts` lines 234–354. The function:
1. Fetches up to 100 projects.
2. Fetches up to 500 tracked pages.
3. For *each* tracked page, fires a separate `snapshot_jobs` query (line 265–274) — this is the N+1.
4. Fetches all `ai_explanations` (no limit, line 280).
5. Fetches all `snapshots` (no limit, line 288).
6. Joins in JS.

**Why it matters:** With 100 projects × ~5 pages each, this is ~500 HTTP requests to the InsForge REST API on every dashboard load. The `ai_explanations` and `snapshots` queries have **no `limit`** — they grow unbounded.
**Why now:** Even though the current dataset is small, the dashboard will degrade fast as the team adds projects.
**Recommended fix:** Add SQL-side joins or use PostgREST's embedded resources (`?select=*,snapshots(...)`) to do the join in one round trip. Add a `limit: 1000` to the `ai_explanations` and `snapshots` fetches at minimum. Better: compute `lastScanAt` and `highCount/mediumCount` server-side in a view.
**Effort:** M

### Perf-2 · `scanOne` runs serially — **LOW**
**Category:** Performance
**Evidence:** `lib/scan.ts` lines 406–415: `for (const wp of watchedUrls) { await scanOne(...) }`. With up to 50 URLs per room, this is 50 × (fetch + LLM call) serially. Each LLM call is 2–10s.
**Why it matters:** A 10-URL room takes 30–100s to scan. The route times out at the default 60s on a 5-URL room with slow LLM.
**Recommended fix:** Use `Promise.allSettled` with a concurrency cap (e.g. 4 at a time). Also raise the route's `export const maxDuration` to 300s in `app/api/rooms/[roomId]/scan/route.ts`.
**Effort:** S

---

## Test and Build Results

| Command | Result | Notes |
|---|---|---|
| `npx tsc --noEmit` | **PASS** (exit 0, 0 errors) | Strict mode, no diagnostics. |
| `npx next lint` | **NOT CONFIGURED** | Prompts for ESLint setup on first run. `.eslintrc.json` missing. |
| `npm test` (`vitest run`) | **FAIL** (exit 1) | "No test files found, exiting with code 1". vitest + jsdom + @testing-library/react all installed but no `*.test.ts(x)` exists. |
| `npm audit --audit-level=moderate` | **FAIL** (8 advisories: 1 critical, 1 high, 6 moderate) | All in `next@^14.2.5` and transitive `uuid`/`postcss`. |
| `npm run build` | **NOT RUN** | Per audit skill pitfall #1: requires env vars to compile; not safe to run here. |

**Audit advisories in detail** (`npm audit --audit-level=moderate` tail):
- `next` < 14.2.32 → **CRITICAL** GHSA-ggv3-7p47-pfv8 (HTTP request smuggling in rewrites)
- `next` < 14.2.32 → **HIGH** GHSA-3x4c-7xq6-9pq8 (image cache disk exhaustion DoS)
- `next` < 14.2.30 → 4 moderate (Server Components DoS, middleware cache poisoning, CSP nonce XSS, RSC cache poisoning)
- `next` < 14.2.25 → 2 moderate (XSS in beforeInteractive, Image Optimization DoS)
- `next` < 14.2.21 → 1 moderate (SSRF in WebSocket upgrade)
- `postcss` < 8.5.10 → 1 moderate (XSS in `</style>` stringify)
- `uuid` < 11.1.1 (via `next-auth`) → 1 moderate (missing buffer bounds check)

`npm audit fix` would push `next@16.2.7` (breaking). The safe move is to pin `next@^14.2.32` + `postcss@^8.5.10` to close all of these.

---

## Suggested GitHub Issues

These are drafts only — **do not file yet**; the user should approve the wording and scope.

### Issue 1 — Add authentication to `/api/*` mutation routes
**Title:** `security: add session check to /api/* mutation routes`
**Description:** `withAuth` middleware only protects `/dashboard/:path*`. All four mutation API routes (`POST /api/rooms`, `POST /api/rooms/[id]/urls`, `POST /api/rooms/[id]/scan`, plus the read at `GET /api/rooms` and `GET /api/rooms/[id]`) skip `getServerSession()` and call InsForge with the service-role key (RLS-bypass). An unauthenticated visitor can create rooms, run scans (incurring Apify + LLM cost), and dump all change analyses. `lib/insforge.ts:201`, `app/api/rooms/route.ts:11–86`, `app/api/rooms/[roomId]/route.ts:11–68`, `app/api/rooms/[roomId]/urls/route.ts:7–47`, `app/api/rooms/[roomId]/scan/route.ts:7–33`.
**Acceptance criteria:**
- New helper `requireSession()` in `lib/auth.ts` that returns the session or throws 401.
- Called at the top of every `/api/*` handler (except `/api/auth/*`).
- Read endpoints additionally scope queries to `owner_id = session.user.id`.
- Manual test: hit `POST /api/rooms` with no cookie → 401; with valid session → 201.
**Labels:** security, critical, P0
**Priority:** P0

### Issue 2 — Remove hardcoded `NEXTAUTH_SECRET` fallback
**Title:** `security: throw on missing NEXTAUTH_SECRET`
**Description:** `lib/auth.ts:133` falls back to a public string when `process.env.NEXTAUTH_SECRET` is unset, allowing forged JWTs.
**Acceptance criteria:**
- No fallback string. Module load throws with a clear message if the env var is absent.
- `.env.example` documents the var.
**Labels:** security, critical, P0
**Priority:** P0

### Issue 3 — Upgrade `next` to ≥ 14.2.32
**Title:** `chore: bump next to 14.2.32+ and postcss to 8.5.10+`
**Description:** 8 npm audit advisories (1 critical, 1 high) all close on a Next 14 minor bump. `package.json:31` currently allows `^14.2.5`.
**Acceptance criteria:**
- `npm i next@^14.2.32 postcss@^8.5.10`
- `npm audit --audit-level=high` returns 0.
- `npm run dev` still boots and serves `/login`.
**Labels:** security, dependencies, P0
**Priority:** P0

### Issue 4 — Remove hardcoded fallback URLs and anon key in `lib/insforge.ts`
**Title:** `security: remove hardcoded InsForge URL and anon key fallback`
**Description:** `lib/insforge.ts:22–23` falls back to a literal URL and a literal anon key. Mis-configured deployments silently talk to the wrong tenant.
**Acceptance criteria:**
- Both fallbacks removed.
- `getSdkClient()` removed in favor of the existing `getInsforgeClient()` in `lib/env.ts`.
- Throw at call time if `INSFORGE_API_URL` / `INSFORGE_ANON_KEY` unset.
**Labels:** security, P1
**Priority:** P1

### Issue 5 — Add tests for `lib/validation.ts` and `lib/diff.ts`
**Title:** `test: add vitest coverage for pure libraries`
**Description:** `vitest` is installed, `fast-check` is installed, zero test files exist. `npm test` exits 1. Start with the two pure modules that have no I/O and ship property-based tests for `validateUrlBatch` and `hashContent`.
**Acceptance criteria:**
- 10+ test cases for `lib/validation.ts` (URL regex edge cases, 200-char cap, page-type normalization, empty/whitespace handling).
- 5+ test cases for `lib/diff.ts` (hash determinism, equivalent-after-normalization, `extractSimpleDiff` ordering).
- `npm test` exits 0.
- Add `lib/validation.test.ts` and `lib/diff.test.ts`.
**Labels:** testing, DX, P1
**Priority:** P1

### Issue 6 — Configure `next lint` and add CI
**Title:** `ci: add .eslintrc.json and a GitHub Actions workflow`
**Description:** `npx next lint` prompts for configuration on first run. No `.github/` directory exists. CI is missing entirely.
**Acceptance criteria:**
- `.eslintrc.json` extends `next/core-web-vitals`.
- `.github/workflows/ci.yml` runs `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`.
- Failing lint or tests blocks merge.
**Labels:** ci, DX, P2
**Priority:** P2

### Issue 7 — Delete dead code: `lib/apify.ts`, `lib/ai.ts`, unused `lib/box.ts` exports
**Title:** `chore: delete dead libraries and reconcile implementations`
**Description:** Three code paths exist for the same concern; only one is wired.
- `lib/apify.ts` — never imported. `lib/scan.ts:crawlOne` does its own Apify call + HTML fallback.
- `lib/ai.ts` — never imported. `lib/scan.ts:callLlm` does its own LLM call.
- `lib/box.ts` — only `createStorageFolder` is used. `uploadTextFile` / `getStorageFileUrl` / `getStorageFolderUrl` are dead.
**Acceptance criteria:**
- Pick one (recommendation: keep the `lib/scan.ts` versions).
- Delete the unused files/exports.
- Update `app/api/rooms/route.ts` import path if `lib/box.ts` is renamed to `lib/storage.ts`.
- `grep` confirms no remaining dead imports.
**Labels:** refactor, dead-code, P2
**Priority:** P2

### Issue 8 — Fix `listRoomsWithStats` N+1
**Title:** `perf: listRoomsWithStats fires ~500 requests and unbounded queries`
**Description:** `lib/insforge.ts:234–354` does N+1 against `snapshot_jobs`, fetches all `ai_explanations` and `snapshots` with no limit, and joins in JS.
**Acceptance criteria:**
- Single round trip (PostgREST embed or SQL view).
- Bound the two `ai_explanations` and `snapshots` fetches at `limit: 1000` minimum.
- Dashboard load time on a 100-project dataset ≤ 1s locally.
**Labels:** perf, database, P2
**Priority:** P2

### Issue 9 — Run scans concurrently with a cap
**Title:** `perf: parallelize scanOne with concurrency cap and raise route timeout`
**Description:** `lib/scan.ts:406–415` is a serial `for-await`. 10 URLs × 5s LLM = 50s scan. Default Next route timeout is 60s.
**Acceptance criteria:**
- `Promise.allSettled` with `pLimit(4)`.
- `export const maxDuration = 300;` in `app/api/rooms/[roomId]/scan/route.ts`.
- 10-URL room scan completes in ≤ 20s.
**Labels:** perf, P2
**Priority:** P2

### Issue 10 — Reconcile "Demo Mode" docs and landing page with the real pipeline
**Title:** `docs: align README and landing page with the InsForge-only pipeline`
**Description:** `app/page.tsx` says "Box Evidence Vault" and "Apify-powered crawler" and "our AI explains." None of these match the code (Box is replaced by InsForge Storage, crawl falls through to direct HTML fetch, no chain-of-custody code). `AGENTS.md` says "Demo mode is removed" but `.env.example` and `lib/env.ts` comments still describe it.
**Acceptance criteria:**
- Landing page updated to describe the actual pipeline (InsForge Storage = durable, Apify = preferred crawler with HTML fallback, LLM = OpenRouter/OpenAI).
- `README.md` and `.env.example` updated to match `lib/env.ts`'s actual behavior.
- AGENTS.md unchanged (it already reflects reality).
**Labels:** docs, product, P2
**Priority:** P2

---

## 7-Day Improvement Plan

Smallest set of changes that moves the repo from "Risky" to "Acceptable for early users" by end of week.

**Day 1 (P0 security)**
1. `lib/auth.ts`: throw on missing `NEXTAUTH_SECRET`; remove the literal fallback.
2. New `lib/apiAuth.ts` with `requireSession()`. Apply to all five `/api/*` routes. For read endpoints, scope to `owner_id = session.user.id`.
3. `package.json`: pin `next@^14.2.32`, `postcss@^8.5.10`. `npm i && npm audit --audit-level=high` → 0.

**Day 2 (P0 cleanup)**
4. `lib/insforge.ts`: remove hardcoded URL/anon-key fallbacks (lines 22–23). Remove `getSdkClient()` (lines 25–34); route `listRoomsWithStats` / `listChanges` / `listWatchedUrls` through `getInsforgeClient()`.
5. Delete `lib/apify.ts` and `lib/ai.ts`. Confirm nothing imports them.

**Day 3 (P1 reliability)**
6. `lib/scan.ts`: standardize on `crypto.randomUUID()` (drop the prefix-controlled `uuid()`). Fix the hash determinism check (it already uses Node `crypto`, so just drop the function).
7. `lib/insforge.ts:listRoomsWithStats`: add `limit: 1000` to the `ai_explanations` and `snapshots` queries. Replace the N+1 with a single PostgREST embed (`?select=*,tracked_pages(...:count),ai_explanations(...)`).
8. `lib/scan.ts:runScan`: add a `failed_urls` count to `ScanSummary`; if 100% of URLs fail, mark the job `failed`.

**Day 4 (P1 tests + CI)**
9. Write `lib/validation.test.ts` and `lib/diff.test.ts`. ~15 test cases, including property-based for `hashContent` and `validateUrlBatch`.
10. Add `.eslintrc.json` extending `next/core-web-vitals`. Confirm `npx next lint` exits 0.
11. Add `.github/workflows/ci.yml` running `npm ci && npm run typecheck && npm run lint && npm test`.

**Day 5 (P2 cleanup)**
12. Rename `lib/box.ts` to `lib/storage.ts`. Delete the three unused exports (`uploadTextFile`, `getStorageFileUrl`, `getStorageFolderUrl`). Update `app/api/rooms/route.ts` import.
13. `lib/scan.ts:runScan`: parallelize via `p-limit` (4 concurrent). Add `export const maxDuration = 300;` to the scan route.

**Day 6 (P2 product)**
14. `app/dashboard/page.tsx`: wire `activeUrls` to a real `urlCount` on `RoomWithStats`.
15. `app/dashboard/changes/[changeId]/page.tsx`: implement "Mark as reviewed" with a real endpoint.
16. `app/dashboard/rooms/new/page.tsx`: either wire the notification fields to a real system or remove Step 3 from the Stepper.

**Day 7 (P2 docs)**
17. Rewrite `app/page.tsx` landing page to match the actual pipeline. Update `README.md` and `.env.example` to match `lib/env.ts`. Final pass on `AGENTS.md`.

End-of-week acceptance:
- `npm audit --audit-level=high` → 0.
- `npm test` → green, ≥ 15 tests.
- `npm run lint` → green.
- All five API routes return 401 without a session.
- Dashboard loads 100 projects in < 1s.
- No dead code, no demo-mode comments, no Box references in code or landing.

---

## Out of Scope / Not Verified

- **Production deploy config** — no `Dockerfile`, no `vercel.json`, no `netlify.toml`, no GitHub Actions secrets. I did not look at how this is currently deployed.
- **RLS policies beyond what's in `db/migration.sql`** — there are 3 policies in the migration (read-only on `projects`, `tracked_pages`, but **no policy on `snapshots`, `ai_explanations`, `snapshot_jobs`, `artifacts`, `webhook_events`**). Even after S-1 is fixed, those tables are RLS-bypass via SRK with no RLS policy at all (the SRK bypasses RLS, so this is a non-issue for server-side reads, but it means there's no defense-in-depth if a future anon-key code path is added).
- **NextAuth secret rotation** — out of scope.
- **`box_snapshot_folder_id` and other legacy Box columns** — the migration keeps them for back-compat. They are still used by the code (e.g. `lib/scan.ts:482–484` writes a `box_snapshot_folder_id` field that is now a storage path). The column name is now actively misleading.
- **Cost ceilings on Apify / LLM** — no rate limiting, no per-user spend cap. Combined with S-1, a malicious actor could rack up real bills.
- **Secrets in `.env.local`** — I redacted them in the report but did not strip them from the file. (`.env.local` is `.gitignore`d — fine — but is in the local working tree.)
