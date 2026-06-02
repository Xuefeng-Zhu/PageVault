// Insforge data layer for PageVault
// Typed database access helpers for rooms, URLs, scan runs, snapshots, and change analyses
// Connects to Insforge Postgres backend via @insforge/sdk
import type {
  MemoryRoom,
  RoomWithStats,
  WatchedUrl,
  PageSnapshot,
  ScanRun,
  ScanStatus,
  ChangeAnalysis,
  NewRoom,
  NewWatchedUrl,
  NewSnapshot,
  NewChangeAnalysis,
} from '@/types';
import { getInsforgeClient } from './env';

// ─── SDK client setup ──────────────────────────────────────────────────────────
//
// lib/env.ts:getInsforgeClient is the single source of truth for the
// InsForge SDK. It throws at construction time if INSFORGE_API_URL /
// INSFORGE_ANON_KEY are missing, so every call below is guaranteed a
// configured client. Do not introduce a second client factory here —
// a duplicate with hardcoded fallbacks would route misconfigured deploys
// to the wrong tenant and leak a known publishable key into the bundle.

/**
 * Execute a PostgREST query via the InsForge SDK.
 * Returns an array of row objects.
 */
async function sdkQuery<T = Record<string, unknown>>(table: string, opts: {
  select?: string;
  filters?: string;
  order?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<T[]> {
  const client = getInsforgeClient();
  const { select = '*', filters = '', order = '', limit, offset } = opts;
  // Strip schema prefix (e.g. "public.projects" -> "projects")
  const tableName = table.replace(/^public\./, '');
  const params: string[] = [`select=${select}`];
  if (filters) params.push(filters);
  if (order) params.push(`order=${order}`);
  if (limit) params.push(`limit=${limit}`);
  if (offset) params.push(`offset=${offset}`);
  const queryStr = params.join('&');
  try {
    // Use URL format for table?query params
    const { data, error } = await client.database.from(`${tableName}?${queryStr}`).select(select);
    if (error) {
      console.error('[insforge] query error:', error.message);
      return [];
    }
    return (data ?? []) as T[];
  } catch (e) {
    console.error('[insforge] query exception:', e);
    return [];
  }
}

// Helper to convert snake_case DB row to camelCase
function toMemoryRoom(row: Record<string, unknown>): MemoryRoom {
  // InsForge storage replaces Box; the underlying DB column is still called
  // `box_root_folder_id` for legacy reasons, but it now holds a storage path.
  const storageFolderPath = row.box_root_folder_id
    ? String(row.box_root_folder_id)
    : row.storage_folder_path
    ? String(row.storage_folder_path)
    : null;
  return {
    id: String(row.id),
    userId: row.user_id ? String(row.user_id) : null,
    name: String(row.name),
    targetName: String(row.target_name),
    category: (row.category as string) as MemoryRoom['category'],
    storageFolderPath,
    boxFolderId: storageFolderPath, // legacy alias
    createdAt: String(row.created_at),
  };
}

function toWatchedUrl(row: Record<string, unknown>): WatchedUrl {
  return {
    id: String(row.id),
    roomId: String(row.project_id),
    url: String(row.source_url),
    label: row.label ? String(row.label) : null,
    pageType: (row.page_type as string) as WatchedUrl['pageType'],
    createdAt: String(row.created_at),
  };
}

function toScanRun(row: Record<string, unknown>): ScanRun {
  return {
    id: String(row.id),
    roomId: String(row.room_id),
    status: (row.status as string) as ScanStatus,
    apifyRunId: row.apify_run_id ? String(row.apify_run_id) : null,
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
  };
}

function toPageSnapshot(row: Record<string, unknown>): PageSnapshot {
  // Legacy `box_file_id` column now holds the InsForge storage key.
  const storageKey = row.box_file_id
    ? String(row.box_file_id)
    : row.storage_key
    ? String(row.storage_key)
    : null;
  const storageUrl = row.storage_url ? String(row.storage_url) : null;
  return {
    id: String(row.id),
    roomId: String(row.room_id),
    watchedUrlId: String(row.watched_url_id),
    scanRunId: String(row.scan_run_id),
    url: String(row.url),
    title: row.title ? String(row.title) : '',
    textContent: row.text_content ? String(row.text_content) : '',
    contentHash: String(row.content_hash),
    storageKey,
    storageUrl,
    boxFileId: storageKey, // legacy alias
    capturedAt: String(row.captured_at),
  };
}

function toChangeAnalysis(row: Record<string, unknown>): ChangeAnalysis {
  let recommendedActions: string[] = [];
  let evidence: unknown[] = [];

  if (typeof row.recommended_actions === 'string') {
    try {
      recommendedActions = JSON.parse(row.recommended_actions as string);
    } catch {}
  } else if (Array.isArray(row.recommended_actions)) {
    recommendedActions = row.recommended_actions as string[];
  }

  if (typeof row.evidence === 'string') {
    try {
      evidence = JSON.parse(row.evidence as string);
    } catch {}
  } else if (Array.isArray(row.evidence)) {
    evidence = row.evidence as unknown[];
  }

  // Legacy `report_box_file_id` column now holds the InsForge storage key.
  const storageKey = row.report_box_file_id
    ? String(row.report_box_file_id)
    : row.storage_key
    ? String(row.storage_key)
    : null;
  const storageUrl = row.storage_url ? String(row.storage_url) : null;

  return {
    id: String(row.id),
    roomId: String(row.room_id),
    watchedUrlId: String(row.watched_url_id),
    previousSnapshotId: row.previous_snapshot_id ? String(row.previous_snapshot_id) : null,
    currentSnapshotId: row.current_snapshot_id ? String(row.current_snapshot_id) : null,
    severity: (row.severity as string) as ChangeAnalysis['severity'],
    changeType: (row.change_type as string) as ChangeAnalysis['changeType'],
    summary: String(row.summary),
    businessInterpretation: row.business_interpretation ? String(row.business_interpretation) : null,
    recommendedActions,
    evidence: evidence as ChangeAnalysis['evidence'],
    storageKey,
    storageUrl,
    reportBoxFileId: storageKey, // legacy alias
    createdAt: String(row.created_at),
  };
}

function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function now(): string {
  return new Date().toISOString();
}

// ─── Room operations (real mode via InsForge SDK) ─────────────────────────────

export async function createRoom(input: NewRoom): Promise<MemoryRoom> {
  const client = getInsforgeClient();
  // Accept either the new `storageFolderPath` or the legacy `boxFolderId` field.
  const storageFolderPath = input.storageFolderPath ?? input.boxFolderId ?? null;
  // Fall back to a system user ID if no session user is provided — the projects
  // table has a NOT NULL constraint on owner_id.
  const ownerId = input.userId ?? '00000000-0000-0000-0000-000000000001';
  const { data, error } = await client.database
    .from('projects')
    .insert([{
      name: input.name,
      owner_id: ownerId,
      box_root_folder_id: storageFolderPath, // column name kept for compat
    }])
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to create room: ${error?.message}`);
  }

  return {
    id: data.id,
    userId: data.owner_id ?? null,
    name: data.name,
    targetName: input.targetName,
    category: (input.category ?? 'competitor') as MemoryRoom['category'],
    storageFolderPath: data.box_root_folder_id ?? null,
    boxFolderId: data.box_root_folder_id ?? null, // legacy alias
    createdAt: data.created_at,
  };
}

export async function listRoomsWithStats(): Promise<RoomWithStats[]> {
  // Real mode: query projects + compute stats from related tables
  const projects = await sdkQuery<{
    id: string;
    owner_id: string | null;
    name: string;
    box_root_folder_id: string | null;
    created_at: string;
  }>('public.projects', {
    select: 'id,owner_id,name,box_root_folder_id,created_at',
    order: 'created_at.desc',
    limit: 100,
  });

  if (!projects.length) return [];

  // Fetch all tracked_pages (paginate if needed)
  const trackedPages = await sdkQuery<{
    id: string;
    project_id: string;
    source_url: string;
    normalized_url: string;
    active: boolean;
  }>('public.tracked_pages', {
    select: 'id,project_id,source_url,normalized_url,active',
    limit: 500,
  });
  const activePages = trackedPages.filter(p => p.active !== false);

  // Fetch latest job for each tracked_page
  const jobsMap: Record<string, { finished_at: string | null }> = {};
  for (const tp of activePages) {
    const jobs = await sdkQuery<{
      finished_at: string | null;
      status: string;
    }>('public.snapshot_jobs', {
      select: 'finished_at,status',
      filters: `tracked_page_id=eq.${tp.id}&status=eq.succeeded`,
      order: 'finished_at.desc',
      limit: 1,
    });
    if (jobs.length) jobsMap[tp.id] = jobs[0];
  }

  // Batch-fetch explanations for high/medium counts via JS-side join.
  // Note: ai_explanations has no `severity` column — it's inside `output_json`.
  const explanations = await sdkQuery<{
    snapshot_id: string;
    output_json: unknown;
  }>('public.ai_explanations', {
    select: 'snapshot_id,output_json',
  });

  // Fetch snapshots to map to tracked_pages
  const snapshots = await sdkQuery<{
    id: string;
    tracked_page_id: string;
  }>('public.snapshots', {
    select: 'id,tracked_page_id',
  });

  // Build lookup: snapshot_id -> project_id
  const pageToProject = new Map<string, string>();
  for (const tp of activePages) pageToProject.set(tp.id, tp.project_id);
  const snapToProject = new Map<string, string>();
  for (const s of snapshots) {
    const pid = pageToProject.get(s.tracked_page_id);
    if (pid) snapToProject.set(s.id, pid);
  }

  const highCounts: Record<string, number> = {};
  const mediumCounts: Record<string, number> = {};
  for (const row of explanations) {
    const pid = snapToProject.get(row.snapshot_id);
    if (!pid) continue;
    // Parse severity from output_json
    let output: Record<string, unknown> = {};
    if (typeof row.output_json === 'string') {
      try { output = JSON.parse(row.output_json); } catch {}
    } else if (row.output_json && typeof row.output_json === 'object') {
      output = row.output_json as Record<string, unknown>;
    }
    const sev = output.severity as string | undefined;
    if (sev === 'high') highCounts[pid] = (highCounts[pid] ?? 0) + 1;
    else if (sev === 'medium') mediumCounts[pid] = (mediumCounts[pid] ?? 0) + 1;
  }

  // Build watchedUrls per project
  const watchedUrlsByProject: Record<string, string[]> = {};
  for (const tp of activePages) {
    if (!watchedUrlsByProject[tp.project_id]) watchedUrlsByProject[tp.project_id] = [];
    watchedUrlsByProject[tp.project_id].push(tp.source_url);
  }

  // Last completed scan per project
  const lastScanAt: Record<string, string> = {};
  for (const [tpId, job] of Object.entries(jobsMap)) {
    const pid = pageToProject.get(tpId);
    if (pid && job.finished_at && !lastScanAt[pid]) {
      lastScanAt[pid] = job.finished_at;
    }
  }

  return projects.map(p => {
    const storageFolderPath = p.box_root_folder_id ?? null;
    return {
      id: p.id,
      userId: p.owner_id ?? null,
      name: p.name,
      targetName: p.name,
      category: 'custom' as MemoryRoom['category'],
      storageFolderPath,
      boxFolderId: storageFolderPath, // legacy alias
      createdAt: p.created_at,
      watchedUrls: watchedUrlsByProject[p.id] ?? [],
      highCount: highCounts[p.id] ?? 0,
      mediumCount: mediumCounts[p.id] ?? 0,
      lastScanAt: lastScanAt[p.id] ?? null,
    };
  });
}

export async function getRoom(roomId: string): Promise<MemoryRoom | null> {
  const rows = await sdkQuery<{
    id: string;
    owner_id: string | null;
    name: string;
    box_root_folder_id: string | null;
    created_at: string;
  }>('public.projects', {
    select: 'id,owner_id,name,box_root_folder_id,created_at',
    filters: `id=eq.${roomId}`,
    limit: 1,
  });

  if (!rows.length) return null;
  const p = rows[0];
  const storageFolderPath = p.box_root_folder_id ?? null;
  return {
    id: p.id,
    userId: p.owner_id ?? null,
    name: p.name,
    targetName: p.name,
    category: 'custom' as MemoryRoom['category'],
    storageFolderPath,
    boxFolderId: storageFolderPath, // legacy alias
    createdAt: p.created_at,
  };
}

// ─── Watched URL operations ───────────────────────────────────────────────────

export async function addWatchedUrls(roomId: string, urls: NewWatchedUrl[]): Promise<WatchedUrl[]> {
  const client = getInsforgeClient();
  const results: WatchedUrl[] = [];

  for (const u of urls) {
    const normalizedUrl = u.url.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
    const slug = normalizedUrl.replace(/[^a-z0-9]/g, '-').substring(0, 50);

    const { data, error } = await client.database
      .from('tracked_pages')
      .insert([{
        project_id: roomId,
        source_url: u.url,
        normalized_url: normalizedUrl,
        slug,
        active: true,
      }])
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to add watched URL: ${error?.message}`);
    }

    results.push({
      id: data.id,
      roomId,
      url: data.source_url,
      label: u.label ?? null,
      pageType: (u.pageType ?? 'unknown') as WatchedUrl['pageType'],
      createdAt: data.created_at,
    });
  }

  return results;
}

