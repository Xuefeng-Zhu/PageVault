// types/index.ts — all shared types for PageVault

// Enums
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

// Interfaces
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

// Input types (for creating new records)
export interface NewRoom {
  name: string;
  targetName: string;
  category?: string; // undefined/empty → competitor
}

export interface NewWatchedUrl {
  url: string;
  label?: string;
  pageType?: string; // undefined/invalid → 'unknown'
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
}

export interface NewChangeAnalysis {
  roomId: string;
  watchedUrlId: string;
  previousSnapshotId: string | null;
  currentSnapshotId: string | null;
  severity: Severity;
  changeType: ChangeType;
  summary: string;
  businessInterpretation?: string;
  recommendedActions: string[];
  evidence: EvidenceItem[];
  reportBoxFileId?: string | null;
}

// API error envelope
export interface ApiError {
  error: {
    code: string;
    message: string;
    field?: string;
  };
}
