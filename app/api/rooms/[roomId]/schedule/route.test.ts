// Tests for app/api/rooms/[roomId]/schedule/route.ts — pins the
// CRITICAL-4 command-injection fix from docs/qa-bug-hunt.md.
//
// The previous version of this route shell-out to
// `npx @insforge/cli schedules ...` with string interpolation. A
// path parameter like `'; id; '` would escape the single-quote
// rewrap and run arbitrary commands on the host. The fix has two
// acceptance criteria pinned here:
//
//   1. Any roomId that is not a UUID is rejected with 400 BEFORE
//      the handler touches the DB, the InsForge API, or a shell.
//      No fetch() to /api/schedules* should fire for these inputs.
//
//   2. The shell-injection payload from the qa-bug-hunt repro —
//      `'; id; '` — is rejected with 400 and never reaches
//      authorizeRoom() or the InsForge REST call.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// CRITICAL-3 changed lib/auth.ts to throw at module load if
// NEXTAUTH_SECRET is unset (the route imports @/lib/auth, which
// calls resolveNextAuthSecret() at top level). We must seed the env
// BEFORE vitest's static import of the route fires — so we use
// vi.hoisted() which runs before the import hoisting pass.
vi.hoisted(() => {
  process.env.INSFORGE_API_URL = process.env.INSFORGE_API_URL || 'https://insforge.test';
  process.env.INSFORGE_SERVICE_ROLE_KEY = process.env.INSFORGE_SERVICE_ROLE_KEY || 'test-srk';
  process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-nextauth-secret';
});

// --- Mocks ---------------------------------------------------------------
// `getServerSession` is the auth gate. We stub next-auth directly so
// we can test the route in isolation. We make the session "logged
// in" so we don't return 401 before the validation runs (401 also
// doesn't reach the shell, so a 401-based test would pass for the
// wrong reason and miss the bug).
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

// `getInsforgeBaseUrl` is used to build the /api/schedules URL. The
// route calls it lazily inside helper functions, so we only need it
// to return a stable string. If the test never reaches the helpers
// (the happy path of the UUID validation), this mock is irrelevant.
vi.mock('@/lib/env', () => ({
  getInsforgeBaseUrl: () => 'https://insforge.test',
  getInsforgeClient: () => ({}),
  isPresent: () => true,
}));

// `getRoom` is called inside authorizeRoom AFTER the UUID check. We
// never want it to be reached for a non-UUID roomId, so the default
// mock throws — if the handler ever calls it with a non-UUID, the
// test will fail loudly.
const getRoomMock = vi.fn();
vi.mock('@/lib/insforge', () => ({
  getRoom: (...args: unknown[]) => getRoomMock(...args),
}));

// Dynamic import so vi.hoisted() and vi.mock() apply first, then the
// route module evaluates and reads the seeded env.
const { GET, POST, DELETE } = await import('@/app/api/rooms/[roomId]/schedule/route');
const { getServerSession } = await import('next-auth');
import { NextRequest } from 'next/server';

const getServerSessionMock = getServerSession as unknown as ReturnType<typeof vi.fn>;

function makeRequest(method: 'GET' | 'POST' | 'DELETE', body?: unknown): NextRequest {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  return new Request('https://pagevault.test/api/rooms/some-room-id/schedule', init) as unknown as NextRequest;
}

function makeParams(roomId: string) {
  return { params: Promise.resolve({ roomId }) };
}

const VALID_UUID = 'a1b2c3d4-1111-2222-3333-444455556666';

