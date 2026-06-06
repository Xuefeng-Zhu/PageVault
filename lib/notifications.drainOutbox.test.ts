// Tests for lib/notifications.ts drainOutbox() — pins the MEDIUM-3
// acceptance criteria from docs/qa-bug-hunt.md.
//
// Original code:
//   async function dbRpc(...) { if (!r.ok) return null; ... }
//   const got = await dbRpc('acquire_notification_lock', { arg: 42 });
//   if (got !== true) return { processed: 0, succeeded: 0, failed: 0 };
//
// Three outcomes were collapsed into one: "RPC endpoint is down",
// "peer holds the lock", and "we hold the lock with no work". The
// new code distinguishes them as { acquired, error? } so the cron
// route can 5xx and operator alerting can fire on a broken RPC.
//
// AC pinned here:
//   (a) RPC endpoint down (5xx)  -> result.error is set with the
//       actual status code; the route layer 5xxes.
//   (b) RPC transport error      -> result.error is set with
//       status=0 (network failure surface).
//   (c) RPC returns `false`     -> result.acquired === false and
//       result.error is NOT set (healthy peer-hold skip).
//   (d) RPC returns `true` and
//       the outbox is empty     -> result.acquired === true, no
//       error, processed=0. The old behavior is preserved.
//   (e) RPC 5xx with empty body -> error string is still useful
//       (status=N body=(empty)) — no swallowed null.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Force-set required env vars BEFORE importing the module so the
// SRK() / getInsforgeBaseUrl() helpers don't blow up.
process.env.INSFORGE_API_URL = process.env.INSFORGE_API_URL || 'https://insforge.test';
process.env.INSFORGE_SERVICE_ROLE_KEY = process.env.INSFORGE_SERVICE_ROLE_KEY || 'test-srk';

// Mock the env helpers the module reads at import time. We use
// vi.mock with a factory so the module picks up our sentinel base
// URL regardless of the test process's actual env.
vi.mock('@/lib/env', () => ({
  getInsforgeClient: () => ({}),
  getInsforgeBaseUrl: () => 'https://insforge.test',
  isPresent: () => true,
}));

const { drainOutbox } = await import('@/lib/notifications');

// A minimal Response shape that satisfies the lib's .ok / .status /
// .text() / .json() usage. We don't pull in fetch's body-stream
// semantics because the lib only ever calls .text() / .json() once.
function makeResponse(opts: {
  status: number;
  body?: string;
}): Response {
  return {
    ok: opts.status >= 200 && opts.status < 300,
    status: opts.status,
    text: async () => opts.body ?? '',
    json: async () => (opts.body ? JSON.parse(opts.body) : null),
  } as unknown as Response;
}

describe('drainOutbox — MEDIUM-3 acceptance', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('(a) RPC 5xx with body -> result.error set with status=N, no acquired=false, no silent zero', async () => {
    // AC (a): the operator's alerting must see this as a 5xx, not
    // a healthy 200 with processed=0. We assert the structural
    // property the route layer uses: result.error is truthy AND
    // result.acquired is true (the "we tried, it's broken" case —
    // not the peer-hold case).
    fetchSpy.mockResolvedValueOnce(
      makeResponse({ status: 503, body: 'service unavailable' }),
    );

    const result = await drainOutbox(50);

    expect(result.error).toBeDefined();
    expect(result.error).toMatch(/acquire_notification_lock RPC failed: status=503/);
    // acquired:true distinguishes "broken RPC" from "peer has the
    // lock". The previous worker decision (see comment thread) is
    // that false is reserved for the healthy peer-hold case.
    expect(result.acquired).toBe(true);
    expect(result.processed).toBe(0);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(0);
    // Only the acquire RPC should have been called — no outbox
    // query, no release.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toContain('/api/database/rpc/acquire_notification_lock');
  });

  it('(b) RPC transport error (ECONNREFUSED) -> result.error set with status=0', async () => {
    // AC (b): a network failure (DNS, TLS, refused) must surface
    // as a structured error. The lib reserves status=0 for the
    // transport-failure case so callers can tell it apart from
    // server-side 5xx at a glance.
    const networkErr = new Error('fetch failed');
    (networkErr as Error & { cause?: unknown }).cause = { code: 'ECONNREFUSED' };
    fetchSpy.mockRejectedValueOnce(networkErr);

    const result = await drainOutbox(50);

    expect(result.error).toBeDefined();
    expect(result.error).toMatch(/acquire_notification_lock RPC transport error: status=0/);
    expect(result.acquired).toBe(true);
    expect(result.processed).toBe(0);
  });

  it('(c) RPC returns false (peer holds lock) -> result.acquired === false, no error', async () => {
    // AC (c): peer-hold is a healthy skip, NOT an error. The
    // route layer returns 200 (the worker did its job — it found
    // nothing to do because someone else is doing it). The
    // boolean `false` from the RPC is the trigger for this
    // branch; null and missing body would NOT be (they were the
    // old null-swallow bug).
    fetchSpy.mockResolvedValueOnce(
      makeResponse({ status: 200, body: 'false' }),
    );

    const result = await drainOutbox(50);

    expect(result.acquired).toBe(false);
    expect(result.error).toBeUndefined();
    expect(result.processed).toBe(0);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(0);
  });

  it('(d) RPC returns true, empty outbox -> result.acquired === true, no error, processed=0', async () => {
    // AC (d): the original "no work to do" behavior is preserved.
    // We must NOT regress to the old shape that mixed this with
    // the peer-hold case.
    fetchSpy.mockResolvedValueOnce(
      makeResponse({ status: 200, body: 'true' }),
    );
    // The lib then queries the outbox; return an empty array.
    fetchSpy.mockResolvedValueOnce(
      makeResponse({ status: 200, body: '[]' }),
    );
    // Release lock is best-effort; mock it to a 200/true.
    fetchSpy.mockResolvedValueOnce(
      makeResponse({ status: 200, body: 'true' }),
    );

    const result = await drainOutbox(50);

    expect(result.acquired).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.processed).toBe(0);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(0);
  });

  it('(e) RPC 5xx with empty body -> result.error still includes status=N body=(empty)', async () => {
    // The original code's `!text -> return null` swallowed an
    // empty 5xx body into a silent null. The new code uses
    // r.text() to capture whatever the server returned (or
    // '(empty)' if it really was blank) and includes it in the
    // error string. This pins that an operator can grep for
    // status=N in the logs even when the body is missing.
    fetchSpy.mockResolvedValueOnce(
      makeResponse({ status: 500, body: '' }),
    );

    const result = await drainOutbox(50);

    expect(result.error).toBeDefined();
    expect(result.error).toMatch(/status=500/);
    expect(result.error).toMatch(/body=\(empty\)|body=$/);
    expect(result.acquired).toBe(true);
  });
});
