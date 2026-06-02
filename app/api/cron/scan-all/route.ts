// API route: POST /api/cron/scan-all (the scheduled-scan tick endpoint)
// Invoked by InsForge Schedules cron with x-cron-secret header.
import { NextRequest, NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron-auth';
import { getRoom, updateScheduleLastRun } from '@/lib/insforge';
import { runScan } from '@/lib/scan';
import { getInsforgeBaseUrl } from '@/lib/env';

const MAX_CONCURRENT = 3;

export async function POST(request: NextRequest) {
  if (!requireCronSecret(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Fetch all enabled schedules via service-role REST
  const srk = process.env.INSFORGE_SERVICE_ROLE_KEY!;
  const dbUrl = `${getInsforgeBaseUrl()}/api/database/records`;
  const schedulesRes = await fetch(
    `${dbUrl}/scan_schedules?enabled=eq.true&select=id,project_id,cron_expression`,
    { headers: { 'Authorization': `Bearer ${srk}` } },
  );
  if (!schedulesRes.ok) {
    console.error('scan-all: failed to fetch schedules', schedulesRes.status);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
  const schedules = await schedulesRes.json() as Array<{ id: string; project_id: string }>;
  if (schedules.length === 0) {
    return NextResponse.json({ scanned: 0, results: [] });
  }

  const queue = [...schedules];
  const results: Array<Record<string, unknown>> = [];
  const now = new Date().toISOString();

  async function worker() {
    while (queue.length > 0) {
      const sched = queue.shift();
      if (!sched) break;
      try {
        const room = await getRoom(sched.project_id);
        if (!room) {
          results.push({ roomId: sched.project_id, status: 'skipped', reason: 'room_not_found' });
          continue;
        }
        const summary = await runScan(room);
        results.push({ roomId: sched.project_id, ...summary });
        // Update last_run_at (best-effort, do not fail the worker on DB error)
        updateScheduleLastRun(sched.id, now).catch((e: unknown) =>
          console.error('failed to update last_run_at:', e),
        );
      } catch (err) {
        results.push({
          roomId: sched.project_id,
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENT, queue.length) }, () => worker())
  );

  return NextResponse.json({ scanned: results.length, results });
}
