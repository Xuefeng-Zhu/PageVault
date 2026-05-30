// InsForge Edge Function: POST /functions/apify-webhook
// Receives Apify completion webhook
// Shared secret auth via X-Shared-Secret header
// Request: { runId, status, defaultDatasetId, ... }
// Response: { jobId, snapshotId, changeType, boxFolderId, explanationId }

interface ApifyWebhookPayload {
  runId: string;
  status: 'SUCCEEDED' | 'FAILED' | 'ABORTED' | 'TIMED_OUT';
  defaultDatasetId?: string;
  statusMessage?: string;
}

function verifySharedSecret(req: Request, secret: string): boolean {
  const header = req.headers.get('X-Shared-Secret');
  return header === secret;
}

export default async function handler(req: Request): Promise<Response> {
  // Verify shared secret
  const webhookSecret = 'your-secret'; // Would come from env.APIFY_WEBHOOK_SECRET
  if (!verifySharedSecret(req, webhookSecret)) {
    return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const payload: ApifyWebhookPayload = await req.json();
    const { runId, status, defaultDatasetId, statusMessage } = payload;

    if (!runId) {
      return Response.json({ error: 'MISSING_RUN_ID' }, { status: 400 });
    }

    // Idempotency check: if already processed this runId, return success
    // In real mode: query webhook_events table for this runId

    if (status !== 'SUCCEEDED') {
      // Job failed — record failure
      return Response.json({
        jobId: null,
        snapshotId: null,
        changeType: 'error',
        boxFolderId: null,
        explanationId: null,
        status: 'failed_recorded',
        errorMessage: statusMessage ?? status,
      }, { status: 200 });
    }

    // Fetch dataset items from Apify
    // In real mode: call Apify API to get dataset items
    // In demo mode: simulate processing

    // Compute hashes and determine change type
    // In real mode: compute SHA256 hashes of markdown/html
    const snapshotId = crypto.randomUUID();
    const jobId = crypto.randomUUID();

    // Simulate change detection
    const changeType = 'textual'; // Would be computed from actual diff

    // Upload to Box (mock in demo mode)
    const boxFolderId = `box-snapshot-${snapshotId.slice(0, 8)}`;

    // Call LLM for explanation (mock in demo mode)
    const explanationId = crypto.randomUUID();

    return Response.json({
      jobId,
      snapshotId,
      changeType,
      boxFolderId,
      explanationId,
      status: 'ok',
    }, { status: 200 });
  } catch (err) {
    console.error('apify-webhook error:', err);
    return Response.json(
      { error: 'INTERNAL_ERROR', message: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}
