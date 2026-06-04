'use client';

import { forwardRef, InputHTMLAttributes, TextareaHTMLAttributes, useId, ReactNode } from 'react';

interface BaseProps {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  leftAdornment?: ReactNode;
  rightAdornment?: ReactNode;
  labelMeta?: string; // e.g. "01 / 02"  — doc-style
}

interface InputProps extends BaseProps, Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {}

const baseField =
  'w-full font-body text-body-md text-ink placeholder:text-ink-4 ' +
  'bg-surface-raised border border-rule ' +
  'transition-colors duration-150 ease-archive ' +
  'focus:outline-none focus:border-ink focus:shadow-paper-sm ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

const heightMap = {
  sm: 'h-8 px-3 text-body-sm',
  md: 'h-10 px-3.5 text-body-md',
  lg: 'h-12 px-4 text-body-lg',
} as const;

export const Input = forwardRef<HTMLInputElement, InputProps & { size?: keyof typeof heightMap }>(
  ({ label, hint, error, required, leftAdornment, rightAdornment, labelMeta, size = 'md', className = '', id, ...props }, ref) => {
    const autoId = useId();
    const inputId = id ?? autoId;
    return (
      <div className="w-full">
        {label && (
          <div className="flex items-baseline justify-between mb-1.5">
            <label htmlFor={inputId} className="font-mono text-label-md uppercase tracking-archive text-ink-2">
              {label}
              {required && <span className="text-ember ml-0.5">*</span>}
            </label>
            {labelMeta && (
              <span className="font-mono text-mono-sm text-ink-4 tabular">{labelMeta}</span>
            )}
          </div>
        )}
        <div className="relative">
          {leftAdornment && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 [&>svg]:w-4 [&>svg]:h-4">
              {leftAdornment}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            className={[
              baseField,
              heightMap[size],
              leftAdornment ? 'pl-9' : '',
              rightAdornment ? 'pr-10' : '',
              error ? 'border-ember focus:border-ember' : '',
              className,
            ].join(' ')}
            {...props}
          />
          {rightAdornment && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-3 [&>svg]:w-4 [&>svg]:h-4">
              {rightAdornment}
            </span>
          )}
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
Input.displayName = 'Input';

// === Textarea ===
interface TextareaProps extends BaseProps, TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, hint, error, required, labelMeta, className = '', id, rows = 4, ...props }, ref) => {
    const autoId = useId();
    const tid = id ?? autoId;
    return (
      <div className="w-full">
        {label && (
          <div className="flex items-baseline justify-between mb-1.5">
            <label htmlFor={tid} className="font-mono text-label-md uppercase tracking-archive text-ink-2">
              {label}
              {required && <span className="text-ember ml-0.5">*</span>}
            </label>
            {labelMeta && (
              <span className="font-mono text-mono-sm text-ink-4 tabular">{labelMeta}</span>
            )}
          </div>
        )}
        <textarea
          ref={ref}
          id={tid}
          rows={rows}
          className={[
            'w-full px-3.5 py-2.5 font-body text-body-md text-ink placeholder:text-ink-4',
            'bg-surface-raised border border-rule rounded-sm resize-y',
            'transition-colors duration-150 ease-archive',
            'focus:outline-none focus:border-ink focus:shadow-paper-sm',
            error ? 'border-ember focus:border-ember' : '',
            className,
          ].join(' ')}
          {...props}
        />
        {(hint || error) && (
          <p className={`mt-1.5 font-mono text-mono-sm ${error ? 'text-ember' : 'text-ink-3'}`}>
            {error || hint}
          </p>
        )}
      </div>
    );
  }
);
Textarea.displayName = 'Textarea';
