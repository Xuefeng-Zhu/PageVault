// API route: POST /api/cron/notification-worker (drains the outbox)
// Invoked by InsForge Schedules cron with x-cron-secret header.
import { NextRequest, NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron-auth';
import { drainOutbox } from '@/lib/notifications';

export async function POST(request: NextRequest) {
  // MEDIUM-3 also picks up the discriminated auth shape from
  // MEDIUM-1 (constant-time secret compare). Three outcomes:
  //   ok          → proceed with the drain
  //   mismatch    → 401 (wrong / missing header)
  //   unconfigured → 503 (operator misconfig, distinct from 401 so
  //                  alerting can tell "attacker probing" from
  //                  "service not deployed yet")
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
  try {
    const result = await drainOutbox(50);
    // MEDIUM-3: surface RPC failures as 5xx so operator alerting fires.
    // The worker no longer reports a healthy "no work" tick for a
    // broken RPC endpoint — `error` is set only on real failures.
    if (result.error) {
      return NextResponse.json(result, { status: 500 });
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error('notification-worker error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'unknown' }, { status: 500 });
  }
}
