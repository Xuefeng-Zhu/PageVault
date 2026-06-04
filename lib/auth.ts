// Auth configuration for NextAuth.js with InsForge credentials provider
import { randomBytes } from 'node:crypto';
import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';

// ─── NEXTAUTH_SECRET resolution ────────────────────────────────────────────────
// NEXTAUTH_SECRET MUST be set. There is no safe default — a hardcoded fallback
// would let an attacker forge JWTs for any user.
//
// The ONLY exception is an explicit dev-only opt-in: when the operator sets
// INSFORGE_DEV_INSECURE_SECRET=1 AND NODE_ENV is explicitly 'development', we
// generate a per-process random secret so the local dev workflow still works
// (sessions become invalid on restart, which is the desired behavior in dev).
// This path is gated by NODE_ENV so a misconfigured production deploy cannot
// accidentally enable it — a stray dev opt-in in prod must fail closed, not
// silently rotate JWT signing keys on every restart and log out every admin.
//
// Fail-closed invariants:
//   1. INSFORGE_DEV_INSECURE_SECRET=1 outside NODE_ENV=development → throw.
//   2. NEXTAUTH_SECRET unset in NODE_ENV=production → throw (no silent random).
//   3. NEXTAUTH_SECRET unset anywhere else with no dev opt-in → throw.
const DEV_INSECURE_OPT_IN = 'INSFORGE_DEV_INSECURE_SECRET';

/**
 * Resolve the NEXTAUTH_SECRET value. Pure function of `process.env` — no
 * module-level side effects, so tests can import it and drive every
 * failure path with controlled env state. The module-load resolution
 * happens exactly once via the constant below.
 */
export function resolveNextAuthSecret(): string {
  const fromEnv = process.env.NEXTAUTH_SECRET?.trim();
  if (fromEnv) return fromEnv;

  const devOptIn = process.env[DEV_INSECURE_OPT_IN] === '1';
  const nodeEnv = process.env.NODE_ENV;
  const isDevelopment = nodeEnv === 'development';
  const isProduction = nodeEnv === 'production';

  // 1. Dev opt-in is only honored in explicit development. Anywhere else
  //    (production, test, preview, staging, NODE_ENV unset) we refuse —
  //    silently generating a per-process random secret in production
  //    would invalidate every existing JWT on the next process restart,
  //    including admin sessions, with no operator-visible signal.
  if (devOptIn && !isDevelopment) {
    throw new Error(
      `${DEV_INSECURE_OPT_IN}=1 is set but NODE_ENV is '${nodeEnv ?? 'undefined'}'. ` +
        'This dev-only opt-in is only honored when NODE_ENV=development. ' +
        'Unset it (or set NODE_ENV=development) and provide a real NEXTAUTH_SECRET.'
    );
  }

  if (devOptIn) {
    // eslint-disable-next-line no-console
    console.warn(
      `[auth] WARNING: NEXTAUTH_SECRET is unset and ${DEV_INSECURE_OPT_IN}=1. ` +
        'Generating a random dev-only secret. Sessions will not survive process restarts. ' +
        'This mode MUST NOT be used in production.'
    );
    return randomBytes(32).toString('hex');
  }

  // 2. In production we fail closed even if the dev opt-in is somehow set
  //    (defense-in-depth — the check above should already have caught it).
  // 3. No secret and no opt-in → refuse to start.
  if (isProduction) {
    throw new Error(
      'NEXTAUTH_SECRET is not set in NODE_ENV=production. Refusing to start with a ' +
        'random JWT signing secret in production (silent session invalidation on restart). ' +
        'Set NEXTAUTH_SECRET in your environment (e.g. `openssl rand -base64 32`).'
    );
  }

  throw new Error(
    'NEXTAUTH_SECRET is not set. Refusing to start with a publicly-known ' +
      'JWT signing secret. Set NEXTAUTH_SECRET in your environment ' +
      `(e.g. \`openssl rand -base64 32\`), or for local dev only, set ${DEV_INSECURE_OPT_IN}=1 ` +
      'to auto-generate a random per-process dev secret.'
  );
}

const nextAuthSecret = resolveNextAuthSecret();

const insforgeUrl = process.env.NEXT_PUBLIC_INSFORGE_URL || process.env.INSFORGE_API_URL;
const insforgeKey = process.env.INSFORGE_SERVICE_ROLE_KEY || process.env.INSFORGE_ANON_KEY;

interface InsForgeUser {
  id: string;
  email: string;
}