describe('CRITICAL-4: roomId is validated as a UUID at the front door', () => {
  let originalFetch: typeof fetch;
  let originalAppUrl: string | undefined;
  let originalCronSecret: string | undefined;

  beforeEach(() => {
    getRoomMock.mockReset();
    // Should never be called for non-UUID roomIds; if it is, the
    // test will fail with a clear "expected not to be called" error.
    getRoomMock.mockRejectedValue(new Error('getRoom must not be called for non-UUID roomIds'));
    // Track every fetch call so we can assert that the
    // /api/schedules* endpoints are NEVER touched for non-UUID inputs.
    originalFetch = global.fetch;
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    global.fetch = vi.fn(async (url: any, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    (global.fetch as unknown as { __calls: typeof calls }).__calls = calls;
    // Logged-in session for every test.
    getServerSessionMock.mockResolvedValue({ user: { id: 'user-1' } });
    // NEXT_PUBLIC_APP_URL and CRON_SHARED_SECRET only matter for the
    // happy path; we set them so the happy path doesn't 500.
    originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
    originalCronSecret = process.env.CRON_SHARED_SECRET;
    process.env.NEXT_PUBLIC_APP_URL = 'https://pagevault.test';
    process.env.CRON_SHARED_SECRET = 'test-cron-secret';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
    if (originalCronSecret === undefined) delete process.env.CRON_SHARED_SECRET;
    else process.env.CRON_SHARED_SECRET = originalCronSecret;
    vi.restoreAllMocks();
  });

  it('GET /api/rooms/<not-a-uuid>/schedule returns 400 and does not call /api/schedules*', async () => {
    const r = await GET(makeRequest('GET'), makeParams('not-a-uuid'));
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error?.code).toBe('INVALID_ROOM_ID');
    expect(getRoomMock).not.toHaveBeenCalled();
    const calls = (global.fetch as unknown as { __calls: Array<{ url: string }> }).__calls;
    const schedulesCalls = calls.filter((c) => c.url.includes('/api/schedules'));
    expect(schedulesCalls).toEqual([]);
  });

  it('POST /api/rooms/<shell-injection-payload>/schedule returns 400 and does not call /api/schedules*', async () => {
    // The exact payload from docs/qa-bug-hunt.md CRITICAL-4 repro.
    const payload = "'; id; '";
    const r = await POST(
      makeRequest('POST', { cronExpression: '0 3 * * *' }),
      makeParams(payload),
    );
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error?.code).toBe('INVALID_ROOM_ID');
    expect(getRoomMock).not.toHaveBeenCalled();
    const calls = (global.fetch as unknown as { __calls: Array<{ url: string }> }).__calls;
    const schedulesCalls = calls.filter((c) => c.url.includes('/api/schedules'));
    expect(schedulesCalls).toEqual([]);
  });

  it('DELETE /api/rooms/<shell-injection-payload>/schedule returns 400 and does not call /api/schedules*', async () => {
    const payload = "'; touch /tmp/pwn; '";
    const r = await DELETE(makeRequest('DELETE'), makeParams(payload));
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error?.code).toBe('INVALID_ROOM_ID');
    expect(getRoomMock).not.toHaveBeenCalled();
    const calls = (global.fetch as unknown as { __calls: Array<{ url: string }> }).__calls;
    const schedulesCalls = calls.filter((c) => c.url.includes('/api/schedules'));
    expect(schedulesCalls).toEqual([]);
  });

  it('rejects an empty roomId with 400', async () => {
    const r = await POST(
      makeRequest('POST', { cronExpression: '0 3 * * *' }),
      makeParams(''),
    );
    expect(r.status).toBe(400);
  });

  it('rejects a 36-char string with a non-hex character at the end (UUID-shaped but invalid)', async () => {
    const bad = 'a1b2c3d4-1111-2222-3333-44445555666z';
    const r = await POST(
      makeRequest('POST', { cronExpression: '0 3 * * *' }),
      makeParams(bad),
    );
    expect(r.status).toBe(400);
  });

  it('rejects shell metacharacters (roomId would be decoded from %xx by Next)', async () => {
    // /api/rooms/foo%3Brm%20-rf%20%2F/schedule → roomId = "foo;rm -rf /"
    // We pass the decoded value directly because Next.js decodes the
    // path param before handing it to the handler.
    const r = await POST(
      makeRequest('POST', { cronExpression: '0 3 * * *' }),
      makeParams('foo;rm -rf /'),
    );
    expect(r.status).toBe(400);
  });

  it('accepts a valid UUID-shaped roomId and proceeds past validation (happy path)', async () => {
    // authorizeRoom() must be called for valid UUIDs. Make it return
    // a room owned by the test user so the rest of the handler runs.
    getRoomMock.mockResolvedValue({ id: VALID_UUID, userId: 'user-1' });
    const r = await POST(
      makeRequest('POST', { cronExpression: '0 3 * * *' }),
      makeParams(VALID_UUID),
    );
    // Should NOT be 400 (validation passed). It may be 200 (success)
    // or 500 (the mocked fetch returns 200 + '{}' which the parser
    // may not understand — that's fine, the test only pins that
    // validation is no longer the failure mode).
    expect(r.status).not.toBe(400);
    expect(getRoomMock).toHaveBeenCalledWith(VALID_UUID);
  });

  it('fails before persisting enabled=true when InsForge rejects schedule creation', async () => {
    getRoomMock.mockResolvedValue({ id: VALID_UUID, userId: 'user-1' });
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    global.fetch = vi.fn(async (url: any, init?: RequestInit) => {
      const normalizedUrl = String(url);
      calls.push({ url: normalizedUrl, init });
      if (normalizedUrl.endsWith('/api/schedules') && init?.method === 'GET') {
        return Response.json([]);
      }
      if (normalizedUrl.endsWith('/api/schedules') && init?.method === 'POST') {
        return Response.json({ error: 'invalid cron upstream' }, { status: 400, statusText: 'Bad Request' });
      }
      return Response.json([]);
    }) as unknown as typeof fetch;
    (global.fetch as unknown as { __calls: typeof calls }).__calls = calls;

    const r = await POST(
      makeRequest('POST', { cronExpression: '0 3 * * *', enabled: true }),
      makeParams(VALID_UUID),
    );

    expect(r.status).toBe(500);
    const body = await r.json();
    expect(body.error?.message).toMatch(/InsForge schedule create failed/i);
    const dbWrites = calls.filter((c) =>
      c.url.includes('/api/database/records/scan_schedules') &&
      (c.init?.method === 'POST' || c.init?.method === 'PATCH')
    );
    expect(dbWrites).toEqual([]);
  });
});
