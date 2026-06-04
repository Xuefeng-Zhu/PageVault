'use client';

import { Check } from 'lucide-react';

interface StepperProps {
  steps: { id: number; label: string; description?: string; code?: string }[];
  currentStep: number;
  className?: string;
}

export function Stepper({ steps, currentStep, className = '' }: StepperProps) {
  return (
    <ol className={`flex items-stretch w-full ${className}`}>
      {steps.map((step, index) => {
        const isDone = step.id < currentStep;
        const isCurrent = step.id === currentStep;
        const isFuture = step.id > currentStep;

        return (
          <li
            key={step.id}
            className="flex items-stretch flex-1 last:flex-none"
          >
            <div className="flex items-center gap-3 pr-4">
              {/* Marker */}
              <span
                className={[
                  'relative w-9 h-9 flex items-center justify-center shrink-0 transition-colors duration-200',
                  isDone
                    ? 'bg-ink text-paper border border-ink'
                    : isCurrent
                    ? 'bg-paper text-ink border-2 border-ink'
                    : 'bg-paper text-ink-4 border border-rule',
                ].join(' ')}
              >
                {isDone ? (
                  <Check className="w-4 h-4" strokeWidth={2.5} />
                ) : (
                  <span className="font-display text-[0.95rem]">
                    {String(step.id).padStart(2, '0')}
                  </span>
                )}
                {isCurrent && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 bg-ember-bright pulse-dot" />
                )}
              </span>

              {/* Label */}
              <div className="flex flex-col leading-tight min-w-0">
                <span
                  className={[
                    'font-mono text-mono-sm uppercase tracking-archive',
                    isCurrent ? 'text-ink' : 'text-ink-3',
                  ].join(' ')}
                >
                  Step {step.id} / {steps.length}
                </span>
                <span
                  className={[
                    'font-body text-body-md truncate',
                    isFuture ? 'text-ink-3' : 'text-ink',
                  ].join(' ')}
                >
                  {step.label}
                </span>
              </div>
            </div>

            {/* Connector */}
            {index < steps.length - 1 && (
              <div className="flex items-center px-2">
                <div
                  className={[
                    'h-px flex-1 min-w-[24px] transition-colors',
                    step.id < currentStep ? 'bg-ink' : 'bg-rule',
                  ].join(' ')}
                />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
