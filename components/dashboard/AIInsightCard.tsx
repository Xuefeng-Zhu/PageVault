'use client';

import { Brain, TrendingUp, AlertTriangle } from 'lucide-react';

interface AIInsightCardProps {
  title: string;
  insights: string[];
  confidence: number;
  icon?: 'brain' | 'trending' | 'alert';
}

export function AIInsightCard({ title, insights, confidence, icon = 'brain' }: AIInsightCardProps) {
  const IconComponent = icon === 'trending' ? TrendingUp : icon === 'alert' ? AlertTriangle : Brain;

  return (
    <div className="bg-gradient-to-br from-primary-container/20 to-secondary-container/20 rounded-xl border border-outline-variant p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-white shadow-sm flex items-center justify-center">
          <IconComponent className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h3 className="font-headline-md text-headline-md font-bold text-on-surface">{title}</h3>
          <span className="text-label-sm text-on-surface-variant">{confidence}% confidence</span>
        </div>
      </div>
      <div className="space-y-3">
        {insights.map((insight, index) => (
          <div key={index} className="flex items-start gap-3 p-3 bg-surface-container-lowest rounded-lg border border-outline-variant">
            <div className="w-5 h-5 rounded-full bg-primary-container text-white text-xs font-medium flex items-center justify-center flex-shrink-0 mt-0.5">
              {index + 1}
            </div>
            <span className="text-body-md text-on-surface">{insight}</span>
          </div>
        ))}
      </div>
    </div>
  );
}