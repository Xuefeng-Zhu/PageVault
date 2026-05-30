// InsForge Edge Function: GET /functions/page-history?trackedPageId=<id>
// Returns snapshots for a tracked page (read-only)
// Response: { snapshots: Snapshot[] }

interface Snapshot {
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

export default async function handler(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const trackedPageId = url.searchParams.get('trackedPageId');

    if (!trackedPageId) {
      return Response.json(
        { error: 'MISSING_FIELDS', message: 'trackedPageId query param is required' },
        { status: 400 }
      );
    }

    // In real mode: query snapshots table for this trackedPageId
    // In demo mode: return empty array
    const snapshots: Snapshot[] = [];

    return Response.json({ snapshots }, { status: 200 });
  } catch (err) {
    console.error('page-history error:', err);
    return Response.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to get page history' },
      { status: 500 }
    );
  }
}