export async function listWatchedUrls(roomId: string): Promise<WatchedUrl[]> {
  const rows = await sdkQuery<{
    id: string;
    project_id: string;
    source_url: string;
    normalized_url: string;
    created_at: string;
  }>('public.tracked_pages', {
    select: 'id,project_id,source_url,normalized_url,created_at',
    filters: `project_id=eq.${roomId}`,
    order: 'created_at.desc',
    limit: 100,
  });

  return rows.map(p => ({
    id: p.id,
    roomId: p.project_id,
    url: p.source_url,
    label: null,
    pageType: 'unknown' as const,
    createdAt: p.created_at,
  }));
}

// ─── Real-mode scan/snapshot/change operations (InsForge SDK only) ────────────
//
// In demo mode, scan_runs/page_snapshots/change_analyses were kept in an
// in-memory store. With demo mode removed, all scan/snapshot/change persistence
// goes through PostgREST against the real tables (snapshot_jobs, snapshots,
// ai_explanations). The legacy `createScanRun` / `completeScanRun` /
// `failScanRun` / `insertSnapshot` / `findPreviousSnapshot` /
// `insertChangeAnalysis` exports have been deleted; `lib/scan.ts` should be
// rewritten to write to snapshot_jobs, snapshots, and ai_explanations directly
// when scan functionality is reintroduced.

