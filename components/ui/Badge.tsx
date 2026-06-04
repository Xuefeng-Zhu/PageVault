'use client';

import { ReactNode } from 'react';

type Variant = 'signal' | 'ember' | 'ink' | 'paper' | 'outline';
type Size = 'sm' | 'md';

interface BadgeProps {
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  dot?: boolean;
  className?: string;
}

const sizeMap: Record<Size, string> = {
  sm: 'px-1.5 py-0.5 text-label-sm gap-1',
  md: 'px-2 py-0.5 text-label-md gap-1.5',
};

const variantMap: Record<Variant, string> = {
  signal:  'bg-signal-wash text-signal border border-signal/30',
  ember:   'bg-ember-wash text-ember border border-ember/40',
  ink:     'bg-ink text-paper border border-ink',
  paper:   'bg-paper-2 text-ink-2 border border-rule',
  outline: 'bg-transparent text-ink-2 border border-rule-strong',
};

const dotColorMap: Record<Variant, string> = {
  signal:  'bg-signal-bright',
  ember:   'bg-ember-bright',
  ink:     'bg-paper',
  paper:   'bg-ink-3',
  outline: 'bg-ink-3',
};

export function Badge({ children, variant = 'paper', size = 'md', dot, className = '' }: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center font-mono uppercase font-semibold rounded-sm',
        sizeMap[size],
        variantMap[variant],
        className,
      ].join(' ')}
    >
      {dot && (
        <span
          className={`w-1.5 h-1.5 rounded-full ${dotColorMap[variant]} ${variant === 'signal' || variant === 'ember' ? 'pulse-dot' : ''}`}
        />
      )}
      {children}
    </span>
  );
}
