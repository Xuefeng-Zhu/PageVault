// API route: POST /api/cron/notification-worker (drains the outbox)
// Invoked by InsForge Schedules cron with x-cron-secret header.
import { NextRequest, NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron-auth';
import { drainOutbox } from '@/lib/notifications';

export async function POST(request: NextRequest) {
  if (!requireCronSecret(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const result = await drainOutbox(50);
    return NextResponse.json(result);
  } catch (err) {
    console.error('notification-worker error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'unknown' }, { status: 500 });
  }
}
