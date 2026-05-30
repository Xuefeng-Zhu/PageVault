'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight, ExternalLink, Box, Globe, Calendar, CheckCircle, AlertTriangle } from 'lucide-react';
import { SeverityBadge } from '@/components/dashboard/SeverityBadge';
import { Button } from '@/components/ui/Button';

const demoRoomsData: Record<string, {
  id: string;
  name: string;
  targetName: string;
  category: string;
  boxFolderId: string;
  lastScanAt: string;
  status: string;
}> = {
  'room-1': {
    id: 'room-1',
    name: 'Cloud Infrastructure Monitor',
    targetName: 'aws.amazon.com',
    category: 'competitor',
    boxFolderId: 'mock-folder-aws',
    lastScanAt: '2024-05-28T10:30:00Z',
    status: 'Active',
  },
  'room-2': {
    id: 'room-2',
    name: 'Automation Tools Tracker',
    targetName: 'apify.com',
    category: 'competitor',
    boxFolderId: 'mock-folder-apify',
    lastScanAt: '2024-05-27T14:20:00Z',
    status: 'Active',
  },
  'room-3': {
    id: 'room-3',
    name: 'Enterprise SaaS Watch',
    targetName: 'box.com',
    category: 'competitor',
    boxFolderId: 'mock-folder-box',
    lastScanAt: '2024-05-26T09:15:00Z',
    status: 'Paused',
  },
};

const demoChanges: Record<string, Array<{
  id: string;
  summary: string;
  severity: 'high' | 'medium' | 'low';
  changeType: string;
  createdAt: string;
  roomId: string;
  watchedUrlId: string;
}>> = {
  'room-1': [
    { id: 'change-1', summary: 'AWS Lambda Pricing Update — new pricing tiers for ARM-based functions', severity: 'high' as const, changeType: 'pricing', createdAt: '2024-05-28T10:30:00Z', roomId: 'room-1', watchedUrlId: 'url-1' },
  ],
  'room-2': [
    { id: 'change-2', summary: 'Apify Storage Limits Changed — free tier expanded from 2TB to 5TB', severity: 'medium' as const, changeType: 'feature', createdAt: '2024-05-27T14:20:00Z', roomId: 'room-2', watchedUrlId: 'url-2' },
  ],
  'room-3': [
    { id: 'change-3', summary: 'Box Security Whitepaper Updated — SOC 2 and ISO 27001:2022 certification', severity: 'low' as const, changeType: 'security', createdAt: '2024-05-26T09:15:00Z', roomId: 'room-3', watchedUrlId: 'url-3' },
  ],
};

const demoWatchedUrls: Record<string, Array<{
  id: string;
  url: string;
  label: string;
  pageType: string;
  lastChanged: string;
  severity: 'high' | 'medium' | 'low';
}>> = {
  'room-1': [
    { id: 'url-1', url: 'https://aws.amazon.com/', label: 'Homepage', pageType: 'homepage', lastChanged: '2024-05-28T10:30:00Z', severity: 'low' as const },
    { id: 'url-2', url: 'https://aws.amazon.com/ec2/', label: 'EC2', pageType: 'product', lastChanged: '2024-05-25T08:00:00Z', severity: 'low' as const },
    { id: 'url-3', url: 'https://aws.amazon.com/s3/', label: 'S3', pageType: 'product', lastChanged: '2024-05-24T08:00:00Z', severity: 'low' as const },
    { id: 'url-4', url: 'https://aws.amazon.com/lambda/', label: 'Lambda', pageType: 'product', lastChanged: '2024-05-28T10:30:00Z', severity: 'high' as const },
    { id: 'url-5', url: 'https://aws.amazon.com/iam/', label: 'IAM', pageType: 'product', lastChanged: '2024-05-20T08:00:00Z', severity: 'low' as const },
  ],
  'room-2': [
    { id: 'url-1', url: 'https://apify.com/', label: 'Homepage', pageType: 'homepage', lastChanged: '2024-05-27T14:20:00Z', severity: 'low' as const },
    { id: 'url-2', url: 'https://apify.com/pricing', label: 'Pricing', pageType: 'pricing', lastChanged: '2024-05-22T08:00:00Z', severity: 'low' as const },
    { id: 'url-3', url: 'https://apify.com/storage', label: 'Storage', pageType: 'product', lastChanged: '2024-05-27T14:20:00Z', severity: 'medium' as const },
    { id: 'url-4', url: 'https://apify.com/actor', label: 'Actor', pageType: 'product', lastChanged: '2024-05-18T08:00:00Z', severity: 'low' as const },
  ],
  'room-3': [
    { id: 'url-1', url: 'https://www.box.com/', label: 'Homepage', pageType: 'homepage', lastChanged: '2024-05-26T09:15:00Z', severity: 'low' as const },
    { id: 'url-2', url: 'https://www.box.com/security', label: 'Security', pageType: 'trust', lastChanged: '2024-05-26T09:15:00Z', severity: 'low' as const },
    { id: 'url-3', url: 'https://www.box.com/integrations', label: 'Integrations', pageType: 'product', lastChanged: '2024-05-15T08:00:00Z', severity: 'low' as const },
    { id: 'url-4', url: 'https://www.box.com/developers', label: 'Developers', pageType: 'docs', lastChanged: '2024-05-10T08:00:00Z', severity: 'low' as const },
    { id: 'url-5', url: 'https://www.box.com/about', label: 'About', pageType: 'company', lastChanged: '2024-05-05T08:00:00Z', severity: 'low' as const },
  ],
};

