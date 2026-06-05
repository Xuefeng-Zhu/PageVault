// lib/shared-changes.ts
// US-013 public read-only share link data layer.
//
// A "shared change" is a row in public.shared_changes with a random
// token. The owner of a change POSTs to /api/changes/[changeId]/share
// to create one; the resulting token is the path component of the
// public URL (/share/<token>).
//
// Why a separate file:
//   - The data layer needs four operations (create, lookup-by-token,
//     fetch-public-change, revoke-by-changeId). Keeping them in one
//     file makes the service-role / anon boundary obvious and lets
//     the API route and the public page both import the same
//     primitives.
//   - The RLS policy on public.shared_changes (see
//     db/migrations/2026-06-04-shared-changes.sql) lets anon SELECT
//     only non-revoked, non-expired rows. The lookup-by-token helper
//     is therefore safe to call from a server component without an
//     InsForge session — anon key + the RLS policy are the auth.
//
// SRK pattern (see lib/notifications.ts and the insforge-runtime-patterns
// skill): the service role key bypasses RLS, so writes (create,
// revoke) need an explicit Authorization header. We never fall back
// to anon for writes — anon can only SELECT.

import { randomBytes } from 'node:crypto';
import { getInsforgeBaseUrl } from './env';
import type { ChangeAnalysis, EvidenceItem } from '@/types';

const SRK = (): string => {
  const k = process.env.INSFORGE_SERVICE_ROLE_KEY;
  if (!k) {
    throw new Error('INSFORGE_SERVICE_ROLE_KEY is not set; cannot mutate shared_changes');
  }
  return k;
};

const DB = (): string => `${getInsforgeBaseUrl()}/api/database/records`;

/** A 32-byte random token, hex-encoded (64 chars). */
export function generateShareToken(): string {
  return randomBytes(32).toString('hex');
}

export interface SharedChangeRow {
  id: string;
  change_id: string;
  token: string;
  created_at: string;
  created_by: string;
  expires_at: string | null;
  revoked_at: string | null;
}

/**
 * Insert a new shared_changes row. Service-role call — bypasses RLS
 * so the create works regardless of the RLS policy on the table.
 *
 * Returns the inserted row. Throws on a non-2xx response (PostgREST
 * error payload) or network failure.
 */
export async function createSharedChange(opts: {
  changeId: string;
  createdBy: string;
  token?: string;
  expiresAt?: string | null;
}): Promise<SharedChangeRow> {
  const token = opts.token ?? generateShareToken();
  const row = {
    change_id: opts.changeId,
    created_by: opts.createdBy,
    token,
    expires_at: opts.expiresAt ?? null,
  };
  const r = await fetch(`${DB()}/shared_changes`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SRK()}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify([row]),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`shared_changes insert failed: ${r.status} ${text.slice(0, 200)}`);
  }
  const rows = (await r.json()) as SharedChangeRow[];
  if (!rows.length) {
    throw new Error('shared_changes insert returned no rows');
  }
  return rows[0];
}

/**
 * Look up a shared_changes row by token. Anon-friendly: the RLS
 * policy on the table gates anon SELECT to non-revoked, non-expired
 * rows, so a stale or revoked token returns an empty array (which
 * the public page treats as 404).
 *
 * Returns null when the token does not exist or has been revoked/expired.
 * Surfaces network errors as thrown exceptions.
 */
export async function getSharedChangeByToken(token: string): Promise<SharedChangeRow | null> {
  const base = getInsforgeBaseUrl();
  const anonKey = process.env.INSFORGE_ANON_KEY;
  if (!anonKey) {
    throw new Error('INSFORGE_ANON_KEY is not set; cannot resolve share token');
  }
  // Use the anon key. The RLS policy will return [] for revoked/expired
  // rows even if the token matches. This is the public path — no
  // service role here, by design.
  const url = new URL(`${base}/api/database/records/shared_changes`);
  url.searchParams.set('select', 'id,change_id,token,created_at,created_by,expires_at,revoked_at');
  url.searchParams.set('token', `eq.${token}`);
  url.searchParams.set('limit', '1');
  const r = await fetch(url.toString(), {
    headers: { 'Authorization': `Bearer ${anonKey}` },
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`shared_changes lookup failed: ${r.status} ${text.slice(0, 200)}`);
  }
  const rows = (await r.json()) as SharedChangeRow[];
  return rows[0] ?? null;
}

