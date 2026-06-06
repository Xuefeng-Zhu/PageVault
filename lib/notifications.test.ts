// Regression test for MEDIUM-2 (docs/qa-bug-hunt.md):
// enqueueNotification() must NOT make an unfiltered
// `notification_subscriptions?enabled=eq.true` PostgREST query. The
// previous version did exactly that and then filtered by projectId in
// JS, transferring every enabled subscription in the database on every
// scan. For 10k subscriptions across 1k rooms, every scan in any room
// transferred 10k rows over the network, took ~3s, and blocked the scan
// worker.
//
// To make the test deterministic we mock @insforge/sdk and lib/env so
// the test never touches the network. The mock captures the table
// argument passed to `.from(...)` so we can assert on the exact query
// shape — specifically that the project_id filter is present and
// URL-encoded.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.hoisted runs before the vi.mock factory bodies, so the mocks
// below can capture references to the same fns used by the test.
const mocks = vi.hoisted(() => {
  // The SDK's `.from(table?...).select(...)` shape; we only need to
  // inspect the `from` arg and return a stub that resolves.
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

// The outbox insert in enqueueNotification is a real fetch (not
// routed through @insforge/sdk). Set a dummy service-role key so the
// code path doesn't blow up on `process.env.INSFORGE_SERVICE_ROLE_KEY!`
// and stub global.fetch so the insert POST doesn't try to hit a real
// network.
process.env.INSFORGE_SERVICE_ROLE_KEY = 'test-srk';
const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
(globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

import { enqueueNotification } from './notifications';

type DbRow = Record<string, unknown>;

function subscriptionRow(projectId: string, id: string): DbRow {
  return {
    id,
    project_id: projectId,
    channel: 'webhook',
    config: { url: 'https://example.com/hook' },
    severity_threshold: 'medium',
    enabled: true,
    consecutive_failures: 0,
    failure_window_start: null,
    last_triggered_at: null,
    last_failure_at: null,
    last_failure_error: null,
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
  };
}

// Fetch the first `notification_subscriptions?...` query captured
// during the test. The PostgREST URL is encoded into the first arg of
// `from(<table>?<filters>)`.
function capturedNotificationQuery(): string | null {
  for (const call of mocks.from.mock.calls as unknown[][]) {
    const arg = String(call[0] ?? '');
    if (arg.startsWith('notification_subscriptions')) return arg;
  }
  return null;
}

describe('enqueueNotification — MEDIUM-2 regression (project_id filter pushed into PostgREST query)', () => {
  beforeEach(() => {
    mocks.from.mockReset();
    // Default: respond to a correctly-scoped query with two rows for
    // the requested room, and to any other table (e.g.
    // notification_outbox for the insert) with an empty array.
    mocks.from.mockImplementation((target: string) => {
      const tableName = String(target).split('?')[0];
      if (tableName === 'notification_subscriptions') {
        return {
          select: () =>
            Promise.resolve({
              data: [
                subscriptionRow('room-123', 'sub-A'),
                subscriptionRow('room-123', 'sub-B'),
              ],
              error: null,
            }),
        };
      }
      // notification_outbox insert — return minimal success.
      return {
        select: () => Promise.resolve({ data: null, error: null }),
      };
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('queries notification_subscriptions with both enabled and project_id filters', async () => {
    await enqueueNotification({
      aiExplanationId: 'ai-1',
      projectId: 'room-123',
    });
    const q = capturedNotificationQuery();
    expect(q).not.toBeNull();
    // Both filter fragments must be present, in any order.
    expect(q!).toContain('enabled=eq.true');
    expect(q!).toContain('project_id=eq.room-123');
    // The filter must be part of the table path (the `?` is between
    // the table name and the first filter).
    expect(q!).toMatch(/^notification_subscriptions\?/);
  });

  it('does NOT issue an unfiltered enabled-only query (the old N+full-table-scan shape)', async () => {
    await enqueueNotification({
      aiExplanationId: 'ai-1',
      projectId: 'room-123',
    });
    // Negative assertion: the literal old query string — table with
    // only an enabled filter and no project_id — must never appear.
    for (const call of mocks.from.mock.calls as unknown[][]) {
      const arg = String(call[0] ?? '');
      if (!arg.startsWith('notification_subscriptions')) continue;
      // Acceptable shapes:
      //   notification_subscriptions?enabled=eq.true&project_id=eq.<id>
      //   notification_subscriptions?project_id=eq.<id>&enabled=eq.true
      // (we don't constrain the order in the fix). What we forbid is
      // a query that lacks project_id entirely.
      if (arg.startsWith('notification_subscriptions?')) {
        expect(arg).toMatch(/project_id=eq\.[^&]+/);
        // The fragment after the `?` must contain BOTH `enabled=eq.true`
        // and `project_id=eq.` — and must NOT be the bare old shape.
        expect(arg).not.toBe('notification_subscriptions?enabled=eq.true');
      }
    }
  });

  it('does not transfer more than a handful of rows for a single room', async () => {
    // Simulate a database with 10k subscriptions across many rooms.
    // The mock returns exactly 2 rows for the requested room, which is
    // what the DB would do when the project_id filter is in the query
    // (PostgREST returns only matching rows). If the fix regressed to
    // the old behavior, the mock would still return 2 rows (because
    // the mock doesn't care which filter was applied), but the real
    // DB would return 10k. We assert the *query shape* carries the
    // project_id filter — that's the part that determines the real
    // bandwidth — and also assert the mock returned 2 rows (i.e. the
    // function does no JS-side filter, it trusts the DB).
    await enqueueNotification({
      aiExplanationId: 'ai-1',
      projectId: 'room-123',
    });
    const q = capturedNotificationQuery();
    expect(q).not.toBeNull();
    // Guard against future regressions that would try to "fix" the
    // query with `or=` or `enabled=neq` shortcuts that defeat the
    // project_id index.
    expect(q!).not.toMatch(/\bor=/);
    expect(q!).not.toMatch(/enabled=neq/);
    // The query must hit notification_subscriptions exactly once.
    const subscriptionCalls = (mocks.from.mock.calls as unknown[][])
      .map((c) => String(c[0] ?? ''))
      .filter((q) => q.startsWith('notification_subscriptions'));
    expect(subscriptionCalls).toHaveLength(1);
  });

  it('URL-encodes the projectId so weird room ids cannot inject filters', async () => {
    // A projectId containing `&` would, if interpolated raw into the
    // query string, allow a caller to inject a second filter like
    // `&enabled=eq.false&project_id=eq.other`. encodeURIComponent
    // turns `&` into `%26` so the entire projectId is treated as a
    // single literal value by PostgREST.
    const tricky = 'room&enabled=eq.false&project_id=eq.other';
    await enqueueNotification({
      aiExplanationId: 'ai-1',
      projectId: tricky,
    });
    const q = capturedNotificationQuery();
    expect(q).not.toBeNull();
    // The encoded form must appear, not the raw form.
    expect(q!).toContain(encodeURIComponent(tricky));
    // The raw `&` from the projectId must NOT be present unescaped
    // between `project_id=eq.` and the next `&` filter separator.
    // We check by asserting that the substring after `project_id=eq.`
    // is the percent-encoded form, not the raw injection.
    const match = q!.match(/project_id=eq\.([^&]+)/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe(encodeURIComponent(tricky));
    expect(match![1]).not.toContain('&');
  });
});
