'use client';

interface SeverityBadgeProps {
  severity: 'high' | 'medium' | 'low';
}

export function SeverityBadge({ severity }: SeverityBadgeProps) {
  const styles = {
    high: 'bg-error-container text-on-error-container',
    medium: 'bg-secondary-container text-on-secondary-container',
    low: 'bg-surface-container text-on-surface-variant',
  };

  return (
    <span className={`inline-flex items-center px-2 py-1 rounded-full text-label-sm font-medium capitalize ${styles[severity]}`}>
      {severity}
    </span>
  );
}