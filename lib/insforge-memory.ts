// In-memory store for the new 7-table PageVault schema
// Used in demo mode when InsForge DB is not available
// Schema: projects, tracked_pages, snapshot_jobs, snapshots, artifacts, ai_explanations, webhook_events

export interface InMemoryStore {
  projects: Record<string, unknown>[];
  tracked_pages: Record<string, unknown>[];
  snapshot_jobs: Record<string, unknown>[];
  snapshots: Record<string, unknown>[];
  artifacts: Record<string, unknown>[];
  ai_explanations: Record<string, unknown>[];
  webhook_events: Record<string, unknown>[];
}

let _memoryStore: InMemoryStore | null = null;

export function getMemoryStore(): InMemoryStore {
  if (!_memoryStore) {
    _memoryStore = {
      projects: [],
      tracked_pages: [],
      snapshot_jobs: [],
      snapshots: [],
      artifacts: [],
      ai_explanations: [],
      webhook_events: [],
    };
  }
  return _memoryStore;
}

export function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export function now(): string {
  return new Date().toISOString();
}

export function clearMemoryStore(): void {
  _memoryStore = null;
}
