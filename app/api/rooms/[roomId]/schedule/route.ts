// API route: GET/POST/DELETE /api/rooms/[roomId]/schedule
//
// CRITICAL-4 fix (docs/qa-bug-hunt.md): the previous version of this
// route shell-out to `npx @insforge/cli ...` with string interpolation,
// which was a command-injection sink for the `roomId` URL path
// parameter (a `'; touch /tmp/pwn; '` style payload escapes the
// single-quote rewrap and runs on the host). The fix has two parts:
//
// 1. The `roomId` path parameter is validated as a UUID before any
//    downstream logic runs. Non-UUID values get a 400 and never reach
//    the schedule API.
//
// 2. All InsForge schedule operations are direct HTTP calls against
//    `${INSFORGE_API_URL}/api/schedules[/{id}]` using the service-role
//    key for auth. We never invoke the `npx @insforge/cli` binary from
//    this file, so there is no shell, no string interpolation, and no
//    supply-chain surface from `npx` package fetches.
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getInsforgeBaseUrl } from '@/lib/env';
import { getRoom } from '@/lib/insforge';

interface ScheduleRequestBody {
  cronExpression?: string;
  enabled?: boolean;
}

const CRON_REGEX = /^(\S+\s+){4}\S+$/;  // basic 5-field check
const UUID_REGEX = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function isValidCron(expr: string): boolean {
  return CRON_REGEX.test(expr.trim());
}

function isValidRoomId(roomId: string): boolean {
  return UUID_REGEX.test(roomId);
}

const SRK = () => process.env.INSFORGE_SERVICE_ROLE_KEY!;
const DB = () => `${getInsforgeBaseUrl()}/api/database/records`;

// Build the InsForge Schedules endpoint. The CLI is just a thin wrapper
// around these — see @insforge/cli/dist/index.js `ossFetch` for the
// canonical pattern. We replicate it here so we never spawn a child
// process from a Next.js request handler.
function schedulesBaseUrl(): string {
  return `${getInsforgeBaseUrl()}/api/schedules`;
}

function scheduleAuthHeaders(): Record<string, string> {
  return {
    'Authorization': `Bearer ${SRK()}`,
    'Content-Type': 'application/json',
  };
}

type Schedule = {
  id?: string;
  name?: string;
  cronSchedule?: string;
  functionUrl?: string;
  httpMethod?: string;
  headers?: Record<string, string>;
  body?: unknown;
  isActive?: boolean;
};

async function findExistingScheduleId(name: string): Promise<string | null> {
  // GET /api/schedules — returns the full list, which we filter by
  // name on our side. This is the same shape the CLI's
  // `schedules list --json` parses. We do not use shell.
  const res = await fetch(schedulesBaseUrl(), {
    method: 'GET',
    headers: scheduleAuthHeaders(),
  });
  if (!res.ok) return null;
  // The InsForge REST endpoint returns either an array directly or an
  // object with a `data` field. Accept both — see MEDIUM-1 scan-room
  // test comments for the same robustness.
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    return null;
  }
  const arr: Schedule[] = Array.isArray(parsed)
    ? (parsed as Schedule[])
    : Array.isArray((parsed as { data?: unknown[] })?.data)
      ? ((parsed as { data: Schedule[] }).data)
      : [];
  const found = arr.find((s) => s.name === name);
  return found?.id ?? null;
}

async function createOrUpdateInsforgeSchedule(
  existingId: string | null,
  name: string,
  cron: string,
  appUrl: string,
  secret: string,
  roomId: string,
): Promise<string | null> {
  const url = `${appUrl}/api/cron/scan-room/${roomId}`;
  const headers = { 'x-cron-secret': secret };
  let res: Response;
  if (existingId) {
    // PATCH /api/schedules/{id} — the update branch must retarget
    // --url as well as --cron/--headers. Otherwise schedules that
    // were created before scan-room existed (and thus point at
    // /api/cron/scan-all) keep firing the all-room worker even after
    // the user changes the cadence through this route.
    res = await fetch(`${schedulesBaseUrl()}/${encodeURIComponent(existingId)}`, {
      method: 'PATCH',
      headers: scheduleAuthHeaders(),
      body: JSON.stringify({
        cronSchedule: cron,
        functionUrl: url,
        headers,
      }),
    });
  } else {
    res = await fetch(schedulesBaseUrl(), {
      method: 'POST',
      headers: scheduleAuthHeaders(),
      body: JSON.stringify({
        name,
        cronSchedule: cron,
        functionUrl: url,
        httpMethod: 'POST',
        headers,
      }),
    });
  }
  if (!res.ok) return null;
  let data: Schedule | null = null;
  try {
    data = await res.json();
  } catch {
    return null;
  }
  if (data && typeof data.id === 'string') return data.id;
  // Fallback: the response didn't echo an id — return whatever we had.
  return existingId;
}

