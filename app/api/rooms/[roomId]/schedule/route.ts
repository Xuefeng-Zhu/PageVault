// API route: GET/POST/DELETE /api/rooms/[roomId]/schedule
import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getInsforgeBaseUrl } from '@/lib/env';
import { getRoom } from '@/lib/insforge';

const execAsync = promisify(exec);
const SRK = () => process.env.INSFORGE_SERVICE_ROLE_KEY!;
const DB = () => `${getInsforgeBaseUrl()}/api/database/records`;

interface ScheduleRequestBody {
  cronExpression?: string;
  enabled?: boolean;
}

const CRON_REGEX = /^(\S+\s+){4}\S+$/;  // basic 5-field check

function isValidCron(expr: string): boolean {
  return CRON_REGEX.test(expr.trim());
}

async function sh(cmd: string): Promise<string> {
  const { stdout } = await execAsync(cmd, { cwd: process.cwd(), timeout: 30_000 });
  return stdout;
}

async function findExistingScheduleId(name: string): Promise<string | null> {
  try {
    const out = await sh(`npx @insforge/cli schedules list --json 2>&1 | grep -o '{[^}]*}' | head -50`);
    // The CLI may print plain text or JSON. Try to parse the table output.
    const jsonMatch = out.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const list = JSON.parse(jsonMatch[0]);
    const arr = Array.isArray(list) ? list : [list];
    const found = arr.find((s: { name?: string }) => s.name === name);
    return found?.id ?? null;
  } catch {
    return null;
  }
}

async function createOrUpdateInsforgeSchedule(
  existingId: string | null, name: string, cron: string, appUrl: string, secret: string,
): Promise<string | null> {
  const headers = JSON.stringify({ 'x-cron-secret': secret });
  const args: string[] = existingId
    ? ['schedules', 'update', existingId, '--cron', cron, '--headers', headers]
    : ['schedules', 'create', '--name', name, '--cron', cron, '--url', `${appUrl}/api/cron/scan-all`, '--method', 'POST', '--headers', headers];
  const cmd = `npx @insforge/cli ${args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`;
  const out = await sh(cmd);
  const m = out.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/);
  return m ? m[0] : existingId;
}

async function authorizeRoom(roomId: string, sessionUserId: string): Promise<NextResponse | null> {
  const room = await getRoom(roomId);
  if (!room) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Room not found' } }, { status: 404 });
  }
  if (room.userId && room.userId !== sessionUserId) {
    return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Not the room owner' } }, { status: 403 });
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
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || `http://localhost:${process.env.PORT || 3000}`;
    const name = `pagevault-room-${roomId}`;
    const existingId = await findExistingScheduleId(name);

    let insforgeScheduleId: string | null = null;
    if (enabled) {
      insforgeScheduleId = await createOrUpdateInsforgeSchedule(
        existingId, name, cronExpression, appUrl, process.env.CRON_SHARED_SECRET,
      );
    } else if (existingId) {
      try {
        await sh(`npx @insforge/cli schedules delete '${existingId}'`);
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
        await sh(`npx @insforge/cli schedules delete '${existing}'`);
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
