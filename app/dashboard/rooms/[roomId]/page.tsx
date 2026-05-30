'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight, ExternalLink, Box, Globe, Calendar, CheckCircle, AlertTriangle } from 'lucide-react';
import { SeverityBadge } from '@/components/dashboard/SeverityBadge';
import { Button } from '@/components/ui/Button';
import type { RoomDetailResponse, WatchedUrl, ChangeAnalysis } from '@/types';

export default function RoomDetailPage() {
  const params = useParams();
  const roomId = params.roomId as string;
  const [data, setData] = useState<RoomDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchRoom() {
      try {
        const res = await fetch(`/api/rooms/${roomId}`, { cache: 'no-store' });
        if (!res.ok) {
          if (res.status === 404) {
            setError('Room not found');
          } else {
            throw new Error('Failed to fetch room');
          }
          return;
        }
        const json: RoomDetailResponse = await res.json();
        setData(json);
      } catch (err) {
        console.error('Room fetch error:', err);
        setError('Failed to load room');
      } finally {
        setLoading(false);
      }
    }
    fetchRoom();
  }, [roomId]);

  const handleRunScan = async () => {
    setScanning(true);
    try {
      const res = await fetch(`/api/rooms/${roomId}/scan`, { method: 'POST', cache: 'no-store' });
      if (!res.ok) throw new Error('Scan failed');
      // Refresh room data after scan
      const roomRes = await fetch(`/api/rooms/${roomId}`, { cache: 'no-store' });
      if (roomRes.ok) {
        const json: RoomDetailResponse = await roomRes.json();
        setData(json);
      }
    } catch (err) {
      console.error('Scan error:', err);
    } finally {
      setScanning(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-[1600px] mx-auto bg-[#f8fafc] min-h-screen p-8">
        <div className="animate-pulse space-y-6">
          <div className="h-4 bg-gray-200 rounded w-48" />
          <div className="h-12 bg-gray-200 rounded w-1/2" />
          <div className="grid grid-cols-4 gap-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 bg-gray-200 rounded-2xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-5xl mx-auto">
        <div className="bg-white border border-[#e2e8f0] rounded-2xl text-center py-12">
          <h2 className="text-xl font-semibold text-[#131b2e] mb-2">{error || 'Room not found'}</h2>
          <p className="text-sm text-[#434655] mb-4">The room you're looking for doesn't exist.</p>
          <Link href="/dashboard">
            <Button variant="secondary">Back to Dashboard</Button>
          </Link>
        </div>
      </div>
    );
  }

  const { room, watchedUrls, latestScan, changes } = data;
  const stats = [
    { label: 'Total URLs', value: watchedUrls.length, icon: Globe },
    { label: 'Monitored Changes', value: changes.length, icon: AlertTriangle },
    {
      label: 'Last Scan',
      value: latestScan?.completedAt
        ? new Date(latestScan.completedAt).toLocaleDateString()
        : 'Never',
      icon: Calendar,
    },
    {
      label: 'Health',
      value: latestScan?.status === 'completed' ? 'Good' : latestScan?.status === 'running' ? 'Scanning...' : 'Pending',
      icon: CheckCircle,
    },
  ];

  return (
    <div className="max-w-[1600px] mx-auto bg-[#f8fafc] min-h-screen p-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-[#434655] mb-6">
        <Link href="/dashboard" className="hover:text-[#2563eb]">Dashboard</Link>
        <ChevronRight className="w-4 h-4" />
        <span className="text-[#131b2e] font-medium">{room.name}</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-xl bg-[#2563eb] flex items-center justify-center text-white text-2xl font-bold">
            {room.name.charAt(0)}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#131b2e]">{room.name}</h1>
            <div className="flex items-center gap-3 mt-2">
              <span className="text-sm text-[#434655] font-mono">{room.targetName}</span>
              <span className="text-sm text-[#434655]">•</span>
              <span className="text-sm text-[#434655]">
                Last scanned: {latestScan?.completedAt ? new Date(latestScan.completedAt).toLocaleDateString() : 'Never'}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {room.boxFolderId && (
            <a
              href={`https://app.box.com/folder/${room.boxFolderId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 bg-white border border-[#e2e8f0] text-[#131b2e] text-sm font-medium rounded-lg hover:bg-[#f8fafc] transition-colors"
            >
              <Box className="w-4 h-4" />
              Open in Box
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
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
            {watchedUrls.length === 0 ? (
              <p className="text-sm text-[#434655]">No URLs added yet.</p>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#e2e8f0]">
                    <th className="pb-3 text-left text-xs font-medium text-[#434655] uppercase tracking-wider">URL</th>
                    <th className="pb-3 text-left text-xs font-medium text-[#434655] uppercase tracking-wider">Page Type</th>
                    <th className="pb-3 text-left text-xs font-medium text-[#434655] uppercase tracking-wider">Added</th>
                  </tr>
                </thead>
                <tbody>
                  {watchedUrls.map((url) => (
                    <tr key={url.id} className="border-b border-[#e2e8f0] last:border-0 hover:bg-[#f8fafc] transition-colors">
                      <td className="py-4">
                        <div className="flex flex-col gap-1">
                          <span className="text-sm text-[#131b2e] font-medium">{url.label || 'Unnamed'}</span>
                          <span className="text-xs text-[#434655] font-mono truncate max-w-[300px]">{url.url}</span>
                        </div>
                      </td>
                      <td className="py-4 text-sm text-[#434655] capitalize">{url.pageType}</td>
                      <td className="py-4 text-sm text-[#434655]">
                        {new Date(url.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right: Recent Changes */}
        <div className="col-span-5">
          <div className="bg-white border border-[#e2e8f0] rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-[#131b2e] mb-4">Recent Changes</h2>
            <div className="space-y-4">
              {changes.map((change) => (
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
              {changes.length === 0 && (
                <p className="text-sm text-[#434655]">No changes detected yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}