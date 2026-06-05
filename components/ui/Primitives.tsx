'use client';
// Shared low-level UI primitives for PageVault.
// Restored from the security/p0-fixes WIP that wasn't included in the
// merge to main. Exports match the import signatures used across the
// dashboard pages.

import type { ReactNode } from 'react';

// ─── SectionHeader ────────────────────────────────────────────────────────────
// Title bar with a section number prefix and right-aligned metadata.
export function SectionHeader({
  number,
  label,
  meta,
  className,
  action,
}: {
  number: string;
  label: string;
  meta?: string;
  className?: string;
  // The dashboard page passes a ReactNode action (a button) here.
  // Older callers (changes page, room page) don't, so it's optional.
  action?: ReactNode;
}) {
  return (
    <div className={`flex items-center gap-4 ${className ?? ''}`}>
      <div className="font-mono text-mono-sm text-ink-3 tabular tracking-archive uppercase">
        §{number}
      </div>
      <div className="font-display text-display-sm text-ink">{label}</div>
      {meta && (
        <div className="ml-auto font-mono text-mono-sm text-ink-3 tabular tracking-archive uppercase">
          {meta}
        </div>
      )}
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}

// ─── Spinner ──────────────────────────────────────────────────────────────────
export function Spinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const cls = size === 'sm' ? 'w-3 h-3' : size === 'lg' ? 'w-8 h-8' : 'w-5 h-5';
  return (
    <div
      className={`${cls} border-2 border-rule border-t-ink rounded-full animate-spin`}
      role="status"
      aria-label="Loading"
    />
  );
}

// ─── EmptyState ──────────────────────────────────────────────────────────────
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="text-center py-12 px-6">
      {icon && (
        <div className="w-12 h-12 mx-auto mb-4 border border-rule flex items-center justify-center text-ink-3">
          {icon}
        </div>
      )}
      <h3 className="font-display text-display-sm text-ink mb-2">{title}</h3>
      {description && (
        <p className="font-body text-body-md text-ink-2 max-w-md mx-auto">
          {description}
        </p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

// ─── Progress ─────────────────────────────────────────────────────────────────
// Linear progress bar. Accepts either `tone` (semantic — 'ink' | 'signal') or
// `variant` (visual — 'solid' | 'gradient') depending on the call site.
export function Progress({
  value,
  max = 100,
  variant = 'solid',
  tone,
  className,
}: {
  value: number;
  max?: number;
  variant?: 'solid' | 'gradient';
  tone?: 'ink' | 'signal';
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  // Map the semantic tone to a class. Default is ink-2.
  const toneClass =
    tone === 'signal'
      ? 'bg-signal-bright'
      : 'bg-ink-2';
  const variantClass =
    variant === 'gradient'
      ? 'bg-gradient-to-r from-ink-3 via-signal-bright to-ink-2'
      : toneClass;
  return (
    <div
      className={`h-1 w-full bg-rule overflow-hidden ${className ?? ''}`}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`h-full ${variantClass} transition-[width] duration-300`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ─── Tabs ──────────────────────────────────────────────────────────────────────
// Generic tab bar. Accepts `items` (matching the WIP's prop name) and
// supports per-item `icon` and `meta` (a small badge count, optional).
export interface TabItem<TId extends string = string> {
  id: TId;
  label: string;
  icon?: ReactNode;
  meta?: number | string;
}

export function Tabs<TId extends string = string>({
  items,
  value,
  onChange,
}: {
  items: TabItem<TId>[];
  value: TId;
  onChange: (id: TId) => void;
}) {
  return (
    <div className="flex border-b border-rule">
      {items.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`px-4 py-2 font-mono text-mono-sm uppercase tracking-archive transition-colors flex items-center gap-1.5 ${
            t.id === value
              ? 'text-ink border-b-2 border-ink -mb-px'
              : 'text-ink-3 hover:text-ink-2'
          }`}
          aria-pressed={t.id === value}
        >
          {t.icon}
          <span>{t.label}</span>
          {t.meta !== undefined && (
            <span className="ml-1 text-ink-3 tabular">({t.meta})</span>
          )}
        </button>
      ))}
    </div>
  );
}

// ─── Checkbox ────────────────────────────────────────────────────────────────
// Used in the new-room form. Supports a JSX label (rendered inline) and an
// optional description (rendered below the label).
export function Checkbox({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  // Allow JSX so callers can style the label text.
  label: ReactNode;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <div className={`flex items-start gap-3 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 w-4 h-4 border border-rule accent-ink"
      />
      <div>
        <div className="font-mono text-mono-sm">{label}</div>
        {description && (
          <div className="font-mono text-mono-sm text-ink-3 mt-1">{description}</div>
        )}
      </div>
    </div>
  );
}

// ─── Toggle ───────────────────────────────────────────────────────────────────
export function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  label?: ReactNode;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        className={`relative w-9 h-5 transition-colors ${
          on ? 'bg-ink-2' : 'bg-rule'
        }`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 bg-paper transition-transform ${
            on ? 'translate-x-[18px]' : 'translate-x-0.5'
          }`}
        />
      </button>
      {label && <span className="font-mono text-mono-sm">{label}</span>}
    </label>
  );
}
