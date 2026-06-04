// API route: POST /api/rooms/[roomId]/scan (run a scan)
import { NextRequest, NextResponse } from 'next/server';
import type { ErrorResponse } from '@/types';
import { getRoom } from '@/lib/insforge';
import { runScan } from '@/lib/scan';
import { requireSession } from '@/lib/apiAuth';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
): Promise<NextResponse<import('@/types').ScanSummary | ErrorResponse>> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { roomId } = await params;

    // Check room exists
    const room = await getRoom(roomId);
    if (!room) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Room not found' } },
        { status: 404 }
      );
    }

    // Owner scoping. 404 (not 403) to avoid leaking room existence.
    if (room.userId !== session.user.id) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Room not found' } },
        { status: 404 }
      );
    }

    // Run the scan
    const summary = await runScan(room);

    return NextResponse.json(summary);
  } catch (error) {
    console.error('Scan failed:', error);
    return NextResponse.json(
      { error: { code: 'SCAN_FAILED', message: error instanceof Error ? error.message : 'Scan failed' } },
      { status: 500 }
    );
  }
}