export default function RoomDetailPage() {
  const params = useParams();
  const roomId = params.roomId as string;
  const [scanning, setScanning] = useState(false);

  const handleRunScan = async () => {
    setScanning(true);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    setScanning(false);
  };

  const demoRoom = demoRoomsData[roomId];
  const roomChanges = demoChanges[roomId] || [];
  const watchedUrls = demoWatchedUrls[roomId] || [];

  if (!demoRoom) {
    return (
      <div className="max-w-5xl mx-auto">
        <div className="bg-white border border-[#e2e8f0] rounded-2xl text-center py-12">
          <h2 className="text-xl font-semibold text-[#131b2e] mb-2">Room not found</h2>
          <p className="text-sm text-[#434655] mb-4">The room you're looking for doesn't exist.</p>
          <Link href="/dashboard">
            <Button variant="secondary">Back to Dashboard</Button>
          </Link>
        </div>
      </div>
    );
  }

  const stats = [
    { label: 'Total URLs', value: watchedUrls.length, icon: Globe },
    { label: 'Monitored Changes', value: roomChanges.length, icon: AlertTriangle },
    { label: 'Last Scan', value: '2 hours ago', icon: Calendar },
    { label: 'Health', value: demoRoom.status === 'Active' ? 'Good' : 'Paused', icon: CheckCircle },
  ];

  return (
    <div className="max-w-[1600px] mx-auto bg-[#f8fafc] min-h-screen p-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-[#434655] mb-6">
        <Link href="/dashboard" className="hover:text-[#2563eb]">Dashboard</Link>
        <ChevronRight className="w-4 h-4" />
        <span className="text-[#131b2e] font-medium">{demoRoom.name}</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-xl bg-[#2563eb] flex items-center justify-center text-white text-2xl font-bold">
            {demoRoom.name.charAt(0)}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#131b2e]">{demoRoom.name}</h1>
            <div className="flex items-center gap-3 mt-2">
              <span className="text-sm text-[#434655] font-mono">{demoRoom.targetName}</span>
              <span className="text-sm text-[#434655]">•</span>
              <span className="text-sm text-[#434655]">Last scanned: {new Date(demoRoom.lastScanAt).toLocaleDateString()}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <a
            href={`https://app.box.com/folder/${demoRoom.boxFolderId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 bg-white border border-[#e2e8f0] text-[#131b2e] text-sm font-medium rounded-lg hover:bg-[#f8fafc] transition-colors"
          >
            <Box className="w-4 h-4" />
            Open in Box
            <ExternalLink className="w-3 h-3" />
          </a>
          <Button onClick={handleRunScan} loading={scanning}>
            Run Scan
          </Button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-6 mb-8">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-white border border-[#e2e8f0] rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-[#434655] uppercase tracking-wider">{stat.label}</span>
              <stat.icon className="w-4 h-4 text-[#2563eb]" />
            </div>
            <div className="flex items-end justify-between">
              <span className="text-3xl font-bold text-[#131b2e]">{stat.value}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Left: Watched URLs */}
        <div className="col-span-7">
          <div className="bg-white border border-[#e2e8f0] rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-[#131b2e] mb-4">Watched URLs</h2>
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#e2e8f0]">
                  <th className="pb-3 text-left text-xs font-medium text-[#434655] uppercase tracking-wider">URL</th>
                  <th className="pb-3 text-left text-xs font-medium text-[#434655] uppercase tracking-wider">Last Changed</th>
                  <th className="pb-3 text-left text-xs font-medium text-[#434655] uppercase tracking-wider">Severity</th>
                </tr>
              </thead>
              <tbody>
                {watchedUrls.map((url) => (
                  <tr key={url.id} className="border-b border-[#e2e8f0] last:border-0 hover:bg-[#f8fafc] transition-colors">
                    <td className="py-4">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-[#131b2e] font-medium">{url.label}</span>
                        <span className="text-xs text-[#434655] font-mono truncate max-w-[200px]">{url.url}</span>
                      </div>
                    </td>
                    <td className="py-4 text-sm text-[#434655]">
                      {new Date(url.lastChanged).toLocaleDateString()}
                    </td>
                    <td className="py-4">
                      <SeverityBadge severity={url.severity} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Recent Changes */}
        <div className="col-span-5">
          <div className="bg-white border border-[#e2e8f0] rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-[#131b2e] mb-4">Recent Changes</h2>
            <div className="space-y-4">
              {roomChanges.map((change) => (
                <div key={change.id} className="flex items-start gap-4 pb-4 border-b border-[#e2e8f0] last:border-0 last:pb-0">
                  <div className="w-24 flex-shrink-0">
                    <div className="text-xs text-[#434655]">
                      {new Date(change.createdAt).toLocaleDateString()}
                    </div>
                    <div className="text-xs text-[#434655]">
                      {new Date(change.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[#131b2e] mb-2">{change.summary}</p>
                    <SeverityBadge severity={change.severity} />
                  </div>
                </div>
              ))}
              {roomChanges.length === 0 && (
                <p className="text-sm text-[#434655]">No changes detected yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}