// InsForge Edge Function: POST /functions/run-snapshot
// Starts Apify crawl for one tracked page
// Request: { trackedPageId, force? }
// Response: { jobId, status, apifyRunId }

interface RunSnapshotRequest {
  trackedPageId: string;
  force?: boolean;
}

export default async function handler(req: Request): Promise<Response> {
  try {
    const body: RunSnapshotRequest = await req.json();
    const { trackedPageId, force = false } = body;

    if (!trackedPageId) {
      return Response.json(
        { error: 'MISSING_FIELDS', message: 'trackedPageId is required' },
        { status: 400 }
      );
    }

    // Create a snapshot job record
    const jobId = crypto.randomUUID();
    const apifyRunId = `apify-run-${jobId.slice(0, 8)}`;

    // In real mode: would call Apify API to start actor run
    // In demo mode: return mock job data
    return Response.json({
      jobId,
      status: 'queued',
      apifyRunId,
      trackedPageId,
      force,
    }, { status: 202 });
  } catch (err) {
    console.error('run-snapshot error:', err);
    return Response.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to start snapshot' },
      { status: 500 }
    );
  }
}
