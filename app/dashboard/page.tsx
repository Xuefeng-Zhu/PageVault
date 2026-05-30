'use client';

import Link from 'next/link';
import { Plus, Activity, Calendar, TrendingUp, LayoutDashboard, Globe, GitCompare, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';

const demoRooms = [
  { id: 'room-1', name: 'DemoCo Website', targetName: 'demo.co', urls: 12, lastScanAt: '2024-05-22T10:30:00Z', changes: 17, status: 'Active' },
  { id: 'room-2', name: 'Acme AI', targetName: 'acme.ai', urls: 8, lastScanAt: '2024-05-21T14:20:00Z', changes: 8, status: 'Active' },
  { id: 'room-3', name: 'VendorWatch', targetName: 'vendorwatch.io', urls: 15, lastScanAt: '2024-05-20T09:15:00Z', changes: 12, status: 'Paused' },
  { id: 'room-4', name: 'Policy Monitor', targetName: 'govtracker.gov', urls: 6, lastScanAt: '2024-05-19T16:45:00Z', changes: 7, status: 'Active' },
];

const recentActivity = [
  { id: '1', action: 'Scan completed', room: 'DemoCo Website', time: '5 min ago' },
  { id: '2', action: 'New change detected', room: 'Acme AI', time: '2 hours ago' },
  { id: '3', action: 'Report generated', room: 'VendorWatch', time: '4 hours ago' },
  { id: '4', action: 'Alert sent', room: 'Policy Monitor', time: '6 hours ago' },
];

const stats = [
  { label: 'Total Rooms', value: 12, icon: LayoutDashboard, trend: '+2 this month' },
  { label: 'Active URLs', value: 347, icon: Globe, trend: '+28 this week' },
  { label: 'Changes Detected', value: 89, icon: GitCompare, trend: '+12 today' },
  { label: 'AI Insights', value: 156, icon: Sparkles, trend: '+8 this week' },
];

export default function DashboardPage() {
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
        {stats.map((stat) => (
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
                {demoRooms.map((room) => (
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
                    <td className="px-6 py-4 text-sm text-[#434655]">{room.urls}</td>
                    <td className="px-6 py-4 text-sm text-[#434655]">
                      {new Date(room.lastScanAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-sm text-[#434655]">{room.changes}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${
                        room.status === 'Active' ? 'text-[#10b981]' : 'text-[#64748b]'
                      }`}>
                        <span className={`w-2 h-2 rounded-full ${room.status === 'Active' ? 'bg-[#10b981]' : 'bg-[#64748b]'}`} />
                        {room.status}
                      </span>
                    </td>
                  </tr>
                ))}
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
                { name: 'DemoCo Website', time: 'In 2 hours' },
                { name: 'Acme AI', time: 'Tomorrow' },
                { name: 'VendorWatch', time: 'Tomorrow' },
                { name: 'Policy Monitor', time: 'In 3 days' },
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
                { label: 'Pricing', count: 89, percentage: 38 },
                { label: 'Positioning', count: 56, percentage: 24 },
                { label: 'Features', count: 45, percentage: 19 },
                { label: 'Hiring', count: 34, percentage: 14 },
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
