// API route: /api/changes/[changeId]/share
//
// US-013 public read-only share link.
//
// POST   — authenticated. Generate a 32-byte random token, insert a
//          row in shared_changes, return { token, url }.
// DELETE — authenticated. Revoke every shared_changes row for this
//          change (sets revoked_at = now()).
//
// Auth pattern: requireSession(). The changeId is owner-scoped via
// getChangeForUser — a non-owner gets 404 (not 403) so a probe can't
// confirm the change exists for another user. The token returned by
// POST is single-use for revocation: DELETE matches all rows where
// change_id = the URL parameter, so revoking once disables every
// link ever minted for this change.
//
// Public base URL for the returned `url`:
//   1. NEXT_PUBLIC_APP_URL (server env). Used in production.
//   2. The request's own origin as a dev fallback — only safe when
//      NODE_ENV !== 'production'. In prod we throw 500 rather than
//      mint a link with the wrong base, so a misconfigured prod
//      deploy surfaces in the logs instead of sending users a
//      https://localhost:3000/share/<token> URL.

import { NextRequest, NextResponse } from 'next/server';
import type { ErrorResponse } from '@/types';
import { requireSession } from '@/lib/apiAuth';
import { getChangeForUser } from '@/lib/insforge';
import {
  createSharedChange,
  revokeSharedChangesForChange,
} from '@/lib/shared-changes';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // node:crypto for the token

function resolvePublicBaseUrl(request: NextRequest): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  if (process.env.NODE_ENV !== 'production') {
    // Dev fallback: derive from the request origin so localhost dev
    // works without setting NEXT_PUBLIC_APP_URL. The user's browser
    // hits the same origin they called the API on.
    try {
      return new URL(request.url).origin;
    } catch {
      return 'http://localhost:3000';
    }
  }
  throw new Error(
    'NEXT_PUBLIC_APP_URL is not set in production; refusing to mint a share link with an unknown base URL',
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ changeId: string }> },
): Promise<NextResponse<{ token: string; url: string } | ErrorResponse>> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  let changeId: string;
  try {
    ({ changeId } = await params);
  } catch {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'changeId is required' } },
      { status: 400 },
    );
  }
  if (!changeId || changeId.trim().length === 0) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'changeId is required' } },
      { status: 400 },
    );
  }

  // Owner check — 404 for a non-owned change to avoid leaking the
  // existence of someone else's data.
  const change = await getChangeForUser(changeId, session.user.id);
  if (!change) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Change not found' } },
      { status: 404 },
    );
  }

  let baseUrl: string;
  try {
    baseUrl = resolvePublicBaseUrl(request);
  } catch (err) {
    console.error('[share] cannot resolve public base URL:', err);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Public base URL is not configured' } },
      { status: 500 },
    );
  }

  try {
    const row = await createSharedChange({
      changeId,
      createdBy: session.user.id,
    });
    return NextResponse.json(
      { token: row.token, url: `${baseUrl}/share/${row.token}` },
      { status: 201 },
    );
  } catch (err) {
    console.error('[share] failed to create share link:', err);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to create share link' } },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ changeId: string }> },
): Promise<NextResponse<{ revoked: number } | ErrorResponse>> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  let changeId: string;
  try {
    ({ changeId } = await params);
  } catch {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'changeId is required' } },
      { status: 400 },
    );
  }
  if (!changeId || changeId.trim().length === 0) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'changeId is required' } },
      { status: 400 },
    );
  }

  // Same owner check as POST — 404 on a non-owned change. We must
  // verify the caller is allowed to revoke links for this change;
  // otherwise any signed-in user could revoke links on other users'
  // changes.
  const change = await getChangeForUser(changeId, session.user.id);
  if (!change) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Change not found' } },
      { status: 404 },
    );
  }

  try {
    const revoked = await revokeSharedChangesForChange(changeId);
    return NextResponse.json({ revoked }, { status: 200 });
  } catch (err) {
    console.error('[share] failed to revoke share links:', err);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to revoke share links' } },
      { status: 500 },
    );
  }
}
