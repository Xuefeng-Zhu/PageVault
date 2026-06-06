// Tests for lib/auth.ts — `resolveNextAuthSecret()` and module-load behavior.
//
// Regression coverage for CRITICAL-3 (docs/qa-bug-hunt.md):
//   * CommonJS `require('crypto')` replaced with ESM `import { randomBytes } from 'node:crypto'`
//   * `INSFORGE_DEV_INSECURE_SECRET=1` outside `NODE_ENV=development` must throw
//   * `NEXTAUTH_SECRET` unset in `NODE_ENV=production` must throw (no silent random)
//
// We exercise the resolver as a pure function (no module-level side effects),
// plus a dynamic-import test that asserts the throw fires at module load —
// which is what the production deploy actually sees.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// We do NOT statically import './auth' at the top of this file: that would
// trigger `resolveNextAuthSecret()` at module-evaluation time, and a bare
// test env (no NEXTAUTH_SECRET, NODE_ENV=test) would crash the entire file
// before any test runs. All access goes through dynamic import() after
// `vi.resetModules()`.

type EnvSnapshot = {
  NEXTAUTH_SECRET: string | undefined;
  INSFORGE_DEV_INSECURE_SECRET: string | undefined;
  NODE_ENV: string | undefined;
};

function mutableEnv(): Record<keyof EnvSnapshot, string | undefined> & Record<string, string | undefined> {
  return process.env as unknown as Record<keyof EnvSnapshot, string | undefined> & Record<string, string | undefined>;
}

function snapshotEnv(): EnvSnapshot {
  const env = mutableEnv();
  return {
    NEXTAUTH_SECRET: env.NEXTAUTH_SECRET,
    INSFORGE_DEV_INSECURE_SECRET: env.INSFORGE_DEV_INSECURE_SECRET,
    NODE_ENV: env.NODE_ENV,
  };
}

function restoreEnv(snap: EnvSnapshot): void {
  const env = mutableEnv();
  for (const k of Object.keys(snap) as (keyof EnvSnapshot)[]) {
    if (snap[k] === undefined) {
      delete env[k];
    } else {
      env[k] = snap[k];
    }
  }
}

function clearAuthEnv(): void {
  const env = mutableEnv();
  delete env.NEXTAUTH_SECRET;
  delete env.INSFORGE_DEV_INSECURE_SECRET;
}

function setNodeEnv(value: string): void {
  mutableEnv().NODE_ENV = value;
}

function clearNodeEnv(): void {
  delete mutableEnv().NODE_ENV;
}

