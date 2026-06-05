// API route: GET /api/rooms (list rooms) and POST /api/rooms (create room)
import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { ErrorResponse, RoomWithStats, MemoryRoom } from '@/types';
import {
  createRoom as insforgeCreateRoom,
  createRoomWithDefaults,
  listRoomsWithStats,
} from '@/lib/insforge';
import { validateRoomField, normalizeCategory, frequencyToCronExpression } from '@/lib/validation';
import { createStorageFolder } from '@/lib/storage';
import { requireSession } from '@/lib/apiAuth';

const execAsync = promisify(exec);

export async function GET(): Promise<NextResponse<RoomWithStats[] | ErrorResponse>> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const rooms = await listRoomsWithStats();
    const userId = session.user.id;
    // listRoomsWithStats queries the service-role client, so the result set
    // is NOT pre-filtered by RLS. Scope to the caller's owned rooms here.
    const ownRooms = rooms.filter(r => r.userId === userId);
    return NextResponse.json(ownRooms);
  } catch (error) {
    console.error('Failed to list rooms:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve rooms' } },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse<MemoryRoom | ErrorResponse>> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const userId = session.user.id;

  try {
    const body = await request.json() as { name?: string; targetName?: string; category?: string };

    // Validate name
    const nameResult = validateRoomField(body.name, 'name');
    if (!nameResult.ok) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: nameResult.message, field: nameResult.field } },
        { status: 400 }
      );
    }

    // Validate targetName
    const targetNameResult = validateRoomField(body.targetName, 'targetName');
    if (!targetNameResult.ok) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: targetNameResult.message, field: targetNameResult.field } },
        { status: 400 }
      );
    }

    // Normalize category
    const category = normalizeCategory(body.category);

    // Validate the cron environment BEFORE any DB write. If
    // NEXT_PUBLIC_APP_URL is missing, every room we create would
    // have a non-functional schedule (the InsForge entry can't
    // reach the app), and a 500 returned after the insert would
    // look like a failed create — encouraging retries that
    // create duplicate rooms. Fail fast with a 400 (not 500,
    // because this is a configuration issue, not a server error)
    // so the client can surface the env-var setup guidance without
    // persisting anything.
    if (!process.env.NEXT_PUBLIC_APP_URL) {
      return NextResponse.json(
        {
          error: {
            code: 'CONFIGURATION_ERROR',
            message: 'NEXT_PUBLIC_APP_URL is not set. The InsForge cron entry can\'t reach the app without it, so room creation is disabled until the env var is configured. Set NEXT_PUBLIC_APP_URL (e.g. https://your-domain.com) and restart the dev server.',
          },
        },
        { status: 400 },
      );
    }

    // Create InsForge storage folder
    let boxFolderId: string | null = null;
    try {
      const folderPath = await createStorageFolder(nameResult.value.toLowerCase().replace(/\s+/g, '-'));
      boxFolderId = folderPath;
    } catch (error) {
      console.error('Storage folder creation failed:', error);
      return NextResponse.json(
        { error: { code: 'STORAGE_ERROR', message: 'Failed to create storage folder for the room' } },
        { status: 500 }
      );
    }

    // Create room in DB. userId is the authenticated session's id — the
    // projects.owner_id NOT NULL column is satisfied by the real user id,
    // not by a hardcoded system-user fallback.
    const room = await insforgeCreateRoom({
      name: nameResult.value,
      targetName: targetNameResult.value,
      category,
      boxFolderId,
      userId,
    });

    // Auto-create default scan schedule using the wizard's selected
    // cadence. The user picked a frequency in the new-room form;
    // honour it instead of always defaulting to daily 3am. If the
    // frequency is missing or unrecognized, fall back to the
    // historical default (daily 3am) so the rest of the flow keeps
    // working.
    const cron = frequencyToCronExpression(
      (body as { frequency?: string }).frequency,
    ) ?? '0 3 * * *';
    try {
      await createRoomWithDefaults(room.id, cron);
    } catch (schedErr) {
      console.error('Failed to create default schedule for room', room.id, schedErr);
    }

    // Also register the actual InsForge cron entry so the schedule
    // actually fires. The DB row alone is aspirational; the InsForge
    // schedule is what InsForge calls. We use the same `--name`
    // convention as POST /api/rooms/[id]/schedule so the per-room
    // schedule route's update flow can find it.
    try {
      // The env-var check at the top of this handler returns 400
      // early if NEXT_PUBLIC_APP_URL is missing, so by the time we
      // reach this block appUrl is guaranteed to be set.
      const appUrl = process.env.NEXT_PUBLIC_APP_URL!;
      const secret = process.env.CRON_SHARED_SECRET;
      if (!secret) {
        throw new Error('CRON_SHARED_SECRET not set; cannot register InsForge schedule');
      }
      const headers = JSON.stringify({ 'x-cron-secret': secret });
      const name = `pagevault-room-${room.id}`;
      // Find any existing schedule with this name first, so we don't
      // create duplicates on retry. (mirrors app/api/rooms/[id]/schedule/route.ts)
      const listOut = await execAsync(
        `npx @insforge/cli schedules list --json 2>&1`,
        { cwd: process.cwd(), timeout: 15_000 },
      );
      let existingId: string | null = null;
      try {
        // Mirror the findExistingScheduleId() in app/api/rooms/[id]/schedule/route.ts:
        // scan stdout lines (reversed) for the first one that parses as
        // valid JSON starting with '[' or '{'. This is robust to nested
        // braces in metadata (functionUrl, headers, etc.) which break
        // naive '{...}' regexes when the CLI emits a JSON array of
        // objects.
        const lines = listOut.stdout.split('\n').reverse();
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !(trimmed.startsWith('[') || trimmed.startsWith('{'))) continue;
          try {
            const list = JSON.parse(trimmed);
            const arr = Array.isArray(list) ? list : [list];
            const found = arr.find((s: { name?: string }) => s.name === name);
            if (found && typeof found.id === 'string') {
              existingId = found.id;
              break;
            }
          } catch { /* try the next line */ }
        }
      } catch { /* fall through to create */ }
      const url = `${appUrl}/api/cron/scan-room/${room.id}`;
      const args = existingId
        ? ['schedules', 'update', existingId, '--cron', cron, '--url', url, '--headers', headers]
        : ['schedules', 'create', '--name', name, '--cron', cron, '--url', url, '--method', 'POST', '--headers', headers];
      const cmd = `npx @insforge/cli ${args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`;
      const out = await execAsync(cmd, { cwd: process.cwd(), timeout: 30_000 });
      const m = out.stdout.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/);
      const insforgeScheduleId = m ? m[0] : existingId;
      if (insforgeScheduleId) {
        // PATCH the scan_schedules row to record the InsForge ID so
        // POST /api/rooms/[id]/schedule can find it for update/delete.
        await fetch(
          `${process.env.INSFORGE_API_URL}/api/database/records/scan_schedules?project_id=eq.${room.id}`,
          {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${process.env.INSFORGE_SERVICE_ROLE_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ insforge_schedule_id: insforgeScheduleId }),
          },
        );
      }
    } catch (insforgeErr) {
      console.error('Failed to register InsForge schedule for room', room.id, insforgeErr);
      // Best-effort: don't fail room creation. The DB row exists, and
      // the per-room schedule route can retry the InsForge registration.
    }

    return NextResponse.json(room, { status: 201 });
  } catch (error) {
    console.error('Failed to create room:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to create room' } },
      { status: 500 }
    );
  }
}
