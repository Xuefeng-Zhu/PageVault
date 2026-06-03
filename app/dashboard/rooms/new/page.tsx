'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { X, Plus, ArrowRight, ArrowLeft, Check } from 'lucide-react';
import { Stepper } from '@/components/dashboard/Stepper';
import { Input, Textarea } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Checkbox, Toggle } from '@/components/ui/Primitives';
import { Card } from '@/components/ui/Card';
import { showToast } from '@/components/ui/Toast';

const steps = [
  { id: 1, label: 'Name & purpose', code: 'I' },
  { id: 2, label: 'Subjects', code: 'II' },
  { id: 3, label: 'Cadence', code: 'III' },
  { id: 4, label: 'Review & open', code: 'IV' },
];

const frequencyOptions = [
  { value: '1', label: 'Every hour — high-signal targets' },
  { value: '6', label: 'Every 6 hours' },
  { value: '24', label: 'Daily at 02:00 UTC' },
  { value: '168', label: 'Weekly — low-signal targets' },
];

const exampleUrls = [
  { domain: 'AWS', baseUrl: 'https://aws.amazon.com', paths: ['/ec2/', '/s3/', '/lambda/'] },
  { domain: 'Apify', baseUrl: 'https://apify.com', paths: ['/pricing', '/storage'] },
  { domain: 'Box', baseUrl: 'https://www.box.com', paths: ['/security', '/integrations'] },
];

