import { router } from 'expo-router';
import { StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Card, Icon, Pressable, Text, View, type IconName } from '@/components';
import { monthKeyToLabel } from '@/features/home/hooks/useHomeFeed';
import type { RunRateResult } from '@/features/home/lib/runRate';
import { formatCurrencyWhole } from '@/lib/format';
import { colors, radii, spacing, typography } from '@/theme';

export interface RunRateCardProps {
  /**
   * Aggregated run-rate. The PARENT only renders the card when this is
   * non-null (AD-6 — hidden states render nothing), so `result` is always
   * a real datum here: no skeleton, no placeholder, no focusable stub.
   */
  result: RunRateResult;
  /** ISO 4217 currency code from `useSettingsStore` (Home index.tsx:60). */
  currency: string;
  /**
   * The `YYYY-MM` bucket the result was aggregated for (the selected Home
   * month — past or current). Drives the accessibility label's month name.
   * The parent passes its own `monthKey` (R3 review) — the card derives
   * NOTHING from the wall clock, so the label can never disagree with the
   * month the figures describe.
   */
  monthKey: string;
}

/**
 * Run-rate card for the current month (spec `monthly-run-rate`, REQ-7):
 * MTD spend, a signed delta vs. the baseline (previous month's
 * same-calendar-day window OR the user's prorated average, told apart by
 * `result.source`), and a linear end-of-month projection framed as an
 * estimate («al ritmo actual cerras en ~$Z») so it never reads as a
 * guarantee (NFR-4).
 *
 * Presentational: all figures arrive pre-computed through
 * `aggregateRunRate`; tapping the card navigates to the Analytics tab.
 *
 * Badge color semantics follow `MonthlyOverviewCard`: spending ABOVE the
 * baseline is a warning tint, spending below is `primaryContainer`.
 * The delta always renders signed (`+12,5%` / `-5%` / `0%` flat — the
 * pure function already normalizes `-0`, AD-7).
 */
export function RunRateCard({ result, currency, monthKey }: RunRateCardProps) {
  // PR 3 (`app-i18n` cleanup, W3): the tap-through hint is localized via
  // the `a11y` namespace instead of a hardcoded Spanish string.
  const { t } = useTranslation('a11y');
  const up = result.deltaPct >= 0;
  const trendIcon: IconName = up ? 'arrow.up.right' : 'arrow.down.right';
  const deltaPrefix = result.deltaPct > 0 ? '+' : '';
  const sourceCopy = result.source === 'mom' ? 'mes anterior' : 'tu promedio';
  const monthLabel = monthKeyToLabel(monthKey);
  const mtd = formatCurrencyWhole(result.mtd, currency);
  const projection = formatCurrencyWhole(result.projection, currency);

  return (
    <Pressable
      onPress={() => router.push('/analytics')}
      accessibilityRole="button"
      accessibilityLabel={`Ritmo de gasto de ${monthLabel}: ${mtd} este mes, ${deltaPrefix}${result.deltaPct}% vs ${sourceCopy}; al ritmo actual cerras en ~${projection}`}
      accessibilityHint={t('openAnalytics')}
    >
      <Card>
        <View style={[styles.content, styles.contentWithBadge]}>
          <Text style={styles.kicker}>RITMO DEL MES</Text>
          <Text style={styles.total}>{mtd}</Text>
        </View>
        <View
          style={[
            styles.badge,
            { backgroundColor: up ? '#fbe3e3' : colors.primaryContainer },
          ]}
        >
          <Icon
            name={trendIcon}
            size={14}
            color={up ? 'red' : colors.primaryDark}
          />
          <Text
            style={[
              styles.badgeText,
              { color: up ? 'red' : colors.primaryDark },
            ]}
          >
            {deltaPrefix}
            {result.deltaPct}% vs {sourceCopy}
          </Text>
        </View>
        <Text style={styles.body}>
          Al ritmo actual cerras en ~{projection}
        </Text>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.sm,
    backgroundColor: colors.surface,
  },
  // Reserves room on the right for the floating badge so a wide amount
  // never slides underneath it (MonthlyOverviewCard pattern).
  contentWithBadge: {
    paddingRight: 120,
  },
  kicker: {
    fontSize: 17,
    fontWeight: '900',
    color: colors.textSecondary,
  },
  total: {
    fontSize: 33,
    fontWeight: '900',
    lineHeight: 40,
    color: colors.textPrimary,
    marginTop: spacing.xs + 15,
  },
  // Floats in the card's top-right corner, relative to the Card's padding
  // box (the Card view is the nearest positioned ancestor) — same geometry
  // as MonthlyOverviewCard's badge.
  badge: {
    position: 'absolute',
    top: spacing.xl,
    right: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
  },
  badgeText: {
    fontWeight: '900',
    fontSize: 14,
    fontStyle: 'normal',
    color: 'red',
  },
  body: {
    ...typography.bodyMd,
    color: colors.textPrimary,
    marginTop: spacing.md,
  },
});