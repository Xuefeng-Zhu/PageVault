// API route: GET /api/rooms (list rooms) and POST /api/rooms (create room)
// Updated to wire to InsForge edge functions
import { NextRequest, NextResponse } from 'next/server';
import type { ErrorResponse, RoomWithStats, MemoryRoom } from '@/types';
import { createRoom as insforgeCreateRoom, listRoomsWithStats } from '@/lib/insforge';
import { validateRoomField, normalizeCategory } from '@/lib/validation';
import { createBoxFolder } from '@/lib/box';
import { callCreateWatch } from '@/lib/edge-client';

export async function GET(): Promise<NextResponse<RoomWithStats[] | ErrorResponse>> {
  try {
    const rooms = await listRoomsWithStats();
    return NextResponse.json(rooms);
  } catch (error) {
    console.error('Failed to list rooms:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve rooms' } },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse<MemoryRoom | ErrorResponse>> {
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

    // Create Box folder
    let boxFolderId: string | null = null;
    try {
      boxFolderId = await createBoxFolder(`PageVault/${nameResult.value}`);
    } catch (error) {
      console.error('Box folder creation failed:', error);
      return NextResponse.json(
        { error: { code: 'BOX_ERROR', message: 'Failed to create Box folder for the room' } },
        { status: 500 }
      );
    }

    // Create room in DB
    const room = await insforgeCreateRoom({
      name: nameResult.value,
      targetName: targetNameResult.value,
      category,
      boxFolderId,
    });

    return NextResponse.json(room, { status: 201 });
  } catch (error) {
    console.error('Failed to create room:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to create room' } },
      { status: 500 }
    );
  }
}
