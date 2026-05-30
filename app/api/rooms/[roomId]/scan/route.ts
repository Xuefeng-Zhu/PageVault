// API route: POST /api/rooms/[roomId]/scan (run a scan)
import { NextRequest, NextResponse } from 'next/server';
import type { ErrorResponse } from '@/types';
import { getRoom } from '@/lib/insforge';
import { runScan } from '@/lib/scan';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
): Promise<NextResponse<import('@/types').ScanSummary | ErrorResponse>> {
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