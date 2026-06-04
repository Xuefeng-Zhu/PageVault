'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Plus,
  Activity,
  Calendar,
  TrendingUp,
  LayoutDashboard,
  Globe,
  GitCompare,
  Sparkles,
  ArrowUpRight,
  Radar,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { SectionHeader, Progress, Spinner, EmptyState } from '@/components/ui/Primitives';
import { StatCard } from '@/components/dashboard/StatCard';
import { SeverityBadge } from '@/components/dashboard/SeverityBadge';
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
          activeUrls: data.reduce((sum) => sum + 1, 0),
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
    { id: '1', action: 'Scan completed', room: 'Cloud Infrastructure Monitor', time: '2 hours ago', code: 'A-01' },
    { id: '2', action: 'Critical change detected', room: 'Automation Tools Tracker', time: '5 hours ago', code: 'A-02', severity: 'high' as const },
    { id: '3', action: 'Report generated', room: 'Enterprise SaaS Watch', time: '1 day ago', code: 'A-03' },
  ];

  const statsList = [
    { label: 'Rooms', value: stats.totalRooms, icon: LayoutDashboard, trend: 'neutral' as const, trendValue: 'Demo', caption: 'tracked' },
    { label: 'URLs watched', value: stats.activeUrls, icon: Globe, trend: 'up' as const, trendValue: '3 new', caption: 'last 7d' },
    { label: 'Changes', value: stats.changesDetected, icon: GitCompare, trend: 'up' as const, trendValue: '+3', caption: 'this week' },
    { label: 'AI briefs', value: stats.changesDetected, icon: Sparkles, trend: 'neutral' as const, trendValue: 'auto', caption: 'generated' },
  ];

  return (
    <div className="space-y-12 fade-up-1">
      {/* === Page header === */}
      <header className="flex flex-wrap items-end justify-between gap-6 pb-6 border-b border-rule">
        <div>
          <div className="section-label mb-3">
            <span>Overview</span>
            <span className="ml-auto">I / IV</span>
          </div>
          <h1 className="font-display text-display-xl text-ink leading-[1.0] tracking-[-0.025em]">
            Good morning.<br />
            <span className="italic text-ink-2">3 items need your eye today.</span>
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/dashboard/rooms/new">
            <Button size="md" icon={<Plus className="w-4 h-4" />}>
              New room
            </Button>
          </Link>
        </div>
      </header>

      {/* === Stats row === */}
      <section>
        <SectionHeader
          number="I"
          label="Vital signs"
          meta={loading ? 'Computing…' : `As of ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`}
          className="mb-5"
        />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-rule border border-rule">
          {loading
            ? Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-surface-raised p-5 h-[140px] flex items-center justify-center">
                  <Spinner size="sm" />
                </div>
              ))
            : statsList.map((stat) => (
                <div key={stat.label} className="bg-surface-raised">
                  <StatCard
                    label={stat.label}
                    value={stat.value}
                    icon={stat.icon}
                    trend={stat.trend}
                    trendValue={stat.trendValue}
                    caption={stat.caption}
                  />
                </div>
              ))}
        </div>
      </section>

      {/* === Main grid: rooms + sidebar === */}
      <div className="grid grid-cols-12 gap-8">
        {/* Main column */}
        <div className="col-span-12 lg:col-span-8 space-y-8">
          {/* Rooms table */}
          <section>
            <SectionHeader
              number="II"
              label="Memory rooms"
              meta={`${rooms.length} active`}
              action={
                <Link
                  href="/dashboard/rooms/new"
                  className="font-mono text-mono-sm uppercase tracking-archive text-ink-2 hover:text-ink transition-colors inline-flex items-center gap-1.5"
                >
                  View all
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </Link>
              }
              className="mb-5"
            />

            {loading ? (
              <div className="border border-rule bg-surface-raised p-12 flex items-center justify-center">
                <Spinner />
              </div>
            ) : rooms.length === 0 ? (
              <div className="border border-rule bg-surface-raised">
                <EmptyState
                  icon={<Radar className="w-5 h-5" strokeWidth={1.5} />}
                  title="No rooms filed yet"
                  description="Open your first memory room to start watching URLs. PageVault will begin a baseline crawl the moment you save it."
                  action={
                    <Link href="/dashboard/rooms/new">
                      <Button icon={<Plus className="w-4 h-4" />}>Open first room</Button>
                    </Link>
                  }
                />
              </div>
            ) : (
              <div className="border border-rule bg-surface-raised overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-rule bg-paper-2">
                      <th className="px-5 py-3 text-left font-mono text-mono-sm text-ink-3 uppercase tracking-archive">
                        Room
                      </th>
                      <th className="px-5 py-3 text-left font-mono text-mono-sm text-ink-3 uppercase tracking-archive">
                        Last scan
                      </th>
                      <th className="px-5 py-3 text-left font-mono text-mono-sm text-ink-3 uppercase tracking-archive">
                        Changes
                      </th>
                      <th className="px-5 py-3 text-left font-mono text-mono-sm text-ink-3 uppercase tracking-archive">
                        Status
                      </th>
                      <th className="px-5 py-3 w-px"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rooms.map((room) => (
                      <tr
                        key={room.id}
                        className="group border-b border-rule last:border-0 hover:bg-paper-2 transition-colors"
                      >
                        <td className="px-5 py-4">
                          <Link href={`/dashboard/rooms/${room.id}`} className="flex items-center gap-4">
                            <span className="w-9 h-9 flex items-center justify-center bg-ink text-paper font-display text-base">
                              {room.name.charAt(0)}
                            </span>
                            <div className="min-w-0">
                              <div className="font-body text-body-md text-ink truncate font-medium">
                                {room.name}
                              </div>
                              <div className="font-mono text-mono-sm text-ink-3 mt-0.5 truncate">
                                {room.targetName}
                              </div>
                            </div>
                          </Link>
                        </td>
                        <td className="px-5 py-4 font-mono text-mono-sm text-ink-2 tabular">
                          {room.lastScanAt
                            ? new Date(room.lastScanAt).toLocaleDateString('en-US', { month: 'short', day: '2-digit' })
                            : '—'}
                        </td>
                        <td className="px-5 py-4">
                          {room.highCount + room.mediumCount > 0 ? (
                            <div className="flex items-center gap-2">
                              <span className="font-display text-body-md text-ink tabular">
                                {room.highCount + room.mediumCount}
                              </span>
                              {room.highCount > 0 && (
                                <SeverityBadge severity="high" withLabel={false} />
                              )}
                            </div>
                          ) : (
                            <span className="font-mono text-mono-sm text-ink-4">—</span>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          <Badge variant="signal" size="sm" dot>Live</Badge>
                        </td>
                        <td className="px-5 py-4">
                          <Link
                            href={`/dashboard/rooms/${room.id}`}
                            className="inline-flex items-center gap-1.5 font-mono text-mono-sm text-ink-3 group-hover:text-ink transition-colors"
                          >
                            Open
                            <ArrowUpRight className="w-3.5 h-3.5" />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* === Morning brief — labelled editorial section (was: dark card) === */}
          <section>
            <SectionHeader
              number="III"
              label="Morning brief"
              meta="Auto-generated · 02:00 UTC"
              className="mb-5"
            />
            <article className="ai-brief">
              <div className="ai-brief-head">
                <span className="ai-brief-head__index">No. 024</span>
                <h3 className="ai-brief-head__title">
                  Two competitors moved pricing on the same day. One vendor added a new SOC&nbsp;2 disclosure.
                </h3>
                <span className="ai-brief-head__conf">87% confidence</span>
              </div>
              <ol className="ai-brief-list">
                {[
                  {
                    n: '01',
                    title: 'Linear — pricing page',
                    body: 'Team tier +12% YoY. Aligns with their annual list-price cycle. Affects 3 of your watched rooms.',
                    tone: 'high',
                    stamp: 'Critical',
                  },
                  {
                    n: '02',
                    title: 'Notion — pricing page',
                    body: 'Business tier restructured into 3 SKUs. Net effect ~6% increase for mid-band customers.',
                    tone: 'medium',
                    stamp: 'Notable',
                  },
                  {
                    n: '03',
                    title: 'Vercel — security page',
                    body: 'Added SOC 2 Type II report. Material disclosure for vendor diligence workflows.',
                    tone: 'low',
                    stamp: 'Minor',
                  },
                ].map((it) => (
                  <li key={it.n}>
                    <span className="ai-brief-list__n">{it.n}</span>
                    <div className="ai-brief-list__body">
                      <div className="ai-brief-list__title">{it.title}</div>
                      <p className="ai-brief-list__text">{it.body}</p>
                    </div>
                    <div className="ai-brief-list__pill">
                      <span
                        className={
                          it.tone === 'high'
                            ? 'stamp stamp--ember'
                            : it.tone === 'medium'
                            ? 'stamp stamp--ink'
                            : 'stamp stamp--signal'
                        }
                      >
                        {it.stamp}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            </article>
          </section>
        </div>

        {/* Sidebar column */}
        <aside className="col-span-12 lg:col-span-4 space-y-8">
          {/* Activity feed */}
          <section>
            <SectionHeader number="IV" label="Activity" meta="Last 24h" className="mb-5" />
            <div className="border border-rule bg-surface-raised">
              {recentActivity.map((a, i) => (
                <article
                  key={a.id}
                  className={[
                    'p-5 hover:bg-paper-2 transition-colors group',
                    i < recentActivity.length - 1 ? 'border-b border-rule' : '',
                  ].join(' ')}
                >
                  <div className="flex items-start gap-4">
                    <span className="font-mono text-mono-sm text-ink-4 tabular w-7 shrink-0 pt-0.5">
                      {a.code}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-body text-body-md text-ink leading-snug">
                          {a.action}
                        </p>
                        {a.severity && <SeverityBadge severity={a.severity} withLabel={false} />}
                      </div>
                      <p className="font-mono text-mono-sm text-ink-3 truncate">
                        {a.room}
                      </p>
                      <p className="font-mono text-mono-sm text-ink-4 mt-1">{a.time}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>

          {/* Upcoming scans */}
          <section>
            <SectionHeader
              number="V"
              label="Upcoming scans"
              meta="Next 48h"
              className="mb-5"
            />
            <div className="border border-rule bg-surface-raised">
              {[
                { name: 'Cloud Infrastructure', time: 'In 2h', code: 'S-01' },
                { name: 'Automation Tools', time: 'Tomorrow', code: 'S-02' },
                { name: 'Enterprise SaaS', time: 'Paused', code: 'S-03', paused: true },
              ].map((s, i) => (
                <div
                  key={s.name}
                  className={[
                    'flex items-center justify-between px-5 py-3.5 hover:bg-paper-2 transition-colors',
                    i < 2 ? 'border-b border-rule' : '',
                  ].join(' ')}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-mono text-mono-sm text-ink-4 tabular w-8 shrink-0">
                      {s.code}
                    </span>
                    <span className="font-body text-body-md text-ink truncate">{s.name}</span>
                  </div>
                  <span
                    className={[
                      'font-mono text-mono-sm uppercase tracking-archive shrink-0',
                      s.paused ? 'text-ink-4' : 'text-ink-2 tabular',
                    ].join(' ')}
                  >
                    {s.time}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Change areas (dist) */}
          <section>
            <SectionHeader number="VI" label="Change mix" meta="This week" className="mb-5" />
            <div className="border border-rule bg-surface-raised p-5 space-y-4">
              {[
                { label: 'Pricing', count: 2, total: 3, percentage: 67 },
                { label: 'Feature', count: 1, total: 3, percentage: 33 },
                { label: 'Security', count: 0, total: 3, percentage: 0 },
              ].map((area) => (
                <div key={area.label}>
                  <div className="flex items-baseline justify-between mb-1.5">
                    <span className="font-body text-body-md text-ink">{area.label}</span>
                    <span className="font-mono text-mono-sm text-ink-3 tabular">
                      {area.count} / {area.total}
                    </span>
                  </div>
                  <Progress value={area.percentage} tone={area.count > 0 ? 'ink' : 'signal'} />
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
