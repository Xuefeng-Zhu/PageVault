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
      // The InsForge schedule's --url must point at a host that
      // InsForge's cloud scheduler can actually reach. Falling back
      // to http://localhost:3000 silently produces a schedule that
      // InsForge can never invoke — the room appears scheduled in
      // the UI but never actually scans. Fail the response (500)
      // when the env var is missing so the operator sees the
      // problem immediately rather than discovering it days later
      // when the schedule never fires. The DB row is still created
      // and the per-room schedule route can retry once the env is
      // configured; the 500 is the operator's signal to set the
      // env var and re-invoke the schedule route.
      const appUrl = process.env.NEXT_PUBLIC_APP_URL;
      if (!appUrl) {
        return NextResponse.json(
          {
            error: 'NEXT_PUBLIC_APP_URL not configured; room created but InsForge schedule was not registered. Set NEXT_PUBLIC_APP_URL and POST to /api/rooms/[id]/schedule to enable scheduling.',
            room: { id: room.id, name: room.name },
          },
          { status: 500 },
        );
      } else {
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
          const jsonMatch = listOut.stdout.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const list = JSON.parse(jsonMatch[0]);
            const arr = Array.isArray(list) ? list : [list];
            const found = arr.find((s: { name?: string }) => s.name === name);
            existingId = found?.id ?? null;
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
