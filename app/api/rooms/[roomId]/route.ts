import { NextRequest, NextResponse } from 'next/server';
import type { ErrorResponse, RoomDetailResponse, ScanRun } from '@/types';
import { getRoom, listWatchedUrls, listChanges } from '@/lib/insforge';
import { getInsforgeClient } from '@/lib/env';
import { requireSession } from '@/lib/apiAuth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> },
): Promise<NextResponse<RoomDetailResponse | ErrorResponse>> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { roomId } = await params;

    const room = await getRoom(roomId);
    if (!room) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Room not found' } },
        { status: 404 }
      );
    }

    // Owner scoping. 404 (not 403) on a non-owned room is intentional —
    // returning 403 would confirm the room exists for another user.
    if (room.userId !== session.user.id) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Room not found' } },
        { status: 404 }
      );
    }

    const [watchedUrls, changes] = await Promise.all([
      listWatchedUrls(roomId),
      listChanges(roomId, 50),
    ]);

    // Find the most recent successful snapshot_job for any page in this room
    // (the scan job table is keyed on tracked_page_id, not room_id, so we
    // join via tracked_pages)
    const client = getInsforgeClient();
    let latestScan: ScanRun | null = null;
    try {
      const { data: pageRows, error: pageErr } = await client.database
        .from('tracked_pages?project_id=eq.' + roomId + '&select=id')
        .select('id');
      if (!pageErr && pageRows && pageRows.length > 0) {
        const pageIds = pageRows.map((p: { id: string }) => p.id).join(',');
        const { data: jobRows, error: jobErr } = await client.database
          .from(`snapshot_jobs?tracked_page_id=in.(${pageIds})&status=eq.succeeded&order=finished_at.desc&limit=1`)
          .select('id,status,finished_at,trigger_type,apify_run_id');
        if (!jobErr && jobRows && jobRows.length > 0) {
          const j = jobRows[0];
          latestScan = {
            id: String(j.id),
            roomId,
            status: (j.status === 'succeeded' ? 'completed' : j.status) as ScanRun['status'],
            apifyRunId: j.apify_run_id ? String(j.apify_run_id) : null,
            startedAt: null,
            completedAt: j.finished_at ? String(j.finished_at) : null,
            errorMessage: null,
          };
        }
      }
    } catch (e) {
      console.error('latestScan lookup failed (non-fatal):', e);
    }

    return NextResponse.json({
      room,
      watchedUrls,
      latestScan,
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
