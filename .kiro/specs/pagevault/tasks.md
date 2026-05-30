# Implementation Plan: PageVault

## Overview

This plan converts the PageVault design into a series of incremental, code-generation steps. Each step builds on the previous one and ends by wiring new code into the existing system so there is no orphaned or unintegrated code. The build order is: scaffolding and shared types first, then the pure logic libraries (`env`, `diff`, `validation`) with their property tests, then the resilient integration libraries (`apify`, `box`, `ai`) with property tests, then the Insforge data layer, then the scan orchestrator and demo seed with property tests, then the API routes, then the UI components and frontend pages, then the supporting artifacts (migration SQL, seed script, `.env.example`, README), and finally an integration-and-verification pass.

Implementation language: **TypeScript** (Next.js App Router). Testing: **Vitest** + **fast-check**.

Property-based tests follow the design's Testing Strategy: each property test runs a minimum of **100 generated cases**, replaces external services (Insforge, Apify, Box, LLM) with **in-memory fakes/spies**, simulates credential presence by toggling the `lib/env.ts` detectors, and tags each test with a comment in the form `// Feature: pagevault, Property {number}: {property_text}`.

## Tasks

- [ ] 1. Project scaffolding
  - [ ] 1.1 Initialize the Next.js App Router + TypeScript project with the testing toolchain
    - Create a Next.js (App Router) project with TypeScript, `app/` directory, and `tsconfig.json` with path aliases for `lib/`, `types/`, and `components/`
    - Add and configure Tailwind CSS pinned to 3.4 (`tailwind.config.ts`, `postcss.config.js`, `app/globals.css`) — do not upgrade to v4
    - Add Vitest and fast-check as dev dependencies and create `vitest.config.ts` (jsdom environment for UI tests, node for logic tests) plus `test` / `build` / `typecheck` npm scripts
    - Create the directory skeleton (`app/`, `app/api/`, `components/{layout,rooms,changes,ui}`, `lib/`, `types/`, `db/`, `scripts/`)
    - _Requirements: 15.1, 15.3, 16.1_

- [ ] 2. Shared types
  - [ ] 2.1 Define shared TypeScript types in `types/index.ts`
    - Define the enums `Category`, `PageType`, `Severity`, `ChangeType`, and `ScanStatus`
    - Define the interfaces `MemoryRoom`, `RoomWithStats`, `WatchedUrl`, `PageSnapshot`, `ScanRun`, `EvidenceItem`, `ChangeAnalysis`, and `ScanSummary`
    - Define the input types used by the data layer (`NewRoom`, `NewWatchedUrl`, `NewSnapshot`, `NewChangeAnalysis`)
    - _Requirements: 1.1, 2.2, 2.3, 3.1, 3.2, 4.6, 5.2, 7.2, 7.6_

