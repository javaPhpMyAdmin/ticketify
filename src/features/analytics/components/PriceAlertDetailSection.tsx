import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

import { Text, View } from '@/components';
import { useSessionUser } from '@/features/auth';
import { currentMonthKey } from '@/features/home/hooks/useHomeFeed';
import { useProEntitlement } from '@/features/pro/hooks/useProEntitlement';
import {
  fetchPurchaseDetail,
  type PurchaseWithItems,
} from '@/features/tickets/api';
import { queryKeys } from '@/lib/query-keys';
import { useSettingsStore } from '@/stores/use-settings-store';
import { colors, radii, spacing } from '@/theme';

import { usePriceAlerts } from '../hooks/usePriceAlerts';
import { PriceAlertComparison } from './PriceAlertComparison';
import { PriceAlertReferenceCard } from './PriceAlertReferenceCard';

export interface PriceAlertDetailSectionProps {
  /** Month the alert was computed for (the `month` search param). */
  month: string;
  /** Exact alert display name (the `name` search param). */
  name: string;
  /** Exact currency bucket (the `unit` search param). */
  unit: string;
  /** Previous-month source receipt (the `previousReceiptId` search param). */
  previousReceiptId?: string;
  /** Already-fetched current receipt; never refetched here. */
  currentReceipt?: PurchaseWithItems;
  locale: string;
}

/** Only `YYYY-MM` with a real month; an arbitrary URL param must never reach
 * `previousMonthKey`, which would build `NaN-NaN` query keys. */
const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Mounted by `/receipts/[id]` only when the banner supplied its context
 * params. Re-selects the exact alert by a FIVE-field key: the validated month
 * scopes `usePriceAlerts`, then the returned alerts are matched on
 * (receiptId, name, unit, previousReceiptId) — matching on name alone could
 * pick a sibling alert in another currency bucket or from another month.
 *
 * The Pro guard is local and render-only: free users simply do not see this
 * Pro block. The banner already owns the paywall path (`/pro`), so a receipt
 * deep link must never eject a free user or break Back. An invalid month is
 * replaced with a safe fallback AND disables the alerts hook, so no query is
 * ever issued for a malformed param.
 */
export function PriceAlertDetailSection({
  month,
  name,
  unit,
  previousReceiptId,
  currentReceipt,
  locale,
}: PriceAlertDetailSectionProps) {
  const { t } = useTranslation(['analytics', 'common']);
  const { userId } = useSessionUser();
  const { isPro, isLoading: proLoading } = useProEntitlement();
  const viewerCurrency = useSettingsStore((s) => s.currency);
  const validMonth = MONTH_KEY_PATTERN.test(month);
  const safeMonth = validMonth ? month : currentMonthKey();

  const alerts = usePriceAlerts(safeMonth, validMonth && isPro);
  // An empty currency bucket (legacy rows) must not leak a symbol-less amount
  // into ReceiptRow; the viewer's currency is the documented fallback.
  const displayUnit = unit || viewerCurrency;

  const alert = alerts.find(
    (a) =>
      a.receiptId === (currentReceipt?.id ?? '') &&
      a.name === name &&
      a.unit === unit &&
      a.previousReceiptId === (previousReceiptId ?? ''),
  );

  const previousQuery = useQuery({
    queryKey: queryKeys.receiptDetail(userId!, previousReceiptId!),
    enabled: Boolean(isPro && validMonth && previousReceiptId),
    queryFn: () => fetchPurchaseDetail(userId!, previousReceiptId!),
  });

  if (!isPro || proLoading || !alert) return null;

  return (
    <View style={styles.section}>
      <PriceAlertComparison alert={alert} locale={locale} />
      <View style={styles.referenceCard}>
        <Text style={styles.referenceTitle}>
          {t('analytics:priceAlertReferenceTitle')}
        </Text>
        <View style={styles.referenceRows}>
          <PriceAlertReferenceCard
            label={t('analytics:priceAlertPreviousMonth')}
            hasId={!!previousReceiptId}
            isLoading={previousQuery.isLoading}
            isError={previousQuery.isError}
            receipt={previousQuery.data}
            currency={displayUnit}
            onPress={() =>
              router.push(
                `/receipts/${encodeURIComponent(previousReceiptId!)}` as never,
              )
            }
            onRetry={() => void previousQuery.refetch()}
          />
          <PriceAlertReferenceCard
            label={t('analytics:priceAlertCurrentMonth')}
            hasId={!!currentReceipt?.id}
            isLoading={false}
            receipt={currentReceipt}
            currency={currentReceipt?.currency ?? displayUnit}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.lg,
  },
  referenceCard: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
    padding: spacing.md,
    gap: spacing.sm,
  },
  referenceTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  referenceRows: {
    backgroundColor: 'transparent',
    gap: spacing.md,
  },
});
