import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

import { Text, View } from '@/components/atoms';
import { AmountDisplay } from '@/components/molecules/AmountDisplay';
import { Card } from '@/components/molecules/Card';
import { ProgressBar } from '@/components/molecules/ProgressBar';
import { colors, spacing } from '@/theme';
import { formatCurrency } from '../../../lib/format';

/** One currency's own recorded total — never summed across units. */
export interface BudgetUnitTotal {
  currency: string;
  total: number;
}

export interface BudgetCardProps {
  /** How much has been spent this month in the VIEWER currency. */
  spent: number;
  /** The cap (e.g. monthly target budget). */
  limit: number;
  /** ISO 4217 currency code (the viewer unit). */
  currency: string;
  /**
   * 0..1, or `null` when no honest percentage exists: the viewer currency has
   * no receipts this month but other units do (issue #214). `null` suppresses
   * BOTH the percent text and the progress bar; a genuine `0` still renders
   * `0%` + the (empty) bar. The card NEVER recomputes the ratio — this is the
   * hook's value, the single source of truth.
   */
  percent: number | null;
  /**
   * The real totals recorded this month in units OTHER than the viewer
   * currency, each shown under its own symbol. Non-empty ⇒ the currency-
   * mismatch state: the big number becomes these totals and the clarification
   * line shows, instead of a false `0 / 0%` under the viewer symbol.
   */
  foreignUnitTotals?: BudgetUnitTotal[];
  /** Optional kicker label override (defaults to the localized "monthly budget"). */
  kicker?: string;
  /** Optional limit label override (defaults to the localized "Limit:"). */
  limitLabel?: string;
}

/**
 * The "monthly budget" card. Renders a kicker + limit label, the spent
 * amount as a big `AmountDisplay`, a percent-used indicator, and a
 * `ProgressBar` fill. The percent is clamped to 0..1 by the hook. All copy
 * reads from the `settings` namespace (it owns the `monthlyBudget*` domain).
 *
 * Currency-mismatch state (issue #214): when the viewer currency has no
 * receipts but other units do, this renders each foreign unit's total under
 * its OWN symbol plus a clarification, and omits the percent text and the
 * progress bar — a confident `0 / 0%` would be a false claim. No FX: the
 * foreign totals are shown as recorded, never converted.
 */
export function BudgetCard({
  spent,
  limit,
  currency,
  percent,
  foreignUnitTotals,
  kicker,
  limitLabel,
}: BudgetCardProps) {
  const { t } = useTranslation('settings');
  const kickerText = kicker ?? t('budgetCardKicker');
  const limitLabelText = limitLabel ?? t('budgetLimitLabel');
  const foreignTotals = foreignUnitTotals ?? [];
  const hasForeignTotals = foreignTotals.length > 0;
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
          <Text style={styles.kicker}>{kickerText}</Text>
          {hasForeignTotals ? (
            foreignTotals.map((unit) => (
              <AmountDisplay
                key={unit.currency}
                value={unit.total}
                currency={unit.currency}
              />
            ))
          ) : (
            <AmountDisplay value={spent} currency={currency} />
          )}
          {hasForeignTotals ? (
            <Text style={styles.mismatchNote}>
              {t('budgetCurrencyMismatch', { currency })}
            </Text>
          ) : null}
        </View>
        <View style={styles.budgetMeta}>
          <Text style={styles.limitLabel}>{limitLabelText}</Text>
          <Text style={styles.limitLabel}>
            {formatCurrency(limit, currency)}
          </Text>
          {percent !== null ? (
            <Text style={styles.percent}>
              {t('budgetPercentUsed', {
                percent: Math.round(percent * 100),
              })}
            </Text>
          ) : null}
        </View>
      </View>
      {percent !== null ? (
        <View style={styles.progressWrap}>
          <ProgressBar value={percent} />
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  cardHeader: {
    flexDirection: 'column',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    // Grow past 80 when the mismatch state stacks several unit totals +
    // the clarification line; a single amount still renders at 80.
    minHeight: 80,
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
  mismatchNote: {
    marginTop: spacing.xs,
    fontSize: 13,
    fontWeight: '700',
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
