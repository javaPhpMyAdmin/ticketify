import { StyleSheet, View } from 'react-native';

import { Icon, Text, type IconName } from '@/components';
import { colors, radii, spacing, typography } from '@/theme';

export interface MetricSummaryCardProps {
  /** Small-card label, e.g. "Top categoría" or "Promedio diario". */
  label: string;
  /** Primary value, already formatted as a string. */
  value: string;
  /** Optional secondary line below the value. */
  subtext?: string;
  /** Optional SF Symbol name rendered above the label. */
  icon?: IconName;
}

/**
 * Small summary card used under the weekly bar chart on the Analytics tab.
 *
 * Displays a label, an optional icon, a primary value, and an optional
 * secondary line. Two instances are rendered side by side: "Top categoría"
 * (with the top category name and amount) and "Promedio diario" (with the
 * daily average spend).
 */
export function MetricSummaryCard({
  label,
  value,
  subtext,
  icon,
}: MetricSummaryCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        {icon ? <Icon name={icon} size={18} color={colors.primary} /> : null}
        <Text style={styles.label}>{label}</Text>
      </View>
      <Text style={styles.value} numberOfLines={1}>
        {value}
      </Text>
      {subtext ? <Text style={styles.subtext}>{subtext}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  label: {
    ...typography.labelSm,
    color: colors.textSecondary,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  value: {
    ...typography.headlineMd,
    color: colors.textPrimary,
  },
  subtext: {
    ...typography.labelSm,
    color: colors.textSecondary,
  },
});
