'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight, FileText, ExternalLink, CheckCircle, Image, GitCompare, LayoutGrid } from 'lucide-react';
import { SeverityBadge } from '@/components/dashboard/SeverityBadge';
import { AIInsightCard } from '@/components/dashboard/AIInsightCard';
import { DiffViewer } from '@/components/dashboard/DiffViewer';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
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
          if (res.status === 404) {
            setError('Change not found');
          } else {
            throw new Error('Failed to fetch change');
          }
          return;
        }
        const json: ChangeAnalysis = await res.json();
        setChange(json);
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
    showToast('Change marked as reviewed', 'success');
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto min-h-screen bg-slate-50 p-8">
        <div className="animate-pulse space-y-6">
          <div className="h-4 bg-gray-200 rounded w-48" />
          <div className="h-8 bg-gray-200 rounded w-1/3" />
          <div className="h-12 bg-gray-200 rounded w-1/4" />
        </div>
      </div>
    );
  }

  if (error || !change) {
    return (
      <div className="max-w-5xl mx-auto">
        <Card className="text-center py-12">
          <h2 className="text-xl font-semibold text-on-surface mb-2">{error || 'Change not found'}</h2>
          <p className="text-body-md text-on-surface-variant mb-4">The change you're looking for doesn't exist.</p>
          <Link href="/dashboard">
            <Button variant="secondary">Back to Dashboard</Button>
          </Link>
        </Card>
      </div>
    );
  }

  const aiInsights = [
    change.businessInterpretation || change.summary,
    ...(change.recommendedActions.length > 0
      ? [`Recommended actions: ${change.recommendedActions.join('; ')}`]
      : []),
  ];

  return (
    <div className="max-w-5xl mx-auto min-h-screen bg-slate-50">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-body-md mb-6 pt-6 text-slate-600 px-8">
        <Link href="/dashboard" className="hover:text-blue-600 transition-colors text-blue-600">Dashboard</Link>
        <ChevronRight className="w-4 h-4" />
        <Link href={`/dashboard/rooms/${change.roomId}`} className="hover:text-blue-600 transition-colors text-blue-600">Room</Link>
        <ChevronRight className="w-4 h-4" />
        <span className="font-semibold text-slate-900">{change.summary}</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between mb-8 px-8">
        <div>
          <h1 className="text-2xl font-bold mb-3 text-slate-900">{change.summary}</h1>
          <div className="flex items-center gap-3">
            <SeverityBadge severity={change.severity} />
            <span className="text-body-md text-slate-600">
              {new Date(change.createdAt).toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              })}
            </span>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 mb-8 p-1 rounded-xl w-fit bg-slate-200 mx-8">
        {[
          { id: 'overview' as TabType, label: 'Overview', icon: LayoutGrid },
          { id: 'diff' as TabType, label: 'Diff View', icon: GitCompare },
          { id: 'evidence' as TabType, label: 'Evidence', icon: Image },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-body-md font-medium transition-all ${activeTab === tab.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="space-y-6 px-8">
        {activeTab === 'overview' && (
          <>
            {/* AI Summary card */}
            <AIInsightCard
              title="AI Summary"
              insights={aiInsights}
              confidence={85}
              icon="brain"
            />

            {/* What Changed section */}
            <Card className="border-l-4 border-violet-700 bg-white">
              <h2 className="text-lg font-semibold mb-3 text-slate-900">What Changed</h2>
              <p className="text-body-md leading-relaxed text-slate-600">
                {change.summary}
              </p>
            </Card>

            {/* Why It Matters section */}
            {change.businessInterpretation && (
              <Card className="border-l-4 border-violet-700 bg-white">
                <h2 className="text-lg font-semibold mb-3 text-slate-900">Why It Matters</h2>
                <p className="text-body-md leading-relaxed text-slate-600">
                  {change.businessInterpretation}
                </p>
              </Card>
            )}

            {/* Recommended Actions section */}
            {change.recommendedActions.length > 0 && (
              <Card className="bg-white">
                <h2 className="text-lg font-semibold mb-4 text-slate-900">Recommended Actions</h2>
                <ul className="space-y-3">
                  {change.recommendedActions.map((action, index) => (
                    <li key={index} className="flex items-start gap-3 p-3 rounded-xl bg-slate-50">
                      <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-violet-700" />
                      <span className="text-body-md text-slate-600">{action}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </>
        )}

        {activeTab === 'diff' && (
          <Card className="bg-white">
            <h2 className="text-lg font-semibold mb-4 text-slate-900">Before / After Comparison</h2>
            <DiffViewer evidence={change.evidence} />
          </Card>
        )}

        {activeTab === 'evidence' && (
          <>
            {/* Screenshot comparison */}
            <Card className="bg-white">
              <h2 className="text-lg font-semibold mb-4 text-slate-900">Screenshot Comparison</h2>
              <div className="grid grid-cols-2 gap-4">
                <div className="border border-slate-200 rounded-xl p-4 bg-slate-50">
                  <div className="text-label-sm font-medium mb-2 text-slate-600">Before</div>
                  <div className="rounded-xl h-48 flex items-center justify-center bg-slate-200">
                    <span className="text-slate-500">Snapshot</span>
                  </div>
                </div>
                <div className="border border-slate-200 rounded-xl p-4 bg-slate-50">
                  <div className="text-label-sm font-medium mb-2 text-slate-600">After</div>
                  <div className="rounded-xl h-48 flex items-center justify-center bg-slate-200">
                    <span className="text-slate-500">Snapshot</span>
                  </div>
                </div>
              </div>
            </Card>

            {/* Linked resources list */}
            <Card className="bg-white">
              <h2 className="text-lg font-semibold mb-4 text-slate-900">Linked Resources</h2>
              <div className="space-y-3">
                {change.reportBoxFileId && (
                  <a
                    href={`https://app.box.com/file/${change.reportBoxFileId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 p-4 rounded-xl transition-colors hover:bg-slate-100 bg-slate-50 border border-slate-200"
                  >
                    <FileText className="w-5 h-5 text-blue-600" />
                    <div className="flex-1">
                      <div className="text-body-md font-medium text-slate-900">Box Report</div>
                      <div className="text-label-sm text-slate-600">AI Analysis</div>
                    </div>
                    <ExternalLink className="w-4 h-4 text-slate-600" />
                  </a>
                )}
                <div className="flex items-center gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
                  <GitCompare className="w-5 h-5 text-violet-700" />
                  <div className="flex-1">
                    <div className="text-body-md font-medium text-slate-900">Raw Diff Data (JSON)</div>
                    <div className="text-label-sm text-slate-600">Machine-readable format</div>
                  </div>
                </div>
              </div>
            </Card>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-12 pt-6 border-t border-slate-200 mx-8">
        <div className="text-body-sm text-slate-600">
          Evidence stored in Box • AI analysis by OpenAI • Snapshot captured at {new Date(change.createdAt).toLocaleString()}
        </div>
        <div className="flex items-center gap-3">
          {change.reportBoxFileId && (
            <a
              href={`https://app.box.com/file/${change.reportBoxFileId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 text-body-md font-medium rounded-xl border bg-white border-slate-200 text-slate-900 transition-colors hover:bg-slate-50"
            >
              <FileText className="w-4 h-4" />
              Open Box Folder
            </a>
          )}
          <Button onClick={handleMarkAsReviewed} disabled={reviewed}>
            <CheckCircle className="w-4 h-4 mr-2" />
            {reviewed ? 'Marked as Reviewed' : 'Mark as Reviewed'}
          </Button>
        </div>
      </div>
    </div>
  );
}