// API route: PATCH/DELETE /api/rooms/[roomId]/notifications/[id]
// PATCH: update threshold / config / enabled
// DELETE: remove a subscription
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getInsforgeBaseUrl } from '@/lib/env';
import { getRoom, getSubscription } from '@/lib/insforge';

const SRK = () => process.env.INSFORGE_SERVICE_ROLE_KEY!;
const DB = () => `${getInsforgeBaseUrl()}/api/database/records`;

async function authorizeRoom(roomId: string, sessionUserId: string): Promise<NextResponse | null> {
  const room = await getRoom(roomId);
  if (!room || !room.userId || room.userId !== sessionUserId) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Room not found' } }, { status: 404 });
  }
  return null;
}

async function authorizeSubscription(roomId: string, id: string, sessionUserId: string): Promise<NextResponse | null> {
  const deny = await authorizeRoom(roomId, sessionUserId);
  if (deny) return deny;
  // Also verify the subscription belongs to this room
  const sub = await getSubscription(id);
  if (!sub || sub.projectId !== roomId) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Subscription not found' } }, { status: 404 });
  }
  return null;
}

interface PatchBody {
  config?: { url?: string; secret?: string };
  severityThreshold?: 'low' | 'medium' | 'high';
  enabled?: boolean;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string; id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required' } }, { status: 401 });
  }
  const { roomId, id } = await params;
  const deny = await authorizeSubscription(roomId, id, session.user.id);
  if (deny) return deny;
  const body = (await request.json()) as PatchBody;
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.config) updates.config = body.config;
  if (body.severityThreshold) {
    if (!['low', 'medium', 'high'].includes(body.severityThreshold)) {
      return NextResponse.json({ error: { code: 'INVALID_THRESHOLD' } }, { status: 400 });
    }
    updates.severity_threshold = body.severityThreshold;
  }
  if (body.enabled !== undefined) updates.enabled = body.enabled;
  const r = await fetch(`${DB()}/notification_subscriptions?id=eq.${id}`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${SRK()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!r.ok) {
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
  // Re-fetch the updated row so the client gets the canonical
  // server state. The doc/API.md contract is { subscription }, and
  // a stale read here would risk the client displaying the old
  // threshold after a successful update.
  const updated = await getSubscription(id);
  if (!updated) {
    return NextResponse.json({ error: 'not_found_after_update' }, { status: 500 });
  }
  return NextResponse.json({ subscription: updated });
}

export async function DELETE(
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
  await fetch(`${DB()}/notification_subscriptions?id=eq.${id}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${SRK()}` },
  });
  return NextResponse.json({ deleted: true });
}
