import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

import { Pressable, ReceiptRow, Spinner, Text, View } from '@/components';
import { colors, radii, spacing } from '@/theme';

/**
 * The narrow slice of a purchase the reference rows render. Structural typing
 * keeps `PurchaseWithItems` assignable without dragging the tickets API graph
 * into the price-alert render harness.
 */
export interface PriceAlertReferenceReceipt {
  id?: string;
  store_name?: string | null;
  purchase_date: string;
  total: number;
  currency?: string | null;
  is_manual?: boolean;
}

export interface PriceAlertReferenceCardProps {
  /** Already-translated "previous month" / "this month" row label. */
  label: string;
  hasId: boolean;
  isLoading: boolean;
  /** A failed detail read is an "unavailable" row with a retry, not a spinner. */
  isError?: boolean;
  receipt?: PriceAlertReferenceReceipt;
  /** Viewer currency for legacy rows with no stored unit. */
  currency: string;
  onPress?: () => void;
  onRetry?: () => void;
}

/**
 * One side of the reference-receipt pair shown under the price comparison on
 * the receipt detail screen. A manual ticket is not a real source receipt, so
 * its row is omitted entirely — a missing id is a DIFFERENT state and renders
 * the "unavailable" copy instead. The amount in `ReceiptRow` is the SINGLE
 * receipt total (captioned as such); the comparison above it keeps its own
 * monthly-average caption and is never relabeled as a ticket price.
 */
export function PriceAlertReferenceCard({
  label,
  hasId,
  isLoading,
  isError,
  receipt,
  currency,
  onPress,
  onRetry,
}: PriceAlertReferenceCardProps) {
  const { t } = useTranslation(['analytics', 'common']);

  // Origin check first: manual entries are omitted as a whole row, not
  // downgraded to an "unavailable" row.
  if (receipt?.is_manual === true) return null;

  const missingId = !hasId;
  const loading = hasId && isLoading && !receipt;
  const unavailable = missingId || isError || (!loading && !receipt);

  return (
    <View style={styles.rowWrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.rowArea}>
        {unavailable ? (
          <View style={styles.missingWrap}>
            <Text style={styles.missing}>{t('priceAlertReferenceMissing')}</Text>
            {isError && onRetry ? (
              <Pressable
                onPress={onRetry}
                accessibilityRole="button"
                accessibilityLabel={t('common:retry')}
                style={styles.retryButton}
              >
                <Text style={styles.retryLabel}>{t('common:retry')}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : loading ? (
          <View style={styles.spinnerArea}>
            <Spinner size="sm" />
          </View>
        ) : (
          <View style={styles.readyWrap}>
            <ReceiptRow
              name={receipt!.store_name || '—'}
              date={receipt!.purchase_date}
              amount={receipt!.total}
              currency={receipt!.currency ?? currency}
              iconName="doc.text"
              onPress={onPress}
            />
            <Text style={styles.totalCaption}>
              {t('priceAlertReferenceTotal')}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  rowWrap: {
    backgroundColor: 'transparent',
    gap: spacing.xs,
  },
  label: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.05 * 16,
    color: colors.textSecondary,
  },
  rowArea: {
    backgroundColor: 'transparent',
    minHeight: 40,
    justifyContent: 'center',
  },
  spinnerArea: {
    backgroundColor: 'transparent',
    paddingVertical: spacing.sm,
  },
  missingWrap: {
    backgroundColor: 'transparent',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  missing: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  readyWrap: {
    backgroundColor: 'transparent',
    gap: 2,
  },
  totalCaption: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  retryButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  retryLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.primary,
  },
});
