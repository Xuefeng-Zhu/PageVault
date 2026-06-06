// functions/apify-webhook.test.ts
//
// Regression tests for CRITICAL-1 (docs/qa-bug-hunt.md):
//   "Hardcoded webhook shared secret in deployed edge function".
//
// The previous implementation read the shared secret from a string
// literal ('your-secret'), which meant:
//   - any deployment that forgot to override it accepted the literal
//     'your-secret' as a valid shared secret;
//   - the env var APIFY_WEBHOOK_SECRET was never consulted.
// The fix must read from process.env.APIFY_WEBHOOK_SECRET, fail
// closed (503) when that env var is unset, and use a constant-time
// compare so attackers cannot probe the secret via timing.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import handler, {
  verifyApifyWebhookSecret,
  type ApifyWebhookPayload,
} from './apify-webhook';

function makeRequest(
  body: unknown,
  init: { sharedSecretHeader?: string | null } = {},
): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (init.sharedSecretHeader !== null) {
    headers.set('X-Shared-Secret', init.sharedSecretHeader ?? 'placeholder');
  }
  return new Request('https://example.com/functions/apify-webhook', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const VALID_PAYLOAD: ApifyWebhookPayload = {
  runId: 'apify-run-123',
  status: 'SUCCEEDED',
  defaultDatasetId: 'ds-abc',
};

describe('apify-webhook (CRITICAL-1 fix)', () => {
  const ORIGINAL_ENV = process.env.APIFY_WEBHOOK_SECRET;
  const ORIGINAL_DENO = (globalThis as unknown as { Deno?: unknown }).Deno;

  beforeEach(() => {
    delete process.env.APIFY_WEBHOOK_SECRET;
    delete (globalThis as unknown as { Deno?: unknown }).Deno;
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.APIFY_WEBHOOK_SECRET;
    } else {
      process.env.APIFY_WEBHOOK_SECRET = ORIGINAL_ENV;
    }
    if (ORIGINAL_DENO === undefined) {
      delete (globalThis as unknown as { Deno?: unknown }).Deno;
    } else {
      (globalThis as unknown as { Deno?: unknown }).Deno = ORIGINAL_DENO;
    }
  });

  // ── 1. Fails closed when the env var is missing ────────────────────
  it('returns 503 service_unconfigured when APIFY_WEBHOOK_SECRET is unset', async () => {
    delete process.env.APIFY_WEBHOOK_SECRET;
    const res = await handler(makeRequest(VALID_PAYLOAD, { sharedSecretHeader: 'anything' }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ error: 'SERVICE_UNCONFIGURED' });
  });

  // ── 2. No longer accepts the old hardcoded literal ─────────────────
  it('rejects the historical hardcoded literal "your-secret"', async () => {
    process.env.APIFY_WEBHOOK_SECRET='real-secret-from-env';
    const res = await handler(makeRequest(VALID_PAYLOAD, { sharedSecretHeader: 'your-secret' }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: 'UNAUTHORIZED' });
  });

  // ── 3. Rejects wrong / missing header ─────────────────────────────
  it('returns 401 when the X-Shared-Secret header is missing', async () => {
    process.env.APIFY_WEBHOOK_SECRET='real-secret-from-env';
    const res = await handler(makeRequest(VALID_PAYLOAD, { sharedSecretHeader: null }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: 'UNAUTHORIZED' });
  });

  it('returns 401 when the X-Shared-Secret header is wrong', async () => {
    process.env.APIFY_WEBHOOK_SECRET='real-secret-from-env';
    const res = await handler(makeRequest(VALID_PAYLOAD, { sharedSecretHeader: 'nope' }));
    expect(res.status).toBe(401);
  });

  // ── 4. Accepts the correct secret ─────────────────────────────────
  it('processes the webhook when the secret matches', async () => {
    process.env.APIFY_WEBHOOK_SECRET='real-secret-from-env';
    const res = await handler(makeRequest(VALID_PAYLOAD, { sharedSecretHeader: 'real-secret-from-env' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(typeof body.snapshotId).toBe('string');
    expect(typeof body.jobId).toBe('string');
    expect(typeof body.explanationId).toBe('string');
  });

  // ── 5. verifyApifyWebhookSecret helper ────────────────────────────
  describe('verifyApifyWebhookSecret', () => {
    it('returns "unconfigured" when APIFY_WEBHOOK_SECRET is unset', () => {
      delete process.env.APIFY_WEBHOOK_SECRET;
      const req = makeRequest({}, { sharedSecretHeader: 'whatever' });
      expect(verifyApifyWebhookSecret(req)).toEqual({ ok: false, reason: 'unconfigured' });
    });

    it('returns "mismatch" for a wrong header value', () => {
      process.env.APIFY_WEBHOOK_SECRET='expected-secret';
      const req = makeRequest({}, { sharedSecretHeader: 'wrong-secret' });
      expect(verifyApifyWebhookSecret(req)).toEqual({ ok: false, reason: 'mismatch' });
    });

    it('returns "mismatch" when the header is absent', () => {
      process.env.APIFY_WEBHOOK_SECRET='expected-secret';
      const req = makeRequest({}, { sharedSecretHeader: null });
      expect(verifyApifyWebhookSecret(req)).toEqual({ ok: false, reason: 'mismatch' });
    });

    it('returns { ok: true } when the header matches', () => {
      process.env.APIFY_WEBHOOK_SECRET='expected-secret';
      const req = makeRequest({}, { sharedSecretHeader: 'expected-secret' });
      expect(verifyApifyWebhookSecret(req)).toEqual({ ok: true });
    });

    it('reads APIFY_WEBHOOK_SECRET from Deno.env in the edge runtime', () => {
      delete process.env.APIFY_WEBHOOK_SECRET;
      (globalThis as unknown as {
        Deno: { env: { get: (key: string) => string | undefined } };
      }).Deno = {
        env: {
          get: (key: string) => key === 'APIFY_WEBHOOK_SECRET' ? 'deno-edge-secret' : undefined,
        },
      };
      const req = makeRequest({}, { sharedSecretHeader: 'deno-edge-secret' });
      expect(verifyApifyWebhookSecret(req)).toEqual({ ok: true });
    });
  });
});
