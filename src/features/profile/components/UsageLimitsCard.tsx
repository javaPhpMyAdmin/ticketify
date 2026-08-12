import { UsageMeter } from '@/components';
import type { ScanUsage } from '@/types';

export interface UsageLimitsCardProps {
  usage: ScanUsage;
  /**
   * Client Pro entitlement (RevenueCat). The meter short-circuits to
   * "Ilimitado" when this is true, regardless of any stale numeric
   * `usage.scans_limit` the row may carry (pro-subscription spec —
   * REQ-QUOTA-6, CRITICAL-2).
   */
  isPro: boolean;
  /** Optional override for the "Reset in N days" label. */
  resetLabel?: string;
  /** Optional override for the upgrade pitch. */
  upgradeLabel?: string;
}

/**
 * Feature-level wrapper around the `UsageMeter` organism
 * (pro-subscription spec — REQ-QUOTA-6, REQ-GATE-4). Lets the profile
 * screen mount the usage card without knowing the organism's
 * internals. `isPro` is forwarded so the meter can flip to unlimited
 * the moment a purchase clears (REQ-GATE-5).
 */
export function UsageLimitsCard({
  usage,
  isPro,
  resetLabel,
  upgradeLabel,
}: UsageLimitsCardProps) {
  return (
    <UsageMeter
      used={usage.scans_used}
      limit={usage.scans_limit}
      isPro={isPro}
      resetLabel={resetLabel}
      upgradeLabel={upgradeLabel}
    />
  );
}