// ─── Dev-only demo auth (opt-in) ────────────────────────────────────────────
// Historically lib/auth.ts contained three hardcoded backdoor branches
// (`admin@example.com` / `admin123` and `admin@example.com` / `demo123`)
// that were always live in any environment where InsForge was misconfigured
// OR returned a non-2xx/non-JSON response. That was a P0 auth bypass: the
// `demo123` path returned a JWT for the canonical owner_id used by
// `createRoom` (lib/insforge.ts) and `migrateOwnerIds`, so anyone who knew
// the password could impersonate the implicit super-user and own every
// legacy project.
//
// The fallback below is the ONLY way demo credentials are accepted. It is
// gated on **two** independent conditions:
//   1. `INSFORGE_DEV_DEMO_AUTH=1` must be explicitly set
//   2. `NODE_ENV` must be `development`
// Both are required, so a misconfigured production deploy cannot accidentally
// enable the backdoor. When matched, the helper logs a loud `console.warn`
// on every successful fallback auth so the path is impossible to miss in
// dev server output.
export const DEV_DEMO_AUTH_OPT_IN = 'INSFORGE_DEV_DEMO_AUTH';
export const DEV_DEMO_EMAIL = 'admin@example.com';
export const DEV_DEMO_PASSWORD = 'demo123';
// The canonical owner_id used in `createRoom` and `migrateOwnerIds` —
// exported so tests and the migration script can pin to the same constant
// rather than duplicating the literal.
export const DEV_DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';

export function isDevDemoAuthEnabled(): boolean {
  return (
    process.env.NODE_ENV === 'development' &&
    process.env[DEV_DEMO_AUTH_OPT_IN] === '1'
  );
}

// Test seams: exported so `lib/auth.demo-backdoor.test.ts` can drive the
// demo-auth and full signIn paths without spinning up NextAuth. Not for
// app code.
export { tryDevDemoAuth, signInWithInsForge };

function tryDevDemoAuth(email: string, password: string): InsForgeUser | null {
  if (!isDevDemoAuthEnabled()) return null;
  if (email !== DEV_DEMO_EMAIL || password !== DEV_DEMO_PASSWORD) return null;

  // eslint-disable-next-line no-console
  console.warn(
    `[auth] WARNING: dev demo auth accepted for ${email}. ` +
      `This path is only reachable when NODE_ENV=development AND ` +
      `${DEV_DEMO_AUTH_OPT_IN}=1. Do not deploy with these set.`
  );
  return { id: DEV_DEMO_USER_ID, email };
}

async function signInWithInsForge(email: string, password: string): Promise<InsForgeUser | null> {
  const baseUrl = insforgeUrl;
  const key = insforgeKey;

  // Fail closed when InsForge isn't configured. Demo auth used to fire
  // here unconditionally; now it must be explicitly opted in.
  if (!baseUrl || !key) {
    return tryDevDemoAuth(email, password);
  }

  try {
    const response = await fetch(`${baseUrl}/api/auth/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': key,
      },
      body: JSON.stringify({ email, password }),
    });

    // If the endpoint is unreachable or returns non-JSON, do NOT fall back
    // to demo creds by default. Only the explicit dev opt-in can re-enable
    // that path. Previously this branch silently authenticated as the
    // canonical owner — that was the CRITICAL-2 bypass.
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.includes('application/json')) {
      return tryDevDemoAuth(email, password);
    }

    const data = await response.json();

    // The response should contain user info and access token
    if (data.user) {
      return {
        id: data.user.id,
        email: data.user.email,
      };
    }

    // If we got an access token but no user in body, try to decode from token or fetch user
    if (data.accessToken) {
      // Try to get user info using the access token
      const userResponse = await fetch(`${baseUrl}/api/auth/user`, {
        headers: {
          'Authorization': `Bearer ${data.accessToken}`,
          'apikey': key,
        },
      });
      if (userResponse.ok) {
        const userData = await userResponse.json();
        return { id: userData.id, email: userData.email };
      }
    }

    return null;
  } catch (err) {
    // Network/parse error — same posture as the non-JSON branch above: do
    // not silently grant canonical-owner access. Only an explicit dev
    // opt-in can authenticate via demo creds here.
    const demoUser = tryDevDemoAuth(email, password);
    if (demoUser) return demoUser;
    console.error('Auth error:', err);
    return null;
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const user = await signInWithInsForge(credentials.email, credentials.password);
        
        if (!user) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.email.split('@')[0],
        };
      },
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.email = user.email ?? '';
      }
      return token;
    },
    async session({ session, token }) {
      // Extend the session user with our custom fields
      if (session.user) {
        (session.user as { id?: string; email?: string }).id = token.id as string;
        (session.user as { id?: string; email?: string }).email = token.email as string;
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  secret: nextAuthSecret,
};