export async function getChange(changeId: string): Promise<ChangeAnalysis | null> {
  // Look up via the joined ai_explanations + snapshots tables.
  const rows = await sdkQuery<{
    id: string; snapshot_id: string; previous_snapshot_id: string | null;
    output_json: unknown; confidence: number | null; created_at: string;
    tracked_page_id: string | null; change_type: string | null;
  }>(
    'ai_explanations',
    { select: 'id,snapshot_id,previous_snapshot_id,output_json,confidence,created_at,snapshots!snapshot_id(tracked_page_id,change_type)',
      filters: `id=eq.${changeId}`, limit: 1 }
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  let output: Record<string, unknown> = {};
  if (typeof row.output_json === 'string') {
    try { output = JSON.parse(row.output_json); } catch {}
  } else if (row.output_json && typeof row.output_json === 'object') {
    output = row.output_json as Record<string, unknown>;
  }
  const recommendedActions = Array.isArray(output.recommendedActions) ? output.recommendedActions as string[] : [];
  const evidence = Array.isArray(output.evidence) ? output.evidence as unknown[] : [];
  return {
    id: String(row.id),
    roomId: '',
    watchedUrlId: row.tracked_page_id ?? '',
    previousSnapshotId: row.previous_snapshot_id ? String(row.previous_snapshot_id) : null,
    currentSnapshotId: row.snapshot_id ? String(row.snapshot_id) : null,
    severity: (output.severity ?? 'low') as ChangeAnalysis['severity'],
    changeType: (row.change_type ?? output.changeType ?? 'none') as ChangeAnalysis['changeType'],
    summary: String(output.summary ?? ''),
    businessInterpretation: (output.businessInterpretation ?? null) as string | null,
    recommendedActions,
    evidence: evidence as ChangeAnalysis['evidence'],
    storageKey: null,
    storageUrl: null,
    reportBoxFileId: null,
    createdAt: String(row.created_at),
  };
}

export async function listChanges(roomId: string, limit?: number): Promise<ChangeAnalysis[]> {
  const limitNum = limit ?? 100;

  // 1. Get tracked page IDs for this room
  const pages = await sdkQuery<{ id: string }>(
    'tracked_pages',
    { select: 'id', filters: `project_id=eq.${roomId}` }
  );
  if (pages.length === 0) return [];
  const pageIds = pages.map(p => p.id);

  // 2. Get snapshot IDs for those pages
  const inList = `(${pageIds.join(',')})`;
  const snaps = await sdkQuery<{ id: string; tracked_page_id: string; change_type: string; observed_at: string }>(
    'snapshots',
    { select: 'id,tracked_page_id,change_type,observed_at', filters: `tracked_page_id=in.${inList}`, order: 'observed_at.desc', limit: limitNum }
  );
  if (snaps.length === 0) return [];
  const snapIds = snaps.map(s => s.id);

  // 3. Get AI explanations for those snapshots
  const expls = await sdkQuery<{
    id: string; snapshot_id: string; previous_snapshot_id: string | null;
    output_json: unknown; confidence: number | null; created_at: string;
  }>(
    'ai_explanations',
    { select: 'id,snapshot_id,previous_snapshot_id,output_json,confidence,created_at',
      filters: `snapshot_id=in.(${snapIds.join(',')})`, order: 'created_at.desc', limit: limitNum }
  );

  // 4. Build a snapshot lookup and map to ChangeAnalysis
  const snapById = new Map(snaps.map(s => [s.id, s]));
  return expls.map(row => {
    const snap = snapById.get(row.snapshot_id);
    // output_json may arrive as a string or object depending on PostgREST serialization
    let output: Record<string, unknown> = {};
    const rawOutput = row.output_json;
    if (typeof rawOutput === 'string') {
      try { output = JSON.parse(rawOutput); } catch { output = {}; }
    } else if (rawOutput && typeof rawOutput === 'object') {
      output = rawOutput as Record<string, unknown>;
    }
    const recommendedActions = Array.isArray(output.recommendedActions)
      ? (output.recommendedActions as string[])
      : typeof output.recommendedActions === 'string'
        ? (() => { try { return JSON.parse(output.recommendedActions as string); } catch { return []; } })()
        : [];
    const evidence = Array.isArray(output.evidence)
      ? (output.evidence as unknown[])
      : typeof output.evidence === 'string'
        ? (() => { try { return JSON.parse(output.evidence as string); } catch { return []; } })()
        : [];
    return {
      id: String(row.id),
      roomId,
      watchedUrlId: snap?.tracked_page_id ?? '',
      previousSnapshotId: row.previous_snapshot_id ? String(row.previous_snapshot_id) : null,
      currentSnapshotId: row.snapshot_id ? String(row.snapshot_id) : null,
      severity: (output.severity ?? 'low') as ChangeAnalysis['severity'],
      changeType: (snap?.change_type ?? output.changeType ?? 'none') as ChangeAnalysis['changeType'],
      summary: String(output.summary ?? ''),
      businessInterpretation: (output.businessInterpretation ?? null) as string | null,
      recommendedActions,
      evidence: evidence as ChangeAnalysis['evidence'],
      storageKey: null,
      storageUrl: null,
      reportBoxFileId: null,
      createdAt: String(row.created_at),
    };
  });
}

export async function countBySeverity(roomId: string): Promise<{ high: number; medium: number }> {
  const changes = await listChanges(roomId);
  let high = 0;
  let medium = 0;
  for (const change of changes) {
    if (change.severity === 'high') high++;
    else if (change.severity === 'medium') medium++;
  }
  return { high, medium };
}

// ─── Pure selectors ───────────────────────────────────────────────────────────

export function computeSeverityCounts(changes: ChangeAnalysis[]): { high: number; medium: number } {
  let high = 0;
  let medium = 0;
  for (const change of changes) {
    if (change.severity === 'high') high++;
    else if (change.severity === 'medium') medium++;
  }
  return { high, medium };
}

export function selectLatestCompletedScanAt(scanRuns: ScanRun[]): string | null {
  let latest: string | null = null;
  for (const run of scanRuns) {
    if (run.status === 'completed' && run.completedAt) {
      if (!latest || run.completedAt > latest) {
        latest = run.completedAt;
      }
    }
  }
  return latest;
}

export function selectPreviousSnapshot(
  snapshots: PageSnapshot[],
  currentCapturedAt: string
): PageSnapshot | null {
  const earlier = snapshots
    .filter(s => s.capturedAt < currentCapturedAt)
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));

  return earlier[0] ?? null;
}

