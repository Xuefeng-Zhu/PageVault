'use client';
import { useState } from 'react';
import { Bell, Trash2, Send, AlertCircle, Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

export interface NotificationSubscriptionView {
  id: string;
  channel: string;
  config: { url: string; secret?: string };
  severityThreshold: string;
  enabled: boolean;
  consecutiveFailures: number;
  lastTriggeredAt: string | null;
  lastFailureAt: string | null;
  lastFailureError: string | null;
}

export function NotificationList({
  roomId,
  subscriptions,
  onChange,
}: {
  roomId: string;
  subscriptions: NotificationSubscriptionView[];
  onChange: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ url: '', secret: '', threshold: 'medium' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; msg: string } | null>(null);

  async function save() {
    if (!form.url) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/rooms/${roomId}/notifications`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          channel: 'webhook',
          config: { url: form.url, ...(form.secret ? { secret: form.secret } : {}) },
          severityThreshold: form.threshold,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message || `HTTP ${res.status}`);
      }
      setAdding(false);
      setForm({ url: '', secret: '', threshold: 'medium' });
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function del(id: string) {
    if (!confirm('Delete this notification?')) return;
    await fetch(`/api/rooms/${roomId}/notifications/${id}`, { method: 'DELETE' });
    onChange();
  }

  async function test(id: string) {
    setTestResult({ id, ok: false, msg: 'Sending…' });
    const res = await fetch(`/api/rooms/${roomId}/notifications/${id}/test`, { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      setTestResult({ id, ok: data.ok, msg: data.error ?? 'OK' });
    } else {
      const data = await res.json().catch(() => ({}));
      setTestResult({ id, ok: false, msg: data.error ?? `HTTP ${res.status}` });
    }
  }

  return (
    <section>
      <h2 className="font-display text-display-md text-ink mb-3">Notifications</h2>
      {subscriptions.length === 0 && !adding && (
        <p className="text-ink-3">No notifications configured. Add a webhook to be alerted on detected changes.</p>
      )}
      <div className="space-y-3">
        {subscriptions.map((s) => (
          <Card key={s.id} padding="md" className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <Bell className="w-4 h-4" aria-hidden="true" />
                <span className="font-mono text-mono-sm uppercase">{s.channel}</span>
                {s.consecutiveFailures >= 10 && (
                  <span className="font-mono text-mono-sm text-ember" role="status">
                    Auto-disabled
                  </span>
                )}
                {!s.enabled && s.consecutiveFailures < 10 && (
                  <span className="font-mono text-mono-sm text-ink-3">Disabled</span>
                )}
              </div>
              <div className="font-mono text-mono-sm text-ink-2 break-all">{s.config.url}</div>
              <div className="font-mono text-mono-sm text-ink-3 mt-1">
                Threshold: {s.severityThreshold} · Last sent:{' '}
                {s.lastTriggeredAt ? new Date(s.lastTriggeredAt).toLocaleString() : 'never'}
              </div>
              {s.lastFailureError && (
                <div className="font-mono text-mono-sm text-ember mt-1 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" aria-hidden="true" /> {s.lastFailureError}
                </div>
              )}
              {testResult?.id === s.id && (
                <div className="font-mono text-mono-sm mt-1" role="status">
                  Test: {testResult.ok ? '✅' : '❌'} {testResult.msg}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => test(s.id)}
                className="p-2 hover:text-ink-2"
                title="Send a test payload"
                aria-label="Send test payload"
              >
                <Send className="w-4 h-4" aria-hidden="true" />
              </button>
              <button
                onClick={() => del(s.id)}
                className="p-2 hover:text-ember"
                title="Delete this notification"
                aria-label="Delete notification"
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </Card>
        ))}
      </div>
      {adding && (
        <Card padding="md" className="mt-3 space-y-2">
          <input
            className="w-full bg-surface border border-rule px-2 py-1 font-mono text-mono-sm"
            placeholder="https://hooks.slack.com/..."
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
            aria-label="Webhook URL"
          />
          <input
            className="w-full bg-surface border border-rule px-2 py-1 font-mono text-mono-sm"
            placeholder="Optional HMAC secret"
            value={form.secret}
            onChange={(e) => setForm({ ...form, secret: e.target.value })}
            aria-label="Webhook HMAC secret (optional)"
          />
          <select
            className="bg-surface-raised border border-rule px-2 py-1 font-mono text-mono-sm"
            value={form.threshold}
            onChange={(e) => setForm({ ...form, threshold: e.target.value })}
            aria-label="Severity threshold"
          >
            <option value="low">Threshold: Low</option>
            <option value="medium">Threshold: Medium</option>
            <option value="high">Threshold: High</option>
          </select>
          {error && (
            <div className="font-mono text-mono-sm text-ember" role="alert">
              {error}
            </div>
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={submitting || !form.url.trim()}>
              Save
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}
      {!adding && (
        <Button size="sm" variant="secondary" onClick={() => setAdding(true)} className="mt-3">
          <Plus className="w-3 h-3 mr-1" aria-hidden="true" /> Add notification
        </Button>
      )}
    </section>
  );
}
