// Tests for lib/evidence-export.ts — US-008 evidence bundle export.
//
// We mock the data layer at the module boundary (vi.mock) so the
// test is hermetic and runs in CI without InsForge credentials. The
// function under test is responsible for:
//   1. Fetching the change + the two snapshots + the AI explanation +
//      the scan job + the room from the data layer.
//   2. Building a ZIP whose entries are manifest.json, before.md,
//      after.md, ai-brief.json, audit.json, and manifest.sig.
//   3. Computing an HMAC-SHA256 of manifest.json (hex) using
//      process.env.EVIDENCE_EXPORT_SIGNING_SECRET.
//
// Each entry is independently verifiable from a known-good input, so
// a future refactor that swaps the ZIP library (e.g. to archiver)
// only needs to re-pin the test inputs, not rewrite the assertions.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';

vi.mock('./insforge', () => ({
  getChangeForUser: vi.fn(),
  getRoom: vi.fn(),
}));

import { getChangeForUser, getRoom } from './insforge';

const FIXTURE_CHANGE_ID = 'aaaaaaaa-1111-0000-0000-000000000001';
const FIXTURE_ROOM_ID    = 'aaaaaaaa-2222-0000-0000-000000000001';
const FIXTURE_USER_ID    = 'aaaaaaaa-3333-0000-0000-000000000001';
const FIXTURE_AI_ID      = 'aaaaaaaa-4444-0000-0000-000000000001';
const FIXTURE_BEFORE_ID  = 'aaaaaaaa-5555-0000-0000-000000000001';
const FIXTURE_AFTER_ID   = 'aaaaaaaa-6666-0000-0000-000000000001';
const FIXTURE_JOB_ID     = 'aaaaaaaa-7777-0000-0000-000000000001';
const FIXTURE_PAGE_ID    = 'aaaaaaaa-8888-0000-0000-000000000001';
const FIXTURE_SCAN_REQ   = '2026-06-04T10:00:00.000Z';
const FIXTURE_SCAN_DONE  = '2026-06-04T10:00:42.000Z';
const FIXTURE_BEFORE_TS  = '2026-06-03T09:00:00.000Z';
const FIXTURE_AFTER_TS   = '2026-06-04T10:00:40.000Z';
const FIXTURE_EXPORT_TS  = '2026-06-05T08:00:00.000Z';

// 36+ char non-numeric string. Long enough that the display redaction
// layer leaves it alone, so it round-trips intact when written to disk.
const SIGNING_SECRET = 'evidence-export-test-signing-secret-do-not-use';

const FAKE_OUTPUT_JSON = {
  severity: 'high',
  changeType: 'pricing',
  summary: 'AWS Lambda raised per-request price from $0.0000167 to $0.0000200.',
  businessInterpretation: 'A 20% price increase on every Lambda invocation.',
  recommendedActions: ['Re-evaluate serverless architecture', 'Negotiate EDP commit'],
};

const BEFORE_MD = '# AWS Lambda Pricing\n\n- $0.0000167 per request\n';
const AFTER_MD  = '# AWS Lambda Pricing\n\n- $0.0000200 per request\n';

beforeEach(() => {
  process.env.EVIDENCE_EXPORT_SIGNING_SECRET = SIGNING_SECRET;
  process.env.INSFORGE_API_URL = 'https://example.insforge.app';
  process.env.INSFORGE_SERVICE_ROLE_KEY = 'ik_test';
  process.env.INSFORGE_ANON_KEY = 'ik_test';

  (getRoom as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: FIXTURE_ROOM_ID,
    userId: FIXTURE_USER_ID,
    name: 'AWS Pricing Watcher',
    targetName: 'AWS Lambda',
    category: 'competitor',
    storageFolderPath: 'pagevault/aws-pricing-watcher',
    boxFolderId: 'pagevault/aws-pricing-watcher',
    createdAt: '2026-06-01T00:00:00.000Z',
  });

  (getChangeForUser as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: FIXTURE_AI_ID,
    roomId: FIXTURE_ROOM_ID,
    watchedUrlId: FIXTURE_PAGE_ID,
    previousSnapshotId: FIXTURE_BEFORE_ID,
    currentSnapshotId: FIXTURE_AFTER_ID,
    severity: 'high',
    changeType: 'pricing',
    summary: FAKE_OUTPUT_JSON.summary,
    businessInterpretation: FAKE_OUTPUT_JSON.businessInterpretation,
    recommendedActions: FAKE_OUTPUT_JSON.recommendedActions,
    evidence: [],
    storageKey: null,
    storageUrl: null,
    reportBoxFileId: null,
    createdAt: FIXTURE_AFTER_TS,
  });
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.EVIDENCE_EXPORT_SIGNING_SECRET;
});

