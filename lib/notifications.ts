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

// Discriminated result for RPC calls. MEDIUM-3 (qa-bug-hunt.md) requires
// the worker to distinguish three outcomes that the old `unknown | null`
// shape collapsed into one:
//   - { ok: true,  value: T }   — RPC succeeded and returned a body
//   - { ok: false, status, error } — RPC responded with non-2xx OR the
//                                    fetch itself rejected (network)
// `status: 0` is reserved for the network-failure case so callers can
// tell a server-side problem from a transport problem at a glance.
type RpcResult<T = unknown> =
  | { ok: true; value: T | null }
  | { ok: false; status: number; error: string };

// RPC endpoint for PostgREST stored procedures. Returns a discriminated
// result so callers can tell "RPC endpoint is down" (5xx / network) apart
// from "RPC succeeded and returned a falsy/empty value" (204, 200 with
// `false`, 200 with `null`).
async function dbRpc(path: string, body: unknown): Promise<RpcResult> {
  const base = getInsforgeBaseUrl();
  let r: Response;
  try {
    r = await fetch(`${base}/api/database/rpc/${path}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SRK()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // Network / TLS / DNS — surface as status=0 so the caller can 5xx.
    const msg = err instanceof Error ? (err.message || err.name) : String(err);
    return { ok: false, status: 0, error: `${path} RPC transport error: status=0 ${msg}` };
  }
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    const snippet = text ? text.slice(0, 200) : '(empty)';
    return {
      ok: false,
      status: r.status,
      error: `${path} RPC failed: status=${r.status} body=${snippet}`,
    };
  }
  // 204 No Content for void functions; the body is empty
  if (r.status === 204) return { ok: true, value: null };
  const text = await r.text();
  if (!text) return { ok: true, value: null };
  try { return { ok: true, value: JSON.parse(text) }; } catch { return { ok: true, value: text }; }
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

// Drain result. Three explicit outcomes (MEDIUM-3):
//   - { acquired: true,  no error } — we hold the lock, did the work.
//   - { acquired: false, no error } — peer holds the lock, we skipped.
//   - { acquired: true,  error: <string> } — RPC endpoint is down
//                                          (5xx or network). We didn't
//                                          acquire, but the flag is
//                                          "true" so callers can tell
//                                          "this tick was broken" apart
//                                          from "another worker has it."
//
// The cron route surfaces `error` as 5xx so operator alerting fires.
export type DrainResult = {
  acquired: boolean;
  processed: number;
  succeeded: number;
  failed: number;
  error?: string;
};

// Returns the count of pending → delivered/failed, with explicit
// acquisition and error states so the cron route can surface failures
// as 5xx (MEDIUM-3).
export async function drainOutbox(limit = 50): Promise<DrainResult> {
  // Acquire advisory lock via the public-schema wrapper. Returns the
  // scalar boolean directly (RPC endpoint, not the table endpoint).
  const lockResult = await dbRpc('acquire_notification_lock', { arg: 42 });
  if (!lockResult.ok) {
    // RPC endpoint is down (5xx or network). Short-circuit with a
    // structured error so the cron route can 5xx and operator
    // alerting can fire. We do NOT attempt to query outbox rows or
    // release a lock we never held. `acquired: true` here means
    // "we attempted to acquire" (the alternative, false, is reserved
    // for the healthy peer-hold case).
    return {
      acquired: true,
      processed: 0,
      succeeded: 0,
      failed: 0,
      error: lockResult.error,
    };
  }
  if (lockResult.value !== true) {
    // RPC succeeded, peer holds the lock. Not an error.
    return { acquired: false, processed: 0, succeeded: 0, failed: 0 };
  }

  try {
    const rows = await dbGet(
      `notification_outbox?status=eq.pending&next_attempt_at=lte.${new Date().toISOString()}&order=next_attempt_at.asc&limit=${limit}&select=id,subscription_id,ai_explanation_id,attempts`,
    ) as Array<{ id: string; subscription_id: string; ai_explanation_id: string; attempts: number }>;
    if (rows.length === 0) return { acquired: true, processed: 0, succeeded: 0, failed: 0 };

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
        let errMsg: string;
        if (err instanceof Error) {
          errMsg = err.message || err.name || 'Unknown error';
        } else {
          errMsg = String(err);
        }
        await markOutbox(row.id, 'failed', errMsg.slice(0, 500), row.attempts + 1);
        // Try to load the subscription for failure tracking
        try {
          const sub = await getSubscription(row.subscription_id);
          if (sub) await recordDeliveryFailure(sub, errMsg);
        } catch { /* ignore */ }
        failed++;
      }
    }
    return { acquired: true, processed: rows.length, succeeded, failed };
  } finally {
    // Release the lock (best-effort, via the public-schema wrapper).
    // We still swallow release errors — the lock is advisory and will
    // time out — but we don't want a release failure to mask the work
    // result with a 500.
    const release = await dbRpc('release_notification_lock', { arg: 42 });
    void release;
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
  //
  // Note on persistence: the local `windowReset` flag is needed because
  // the previous version of this function updated a local `windowStart` var
  // but never persisted it to the DB (the `if (!windowStart)` guard caught
  // the post-reset value and skipped the write). Now we always write the
  // window_start explicitly when we reset.
  const now = new Date();
  let effectiveCount = sub.consecutiveFailures;
  let windowStart: string | null = sub.failureWindowStart;
  let windowReset = false;
  if (windowStart) {
    const windowAge = now.getTime() - new Date(windowStart).getTime();
    if (windowAge > 24 * 60 * 60 * 1000) {
      effectiveCount = 0;
      windowStart = now.toISOString();
      windowReset = true;
    }
  }
  const newCount = effectiveCount + 1;
  const updates: Record<string, unknown> = {
    consecutive_failures: newCount,
    last_failure_at: now.toISOString(),
    last_failure_error: error.slice(0, 500),
  };
  if (windowReset || !windowStart) {
    updates.failure_window_start = now.toISOString();
  }
  if (newCount >= 10) updates.enabled = false;
  await dbPatch(`notification_subscriptions?id=eq.${sub.id}`, updates);
}

// silence unused-import warning for getInsforgeClient — kept for future direct SDK use
void getInsforgeClient;
