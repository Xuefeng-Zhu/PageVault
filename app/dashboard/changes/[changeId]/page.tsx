'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight, FileText, ExternalLink, CheckCircle, Image, GitCompare, LayoutGrid } from 'lucide-react';
import { SeverityBadge } from '@/components/dashboard/SeverityBadge';
import { AIInsightCard } from '@/components/dashboard/AIInsightCard';
import { DiffViewer } from '@/components/dashboard/DiffViewer';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { showToast } from '@/components/ui/Toast';
import { useState } from 'react';

const demoChange = {
  id: 'change-1',
  roomId: 'room-1',
  watchedUrlId: 'url-1',
  severity: 'high' as const,
  changeType: 'pricing',
  summary: 'Pricing page: Starter plan increased from $99 to $149 per month',
  createdAt: '2024-05-22T10:30:00Z',
  confidence: 93,
  evidence: [
    { before: '$99/mo • Starter Plan\n- 5 projects\n- 10GB storage\n- Email support', after: '$149/mo • Starter Plan\n- 5 projects\n- 10GB storage\n- Priority email support\n- New: Advanced analytics', explanation: 'Price increased by 50% while adding minimal value' },
    { before: '**Popular** Save 20% with annual billing', after: 'Enterprise tier now available with custom pricing', explanation: 'Removed discount and added enterprise tier' },
  ],
  aiInsights: [
    'DemoCo removed the "Save 20%" discount banner that was visible last month',
    'The new pricing aligns with enterprise-focused positioning shift',
    'This is the first price increase in 18 months for this tier',
    'Competitor added basic analytics to justify the price increase',
  ],
  businessInterpretation: 'DemoCo appears to be moving upmarket, targeting larger customers with higher ACV. The price increase signals confidence in product value and likely reflects recent funding.',
  recommendedActions: [
    'Review your own pricing strategy and consider similar adjustments',
    'Update competitive analysis with new price points',
    'Monitor for follow-up changes to enterprise tier pricing',
    'Share findings with revenue team for account planning',
  ],
  impactScore: 8,
  affectedPages: ['/pricing', '/features'],
  reportBoxFileId: '987654321',
};

const demoRoom = {
  id: 'room-1',
  name: 'DemoCo Website',
  targetName: 'demo.co',
};

type TabType = 'overview' | 'diff' | 'evidence';