- [ ] 3. Pure logic libraries (env, diff, validation)
  - [ ] 3.1 Implement credential detection in `lib/env.ts`
    - Implement `isPresent`, `hasApifyCreds`, `hasBoxCreds`, `hasAiCreds`, and `hasInsforgeCreds` exactly per the design (a credential is present only when it is a non-empty trimmed string; malformed values count as present)
    - _Requirements: 12.1, 12.2, 13.1, 13.3, 14.1, 14.3, 15.1, 15.2_

  - [ ] 3.2 Implement the diff engine in `lib/diff.ts`
    - Implement `hashContent` (SHA-256 hex over normalized text: trim, collapse internal whitespace, normalize line endings), `hasMeaningfulChange` (defined purely as `hashContent(prev) !== hashContent(curr)`), and `extractSimpleDiff`
    - _Requirements: 5.1, 6.1_

  - [ ]* 3.3 Write property test for the diff engine
    - **Property 1: Content-hash change detection is exactly hash inequality and is insensitive to formatting**
    - **Validates: Requirements 5.1, 6.1**

  - [ ] 3.4 Implement input validation and normalization in `lib/validation.ts`
    - Implement room validation (name and target name: required, 1–200 chars after trim, not whitespace-only) returning `{ ok: true, value } | { ok: false, field, message }`
    - Implement category normalization (missing/empty/whitespace-only → `competitor`)
    - Implement URL-batch validation (1–100 entries; each entry: url required and a valid absolute http/https URL, optional label ≤ 200 chars; page type one of the 9 values else `unknown`) as all-or-nothing
    - Implement the pure helper `buildWatchedUrlRows(roomId, entries)` that produces one normalized `NewWatchedUrl` per entry, each carrying the given room id
    - _Requirements: 1.1, 1.2, 1.3, 3.1, 3.2, 3.3, 3.5, 3.6_

  - [ ]* 3.5 Write property test for category normalization
    - **Property 2: Category normalization defaults to 'competitor'**
    - **Validates: Requirements 1.2**

  - [ ]* 3.6 Write property test for page-type and label normalization
    - **Property 3: Page-type normalization**
    - **Validates: Requirements 3.2, 3.3**

  - [ ]* 3.7 Write property test for room field validation
    - **Property 4: Room field validation**
    - **Validates: Requirements 1.3**

  - [ ]* 3.8 Write property test for URL-batch validation
    - **Property 5: URL-batch validation is all-or-nothing across boundaries**
    - **Validates: Requirements 3.5, 3.6**

  - [ ]* 3.9 Write property test for add-URLs count and room association
    - **Property 6: Add-URLs preserves count and room association** (against `buildWatchedUrlRows`)
    - **Validates: Requirements 3.1**

  - [ ]* 3.10 Write unit tests for validation edge cases
    - Cover boundary lengths (0, 1, 200, 201 chars), whitespace-only inputs, missing fields, malformed URLs, and the 0 / 1 / 100 / 101 batch-size boundaries
    - _Requirements: 1.3, 3.5, 3.6_

- [ ] 4. Checkpoint - pure logic complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Integration libraries (apify, box, ai)
  - [ ] 5.1 Implement the Apify integration in `lib/apify.ts`
    - Implement `crawlUrls(urls)` with the `ApifyPageResult` shape; real mode calls `run-sync-get-dataset-items` and maps dataset items (always include url and capturedAt; include title/text/html/markdown when present); mock mode and any failure return deterministic mock results, including the documented before/after pricing-page versions
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

  - [ ]* 5.2 Write property test for Apify resilience and shape
    - **Property 17: Apify crawl is resilient and well-shaped** (use a fake fetch that throws; assert never rejects, always url + capturedAt, no completed network call when creds absent or call fails)
    - **Validates: Requirements 12.2, 12.3, 12.5**

  - [ ]* 5.3 Write example tests for Apify mock content and real-mode mapping
    - Unit-test that mock results contain the exact documented before/after strings (12.4); integration-test the real-mode dataset-item mapping against a fake API response (12.1)
    - _Requirements: 12.1, 12.4_

  - [ ] 5.4 Implement the Box integration in `lib/box.ts`
    - Implement `createBoxFolder`, `uploadTextFileToBox` (multipart with `attributes` before `file`, sanitized filenames), `getBoxFolderUrl`, and `getBoxFileUrl`; credentials absent → deterministic mock ids/urls and never throws; credentials present + failure → throw `BoxSystemError` (no mock fallback)
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

  - [ ]* 5.5 Write property test for Box dual-mode behavior
    - **Property 18: Box client dual-mode behavior** (creds absent → mock id/url, never throws; creds present + underlying failure → propagates system error, returns no mock id/url)
    - **Validates: Requirements 13.2, 13.3**

  - [ ]* 5.6 Write integration test for Box real-mode operations and path placement
    - Test folder creation, file upload, and URL construction against a fake Box API, and assert snapshot path `/PageVault/{room}/snapshots/{timestamp}/` and report path `/PageVault/{room}/reports/`
    - _Requirements: 13.1, 13.4, 13.5_

  - [ ] 5.7 Implement the AI integration in `lib/ai.ts`
    - Implement `analyzePageChange(input)` returning a structurally valid `ChangeAnalysisResult`; real mode calls the OpenAI-compatible Chat Completions endpoint with the JSON-only analyst prompt and parses the result; mock/fallback (creds absent, call failure, or unparseable JSON) returns a deterministic mock that derives severity/type from before/after text and always yields ≥1 grounded evidence item with non-empty summary and interpretation; the function never rejects
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 14.1, 14.2, 14.3, 14.4, 14.5_

  - [ ]* 5.8 Write property test for analyzer total-function shape
    - **Property 15: Analyzer always produces a structurally valid result** (across creds-absent, call-failure, unparseable, and valid-JSON cases)
    - **Validates: Requirements 7.2, 14.2, 14.3, 14.4, 14.5**

  - [ ]* 5.9 Write property test for mock evidence grounding
    - **Property 16: Mock evidence is grounded in the provided texts** (every before drawn from previous text, every after from current text)
    - **Validates: Requirements 7.5**

  - [ ]* 5.10 Write example/integration tests for analyzer judgments and real-mode prompt
    - Unit-test mock severity judgments: formatting-only change → `low` (7.3), pricing/security change → not `low` (7.4); integration-test that real mode issues a JSON-only analyst prompt and parses the response (14.1)
    - _Requirements: 7.3, 7.4, 14.1_

