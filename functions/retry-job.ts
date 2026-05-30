// InsForge Edge Function: POST /functions/retry-job
// Retries failed snapshot job
// Request: { jobId }
// Response: { jobId, status, apifyRunId }

interface RetryJobRequest {
  jobId: string;
}

export default async function handler(req: Request): Promise<Response> {
  try {
    const body: RetryJobRequest = await req.json();
    const { jobId } = body;

    if (!jobId) {
      return Response.json(
        { error: 'MISSING_FIELDS', message: 'jobId is required' },
        { status: 400 }
      );
    }

    // In real mode: fetch the failed job, get its trackedPageId, create new job
    // In demo mode: return a new mock job
    const newJobId = crypto.randomUUID();
    const apifyRunId = `apify-run-retry-${newJobId.slice(0, 8)}`;

    return Response.json({
      jobId: newJobId,
      originalJobId: jobId,
      status: 'queued',
      apifyRunId,
    }, { status: 202 });
  } catch (err) {
    console.error('retry-job error:', err);
    return Response.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to retry job' },
      { status: 500 }
    );
  }
}
