// API route: POST /api/demo/seed (seed demo data)
import { NextRequest, NextResponse } from 'next/server';
import type { ErrorResponse } from '@/types';
import { seedDemo } from '@/lib/seed';
import { hasInsforgeCreds } from '@/lib/env';

export async function POST(): Promise<NextResponse<{ projectId: string } | ErrorResponse>> {
  try {
    if (!hasInsforgeCreds()) {
      // In demo mode, seed is still allowed
      // The seed function uses in-memory store
    }

    const result = await seedDemo();

    return NextResponse.json({ projectId: result.projectIds[0] });
  } catch (error) {
    console.error('Demo seed failed:', error);
    return NextResponse.json(
      { error: { code: 'SEED_FAILED', message: 'Failed to seed demo data' } },
      { status: 503 }
    );
  }
}