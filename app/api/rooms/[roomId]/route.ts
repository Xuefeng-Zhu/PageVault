// API route: GET /api/rooms/[roomId]
import { NextRequest, NextResponse } from 'next/server';
import type { ErrorResponse, RoomDetailResponse, WatchedUrl, ScanRun } from '@/types';
import { getRoom, listWatchedUrls, listChanges } from '@/lib/insforge';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
): Promise<NextResponse<RoomDetailResponse | ErrorResponse>> {
  try {
    const { roomId } = await params;

    const room = await getRoom(roomId);
    if (!room) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Room not found' } },
        { status: 404 }
      );
    }

    const watchedUrls = await listWatchedUrls(roomId);
    const changes = await listChanges(roomId, 50);

    return NextResponse.json({
      room,
      watchedUrls,
      latestScan: null,
      changes,
    });
  } catch (error) {
    console.error('Failed to get room detail:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve room detail' } },
      { status: 500 }
    );
  }
}