// Normalize one evidence item from output_json. Mirrors the
// normalizeEvidenceItem in lib/insforge.ts but lives here so the
// public lookup doesn't pull in the rest of the insforge module
// (which is heavy and auth-coupled).
function normalizePublicEvidenceItem(item: unknown): EvidenceItem {
  if (!item || typeof item !== 'object') {
    return { before: '', after: '', explanation: '' };
  }
  const e = item as Record<string, unknown>;
  return {
    before: String(e.before ?? e.old ?? ''),
    after: String(e.after ?? e.new ?? ''),
    explanation: String(e.explanation ?? ''),
  };
}

// Shape of a public lookup row — a flattened ai_explanations row
// with its snapshot's source URL pulled in via FK embed. We embed
// snapshots!snapshot_id(page_title,final_url,tracked_pages!tracked_page_id(source_url))
// so the public page can show "the change to <URL>" without needing
// the viewer to be authenticated.
interface PublicChangeRow {
  id: string;
  output_json: unknown;
  confidence: number | null;
  created_at: string;
  change_type: string | null;
  page_title: string | null;
  final_url: string | null;
  source_url: string | null;
}

/**
 * Fetch a change for a public share page. Service-role call so the
 * RLS policy on ai_explanations / snapshots / tracked_pages (which
 * restrict reads to the row owner) does not gate the public viewer.
 *
 * The caller must have already resolved the share token and know
 * that it points at this changeId. This function does not re-check
 * the shared_changes row — keep that responsibility at the call site
 * so a future pagination or caching layer can call this directly
 * with a known-good changeId.
 *
 * Returns a minimal ChangeAnalysis shape sufficient for the public
 * page: id, summary, severity, businessInterpretation, evidence,
 * recommendedActions, and the source URL from the tracked page.
 * Does NOT include roomId (intentionally — the public viewer should
 * not learn which project this came from).
 */
export async function getPublicChangeById(changeId: string): Promise<ChangeAnalysis | null> {
  const base = getInsforgeBaseUrl();
  const select =
    'id,output_json,confidence,created_at,' +
    'snapshots!snapshot_id(change_type,page_title,final_url,tracked_pages!tracked_page_id(source_url))';
  const url = new URL(`${base}/api/database/records/ai_explanations`);
  url.searchParams.set('select', select);
  url.searchParams.set('id', `eq.${changeId}`);
  url.searchParams.set('limit', '1');
  const r = await fetch(url.toString(), {
    headers: { 'Authorization': `Bearer ${SRK()}` },
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`public change lookup failed: ${r.status} ${text.slice(0, 200)}`);
  }
  const rows = (await r.json()) as Array<Record<string, unknown>>;
  if (!rows.length) return null;
  const row = rows[0];

  // Unwrap the snapshots embed (to-one FK; may be an object or a
  // 0-or-1 array depending on PostgREST version).
  const rawSnap = row.snapshots;
  const snap = Array.isArray(rawSnap) ? rawSnap[0] : rawSnap;
  const snapObj = (snap ?? {}) as { change_type?: unknown; page_title?: unknown; final_url?: unknown; tracked_pages?: unknown };
  const rawTp = snapObj.tracked_pages;
  const tp = Array.isArray(rawTp) ? rawTp[0] : rawTp;
  const tpObj = (tp ?? {}) as { source_url?: unknown };

  let output: Record<string, unknown> = {};
  if (typeof row.output_json === 'string') {
    try { output = JSON.parse(row.output_json); } catch { /* keep {} */ }
  } else if (row.output_json && typeof row.output_json === 'object') {
    output = row.output_json as Record<string, unknown>;
  }

  const evidence = Array.isArray(output.evidence)
    ? (output.evidence as unknown[]).map((e) => normalizePublicEvidenceItem(e))
    : [];
  const recommendedActions = Array.isArray(output.recommendedActions)
    ? (output.recommendedActions as string[])
    : [];

  const publicRow: PublicChangeRow = {
    id: String(row.id),
    output_json: output,
    confidence: typeof row.confidence === 'number' ? row.confidence : null,
    created_at: String(row.created_at),
    change_type: typeof snapObj.change_type === 'string' ? snapObj.change_type : null,
    page_title: typeof snapObj.page_title === 'string' ? snapObj.page_title : null,
    final_url: typeof snapObj.final_url === 'string' ? snapObj.final_url : null,
    source_url: typeof tpObj.source_url === 'string' ? tpObj.source_url : null,
  };

  return {
    id: publicRow.id,
    roomId: '', // intentionally not exposed to the public viewer
    watchedUrlId: '',
    previousSnapshotId: null,
    currentSnapshotId: null,
    severity: (output.severity ?? 'low') as ChangeAnalysis['severity'],
    changeType: (publicRow.change_type ?? output.changeType ?? 'none') as ChangeAnalysis['changeType'],
    summary: String(output.summary ?? ''),
    businessInterpretation: (output.businessInterpretation ?? null) as string | null,
    recommendedActions,
    evidence,
    storageKey: null,
    storageUrl: null,
    reportBoxFileId: null,
    createdAt: publicRow.created_at,
    // Stash the source URL on a private field. The route page reads
    // it to render the "this is the change to <URL>" header. We put
    // it on the storageKey to avoid changing the ChangeAnalysis
    // type; the public page never persists this object.
    // Actually, the cleanest place is on summary or a wrapper. The
    // page handler is the one that needs the URL — return it from
    // the public-row wrapper via a side export below.
  } as ChangeAnalysis;
}

