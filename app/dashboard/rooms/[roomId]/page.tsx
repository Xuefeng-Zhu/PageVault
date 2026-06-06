'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ChevronRight,
  ExternalLink,
  Database,
  Globe,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  ArrowUpRight,
  Radar,
  Clock,
} from 'lucide-react';
import { SeverityBadge } from '@/components/dashboard/SeverityBadge';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { SectionHeader, EmptyState, Spinner, Progress } from '@/components/ui/Primitives';
import { StatCard } from '@/components/dashboard/StatCard';
import { SchedulePicker } from '@/components/dashboard/SchedulePicker';
import { NotificationList, type NotificationSubscriptionView } from '@/components/dashboard/NotificationList';
import type { RoomDetailResponse, WatchedUrl, ChangeAnalysis } from '@/types';

export default function RoomDetailPage() {
  const params = useParams();
  const roomId = params.roomId as string;
  const [data, setData] = useState<RoomDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scheduleCron, setScheduleCron] = useState<string | null>(null);
  const [subscriptions, setSubscriptions] = useState<NotificationSubscriptionView[]>([]);

  const refetchSchedule = async () => {
    const r = await fetch(`/api/rooms/${roomId}/schedule`, { cache: 'no-store' });
    if (r.ok) {
      const d = await r.json();
      setScheduleCron(d.schedule?.cronExpression ?? null);
    } else {
      setScheduleCron(null);
    }
  };

  const refetchSubscriptions = async () => {
    const r = await fetch(`/api/rooms/${roomId}/notifications`, { cache: 'no-store' });
    if (r.ok) {
      const d = await r.json();
      setSubscriptions(d.subscriptions ?? []);
    } else {
      setSubscriptions([]);
    }
  };

  useEffect(() => {
    async function fetchRoom() {
      try {
        const res = await fetch(`/api/rooms/${roomId}`, { cache: 'no-store' });
        if (!res.ok) {
          if (res.status === 404) {
            setError('Room not found in the archive.');
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
    refetchSchedule();
    refetchSubscriptions();
  }, [roomId]);

  const handleRunScan = async () => {
    setScanning(true);
    try {
      const res = await fetch(`/api/rooms/${roomId}/scan`, { method: 'POST', cache: 'no-store' });
      if (!res.ok) throw new Error('Scan failed');
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
      <div className="space-y-8 fade-up-1">
        <div className="h-4 w-48 bg-rule animate-pulse" />
        <div className="h-12 w-1/2 bg-rule animate-pulse" />
        <div className="grid grid-cols-4 gap-px bg-rule border border-rule">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-surface-raised h-32 flex items-center justify-center">
              <Spinner size="sm" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-2xl mx-auto pt-20">
        <Card padding="xl">
          <div className="text-center">
            <div className="w-12 h-12 border border-ember mx-auto mb-5 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-ember" strokeWidth={1.5} />
            </div>
            <h2 className="font-display text-display-md text-ink mb-2">{error || 'Room not found'}</h2>
            <p className="font-body text-body-md text-ink-2 mb-6">
              The filing you&apos;re looking for isn&apos;t in the archive. It may have been sealed or never opened.
            </p>
            <Link href="/dashboard">
              <Button variant="secondary">← Back to overview</Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  const { room, watchedUrls, latestScan, changes } = data;

  const highCount = changes.filter((c) => c.severity === 'high').length;
  const mediumCount = changes.filter((c) => c.severity === 'medium').length;
  const lowCount = changes.filter((c) => c.severity === 'low').length;

  const stats = [
    { label: 'URLs watched', value: watchedUrls.length, icon: Globe },
    { label: 'Changes', value: changes.length, icon: AlertTriangle },
    {
      label: 'Last scan',
      value: latestScan?.completedAt
        ? new Date(latestScan.completedAt).toLocaleDateString('en-US', { month: 'short', day: '2-digit' })
        : '—',
      icon: Calendar,
    },
    {
      label: 'Health',
      value: latestScan?.status === 'completed' ? 'Nominal' : latestScan?.status === 'running' ? 'Scanning' : 'Pending',
      icon: CheckCircle2,
    },
  ];

  return (
    <div className="space-y-10 fade-up-1">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 font-mono text-mono-sm text-ink-3 uppercase tracking-archive">
        <Link href="/dashboard" className="hover:text-ink transition-colors">Overview</Link>
        <ChevronRight className="w-3 h-3" />
        <span className="text-ink">Rooms</span>
        <ChevronRight className="w-3 h-3" />
        <span className="text-ink truncate max-w-[260px]">{room.name}</span>
      </nav>

      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-6 pb-6 border-b border-rule">
        <div className="flex items-start gap-5 min-w-0">
          <div className="relative w-14 h-14 flex items-center justify-center shrink-0">
            <div className="absolute inset-0 border border-ink" />
            <div className="absolute inset-1.5 bg-ink" />
            <span className="relative font-display text-[1.5rem] text-paper">
              {room.name.charAt(0)}
            </span>
          </div>
          <div className="min-w-0">
            <div className="section-label mb-2">
              <span>Room · {room.id.slice(0, 8)}</span>
              <span className="ml-auto">Live</span>
            </div>
            <h1 className="font-display text-display-lg text-ink leading-[1.05] truncate">
              {room.name}
            </h1>
            <p className="font-mono text-mono-sm text-ink-3 mt-2 truncate">
              {room.targetName}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {room.storageFolderPath && (
            <a
              href={`/api/storage/folder/${encodeURIComponent(room.storageFolderPath)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="secondary" icon={<Database className="w-4 h-4" />} iconRight={<ExternalLink className="w-3 h-3" />}>
                Open in Box
              </Button>
            </a>
          )}
          <Button onClick={handleRunScan} loading={scanning} icon={scanning ? undefined : <Radar className="w-4 h-4" />}>
            {scanning ? 'Scanning…' : 'Run scan'}
          </Button>
        </div>
      </header>

      {/* Schedule picker (per-room scan cron) */}
      <section>
        <SchedulePicker
          roomId={roomId}
          currentCron={scheduleCron}
          onChange={refetchSchedule}
        />
      </section>

      {/* Stats */}
      <section>
        <SectionHeader
          number="I"
          label="Vital signs"
          meta={`As of ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`}
          className="mb-5"
        />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-rule border border-rule">
          {stats.map((s) => (
            <div key={s.label} className="bg-surface-raised">
              <StatCard label={s.label} value={s.value} icon={s.icon} />
            </div>
          ))}
        </div>
      </section>

      {/* Severity mix bar */}
      {changes.length > 0 && (
        <section>
          <SectionHeader number="II" label="Severity mix" meta={`${changes.length} total`} className="mb-5" />
          <div className="border border-rule bg-surface-raised p-5">
            <div className="flex items-stretch h-2 mb-3 gap-px">
              <div className="bg-ember-bright" style={{ flex: highCount || 0.001 }} />
              <div className="bg-signal-bright" style={{ flex: mediumCount || 0.001 }} />
              <div className="bg-ink-3" style={{ flex: lowCount || 0.001 }} />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <div className="font-mono text-mono-sm text-ink-3 uppercase tracking-archive">Critical</div>
                <div className="font-display text-display-sm text-ink tabular">{highCount}</div>
              </div>
              <div>
                <div className="font-mono text-mono-sm text-ink-3 uppercase tracking-archive">Notable</div>
                <div className="font-display text-display-sm text-ink tabular">{mediumCount}</div>
              </div>
              <div>
                <div className="font-mono text-mono-sm text-ink-3 uppercase tracking-archive">Minor</div>
                <div className="font-display text-display-sm text-ink tabular">{lowCount}</div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Two-column: URLs + changes */}
      <div className="grid grid-cols-12 gap-8">
        {/* Watched URLs */}
        <section className="col-span-12 lg:col-span-7">
          <SectionHeader
            number="III"
            label="Subjects under observation"
            meta={`${watchedUrls.length} URLs`}
            className="mb-5"
          />
          <div className="border border-rule bg-surface-raised">
            {watchedUrls.length === 0 ? (
              <EmptyState
                icon={<Globe className="w-5 h-5" strokeWidth={1.5} />}
                title="No URLs filed"
                description="Add URLs to start watching. Each one becomes a separate filing in this room."
              />
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-rule bg-paper-2">
                    <th className="px-5 py-3 text-left font-mono text-mono-sm text-ink-3 uppercase tracking-archive">
                      URL
                    </th>
                    <th className="px-5 py-3 text-left font-mono text-mono-sm text-ink-3 uppercase tracking-archive">
                      Type
                    </th>
                    <th className="px-5 py-3 text-left font-mono text-mono-sm text-ink-3 uppercase tracking-archive">
                      Filed
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {watchedUrls.map((url) => (
                    <tr key={url.id} className="group border-b border-rule last:border-0 hover:bg-paper-2 transition-colors">
                      <td className="px-5 py-4">
                        <div className="flex flex-col gap-1">
                          <span className="font-body text-body-md text-ink">
                            {url.label || 'Unnamed'}
                          </span>
                          <span className="font-mono text-mono-sm text-ink-3 truncate max-w-[300px]">
                            {url.url}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <Badge variant="paper" size="sm">{url.pageType}</Badge>
                      </td>
                      <td className="px-5 py-4 font-mono text-mono-sm text-ink-3 tabular">
                        {new Date(url.createdAt).toLocaleDateString('en-US', { month: 'short', day: '2-digit' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* Recent changes */}
        <section className="col-span-12 lg:col-span-5">
          <SectionHeader
            number="IV"
            label="Recent changes"
            meta={`${changes.length} filed`}
            className="mb-5"
          />
          {changes.length === 0 ? (
            <div className="border border-rule bg-surface-raised">
              <EmptyState
                icon={<Clock className="w-5 h-5" strokeWidth={1.5} />}
                title="No changes detected yet"
                description="When something moves on a watched URL, the diff lands here with an AI interpretation."
              />
            </div>
          ) : (
            <div className="border border-rule bg-surface-raised">
              {changes.map((change, i) => (
                <Link
                  key={change.id}
                  href={`/dashboard/changes/${change.id}`}
                  className={[
                    'block p-5 hover:bg-paper-2 transition-colors group',
                    i < changes.length - 1 ? 'border-b border-rule' : '',
                  ].join(' ')}
                >
                  <div className="flex items-start gap-4">
                    <div className="text-right shrink-0">
                      <div className="font-mono text-mono-sm text-ink-2 tabular">
                        {new Date(change.createdAt).toLocaleDateString('en-US', { month: 'short', day: '2-digit' })}
                      </div>
                      <div className="font-mono text-mono-sm text-ink-4 tabular mt-0.5">
                        {new Date(change.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <SeverityBadge severity={change.severity} />
                      </div>
                      <p className="font-body text-body-md text-ink leading-snug line-clamp-2 group-hover:text-ink-2 transition-colors">
                        {change.summary}
                      </p>
                    </div>
                    <ArrowUpRight className="w-4 h-4 text-ink-3 group-hover:text-ink group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-all shrink-0" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
        </div>

        {/* Notifications */}
        <section>
        <NotificationList
         roomId={roomId}
         subscriptions={subscriptions}
         onChange={refetchSubscriptions}
        />
        </section>
        </div>
        );
        }
