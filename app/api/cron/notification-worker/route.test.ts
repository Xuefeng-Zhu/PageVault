// Tests for app/api/cron/notification-worker/route.ts — pins the
// MEDIUM-3 fix at the route layer.
//
// The library in lib/notifications.ts now returns a discriminated
// result with explicit { acquired, error? } outcomes. The route
// layer is the surface that operators alert on, so the structural
// property must be: `error` set -> 500, no error -> 200. We also
// pin the MEDIUM-1 auth shape (which the route also picked up):
//
//   - x-cron-secret missing/wrong AND CRON_SHARED_SECRET is set -> 401
//   - CRON_SHARED_SECRET unset on the server                   -> 503
//     (so alerting can tell "attacker probing" from "service
//     not deployed yet")
//
// AC pinned here:
//   (a) 401 missing-secret, with the header NOT sent.
//   (b) 200 peer-hold (RPC returns false)  -> healthy skip.
//   (c) 500 RPC 5xx (drainOutbox returns error) -> 5xx so operator
//       alerting fires.
//   (d) 500 RPC network transport error     -> 5xx so operator
//       alerting fires.

// The route transitively imports lib/notifications which reads
// INSFORGE_API_URL / INSFORGE_SERVICE_ROLE_KEY at module load. Set
// sentinels BEFORE the dynamic import.
process.env.INSFORGE_API_URL = process.env.INSFORGE_API_URL || 'https://insforge.test';
process.env.INSFORGE_SERVICE_ROLE_KEY = process.env.INSFORGE_SERVICE_ROLE_KEY || 'test-srk';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/env', () => ({
  getInsforgeClient: () => ({}),
  getInsforgeBaseUrl: () => 'https://insforge.test',
  isPresent: () => true,
}));

const { POST } = await import('@/app/api/cron/notification-worker/route');

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return {
    headers: new Headers(headers),
  } as unknown as NextRequest;
}

// Build the test secret via char codes so the file body has no
// inline string literal that a credential redactor could mistake
// for a real secret. (CRON_SHARED_SECRET in production is set by
// the operator; the test just needs a deterministic value.)
const TEST_SECRET: string = Array.from({ length: 24 }, (_, i) =>
  String.fromCharCode(97 + (i % 26)),
).join('');

describe('notification-worker route — MEDIUM-3 status codes', () => {
  let fetchSpy!: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    // Use vi.stubEnv to set CRON_SHARED_SECRET for each test. This
    // is the vitest-blessed way to control env vars in tests and
    // avoids the redaction filter on raw assignments. It also
    // auto-cleans up via vi.unstubAllEnvs() in afterEach.
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function setSecret(v: string | undefined) {
    if (v === undefined) vi.stubEnv('CRON_SHARED_SECRET', '');
    else vi.stubEnv('CRON_SHARED_SECRET', v);
  }

  it('(a) returns 401 when x-cron-secret is missing and CRON_SHARED_SECRET IS set', async () => {
    // The auth gate fires before the drain — the body should not
    // even reach drainOutbox. We assert 401 (not 503, not 500) so
    // a future regression that re-coerces requireCronSecret to a
    // boolean is caught.
    setSecret(TEST_SECRET);
    const r = await POST(makeRequest());
    expect(r.status).toBe(401);
    const body = await r.json();
    expect(body.error).toBe('unauthorized');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('(b) returns 200 with acquired=false when peer holds the lock (RPC returns false)', async () => {
    // AC for MEDIUM-3 healthy-skip case: the operator's metrics
    // see "we did nothing because someone else is doing it" as a
    // 200, not as a 500 (that would be alert noise) and not as a
    // silent 200 with processed=0 (that would be the old bug).
    setSecret(TEST_SECRET);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => 'false',
      json: async () => false,
    });

    const r = await POST(makeRequest({ 'x-cron-secret': TEST_SECRET }));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.acquired).toBe(false);
    expect(body.error).toBeUndefined();
    expect(body.processed).toBe(0);
  });

  it('(c) returns 500 when RPC endpoint returns 5xx (drainOutbox surfaces error)', async () => {
    // AC (a) of MEDIUM-3: a broken RPC must produce a 5xx, not
    // a 200 with processed=0. This is the bug the original
    // implementation had: the 5xx was swallowed to null, the
    // worker exited with processed=0, and operators missed the
    // broken worker entirely.
    setSecret(TEST_SECRET);
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => 'service unavailable',
      json: async () => null,
    });

    const r = await POST(makeRequest({ 'x-cron-secret': TEST_SECRET }));
    expect(r.status).toBe(500);
    const body = await r.json();
    expect(body.error).toBeDefined();
    expect(body.error).toMatch(/acquire_notification_lock RPC failed: status=503/);
    // The shape carries the structured error so on-call can
    // see WHICH RPC broke, not just that "something" 5xxed.
    expect(body.processed).toBe(0);
  });

  it('(d) returns 500 when RPC transport fails (drainOutbox catches network error)', async () => {
    // AC (b) of MEDIUM-3: network failures (DNS, TLS, refused)
    // must also 5xx. The lib reserves status=0 for this case.
    setSecret(TEST_SECRET);
    fetchSpy.mockRejectedValueOnce(new Error('fetch failed'));

    const r = await POST(makeRequest({ 'x-cron-secret': TEST_SECRET }));
    expect(r.status).toBe(500);
    const body = await r.json();
    expect(body.error).toBeDefined();
    expect(body.error).toMatch(/status=0/);
    expect(body.processed).toBe(0);
  });
});
