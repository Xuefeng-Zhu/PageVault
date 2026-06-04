'use client';

import { forwardRef, ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'link';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
  block?: boolean;
}

const base =
  'relative inline-flex items-center justify-center font-body font-medium tracking-[-0.003em] ' +
  'transition-all duration-150 ease-archive ' +
  'disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-paper';

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-body-sm gap-1.5',
  md: 'h-10 px-4 text-body-md gap-2',
  lg: 'h-12 px-5 text-body-lg gap-2.5',
};

const variants: Record<Variant, string> = {
  // Solid ink — primary CTA
  primary:
    'bg-ink text-paper border border-ink ' +
    'hover:bg-ink-2 hover:border-ink-2 hover:-translate-y-px ' +
    'active:translate-y-0 active:shadow-press',
  // Subtle outline — secondary
  secondary:
    'bg-surface text-ink border border-rule-strong ' +
    'hover:bg-paper-2 hover:border-ink',
  // Ghost — tertiary, no border
  ghost:
    'bg-transparent text-ink-2 border border-transparent ' +
    'hover:bg-paper-2 hover:text-ink',
  // Outline only
  outline:
    'bg-transparent text-ink border border-rule-strong ' +
    'hover:bg-ink hover:text-paper hover:border-ink',
  // Danger — ember
  danger:
    'bg-ember-bright text-paper border border-ember ' +
    'hover:bg-ember hover:border-ember',
  // Link — no chrome
  link:
    'bg-transparent text-ink border-0 p-0 h-auto underline underline-offset-4 decoration-rule-strong ' +
    'hover:text-ember hover:decoration-ember',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      loading,
      icon,
      iconRight,
      block,
      className = '',
      children,
      disabled,
      type = 'button',
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        className={`${base} ${sizes[size]} ${variants[variant]} ${block ? 'w-full' : ''} ${className}`}
        {...props}
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : icon ? (
          <span className="inline-flex items-center justify-center shrink-0 [&>svg]:w-4 [&>svg]:h-4">
            {icon}
          </span>
        ) : null}
        {children && <span className="inline-flex items-center">{children}</span>}
        {iconRight && !loading && (
          <span className="inline-flex items-center justify-center shrink-0 [&>svg]:w-4 [&>svg]:h-4">
            {iconRight}
          </span>
        )}
      </button>
    );
  }
);

Button.displayName = 'Button';
