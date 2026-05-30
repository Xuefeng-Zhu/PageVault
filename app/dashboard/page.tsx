'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Activity, Calendar, TrendingUp, LayoutDashboard, Globe, GitCompare, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { RoomWithStats } from '@/types';

interface Stats {
  totalRooms: number;
  activeUrls: number;
  changesDetected: number;
}

const defaultStats: Stats = { totalRooms: 0, activeUrls: 0, changesDetected: 0 };

export default function DashboardPage() {
  const [rooms, setRooms] = useState<RoomWithStats[]>([]);
  const [stats, setStats] = useState<Stats>(defaultStats);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchRooms() {
      try {
        const res = await fetch('/api/rooms', { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to fetch rooms');
        const data: RoomWithStats[] = await res.json();
        setRooms(data);
        setStats({
          totalRooms: data.length,
          activeUrls: data.reduce((sum, r) => {
            // Approximate active URLs from the room list; rooms don't expose urlCount
            return sum + 1; // fallback; real data would have a urlCount field
          }, 0),
          changesDetected: data.reduce((sum, r) => sum + r.highCount + r.mediumCount, 0),
        });
      } catch (err) {
        console.error('Dashboard fetch error:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchRooms();
  }, []);

  const recentActivity = [
    { id: '1', action: 'Scan completed', room: 'Cloud Infrastructure Monitor', time: '2 hours ago' },
    { id: '2', action: 'High severity change detected', room: 'Automation Tools Tracker', time: '5 hours ago' },
    { id: '3', action: 'Report generated', room: 'Enterprise SaaS Watch', time: '1 day ago' },
  ];

  const statsList = [
    { label: 'Total Rooms', value: stats.totalRooms, icon: LayoutDashboard, trend: 'Demo mode' },
    { label: 'Active URLs', value: stats.activeUrls, icon: Globe, trend: '3 sites tracked' },
    { label: 'Changes Detected', value: stats.changesDetected, icon: GitCompare, trend: '+3 this week' },
    { label: 'AI Insights', value: stats.changesDetected, icon: Sparkles, trend: 'Generated' },
  ];

  return (
    <div className="max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[#131b2e]">Memory Rooms</h1>
          <p className="text-sm text-[#434655] mt-1">Monitor your targets and track changes</p>
        </div>
        <Link href="/dashboard/rooms/new">
          <Button>
            <Plus className="w-4 h-4 mr-2" />
            New Memory Room
          </Button>
        </Link>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-6 mb-8">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-white border border-[#e2e8f0] rounded-2xl p-5 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-1/2 mb-3" />
                <div className="h-8 bg-gray-200 rounded w-1/3" />
              </div>
            ))
          : statsList.map((stat) => (
              <div key={stat.label} className="bg-white border border-[#e2e8f0] rounded-2xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium text-[#434655] uppercase tracking-wider">{stat.label}</span>
                  <stat.icon className="w-4 h-4 text-[#2563eb]" />
                </div>
                <div className="flex items-end justify-between">
                  <span className="text-3xl font-bold text-[#131b2e]">{stat.value}</span>
                  <span className="text-xs text-[#10b981] font-medium">{stat.trend}</span>
                </div>
              </div>
            ))}
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Main content */}
        <div className="col-span-9 space-y-6">
          {/* Section header */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[#131b2e]">Recent Memory Rooms</h2>
          </div>

          {/* Rooms table */}
          <div className="bg-white border border-[#e2e8f0] rounded-2xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#e2e8f0] bg-[#f8fafc]">
                  <th className="px-6 py-4 text-left text-xs font-medium text-[#434655] uppercase tracking-wider">Room Name</th>
                  <th className="px-6 py-4 text-left text-xs font-medium text-[#434655] uppercase tracking-wider">Monitored URLs</th>
                  <th className="px-6 py-4 text-left text-xs font-medium text-[#434655] uppercase tracking-wider">Last Scanned</th>
                  <th className="px-6 py-4 text-left text-xs font-medium text-[#434655] uppercase tracking-wider">Changes</th>
                  <th className="px-6 py-4 text-left text-xs font-medium text-[#434655] uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody>
                {loading
                  ? Array.from({ length: 3 }).map((_, i) => (
                      <tr key={i} className="border-b border-[#e2e8f0]">
                        <td className="px-6 py-4"><div className="h-4 bg-gray-200 rounded w-32" /></td>
                        <td className="px-6 py-4"><div className="h-4 bg-gray-200 rounded w-8" /></td>
                        <td className="px-6 py-4"><div className="h-4 bg-gray-200 rounded w-24" /></td>
                        <td className="px-6 py-4"><div className="h-4 bg-gray-200 rounded w-8" /></td>
                        <td className="px-6 py-4"><div className="h-4 bg-gray-200 rounded w-16" /></td>
                      </tr>
                    ))
                  : rooms.map((room) => (
                      <tr key={room.id} className="border-b border-[#e2e8f0] last:border-0 hover:bg-[#f8fafc] transition-colors">
                        <td className="px-6 py-4">
                          <Link href={`/dashboard/rooms/${room.id}`} className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-[#2563eb] flex items-center justify-center text-white font-bold text-sm">
                              {room.name.charAt(0)}
                            </div>
                            <div>
                              <div className="font-medium text-[#131b2e] text-sm">{room.name}</div>
                              <div className="text-xs text-[#434655] font-mono">{room.targetName}</div>
                            </div>
                          </Link>
                        </td>
                        <td className="px-6 py-4 text-sm text-[#434655]">—</td>
                        <td className="px-6 py-4 text-sm text-[#434655]">
                          {room.lastScanAt ? new Date(room.lastScanAt).toLocaleDateString() : 'Never'}
                        </td>
                        <td className="px-6 py-4 text-sm text-[#434655]">
                          {room.highCount + room.mediumCount}
                        </td>
                        <td className="px-6 py-4">
                          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-[#64748b]">
                            <span className="w-2 h-2 rounded-full bg-[#64748b]" />
                            Active
                          </span>
                        </td>
                      </tr>
                    ))}
                {!loading && rooms.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-sm text-[#434655]">
                      No rooms found. <Link href="/dashboard/rooms/new" className="text-[#2563eb] underline">Create one</Link>.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right sidebar */}
        <div className="col-span-3 space-y-6">
          {/* Recent Activity */}
          <div className="bg-white border border-[#e2e8f0] p-5 rounded-2xl">
            <h3 className="text-base font-semibold text-[#131b2e] mb-4 flex items-center gap-2">
              <Activity className="w-4 h-4 text-[#434655]" />
              Recent Activity
            </h3>
            <div className="space-y-4">
              {recentActivity.map((activity) => (
                <div key={activity.id} className="flex items-start gap-3 pb-4 border-b border-[#e2e8f0] last:border-0 last:pb-0">
                  <div className="w-2 h-2 rounded-full bg-[#2563eb] mt-1.5" />
                  <div>
                    <p className="text-sm font-medium text-[#131b2e]">{activity.action}</p>
                    <p className="text-xs text-[#434655]">{activity.room}</p>
                    <p className="text-xs text-[#434655] mt-1">{activity.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Upcoming Scans */}
          <div className="bg-white border border-[#e2e8f0] p-5 rounded-2xl">
            <h3 className="text-base font-semibold text-[#131b2e] mb-4 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-[#434655]" />
              Upcoming Scans
            </h3>
            <div className="space-y-3">
              {[
                { name: 'Cloud Infrastructure Monitor', time: 'In 2 hours' },
                { name: 'Automation Tools Tracker', time: 'Tomorrow' },
                { name: 'Enterprise SaaS Watch', time: 'Paused' },
              ].map((scan) => (
                <div key={scan.name} className="flex items-center justify-between py-2">
                  <span className="text-sm text-[#131b2e]">{scan.name}</span>
                  <span className="text-xs text-[#434655]">{scan.time}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Change Areas */}
          <div className="bg-white border border-[#e2e8f0] p-5 rounded-2xl">
            <h3 className="text-base font-semibold text-[#131b2e] mb-4 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-[#434655]" />
              Change Areas
            </h3>
            <div className="space-y-4">
              {[
                { label: 'Pricing', count: 2, percentage: 67 },
                { label: 'Feature', count: 1, percentage: 33 },
                { label: 'Security', count: 0, percentage: 0 },
              ].map((area) => (
                <div key={area.label}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-[#131b2e]">{area.label}</span>
                    <span className="text-xs text-[#434655]">{area.count}</span>
                  </div>
                  <div className="h-2 bg-[#f2f3ff] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#2563eb] rounded-full"
                      style={{ width: `${area.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}