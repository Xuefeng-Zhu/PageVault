'use client';
import { useEffect, useState } from 'react';
import { Calendar, Edit2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

export type SchedulePreset = { label: string; cron: string };
const PRESETS: SchedulePreset[] = [
  { label: 'Off', cron: '' },
  { label: 'Hourly', cron: '0 * * * *' },
  { label: 'Every 6 hours', cron: '0 */6 * * *' },
  { label: 'Daily (3am)', cron: '0 3 * * *' },
  { label: 'Weekly (Sun midnight)', cron: '0 0 * * 0' },
];

export function SchedulePicker({
  roomId,
  currentCron,
  onChange,
}: {
  roomId: string;
  currentCron: string | null;
  onChange: (cron: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [custom, setCustom] = useState(currentCron ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Sync the local custom input when the parent's currentCron prop
  // resolves after first render. Without this, opening the custom
  // editor on a room that already has a custom cron would show a
  // blank field because the useState initializer only ran with
  // currentCron === null. Use a separate tracking value so we only
  // re-sync when the prop itself changes (not when the user is
  // mid-edit and has a different local value).
  const [lastSeenCron, setLastSeenCron] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (lastSeenCron !== currentCron) {
      setCustom(currentCron ?? '');
      setLastSeenCron(currentCron);
    }
  }, [currentCron, lastSeenCron]);
  const currentLabel = PRESETS.find((p) => p.cron === currentCron)?.label
    ?? (currentCron ? `Custom (${currentCron})` : 'Off');

  async function save(cron: string | null) {
    setSaving(true);
    setError(null);
    try {
      if (cron === null || cron === '') {
        const res = await fetch(`/api/rooms/${roomId}/schedule`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`DELETE failed: ${res.status}`);
      } else {
        const res = await fetch(`/api/rooms/${roomId}/schedule`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ cronExpression: cron, enabled: true }),
        });
        if (!res.ok) throw new Error(`POST failed: ${res.status}`);
      }
      onChange(cron);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Calendar className="w-4 h-4 text-ink-3" aria-hidden="true" />
      <span className="font-mono text-mono-sm text-ink-3 uppercase tracking-archive">Schedule:</span>
      <select
        className="bg-surface-raised border border-rule px-2 py-1 font-mono text-mono-sm"
        value={currentLabel}
        onChange={(e) => {
          const sel = PRESETS.find((p) => p.label === e.target.value);
          if (sel) {
            if (sel.label === 'Off') save(null);
            else save(sel.cron);
          }
        }}
        disabled={saving}
        aria-label="Schedule preset"
      >
        {PRESETS.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
        {currentCron && !PRESETS.find((p) => p.cron === currentCron) && (
          <option value={`Custom (${currentCron})`}>Custom ({currentCron})</option>
        )}
      </select>
      <button
        onClick={() => setEditing(!editing)}
        className="p-1 hover:text-ink-2"
        aria-label="Edit custom cron"
      >
        <Edit2 className="w-3 h-3" aria-hidden="true" />
      </button>
      {editing && (
        <Card padding="sm" className="absolute z-10 mt-12 p-3 flex flex-col gap-2 w-72">
          <input
            className="bg-surface border border-rule px-2 py-1 font-mono text-mono-sm"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="0 3 * * *"
            aria-label="Custom cron expression"
          />
          {error && (
            <div className="font-mono text-mono-sm text-ember">{error}</div>
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={() => save(custom)} disabled={saving || !custom.trim()}>
              Save
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
