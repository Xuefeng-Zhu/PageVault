// InsForge Edge Function: POST /functions/apify-webhook
// Receives Apify completion webhook
// Shared secret auth via X-Shared-Secret header
// Request: { runId, status, defaultDatasetId, ... }
// Response: { jobId, snapshotId, changeType, boxFolderId, explanationId }
//
// CRITICAL-1 fix (docs/qa-bug-hunt.md):
//   The shared secret is no longer a hardcoded string literal. It is
//   read from APIFY_WEBHOOK_SECRET at request time. In InsForge Edge
//   Functions this comes from Deno.env; local tests may use process.env.
//   If the env var is missing, the function fails closed with a 503
//   "service_unconfigured" response — the same posture lib/cron-auth.ts
//   uses for CRON_SHARED_SECRET — so a misconfigured deployment is
//   obvious to operators (vs. silently accepting the wrong secret).
//
//   The compare is constant-time with respect to the expected length
//   to avoid leaking the secret length via timing. See
//   lib/cron-auth.ts:requireCronSecret for the original rationale.

export interface ApifyWebhookPayload {
  runId: string;
  status: 'SUCCEEDED' | 'FAILED' | 'ABORTED' | 'TIMED_OUT';
  defaultDatasetId?: string;
  statusMessage?: string;
}

export type ApifyWebhookSecretCheck =
  | { ok: true }
  | { ok: false; reason: 'unconfigured' }
  | { ok: false; reason: 'mismatch' };

function getEdgeEnv(name: string): string | undefined {
  const deno = (globalThis as unknown as {
    Deno?: { env?: { get?: (key: string) => string | undefined } };
  }).Deno;
  const denoValue = deno?.env?.get?.(name);
  if (denoValue !== undefined) return denoValue;

  const nodeProcess = (globalThis as unknown as {
    process?: { env?: Record<string, string | undefined> };
  }).process;
  return nodeProcess?.env?.[name];
}

/**
 * Verify the X-Shared-Secret header against APIFY_WEBHOOK_SECRET.
 *
 * Returns a discriminated result so callers can distinguish:
 *  - { ok: true }                            — header matches
 *  - { ok: false, reason: 'mismatch' }       — wrong / missing header
 *  - { ok: false, reason: 'unconfigured' }   — server env var is unset
 *
 * Constant-time over `expected.length` to prevent a timing oracle on
 * the secret length.
 */
export function verifyApifyWebhookSecret(req: Request): ApifyWebhookSecretCheck {
  const expected = getEdgeEnv('APIFY_WEBHOOK_SECRET');
  if (!expected || expected.length === 0) {
    return { ok: false, reason: 'unconfigured' };
  }
  const raw = req.headers.get('X-Shared-Secret');
  const got = raw ?? '';

  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    const expectedCode = expected.charCodeAt(i);
    const gotCode = i < got.length ? got.charCodeAt(i) : 0;
    mismatch |= expectedCode ^ gotCode;
  }
  for (let i = expected.length; i < got.length; i++) {
    mismatch |= got.charCodeAt(i);
  }
  return mismatch === 0 ? { ok: true } : { ok: false, reason: 'mismatch' };
}

export default async function handler(req: Request): Promise<Response> {
  // CRITICAL-1: read the secret from env, fail closed if unset.
  const check = verifyApifyWebhookSecret(req);
  if (!check.ok && check.reason === 'unconfigured') {
    return Response.json(
      { error: 'SERVICE_UNCONFIGURED' },
      { status: 503 }
    );
  }
  if (!check.ok) {
    return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const payload: ApifyWebhookPayload = await req.json();
    const { runId, status, defaultDatasetId, statusMessage } = payload;

    if (!runId) {
      return Response.json({ error: 'MISSING_RUN_ID' }, { status: 400 });
    }

    // Idempotency check: if already processed this runId, return success
    // In real mode: query webhook_events table for this runId

    if (status !== 'SUCCEEDED') {
      // Job failed — record failure
      return Response.json({
        jobId: null,
        snapshotId: null,
        changeType: 'error',
        boxFolderId: null,
        explanationId: null,
        status: 'failed_recorded',
        errorMessage: statusMessage ?? status,
      }, { status: 200 });
    }

    // Fetch dataset items from Apify
    // In real mode: call Apify API to get dataset items
    // In demo mode: simulate processing

    // Compute hashes and determine change type
    // In real mode: compute SHA256 hashes of markdown/html
    const snapshotId = crypto.randomUUID();
    const jobId = crypto.randomUUID();

    // Simulate change detection
    const changeType = 'textual'; // Would be computed from actual diff

    // Upload to Box (mock in demo mode)
    const boxFolderId = `box-snapshot-${snapshotId.slice(0, 8)}`;

    // Call LLM for explanation (mock in demo mode)
    const explanationId = crypto.randomUUID();

    return Response.json({
      jobId,
      snapshotId,
      changeType,
      boxFolderId,
      explanationId,
      status: 'ok',
    }, { status: 200 });
  } catch (err) {
    console.error('apify-webhook error:', err);
    return Response.json(
      { error: 'INTERNAL_ERROR', message: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}
