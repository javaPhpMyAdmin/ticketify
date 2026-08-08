import { StyleSheet } from 'react-native';

import { Card, Icon, Text, View, type IconName } from '@/components';
import { formatCurrency } from '@/lib/format';
import { colors, radii, spacing, typography } from '@/theme';
import type { MonthOverview } from '../monthly-overview';

export interface MonthlyOverviewCardProps {
  overview: MonthOverview;
  currency: string;
  /** Label of the comparison month, e.g. "Julio 2026" — shown in the badge. */
  previousMonthLabel: string;
}

/**
 * Top stat card of the analytics tab: total spent this month plus a badge
 * comparing against the previous month. Badge semantics follow the design:
 * spending MORE is a warning (danger), spending less is positive (primary).
 * When there is no previous-month base (`changePct` null) the badge is
 * omitted — a missing comparison reads cleaner than a fabricated one.
 */
export function MonthlyOverviewCard({
  overview,
  currency,
  previousMonthLabel,
}: MonthlyOverviewCardProps) {
  const { currentTotal, changePct } = overview;
  const hasChange = changePct !== null;
  const up = hasChange && changePct >= 0;
  const trendIcon: IconName = up ? 'arrow.up.right' : 'arrow.down.right';

  return (
    <Card>
      <View style={[styles.content, hasChange && styles.contentWithBadge]}>
        <Text style={styles.kicker}>TOTAL GASTADO</Text>
        <Text style={styles.total}>
          {formatCurrency(currentTotal, currency)}
        </Text>
      </View>
      {hasChange ? (
        <View
          style={[
            styles.badge,
            { backgroundColor: up ? colors.danger : colors.primaryContainer },
          ]}
        >
          <Icon
            name={trendIcon}
            size={14}
            color={up ? colors.onDanger : colors.primaryDark}
          />
          <Text
            style={[
              styles.badgeText,
              { color: up ? colors.onDanger : colors.primaryDark },
            ]}
          >
            {up ? '+' : ''}
            {changePct}% vs {previousMonthLabel}
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.sm,
    backgroundColor: colors.surface,
  },
  // Reserves room on the right for the floating badge so a wide amount
  // never slides underneath it. Applied only when the badge is shown.
  contentWithBadge: {
    paddingRight: 120,
  },
  kicker: {
    ...typography.labelCaps,
    color: colors.textSecondary,
  },
  total: {
    width: '150%',
    fontSize: 40,
    fontWeight: 900,
    lineHeight: 40,
    letterSpacing: 2,
    paddingHorizontal: spacing.sm,
    // ...typography.displayCurrency,
    color: colors.textPrimary,
    marginTop: spacing.xs + 15,
  },
  // Floats in the card's top-right corner (matches the reference capture:
  // the badge is NOT in the same row as the amount). The Card view is the
  // nearest positioned ancestor, so top/right are relative to its padding
  // box — aligned with the content edge (spacing.lg = the Card's padding).
  badge: {
    position: 'absolute',
    top: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
  },
  badgeText: {
    ...typography.labelSm,
    fontWeight: '700',
  },
});
