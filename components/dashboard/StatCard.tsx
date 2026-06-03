'use client';

import { TrendingUp, TrendingDown, Minus, LucideIcon } from 'lucide-react';

interface StatCardProps {
  label: string;
  value: string | number;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  icon?: LucideIcon;
  caption?: string;
  unit?: string;
}

export function StatCard({ label, value, trend = 'neutral', trendValue, icon: Icon, caption, unit }: StatCardProps) {
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
  const trendColor =
    trend === 'up' ? 'text-signal' : trend === 'down' ? 'text-ember' : 'text-ink-3';
  const trendBg =
    trend === 'up' ? 'bg-signal-wash' : trend === 'down' ? 'bg-ember-wash' : 'bg-paper-2';

  return (
    <div className="group relative bg-surface border border-rule p-5 hover-lift overflow-hidden">
      {/* Decorative rule */}
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-ink opacity-0 group-hover:opacity-100 transition-opacity duration-200" />

      <div className="flex items-start justify-between mb-3">
        <span className="font-mono text-label-md text-ink-3 uppercase tracking-archive">
          {label}
        </span>
        {Icon && (
          <span className="w-7 h-7 flex items-center justify-center border border-rule">
            <Icon className="w-3.5 h-3.5 text-ink-2" strokeWidth={1.75} />
          </span>
        )}
      </div>

      <div className="flex items-baseline gap-2 mb-2">
        <span className="font-display text-[2.25rem] leading-none text-ink tabular tracking-[-0.02em]">
          {value}
        </span>
        {unit && <span className="font-mono text-mono-sm text-ink-3">{unit}</span>}
      </div>

      <div className="flex items-center justify-between">
        {trendValue ? (
          <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 ${trendBg} ${trendColor}`}>
            <TrendIcon className="w-3 h-3" strokeWidth={2} />
            <span className="font-mono text-mono-sm uppercase tracking-archive">{trendValue}</span>
          </div>
        ) : <span />}
        {caption && (
          <span className="font-mono text-mono-sm text-ink-3">{caption}</span>
        )}
      </div>
    </div>
  );
}
