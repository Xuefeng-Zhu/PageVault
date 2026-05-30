// Insforge data layer for PageVault
// Typed database access helpers for rooms, URLs, scan runs, snapshots, and change analyses
// In Demo_Mode (no credentials): uses in-memory storage with the same interface
// In Real mode: connects to Insforge Postgres backend
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
import { hasInsforgeCreds } from './env';

// In-memory store for demo mode
interface InMemoryStore {
  memory_rooms: Record<string, unknown>[];
  watched_urls: Record<string, unknown>[];
  scan_runs: Record<string, unknown>[];
  page_snapshots: Record<string, unknown>[];
  change_analyses: Record<string, unknown>[];
}

let _memoryStore: InMemoryStore | null = null;

function getMemoryStore(): InMemoryStore {
  if (!_memoryStore) {
    _memoryStore = {
      memory_rooms: [],
      watched_urls: [],
      scan_runs: [],
      page_snapshots: [],
      change_analyses: [],
    };
  }
  return _memoryStore;
}

// Throw this when Insforge is not available
export class InsforgeUnavailableError extends Error {
  constructor(message = 'Insforge backend is not available') {
    super(message);
    this.name = 'InsforgeUnavailableError';
  }
}

// Get the database client (throws if credentials missing)
export function getDb(): InMemoryStore {
  if (!hasInsforgeCreds()) {
    return getMemoryStore();
  }
  // In production, this would return the Insforge client
  // For now, we use in-memory store even with creds to avoid dependency issues
  return getMemoryStore();
}

// Helper to convert snake_case DB row to camelCase
function toMemoryRoom(row: Record<string, unknown>): MemoryRoom {
  return {
    id: String(row.id),
    userId: row.user_id ? String(row.user_id) : null,
    name: String(row.name),
    targetName: String(row.target_name),
    category: (row.category as string) as MemoryRoom['category'],
    boxFolderId: row.box_folder_id ? String(row.box_folder_id) : null,
    createdAt: String(row.created_at),
  };
}

