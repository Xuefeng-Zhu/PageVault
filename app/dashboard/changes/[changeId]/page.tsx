'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ChevronRight,
  FileText,
  ExternalLink,
  CheckCircle2,
  Image as ImageIcon,
  GitCompare,
  LayoutGrid,
  AlertTriangle,
  ArrowUpRight,
  Download,
} from 'lucide-react';
import { SeverityBadge } from '@/components/dashboard/SeverityBadge';
import { AIInsightCard } from '@/components/dashboard/AIInsightCard';
import { DiffViewer } from '@/components/dashboard/DiffViewer';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Tabs, SectionHeader, Spinner, EmptyState } from '@/components/ui/Primitives';
import { showToast } from '@/components/ui/Toast';
import type { ChangeAnalysis } from '@/types';

type TabType = 'overview' | 'diff' | 'evidence';

export default function ChangeDetailPage() {
  const params = useParams();
  const changeId = params.changeId as string;
  const [change, setChange] = useState<ChangeAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [reviewed, setReviewed] = useState(false);

  useEffect(() => {
    async function fetchChange() {
      try {
        const res = await fetch(`/api/changes/${changeId}`, { cache: 'no-store' });
        if (!res.ok) {
          if (res.status === 404) setError('Change not found');
          else throw new Error('Failed to fetch change');
          return;
        }
        const json: { change: ChangeAnalysis } = await res.json();
        setChange(json.change);
      } catch (err) {
        console.error('Change fetch error:', err);
        setError('Failed to load change');
      } finally {
        setLoading(false);
      }
    }
    fetchChange();
  }, [changeId]);

  const handleMarkAsReviewed = () => {
    setReviewed(true);
    showToast('Marked as reviewed', { type: 'success', description: 'Filed under your work log.' });
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto space-y-8 fade-up-1">
        <div className="h-4 w-48 bg-rule animate-pulse" />
        <div className="h-12 w-2/3 bg-rule animate-pulse" />
        <div className="h-32 bg-rule animate-pulse" />
        <Spinner />
      </div>
    );
  }

  if (error || !change) {
    return (
      <div className="max-w-2xl mx-auto pt-20">
        <Card padding="xl">
          <div className="text-center">
            <div className="w-12 h-12 border border-ember mx-auto mb-5 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-ember" strokeWidth={1.5} />
            </div>
            <h2 className="font-display text-display-md text-ink mb-2">
              {error || 'Change not found'}
            </h2>
            <p className="font-body text-body-md text-ink-2 mb-6">
              The filing you&apos;re looking for isn&apos;t in the archive.
            </p>
            <Link href="/dashboard">
              <Button variant="secondary">← Back to overview</Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  const aiInsights = [
    change.businessInterpretation || change.summary,
    ...(change.recommendedActions.length > 0
      ? [`Recommended: ${change.recommendedActions[0]}`]
      : []),
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-8 fade-up-1">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 font-mono text-mono-sm text-ink-3 uppercase tracking-archive">
        <Link href="/dashboard" className="hover:text-ink transition-colors">Overview</Link>
        <ChevronRight className="w-3 h-3" />
        <Link href={`/dashboard/rooms/${change.roomId}`} className="hover:text-ink transition-colors">
          Room
        </Link>
        <ChevronRight className="w-3 h-3" />
        <span className="text-ink truncate">Change · {change.id.slice(0, 8)}</span>
      </nav>

      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-6 pb-6 border-b border-rule">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-3">
            <SeverityBadge severity={change.severity} />
            <span className="font-mono text-mono-sm text-ink-3 tabular">
              {new Date(change.createdAt).toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </span>
          </div>
          <h1 className="font-display text-display-lg text-ink leading-[1.1] max-w-3xl">
            {change.summary}
          </h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="secondary"
            icon={<Download className="w-4 h-4" />}
            onClick={() => showToast('Export queued', { type: 'info' })}
          >
            Export
          </Button>
          <Button
            onClick={handleMarkAsReviewed}
            disabled={reviewed}
            icon={reviewed ? <CheckCircle2 className="w-4 h-4" /> : undefined}
          >
            {reviewed ? 'Reviewed' : 'Mark reviewed'}
          </Button>
        </div>
      </header>

      {/* Tabs */}
      <div>
        <Tabs
          items={[
            { id: 'overview' as TabType, label: 'Overview', icon: <LayoutGrid className="w-3.5 h-3.5" strokeWidth={1.75} /> },
            { id: 'diff' as TabType, label: 'Diff', icon: <GitCompare className="w-3.5 h-3.5" strokeWidth={1.75} />, meta: change.evidence.length },
            { id: 'evidence' as TabType, label: 'Evidence', icon: <ImageIcon className="w-3.5 h-3.5" strokeWidth={1.75} /> },
          ]}
          value={activeTab}
          onChange={setActiveTab}
        />
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* AI interpretation — dark hero */}
          <AIInsightCard
            title="What this means"
            subtitle="Interpretation calibrated to your room's context"
            insights={aiInsights}
            confidence={87}
            icon="brain"
            stamp="Sealed"
          >
            <div className="mt-5 pt-5 border-t border-paper/15 flex items-center justify-between text-paper/50">
              <span className="font-mono text-mono-sm uppercase tracking-archive">
                Model · pagevault-interpret-2
              </span>
              <span className="font-mono text-mono-sm tabular text-paper/40">
                {(change.evidence.reduce((sum, e) => sum + e.before.length + e.after.length, 0) / 1000).toFixed(1)}k chars
              </span>
            </div>
          </AIInsightCard>

          {/* Two columns: What changed + Why it matters */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card padding="lg" sectionLabel="What changed" sectionNumber="I">
              <p className="font-body text-body-md text-ink leading-relaxed">
                {change.summary}
              </p>
            </Card>

            {change.businessInterpretation && (
              <Card padding="lg" sectionLabel="Why it matters" sectionNumber="II" tone="raised">
                <p className="font-body text-body-md text-ink leading-relaxed">
                  {change.businessInterpretation}
                </p>
              </Card>
            )}
          </div>

          {/* Recommended actions */}
          {change.recommendedActions.length > 0 && (
            <section>
              <SectionHeader
                number="III"
                label="Recommended actions"
                meta={`${change.recommendedActions.length} suggested`}
                className="mb-5"
              />
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
                    <button
                      className="font-mono text-mono-sm text-ink-3 hover:text-ink transition-colors shrink-0 opacity-0 group-hover:opacity-100"
                      aria-label="Open related action"
                    >
                      ↗
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      )}

      {activeTab === 'diff' && (
        <Card padding="lg">
          <SectionHeader
            number="I"
            label="Before / after"
            meta={`${change.evidence.length} diff${change.evidence.length === 1 ? '' : 's'}`}
            className="mb-5"
          />
          <DiffViewer evidence={change.evidence} />
        </Card>
      )}

      {activeTab === 'evidence' && (
        <div className="space-y-6">
          {/* Screenshot comparison */}
          <Card padding="lg">
            <SectionHeader
              number="I"
              label="Visual snapshots"
              meta="Captured at scan time"
              className="mb-5"
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <SnapshotSlot label="Before" stamp="T₀" />
              <SnapshotSlot label="After" stamp="T₁" highlight />
            </div>
          </Card>

          {/* Linked resources */}
          <Card padding="lg">
            <SectionHeader
              number="II"
              label="Linked resources"
              meta="Stored in Box"
              className="mb-5"
            />
            <div className="space-y-2">
              {change.reportBoxFileId && (
                <a
                  href={`/api/storage/file/${encodeURIComponent(change.reportBoxFileId)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center gap-4 p-4 border border-rule bg-paper-2 hover:border-ink hover:bg-paper transition-all"
                >
                  <span className="w-9 h-9 flex items-center justify-center border border-rule">
                    <FileText className="w-4 h-4 text-ink-2" strokeWidth={1.5} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-body text-body-md text-ink">Storage report</div>
                    <div className="font-mono text-mono-sm text-ink-3 uppercase tracking-archive mt-0.5">
                      AI analysis · sealed
                    </div>
                  </div>
                  <ArrowUpRight className="w-4 h-4 text-ink-3 group-hover:text-ink group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-all" />
                </a>
              )}
              <div className="flex items-center gap-4 p-4 border border-rule bg-paper-2">
                <span className="w-9 h-9 flex items-center justify-center border border-rule">
                  <GitCompare className="w-4 h-4 text-ink-2" strokeWidth={1.5} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-body text-body-md text-ink">Raw diff data</div>
                  <div className="font-mono text-mono-sm text-ink-3 uppercase tracking-archive mt-0.5">
                    JSON · machine-readable
                  </div>
                </div>
                <button
                  onClick={() => showToast('JSON ready', { type: 'info' })}
                  className="font-mono text-mono-sm text-ink-3 hover:text-ink transition-colors inline-flex items-center gap-1.5"
                  aria-label="Download diff as JSON"
                >
                  Download
                  <Download className="w-3 h-3" />
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Footer */}
      <footer className="pt-8 mt-8 border-t border-rule flex flex-wrap items-center justify-between gap-4">
        <div className="font-mono text-mono-sm text-ink-3 uppercase tracking-archive">
          Evidence sealed in Box · AI by pagevault-interpret-2 · Snapshot {new Date(change.createdAt).toLocaleString()}
        </div>
      </footer>
    </div>
  );
}

function SnapshotSlot({ label, stamp, highlight }: { label: string; stamp: string; highlight?: boolean }) {
  return (
    <div
      className={[
        'border p-5',
        highlight ? 'border-ink bg-signal-wash/40' : 'border-rule bg-paper-2',
      ].join(' ')}
    >
      <div className="flex items-center justify-between mb-3">
        <span
          className={[
            'font-mono text-mono-sm uppercase tracking-archive',
            highlight ? 'text-ink' : 'text-ink-3',
          ].join(' ')}
        >
          {label}
        </span>
        <span
          className={[
            'stamp',
            highlight ? 'stamp--signal' : 'stamp--ink',
          ].join(' ')}
          style={{ transform: 'none' }}
        >
          {stamp}
        </span>
      </div>
      <div className="aspect-[16/10] border border-rule bg-paper-3 flex items-center justify-center bg-diagonal">
        <ImageIcon className="w-8 h-8 text-ink-4" strokeWidth={1.25} />
      </div>
      <p className="mt-3 font-mono text-mono-sm text-ink-3 text-center">
        Snapshot unavailable · preview
      </p>
    </div>
  );
}
