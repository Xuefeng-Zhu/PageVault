// lib/cron-auth.ts
// Shared auth helper for cron-triggered endpoints. Used by:
//   - /api/cron/scan-all (scheduled scans)
//   - /api/cron/notification-worker (notification dispatcher)
//
// The InsForge schedule that triggers these endpoints is configured with
// --headers '{"x-cron-secret": "<value>"}' where <value> matches
// process.env.CRON_SHARED_SECRET at request time.
//
// If CRON_SHARED_SECRET is not set, the endpoint returns a 503
// "service_unconfigured" response so operators see a clear signal that
// the deployment is misconfigured (vs. a 401 that would suggest an
// attacker probing with the wrong secret, or a 500 with a stack trace
// that would leak server internals). This is a safe-by-default
// posture for unconfigured deployments.

import { NextRequest } from 'next/server';

export type CronSecretCheck =
  | { ok: true }
  | { ok: false; reason: 'unconfigured' }
  | { ok: false; reason: 'mismatch' };

/**
 * Verify the x-cron-secret header against CRON_SHARED_SECRET.
 *
 * Returns a discriminated result so callers can distinguish:
 *  - { ok: true }                            — header matches
 *  - { ok: false, reason: 'mismatch' }      — wrong / missing header
 *  - { ok: false, reason: 'unconfigured' }  — server env var is unset
 *
 * The mismatch check is constant-time with respect to the candidate
 * secret length: we always walk `expected.length` iterations, padding
 * the candidate with zero bytes if it is shorter. This eliminates the
 * early `length !== expected.length` short-circuit, which previously
 * let an attacker probe the expected secret length bucket via 401-vs-401
 * timing differences (an oracle the original code's doc comment
 * called "constant-time" but in practice was not).
 */
export function requireCronSecret(request: NextRequest): CronSecretCheck {
  const expected = process.env.CRON_SHARED_SECRET;
  if (!expected || expected.length === 0) {
    return { ok: false, reason: 'unconfigured' };
  }
  const raw = request.headers.get('x-cron-secret');
  const got = raw ?? '';

  // Constant-time compare over exactly `expected.length` chars.
  // Padding the shorter string with 0 keeps the loop count constant
  // even when the candidate is empty or shorter than expected.
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    const expectedCode = expected.charCodeAt(i);
    const gotCode = i < got.length ? got.charCodeAt(i) : 0;
    mismatch |= expectedCode ^ gotCode;
  }
  // If got is longer than expected, fold the tail bytes into the
  // accumulator too. A candidate that shares the entire `expected`
  // prefix but has extra bytes is functionally as compromising as
  // the secret itself, so this is mostly belt-and-suspenders — but
  // folding the bytes in keeps the accumulator definition
  // consistent (any candidate differing from `expected` in any byte
  // produces a non-zero mismatch).
  for (let i = expected.length; i < got.length; i++) {
    mismatch |= got.charCodeAt(i);
  }
  return mismatch === 0 ? { ok: true } : { ok: false, reason: 'mismatch' };
}
