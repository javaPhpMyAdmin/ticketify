import { StyleSheet, View } from 'react-native';

import { Icon, Text } from '@/components';
import { colors, radii, spacing, typography } from '@/theme';

export interface InsightBannerProps {
  /** Month-over-month percentage change. */
  deltaPct: number | null;
  /** Label of the comparison month, e.g. "Julio 2026". */
  previousMonthLabel?: string | null;
}

/**
 * Insight banner below the Analytics hero.
 *
 * Renders a light red/pink banner with an icon and Spanish copy that calls
 * out the month-over-month spend change. Hidden when there is no previous-
 * month base (`deltaPct === null` or no label), per the spec edge case.
 */
export function InsightBanner({
  deltaPct,
  previousMonthLabel,
}: InsightBannerProps) {
  if (deltaPct === null || !previousMonthLabel) {
    return null;
  }

  const previousMonthName = previousMonthLabel.split(' ')[0];
  const absPct = Math.abs(Math.round(deltaPct));

  let message: string;
  if (deltaPct > 0) {
    message = `Gastaste un ${absPct}% más que en ${previousMonthName}.`;
  } else if (deltaPct < 0) {
    message = `Gastaste un ${absPct}% menos que en ${previousMonthName}.`;
  } else {
    message = `Gastaste lo mismo que en ${previousMonthName}.`;
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
