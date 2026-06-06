// API route: GET /api/rooms (list rooms) and POST /api/rooms (create room)
//
// CRITICAL-4 fix (docs/qa-bug-hunt.md): the previous version of this
// file shell-out to `npx @insforge/cli schedules ...` with string
// interpolation. While `room.id` in this route is server-generated as
// a UUID (and therefore not user-controllable in the same way the
// `roomId` path parameter in [roomId]/schedule is), the binary
// invocation was still a supply-chain surface (every cold deploy
// pulls `@insforge/cli` from the npm registry) and would have
// become a command-injection sink if the post-insert `room.id`
// shape ever changed (e.g. accepting a client-supplied id). We
// therefore replace the shell call with a direct HTTP call to
// `${INSFORGE_API_URL}/api/schedules[/{id}]` using the service-role
// key, matching the pattern in
// `app/api/rooms/[roomId]/schedule/route.ts` and the `ossFetch`
// function in `@insforge/cli/dist/index.js`.
import { NextRequest, NextResponse } from 'next/server';
import type { ErrorResponse, RoomWithStats, MemoryRoom } from '@/types';
import {
  createRoom as insforgeCreateRoom,
  createRoomWithDefaults,
  listRoomsWithStats,
} from '@/lib/insforge';
import { validateRoomField, normalizeCategory, frequencyToCronExpression } from '@/lib/validation';
import { createStorageFolder } from '@/lib/storage';
import { requireSession } from '@/lib/apiAuth';
import { getInsforgeBaseUrl } from '@/lib/env';

function isLocalhostUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

export async function GET(): Promise<NextResponse<RoomWithStats[] | ErrorResponse>> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const userId = session.user.id;
    const rooms = await listRoomsWithStats(userId);
    // listRoomsWithStats applies the owner filter before its 100-room limit.
    // Keep this as a defense in depth in case the data layer regresses.
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

// Direct InsForge Schedules HTTP helper — replaces the old
// `npx @insforge/cli schedules ...` shell-out. See
// `@insforge/cli/dist/index.js` (`ossFetch` + the schedules
// subcommands) for the canonical request/response shape. The CLI is
// a thin wrapper over these endpoints; calling them directly avoids
// the shell-interpolation sink AND the `npx` package-fetch surface.
function schedulesBaseUrl(): string {
  return `${getInsforgeBaseUrl()}/api/schedules`;
}
function scheduleAuthHeaders(): Record<string, string> {
  return {
    'Authorization': `Bearer ${process.env.INSFORGE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
}
type Schedule = { id?: string; name?: string };
async function findScheduleByName(name: string): Promise<string | null> {
  const res = await fetch(schedulesBaseUrl(), {
    method: 'GET',
    headers: scheduleAuthHeaders(),
  });
  if (!res.ok) return null;
  let parsed: unknown = null;
  try { parsed = await res.json(); } catch { return null; }
  const arr: Schedule[] = Array.isArray(parsed)
    ? (parsed as Schedule[])
    : Array.isArray((parsed as { data?: unknown[] })?.data)
      ? ((parsed as { data: Schedule[] }).data)
      : [];
  const found = arr.find((s) => s.name === name);
  return found?.id ?? null;
}
async function createOrUpdateSchedule(
  existingId: string | null,
  name: string,
  cron: string,
  url: string,
  headers: Record<string, string>,
): Promise<string | null> {
  if (existingId) {
    const res = await fetch(`${schedulesBaseUrl()}/${encodeURIComponent(existingId)}`, {
      method: 'PATCH',
      headers: scheduleAuthHeaders(),
      body: JSON.stringify({ cronSchedule: cron, functionUrl: url, headers }),
    });
    if (!res.ok) return existingId;
    return existingId;
  }
  const res = await fetch(schedulesBaseUrl(), {
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
  if (!res.ok) return null;
  let data: Schedule | null = null;
  try { data = await res.json(); } catch { return null; }
  if (data && typeof data.id === 'string') return data.id;
  return null;
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

    // The InsForge schedule registration is best-effort. The DB
    // schedule row is created below (createRoomWithDefaults); the
    // InsForge entry is what actually fires the cron. If
    // NEXT_PUBLIC_APP_URL isn't set (e.g. local dev with the
    // default .env.example), we skip the InsForge registration
    // entirely and rely on the per-room schedule route to retry
    // once the env is configured. The room itself is created
    // normally.
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (!appUrl) {
      console.warn(
        'NEXT_PUBLIC_APP_URL is not set; skipping auto-registration of InsForge schedule for room',
        room.id,
        '— the per-room schedule route can retry once the env is configured.',
      );
    } else if (process.env.NODE_ENV !== 'development' && isLocalhostUrl(appUrl)) {
      console.warn(
        'NEXT_PUBLIC_APP_URL points at localhost; skipping InsForge schedule registration for room',
        room.id,
      );
    } else {
      try {
        const secret = process.env.CRON_SHARED_SECRET;
        if (!secret) {
          throw new Error('CRON_SHARED_SECRET not set; cannot register InsForge schedule');
        }
        const scheduleHeaders = { 'x-cron-secret': secret };
        const name = `pagevault-room-${room.id}`;
        // Find any existing schedule with this name first, so we don't
        // create duplicates on retry. (Mirrors the helper in
        // app/api/rooms/[id]/schedule/route.ts.)
        const existingId = await findScheduleByName(name);
        const url = `${appUrl}/api/cron/scan-room/${room.id}`;
        const insforgeScheduleId = await createOrUpdateSchedule(
          existingId, name, cron, url, scheduleHeaders,
        );
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
