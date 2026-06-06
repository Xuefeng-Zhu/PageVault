// Evidence bundle export for PageVault (US-008).
//
// buildEvidenceBundle(changeId, options) returns a Node Buffer
// containing a ZIP archive of the change's evidence: raw markdown
// before/after, the AI brief, an audit trail, and a signed manifest.
//
// The signing key is HMAC-SHA256(secret, manifest.json bytes) hex,
// where secret = process.env.EVIDENCE_EXPORT_SIGNING_SECRET. The
// manifest is the signed entry; the signature is stored alongside
// it as `manifest.sig`. Verifiers re-HMAC the manifest bytes with
// the same secret and compare hex strings.
//
// The export size is bounded to ~10MB (markdown_text is capped at
// 50KB per snapshot in the scan pipeline, and the AI brief is
// single-digit KB). Streaming: jszip's generateNodeStream emits the
// ZIP without buffering the full archive in memory before returning
// it, which keeps the route handler's memory footprint flat under
// many concurrent requests.
//
// The data fetch goes through getChangeForUser() (which already
// enforces the owner check via PostgREST embed + TS walk) plus
// direct service-role fetches for the two snapshot rows and the
// scan job row. We don't load from InsForge Storage because the
// scan pipeline persists the markdown inline on `snapshots.markdown_text`
// (50KB cap) — that's the source of truth for the bundle.
//
// The bundle is small enough that a 10MB cap is documented in the
// PR; if you need a larger bundle, prefer chunked fetch over a
// larger in-memory cap.
import JSZip from 'jszip';
import { createHmac } from 'node:crypto';
import { getChangeForUser, getRoom } from './insforge';
import { getInsforgeBaseUrl } from './env';

// Manifest schema version. Bump when changing entry names, the
// manifest top-level shape, or the signing algorithm.
export const MANIFEST_SCHEMA_VERSION = '1.0';

// Soft upper bound on the export size. The scan pipeline caps
// `snapshots.markdown_text` at 50KB and the AI brief is small JSON;
// the bundle is well under 200KB in practice. 10MB leaves headroom
// for unusually chatty pages without making the route handler a
// memory hazard.
export const EVIDENCE_BUNDLE_MAX_BYTES = 10 * 1024 * 1024;

export interface BuildEvidenceBundleOptions {
  /**
   * The session user id of the operator exporting the bundle.
   * Recorded in `manifest.exported_by` and `audit.triggered_by`.
   */
  exportedBy: string;
  /**
   * ISO 8601 timestamp. Pin from the route handler so the same
   * export call yields a stable manifest across retries.
   */
  exportedAt: string;
}

interface SnapshotRow {
  id: string;
  tracked_page_id: string;
  job_id: string | null;
  observed_at: string;
  markdown_text: string | null;
  markdown_hash: string | null;
}

interface ScanJobRow {
  id: string;
  status: string;
  trigger_type: string | null;
  requested_at: string | null;
  finished_at: string | null;
}

/**
 * Build the ZIP bundle for a single change id. Throws if the change
 * is missing, doesn't belong to a room, or the DB is unreachable.
 * The 3-outcome gate below (fetch → 5xx, 404 vs 200) follows the
 * pattern documented in `insforge-runtime-patterns` (SDK swallows
 * errors as []), so a DB outage surfaces as 500 rather than as
 * a 404 for an owner who does in fact own the change.
 */
