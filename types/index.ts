// Shared TypeScript types for PageVault

export type Category = 'competitor' | 'vendor' | 'policy' | 'docs' | 'custom';

export type PageType =
  | 'homepage'
  | 'pricing'
  | 'docs'
  | 'changelog'
  | 'careers'
  | 'terms'
  | 'privacy'
  | 'trust'
  | 'unknown';

export type Severity = 'low' | 'medium' | 'high';

export type ChangeType =
  | 'pricing'
  | 'positioning'
  | 'feature'
  | 'legal'
  | 'security'
  | 'hiring'
  | 'docs'
  | 'minor'
  | 'unknown';

export type ScanStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface MemoryRoom {
  id: string;
  userId: string | null;
  name: string;
  targetName: string;
  category: Category;
  boxFolderId: string | null;
  createdAt: string;
}

export interface RoomWithStats extends MemoryRoom {
  highCount: number;
  mediumCount: number;
  lastScanAt: string | null;
}

export interface WatchedUrl {
  id: string;
  roomId: string;
  url: string;
  label: string | null;
  pageType: PageType;
  createdAt: string;
}

export interface PageSnapshot {
  id: string;
  roomId: string;
  watchedUrlId: string;
  scanRunId: string;
  url: string;
  title: string;
  textContent: string;
  contentHash: string;
  boxFileId: string | null;
  capturedAt: string;
}

export interface ScanRun {
  id: string;
  roomId: string;
  status: ScanStatus;
  apifyRunId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
}

export interface EvidenceItem {
  before: string;
  after: string;
  explanation: string;
}

export interface ChangeAnalysis {
  id: string;
  roomId: string;
  watchedUrlId: string;
  previousSnapshotId: string | null;
  currentSnapshotId: string | null;
  severity: Severity;
  changeType: ChangeType;
  summary: string;
  businessInterpretation: string | null;
  recommendedActions: string[];
  evidence: EvidenceItem[];
  reportBoxFileId: string | null;
  createdAt: string;
}

export interface ScanSummary {
  scanRunId: string;
  status: ScanStatus;
  snapshotsCaptured: number;
  changesCreated: number;
}

// Input types for data layer operations

export interface NewRoom {
  name: string;
  targetName: string;
  category?: string;
  boxFolderId?: string | null;
  userId?: string | null;
}

export interface NewWatchedUrl {
  roomId: string;
  url: string;
  label?: string | null;
  pageType?: string;
}

export interface NewSnapshot {
  roomId: string;
  watchedUrlId: string;
  scanRunId: string;
  url: string;
  title: string;
  textContent: string;
  contentHash: string;
  boxFileId?: string | null;
  capturedAt?: string;
}

export interface NewChangeAnalysis {
  roomId: string;
  watchedUrlId: string;
  previousSnapshotId: string | null;
  currentSnapshotId: string | null;
  severity: Severity;
  changeType: ChangeType;
  summary: string;
  businessInterpretation?: string | null;
  recommendedActions: string[];
  evidence: EvidenceItem[];
  reportBoxFileId?: string | null;
}

// API input types

export interface CreateRoomInput {
  name: string;
  targetName: string;
  category?: string;
  urls?: UrlEntryInput[];
}

export interface UrlEntryInput {
  url: string;
  label?: string;
  pageType?: string;
}

export interface AddUrlsInput {
  urls: UrlEntryInput[];
}

// Validation result types

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; field: string; message: string };

// Apify types

export interface ApifyPageResult {
  url: string;
  title?: string;
  text?: string;
  html?: string;
  markdown?: string;
  capturedAt: string; // ISO 8601
}

// AI analyzer types

export interface AnalyzeInput {
  url: string;
  pageType: PageType;
  previousText: string;
  currentText: string;
}

export interface ChangeAnalysisResult {
  severity: Severity;
  changeType: ChangeType;
  summary: string;
  businessInterpretation: string;
  evidence: EvidenceItem[];
  recommendedActions: string[];
}

// Box types

export class BoxSystemError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BoxSystemError';
  }
}

// Insforge error types

export class InsforgeUnavailableError extends Error {
  constructor(message = 'Insforge backend is not available') {
    super(message);
    this.name = 'InsforgeUnavailableError';
  }
}

// Room detail response type

export interface RoomDetailResponse {
  room: MemoryRoom;
  watchedUrls: WatchedUrl[];
  latestScan: ScanRun | null;
  changes: ChangeAnalysis[];
}

// Error response envelope

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    field?: string;
  };
}