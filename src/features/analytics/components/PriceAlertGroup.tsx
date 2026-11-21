import type { PriceAlert } from '@/features/analytics/price-alerts';

import { PriceAlertBanner } from './PriceAlertBanner';

/**
 * A price alert renders as a single banner. The Pro-only comparison is NOT
 * inline here anymore: tapping the banner opens the source receipt with the
 * alert identity in the URL, and that screen mounts the comparison together
 * with its two reference-receipt rows. Keeping the group to one child preserves
 * the locked-banner upsell for free users and gives Pro users one press target.
 */
export interface PriceAlertGroupProps {
  alert: PriceAlert;
  isPro: boolean;
  /** Forwarded so the detail screen can re-select this exact alert by month. */
  monthKey?: string;
  /** Retained for call-site compatibility; the comparison moved to /receipts/[id]. */
  locale?: string;
}

export function PriceAlertGroup({
  alert,
  isPro,
  monthKey,
}: PriceAlertGroupProps) {
  return <PriceAlertBanner alert={alert} isPro={isPro} monthKey={monthKey} />;
}
