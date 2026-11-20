import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

import { Text, View } from '@/components';
import {
  isPriceIncrease,
  type PriceAlert,
} from '@/features/analytics/price-alerts';
import {
  formatCurrency,
  formatDate,
  type FormatDateLocale,
} from '@/lib/format';
import { colors, radii, spacing } from '@/theme';

/** Shown when a source field is missing; a blank price could read as 1000x. */
const PLACEHOLDER = '—';

/**
 * PRO-only inline comparison shown next to a price-alert banner. It surfaces
 * the two source tickets the alert was computed from — previous and current —
 * with their date, store and price, plus the signed delta between them.
 *
 * CRITICAL semantics: `currentPrice` and `previousPrice` are MONTHLY
 * AVERAGES for the alert's `(identity, unit)` bucket, not the unit price of
 * either single receipt shown here. Every price is captioned accordingly so
 * a reader cannot mistake an average for one ticket's line price.
 */
export interface PriceAlertComparisonProps {
  alert: PriceAlert;
  locale: string;
}

export function PriceAlertComparison({
  alert,
  locale,
}: PriceAlertComparisonProps) {
  const { t } = useTranslation(['analytics']);
  const priceIncreased = isPriceIncrease(alert.changePct);
  const deltaColor = priceIncreased ? colors.danger : colors.primaryDark;
  const dateLocale = locale as FormatDateLocale;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t('analytics:priceAlertCompareTitle')}</Text>
      <Text style={styles.note}>{t('analytics:priceAlertComparedNote')}</Text>
      <View style={styles.deltaRow}>
        <Text style={[styles.delta, { color: deltaColor }]}>
          {`${priceIncreased ? '+' : '-'}${Math.abs(alert.changePct)}%`}
        </Text>
      </View>
      <View style={styles.sides}>
        <View style={styles.side}>
          <Text style={styles.sideLabel}>
            {t('analytics:priceAlertPreviousMonth')}
          </Text>
          <Text style={styles.date}>
            {alert.previousPurchaseDate
              ? formatDate(dateLocale, alert.previousPurchaseDate)
              : PLACEHOLDER}
          </Text>
          <Text style={styles.store}>
            {alert.previousStoreName || PLACEHOLDER}
          </Text>
          <Text style={styles.price}>
            {alert.unit
              ? formatCurrency(alert.previousPrice, alert.unit)
              : PLACEHOLDER}
          </Text>
          <Text style={styles.averageCaption}>
            {t('analytics:priceAlertMonthlyAverage')}
          </Text>
        </View>
        <View style={styles.side}>
          <Text style={styles.sideLabel}>
            {t('analytics:priceAlertCurrentMonth')}
          </Text>
          <Text style={styles.date}>
            {alert.currentPurchaseDate
              ? formatDate(dateLocale, alert.currentPurchaseDate)
              : PLACEHOLDER}
          </Text>
          <Text style={styles.store}>
            {alert.currentStoreName || PLACEHOLDER}
          </Text>
          <Text style={styles.price}>
            {alert.unit
              ? formatCurrency(alert.currentPrice, alert.unit)
              : PLACEHOLDER}
          </Text>
          <Text style={styles.averageCaption}>
            {t('analytics:priceAlertMonthlyAverage')}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
    padding: spacing.md,
    gap: spacing.sm,
  },
  // Themed Views inject theme.background ahead of caller styles; every nested
  // View must opt out or it paints an opaque rectangle over the card tint.
  deltaRow: {
    backgroundColor: 'transparent',
    alignItems: 'center',
  },
  sides: {
    backgroundColor: 'transparent',
    flexDirection: 'row',
    gap: spacing.md,
  },
  side: {
    backgroundColor: 'transparent',
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  note: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  delta: {
    fontSize: 22,
    fontWeight: '900',
  },
  sideLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.05 * 16,
    color: colors.textSecondary,
  },
  date: {
    fontSize: 13,
    color: colors.textPrimary,
  },
  store: {
    fontSize: 13,
    color: colors.textSecondaryAlt,
  },
  price: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  averageCaption: {
    fontSize: 11,
    fontStyle: 'italic',
    color: colors.textSecondary,
  },
});
