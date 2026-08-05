import { StyleSheet } from 'react-native';

import { AmountDisplay, Card, ProgressBar, Text, View } from '@/components';
import { colors, spacing, typography } from '@/theme';

export interface BudgetCardProps {
  /** How much has been spent this month. */
  spent: number;
  /** The cap (e.g. monthly target budget). */
  limit: number;
  /** ISO 4217 currency code. */
  currency: string;
  /** Optional kicker label override. */
  kicker?: string;
  /** Optional limit label override. */
  limitLabel?: string;
}

/**
 * The "MONTHLY TARGET BUDGET" card. Renders a kicker + limit label,
 * the spent amount as a big `AmountDisplay`, a percent-used indicator,
 * and a `ProgressBar` fill. The percent is clamped to 0..1.
 */
export function BudgetCard({
  spent,
  limit,
  currency,
  kicker = 'PRESUPUESTO OBJETIVO MENSUAL',
  limitLabel,
}: BudgetCardProps) {
  const percent = limit > 0 ? Math.min(1, spent / limit) : 0;
  const resolvedLimitLabel = limitLabel ?? `Límite: ${currency} ${limit.toLocaleString()}`;
  return (
    <Card>
      <View style={styles.cardHeader}>
        <Text style={styles.kicker}>{kicker}</Text>
        <Text style={styles.limitLabel}>{resolvedLimitLabel}</Text>
      </View>
      <View style={styles.budgetRow}>
        <AmountDisplay value={spent} currency={currency} />
        <View style={styles.budgetMeta}>
          <Text style={styles.percent}>{Math.round(percent * 100)}% usado</Text>
        </View>
      </View>
      <View style={styles.progressWrap}>
        <ProgressBar value={percent} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  kicker: {
    ...typography.labelCaps,
    color: colors.textSecondary,
  },
  limitLabel: {
    ...typography.labelSm,
    color: colors.textSecondary,
  },
  budgetRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  budgetMeta: {
    paddingBottom: spacing.xs,
  },
  percent: {
    ...typography.labelSm,
    color: colors.primary,
    fontWeight: '700',
  },
  progressWrap: {
    marginTop: spacing.lg,
  },
});
