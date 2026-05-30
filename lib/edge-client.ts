// Edge function client for PageVault
// Calls InsForge Edge Functions deployed at https://wga6k9at.functions.insforge.app
// These replace direct DB access for write operations and cross-service calls

const INSFORGE_FUNCTIONS_BASE = 'https://wga6k9at.functions.insforge.app';

export interface EdgeFunctionError {
  error: string;
  message?: string;
}

function isEdgeFunctionError(val: unknown): val is EdgeFunctionError {
  return typeof val === 'object' && val !== null && 'error' in val;
}

async function callEdgeFunction<T>(
  functionName: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${INSFORGE_FUNCTIONS_BASE}/${functionName}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const data = await response.json();

  if (!response.ok || isEdgeFunctionError(data)) {
    throw new Error(data.message ?? data.error ?? `Edge function error: ${response.status}`);
  }

  return data as T;
}

// Health check
export async function callHealth(): Promise<{ status: string; timestamp: string }> {
  return callEdgeFunction('health');
}

// Create watch (tracked page)
export interface CreateWatchRequest {
  projectId: string;
  url: string;
  crawlMode?: 'visual' | 'text' | 'cheerio';
  selectorKeep?: string;
  selectorRemove?: string;
}

export interface CreateWatchResponse {
  trackedPageId: string;
  normalizedUrl: string;
  boxPageFolderId: string;
  status: string;
}

export async function callCreateWatch(input: CreateWatchRequest): Promise<CreateWatchResponse> {
  return callEdgeFunction<CreateWatchResponse>('create-watch', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// Run snapshot
export interface RunSnapshotRequest {
  trackedPageId: string;
  force?: boolean;
}

export interface RunSnapshotResponse {
  jobId: string;
  status: string;
  apifyRunId: string;
}

export async function callRunSnapshot(input: RunSnapshotRequest): Promise<RunSnapshotResponse> {
  return callEdgeFunction<RunSnapshotResponse>('run-snapshot', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// Page history (snapshots for a tracked page)
export interface Snapshot {
  id: string;
  trackedPageId: string;
  jobId: string;
  observedAt: string;
  finalUrl: string | null;
  canonicalUrl: string | null;
  pageTitle: string | null;
  httpStatus: number | null;
  markdownHash: string;
  htmlHash: string | null;
  screenshotPhash: string | null;
  changeType: 'none' | 'textual' | 'visual' | 'structural' | 'error';
  dedupOfSnapshotId: string | null;
  boxSnapshotFolderId: string | null;
}

export interface PageHistoryResponse {
  snapshots: Snapshot[];
}

export async function callPageHistory(trackedPageId: string): Promise<PageHistoryResponse> {
  return callEdgeFunction<PageHistoryResponse>(
    `page-history?trackedPageId=${encodeURIComponent(trackedPageId)}`
  );
}

// Page diff
export interface DiffPayload {
  trackedPageId: string;
  snapshotId: string;
  previousSnapshotId: string | null;
  changeType: 'none' | 'textual' | 'visual' | 'structural' | 'error';
  textDiff: Array<{ type: 'add' | 'remove' | 'change'; before: string; after: string; xpath: string }>;
  htmlDiff: Array<{ type: 'add' | 'remove' | 'change'; tag: string; xpath: string; before: string; after: string }>;
  explanation: {
    model: string;
    confidence: number;
    summary: string;
    businessInterpretation: string;
    changeType: string;
    severity: 'low' | 'medium' | 'high';
  } | null;
}

export interface PageDiffResponse {
  diff: DiffPayload;
}

export async function callPageDiff(trackedPageId: string, snapshotId: string): Promise<PageDiffResponse> {
  return callEdgeFunction<PageDiffResponse>(
    `page-diff?trackedPageId=${encodeURIComponent(trackedPageId)}&snapshotId=${encodeURIComponent(snapshotId)}`
  );
}

// Retry job
export interface RetryJobRequest {
  jobId: string;
}

export interface RetryJobResponse {
  jobId: string;
  originalJobId?: string;
  status: string;
  apifyRunId: string;
}

export async function callRetryJob(input: RetryJobRequest): Promise<RetryJobResponse> {
  return callEdgeFunction<RetryJobResponse>('retry-job', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
