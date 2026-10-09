import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

import { Card, Icon, Text, View, type IconName } from '@/components';
import { formatCurrency } from '@/lib/format';
import { colors, radii, spacing } from '@/theme';
import type { CurrencyTotal } from '@/types';

export interface MonthlyOverviewCardProps {
  /**
   * Per-unit headline figures (decision 9). A mixed month renders ONE
   * labeled figure per currency; a single-currency month renders today's
   * single figure (client-state s1). `null` renders the neutral placeholder
   * ("—") — the headline scope has not resolved yet, so the card never
   * states a false "$0.00".
   */
  totals: CurrencyTotal[] | null;
  /** Signed change-% badge value; null omits the badge. */
  changePct: number | null;
  /** Name of the comparison month, e.g. "Julio" — shown in the badge. */
  previousMonthName: string;
  /** Viewer currency fallback for groups without a unit (legacy rows). */
  currency: string;
}

/**
 * Top stat card of the analytics tab: total spent this month plus a badge
 * comparing against the previous month. Badge semantics follow the design:
 * spending MORE is a warning (danger), spending less is positive (primary).
 * When there is no previous-month base (`changePct` null) the badge is
 * omitted — a missing comparison reads cleaner than a fabricated one.
 */
export function MonthlyOverviewCard({
  totals,
  changePct,
  previousMonthName,
  currency: viewerCurrency,
}: MonthlyOverviewCardProps) {
  const { t } = useTranslation('analytics');
  const hasChange = changePct !== null;
  const up = hasChange && changePct >= 0;
  const trendIcon: IconName = up ? 'arrow.up.right' : 'arrow.down.right';
  const groups = totals ?? [];

  return (
    <Card>
      <View style={[styles.content, hasChange && styles.contentWithBadge]}>
        <Text style={styles.kicker}>{t('overviewKicker')}</Text>
        {totals === null ? (
          <Text style={styles.total}>—</Text>
        ) : (
          groups.map((group) => (
            <Text key={group.currency ?? 'viewer'} style={styles.total}>
              {formatCurrency(group.total, group.currency ?? viewerCurrency)}
            </Text>
          ))
        )}
      </View>
      {hasChange ? (
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
            {up ? '+' : ''}
            {changePct}% {t('overviewBadge', { month: previousMonthName })}
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
    fontSize: 17,
    fontWeight: 900,
    color: colors.textSecondary,
  },
  total: {
    fontSize: 25,
    fontWeight: 900,
    lineHeight: 40,
    color: colors.textPrimary,
    marginTop: spacing.xs + 15,
  },
  // Floats in the card's top-right corner (matches the reference capture:
  // the badge is NOT in the same row as the amount). The Card view is the
  // nearest positioned ancestor, so top/right are relative to its padding
  // box — aligned with the content edge (spacing.lg = the Card's padding).
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
});
