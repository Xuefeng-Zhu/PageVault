// API route: POST /api/rooms/[roomId]/notifications/[id]/test
// Sends a sample payload to the subscription's URL and returns the response.
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getRoom, getSubscription } from '@/lib/insforge';
import { webhookChannel, type NotificationPayload } from '@/lib/notifications/channels/webhook';

async function authorizeSubscription(roomId: string, id: string, sessionUserId: string): Promise<NextResponse | null> {
  const room = await getRoom(roomId);
  if (!room || !room.userId || room.userId !== sessionUserId) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Room not found' } }, { status: 404 });
  }
  const sub = await getSubscription(id);
  if (!sub || sub.projectId !== roomId) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Subscription not found' } }, { status: 404 });
  }
  return null;
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ roomId: string; id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required' } }, { status: 401 });
  }
  const { roomId, id } = await params;
  const deny = await authorizeSubscription(roomId, id, session.user.id);
  if (deny) return deny;
  const sub = await getSubscription(id);
  if (!sub) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const sample: NotificationPayload = {
    event: 'change.detected',
    room: { id: sub.projectId, name: 'Test Room', storageFolderPath: null },
    change: {
      id: 'test-change-id',
      severity: 'medium',
      changeType: 'pricing',
      summary: 'This is a test notification from PageVault',
      businessInterpretation: 'No real change. Test only.',
      recommendedActions: ['Verify the webhook endpoint works'],
      evidence: [],
      confidence: 1.0,
      url: 'https://example.com',
      capturedAt: new Date().toISOString(),
    },
    deliveredAt: new Date().toISOString(),
  };
  try {
    await webhookChannel.send(sample, sub.config as { url: string; secret?: string });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : 'unknown',
    }, { status: 502 });
  }
}
