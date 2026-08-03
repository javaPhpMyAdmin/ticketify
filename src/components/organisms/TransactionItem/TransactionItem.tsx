import { StyleSheet } from 'react-native';

import { Divider, Text, View } from '@/components';
import { formatCurrency, formatTime } from '@/lib/format';
import { colors, spacing, typography } from '@/theme';

export type TransactionKind = 'all' | 'needs' | 'wants' | 'income';

export interface TransactionItemProps {
  merchant: string;
  date: string; // ISO
  category: string;
  /** The amount to display — derived via `useTransactionBreakdown`. */
  amount: number;
  /** Optional NEEDS / WANTS / INCOME line rendered below the meta. */
  breakdown?: string;
  /** When true, renders the amount in the income tint. */
  isIncome?: boolean;
  /** Hide the divider rendered after this row (parent decides). */
  hideDivider?: boolean;
}

/**
 * A row in the history list. Shows merchant + time + category and the
 * pre-derived amount / breakdown. Pure render — the derivation lives
 * in `useTransactionBreakdown` (features/transactions).
 */
export function TransactionItem({
  merchant,
  date,
  category,
  amount,
  breakdown,
  isIncome = false,
  hideDivider = false,
}: TransactionItemProps) {
  return (
    <>
      <View style={styles.row}>
        <View style={styles.middle}>
          <Text style={styles.merchant}>{merchant}</Text>
          <Text style={styles.meta}>
            {formatTime(date)} • {category}
          </Text>
          {breakdown !== undefined ? (
            <Text style={styles.breakdown}>{breakdown}</Text>
          ) : null}
        </View>
        <Text style={[styles.amount, isIncome ? styles.income : null]}>
          {formatCurrency(amount)}
        </Text>
      </View>
      {hideDivider ? null : <Divider />}
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    gap: spacing.md,
  },
  middle: {
    flex: 1,
    gap: 2,
  },
  merchant: {
    ...typography.bodyLg,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  meta: {
    ...typography.bodyMd,
    color: colors.textSecondary,
  },
  breakdown: {
    ...typography.labelCaps,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  amount: {
    ...typography.headlineMd,
    color: colors.textPrimary,
  },
  income: {
    color: colors.primary,
  },
});
