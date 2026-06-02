// lib/notifications.ts
// Outbound notification dispatcher. The scan pipeline calls enqueueNotification()
// after every ai_explanations insert. The cron worker (every 1 min) calls
// drainOutbox() to actually send the webhooks.
import { getInsforgeClient, getInsforgeBaseUrl } from './env';
import {
  listEnabledSubscriptions,
  getSubscription,
  type NotificationSubscription,
} from './insforge';
import { webhookChannel, type NotificationPayload } from './notifications/channels/webhook';

const SEVERITY_INT: Record<string, number> = { low: 1, medium: 2, high: 3 };

function severityInt(s: string | null | undefined): number {
  return SEVERITY_INT[String(s ?? '').toLowerCase()] ?? 0;
}

// REST API base for service-role writes
const SRK = () => process.env.INSFORGE_SERVICE_ROLE_KEY!;
const DB = () => `${getInsforgeBaseUrl()}/api/database/records`;

async function dbPost(path: string, body: unknown, prefer = 'return=minimal'): Promise<Response> {
  return fetch(`${DB()}/${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SRK()}`,
      'Content-Type': 'application/json',
      'Prefer': prefer,
    },
    body: JSON.stringify(body),
  });
}

async function dbPatch(path: string, body: unknown): Promise<Response> {
  return fetch(`${DB()}/${path}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${SRK()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function dbGet(path: string): Promise<unknown[]> {
  const r = await fetch(`${DB()}/${path}`, {
    headers: { 'Authorization': `Bearer ${SRK()}` },
  });
  if (!r.ok) return [];
  return r.json();
}

// Called from lib/scan.ts after the ai_explanations insert.
export async function enqueueNotification(opts: {
  aiExplanationId: string;
  projectId: string;
}): Promise<{ enqueued: number }> {
  const all = await listEnabledSubscriptions();
  const subs = all.filter((s) => s.projectId === opts.projectId);
  if (subs.length === 0) return { enqueued: 0 };
  const rows = subs.map((s) => ({
    subscription_id: s.id,
    ai_explanation_id: opts.aiExplanationId,
    status: 'pending',
    next_attempt_at: new Date().toISOString(),
  }));
  await dbPost('notification_outbox', rows, 'return=minimal');
  return { enqueued: rows.length };
}

// Returns the count of pending → delivered/failed.
export async function drainOutbox(limit = 50): Promise<{ processed: number; succeeded: number; failed: number }> {
  // Acquire advisory lock — a row is returned only if we got the lock
  const lockRows = await dbGet('pg_try_advisory_lock?arg=42&select=pg_try_advisory_lock');
  const got = (lockRows[0] as { pg_try_advisory_lock?: boolean } | undefined)?.pg_try_advisory_lock;
  if (!got) {
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  try {
    const rows = await dbGet(
      `notification_outbox?status=eq.pending&next_attempt_at=lte.${new Date().toISOString()}&order=next_attempt_at.asc&limit=${limit}&select=id,subscription_id,ai_explanation_id,attempts`,
    ) as Array<{ id: string; subscription_id: string; ai_explanation_id: string; attempts: number }>;
    if (rows.length === 0) return { processed: 0, succeeded: 0, failed: 0 };

    let succeeded = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        const sub = await getSubscription(row.subscription_id);
        if (!sub || !sub.enabled) {
          await markOutbox(row.id, 'failed', 'subscription_disabled_or_missing', row.attempts + 1);
          failed++;
          continue;
        }
        const changeSev = await getChangeSeverity(row.ai_explanation_id);
        if (severityInt(sub.severityThreshold) === 0) {
          await markOutbox(row.id, 'failed', 'invalid_threshold', row.attempts + 1);
          failed++;
          continue;
        }
        if (severityInt(changeSev) < severityInt(sub.severityThreshold)) {
          // Below threshold — mark delivered (we did consider it, no need to fire)
          await markOutbox(row.id, 'delivered', null, row.attempts + 1, new Date().toISOString());
          succeeded++;
          continue;
        }
        const payload = await buildPayload(row.ai_explanation_id, sub);
        if (!payload) {
          await markOutbox(row.id, 'failed', 'change_or_room_missing', row.attempts + 1);
          failed++;
          continue;
        }
        await webhookChannel.send(payload, sub.config);
        await markOutbox(row.id, 'delivered', null, row.attempts + 1, new Date().toISOString());
        await recordDeliverySuccess(sub);
        succeeded++;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await markOutbox(row.id, 'failed', errMsg, row.attempts + 1);
        // Try to load the subscription for failure tracking
        try {
          const sub = await getSubscription(row.subscription_id);
          if (sub) await recordDeliveryFailure(sub, errMsg);
        } catch { /* ignore */ }
        failed++;
      }
    }
    return { processed: rows.length, succeeded, failed };
  } finally {
    // Release the lock (best-effort)
    await dbGet('pg_advisory_unlock?arg=42&select=pg_advisory_unlock').catch(() => undefined);
  }
}

async function getChangeSeverity(aiExplanationId: string): Promise<string | null> {
  const rows = await dbGet(
    `ai_explanations?id=eq.${aiExplanationId}&select=output_json`,
  ) as Array<{ output_json: unknown }>;
  if (rows.length === 0) return null;
  const raw = rows[0].output_json;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as { severity?: string };
      return parsed.severity ?? null;
    } catch { return null; }
  }
  if (raw && typeof raw === 'object') {
    return (raw as { severity?: string }).severity ?? null;
  }
  return null;
}

async function buildPayload(
  aiExplanationId: string,
  sub: NotificationSubscription,
): Promise<NotificationPayload | null> {
  const explRows = await dbGet(
    `ai_explanations?id=eq.${aiExplanationId}&select=id,snapshot_id,output_json,confidence`,
  ) as Array<{ id: string; snapshot_id: string; output_json: unknown; confidence: number | null }>;
  if (explRows.length === 0) return null;
  const c = explRows[0];
  let output: Record<string, unknown> = {};
  if (typeof c.output_json === 'string') {
    try { output = JSON.parse(c.output_json); } catch { output = {}; }
  } else if (c.output_json && typeof c.output_json === 'object') {
    output = c.output_json as Record<string, unknown>;
  }
  const snapRows = await dbGet(
    `snapshots?id=eq.${c.snapshot_id}&select=id,final_url,observed_at`,
  ) as Array<{ final_url: string | null; observed_at: string | null }>;
  const snap = snapRows[0] ?? null;

  // Look up the room so the payload has the human-readable name and the
  // storage folder path. Best-effort: if the room is gone, fall back to
  // the project_id (which is the same as the room's id) and a null path.
  const roomRows = await dbGet(
    `projects?id=eq.${sub.projectId}&select=id,name,box_root_folder_id&limit=1`,
  ) as Array<{ id: string; name: string; box_root_folder_id: string | null }>;
  const room = roomRows[0] ?? null;
  return {
    event: 'change.detected',
    room: {
      id: sub.projectId,
      name: room?.name ?? sub.projectId,
      storageFolderPath: room?.box_root_folder_id ?? null,
    },
    change: {
      id: c.id,
      severity: String(output.severity ?? 'unknown'),
      changeType: String(output.changeType ?? output.change_type ?? 'unknown'),
      summary: String(output.summary ?? ''),
      businessInterpretation: output.businessInterpretation ? String(output.businessInterpretation) : null,
      recommendedActions: Array.isArray(output.recommendedActions) ? output.recommendedActions.map(String) : [],
      evidence: Array.isArray(output.evidence) ? output.evidence : [],
      confidence: c.confidence ?? null,
      url: snap?.final_url ?? null,
      capturedAt: snap?.observed_at ?? null,
    },
    deliveredAt: new Date().toISOString(),
  };
}

async function markOutbox(
  id: string,
  status: 'pending' | 'delivered' | 'failed',
  error: string | null,
  attempts: number,
  deliveredAt?: string,
): Promise<void> {
  await dbPatch(`notification_outbox?id=eq.${id}`, {
    status, last_error: error, attempts,
    ...(deliveredAt ? { delivered_at: deliveredAt } : {}),
  });
}

async function recordDeliverySuccess(sub: NotificationSubscription): Promise<void> {
  await dbPatch(`notification_subscriptions?id=eq.${sub.id}`, {
    consecutive_failures: 0,
    failure_window_start: null,
    last_triggered_at: new Date().toISOString(),
    last_failure_at: null,
    last_failure_error: null,
  });
}

async function recordDeliveryFailure(sub: NotificationSubscription, error: string): Promise<void> {
  // 24h window reset: if the previous failure was more than 24h ago, start
  // a new failure window. The spec says "if the gap between failures
  // exceeds 24h, the window resets." (notifications-design.md:137)
  const now = new Date();
  let effectiveCount = sub.consecutiveFailures;
  let windowStart = sub.failureWindowStart;
  if (windowStart) {
    const windowAge = now.getTime() - new Date(windowStart).getTime();
    if (windowAge > 24 * 60 * 60 * 1000) {
      effectiveCount = 0;
      windowStart = now.toISOString();
    }
  }
  const newCount = effectiveCount + 1;
  const updates: Record<string, unknown> = {
    consecutive_failures: newCount,
    last_failure_at: now.toISOString(),
    last_failure_error: error.slice(0, 500),
  };
  if (!windowStart) updates.failure_window_start = now.toISOString();
  if (newCount >= 10) updates.enabled = false;
  await dbPatch(`notification_subscriptions?id=eq.${sub.id}`, updates);
}

// silence unused-import warning for getInsforgeClient — kept for future direct SDK use
void getInsforgeClient;
