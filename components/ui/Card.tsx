'use client';

import { ReactNode, HTMLAttributes } from 'react';

type Padding = 'none' | 'sm' | 'md' | 'lg' | 'xl';
type Tone = 'paper' | 'surface' | 'raised' | 'sunken' | 'ink' | 'signal' | 'ember';

interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  children?: ReactNode;
  padding?: Padding;
  tone?: Tone;
  bordered?: boolean;
  cornerStamp?: ReactNode;
  sectionLabel?: string;
  sectionNumber?: string;
}

const padMap: Record<Padding, string> = {
  none: '',
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-8',
  xl: 'p-10',
};

const toneMap: Record<Tone, string> = {
  paper:   'bg-paper text-ink',
  surface: 'bg-surface text-ink',
  raised:  'bg-surface-raised text-ink',
  sunken:  'bg-surface-sunken text-ink',
  ink:     'bg-ink text-paper',
  signal:  'bg-signal-wash text-ink',
  ember:   'bg-ember-wash text-ink',
};

export function Card({
  children,
  padding = 'md',
  tone = 'surface',
  bordered = true,
  cornerStamp,
  sectionLabel,
  sectionNumber,
  className = '',
  ...rest
}: CardProps) {
  return (
    <div
      {...rest}
      className={[
        'relative transition-colors duration-200 ease-archive',
        toneMap[tone],
        bordered ? 'border border-rule' : '',
        padMap[padding],
        className,
      ].join(' ')}
    >
      {(sectionLabel || sectionNumber) && (
        <div className="section-label section-label--numbered mb-4" data-section={sectionNumber ?? ''}>
          {sectionLabel}
        </div>
      )}
      {cornerStamp && (
        <div className="absolute top-3 right-3 pointer-events-none">
          {cornerStamp}
        </div>
      )}
      {children}
    </div>
  );
}

export function CardHeader({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center justify-between gap-4 pb-4 mb-4 border-b border-rule ${className}`}>
      {children}
    </div>
  );
}

export function CardTitle({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <h3 className={`font-display text-display-sm text-ink leading-tight ${className}`}>
      {children}
    </h3>
  );
}

export function CardSubtitle({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p className={`font-mono text-mono-sm uppercase tracking-archive text-ink-3 mt-1 ${className}`}>
      {children}
    </p>
  );
}
