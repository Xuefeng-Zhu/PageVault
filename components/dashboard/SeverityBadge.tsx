'use client';

import { Badge } from '@/components/ui/Badge';

type Severity = 'high' | 'medium' | 'low';

interface SeverityBadgeProps {
  severity: Severity;
  withLabel?: boolean;
}

export function SeverityBadge({ severity, withLabel = true }: SeverityBadgeProps) {
  const variantMap: Record<Severity, 'ember' | 'signal' | 'paper'> = {
    high: 'ember',
    medium: 'signal',
    low: 'paper',
  };

  const labelMap: Record<Severity, string> = {
    high: 'Critical',
    medium: 'Notable',
    low: 'Minor',
  };

  return (
    <Badge variant={variantMap[severity]} size="sm" dot>
      {withLabel ? labelMap[severity] : severity}
    </Badge>
  );
}
