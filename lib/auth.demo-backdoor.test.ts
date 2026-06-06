// Tests for lib/auth.ts — CRITICAL-2 demo-backdoor regression coverage.
//
// The pre-fix lib/auth.ts contained three hardcoded branches that silently
// returned a JWT for the canonical owner_id
// `00000000-0000-0000-0000-000000000001` whenever InsForge was misconfigured,
// returned a non-2xx response, or returned a non-JSON body. That was a P0
// auth bypass — the demo123 path authenticated as the implicit super-user
// who owns every legacy project backfilled by `migrateOwnerIds`.
//
// Post-fix, the only path that accepts the demo creds is `tryDevDemoAuth`,
// gated on **two** independent conditions:
//   1. `INSFORGE_DEV_DEMO_AUTH=*** ='1'`
//   2. `NODE_ENV === 'development'`
// `admin123` is no longer accepted at all.
//
// These tests pin both halves of the contract:
//   * `signInWithInsForge` returns null for both demo creds when the gate
//     is closed (every other NODE_ENV × INSFORGE_DEV_DEMO_AUTH combination).
//   * `signInWithInsForge` returns the canonical demo user for `demo123`
//     (not `admin123`) when the gate is open.
//   * The full path including `signInWithInsForge` (which makes a real
//     fetch to the InsForge auth endpoint) is also pinned.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ─── Env helpers ─────────────────────────────────────────────────────────────
//
// We funnel every `process.env.X = …` and `delete process.env.X` through
// these two helpers so the typechecker stays happy. `process.env.X` in TS
// is a `string` (not `string | undefined`), and the project tsc runs over
// `**/*.ts` (see tsconfig.json `include`), so direct assignment without a
// cast produces TS2540 / TS2704 errors. The cast is contained to one place.

type EnvRecord = Record<string, string | undefined>;

function envSet(key: string, value: string | undefined): void {
  const env = process.env as EnvRecord;
  if (value === undefined) {
    delete env[key];
  } else {
    env[key] = value;
  }
}

function envUnset(key: string): void {
  const env = process.env as EnvRecord;
  delete env[key];
}

type AuthEnvSnapshot = {
  NODE_ENV: string | undefined;
  INSFORGE_DEV_DEMO_AUTH: string | undefined;
  NEXT_PUBLIC_INSFORGE_URL: string | undefined;
  NEXT_PUBLIC_INSFORGE_ANON_KEY: string | undefined;
  INSFORGE_API_URL: string | undefined;
  INSFORGE_SERVICE_ROLE_KEY: string | undefined;
  INSFORGE_ANON_KEY: string | undefined;
  NEXTAUTH_SECRET: string | undefined;
};

function snapshotAuthEnv(): AuthEnvSnapshot {
  return {
    NODE_ENV: process.env.NODE_ENV,
    INSFORGE_DEV_DEMO_AUTH: process.env.INSFORGE_DEV_DEMO_AUTH,
    NEXT_PUBLIC_INSFORGE_URL: process.env.NEXT_PUBLIC_INSFORGE_URL,
    NEXT_PUBLIC_INSFORGE_ANON_KEY: process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY,
    INSFORGE_API_URL: process.env.INSFORGE_API_URL,
    INSFORGE_SERVICE_ROLE_KEY: process.env.INSFORGE_SERVICE_ROLE_KEY,
    INSFORGE_ANON_KEY: process.env.INSFORGE_ANON_KEY,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
  };
}

function restoreAuthEnv(snap: AuthEnvSnapshot): void {
  for (const k of Object.keys(snap) as (keyof AuthEnvSnapshot)[]) {
    const v = snap[k];
    if (v === undefined) {
      envUnset(k);
    } else {
      envSet(k, v);
    }
  }
}

