// API route: GET /api/rooms/[roomId]/changes (list changes for a room)
import { NextRequest, NextResponse } from 'next/server';
import type { ErrorResponse } from '@/types';
import { listChanges } from '@/lib/insforge';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
): Promise<NextResponse<import('@/types').ChangeAnalysis[] | ErrorResponse>> {
  try {
    const { roomId } = await params;
    const changes = await listChanges(roomId, 50);
    return NextResponse.json(changes);
  } catch (error) {
    console.error('Failed to get changes:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve changes' } },
      { status: 500 }
    );
  }
}