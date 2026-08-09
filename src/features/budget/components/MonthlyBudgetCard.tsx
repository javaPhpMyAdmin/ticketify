import { StyleSheet } from 'react-native';

import { BudgetCard, Card, Text, View } from '@/components';
import { formatCurrency } from '@/lib/format';
import { colors, spacing } from '@/theme';

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
          <View style={{ backgroundColor: colors.surface }}>
            <Text style={styles.kicker}>MICROGASTOS</Text>
            <Text style={styles.calloutLabel}>Antojos/Snacks</Text>
          </View>
          <View style={styles.calloutRow}>
            <View
              style={{
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.surface,
              }}
            >
              <Text
                style={{
                  fontSize: 18,
                  fontWeight: '900',
                  color: colors.primary,
                }}
              >
                {formatCurrency(wantsSnacksTotal, currency)}
              </Text>
              <Text style={styles.calloutAmount}>este mes</Text>
            </View>
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
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  kicker: {
    // ...typography.labelCaps,
    fontSize: 17,
    fontWeight: '900',
    color: colors.textSecondary,
  },
  calloutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
  },
  calloutLabel: {
    // ...typography.bodyLg,
    color: colors.textPrimary,
    top: 2,
    fontWeight: '600',
    fontSize: 22,
  },
  calloutAmount: {
    // ...typography.labelSm,
    color: colors.textSecondary,
    fontSize: 16,
    fontWeight: '700',
  },
});