- [ ] 6. Insforge data layer
  - [ ] 6.1 Implement the Insforge client and room/URL helpers in `lib/insforge.ts`
    - Implement `getDb()` (throws `InsforgeUnavailableError` when no creds), `createRoom`, `listRoomsWithStats`, `getRoom`, `addWatchedUrls` (using `buildWatchedUrlRows`), and `listWatchedUrls`
    - Implement the pure selectors used by stats: `computeSeverityCounts(changes)` and `selectLatestCompletedScanAt(scanRuns)`, and use them inside `listRoomsWithStats`
    - _Requirements: 1.1, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 15.2_

  - [ ] 6.2 Implement scan-run, snapshot, and change-analysis helpers in `lib/insforge.ts`
    - Implement `createScanRun`, `completeScanRun`, `failScanRun`, `getLatestScanRun`, `insertSnapshot`, `findPreviousSnapshot`, `insertChangeAnalysis`, `listChanges`, `getChange`, and `countBySeverity`
    - Implement the pure selectors `selectPreviousSnapshot(snapshots, currentCapturedAt)` and `sortAndLimitChanges(changes, limit?)` (created-at desc, ties by id desc), and use them inside `findPreviousSnapshot` and `listChanges`
    - _Requirements: 4.1, 4.5, 5.2, 5.5, 5.6, 7.6, 8.1, 9.1, 9.2, 10.1_

  - [ ]* 6.3 Write property test for severity counts aggregation
    - **Property 7: Severity counts aggregation** (against `computeSeverityCounts`)
    - **Validates: Requirements 2.2**

  - [ ]* 6.4 Write property test for last-scan time selection
    - **Property 8: Last-scan time selection** (against `selectLatestCompletedScanAt`)
    - **Validates: Requirements 2.3, 2.4**

  - [ ]* 6.5 Write property test for previous-snapshot selection
    - **Property 9: Previous-snapshot selection** (against `selectPreviousSnapshot`)
    - **Validates: Requirements 5.5, 5.6, 6.2**

  - [ ]* 6.6 Write property test for changes timeline ordering and limit
    - **Property 19: Changes timeline ordering and limit** (against `sortAndLimitChanges`: full ordering, ≤20 truncation, empty → empty)
    - **Validates: Requirements 9.1, 9.2, 8.1**

  - [ ]* 6.7 Write unit tests for data-layer helpers
    - Use an in-memory fake to cover list-rooms empty case (2.1) and retrieval-failure surfacing without partial data (2.5)
    - _Requirements: 2.1, 2.5_

