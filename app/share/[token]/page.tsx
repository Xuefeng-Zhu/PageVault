// Public read-only share page (US-013).
//
// Renders a single change (an ai_explanations row) for anyone with a
// valid share token — no login required. The page is a server
// component; all data fetching happens at request time:
//
//   1. shared_changes lookup by token (anon, RLS-gated)
//      — returns 404 for unknown / revoked / expired tokens
//   2. ai_explanations + snapshot + tracked_page join (service-role)
//      — needed because RLS on those tables restricts reads to the
//        owning user, but a public viewer has no session
//
// The page intentionally hides everything that could let a viewer
// infer the owner's identity or their other rooms: roomId,
// watchedUrlId, snapshot ids, room/storage paths, and any other
// project metadata are not rendered. The only thing the page shows
// about provenance is the source URL of the tracked page and a
// created-on date for the share link itself.

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { FileText, GitCompare, AlertTriangle } from 'lucide-react';
import { DiffViewer } from '@/components/dashboard/DiffViewer';
import { SeverityBadge } from '@/components/dashboard/SeverityBadge';
import { Card } from '@/components/ui/Card';
import {
  getSharedChangeByToken,
  getPublicChangeById,
  getPublicChangeSourceUrl,
} from '@/lib/shared-changes';
import type { ChangeAnalysis } from '@/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Public metadata — DON'T include the change summary in <title>
// because the title is sometimes indexed by search engines and
// shared on social cards; the user's change text is private until
// the recipient opens the link.
export const metadata = {
  title: 'PageVault — Shared change',
  robots: { index: false, follow: false },
};

export default async function SharedChangePage({
  params,
}: {
  params: { token: string };
}) {
  // 1. Resolve the share token. A miss returns null (404). A revoked
  //    or expired token also returns null because the RLS policy
  //    hides revoked/expired rows from anon SELECT.
  const shared = await getSharedChangeByToken(params.token);
  if (!shared) {
    notFound();
  }

  // 2. Fetch the change. The share row is the only thing keeping this
  //    public — without a valid shared_changes row above, we never
  //    reach the SRK call.
  const [change, sourceUrl] = await Promise.all([
    getPublicChangeById(shared.change_id),
    getPublicChangeSourceUrl(shared.change_id),
  ]);
  if (!change) {
    // The token resolved but the underlying change is gone
    // (FK ON DELETE CASCADE on shared_changes means this should be
    // impossible in practice, but render a 404 if it ever does).
    notFound();
  }

  return <SharedChangeBody change={change} sourceUrl={sourceUrl} createdAt={shared.created_at} expiresAt={shared.expires_at} />;
}

function SharedChangeBody({
  change,
  sourceUrl,
  createdAt,
  expiresAt,
}: {
  change: ChangeAnalysis;
  sourceUrl: string | null;
  createdAt: string;
  expiresAt: string | null;
}) {
  return (
    <div className="min-h-screen bg-paper text-ink">
      <div className="max-w-4xl mx-auto px-6 py-12 space-y-8">
        {/* Page header */}
        <header className="space-y-3 pb-6 border-b border-rule">
          <p className="font-mono text-mono-sm text-ink-3 uppercase tracking-archive">
            PageVault · Public read-only view
          </p>
          <h1 className="font-display text-display-lg text-ink leading-[1.1]">
            {change.summary || 'Shared change'}
          </h1>
          {sourceUrl && (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 font-mono text-mono-sm text-ink-3 hover:text-ink transition-colors"
            >
              <FileText className="w-3.5 h-3.5" />
              {sourceUrl}
            </a>
          )}
        </header>

        {/* Severity / change type / date row */}
        <div className="flex flex-wrap items-center gap-3">
          <SeverityBadge severity={change.severity} />
          <span className="font-mono text-mono-sm text-ink-3 uppercase tracking-archive">
            {change.changeType}
          </span>
          <span className="font-mono text-mono-sm text-ink-3">
            {new Date(change.createdAt).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </span>
        </div>

        {/* AI brief */}
        {change.businessInterpretation && (
          <Card padding="lg" sectionLabel="What this means" sectionNumber="I">
            <p className="font-body text-body-md text-ink leading-relaxed">
              {change.businessInterpretation}
            </p>
          </Card>
        )}

        {/* Diff viewer — client component, hydrated on the client. */}
        {change.evidence.length > 0 && (
          <Card padding="lg" sectionLabel="Before / after" sectionNumber="II">
            <DiffViewer evidence={change.evidence} />
          </Card>
        )}

        {/* Recommended actions */}
        {change.recommendedActions.length > 0 && (
          <section>
            <p className="font-mono text-mono-sm text-ink-3 uppercase tracking-archive mb-3">
              III · Recommended actions
            </p>
            <ol className="border border-rule bg-surface-raised">
              {change.recommendedActions.map((action, i) => (
                <li
                  key={i}
                  className={[
                    'flex items-start gap-4 p-5 group',
                    i < change.recommendedActions.length - 1 ? 'border-b border-rule' : '',
                  ].join(' ')}
                >
                  <span className="numeral text-2xl w-8 shrink-0">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div className="flex-1">
                    <p className="font-body text-body-md text-ink leading-relaxed">
                      {action}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* View raw evidence — for MVP-1 we link to the AI brief
            markdown stored alongside the change. If the storage key
            is not set (which is the common case for older changes
            or in demo mode), the link is omitted. */}
        {change.storageKey && (
          <Card padding="md">
            <a
              href={change.storageUrl ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 font-mono text-mono-sm text-ink-2 hover:text-ink transition-colors"
            >
              <GitCompare className="w-3.5 h-3.5" />
              View raw evidence
            </a>
          </Card>
        )}

        {/* Footer */}
        <footer className="pt-8 mt-8 border-t border-rule space-y-2">
          <p className="font-body text-body-sm text-ink-3">
            This is a public read-only view. The link was created on{' '}
            {new Date(createdAt).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
            {expiresAt
              ? ` and expires on ${new Date(expiresAt).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}.`
              : ' and does not expire.'}
          </p>
          <p className="font-mono text-mono-sm text-ink-4 uppercase tracking-archive">
            <Link href="/" className="hover:text-ink transition-colors">
              PageVault
            </Link>
            {' · '}
            <Link href="/login" className="hover:text-ink transition-colors">
              Sign in
            </Link>
          </p>
        </footer>
      </div>
    </div>
  );
}

// Custom not-found for the share route — keeps the public page
// on-brand when the token doesn't resolve.
export function NotFound() {
  return (
    <div className="min-h-screen bg-paper text-ink flex items-center justify-center px-6">
      <Card padding="xl" className="max-w-xl w-full">
        <div className="text-center">
          <div className="w-12 h-12 border border-ember mx-auto mb-5 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-ember" strokeWidth={1.5} />
          </div>
          <h2 className="font-display text-display-md text-ink mb-2">
            Link not found
          </h2>
          <p className="font-body text-body-md text-ink-2 mb-6">
            This share link is invalid, has been revoked, or has expired.
          </p>
          <Link href="/">
            <span className="font-mono text-mono-sm text-ink-2 hover:text-ink transition-colors uppercase tracking-archive">
              ← PageVault home
            </span>
          </Link>
        </div>
      </Card>
    </div>
  );
}
