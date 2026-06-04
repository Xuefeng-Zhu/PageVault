'use client';

import { Brain, TrendingUp, AlertTriangle, Sparkles } from 'lucide-react';
import { ReactNode } from 'react';

type IconKind = 'brain' | 'trending' | 'alert' | 'sparkles';

interface AIInsightCardProps {
  title: string;
  subtitle?: string;
  insights: string[];
  confidence: number;
  icon?: IconKind;
  children?: ReactNode;
  stamp?: string;
}

const iconMap = {
  brain: Brain,
  trending: TrendingUp,
  alert: AlertTriangle,
  sparkles: Sparkles,
};

export function AIInsightCard({ title, subtitle, insights, confidence, icon = 'brain', children, stamp }: AIInsightCardProps) {
  const Icon = iconMap[icon];

  return (
    <div className="relative bg-ink text-paper border border-ink overflow-hidden">
      {/* Decorative diagonal pattern */}
      <div className="absolute inset-0 bg-diagonal opacity-[0.06] pointer-events-none" />
      {/* Stamp */}
      {stamp && (
        <div className="absolute top-4 right-4 stamp stamp-enter text-paper border-paper" style={{ animationDelay: '0.3s' }}>
          {stamp}
        </div>
      )}

      <div className="relative p-7">
        {/* Header */}
        <div className="flex items-start gap-4 mb-6">
          <div className="relative w-11 h-11 flex items-center justify-center border border-paper/30">
            <Icon className="w-5 h-5 text-paper" strokeWidth={1.5} />
            <span className="absolute -top-1 -right-1 w-2 h-2 bg-signal-bright pulse-dot" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-mono-sm text-paper/50 uppercase tracking-archive">
                AI Interpretation
              </span>
              <span className="h-px flex-1 bg-paper/20" />
              <span className="font-mono text-mono-sm text-signal-bright tabular">
                {confidence}% confidence
              </span>
            </div>
            <h3 className="font-display text-display-md text-paper leading-tight">{title}</h3>
            {subtitle && (
              <p className="font-body text-body-sm text-paper/60 mt-1.5">{subtitle}</p>
            )}
          </div>
        </div>

        {/* Insights list */}
        {insights.length > 0 && (
          <ol className="space-y-2.5">
            {insights.map((insight, i) => (
              <li
                key={i}
                className="flex items-start gap-4 p-3.5 bg-paper/[0.04] border border-paper/10"
              >
                <span className="numeral text-paper/40 text-lg shrink-0 w-6">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="font-body text-body-md text-paper/90 leading-relaxed">
                  {insight}
                </span>
              </li>
            ))}
          </ol>
        )}

        {children}
      </div>
    </div>
  );
}