describe('buildEvidenceBundle()', () => {
  it('returns a Buffer whose ZIP entries match the spec (manifest.json, before.md, after.md, ai-brief.json, audit.json, manifest.sig)', async () => {
    global.fetch = makeFetchMock() as unknown as typeof fetch;

    const { buildEvidenceBundle } = await import('./evidence-export');
    const buffer = await buildEvidenceBundle(FIXTURE_CHANGE_ID, {
      exportedBy: FIXTURE_USER_ID,
      exportedAt: FIXTURE_EXPORT_TS,
    });
    expect(Buffer.isBuffer(buffer)).toBe(true);

    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(buffer);
    const entryNames = Object.keys(zip.files).sort();
    expect(entryNames).toEqual([
      'after.md',
      'ai-brief.json',
      'audit.json',
      'before.md',
      'manifest.json',
      'manifest.sig',
    ]);
  });

  it('embeds the right content in each entry and a manifest that matches the input data', async () => {
    global.fetch = makeFetchMock() as unknown as typeof fetch;

    const { buildEvidenceBundle } = await import('./evidence-export');
    const buffer = await buildEvidenceBundle(FIXTURE_CHANGE_ID, {
      exportedBy: FIXTURE_USER_ID,
      exportedAt: FIXTURE_EXPORT_TS,
    });

    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(buffer);

    expect(await zip.file('before.md')!.async('string')).toBe(BEFORE_MD);
    expect(await zip.file('after.md')!.async('string')).toBe(AFTER_MD);

    const aiBrief = JSON.parse(await zip.file('ai-brief.json')!.async('string'));
    expect(aiBrief.severity).toBe('high');
    expect(aiBrief.changeType).toBe('pricing');
    expect(aiBrief.summary).toBe(FAKE_OUTPUT_JSON.summary);
    expect(aiBrief.businessInterpretation).toBe(FAKE_OUTPUT_JSON.businessInterpretation);
    expect(aiBrief.recommendedActions).toEqual(FAKE_OUTPUT_JSON.recommendedActions);
    expect(aiBrief.confidence).toBeNull();

    const audit = JSON.parse(await zip.file('audit.json')!.async('string'));
    expect(audit.captured_at).toBe(FIXTURE_AFTER_TS);
    expect(audit.scan_id).toBe(FIXTURE_JOB_ID);
    expect(audit.scan_triggered_at).toBe(FIXTURE_SCAN_REQ);
    expect(audit.scan_completed_at).toBe(FIXTURE_SCAN_DONE);
    expect(audit.triggered_by).toBe(FIXTURE_USER_ID);
    expect(audit.hmac_algorithm).toBe('sha256');

    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    expect(manifest.change_id).toBe(FIXTURE_CHANGE_ID);
    expect(manifest.room_id).toBe(FIXTURE_ROOM_ID);
    expect(manifest.room_name).toBe('AWS Pricing Watcher');
    expect(manifest.exported_at).toBe(FIXTURE_EXPORT_TS);
    expect(manifest.exported_by).toBe(FIXTURE_USER_ID);
    expect(manifest.schema_version).toBe('1.0');
  });

  it('signs manifest.json with HMAC-SHA256 (64 hex chars) using EVIDENCE_EXPORT_SIGNING_SECRET', async () => {
    global.fetch = makeFetchMock() as unknown as typeof fetch;

    const { buildEvidenceBundle } = await import('./evidence-export');
    const buffer = await buildEvidenceBundle(FIXTURE_CHANGE_ID, {
      exportedBy: FIXTURE_USER_ID,
      exportedAt: FIXTURE_EXPORT_TS,
    });

    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(buffer);

    const sig = (await zip.file('manifest.sig')!.async('string')).trim();
    expect(sig).toMatch(/^[0-9a-f]{64}$/);

    // Independently recompute the HMAC of the manifest bytes and
    // assert it matches the embedded signature. This pins the
    // signing contract: HMAC-SHA256(secret, manifest.json) hex.
    const manifestBytes = await zip.file('manifest.json')!.async('string');
    const expectedSig = createHmac('sha256', SIGNING_SECRET).update(manifestBytes, 'utf8').digest('hex');
    expect(sig).toBe(expectedSig);

    // A different secret produces a different signature, proving the
    // secret is actually mixed into the HMAC and not just hashed.
    const wrongSig = createHmac('sha256', 'definitely-not-the-real-secret').update(manifestBytes, 'utf8').digest('hex');
    expect(sig).not.toBe(wrongSig);
  });
});

function makeFetchMock() {
  return vi.fn(async (url: string) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/snapshots')) {
      const idFilter = u.searchParams.get('id');
      if (idFilter === `eq.${FIXTURE_BEFORE_ID}`) {
        return jsonResponse([{
          id: FIXTURE_BEFORE_ID, tracked_page_id: FIXTURE_PAGE_ID, job_id: FIXTURE_JOB_ID,
          observed_at: FIXTURE_BEFORE_TS, markdown_text: BEFORE_MD, markdown_hash: 'bh',
        }]);
      }
      if (idFilter === `eq.${FIXTURE_AFTER_ID}`) {
        return jsonResponse([{
          id: FIXTURE_AFTER_ID, tracked_page_id: FIXTURE_PAGE_ID, job_id: FIXTURE_JOB_ID,
          observed_at: FIXTURE_AFTER_TS, markdown_text: AFTER_MD, markdown_hash: 'ah',
        }]);
      }
      return jsonResponse([]);
    }
    if (u.pathname.endsWith('/snapshot_jobs')) {
      return jsonResponse([{
        id: FIXTURE_JOB_ID, tracked_page_id: FIXTURE_PAGE_ID, status: 'succeeded',
        trigger_type: 'manual', requested_at: FIXTURE_SCAN_REQ, finished_at: FIXTURE_SCAN_DONE,
      }]);
    }
    if (u.pathname.endsWith('/tracked_pages')) {
      return jsonResponse([{ id: FIXTURE_PAGE_ID, source_url: 'https://aws.amazon.com/lambda/pricing/' }]);
    }
    return jsonResponse([]);
  });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
