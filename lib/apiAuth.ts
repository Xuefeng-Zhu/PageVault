// Shared auth helper for /api/* route handlers.
//
// The NextAuth middleware (see middleware.ts) only protects /dashboard/*,
// so every API handler must call requireSession() and early-return the
// failure response. Without this, routes run as unauthenticated callers
// against the service-role database client.
//
// Usage:
//   const session = await requireSession();
//   if (session instanceof NextResponse) return session;
//   // session.user.id is now available.

import { NextResponse } from 'next/server';
import type { Session } from 'next-auth';
import { getServerSession } from 'next-auth';
import type { ErrorResponse } from '@/types';
import { authOptions } from './auth';

export type SessionFailure = NextResponse<ErrorResponse>;

export async function requireSession(): Promise<Session | SessionFailure> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    const failure: SessionFailure = NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
      { status: 401 }
    );
    return failure;
  }
  return session;
}