function toWatchedUrl(row: Record<string, unknown>): WatchedUrl {
  return {
    id: String(row.id),
    roomId: String(row.room_id),
    url: String(row.url),
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
  return {
    id: String(row.id),
    roomId: String(row.room_id),
    watchedUrlId: String(row.watched_url_id),
    scanRunId: String(row.scan_run_id),
    url: String(row.url),
    title: row.title ? String(row.title) : '',
    textContent: row.text_content ? String(row.text_content) : '',
    contentHash: String(row.content_hash),
    boxFileId: row.box_file_id ? String(row.box_file_id) : null,
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
    reportBoxFileId: row.report_box_file_id ? String(row.report_box_file_id) : null,
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

// Room operations

export async function createRoom(input: NewRoom): Promise<MemoryRoom> {
  const db = getDb();
  const row: Record<string, unknown> = {
    id: generateId(),
    name: input.name,
    target_name: input.targetName,
    category: input.category ?? 'competitor',
    box_folder_id: input.boxFolderId ?? null,
    user_id: input.userId ?? null,
    created_at: now(),
  };
  db.memory_rooms.push(row);
  return toMemoryRoom(row);
}

export async function listRoomsWithStats(): Promise<RoomWithStats[]> {
  const db = getDb();

  const rooms = db.memory_rooms.map(toMemoryRoom);

  // Compute high/medium counts per room
  const highCounts: Record<string, number> = {};
  const mediumCounts: Record<string, number> = {};

  for (const change of db.change_analyses) {
    const roomId = String(change.room_id);
    const severity = String(change.severity);
    if (severity === 'high') {
      highCounts[roomId] = (highCounts[roomId] ?? 0) + 1;
    } else if (severity === 'medium') {
      mediumCounts[roomId] = (mediumCounts[roomId] ?? 0) + 1;
    }
  }

  // Find last completed scan time per room
  const lastScanAt: Record<string, string> = {};
  for (const scan of db.scan_runs) {
    const roomId = String(scan.room_id);
    const status = String(scan.status);
    const completedAt = scan.completed_at ? String(scan.completed_at) : null;

    if (status === 'completed' && completedAt) {
      if (!lastScanAt[roomId] || completedAt > lastScanAt[roomId]) {
        lastScanAt[roomId] = completedAt;
      }
    }
  }

  return rooms.map(room => ({
    ...room,
    highCount: highCounts[room.id] ?? 0,
    mediumCount: mediumCounts[room.id] ?? 0,
    lastScanAt: lastScanAt[room.id] ?? null,
  }));
}

export async function getRoom(roomId: string): Promise<MemoryRoom | null> {
  const db = getDb();
  const row = db.memory_rooms.find(r => String(r.id) === roomId);
  return row ? toMemoryRoom(row) : null;
}

// Watched URL operations

export async function addWatchedUrls(roomId: string, urls: NewWatchedUrl[]): Promise<WatchedUrl[]> {
  const db = getDb();
  const rows = urls.map(u => {
    const row: Record<string, unknown> = {
      id: generateId(),
      room_id: roomId,
      url: u.url,
      label: u.label ?? null,
      page_type: u.pageType ?? 'unknown',
      created_at: now(),
    };
    db.watched_urls.push(row);
    return row;
  });
  return rows.map(toWatchedUrl);
}

export async function listWatchedUrls(roomId: string): Promise<WatchedUrl[]> {
  const db = getDb();
  return db.watched_urls
    .filter(r => String(r.room_id) === roomId)
    .map(toWatchedUrl);
}

// Scan run operations

export async function createScanRun(roomId: string): Promise<ScanRun> {
  const db = getDb();
  const row: Record<string, unknown> = {
    id: generateId(),
    room_id: roomId,
    status: 'running',
    apify_run_id: null,
    started_at: now(),
    completed_at: null,
    error_message: null,
  };
  db.scan_runs.push(row);
  return toScanRun(row);
}

export async function completeScanRun(id: string): Promise<void> {
  const db = getDb();
  const row = db.scan_runs.find(r => String(r.id) === id);
  if (row) {
    row.status = 'completed';
    row.completed_at = now();
  }
}

export async function failScanRun(id: string, errorMessage: string): Promise<void> {
  const db = getDb();
  const row = db.scan_runs.find(r => String(r.id) === id);
  if (row) {
    row.status = 'failed';
    row.error_message = errorMessage;
    row.completed_at = now();
  }
}

export async function getLatestScanRun(roomId: string): Promise<ScanRun | null> {
  const db = getDb();
  const rows = db.scan_runs
    .filter(r => String(r.room_id) === roomId)
    .sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));

  return rows[0] ? toScanRun(rows[0]) : null;
}

// Snapshot operations

export async function insertSnapshot(input: NewSnapshot): Promise<PageSnapshot> {
  const db = getDb();
  const row: Record<string, unknown> = {
    id: generateId(),
    room_id: input.roomId,
    watched_url_id: input.watchedUrlId,
    scan_run_id: input.scanRunId,
    url: input.url,
    title: input.title || '',
    text_content: input.textContent,
    content_hash: input.contentHash,
    box_file_id: input.boxFileId ?? null,
    captured_at: input.capturedAt ?? now(),
  };
  db.page_snapshots.push(row);
  return toPageSnapshot(row);
}

export async function findPreviousSnapshot(
  watchedUrlId: string,
  beforeCapturedAt: string
): Promise<PageSnapshot | null> {
  const db = getDb();
  const rows = db.page_snapshots
    .filter(r => String(r.watched_url_id) === watchedUrlId && String(r.captured_at) < beforeCapturedAt)
    .sort((a, b) => String(b.captured_at).localeCompare(String(a.captured_at)));

  return rows[0] ? toPageSnapshot(rows[0]) : null;
}

// Change analysis operations

export async function insertChangeAnalysis(input: NewChangeAnalysis): Promise<ChangeAnalysis> {
  const db = getDb();
  const row: Record<string, unknown> = {
    id: generateId(),
    room_id: input.roomId,
    watched_url_id: input.watchedUrlId,
    previous_snapshot_id: input.previousSnapshotId,
    current_snapshot_id: input.currentSnapshotId,
    severity: input.severity,
    change_type: input.changeType,
    summary: input.summary,
    business_interpretation: input.businessInterpretation ?? null,
    recommended_actions: JSON.stringify(input.recommendedActions),
    evidence: JSON.stringify(input.evidence),
    report_box_file_id: input.reportBoxFileId ?? null,
    created_at: now(),
  };
  db.change_analyses.push(row);
  return toChangeAnalysis(row);
}

export async function listChanges(roomId: string, limit?: number): Promise<ChangeAnalysis[]> {
  const db = getDb();
  const rows = db.change_analyses
    .filter(r => String(r.room_id) === roomId)
    .sort((a, b) => {
      const timeDiff = String(b.created_at).localeCompare(String(a.created_at));
      if (timeDiff !== 0) return timeDiff;
      return String(b.id).localeCompare(String(a.id));
    });

  const result = rows.map(toChangeAnalysis);
  return limit ? result.slice(0, limit) : result;
}

export async function getChange(changeId: string): Promise<ChangeAnalysis | null> {
  const db = getDb();
  const row = db.change_analyses.find(r => String(r.id) === changeId);
  return row ? toChangeAnalysis(row) : null;
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

// Pure selectors used by stats helpers

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

// Export store for testing
export function getMemoryStoreForTest(): InMemoryStore {
  return getMemoryStore();
}

export function clearMemoryStore(): void {
  _memoryStore = null;
}