// API route: POST /api/rooms/[roomId]/urls (add watched URLs)
import { NextRequest, NextResponse } from 'next/server';
import type { ErrorResponse } from '@/types';
import { getRoom, addWatchedUrls } from '@/lib/insforge';
import { validateUrlBatch, buildWatchedUrlRows } from '@/lib/validation';
import { requireSession } from '@/lib/apiAuth';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
): Promise<NextResponse<{ urls: import('@/types').WatchedUrl[] } | ErrorResponse>> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { roomId } = await params;

    // Check room exists
    const room = await getRoom(roomId);
    if (!room) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Room not found' } },
        { status: 404 }
      );
    }

    // Owner scoping. 404 (not 403) to avoid leaking room existence.
    if (room.userId !== session.user.id) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Room not found' } },
        { status: 404 }
      );
    }

    const body = await request.json() as { urls?: unknown };

    // Validate URL batch
    const validation = validateUrlBatch(body.urls as import('@/types').UrlEntryInput[] | undefined);
    if (!validation.ok) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: validation.message, field: validation.field } },
        { status: 400 }
      );
    }

    // Build normalized rows
    const rows = buildWatchedUrlRows(roomId, validation.value);

    // Insert URLs
    const watchedUrls = await addWatchedUrls(roomId, rows);

    return NextResponse.json({ urls: watchedUrls }, { status: 201 });
  } catch (error) {
    console.error('Failed to add URLs:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to add watched URLs' } },
      { status: 500 }
    );
  }
}