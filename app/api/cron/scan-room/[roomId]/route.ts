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
  // MEDIUM-1 (docs/qa-bug-hunt.md): use the discriminated result
  // from requireCronSecret so we can return 503 service_unconfigured
  // for the "secret not set on the server" case, distinct from the
  // 401 we return for "secret set but candidate wrong/missing". A
  // boolean coercion here would conflate them and lose the
  // operator-alerting signal that the deployment is misconfigured.
  const auth = requireCronSecret(request);
  if (!auth.ok) {
    if (auth.reason === 'unconfigured') {
      return NextResponse.json(
        { error: 'service_unconfigured', detail: 'CRON_SHARED_SECRET is not set on the server' },
        { status: 503 },
      );
    }
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

  // Look up the matching scan_schedules row to gate the scan AND update
  // last_run_at. We distinguish three outcomes:
  //   1. fetch ok + zero rows -> 200 skipped, no runScan
  //   2. fetch ok + one+ row  -> proceed to runScan
  //   3. fetch failed / non-ok -> 5xx, surface the outage
  // An earlier version of this code conflated (1) and (3), causing
  // a DB outage to silently skip scans; InsForge doesn't retry on 200,
  // so a 5xx is the right signal.
  const srk = process.env.INSFORGE_SERVICE_ROLE_KEY!;
  const dbUrl = `${getInsforgeBaseUrl()}/api/database/records`;
  let scheduleId: string | null = null;
  let dbErr: string | null = null;
  try {
    const r = await fetch(
      `${dbUrl}/scan_schedules?project_id=eq.${roomId}&enabled=eq.true&select=id&limit=1`,
      { headers: { 'Authorization': `Bearer ${srk}` } },
    );
    if (!r.ok) {
      dbErr = `db_lookup_${r.status}`;
    } else {
      const rows = (await r.json()) as Array<{ id: string }>;
      scheduleId = rows[0]?.id ?? null;
    }
  } catch (e) {
    dbErr = e instanceof Error ? e.message : String(e);
  }
  if (dbErr) {
    return NextResponse.json(
      { roomId, wrapperStatus: 'failed', reason: 'db_lookup_failed', error: dbErr },
      { status: 500 },
    );
  }
  if (!scheduleId) {
    return NextResponse.json({
      roomId,
      wrapperStatus: 'skipped',
      reason: 'no_enabled_schedule',
    });
  }

  const now = new Date().toISOString();
  try {
    const summary = await runScan(room);
    // Await the last_run_at update. The catch preserves the previous
    // fire-and-forget semantics (we don't fail the route on a DB write
    // error after a successful scan), but we DO wait for it to
    // complete so serverless platforms don't drop the in-flight PATCH
    // once the route returns. On long-lived Node servers (current
    // PageVault deployment) this is functionally identical to
    // fire-and-forget; the await is forward-compatible with serverless.
    try {
      await updateScheduleLastRun(scheduleId, now);
    } catch (e) {
      console.error('failed to update last_run_at:', e);
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
