// lib/cron-auth.ts
// Shared auth helper for cron-triggered endpoints. Used by:
//   - /api/cron/scan-all (scheduled scans)
//   - /api/cron/notification-worker (notification dispatcher)
//
// The InsForge schedule that triggers these endpoints is configured with
// --headers '{"x-cron-secret": "<value>"}' where <value> matches
// process.env.CRON_SHARED_SECRET at request time.
//
// If CRON_SHARED_SECRET is not set, the endpoint rejects all requests.
// This is a safe-by-default posture for unconfigured deployments.

import { NextRequest } from 'next/server';

export function requireCronSecret(request: NextRequest): boolean {
  const expected = process.env.CRON_SHARED_SECRET;
  if (!expected || expected.length === 0) return false;
  const got = request.headers.get('x-cron-secret');
  if (!got || got.length !== expected.length) return false;
  // Constant-time comparison to prevent timing attacks
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ got.charCodeAt(i);
  }
  return mismatch === 0;
}
