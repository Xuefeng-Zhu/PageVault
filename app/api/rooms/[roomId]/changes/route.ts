// API route: GET /api/rooms/[roomId]/changes (list changes for a room)
import { NextRequest, NextResponse } from 'next/server';
import type { ErrorResponse } from '@/types';
import { getRoom, listChanges } from '@/lib/insforge';
import { requireSession } from '@/lib/apiAuth';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
): Promise<NextResponse<{ changes: import('@/types').ChangeAnalysis[] } | ErrorResponse>> {
  // requireSession() first (auth gate), then 404 on a non-owned room
  // (no information leak to a probe). This is the same pattern as
  // /api/rooms/[roomId] — see the comment there.
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { roomId } = await params;

    const room = await getRoom(roomId);
    if (!room || room.userId !== session.user.id) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Room not found' } },
        { status: 404 }
      );
    }

    const changes = await listChanges(roomId, 50);
    return NextResponse.json({ changes });
  } catch (error) {
    console.error('Failed to get changes:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve changes' } },
      { status: 500 }
    );
  }
}