export default function ChangeDetailPage() {
  const params = useParams();
  const changeId = params.changeId as string;
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [reviewed, setReviewed] = useState(false);

  if (changeId !== 'change-1') {
    return (
      <div className="max-w-5xl mx-auto">
        <Card className="text-center py-12">
          <h2 className="text-xl font-semibold text-on-surface mb-2">Change not found</h2>
          <p className="text-body-md text-on-surface-variant mb-4">The change you're looking for doesn't exist.</p>
          <Link href="/dashboard">
            <Button variant="secondary">Back to Dashboard</Button>
          </Link>
        </Card>
      </div>
    );
  }

  const handleMarkAsReviewed = () => {
    setReviewed(true);
    showToast('Change marked as reviewed', 'success');
  };

  return (
    <div className="max-w-5xl mx-auto min-h-screen bg-slate-50">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-body-md mb-6 pt-6 text-slate-600">
        <Link href="/dashboard" className="hover:text-blue-600 transition-colors text-blue-600">Dashboard</Link>
        <ChevronRight className="w-4 h-4" />
        <Link href={`/dashboard/rooms/${demoRoom.id}`} className="hover:text-blue-600 transition-colors text-blue-600">Changes</Link>
        <ChevronRight className="w-4 h-4" />
        <span className="font-semibold text-slate-900">{demoChange.summary.split(':')[0]}</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold mb-3 text-slate-900">{demoChange.summary.split(':')[0]}</h1>
          <div className="flex items-center gap-3">
            <SeverityBadge severity={demoChange.severity} />
            <span className="text-body-md text-slate-600">
              {new Date(demoChange.createdAt).toLocaleDateString('en-US', {
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
      <div className="flex items-center gap-1 mb-8 p-1 rounded-xl w-fit bg-slate-200">
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
      <div className="space-y-6">
        {activeTab === 'overview' && (
          <>
            {/* AI Summary card with purple gradient left border */}
            <AIInsightCard
              title="AI Summary"
              insights={demoChange.aiInsights}
              confidence={demoChange.confidence}
              icon="brain"
            />

            {/* What Changed section */}
            <Card className="border-l-4 border-violet-700 bg-white">
              <h2 className="text-lg font-semibold mb-3 text-slate-900">What Changed</h2>
              <p className="text-body-md leading-relaxed text-slate-600">
                {demoChange.summary}
              </p>
            </Card>

            {/* Why It Matters section */}
            <Card className="border-l-4 border-violet-700 bg-white">
              <h2 className="text-lg font-semibold mb-3 text-slate-900">Why It Matters</h2>
              <p className="text-body-md leading-relaxed text-slate-600">
                {demoChange.businessInterpretation}
              </p>
            </Card>

            {/* Recommended Actions section */}
            <Card className="bg-white">
              <h2 className="text-lg font-semibold mb-4 text-slate-900">Recommended Actions</h2>
              <ul className="space-y-3">
                {demoChange.recommendedActions.map((action, index) => (
                  <li key={index} className="flex items-start gap-3 p-3 rounded-xl bg-slate-50">
                    <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-violet-700" />
                    <span className="text-body-md text-slate-600">{action}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </>
        )}

        {activeTab === 'diff' && (
          <Card className="bg-white">
            <h2 className="text-lg font-semibold mb-4 text-slate-900">Before / After Comparison</h2>
            <DiffViewer evidence={demoChange.evidence} />
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
                    <span className="text-slate-500">May 21, 2024</span>
                  </div>
                </div>
                <div className="border border-slate-200 rounded-xl p-4 bg-slate-50">
                  <div className="text-label-sm font-medium mb-2 text-slate-600">After</div>
                  <div className="rounded-xl h-48 flex items-center justify-center bg-slate-200">
                    <span className="text-slate-500">May 22, 2024</span>
                  </div>
                </div>
              </div>
            </Card>

            {/* Linked resources list */}
            <Card className="bg-white">
              <h2 className="text-lg font-semibold mb-4 text-slate-900">Linked Resources</h2>
              <div className="space-y-3">
                <a href="#" className="flex items-center gap-3 p-4 rounded-xl transition-colors hover:bg-slate-100 bg-slate-50 border border-slate-200">
                  <FileText className="w-5 h-5 text-blue-600" />
                  <div className="flex-1">
                    <div className="text-body-md font-medium text-slate-900">Box Report: DemoCo Pricing Analysis</div>
                    <div className="text-label-sm text-slate-600">box.com/file/987654321 • 2.4 MB</div>
                  </div>
                  <ExternalLink className="w-4 h-4 text-slate-600" />
                </a>
                <a href="#" className="flex items-center gap-3 p-4 rounded-xl transition-colors hover:bg-slate-100 bg-slate-50 border border-slate-200">
                  <GitCompare className="w-5 h-5 text-violet-700" />
                  <div className="flex-1">
                    <div className="text-body-md font-medium text-slate-900">Raw Diff Data (JSON)</div>
                    <div className="text-label-sm text-slate-600">Machine-readable format</div>
                  </div>
                  <ExternalLink className="w-4 h-4 text-slate-600" />
                </a>
              </div>
            </Card>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-12 pt-6 border-t border-slate-200">
        <div className="text-body-sm text-slate-600">
          Evidence stored in Box • AI analysis by OpenAI • Snapshot captured at {new Date(demoChange.createdAt).toLocaleString()}
        </div>
        <div className="flex items-center gap-3">
          <a
            href={`https://app.box.com/file/${demoChange.reportBoxFileId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 text-body-md font-medium rounded-xl border bg-white border-slate-200 text-slate-900 transition-colors hover:bg-slate-50"
          >
            <FileText className="w-4 h-4" />
            Open Box Folder
          </a>
          <Button onClick={handleMarkAsReviewed} disabled={reviewed}>
            <CheckCircle className="w-4 h-4 mr-2" />
            {reviewed ? 'Marked as Reviewed' : 'Mark as Reviewed'}
          </Button>
        </div>
      </div>
    </div>
  );
}
