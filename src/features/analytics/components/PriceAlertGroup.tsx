import type { PriceAlert } from '@/features/analytics/price-alerts';

import { PriceAlertBanner } from './PriceAlertBanner';
import { PriceAlertComparison } from './PriceAlertComparison';

/**
 * A single alert renders as a banner plus, for Pro users only, the inline
 * comparison of the two source tickets behind it. Both stay siblings: the
 * banner owns its press surface, and the comparison is simply omitted for
 * free users so the locked-banner experience is unchanged.
 */
export interface PriceAlertGroupProps {
  alert: PriceAlert;
  isPro: boolean;
  locale: string;
}

export function PriceAlertGroup({
  alert,
  isPro,
  locale,
}: PriceAlertGroupProps) {
  return (
    <>
      <PriceAlertBanner alert={alert} isPro={isPro} />
      {isPro ? <PriceAlertComparison alert={alert} locale={locale} /> : null}
    </>
  );
}
