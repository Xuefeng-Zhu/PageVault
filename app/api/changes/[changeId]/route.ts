// API route: GET /api/changes/[changeId]
import { NextRequest, NextResponse } from 'next/server';
import type { ErrorResponse } from '@/types';
import { getChange } from '@/lib/insforge';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ changeId: string }> }
): Promise<NextResponse<import('@/types').ChangeAnalysis | ErrorResponse>> {
  try {
    const { changeId } = await params;

    const change = await getChange(changeId);
    if (!change) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Change not found' } },
        { status: 404 }
      );
    }

    return NextResponse.json(change);
  } catch (error) {
    console.error('Failed to get change:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve change' } },
      { status: 500 }
    );
  }
}