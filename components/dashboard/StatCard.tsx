'use client';

import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { ReactNode } from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
}

export function StatCard({ label, value, trend, trendValue }: StatCardProps) {
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
  const trendColor = trend === 'up' ? 'text-green-600' : trend === 'down' ? 'text-red-600' : 'text-slate-500';

  return (
    <div className="bg-surface-container-lowest border border-outline-variant p-4 rounded-xl">
      <span className="font-label-sm text-on-surface-variant uppercase tracking-wider">{label}</span>
      <div className="flex items-end gap-2 mt-1">
        <span className="font-headline-lg text-headline-lg text-on-surface font-bold">{value}</span>
        {trendValue && (
          <div className={`flex items-center gap-1 text-label-sm ${trendColor} pb-1`}>
            <TrendIcon className="w-3 h-3" />
            <span>{trendValue}</span>
          </div>
        )}
      </div>
    </div>
  );
}