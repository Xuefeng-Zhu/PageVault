// API route: GET /api/changes/[changeId]
import { NextRequest, NextResponse } from 'next/server';
import type { ErrorResponse } from '@/types';
import { getChangeForUser } from '@/lib/insforge';
import { requireSession } from '@/lib/apiAuth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ changeId: string }> }
): Promise<NextResponse<{ change: import('@/types').ChangeAnalysis } | ErrorResponse>> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { changeId } = await params;

    // Owner scoping via the join ai_explanations -> snapshots ->
    // tracked_pages -> projects -> owner_id. A 404 (not 403) on a
    // non-owned change is intentional — returning 403 would let a
    // probe confirm the change exists for another user.
    const change = await getChangeForUser(changeId, session.user.id);
    if (!change) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Change not found' } },
        { status: 404 }
      );
    }

    return NextResponse.json({ change });
  } catch (error) {
    console.error('Failed to get change:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve change' } },
      { status: 500 }
    );
  }
}