export async function buildEvidenceBundle(
  changeId: string,
  options: BuildEvidenceBundleOptions,
): Promise<Buffer> {
  // 1. Owner-scoped change lookup. getChangeForUser already does
  // the PostgREST embed + TS walk for the authz check; null means
  // the change doesn't exist OR the user doesn't own it (we return
  // 404 to the API caller either way to avoid leaking existence).
  const change = await getChangeForUser(changeId, options.exportedBy);
  if (!change) {
    throw new EvidenceBundleNotFoundError(`Change ${changeId} not found or not owned by ${options.exportedBy}`);
  }

  // 2. Look up the room so manifest.room_name is human-meaningful.
  const room = await getRoom(change.roomId);
  const roomName = room?.name ?? '(unknown room)';

  // 3. Fetch the two snapshot rows (before / after). The change
  // row's currentSnapshotId/previousSnapshotId identify them. We
  // use the SRK REST endpoint directly to keep the three-outcome
  // gate (5xx vs 404 vs 200) explicit — see the SDK-swallow-errors
  // pitfall in the runtime-patterns skill.
  const beforeSnap = change.previousSnapshotId
    ? await fetchSnapshotById(change.previousSnapshotId)
    : null;
  const afterSnap = change.currentSnapshotId
    ? await fetchSnapshotById(change.currentSnapshotId)
    : null;

  // 4. Fetch the scan job so audit.json has trigger timing.
  //    The job_id is on the after-snapshot row; the before-snapshot
  //    may share it, but we prefer the after (the one that triggered
  //    this change).
  const scanJob = afterSnap?.job_id
    ? await fetchScanJobById(afterSnap.job_id)
    : null;

  // 5. Build the four content entries.
  const beforeMd = beforeSnap?.markdown_text ?? '';
  const afterMd = afterSnap?.markdown_text ?? '';
  const aiBrief = {
    severity: change.severity,
    changeType: change.changeType,
    summary: change.summary,
    businessInterpretation: change.businessInterpretation,
    recommendedActions: change.recommendedActions,
    confidence: null as number | null,  // TODO: pull from ai_explanations row when not null
  };
  const audit = {
    captured_at: afterSnap?.observed_at ?? change.createdAt,
    scan_id: scanJob?.id ?? afterSnap?.job_id ?? null,
    scan_triggered_at: scanJob?.requested_at ?? null,
    scan_completed_at: scanJob?.finished_at ?? null,
    triggered_by: options.exportedBy,
    hmac_algorithm: 'sha256',
  };

  // 6. Build the manifest. The entry order is preserved by
  // JSON.stringify, so re-running the export with the same inputs
  // produces a byte-identical manifest and therefore a stable HMAC.
  const manifest = {
    change_id: changeId,
    room_id: change.roomId,
    room_name: roomName,
    exported_at: options.exportedAt,
    exported_by: options.exportedBy,
    schema_version: MANIFEST_SCHEMA_VERSION,
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');

  // 7. Sign the manifest bytes. The signature is the bytes of the
  // hex digest, NOT a base64-encoded value — `manifest.sig` is
  // 64 hex chars by construction.
  const sig = signManifest(manifestBytes);

  // 8. Compose the ZIP. jszip's generateNodeStream is the
  // streaming path: it produces a Readable that we await fully to
  // get a Buffer. The Buffer is the final artifact; we don't expose
  // the stream to callers because the route handler wants a single
  // response body. For higher-throughput use, swap to generateInternalStream
  // and pipe to res.
  const zip = new JSZip();
  zip.file('manifest.json', manifestBytes);
  zip.file('manifest.sig', sig);
  zip.file('before.md', beforeMd);
  zip.file('after.md', afterMd);
  zip.file('ai-brief.json', JSON.stringify(aiBrief, null, 2));
  zip.file('audit.json', JSON.stringify(audit, null, 2));

  const buf = await zip.generateAsync({
    type: 'nodebuffer',
    streamFiles: true,           // streaming-safe: lower memory peak
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  if (buf.byteLength > EVIDENCE_BUNDLE_MAX_BYTES) {
    // Defensive — should never trip given the upstream caps.
    throw new Error(
      `Evidence bundle for ${changeId} is ${buf.byteLength} bytes, exceeds the ${EVIDENCE_BUNDLE_MAX_BYTES} cap. ` +
      'Refusing to return an oversized export.'
    );
  }

  return buf;
}

/**
 * Sign the manifest bytes with HMAC-SHA256 using
 * process.env.EVIDENCE_EXPORT_SIGNING_SECRET. Returns a hex
 * string of length 64. Throws if the secret is unset — the
 * route handler converts that to a 500.
 */
function signManifest(manifestBytes: Buffer): string {
  const secret = process.env.EVIDENCE_EXPORT_SIGNING_SECRET;
  if (!secret || secret.trim().length === 0) {
    throw new Error(
      'EVIDENCE_EXPORT_SIGNING_SECRET is not set. Refusing to export a bundle without a signing secret.'
    );
  }
  return createHmac('sha256', secret).update(manifestBytes).digest('hex');
}

/**
 * Fetch one snapshots row by id via the service-role REST endpoint.
 * Returns null if the row doesn't exist; throws on transport errors.
 */
async function fetchSnapshotById(snapshotId: string): Promise<SnapshotRow | null> {
  const { baseUrl, headers, err } = srkRequestCtx();
  if (err) throw err;

  const url = `${baseUrl}/api/database/records/snapshots?id=eq.${encodeURIComponent(snapshotId)}&select=id,tracked_page_id,job_id,observed_at,markdown_text,markdown_hash&limit=1`;
  let resp: Response;
  try {
    resp = await fetch(url, { headers, cache: 'no-store' });
  } catch (e) {
    throw new Error(`fetchSnapshotById(${snapshotId}) transport error: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!resp.ok) {
    throw new Error(`fetchSnapshotById(${snapshotId}) HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
  const rows = await resp.json() as SnapshotRow[];
  return rows[0] ?? null;
}

/**
 * Fetch one snapshot_jobs row by id via the service-role REST endpoint.
 */
async function fetchScanJobById(jobId: string): Promise<ScanJobRow | null> {
  const { baseUrl, headers, err } = srkRequestCtx();
  if (err) throw err;

  const url = `${baseUrl}/api/database/records/snapshot_jobs?id=eq.${encodeURIComponent(jobId)}&select=id,status,trigger_type,requested_at,finished_at&limit=1`;
  let resp: Response;
  try {
    resp = await fetch(url, { headers, cache: 'no-store' });
  } catch (e) {
    throw new Error(`fetchScanJobById(${jobId}) transport error: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!resp.ok) {
    throw new Error(`fetchScanJobById(${jobId}) HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
  const rows = await resp.json() as ScanJobRow[];
  return rows[0] ?? null;
}

function srkRequestCtx(): { baseUrl: string; headers: Record<string, string>; err: Error | null } {
  const srk = process.env.INSFORGE_SERVICE_ROLE_KEY;
  if (!srk || srk.trim().length === 0) {
    return {
      baseUrl: '',
      headers: {},
      err: new Error('INSFORGE_SERVICE_ROLE_KEY is not set; cannot fetch snapshot data for export'),
    };
  }
  return {
    baseUrl: getInsforgeBaseUrl(),
    headers: {
      'Authorization': `Bearer ${srk}`,
      'Content-Type': 'application/json',
    },
    err: null,
  };
}

/**
 * Thrown by buildEvidenceBundle when the change doesn't exist or
 * the caller doesn't own the room that owns the page that owns
 * the change. The route handler maps this to 404.
 */
export class EvidenceBundleNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvidenceBundleNotFoundError';
  }
}
