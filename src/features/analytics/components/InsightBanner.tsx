import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Icon, Text } from '@/components';
import { colors, radii, spacing, typography } from '@/theme';

export interface InsightBannerProps {
  /** Month-over-month percentage change. */
  deltaPct: number | null;
  /** Name of the comparison month, e.g. "Julio". */
  previousMonthName?: string | null;
}

/**
 * Insight banner below the Analytics hero.
 *
 * Renders a direction-tinted banner with an icon and localized copy that
 * calls out the month-over-month spend change: more spend is red, less spend
 * is green, and no change is neutral. Hidden when there is no previous-month
 * base (`deltaPct === null` or no name), per the spec edge case.
 */
export function InsightBanner({
  deltaPct,
  previousMonthName,
}: InsightBannerProps) {
  const { t } = useTranslation('analytics');
  if (deltaPct === null || !previousMonthName) {
    return null;
  }

  const absPct = Math.abs(Math.round(deltaPct));
  const month = previousMonthName;

  let message: string;
  if (deltaPct > 0) {
    message = t('insightMore', { pct: absPct, month });
  } else if (deltaPct < 0) {
    message = t('insightLess', { pct: absPct, month });
  } else {
    message = t('insightSame', { month });
  }

  // One tone drives all three surfaces so the color never contradicts the
  // copy: red for more spend, green for less, neutral for no change.
  const spentMore = deltaPct > 0;
  const spentLess = deltaPct < 0;
  const toneBackgroundStyle = spentMore
    ? styles.bannerMore
    : spentLess
      ? styles.bannerLess
      : styles.bannerSame;
  const toneTextStyle = spentMore
    ? styles.textMore
    : spentLess
      ? styles.textLess
      : styles.textSame;
  const toneColor = spentMore
    ? colors.danger
    : spentLess
      ? colors.primary
      : colors.textSecondary;

  return (
    <View style={[styles.banner, toneBackgroundStyle]}>
      <Icon name="chart.bar.fill" size={22} color={toneColor} />
      <Text style={[styles.text, toneTextStyle]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bannerMore: { backgroundColor: '#f9e9e9' },
  bannerLess: { backgroundColor: '#edf7f0' },
  bannerSame: { backgroundColor: colors.chipBg },
  text: {
    ...typography.bodyMd,
    flex: 1,
    fontWeight: '500',
  },
  textMore: { color: colors.danger },
  textLess: { color: colors.primary },
  textSame: { color: colors.textSecondary },
});