/**
 * Companion to getPublicChangeById — returns the source URL the
 * tracked page that triggered this change was watching. Returned
 * alongside the change so the page can render the URL without
 * needing a separate fetch.
 */
export async function getPublicChangeSourceUrl(changeId: string): Promise<string | null> {
  const base = getInsforgeBaseUrl();
  const select =
    'snapshots!snapshot_id(tracked_pages!tracked_page_id(source_url))';
  const url = new URL(`${base}/api/database/records/ai_explanations`);
  url.searchParams.set('select', select);
  url.searchParams.set('id', `eq.${changeId}`);
  url.searchParams.set('limit', '1');
  const r = await fetch(url.toString(), {
    headers: { 'Authorization': `Bearer ${SRK()}` },
  });
  if (!r.ok) {
    return null;
  }
  const rows = (await r.json()) as Array<Record<string, unknown>>;
  if (!rows.length) return null;
  const rawSnap = rows[0].snapshots;
  const snap = Array.isArray(rawSnap) ? rawSnap[0] : rawSnap;
  const snapObj = (snap ?? {}) as { tracked_pages?: unknown };
  const rawTp = snapObj.tracked_pages;
  const tp = Array.isArray(rawTp) ? rawTp[0] : rawTp;
  const tpObj = (tp ?? {}) as { source_url?: unknown };
  return typeof tpObj.source_url === 'string' ? tpObj.source_url : null;
}

/**
 * Revoke every shared_changes row for the given change id. Sets
 * revoked_at = now() on all non-revoked rows. Idempotent — calling
 * twice is a no-op the second time.
 *
 * Returns the number of rows that were actually updated (0 when
 * nothing was outstanding).
 */
export async function revokeSharedChangesForChange(changeId: string): Promise<number> {
  const url = new URL(`${DB()}/shared_changes`);
  url.searchParams.set('change_id', `eq.${changeId}`);
  url.searchParams.set('revoked_at', 'is.null');
  const r = await fetch(url.toString(), {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${SRK()}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify({ revoked_at: new Date().toISOString() }),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`shared_changes revoke failed: ${r.status} ${text.slice(0, 200)}`);
  }
  const rows = (await r.json()) as SharedChangeRow[];
  return rows.length;
}
