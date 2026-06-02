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

// ─── InsForge DB REST API helpers ───────────────────────────────────────────
// Direct Postgres access via InsForge REST API (not edge functions)
// These replace lib/insforge.ts in-memory store when credentials are present

function getDbHeaders() {
  const url = process.env.NEXT_PUBLIC_INSFORGE_URL || process.env.INSFORGE_API_URL;
  const key = process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY || process.env.INSFORGE_ANON_KEY;
  if (!url || !key) throw new Error('Missing InsForge credentials');
  return {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
  };
}

function getDbUrl() {
  return process.env.NEXT_PUBLIC_INSFORGE_URL || process.env.INSFORGE_API_URL || '';
}

// ─── DB-native types (snake_case from Postgres) ─────────────────────────────

interface DbProject {
  id: string;
  owner_id: string | null;
  name: string;
  box_root_folder_id: string | null;
  created_at: string;
}

interface DbTrackedPage {
  id: string;
  project_id: string;
  url: string;
  label: string | null;
  page_type: string;
  created_at: string;
}

interface DbSnapshotJob {
  id: string;
  tracked_page_id: string;
  status: string;
  apify_run_id: string | null;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
}

interface DbAiExplanation {
  id: string;
  tracked_page_id: string;
  snapshot_id: string | null;
  previous_snapshot_id: string | null;
  severity: 'low' | 'medium' | 'high';
  change_type: string;
  summary: string;
  business_interpretation: string | null;
  recommended_actions: string[];
  evidence: { before: string; after: string; explanation: string }[];
  created_at: string;
}

// ─── callListProjects ────────────────────────────────────────────────────────
// Maps to GET /api/rooms — returns RoomWithStats[]
// When userId is provided, filters projects by owner_id (RLS bypass)

export interface Project {
  id: string;
  ownerId: string | null;
  name: string;
  boxRootFolderId: string | null;
  createdAt: string;
  highCount: number;
  mediumCount: number;
  lastScanAt: string | null;
  trackedPages: DbTrackedPage[];
}

export async function callListProjects(userId?: string): Promise<Project[]> {
  const baseUrl = getDbUrl();
  const headers = getDbHeaders();

  // Build query - filter by owner_id if userId provided
  let projectsUrl = `${baseUrl}/rest/v1/projects?select=*&order=created_at.desc`;
  if (userId) {
    projectsUrl = `${baseUrl}/rest/v1/projects?owner_id=eq.${userId}&select=*&order=created_at.desc`;
  }

  // Fetch all projects
  const projectsRes = await fetch(projectsUrl, { headers });
  if (!projectsRes.ok) throw new Error(`Failed to fetch projects: ${projectsRes.status}`);
  const projects: DbProject[] = await projectsRes.json();

  // For each project, fetch tracked pages, snapshot jobs, and ai_explanations in parallel
  const results = await Promise.all(
    projects.map(async (proj): Promise<Project> => {
      const [pagesRes, jobsRes, explanationsRes] = await Promise.all([
        fetch(`${baseUrl}/rest/v1/tracked_pages?project_id=eq.${proj.id}&select=*`, { headers }),
        fetch(`${baseUrl}/rest/v1/snapshot_jobs?project_id=eq.${proj.id}&select=*&order=finished_at.desc`, { headers }),
        fetch(`${baseUrl}/rest/v1/ai_explanations?tracked_page_id=in.(${proj.id})&select=*`, { headers }),
      ]);

      const pages: DbTrackedPage[] = pagesRes.ok ? await pagesRes.json() : [];
      const jobs: DbSnapshotJob[] = jobsRes.ok ? await jobsRes.json() : [];
      const explanations: DbAiExplanation[] = explanationsRes.ok ? await explanationsRes.json() : [];

      // Count high/medium severity
      let highCount = 0;
      let mediumCount = 0;
      for (const exp of explanations) {
        if (exp.severity === 'high') highCount++;
        else if (exp.severity === 'medium') mediumCount++;
      }

      // Find latest finished snapshot job
      let lastScanAt: string | null = null;
      for (const job of jobs) {
        if (job.status === 'completed' && job.finished_at) {
          if (!lastScanAt || job.finished_at > lastScanAt) {
            lastScanAt = job.finished_at;
          }
        }
      }

      return {
        id: proj.id,
        ownerId: proj.owner_id,
        name: proj.name,
        boxRootFolderId: proj.box_root_folder_id,
        createdAt: proj.created_at,
        highCount,
        mediumCount,
        lastScanAt,
        trackedPages: pages,
      };
    })
  );

  return results;
}

