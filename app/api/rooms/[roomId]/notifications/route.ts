// API route: GET/POST /api/rooms/[roomId]/notifications
// GET: list subscriptions for a room
// POST: create a new subscription
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getInsforgeBaseUrl } from '@/lib/env';
import { getRoom, listSubscriptionsForRoom } from '@/lib/insforge';

const SRK = () => process.env.INSFORGE_SERVICE_ROLE_KEY!;
const DB = () => `${getInsforgeBaseUrl()}/api/database/records`;

async function authorizeRoom(roomId: string, sessionUserId: string): Promise<NextResponse | null> {
  const room = await getRoom(roomId);
  // 404 for both missing rooms AND non-owner access; treat null userId
  // as unowned. Same convention as /api/rooms/[id]/schedule.
  if (!room || !room.userId || room.userId !== sessionUserId) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Room not found' } }, { status: 404 });
  }
  return null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required' } }, { status: 401 });
  }
  const { roomId } = await params;
  const deny = await authorizeRoom(roomId, session.user.id);
  if (deny) return deny;
  const subs = await listSubscriptionsForRoom(roomId);
  return NextResponse.json({ subscriptions: subs });
}

interface CreateBody {
  channel?: string;
  config?: { url?: string; secret?: string };
  severityThreshold?: 'low' | 'medium' | 'high';
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required' } }, { status: 401 });
  }
  const { roomId } = await params;
  const deny = await authorizeRoom(roomId, session.user.id);
  if (deny) return deny;
  const body = (await request.json()) as CreateBody;
  if (body.channel !== 'webhook') {
    return NextResponse.json({ error: { code: 'INVALID_CHANNEL', message: 'Only "webhook" supported in v1' } }, { status: 400 });
  }
  if (!body.config?.url || !body.config.url.startsWith('https://')) {
    return NextResponse.json({ error: { code: 'INVALID_URL', message: 'url must be https' } }, { status: 400 });
  }
  const threshold = body.severityThreshold ?? 'medium';
  if (!['low', 'medium', 'high'].includes(threshold)) {
    return NextResponse.json({ error: { code: 'INVALID_THRESHOLD', message: 'severityThreshold must be low|medium|high' } }, { status: 400 });
  }
  const now = new Date().toISOString();
  const r = await fetch(`${DB()}/notification_subscriptions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SRK()}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify([{
      project_id: roomId,
      channel: 'webhook',
      config: body.config,
      severity_threshold: threshold,
      enabled: true,
      consecutive_failures: 0,
      created_at: now,
      updated_at: now,
    }]),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    return NextResponse.json({ error: { code: 'DB_ERROR', message: text.slice(0, 200) } }, { status: 500 });
  }
  const rows = await r.json();
  return NextResponse.json({ subscription: rows[0] }, { status: 201 });
}
