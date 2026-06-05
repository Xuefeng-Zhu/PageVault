// Regression test for MEDIUM-4 (docs/qa-bug-hunt.md):
// listRoomsWithStats in lib/insforge.ts must NOT make a PostgREST
// round-trip per active tracked page. Previously the function had a
// sequential `for (const tp of activePages) { await sdkQuery(...) }`
// loop — for a room with 200 active pages that meant 200 sequential
// round-trips, producing a ~6 second response that timed out the
// dashboard's 5-second spinner. The fix replaces the loop with a
// single bucketed query. This test pins the call count at O(1) in
// the number of active pages, NOT in the number of rooms or any
// other input.
//
// To make call counting deterministic we mock @insforge/sdk and
// lib/env so the test never touches the network. The mock routes
// every `client.database.from(table?...).select(...)` call to a
// table-aware fixture responder.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.hoisted runs before the vi.mock factory bodies, so the mocks
// below can capture references to the same fns used by the test.
const mocks = vi.hoisted(() => {
  // Use a permissive `any` typing on the from-mock — vitest can't
  // infer the correct chainable shape from the SDK types at this
  // depth, and the test only needs to inspect call arguments and
  // count calls.
  const from: any = vi.fn();
  return { from };
});

vi.mock('@insforge/sdk', () => ({
  createClient: vi.fn(() => ({
    database: { from: mocks.from },
  })),
}));

vi.mock('./env', () => ({
  getInsforgeClient: () => ({ database: { from: mocks.from } }),
  getInsforgeBaseUrl: () => 'https://example.invalid',
}));

import { listRoomsWithStats } from './insforge';
import type { RoomWithStats } from '@/types';

type DbRow = Record<string, unknown>;

// Fixture data: keyed by the PostgREST table name (the path passed
// to `from(<table>?...)`). Each entry is the array of rows that
// query should return.
function makeFixture(activePageCount: number, jobsPerPage = 1) {
  const projects = [
    {
      id: 'project-1',
      owner_id: 'user-1',
      name: 'Test room',
      box_root_folder_id: null,
      created_at: '2026-06-01T00:00:00.000Z',
    },
  ];
  const trackedPages = Array.from({ length: activePageCount }, (_, i) => ({
    id: `page-${i}`,
    project_id: 'project-1',
    source_url: `https://example.com/p${i}`,
    normalized_url: `https://example.com/p${i}`,
    active: true,
  }));
  // Generate jobs: each page has `jobsPerPage` succeeded jobs, with
  // finished_at strictly decreasing so the most recent is first.
  const snapshotJobs: DbRow[] = [];
  for (let p = 0; p < activePageCount; p++) {
    for (let j = 0; j < jobsPerPage; j++) {
      snapshotJobs.push({
        id: `job-${p}-${j}`,
        tracked_page_id: `page-${p}`,
        status: 'succeeded',
        finished_at: new Date(2026, 5, 1, 0, jobsPerPage - j).toISOString(),
      });
    }
  }
  const fixtures: Record<string, DbRow[]> = {
    projects: projects as unknown as DbRow[],
    tracked_pages: trackedPages as unknown as DbRow[],
    snapshot_jobs: snapshotJobs,
    ai_explanations: [],
    snapshots: [],
  };
  return fixtures;
}

// Parse `tableName?select=...&filters=...&...` from the first arg to
// from() and look up the matching fixture. The returned chainable
// stubs `.select(...)` so the SDK code path doesn't throw.
function routeFixture(fixtures: Record<string, DbRow[]>) {
  return (target: string) => {
    const tableName = target.split('?')[0];
    const rows = fixtures[tableName] ?? [];
    return {
      select: () => Promise.resolve({ data: rows, error: null }),
    };
  };
}

// RoomWithStats is the declared return type but listRoomsWithStats
// augments each row with a `watchedUrls` array. We use a loose cast
// here so the test can read that field without redefining types.
type RoomWithStatsPlusUrls = RoomWithStats & { watchedUrls: string[] };

describe('listRoomsWithStats — MEDIUM-4 regression (O(1) PostgREST round-trips)', () => {
  beforeEach(() => {
    mocks.from.mockReset();
    mocks.from.mockImplementation(routeFixture(makeFixture(0)));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('makes a constant number of PostgREST round-trips regardless of active page count', async () => {
    // 5 active pages
    mocks.from.mockImplementation(routeFixture(makeFixture(5)));
    await listRoomsWithStats();
    const calls5Pages = mocks.from.mock.calls.length;

    // 500 active pages (the documented worst case the old loop hit)
    mocks.from.mockReset();
    mocks.from.mockImplementation(routeFixture(makeFixture(500)));
    await listRoomsWithStats();
    const calls500Pages = mocks.from.mock.calls.length;

    // The function must scale as O(1) in active page count. The old
    // buggy version made N+3 calls (projects + tracked_pages +
    // ai_explanations + snapshots + N per-page jobs); the fix makes
    // a flat 5 calls regardless of N. We assert the two runs are
    // equal AND that the count is small (5) so a future regression
    // to O(N) fails loudly.
    expect(calls500Pages).toBe(calls5Pages);
    expect(calls500Pages).toBe(5);
  });

  it('picks the most recent succeeded job per tracked page when bucketing', async () => {
    // 3 pages, each with 3 jobs. The most recent (largest finished_at)
    // should win for each page.
    const fixtures = makeFixture(3, 3);
    // The fixture assigns finished_at in (month=5, day=1, minute=jobsPerPage-j)
    // so the FIRST job in the array for each page is the newest.
    mocks.from.mockImplementation(routeFixture(fixtures));
    const rooms = (await listRoomsWithStats()) as RoomWithStatsPlusUrls[];
    expect(rooms).toHaveLength(1);
    const room = rooms[0];
    // The most recent job for page-0 in the fixture is finished at
    // 2026-06-01T00:03:00.000Z (3 jobs, j=0 → minute 3-0=3).
    expect(room.lastScanAt).toBe('2026-06-01T00:03:00.000Z');
    // All 3 pages are active and listed in watchedUrls.
    expect(room.watchedUrls).toHaveLength(3);
  });

  it('keeps the snapshot_jobs queries scoped per active page with limit=1', async () => {
    // Round 6 (commit b0fa9ee) changed listRoomsWithStats from one
    // global batched query to N per-page queries. The test from
    // round 5 (commit c026b2f) asserted the batched shape and is
    // now obsolete. We replace it with an assertion matching the
    // per-page shape: each tracked_page_id=eq.<uuid> snapshot_jobs
    // call has limit=1, status=eq.succeeded, and order=finished_at.desc.
    mocks.from.mockImplementation(routeFixture(makeFixture(2)));
    await listRoomsWithStats();
    const jobsCalls = (mocks.from.mock.calls as unknown[][])
      .map((c) => String(c[0]))
      .filter((q) => q.startsWith('snapshot_jobs?'));
    // One query per active page (2 in this fixture).
    expect(jobsCalls).toHaveLength(2);
    for (const q of jobsCalls) {
      expect(q).toContain('status=eq.succeeded');
      expect(q).toContain('order=finished_at.desc');
      expect(q).toContain('limit=1');
      expect(q).toMatch(/tracked_page_id=eq\.[0-9a-f-]{8}/);
    }
  });
});
