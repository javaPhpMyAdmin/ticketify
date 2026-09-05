import { StyleSheet } from 'react-native';

import { Text, View } from '@/components/atoms';
import { AmountDisplay } from '@/components/molecules/AmountDisplay';
import { Card } from '@/components/molecules/Card';
import { ProgressBar } from '@/components/molecules/ProgressBar';
import { colors, spacing } from '@/theme';
import { formatCurrency } from '../../../lib/format';

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
  kicker = 'PRESUPUESTO MENSUAL',
  limitLabel,
}: BudgetCardProps) {
  const percent = limit > 0 ? Math.min(1, spent / limit) : 0;
  return (
    <Card
      style={{
        borderLeftWidth: 4,
        borderLeftColor: colors.primary,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          justifyContent: 'space-between',
          backgroundColor: colors.surface,
          width: '100%',
        }}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.kicker}>{kicker}</Text>
          <AmountDisplay value={spent} currency={currency} />
        </View>
        <View style={styles.budgetMeta}>
          <Text style={styles.limitLabel}>Límite:</Text>
          <Text style={styles.limitLabel}>
            {formatCurrency(limit, currency)}
          </Text>
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
    flexDirection: 'column',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    height: 80,
  },
  kicker: {
    color: colors.textSecondary,
    fontSize: 17,
    fontWeight: '900',
  },
  limitLabel: {
    fontSize: 15.5,
    fontWeight: '800',
    color: colors.textSecondary,
  },
  budgetRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
  },
  budgetMeta: {
    paddingBottom: spacing.xs,
    backgroundColor: colors.surface,
    width: '35%',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  percent: {
    // ...typography.labelSm,
    fontSize: 17,
    color: colors.primary,
    fontWeight: '900',
  },
  progressWrap: {
    marginTop: spacing.lg,
  },
});
