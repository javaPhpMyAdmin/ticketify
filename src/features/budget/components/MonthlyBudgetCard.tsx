import { StyleSheet } from 'react-native';

import { BudgetCard, Card, Text, View } from '@/components';
import { formatCurrency } from '@/lib/format';
import { colors, spacing, typography } from '@/theme';

export interface MonthlyBudgetCardProps {
  spent: number;
  limit: number;
  currency: string;
  /** When true, also renders a "Wants / Snacks" callout under the card. */
  showCallout?: boolean;
  wantsSnacksTotal?: number;
}

/**
 * Feature-level composition: a `BudgetCard` and, optionally, the
 * "Wants / Snacks" micro-expense callout that lives next to it on
 * the home screen.
 */
export function MonthlyBudgetCard({
  spent,
  limit,
  currency,
  showCallout = false,
  wantsSnacksTotal = 0,
}: MonthlyBudgetCardProps) {
  return (
    <View style={styles.wrap}>
      <BudgetCard spent={spent} limit={limit} currency={currency} />
      {showCallout ? (
        <Card style={styles.callout}>
          <Text style={styles.kicker}>MICROGASTOS</Text>
          <View style={styles.calloutRow}>
            <Text style={styles.calloutLabel}>Deseos / Snacks</Text>
            <Text style={styles.calloutAmount}>
              {formatCurrency(wantsSnacksTotal, currency)} este mes
            </Text>
          </View>
        </Card>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.lg,
  },
  callout: {
    gap: spacing.sm,
  },
  kicker: {
    ...typography.labelCaps,
    color: colors.textSecondary,
  },
  calloutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  calloutLabel: {
    ...typography.bodyLg,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  calloutAmount: {
    ...typography.labelSm,
    color: colors.primary,
    fontWeight: '700',
  },
});