- [ ] 7. Scan orchestrator
  - [ ] 7.1 Implement scan pipeline pure helpers in `lib/scan.ts`
    - Implement `normalizeContent(result)` (markdown when present and non-empty, else plain text), `buildSnapshotInput(...)` (title defaults to empty string when absent), `deriveTimestampSegment(scanRun.startedAt)` (single value shared by snapshots and raw results), and `normalizeSeverity` / `normalizeChangeType` (out-of-set → `low` / `unknown`, other fields untouched)
    - _Requirements: 4.4, 5.2, 5.3, 5.4, 7.8, 7.9_

  - [ ]* 7.2 Write property test for normalized content selection
    - **Property 11: Normalized content prefers markdown over text**
    - **Validates: Requirements 4.4**

  - [ ]* 7.3 Write property test for snapshot field construction
    - **Property 10: Snapshot field construction with title defaulting**
    - **Validates: Requirements 5.2**

  - [ ]* 7.4 Write property test for same-folder evidence consistency
    - **Property 12: Same-folder evidence consistency** (one timestamp segment for `raw-apify-results.json` and every snapshot markdown of the scan)
    - **Validates: Requirements 5.4, 5.3**

  - [ ]* 7.5 Write property test for persisted enum normalization
    - **Property 14: Persisted enum normalization preserves other fields**
    - **Validates: Requirements 7.8, 7.9**

  - [ ] 7.6 Implement the `runScan` orchestration pipeline in `lib/scan.ts`
    - Compose `lib/insforge`, `lib/apify`, `lib/box`, `lib/diff`, and `lib/ai`: create the scan run (`running`, `started_at`) before any crawl; handle the no-URLs case as immediate `completed` with zero counts; upload raw results and per-page snapshot markdown under the shared timestamp folder; insert snapshots with content hashes; find the previous snapshot and request exactly one analysis only when a previous snapshot exists and hashes differ; normalize enums; insert change analyses and upload reports; complete the run with counts; on any post-creation failure mark the run `failed` with `error_message` and never `completed`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.9, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4, 7.1, 7.6, 7.7, 7.8, 7.9, 15.1, 15.3_

  - [ ]* 7.7 Write property test for the analysis-creation invariant
    - **Property 13: Analysis-creation invariant** (analysis created and analyzer invoked exactly once iff previous snapshot exists and hashes differ)
    - **Validates: Requirements 6.3, 6.4, 5.6, 6.2**

  - [ ]* 7.8 Write property test for scan summary counts
    - **Property 20: Scan summary counts are accurate**
    - **Validates: Requirements 4.6**

  - [ ]* 7.9 Write property test for the scan failure invariant
    - **Property 21: Scan failure invariant** (failure injected after run creation → terminal `failed` with non-empty message, never `completed`)
    - **Validates: Requirements 4.7**

  - [ ]* 7.10 Write property test for end-to-end completion in Demo_Mode
    - **Property 22: End-to-end completion in Demo_Mode** (any credential-presence combination with no configured-Box failure → `completed` and a structurally valid summary; no-URL room completes without crawling and reports zero counts)
    - **Validates: Requirements 15.1, 15.3, 4.1, 4.9, 4.5**

  - [ ]* 7.11 Write integration tests for AI wiring and persisted analysis fields
    - Assert the analyzer receives url, page type, previous text, and current text (7.1), and that the inserted change-analysis row carries all required fields (7.6)
    - _Requirements: 7.1, 7.6_

- [ ] 8. Checkpoint - core pipeline complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Demo seed
  - [ ] 9.1 Implement `seedDemo()` in `lib/seed.ts`
    - Create the `DemoCo` room (category `competitor`) and Box folder; add the five Watched_URLs (Homepage, Pricing, Security Docs, Changelog, Careers); insert previous/current snapshots with distinct hashes; insert the documented change analyses (pricing, SSO, API access, homepage positioning, careers addition) with the upmarket business interpretation and the four recommended actions; return the room id; wrap each snapshot/analysis insert so an individual failure is logged and skipped while seeding continues
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

  - [ ]* 9.2 Write property test for demo seed partial-failure tolerance
    - **Property 23: Demo seed tolerates partial failure** (any failing subset of inserts → operation completes, returns room id, creates all non-failing records)
    - **Validates: Requirements 11.6**

  - [ ]* 9.3 Write unit tests for demo seed content
    - Assert the DemoCo room and five URLs (11.1), previous/current snapshots (11.2), the documented analyses (11.3), the upmarket interpretation and four recommended actions (11.4), and the returned room id (11.5)
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