export default function NewRoomPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    frequency: '24',
    emailHighSeverity: true,
    emailAllChanges: false,
    slackNotification: false,
    urls: [] as string[],
  });

  const [newUrl, setNewUrl] = useState('');

  const handleInputChange = (field: string, value: string) =>
    setFormData((prev) => ({ ...prev, [field]: value }));

  const handleCheckboxChange = (field: string, checked: boolean) =>
    setFormData((prev) => ({ ...prev, [field]: checked }));

  const handleAddUrl = () => {
    if (newUrl.trim()) {
      setFormData((prev) => ({ ...prev, urls: [...prev.urls, newUrl.trim()] }));
      setNewUrl('');
    }
  };

  const handleRemoveUrl = (index: number) =>
    setFormData((prev) => ({ ...prev, urls: prev.urls.filter((_, i) => i !== index) }));

  const handleAddExample = (url: string) =>
    setFormData((prev) => (prev.urls.includes(url) ? prev : { ...prev, urls: [...prev.urls, url] }));

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const roomRes = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          targetName: formData.name.split(' ')[0].toLowerCase() + '.com',
        }),
      });
      if (!roomRes.ok) {
        const err = await roomRes.json();
        throw new Error(err.error?.message || 'Failed to create room');
      }
      const room = await roomRes.json();
      if (formData.urls.length > 0) {
        await fetch(`/api/rooms/${room.id}/urls`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urls: formData.urls }),
        });
      }
      try {
        await fetch(`/api/rooms/${room.id}/scan`, { method: 'POST' });
      } catch {
        console.warn('Initial scan skipped');
      }
      showToast('Room opened. Initial crawl scheduled.', { type: 'success' });
      router.push('/dashboard');
    } catch (err) {
      console.error('Create room error:', err);
      showToast(err instanceof Error ? err.message : 'Failed to create room', { type: 'error' });
      setLoading(false);
    }
  };

  const canProceed = (step: number) => {
    if (step === 1) return formData.name.trim().length > 0;
    return true;
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8 fade-up-1">
      {/* Header */}
      <header className="pb-6 border-b border-rule">
        <div className="section-label mb-3">
          <span>Open a new room</span>
          <span className="ml-auto">Filed under: Memory</span>
        </div>
        <h1 className="font-display text-display-lg text-ink leading-[1.05]">
          What are you watching?
        </h1>
        <p className="font-body text-body-md text-ink-2 mt-3 max-w-xl">
          A room is a single collection of URLs you want to monitor together. Each room has its
          own cadence, alerts, and AI brief.
        </p>
      </header>

      {/* Stepper */}
      <Card padding="lg" tone="surface">
        <Stepper steps={steps} currentStep={currentStep} />
      </Card>

      {/* Step content */}
      <Card padding="xl" tone="raised" className="min-h-[420px]">
        {/* Step 1 — Name & purpose */}
        {currentStep === 1 && (
          <div className="space-y-7 fade-up-2">
            <div className="section-label">
              <span>Step {String(currentStep).padStart(2, '0')} / 04</span>
              <span className="ml-auto">{steps[currentStep - 1].label}</span>
            </div>
            <Input
              label="Room name"
              placeholder="Cloud Infrastructure Monitor"
              value={formData.name}
              onChange={(e) => handleInputChange('name', e.target.value)}
              required
              hint="Short, scannable, descriptive. Visible in the sidebar."
              labelMeta="01 / 02"
            />
            <Textarea
              label="Why this room exists"
              placeholder="Track AWS service updates and pricing changes. Trigger alerts on anything affecting the Compute or Storage categories."
              value={formData.description}
              onChange={(e) => handleInputChange('description', e.target.value)}
              rows={4}
              hint="Optional. Helps the AI interpret changes with the right context."
              labelMeta="02 / 02"
            />
          </div>
        )}

        {/* Step 2 — Subjects */}
        {currentStep === 2 && (
          <div className="space-y-7 fade-up-2">
            <div className="section-label">
              <span>Step {String(currentStep).padStart(2, '0')} / 04</span>
              <span className="ml-auto">{steps[currentStep - 1].label}</span>
            </div>

            <div>
              <label className="font-mono text-label-md uppercase tracking-archive text-ink-2 mb-1.5 block">
                Add URL
              </label>
              <div className="flex gap-2">
                <Input
                  placeholder="https://aws.amazon.com/lambda/"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddUrl();
                    }
                  }}
                  className="flex-1"
                />
                <Button
                  variant="secondary"
                  onClick={handleAddUrl}
                  icon={<Plus className="w-4 h-4" />}
                >
                  Add
                </Button>
              </div>
              <p className="mt-1.5 font-mono text-mono-sm text-ink-3">
                Press Enter or click Add. One URL per line of context.
              </p>
            </div>

            {/* Filed URLs */}
            {formData.urls.length > 0 && (
              <div className="border border-rule">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-rule bg-paper-2">
                  <span className="font-mono text-mono-sm text-ink-3 uppercase tracking-archive">
                    Filed
                  </span>
                  <span className="font-mono text-mono-sm text-ink-3 tabular">
                    {formData.urls.length} {formData.urls.length === 1 ? 'URL' : 'URLs'}
                  </span>
                </div>
                <ul>
                  {formData.urls.map((url, index) => (
                    <li
                      key={index}
                      className="flex items-center justify-between gap-3 px-4 py-3 border-b border-rule last:border-0 hover:bg-paper-2 transition-colors group"
                    >
                      <span className="font-mono text-mono-sm text-ink truncate">{url}</span>
                      <button
                        onClick={() => handleRemoveUrl(index)}
                        className="text-ink-3 hover:text-ember transition-colors p-1 -mr-1"
                        aria-label="Remove URL"
                      >
                        <X className="w-3.5 h-3.5" strokeWidth={1.75} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Suggestions */}
            <div className="border-t border-rule pt-6">
              <div className="font-mono text-mono-sm text-ink-3 uppercase tracking-archive mb-3">
                Suggestions
              </div>
              <div className="grid sm:grid-cols-3 gap-4">
                {exampleUrls.map((ex) => (
                  <div key={ex.domain} className="border border-rule p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-display text-body-md text-ink">{ex.domain}</span>
                      <span className="font-mono text-mono-sm text-ink-4">{ex.paths.length}</span>
                    </div>
                    <ul className="space-y-1.5">
                      {ex.paths.map((p) => {
                        const full = `${ex.baseUrl}${p}`;
                        const added = formData.urls.includes(full);
                        return (
                          <li key={p} className="flex items-center justify-between gap-2">
                            <span className="font-mono text-mono-sm text-ink-2 truncate">{p}</span>
                            <button
                              onClick={() => handleAddExample(full)}
                              disabled={added}
                              className={[
                                'text-mono-sm font-mono uppercase tracking-archive shrink-0',
                                added ? 'text-signal' : 'text-ink-3 hover:text-ink',
                              ].join(' ')}
                            >
                              {added ? <Check className="w-3.5 h-3.5" /> : '+ Add'}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 3 — Cadence & alerts */}
        {currentStep === 3 && (
          <div className="space-y-7 fade-up-2">
            <div className="section-label">
              <span>Step {String(currentStep).padStart(2, '0')} / 04</span>
              <span className="ml-auto">{steps[currentStep - 1].label}</span>
            </div>

            <Select
              label="Scan cadence"
              options={frequencyOptions}
              value={formData.frequency}
              onChange={(e) => handleInputChange('frequency', e.target.value)}
              hint="Most teams use daily. Increase frequency for high-signal competitor targets."
              labelMeta="01 / 02"
            />

            <div>
              <div className="font-mono text-label-md uppercase tracking-archive text-ink-2 mb-3">
                Alert preferences
                <span className="text-ink-4 ml-3 normal-case tracking-normal text-mono-sm">02 / 02</span>
              </div>
              <div className="border border-rule divide-y divide-rule">
                <label className="flex items-center gap-4 p-4 cursor-pointer hover:bg-paper-2 transition-colors">
                  <Checkbox
                    checked={formData.emailHighSeverity}
                    onChange={(v) => handleCheckboxChange('emailHighSeverity', v)}
                    label={<span className="font-body text-body-md text-ink">Email on critical changes</span>}
                    description="Only high-severity findings. Recommended for most rooms."
                  />
                </label>
                <label className="flex items-center gap-4 p-4 cursor-pointer hover:bg-paper-2 transition-colors">
                  <Checkbox
                    checked={formData.emailAllChanges}
                    onChange={(v) => handleCheckboxChange('emailAllChanges', v)}
                    label={<span className="font-body text-body-md text-ink">Email on every change</span>}
                    description="All severities, daily digest. Noisy for high-cadence rooms."
                  />
                </label>
                <label className="flex items-center gap-4 p-4 cursor-pointer hover:bg-paper-2 transition-colors">
                  <Checkbox
                    checked={formData.slackNotification}
                    onChange={(v) => handleCheckboxChange('slackNotification', v)}
                    label={<span className="font-body text-body-md text-ink">Slack notification</span>}
                    description="Route changes to a Slack channel (configure in Settings)."
                  />
                </label>
              </div>
            </div>
          </div>
        )}

        {/* Step 4 — Review */}
        {currentStep === 4 && (
          <div className="space-y-7 fade-up-2">
            <div className="section-label">
              <span>Step {String(currentStep).padStart(2, '0')} / 04</span>
              <span className="ml-auto">{steps[currentStep - 1].label}</span>
            </div>

            <div className="border border-rule">
              <div className="px-5 py-3 border-b border-rule bg-paper-2 flex items-center justify-between">
                <span className="font-mono text-mono-sm text-ink-3 uppercase tracking-archive">
                  Manifest
                </span>
                <span className="font-mono text-mono-sm text-ink-3 tabular">
                  4 entries
                </span>
              </div>
              <dl className="divide-y divide-rule">
                <ReviewRow label="Name" value={formData.name || '—'} />
                <ReviewRow
                  label="Purpose"
                  value={formData.description || <span className="text-ink-4">Not provided</span>}
                  multiline
                />
                <ReviewRow
                  label="URLs"
                  value={
                    formData.urls.length > 0
                      ? `${formData.urls.length} filed`
                      : <span className="text-ink-4">None yet</span>
                  }
                />
                <ReviewRow
                  label="Cadence"
                  value={frequencyOptions.find((f) => f.value === formData.frequency)?.label || '—'}
                />
                <ReviewRow
                  label="Alerts"
                  value={
                    [
                      formData.emailHighSeverity && 'Email · critical',
                      formData.emailAllChanges && 'Email · all',
                      formData.slackNotification && 'Slack',
                    ]
                      .filter(Boolean)
                      .join(' · ') || <span className="text-ink-4">None configured</span>
                  }
                />
              </dl>
            </div>

            <div className="border border-dashed border-rule p-5 bg-paper-2">
              <div className="flex items-center gap-3 mb-2">
                <span className="stamp stamp--signal">Heads up</span>
              </div>
              <p className="font-body text-body-sm text-ink-2 leading-relaxed">
                On open, PageVault will run an initial crawl against every URL and seal the baseline
                snapshot in Box. The first AI brief lands within a few minutes.
              </p>
            </div>
          </div>
        )}
      </Card>

      {/* Footer nav */}
      <div className="flex items-center justify-between pt-2">
        <Button
          variant="ghost"
          onClick={() => setCurrentStep((s) => Math.max(1, s - 1))}
          disabled={currentStep === 1}
          icon={<ArrowLeft className="w-4 h-4" />}
        >
          Back
        </Button>
        {currentStep < steps.length ? (
          <Button
            onClick={() => setCurrentStep((s) => s + 1)}
            disabled={!canProceed(currentStep)}
            iconRight={<ArrowRight className="w-4 h-4" />}
          >
            Continue
          </Button>
        ) : (
          <Button onClick={handleSubmit} loading={loading} iconRight={!loading ? <ArrowRight className="w-4 h-4" /> : undefined}>
            Open this room
          </Button>
        )}
      </div>
    </div>
  );
}

function ReviewRow({
  label,
  value,
  multiline,
}: {
  label: string;
  value: React.ReactNode;
  multiline?: boolean;
}) {
  return (
    <div className={['grid grid-cols-12 gap-4 px-5 py-4', multiline ? '' : 'items-baseline'].join(' ')}>
      <dt className="col-span-12 sm:col-span-3 font-mono text-mono-sm text-ink-3 uppercase tracking-archive">
        {label}
      </dt>
      <dd className="col-span-12 sm:col-span-9 font-body text-body-md text-ink">
        {value}
      </dd>
    </div>
  );
}