export function sortAndLimitChanges(
  changes: ChangeAnalysis[],
  limit?: number
): ChangeAnalysis[] {
  const sorted = [...changes].sort((a, b) => {
    const timeDiff = b.createdAt.localeCompare(a.createdAt);
    if (timeDiff !== 0) return timeDiff;
    return b.id.localeCompare(a.id);
  });

  return limit ? sorted.slice(0, limit) : sorted;
}

// ─── One-time migrations ─────────────────────────────────────────────────────

/**
 * Backfill owner_id on all existing projects to the canonical demo user ID.
 * Safe to call repeatedly — uses UPDATE which is idempotent.
 */
export async function migrateOwnerIds(): Promise<{ updated: number }> {
  // Use direct fetch for UPDATE (PostgREST RPC-style)
  const client = getInsforgeClient();
  const { error } = await client.database.from('projects').update({
    owner_id: '00000000-0000-0000-0000-000000000001',
  }).eq('owner_id', '');
  if (error) {
    console.error('migrateOwnerIds error:', error.message);
    return { updated: 0 };
  }
  return { updated: 1 };
}


// ─── Scan schedule operations ──────────────────────────────────────────────

export interface ScanSchedule {
  id: string;
  roomId: string;
  cronExpression: string;
  enabled: boolean;
  insforgeScheduleId: string | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function getScheduleForRoom(roomId: string): Promise<ScanSchedule | null> {
  const { data, error } = await getInsforgeClient()
    .database
    .from('scan_schedules?project_id=eq.' + roomId + '&limit=1')
    .select('id,project_id,cron_expression,enabled,insforge_schedule_id,last_run_at,created_at,updated_at');
  if (error) {
    console.error('getScheduleForRoom error:', error.message);
    return null;
  }
  if (!data || data.length === 0) return null;
  const r = data[0] as {
    id: string; project_id: string; cron_expression: string; enabled: boolean;
    insforge_schedule_id: string | null; last_run_at: string | null;
    created_at: string; updated_at: string;
  };
  return {
    id: r.id,
    roomId: r.project_id,
    cronExpression: r.cron_expression,
    enabled: r.enabled,
    insforgeScheduleId: r.insforge_schedule_id,
    lastRunAt: r.last_run_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function getActiveSchedules(): Promise<ScanSchedule[]> {
  const { data, error } = await getInsforgeClient()
    .database
    .from('scan_schedules?enabled=eq.true&select=id,project_id,cron_expression,enabled,insforge_schedule_id,last_run_at,created_at,updated_at')
    .select('id,project_id,cron_expression,enabled,insforge_schedule_id,last_run_at,created_at,updated_at');
  if (error) {
    console.error('getActiveSchedules error:', error.message);
    return [];
  }
  return (data || []).map((r) => ({
    id: (r as { id: string }).id,
    roomId: (r as { project_id: string }).project_id,
    cronExpression: (r as { cron_expression: string }).cron_expression,
    enabled: (r as { enabled: boolean }).enabled,
    insforgeScheduleId: (r as { insforge_schedule_id: string | null }).insforge_schedule_id,
    lastRunAt: (r as { last_run_at: string | null }).last_run_at,
    createdAt: (r as { created_at: string }).created_at,
    updatedAt: (r as { updated_at: string }).updated_at,
  }));
}


// ─── Notification subscription operations ───────────────────────────────────

export interface NotificationSubscription {
  id: string;
  projectId: string;
  channel: 'webhook';
  config: { url: string; secret?: string };
  severityThreshold: 'low' | 'medium' | 'high';
  enabled: boolean;
  consecutiveFailures: number;
  failureWindowStart: string | null;
  lastTriggeredAt: string | null;
  lastFailureAt: string | null;
  lastFailureError: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function listSubscriptionsForRoom(roomId: string): Promise<NotificationSubscription[]> {
  const { data, error } = await getInsforgeClient()
    .database
    .from('notification_subscriptions?project_id=eq.' + roomId + '&order=created_at.desc')
    .select('id,project_id,channel,config,severity_threshold,enabled,consecutive_failures,failure_window_start,last_triggered_at,last_failure_at,last_failure_error,created_at,updated_at');
  if (error) {
    console.error('listSubscriptionsForRoom error:', error.message);
    return [];
  }
  return (data || []).map((r) => ({
    id: (r as { id: string }).id,
    projectId: (r as { project_id: string }).project_id,
    channel: 'webhook' as const,
    config: (r as { config: { url: string; secret?: string } }).config,
    severityThreshold: (r as { severity_threshold: 'low' | 'medium' | 'high' }).severity_threshold,
    enabled: (r as { enabled: boolean }).enabled,
    consecutiveFailures: (r as { consecutive_failures: number }).consecutive_failures,
    failureWindowStart: (r as { failure_window_start: string | null }).failure_window_start,
    lastTriggeredAt: (r as { last_triggered_at: string | null }).last_triggered_at,
    lastFailureAt: (r as { last_failure_at: string | null }).last_failure_at,
    lastFailureError: (r as { last_failure_error: string | null }).last_failure_error,
    createdAt: (r as { created_at: string }).created_at,
    updatedAt: (r as { updated_at: string }).updated_at,
  }));
}

export async function getSubscription(id: string): Promise<NotificationSubscription | null> {
  const { data, error } = await getInsforgeClient()
    .database
    .from('notification_subscriptions?id=eq.' + id + '&limit=1')
    .select('id,project_id,channel,config,severity_threshold,enabled,consecutive_failures,failure_window_start,last_triggered_at,last_failure_at,last_failure_error,created_at,updated_at');
  if (error) {
    console.error('getSubscription error:', error.message);
    return null;
  }
  if (!data || data.length === 0) return null;
  const r = data[0] as {
    id: string; project_id: string; channel: string; config: { url: string; secret?: string };
    severity_threshold: 'low' | 'medium' | 'high'; enabled: boolean;
    consecutive_failures: number; failure_window_start: string | null;
    last_triggered_at: string | null; last_failure_at: string | null;
    last_failure_error: string | null; created_at: string; updated_at: string;
  };
  return {
    id: r.id,
    projectId: r.project_id,
    channel: 'webhook',
    config: r.config,
    severityThreshold: r.severity_threshold,
    enabled: r.enabled,
    consecutiveFailures: r.consecutive_failures,
    failureWindowStart: r.failure_window_start,
    lastTriggeredAt: r.last_triggered_at,
    lastFailureAt: r.last_failure_at,
    lastFailureError: r.last_failure_error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listEnabledSubscriptions(): Promise<NotificationSubscription[]> {
  const { data, error } = await getInsforgeClient()
    .database
    .from('notification_subscriptions?enabled=eq.true')
    .select('id,project_id,channel,config,severity_threshold,enabled,consecutive_failures,failure_window_start,last_triggered_at,last_failure_at,last_failure_error,created_at,updated_at');
  if (error) {
    console.error('listEnabledSubscriptions error:', error.message);
    return [];
  }
  return (data || []).map((r) => ({
    id: (r as { id: string }).id,
    projectId: (r as { project_id: string }).project_id,
    channel: 'webhook' as const,
    config: (r as { config: { url: string; secret?: string } }).config,
    severityThreshold: (r as { severity_threshold: 'low' | 'medium' | 'high' }).severity_threshold,
    enabled: (r as { enabled: boolean }).enabled,
    consecutiveFailures: (r as { consecutive_failures: number }).consecutive_failures,
    failureWindowStart: (r as { failure_window_start: string | null }).failure_window_start,
    lastTriggeredAt: (r as { last_triggered_at: string | null }).last_triggered_at,
    lastFailureAt: (r as { last_failure_at: string | null }).last_failure_at,
    lastFailureError: (r as { last_failure_error: string | null }).last_failure_error,
    createdAt: (r as { created_at: string }).created_at,
    updatedAt: (r as { updated_at: string }).updated_at,
  }));
}


export async function updateScheduleLastRun(scheduleId: string, lastRunAt: string): Promise<void> {
  const srk = process.env.INSFORGE_SERVICE_ROLE_KEY;
  const baseUrl = process.env.INSFORGE_API_URL;
  if (!srk || !baseUrl) {
    throw new Error('INSFORGE_SERVICE_ROLE_KEY and INSFORGE_API_URL must be set for updateScheduleLastRun');
  }
  const r = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/database/records/scan_schedules?id=eq.${scheduleId}`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${srk}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ last_run_at: lastRunAt }),
  });
  if (!r.ok) {
    throw new Error(`updateScheduleLastRun failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
  }
}

export async function createRoomWithDefaults(roomId: string, cronExpression = '0 3 * * *'): Promise<ScanSchedule> {
  const srk = process.env.INSFORGE_SERVICE_ROLE_KEY;
  const baseUrl = process.env.INSFORGE_API_URL;
  if (!srk || !baseUrl) {
    throw new Error('INSFORGE_SERVICE_ROLE_KEY and INSFORGE_API_URL must be set for createRoomWithDefaults');
  }
  const now = new Date().toISOString();
  const r = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/database/records/scan_schedules`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${srk}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body: JSON.stringify({
      project_id: roomId,
      cron_expression: cronExpression,
      enabled: true,
      created_at: now,
      updated_at: now,
    }),
  });
  if (!r.ok) {
    throw new Error(`createRoomWithDefaults failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
  }
  const rows = await r.json();
  if (!rows[0]) throw new Error('createRoomWithDefaults: no row returned');
  const row = rows[0];
  return {
    id: row.id, roomId: row.project_id, cronExpression: row.cron_expression,
    enabled: row.enabled, insforgeScheduleId: row.insforge_schedule_id,
    lastRunAt: row.last_run_at, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