async function deleteInsforgeSchedule(id: string): Promise<void> {
  await fetch(`${schedulesBaseUrl()}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: scheduleAuthHeaders(),
  });
}

async function authorizeRoom(roomId: string, sessionUserId: string): Promise<NextResponse | null> {
  const room = await getRoom(roomId);
  // Return 404 (not 403) for both missing rooms AND non-owner access.
  // Rationale: don't reveal room existence to non-owners. If the room has
  // a null userId (legacy data), treat it as unowned and 404 too — being
  // permissive on null userId would re-introduce the horizontal-priv-esc
  // bug this check is meant to prevent.
  if (!room || !room.userId || room.userId !== sessionUserId) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Room not found' } }, { status: 404 });
  }
  return null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { roomId } = await params;
  // CRITICAL-4: validate the path parameter before it flows into any
  // downstream code (DB query, InsForge call, or shell). A 400 here
  // stops a malicious or malformed roomId from reaching the rest of
  // the handler.
  if (!isValidRoomId(roomId)) {
    return NextResponse.json(
      { error: { code: 'INVALID_ROOM_ID', message: 'roomId must be a UUID' } },
      { status: 400 },
    );
  }
  const deny = await authorizeRoom(roomId, session.user.id);
  if (deny) return deny;
  const r = await fetch(`${DB()}/scan_schedules?project_id=eq.${roomId}&limit=1`, {
    headers: { 'Authorization': `Bearer ${SRK()}` },
  });
  if (!r.ok) return NextResponse.json({ schedule: null });
  const rows = await r.json();
  if (rows.length === 0) return NextResponse.json({ schedule: null });
  const row = rows[0];
  return NextResponse.json({
    schedule: {
      roomId: row.project_id,
      cronExpression: row.cron_expression,
      enabled: row.enabled,
      insforgeScheduleId: row.insforge_schedule_id,
    },
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required' } }, { status: 401 });
    }
    const { roomId } = await params;
    // CRITICAL-4: validate the path parameter BEFORE authorizeRoom or
    // any InsForge call. The previous version interpolated `roomId`
    // into a shell command — accepting only UUIDs here means a
    // payload like `'; id; '` is rejected at the front door.
    if (!isValidRoomId(roomId)) {
      return NextResponse.json(
        { error: { code: 'INVALID_ROOM_ID', message: 'roomId must be a UUID' } },
        { status: 400 },
      );
    }
    const deny = await authorizeRoom(roomId, session.user.id);
    if (deny) return deny;
    const body = (await request.json()) as ScheduleRequestBody;
    const cronExpression = (body.cronExpression ?? '').trim();
    const enabled = body.enabled !== false;
    if (enabled && !isValidCron(cronExpression)) {
      return NextResponse.json({ error: { code: 'INVALID_CRON', message: 'cronExpression must be 5 fields' } }, { status: 400 });
    }
    if (!process.env.CRON_SHARED_SECRET) {
      return NextResponse.json({ error: { code: 'NO_SECRET', message: 'CRON_SHARED_SECRET not configured on server' } }, { status: 500 });
    }
    // The InsForge schedule's --url must point at a host that
    // InsForge's cloud scheduler can actually reach. Falling back
    // to localhost silently produces a schedule that InsForge can
    // never invoke. Require the env var to be set; if it's not,
    // log and return 500 so the operator knows to configure it.
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (!appUrl) {
      console.warn(
        'NEXT_PUBLIC_APP_URL is not set; cannot auto-register InsForge schedule for room',
        roomId,
      );
      return NextResponse.json(
        { error: { code: 'INTERNAL_ERROR', message: 'NEXT_PUBLIC_APP_URL is not configured; cannot register InsForge schedule' } },
        { status: 500 },
      );
    }
    const name = `pagevault-room-${roomId}`;
    const existingId = await findExistingScheduleId(name);

    let insforgeScheduleId: string | null = null;
    if (enabled) {
      insforgeScheduleId = await createOrUpdateInsforgeSchedule(
        existingId, name, cronExpression, appUrl, process.env.CRON_SHARED_SECRET, roomId,
      );
    } else if (existingId) {
      try {
        await deleteInsforgeSchedule(existingId);
      } catch (e) {
        console.error('Failed to delete existing schedule:', e);
      }
    }

    // Persist to DB via service role (PATCH if exists, POST if not)
    const now = new Date().toISOString();
    const row = {
      project_id: roomId,
      cron_expression: cronExpression,
      enabled,
      insforge_schedule_id: insforgeScheduleId,
      updated_at: now,
    };
    const existing = await fetch(`${DB()}/scan_schedules?project_id=eq.${roomId}&limit=1`, {
      headers: { 'Authorization': `Bearer ${SRK()}` },
    }).then((r) => r.ok ? r.json() : []).catch(() => []);
    if (existing.length > 0) {
      await fetch(`${DB()}/scan_schedules?project_id=eq.${roomId}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${SRK()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(row),
      });
    } else {
      await fetch(`${DB()}/scan_schedules`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SRK()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...row, created_at: now }),
      });
    }

    return NextResponse.json({ schedule: { roomId, cronExpression, enabled, insforgeScheduleId } });
  } catch (err) {
    console.error('schedule POST error:', err);
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: err instanceof Error ? err.message : 'Failed' } }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
    }
    const { roomId } = await params;
    // CRITICAL-4: same front-door UUID check.
    if (!isValidRoomId(roomId)) {
      return NextResponse.json(
        { error: { code: 'INVALID_ROOM_ID', message: 'roomId must be a UUID' } },
        { status: 400 },
      );
    }
    const deny = await authorizeRoom(roomId, session.user.id);
    if (deny) return deny;
    // Delete the DB row
    await fetch(`${DB()}/scan_schedules?project_id=eq.${roomId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${SRK()}` },
    });
    // Best-effort: delete the InsForge schedule if it exists
    const existing = await findExistingScheduleId(`pagevault-room-${roomId}`);
    if (existing) {
      try {
        await deleteInsforgeSchedule(existing);
      } catch (e) {
        console.error('Failed to delete existing schedule:', e);
      }
    }
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error('schedule DELETE error:', err);
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed' } }, { status: 500 });
  }
}