// ─── callGetProject ─────────────────────────────────────────────────────────

export interface ProjectWithPages {
  id: string;
  name: string;
  boxRootFolderId: string | null;
  createdAt: string;
  trackedPages: DbTrackedPage[];
  snapshotJobs: DbSnapshotJob[];
  aiExplanations: DbAiExplanation[];
}

export async function callGetProject(projectId: string): Promise<ProjectWithPages | null> {
  const baseUrl = getDbUrl();
  const headers = getDbHeaders();

  const [projRes, pagesRes, jobsRes, explanationsRes] = await Promise.all([
    fetch(`${baseUrl}/rest/v1/projects?id=eq.${projectId}&select=*`, { headers }),
    fetch(`${baseUrl}/rest/v1/tracked_pages?project_id=eq.${projectId}&select=*`, { headers }),
    fetch(`${baseUrl}/rest/v1/snapshot_jobs?project_id=eq.${projectId}&select=*&order=finished_at.desc`, { headers }),
    fetch(`${baseUrl}/rest/v1/ai_explanations?tracked_page_id=in.(${projectId})&select=*&order=created_at.desc`, { headers }),
  ]);

  if (!projRes.ok) return null;
  const projects: DbProject[] = await projRes.json();
  if (!projects.length) return null;
  const proj = projects[0];

  const pages: DbTrackedPage[] = pagesRes.ok ? await pagesRes.json() : [];
  const jobs: DbSnapshotJob[] = jobsRes.ok ? await jobsRes.json() : [];
  const explanations: DbAiExplanation[] = explanationsRes.ok ? await explanationsRes.json() : [];

  return {
    id: proj.id,
    name: proj.name,
    boxRootFolderId: proj.box_root_folder_id,
    createdAt: proj.created_at,
    trackedPages: pages,
    snapshotJobs: jobs,
    aiExplanations: explanations,
  };
}

// ─── callGetChanges ─────────────────────────────────────────────────────────

export interface ChangeRecord {
  id: string;
  trackedPageId: string;
  snapshotId: string | null;
  previousSnapshotId: string | null;
  severity: 'low' | 'medium' | 'high';
  changeType: string;
  summary: string;
  businessInterpretation: string | null;
  recommendedActions: string[];
  evidence: { before: string; after: string; explanation: string }[];
  createdAt: string;
}

export async function callGetChanges(projectId: string): Promise<ChangeRecord[]> {
  const baseUrl = getDbUrl();
  const headers = getDbHeaders();

  // Get tracked page IDs for this project
  const pagesRes = await fetch(`${baseUrl}/rest/v1/tracked_pages?project_id=eq.${projectId}&select=id`, { headers });
  if (!pagesRes.ok) return [];
  const pages: { id: string }[] = await pagesRes.json();
  if (!pages.length) return [];

  const pageIds = pages.map(p => p.id).join(',');
  const changesRes = await fetch(
    `${baseUrl}/rest/v1/ai_explanations?tracked_page_id=in.(${pageIds})&select=*&order=created_at.desc`,
    { headers }
  );
  if (!changesRes.ok) return [];
  const explanations: DbAiExplanation[] = await changesRes.json();

  return explanations.map(exp => ({
    id: exp.id,
    trackedPageId: exp.tracked_page_id,
    snapshotId: exp.snapshot_id,
    previousSnapshotId: exp.previous_snapshot_id,
    severity: exp.severity,
    changeType: exp.change_type,
    summary: exp.summary,
    businessInterpretation: exp.business_interpretation,
    recommendedActions: exp.recommended_actions,
    evidence: exp.evidence,
    createdAt: exp.created_at,
  }));
}

// ─── Health check ────────────────────────────────────────────────────────────
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
