// API route: GET /api/changes/[changeId]/export
//
// Returns a ZIP bundle of the change's evidence: raw markdown
// before/after, the AI brief, an audit trail, and a signed manifest.
// The bundle is small (~200KB in practice) and signed with HMAC-SHA256
// using EVIDENCE_EXPORT_SIGNING_SECRET; verifiers re-HMAC the
// manifest.json bytes with the same secret and compare hex digests.
//
// Auth:
//   - requireSession() — every export must come from a logged-in user.
//   - buildEvidenceBundle does the owner check via getChangeForUser:
//     a non-owner gets a 404 (not 403) so a probe can't confirm the
//     change exists for another user.
//
// Streaming:
//   The route returns a single Buffer (small enough that streaming
//   is unnecessary at the current ~200KB size). If a future refactor
//   raises the per-bundle cap significantly, switch to a Readable
//   from jszip's generateNodeStream and pipe to res.
import { NextRequest, NextResponse } from 'next/server';
import type { ErrorResponse } from '@/types';
import { requireSession } from '@/lib/apiAuth';
import {
  buildEvidenceBundle,
  EvidenceBundleNotFoundError,
} from '@/lib/evidence-export';

// Next.js route handler config: this route is always dynamic (no
// static optimization) because the response body depends on the
// signed-in user and the change id in the URL.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';   // jszip + node:crypto need a Node runtime

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ changeId: string }> },
): Promise<NextResponse<Buffer | ErrorResponse>> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { changeId } = await params;
    if (!changeId || changeId.trim().length === 0) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'changeId is required' } },
        { status: 400 }
      );
    }

    const buffer = await buildEvidenceBundle(changeId, {
      exportedBy: session.user.id,
      exportedAt: new Date().toISOString(),
    });

    // Sanitize the changeId for the filename. UUIDs and arbitrary
    // ids are allowed in the URL, but Content-Disposition should not
    // include raw user input.
    const safeFilename = makeSafeFilename(changeId);

    // NextResponse takes a Buffer body directly and forwards the
    // Content-Type / Content-Disposition headers. We use
    // application/zip per the US-008 spec; the filename uses the
    // conventional pagevault-evidence- prefix so a downloaded file
    // is identifiable in the user's filesystem.
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="pagevault-evidence-${safeFilename}.zip"`,
        'Content-Length': String(buffer.byteLength),
        // Don't let intermediaries cache the bundle — the signature
        // is per-export and per-user.
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    if (err instanceof EvidenceBundleNotFoundError) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Change not found' } },
        { status: 404 }
      );
    }
    console.error('Failed to export change evidence bundle:', err);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to build evidence bundle' } },
      { status: 500 }
    );
  }
}

/**
 * Make a filename-safe slug out of an arbitrary change id. The
 * route accepts any id, but Content-Disposition should not echo
 * raw user input back to the client. We allow UUIDs through
 * unchanged and strip everything else to [a-z0-9-]. If the id is
 * empty after stripping, we fall back to 'change'.
 */
function makeSafeFilename(id: string): string {
  const slug = id.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return slug.length > 0 ? slug.slice(0, 80) : 'change';
}
