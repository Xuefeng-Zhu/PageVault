'use client';

import { forwardRef, SelectHTMLAttributes, useId, ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  error?: string;
  options: { value: string; label: string }[];
  labelMeta?: string;
  leftAdornment?: ReactNode;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    { label, hint, error, options, labelMeta, leftAdornment, className = '', id, ...props },
    ref
  ) => {
    const autoId = useId();
    const sid = id ?? autoId;
    return (
      <div className="w-full">
        {label && (
          <div className="flex items-baseline justify-between mb-1.5">
            <label htmlFor={sid} className="font-mono text-label-md uppercase tracking-archive text-ink-2">
              {label}
            </label>
            {labelMeta && (
              <span className="font-mono text-mono-sm text-ink-4 tabular">{labelMeta}</span>
            )}
          </div>
        )}
        <div className="relative">
          {leftAdornment && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 [&>svg]:w-4 [&>svg]:h-4 pointer-events-none">
              {leftAdornment}
            </span>
          )}
          <select
            ref={ref}
            id={sid}
            className={[
              'w-full h-10 pl-3.5 pr-9 font-body text-body-md text-ink',
              'bg-surface-raised border border-rule rounded-sm',
              'transition-colors duration-150 ease-archive appearance-none cursor-pointer',
              'focus:outline-none focus:border-ink focus:shadow-paper-sm',
              leftAdornment ? 'pl-9' : '',
              error ? 'border-ember focus:border-ember' : '',
              className,
            ].join(' ')}
            {...props}
          >
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-3 pointer-events-none" />
        </div>
        {(hint || error) && (
          <p className={`mt-1.5 font-mono text-mono-sm ${error ? 'text-ember' : 'text-ink-3'}`}>
            {error || hint}
          </p>
        )}
      </div>
    );
  }
);
Select.displayName = 'Select';
