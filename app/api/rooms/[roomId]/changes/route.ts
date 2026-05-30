// API route: GET /api/rooms/[roomId]/changes (list changes for a room)
import { NextRequest, NextResponse } from 'next/server';
import type { ErrorResponse } from '@/types';
import { getRoom, listChanges } from '@/lib/insforge';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
): Promise<NextResponse<import('@/types').ChangeAnalysis[] | ErrorResponse>> {
  try {
    const { roomId } = await params;

    const room = await getRoom(roomId);
    if (!room) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Room not found' } },
        { status: 404 }
      );
    }

    const changes = await listChanges(roomId);
    return NextResponse.json(changes);
  } catch (error) {
    console.error('Failed to get changes:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve changes' } },
      { status: 500 }
    );
  }
}