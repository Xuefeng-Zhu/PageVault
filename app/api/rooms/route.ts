// API route: GET /api/rooms (list rooms) and POST /api/rooms (create room)
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

    return NextResponse.json(room, { status: 201 });
  } catch (error) {
    console.error('Failed to create room:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to create room' } },
      { status: 500 }
    );
  }
}