- [ ] 10. API routes
  - [ ] 10.1 Implement `/api/rooms` (POST create, GET list) in `app/api/rooms/route.ts`
    - POST validates input, creates the Box folder `/PageVault/{name}`, inserts the room with `box_folder_id`, returns `201` with the created room, returns `400` on invalid field, and returns `500` when Box folder creation fails; GET returns `RoomWithStats[]` (empty when none) with high/medium counts and last completed scan time, surfacing retrieval failures as `500`; use the shared `{ error: { code, message, field? } }` envelope
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ] 10.2 Implement room-detail and add-URLs routes
    - `app/api/rooms/[roomId]/route.ts` (GET) returns `{ room, watchedUrls, latestScan, changes[≤20] }` or `404`; `app/api/rooms/[roomId]/urls/route.ts` (POST) validates and inserts watched URLs, returning `201` with the inserted rows, `404` for a missing room, and `400` for invalid entries or counts (no rows inserted on failure)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 8.1, 8.2, 8.3_

  - [ ] 10.3 Implement scan, changes, change-detail, and demo-seed routes
    - `app/api/rooms/[roomId]/scan/route.ts` (POST) returns `404` for a missing room, otherwise invokes `runScan` and returns the `ScanSummary` (or `500` when the run fails); `app/api/rooms/[roomId]/changes/route.ts` (GET) returns ordered `ChangeAnalysis[]` or `404`; `app/api/changes/[changeId]/route.ts` (GET) returns the change detail or `404`; `app/api/demo/seed/route.ts` (POST) returns `{ roomId }` or `503` when Insforge is unavailable
    - _Requirements: 4.6, 4.7, 4.8, 9.1, 9.2, 9.3, 10.1, 10.2, 11.5, 15.2_

  - [ ]* 10.4 Write integration tests for API routes
    - Cover create-room success shape and Box-folder error propagation (1.1, 1.5, 1.6); not-found behaviors for add URLs (3.4), scan (4.8), room detail (8.3), changes (9.3), and change detail (10.2); room-detail assembly bundling room/urls/latest-scan/changes (8.1); and the Insforge-unavailable `503` path (15.2)
    - _Requirements: 1.1, 1.5, 1.6, 3.4, 4.8, 8.1, 8.3, 9.3, 10.2, 15.2_

- [ ] 11. Checkpoint - backend complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 12. UI components and theming
  - [ ] 12.1 Implement UI primitives and layout components
    - Implement `components/ui/` (Button, Modal, Badge, Card, EmptyState) and `components/layout/` (Header, TaglineBanner, SetupBanner) with the dark/neutral vault theme; `SetupBanner` describes required configuration when Insforge is unavailable
    - _Requirements: 15.2, 16.1_

  - [ ] 12.2 Implement rooms components
    - Implement `components/rooms/` (RoomCard with name/target/category/last-scan/high+medium counts/Open Room/Open Box Folder link, CreateRoomForm with name/target/category and repeatable URL rows, WatchedUrlList, ScanStatus)
    - _Requirements: 8.4, 8.6, 16.3_

  - [ ] 12.3 Implement changes components
    - Implement `components/changes/` (SeverityBadge, ChangeCard, ChangeTimeline rendering one card per analysis in order with empty-state placeholder, EvidenceTable with before/after/explanation rows, RecommendedActions)
    - _Requirements: 9.4, 9.5, 10.3_

- [ ] 13. Frontend pages
  - [ ] 13.1 Implement Home (`/`) and Rooms dashboard (`/rooms`)
    - Home shows the product name, the tagline "AI memory for the changing web", and `Create Memory Room` and `Load Demo` controls; `Load Demo` calls `/api/demo/seed` then routes to the seeded room; the dashboard renders one `RoomCard` per room with the Open Box Folder link wired via `getBoxFolderUrl`
    - _Requirements: 16.1, 16.2, 16.3, 8.6_

  - [ ] 13.2 Implement Create room (`/rooms/new`) and Room detail (`/rooms/[roomId]`)
    - Create-room page renders `CreateRoomForm` and submits to the rooms/URLs APIs; room detail shows title, target, watched URLs, a Run Scan control wired to the scan API, an Open Box Folder control via `getBoxFolderUrl`, latest scan status, and a ≤20-entry changes timeline, rendering placeholders for missing/failed sections without throwing
    - _Requirements: 1.1, 3.1, 4.6, 8.4, 8.5, 8.6_

  - [ ] 13.3 Implement Change detail (`/changes/[changeId]`)
    - Render severity, change type, summary, business interpretation, a before/after evidence table, recommended actions, and a Box report link via `getBoxFileUrl`; render a clear "change does not exist" state with no analysis fields when not found
    - _Requirements: 10.3, 10.4_

  - [ ]* 13.4 Write UI/snapshot tests for pages and components
    - Cover home elements + tagline (16.1) and Load-Demo flow (16.2); dashboard cards + Open Box Folder link (16.3, 8.6); room detail required elements (8.4) and placeholder resilience (8.5); timeline cards + ordering (9.4) and empty-state (9.5); change detail fields + evidence table + report link (10.1, 10.3) and not-found state (10.4); and the Insforge-unavailable setup banner (15.2)
    - _Requirements: 8.4, 8.5, 9.4, 9.5, 10.1, 10.3, 10.4, 15.2, 16.1, 16.2, 16.3_

