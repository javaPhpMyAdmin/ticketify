import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet } from 'react-native';

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
  /**
   * True while the unresolved household headline is still loading. Renders
   * a spinner + "Loading household data…" instead of the bare "—" dash;
   * on error (false) the neutral dash stays and the body shows the error.
   */
  isLoading?: boolean;
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
  isLoading = false,
}: MonthlyOverviewCardProps) {
  const { t } = useTranslation('analytics');
  const hasChange = changePct !== null;
  const up = hasChange && changePct >= 0;
  const trendIcon: IconName = up ? 'arrow.up.right' : 'arrow.down.right';
  const groups = totals ?? [];

  return (
    <Card>
      {hasChange ? (
        <View style={styles.badgeRow}>
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
        </View>
      ) : null}
      <View style={styles.content}>
        <Text style={styles.kicker}>{t('overviewKicker')}</Text>
        {totals === null ? (
          isLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.loadingText}>{t('loadingHousehold')}</Text>
            </View>
          ) : (
            <Text style={styles.total}>—</Text>
          )
        ) : (
          groups.map((group) => (
            <Text key={group.currency ?? 'viewer'} style={styles.total}>
              {formatCurrency(group.total, group.currency ?? viewerCurrency)}
            </Text>
          ))
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.sm,
    backgroundColor: colors.surface,
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
  // Loading placeholder keeps the headline's footprint (same top margin +
  // 40pt line) so swapping in the real figure doesn't shift the card.
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 40,
    marginTop: spacing.xs + 15,
    backgroundColor: 'transparent',
  },
  loadingText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  // Top chip row: the badge renders first inside the Card, in normal flow,
  // so it can never overlap the kicker/amount text below it.
  badgeRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    backgroundColor: 'transparent',
  },
  badge: {
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
