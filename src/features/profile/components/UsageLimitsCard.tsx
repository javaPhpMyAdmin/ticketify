import { UsageMeter } from '@/components';
import type { ScanUsage } from '@/types';

export interface UsageLimitsCardProps {
  usage: ScanUsage;
  /** Optional override for the "Reset in N days" label. */
  resetLabel?: string;
  /** Optional override for the upgrade pitch. */
  upgradeLabel?: string;
}

/**
 * Feature-level wrapper around the `UsageMeter` organism. Lets the
 * profile screen mount the usage card without knowing the
 * organism's internals.
 */
export function UsageLimitsCard({ usage, resetLabel, upgradeLabel }: UsageLimitsCardProps) {
  return (
    <UsageMeter
      used={usage.scans_used}
      limit={usage.scans_limit}
      resetLabel={resetLabel}
      upgradeLabel={upgradeLabel}
    />
  );
}