- [ ] 14. Supporting artifacts
  - [ ] 14.1 Create the database migration in `db/migration.sql`
    - Define the five tables (`memory_rooms`, `watched_urls`, `scan_runs`, `page_snapshots`, `change_analyses`) with uuid PKs, timestamptz defaults, cascading foreign keys, and the four indexes from the design
    - _Requirements: 1.1, 3.1, 4.1, 5.2, 7.6_

  - [ ] 14.2 Create the standalone demo seed runner in `scripts/seed-demo.ts`
    - Wire `scripts/seed-demo.ts` to invoke `seedDemo()` and print the seeded room id
    - _Requirements: 11.1, 11.5_

  - [ ] 14.3 Create `.env.example` and `README.md`
    - `.env.example` lists all environment variables (Insforge, Apify, Box, OpenAI) with comments noting that missing credentials enable Demo_Mode; `README.md` documents setup, environment variables, demo instructions, and the architecture summary
    - _Requirements: 15.1, 15.2_

- [ ] 15. Final integration and verification
  - [ ] 15.1 Wire remaining integration points and remove orphaned code
    - Confirm every page calls its API route, every route delegates to the library layer, the seed script and migration are referenced from the README, and there is no unintegrated code
    - _Requirements: 15.1, 15.3, 16.2_

  - [ ] 15.2 Run typecheck, build, and the full test suite
    - Run the TypeScript typecheck, the production build, and the complete Vitest suite (property, unit, integration, and UI/snapshot tests) and fix any failures
    - _Requirements: 4.6, 4.7, 7.2, 15.1, 15.3_

## Notes

- Tasks marked with `*` are optional test tasks and can be skipped for a faster MVP, but the property tests directly validate the design's correctness guarantees and are strongly recommended.
- Each task references the specific requirement clauses it implements for traceability; each property test task references its design property number and the requirements it validates.
- Property-based tests use `fast-check` + Vitest, run a minimum of 100 iterations, replace external services with in-memory fakes, simulate credential presence by toggling `lib/env.ts`, and are tagged `// Feature: pagevault, Property {number}: {property_text}`.
- Checkpoints (tasks 4, 8, 11) ensure incremental validation at phase boundaries.
- The 23 design properties map to the property test tasks as: P1→3.3, P2→3.5, P3→3.6, P4→3.7, P5→3.8, P6→3.9, P7→6.3, P8→6.4, P9→6.5, P10→7.3, P11→7.2, P12→7.4, P13→7.7, P14→7.5, P15→5.8, P16→5.9, P17→5.2, P18→5.5, P19→6.6, P20→7.8, P21→7.9, P22→7.10, P23→9.2.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "14.1"] },
    { "id": 2, "tasks": ["3.1", "3.2", "3.4", "12.1"] },
    { "id": 3, "tasks": ["3.3", "3.5", "3.6", "3.7", "3.8", "3.9", "3.10", "5.1", "5.4", "5.7", "6.1", "7.1", "12.2", "12.3"] },
    { "id": 4, "tasks": ["5.2", "5.3", "5.5", "5.6", "5.8", "5.9", "5.10", "6.2", "6.3", "6.4", "7.2", "7.3", "7.4", "7.5"] },
    { "id": 5, "tasks": ["6.5", "6.6", "6.7", "7.6", "9.1", "10.1", "10.2"] },
    { "id": 6, "tasks": ["7.7", "7.8", "7.9", "7.10", "7.11", "9.2", "9.3", "10.3"] },
    { "id": 7, "tasks": ["10.4", "13.1", "13.2", "13.3", "14.2", "14.3"] },
    { "id": 8, "tasks": ["13.4", "15.1"] },
    { "id": 9, "tasks": ["15.2"] }
  ]
}
```
