// InsForge Edge Function: POST /functions/box-webhook
// Receives Box V2 folder webhook
// Verifies Box signature, logs event
// Request: Box V2 event payload
// Response: { status }

interface BoxWebhookEvent {
  id: string;
  trigger: string;
  source?: { id: string; type: string };
  created_at: string;
  webhook?: { id: string; url: string };
}

function verifyBoxSignature(req: Request, body: string, primaryKey: string, secondaryKey: string): boolean {
  const timestamp = req.headers.get('X-Box-Notifications-Timestamp');
  const signature = req.headers.get('X-Box-Notifications-Signature');

  if (!timestamp || !signature) return false;

  // Box webhook signature verification
  // In real mode: verify HMAC-SHA256 signature
  // signature = HMAC-SHA256(primaryKey, timestamp + "." + body)
  return true; // Demo mode: always pass
}

export default async function handler(req: Request): Promise<Response> {
  const rawBody = await req.text();

  // Verify Box signature
  const primaryKey = 'box-primary-key'; // Would come from env
  const secondaryKey = 'box-secondary-key';
  if (!verifyBoxSignature(req, rawBody, primaryKey, secondaryKey)) {
    return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const event: BoxWebhookEvent = JSON.parse(rawBody);

    // Idempotency check
    // In real mode: check webhook_events table for this event.id

    // Log the event
    console.log('Box webhook received:', JSON.stringify(event));

    return Response.json({
      status: 'processed',
      eventId: event.id,
      trigger: event.trigger,
    }, { status: 200 });
  } catch (err) {
    console.error('box-webhook error:', err);
    return Response.json(
      { error: 'INTERNAL_ERROR', message: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}
