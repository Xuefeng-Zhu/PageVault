// Tests for app/api/cron/scan-all/route.ts — covers the MEDIUM-1
// fix to requireCronSecret's discriminated result.
//
// Per docs/qa-bug-hunt.md MEDIUM-1: when CRON_SHARED_SECRET is
// unset on the server, the route must return 503 service_unconfigured
// — NOT 401 (which would suggest an attacker probe) and NOT 500
// (which would leak the secret-status state). The same fix in
// lib/cron-auth.test.ts covers the library; this file pins the
// route-level behavior so a future regression that re-coerces the
// discriminated result back to a boolean is caught.

// The route transitively imports lib/scan which throws on module
// load when INSFORGE_API_URL is unset. Set a sentinel BEFORE the
// dynamic import below.
process.env.INSFORGE_API_URL = process.env.INSFORGE_API_URL || 'https://insforge.test';
process.env.INSFORGE_SERVICE_ROLE_KEY = process.env.INSFORGE_SERVICE_ROLE_KEY || 'test-srk';
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-nextauth-secret';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/env', () => ({
  getInsforgeClient: () => ({}),
  getInsforgeBaseUrl: () => 'https://insforge.test',
  isPresent: () => true,
}));

const { POST } = await import('@/app/api/cron/scan-all/route');

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('https://pagevault.test/api/cron/scan-all', {
    method: 'POST',
    headers,
  });
}

describe('scan-all route — MEDIUM-1 status codes', () => {
  let originalSecret: string | undefined;

  beforeEach(() => {
    originalSecret = process.env.CRON_SHARED_SECRET;
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SHARED_SECRET;
    else process.env.CRON_SHARED_SECRET = originalSecret;
    vi.restoreAllMocks();
  });

  it('returns 401 when x-cron-secret header is wrong (or missing) and secret IS set', async () => {
    process.env.CRON_SHARED_SECRET = 'real-secret';
    const r = await POST(makeRequest({}) as unknown as import('next/server').NextRequest);
    expect(r.status).toBe(401);
    const body = await r.json();
    expect(body.error).toBe('unauthorized');
  });

  it('returns 503 service_unconfigured when CRON_SHARED_SECRET is unset on the server', async () => {
    // MEDIUM-1 acceptance: an unset server secret must produce a
    // 503, not 401 (which would be the boolean-coercion result)
    // and not 500 (which would leak the secret-status state via
    // a stack trace in some configurations).
    delete process.env.CRON_SHARED_SECRET;
    const r = await POST(makeRequest({ 'x-cron-secret': 'any-value' }) as unknown as import('next/server').NextRequest);
    expect(r.status).toBe(503);
    const body = await r.json();
    expect(body.error).toBe('service_unconfigured');
  });
});
