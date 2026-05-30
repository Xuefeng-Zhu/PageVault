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

const demoChanges: Record<string, {
  id: string;
  roomId: string;
  watchedUrlId: string;
  severity: 'high' | 'medium' | 'low';
  changeType: string;
  summary: string;
  createdAt: string;
  confidence: number;
  evidence: Array<{ before: string; after: string; explanation: string }>;
  aiInsights: string[];
  businessInterpretation: string;
  recommendedActions: string[];
  impactScore: number;
  affectedPages: string[];
  reportBoxFileId: string;
}> = {
  'change-1': {
    id: 'change-1',
    roomId: 'room-1',
    watchedUrlId: 'url-4',
    severity: 'high',
    changeType: 'pricing',
    summary: 'AWS Lambda Pricing Update',
    createdAt: '2024-05-28T10:30:00Z',
    confidence: 95,
    evidence: [
      { before: '$0.20 per 1M requests (x86)\n$0.0000166667 per GB-second', after: '$0.20 per 1M requests (x86)\n$0.17 per 1M requests (ARM) — NEW\n$0.0000166667 per GB-second (x86)\n$0.0000133334 per GB-second (ARM) — NEW 15% reduction', explanation: 'New ARM-based pricing tiers with 15% reduction' },
      { before: 'ARM-based functions: 20% cheaper', after: 'ARM-based functions now 20% cheaper (increased from 20%) — UPDATED', explanation: 'ARM discount increased' },
    ],
    aiInsights: [
      'AWS announced a 15% reduction in Lambda pricing for ARM-based functions, effective June 1',
      'This follows Google\'s similar move in March and could signal a broader price war in serverless computing',
      'The new Graviton2-based pricing makes ARM the more attractive option for cost-conscious workloads',
      'Competitor pricing pressure from Google Cloud Functions appears to be driving this adjustment',
    ],
    businessInterpretation: 'AWS announced a 15% reduction in Lambda pricing for ARM-based functions, effective June 1. This follows Google\'s similar move in March and could signal a broader price war in serverless computing.',
    recommendedActions: [
      'Update competitive battlecards with new Lambda ARM pricing',
      'Monitor Google Cloud Functions for similar price adjustments',
      'Review serverless cost projections for Q3',
      'Share findings with infrastructure team for architecture decisions',
    ],
    impactScore: 8,
    affectedPages: ['/lambda/', '/pricing/'],
    reportBoxFileId: 'mock-aws-lambda-report',
  },
  'change-2': {
    id: 'change-2',
    roomId: 'room-2',
    watchedUrlId: 'url-3',
    severity: 'medium',
    changeType: 'feature',
    summary: 'Apify Storage Limits Changed',
    createdAt: '2024-05-27T14:20:00Z',
    confidence: 92,
    evidence: [
      { before: 'Free Tier\n- 2TB storage included', after: 'Free Tier — UPDATED\n- 5TB storage included (was 2TB)', explanation: 'Free tier storage expanded 2.5x' },
      { before: 'Team Plan - $49/month\n- 5TB storage', after: 'Team Plan - $49/month\n- 10TB storage (was 5TB)', explanation: 'Paid tier storage doubled' },
    ],
    aiInsights: [
      'Apify expanded its free storage tier from 2TB to 5TB',
      'This is the first capacity increase since 2023',
      'Likely a response to competitor Playwright\'s enterprise push',
      'The 2.5x increase in free storage may indicate a shift in their freemium strategy',
    ],
    businessInterpretation: 'Apify expanded its free storage tier from 2TB to 5TB. This is the first capacity increase since 2023, likely a response to competitor Playwright\'s enterprise push.',
    recommendedActions: [
      'Update competitive analysis with new Apify storage limits',
      'Review Playwright\'s recent enterprise features for context',
      'Consider impact on customers using Apify for large-scale crawling',
      'Monitor for follow-up pricing changes',
    ],
    impactScore: 6,
    affectedPages: ['/storage/', '/pricing/'],
    reportBoxFileId: 'mock-apify-storage-report',
  },
  'change-3': {
    id: 'change-3',
    roomId: 'room-3',
    watchedUrlId: 'url-2',
    severity: 'low',
    changeType: 'security',
    summary: 'Box Security Whitepaper Updated',
    createdAt: '2024-05-26T09:15:00Z',
    confidence: 88,
    evidence: [
      { before: 'ISO 27001:2013 certified', after: 'ISO 27001:2022 certified — UPDATED', explanation: 'Certification updated to latest standard' },
      { before: '45 control objectives', after: '57 control objectives (was 45)\n12 new AI data handling controls — NEW', explanation: 'Significantly expanded control framework' },
    ],
    aiInsights: [
      'Box updated their SOC 2 compliance certification',
      'The new report covers ISO 27001:2022 requirements',
      'Adds 12 new control objectives for AI data handling',
      'This appears to be a proactive compliance update ahead of incoming AI regulations',
    ],
    businessInterpretation: 'Box updated their SOC 2 compliance certification. The new report covers ISO 27001:2022 requirements and adds 12 new control objectives for AI data handling.',
    recommendedActions: [
      'Update security/compliance documentation',
      'Review AI data handling controls for relevance to your use case',
      'Monitor competitor compliance updates',
      'Share with legal/compliance team',
    ],
    impactScore: 4,
    affectedPages: ['/security/'],
    reportBoxFileId: 'mock-box-security-report',
  },
};

const demoRooms: Record<string, { id: string; name: string; targetName: string }> = {
  'room-1': { id: 'room-1', name: 'Cloud Infrastructure Monitor', targetName: 'aws.amazon.com' },
  'room-2': { id: 'room-2', name: 'Automation Tools Tracker', targetName: 'apify.com' },
  'room-3': { id: 'room-3', name: 'Enterprise SaaS Watch', targetName: 'box.com' },
};

type TabType = 'overview' | 'diff' | 'evidence';

export default function ChangeDetailPage() {
  const params = useParams();
  const changeId = params.changeId as string;
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [reviewed, setReviewed] = useState(false);

  const demoChange = demoChanges[changeId];
  const demoRoom = demoChange ? demoRooms[demoChange.roomId] : null;

  if (!demoChange || !demoRoom) {
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
        <Link href={`/dashboard/rooms/${demoRoom.id}`} className="hover:text-blue-600 transition-colors text-blue-600">{demoRoom.name}</Link>
        <ChevronRight className="w-4 h-4" />
        <span className="font-semibold text-slate-900">{demoChange.summary}</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold mb-3 text-slate-900">{demoChange.summary}</h1>
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
                    <span className="text-slate-500">May 28, 2024</span>
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
                    <div className="text-body-md font-medium text-slate-900">Box Report: {demoChange.summary}</div>
                    <div className="text-label-sm text-slate-600">{demoRoom.targetName} • AI Analysis</div>
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