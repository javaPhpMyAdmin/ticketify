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
 * Renders a light red/pink banner with an icon and localized copy that calls
 * out the month-over-month spend change. Hidden when there is no previous-
 * month base (`deltaPct === null` or no name), per the spec edge case.
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

  return (
    <View style={styles.banner}>
      <Icon name="chart.bar.fill" size={22} color={colors.danger} />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: '#fde8e8',
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  text: {
    ...typography.bodyMd,
    flex: 1,
    color: colors.textPrimary,
    fontWeight: '500',
  },
});