describe('resolveNextAuthSecret()', () => {
  let envSnap: EnvSnapshot;

  beforeEach(() => {
    envSnap = snapshotEnv();
    // Wipe per-test so leakage from a previous test (or the surrounding
    // vitest worker env) cannot silently change behavior.
    clearAuthEnv();
    clearNodeEnv();
  });

  afterEach(() => {
    restoreEnv(envSnap);
  });

  it('returns NEXTAUTH_SECRET verbatim when set', async () => {
    process.env.NEXTAUTH_SECRET = 'real-prod-secret-abc123';
    process.env.INSFORGE_DEV_INSECURE_SECRET = '1';
    setNodeEnv('production');

    const { resolveNextAuthSecret } = await import('./auth');
    expect(resolveNextAuthSecret()).toBe('real-prod-secret-abc123');
  });

  it('trims whitespace from NEXTAUTH_SECRET', async () => {
    process.env.NEXTAUTH_SECRET = '   real-secret   ';
    const { resolveNextAuthSecret } = await import('./auth');
    expect(resolveNextAuthSecret()).toBe('real-secret');
  });

  it('generates a per-process random hex secret when dev opt-in is set in development', async () => {
    setNodeEnv('development');
    process.env.INSFORGE_DEV_INSECURE_SECRET = '1';
    // Suppress the warning noise — it's the expected behavior here.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { resolveNextAuthSecret } = await import('./auth');
    const secret = resolveNextAuthSecret();

    // 32 bytes → 64 hex chars
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    // And the random is actually random — two calls give different secrets.
    const secret2 = resolveNextAuthSecret();
    expect(secret2).not.toBe(secret);

    warnSpy.mockRestore();
  });

  it('throws when INSFORGE_DEV_INSECURE_SECRET=1 is set in production', async () => {
    setNodeEnv('production');
    process.env.INSFORGE_DEV_INSECURE_SECRET = '1';

    const { resolveNextAuthSecret } = await import('./auth');
    expect(() => resolveNextAuthSecret()).toThrowError(
      /INSFORGE_DEV_INSECURE_SECRET=1 is set but NODE_ENV is 'production'/
    );
  });

  it('throws when INSFORGE_DEV_INSECURE_SECRET=1 is set in test (non-development)', async () => {
    setNodeEnv('test');
    process.env.INSFORGE_DEV_INSECURE_SECRET = '1';

    const { resolveNextAuthSecret } = await import('./auth');
    expect(() => resolveNextAuthSecret()).toThrowError(
      /This dev-only opt-in is only honored when NODE_ENV=development/
    );
  });

  it('throws when INSFORGE_DEV_INSECURE_SECRET=1 is set with NODE_ENV unset', async () => {
    // NODE_ENV stays deleted (beforeEach)
    process.env.INSFORGE_DEV_INSECURE_SECRET = '1';

    const { resolveNextAuthSecret } = await import('./auth');
    expect(() => resolveNextAuthSecret()).toThrowError(
      /NODE_ENV is 'undefined'/
    );
  });

  it('throws when NEXTAUTH_SECRET is unset in NODE_ENV=production (no opt-in)', async () => {
    setNodeEnv('production');
    // No NEXTAUTH_SECRET, no opt-in.

    const { resolveNextAuthSecret } = await import('./auth');
    expect(() => resolveNextAuthSecret()).toThrowError(
      /NEXTAUTH_SECRET is not set in NODE_ENV=production/
    );
  });

  it('throws when NEXTAUTH_SECRET is unset in NODE_ENV=test (no opt-in)', async () => {
    setNodeEnv('test');

    const { resolveNextAuthSecret } = await import('./auth');
    expect(() => resolveNextAuthSecret()).toThrowError(
      /NEXTAUTH_SECRET is not set/
    );
  });

  it('throws when NEXTAUTH_SECRET is unset in NODE_ENV=development WITHOUT the opt-in', async () => {
    setNodeEnv('development');
    // No opt-in — the dev path requires explicit INSFORGE_DEV_INSECURE_SECRET=1.

    const { resolveNextAuthSecret } = await import('./auth');
    expect(() => resolveNextAuthSecret()).toThrowError(
      /NEXTAUTH_SECRET is not set/
    );
  });

  it('treats INSFORGE_DEV_INSECURE_SECRET values other than "1" as no opt-in', async () => {
    setNodeEnv('development');
    process.env.INSFORGE_DEV_INSECURE_SECRET = 'true'; // not '1'

    const { resolveNextAuthSecret } = await import('./auth');
    expect(() => resolveNextAuthSecret()).toThrowError(
      /NEXTAUTH_SECRET is not set/
    );
  });
});

describe('lib/auth.ts module-load behavior (CRITICAL-3 regression)', () => {
  // This block asserts that the throw happens at module load, not just when
  // resolveNextAuthSecret() is called manually. A misconfigured production
  // deploy is what we want to fail closed — the import is the entry point.
  let envSnap: EnvSnapshot;

  beforeEach(() => {
    envSnap = snapshotEnv();
    clearAuthEnv();
    clearNodeEnv();
    // Always reset module cache so each test re-evaluates the module under
    // its own env. Without this, the first test's resolution would be cached
    // and subsequent tests would see a stale module-level constant.
    vi.resetModules();
  });

  afterEach(() => {
    restoreEnv(envSnap);
    vi.resetModules();
  });

  it('throws at module load when NEXTAUTH_SECRET is unset in NODE_ENV=production', async () => {
    setNodeEnv('production');
    // NEXTAUTH_SECRET deliberately not set.

    await expect(import('./auth')).rejects.toThrowError(
      /NEXTAUTH_SECRET is not set in NODE_ENV=production/
    );
  });

  it('throws at module load when INSFORGE_DEV_INSECURE_SECRET=1 is set in NODE_ENV=production', async () => {
    setNodeEnv('production');
    process.env.INSFORGE_DEV_INSECURE_SECRET = '1';

    await expect(import('./auth')).rejects.toThrowError(
      /INSFORGE_DEV_INSECURE_SECRET=1 is set but NODE_ENV is 'production'/
    );
  });

  it('loads successfully in NODE_ENV=development with the dev opt-in', async () => {
    setNodeEnv('development');
    process.env.INSFORGE_DEV_INSECURE_SECRET = '1';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mod = await import('./auth');
    expect(typeof mod.resolveNextAuthSecret).toBe('function');
    expect(typeof mod.authOptions).toBe('object');
    expect(mod.authOptions.secret).toMatch(/^[0-9a-f]{64}$/);

    warnSpy.mockRestore();
  });

  it('loads successfully in NODE_ENV=development with NEXTAUTH_SECRET set', async () => {
    setNodeEnv('development');
    process.env.NEXTAUTH_SECRET = 'dev-secret-xyz';

    const mod = await import('./auth');
    expect(mod.authOptions.secret).toBe('dev-secret-xyz');
  });
});