function clearAuthEnvForDemoTest(): void {
  envUnset('NODE_ENV');
  envUnset('INSFORGE_DEV_DEMO_AUTH');
  envUnset('NEXT_PUBLIC_INSFORGE_URL');
  envUnset('NEXT_PUBLIC_INSFORGE_ANON_KEY');
  envUnset('INSFORGE_API_URL');
  envUnset('INSFORGE_SERVICE_ROLE_KEY');
  envUnset('INSFORGE_ANON_KEY');
  // NEXTAUTH_SECRET is needed for module load in dev — set a stable value.
  envSet('NEXTAUTH_SECRET', 'test-only-not-secret-1234567890');
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('CRITICAL-2: demo backdoor closed by default', () => {
  let envSnap: AuthEnvSnapshot;

  beforeEach(() => {
    envSnap = snapshotAuthEnv();
    clearAuthEnvForDemoTest();
    // Reset the module cache so module-level reads of `process.env`
    // re-evaluate under the test's env on every import. Without this,
    // the first import in a vitest worker would be cached and subsequent
    // tests would see a stale config.
    vi.resetModules();
  });

  afterEach(() => {
    restoreAuthEnv(envSnap);
    vi.resetModules();
  });

  // The headline acceptance criterion: with the gate closed, both demo
  // creds must be rejected. Split into one test per (NODE_ENV × creds)
  // cell so a regression points clearly at which combination broke.
  describe('rejects demo creds when INSFORGE_DEV_DEMO_AUTH is unset', () => {
    it('rejects admin@example.com / admin123 in NODE_ENV=production', async () => {
      envSet('NODE_ENV', 'production');
      const { signInWithInsForge } = await import('./auth');
      expect(await signInWithInsForge('admin@example.com', 'admin123')).toBeNull();
    });

    it('rejects admin@example.com / admin123 in NODE_ENV=development', async () => {
      envSet('NODE_ENV', 'development');
      const { signInWithInsForge } = await import('./auth');
      expect(await signInWithInsForge('admin@example.com', 'admin123')).toBeNull();
    });

    it('rejects admin@example.com / admin123 in NODE_ENV=test', async () => {
      envSet('NODE_ENV', 'test');
      const { signInWithInsForge } = await import('./auth');
      expect(await signInWithInsForge('admin@example.com', 'admin123')).toBeNull();
    });

    it('rejects admin@example.com / admin123 with NODE_ENV unset', async () => {
      // NODE_ENV stays deleted from beforeEach
      const { signInWithInsForge } = await import('./auth');
      expect(await signInWithInsForge('admin@example.com', 'admin123')).toBeNull();
    });

    it('rejects admin@example.com / demo123 in NODE_ENV=production', async () => {
      envSet('NODE_ENV', 'production');
      const { signInWithInsForge } = await import('./auth');
      expect(await signInWithInsForge('admin@example.com', 'demo123')).toBeNull();
    });

    it('rejects admin@example.com / demo123 in NODE_ENV=development (no opt-in)', async () => {
      envSet('NODE_ENV', 'development');
      const { signInWithInsForge } = await import('./auth');
      expect(await signInWithInsForge('admin@example.com', 'demo123')).toBeNull();
    });

    it('rejects admin@example.com / demo123 in NODE_ENV=test', async () => {
      envSet('NODE_ENV', 'test');
      const { signInWithInsForge } = await import('./auth');
      expect(await signInWithInsForge('admin@example.com', 'demo123')).toBeNull();
    });

    it('rejects admin@example.com / demo123 with NODE_ENV unset', async () => {
      const { signInWithInsForge } = await import('./auth');
      expect(await signInWithInsForge('admin@example.com', 'demo123')).toBeNull();
    });

    it('rejects non-demo creds as well (no universal grant)', async () => {
      envSet('NODE_ENV', 'development');
      const { signInWithInsForge } = await import('./auth');
      expect(await signInWithInsForge('hacker@example.com', 'whatever')).toBeNull();
    });
  });

  // The opt-in must be honored when both conditions hold, AND only those
  // two conditions. admin123 is gone entirely; only demo123 is accepted.
  describe('honors the dual-gate opt-in (NODE_ENV=development AND INSFORGE_DEV_DEMO_AUTH=1)', () => {
    it('accepts admin@example.com / demo123 when the gate is open', async () => {
      envSet('NODE_ENV', 'development');
      envSet('INSFORGE_DEV_DEMO_AUTH', '1');
      // Suppress the expected loud warn — its presence is asserted below.
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { signInWithInsForge, DEV_DEMO_USER_ID } = await import('./auth');
      const user = await signInWithInsForge('admin@example.com', 'demo123');

      expect(user).toEqual({
        id: DEV_DEMO_USER_ID,
        email: 'admin@example.com',
      });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/dev demo auth accepted for admin@example\.com/)
      );
      warnSpy.mockRestore();
    });

    it('still rejects admin@example.com / admin123 even when the gate is open (admin123 is dead)', async () => {
      envSet('NODE_ENV', 'development');
      envSet('INSFORGE_DEV_DEMO_AUTH', '1');
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { signInWithInsForge } = await import('./auth');
      expect(await signInWithInsForge('admin@example.com', 'admin123')).toBeNull();

      warnSpy.mockRestore();
    });

    it('still rejects demo123 when INSFORGE_DEV_DEMO_AUTH is set in NODE_ENV=production', async () => {
      envSet('NODE_ENV', 'production');
      envSet('INSFORGE_DEV_DEMO_AUTH', '1');
      const { signInWithInsForge } = await import('./auth');
      expect(await signInWithInsForge('admin@example.com', 'demo123')).toBeNull();
    });

    it('still rejects demo123 when INSFORGE_DEV_DEMO_AUTH is set in NODE_ENV=test', async () => {
      envSet('NODE_ENV', 'test');
      envSet('INSFORGE_DEV_DEMO_AUTH', '1');
      const { signInWithInsForge } = await import('./auth');
      expect(await signInWithInsForge('admin@example.com', 'demo123')).toBeNull();
    });

    it('still rejects demo123 when NODE_ENV=development but INSFORGE_DEV_DEMO_AUTH is "true" (not "1")', async () => {
      envSet('NODE_ENV', 'development');
      envSet('INSFORGE_DEV_DEMO_AUTH', 'true');
      const { signInWithInsForge } = await import('./auth');
      expect(await signInWithInsForge('admin@example.com', 'demo123')).toBeNull();
    });
  });

  // The pre-fix code had three backdoor branches that fired not only when
  // InsForge was unconfigured but also when it was *misbehaving* — non-2xx,
  // non-JSON, or throwing. We pin that posture: a misbehaving upstream
  // must not silently grant canonical-owner access, regardless of gate.
  describe('does not fall back to demo creds when InsForge is misbehaving', () => {
    it('returns null (not demo user) when InsForge returns HTML (non-JSON) and gate is closed', async () => {
      envSet('NODE_ENV', 'production');
      // InsForge is configured → real fetch path
      envSet('NEXT_PUBLIC_INSFORGE_URL', 'https://insforge.example.test');
      envSet('NEXT_PUBLIC_INSFORGE_ANON_KEY', 'anon-test-key');
      envSet('INSFORGE_API_URL', 'https://insforge.example.test');
      envSet('INSFORGE_ANON_KEY', 'anon-test-key');

      // Mock fetch to return non-JSON HTML — the path that used to fall
      // through to demo123 before the fix.
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          new Response('<html>oh no</html>', {
            status: 502,
            headers: { 'content-type': 'text/html' },
          })
        );

      const { signInWithInsForge } = await import('./auth');
      const user = await signInWithInsForge('admin@example.com', 'demo123');
      expect(user).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      fetchSpy.mockRestore();
    });

    it('returns null (not demo user) when InsForge fetch throws and gate is closed', async () => {
      envSet('NODE_ENV', 'production');
      envSet('NEXT_PUBLIC_INSFORGE_URL', 'https://insforge.example.test');
      envSet('NEXT_PUBLIC_INSFORGE_ANON_KEY', 'anon-test-key');
      envSet('INSFORGE_API_URL', 'https://insforge.example.test');
      envSet('INSFORGE_ANON_KEY', 'anon-test-key');

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(new Error('ECONNREFUSED'));

      const { signInWithInsForge } = await import('./auth');
      const user = await signInWithInsForge('admin@example.com', 'demo123');
      expect(user).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      fetchSpy.mockRestore();
    });

    it('does accept demo123 from a misbehaving InsForge ONLY when the gate is open', async () => {
      envSet('NODE_ENV', 'development');
      envSet('INSFORGE_DEV_DEMO_AUTH', '1');
      envSet('NEXT_PUBLIC_INSFORGE_URL', 'https://insforge.example.test');
      envSet('NEXT_PUBLIC_INSFORGE_ANON_KEY', 'anon-test-key');
      envSet('INSFORGE_API_URL', 'https://insforge.example.test');
      envSet('INSFORGE_ANON_KEY', 'anon-test-key');

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(new Error('ECONNREFUSED'));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { signInWithInsForge, DEV_DEMO_USER_ID } = await import('./auth');
      const user = await signInWithInsForge('admin@example.com', 'demo123');
      expect(user).toEqual({
        id: DEV_DEMO_USER_ID,
        email: 'admin@example.com',
      });

      warnSpy.mockRestore();
      fetchSpy.mockRestore();
    });
  });
});
