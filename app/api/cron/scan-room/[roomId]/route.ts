// API route: POST /api/cron/scan-room/[roomId]
// Per-room scheduled scan tick. Invoked by InsForge Schedules cron
// (one cron entry per room, named pagevault-room-{roomId}) with the
// x-cron-secret header. Scans ONLY the specified room — does NOT
// iterate over all enabled schedules.
//
// Use this when each room has its own cron cadence and you want each
// cron to fire only that room's scan. Compare to /api/cron/scan-all
// which scans every enabled room in one tick (useful for a coarse
// "run everything" tick, but not the right call for per-room crons).
import { NextRequest, NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron-auth';
import { getRoom, updateScheduleLastRun } from '@/lib/insforge';
import { runScan } from '@/lib/scan';
import { getInsforgeBaseUrl } from '@/lib/env';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> },
) {
  if (!requireCronSecret(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { roomId } = await params;
  const room = await getRoom(roomId);
  if (!room) {
    // 404 lets InsForge schedules' retry behaviour be observable in
    // logs (vs. a 200/empty which would silently mask the issue).
    return NextResponse.json(
      { error: 'room_not_found', roomId },
      { status: 404 },
    );
  }

  // Look up the matching scan_schedules row to update last_run_at.
  // Best-effort: a missing row shouldn't fail the scan.
  const srk = process.env.INSFORGE_SERVICE_ROLE_KEY!;
  const dbUrl = `${getInsforgeBaseUrl()}/api/database/records`;
  let scheduleId: string | null = null;
  try {
    const r = await fetch(
      `${dbUrl}/scan_schedules?project_id=eq.${roomId}&enabled=eq.true&select=id&limit=1`,
      { headers: { 'Authorization': `Bearer ${srk}` } },
    );
    if (r.ok) {
      const rows = (await r.json()) as Array<{ id: string }>;
      scheduleId = rows[0]?.id ?? null;
    }
  } catch {
    // ignore; we'll skip last_run_at update
  }

  const now = new Date().toISOString();
  try {
    const summary = await runScan(room);
    if (scheduleId) {
      updateScheduleLastRun(scheduleId, now).catch((e: unknown) =>
        console.error('failed to update last_run_at:', e),
      );
    }
    return NextResponse.json({ roomId, ...summary, wrapperStatus: 'ok' });
  } catch (err) {
    return NextResponse.json(
      {
        roomId,
        wrapperStatus: 'failed',
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
