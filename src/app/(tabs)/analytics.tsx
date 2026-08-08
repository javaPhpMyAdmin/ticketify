import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon, Pressable, Text } from '@/components';
import {
  CategoryBreakdownList,
  MonthlyOverviewCard,
  TopItemsBreakdown,
  useMonthlyOverview,
  useMonthlyTotals,
  usePriceAlerts,
} from '@/features/analytics';
import {
  aggregateItemsByMonth,
  currentMonthKey,
  getAvailableMonthKeys,
  monthKeyToLabel,
  previousMonthKey,
} from '@/features/home/hooks/useHomeFeed';
import { useReceiptsStore } from '@/stores/use-receipts-store';
import { useSettingsStore } from '@/stores/use-settings-store';
import { colors, radii, spacing, typography } from '@/theme';

/**
 * Analytics (mock + RPC): a month-scoped dashboard. The month selector moves
 * within the months that actually have receipts (`getAvailableMonthKeys`),
 * same pattern as the History tab, and every block follows the chosen month —
 * overview card, price alerts, top items, and category totals. The current
 * month stays reachable even when it has no data yet ("Sin artículos este
 * mes."). The subtitle keeps the live UTC month because `useMonthlyTotals`
 * defaults to it.
 */
export default function AnalyticsScreen() {
  const list = useReceiptsStore((s) => s.list);
  const currency = useSettingsStore((s) => s.currency);
  const [monthKey, setMonthKey] = useState(currentMonthKey);

  const monthKeys = useMemo(() => getAvailableMonthKeys(list), [list]);
  const { totals, error } = useMonthlyTotals(monthKey);
  const alerts = usePriceAlerts(monthKey);
  const overview = useMonthlyOverview(monthKey);

  // Full month item list feeds the bar denominator (percent of the whole
  // month, not of the top-N slice); only the top 5 rows render. Utility
  // bills (servicios) are excluded: they would own the ranking as receipt
  // line items, but they are not consumption.
  const allItems = useMemo(
    () => aggregateItemsByMonth(list, monthKey, ['servicios']),
    [list, monthKey],
  );
  const topItems = allItems.slice(0, 5);
  const monthTotal = allItems.reduce((sum, item) => sum + item.amount, 0);

  // `monthKeys` is newest-first. The selected month may not be in it (e.g.
  // the current month with no receipts yet): it is then newer than
  // everything, so only "older" is enabled and it jumps to the newest
  // month that has data.
  const currentIndex = monthKeys.indexOf(monthKey);
  const canGoNewer = currentIndex > 0;
  const canGoOlder =
    currentIndex === -1
      ? monthKeys.length > 0
      : currentIndex < monthKeys.length - 1;

  const goOlder = () =>
    setMonthKey(
      currentIndex === -1 ? monthKeys[0] : monthKeys[currentIndex + 1],
    );
  const goNewer = () => setMonthKey(monthKeys[currentIndex - 1]);

  const previousMonthLabel = monthKeyToLabel(previousMonthKey(monthKey));

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.monthSelector}>
          <Pressable
            onPress={goOlder}
            disabled={!canGoOlder}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Mes anterior"
            accessibilityState={{ disabled: !canGoOlder }}
          >
            <Icon
              name="chevron.left"
              size={22}
              color={canGoOlder ? colors.textPrimary : colors.textSecondary}
            />
          </Pressable>
          <Text style={styles.monthLabel}>{monthKeyToLabel(monthKey)}</Text>
          <Pressable
            onPress={goNewer}
            disabled={!canGoNewer}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Mes siguiente"
            accessibilityState={{ disabled: !canGoNewer }}
          >
            <Icon
              name="chevron.right"
              size={22}
              color={canGoNewer ? colors.textPrimary : colors.textSecondary}
            />
          </Pressable>
        </View>

        <MonthlyOverviewCard
          overview={overview}
          currency={currency}
          previousMonthLabel={previousMonthLabel}
        />
        {alerts.map((alert) => (
          <View key={alert.name} style={styles.alertBanner}>
            <Icon
              name="exclamationmark.triangle.fill"
              size={26}
              color={colors.danger}
            />
            <View style={styles.wrapTextIcon}>
              <Text style={styles.priceAlert}>Alerta de precio</Text>
              <View style={styles.alertTextWrap}>
                <Text style={styles.alertText}>
                  {alert.name} {alert.changePct >= 0 ? 'aumentó' : 'bajó'}{' '}
                  <Text
                    style={{ fontSize: 17.5, fontWeight: 900, color: 'black' }}
                  >
                    {Math.abs(alert.changePct)}%
                  </Text>{' '}
                  desde el mes pasado.
                </Text>
              </View>
            </View>
          </View>
        ))}
        <TopItemsBreakdown
          rows={topItems}
          total={monthTotal}
          currency={currency}
          title="Top Artículos"
        />
        <CategoryBreakdownList rows={totals} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrapTextIcon: {
    flexDirection: 'column',
    paddingLeft: 5,
    // alignItems: 'center',
    // justifyContent: 'space-between',
  },
  priceAlert: {
    fontSize: 20,
    fontWeight: 900,
    color: colors.danger,
    padding: 2,
  },
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  title: {
    ...typography.headlineLg,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.bodyMd,
    color: colors.textSecondary,
    marginTop: -spacing.md,
  },
  error: {
    ...typography.labelSm,
    color: colors.danger,
  },
  monthSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  monthLabel: {
    ...typography.headlineMd,
    color: colors.textPrimary,
  },
  alertBanner: {
    height: 100,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: '#f9e9e9',
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: '#fbbbbb',
    padding: spacing.md,
  },
  alertTextWrap: {
    flex: 1,
    width: '90%',
  },
  alertText: {
    // ...typography.bodyMd,
    fontSize: 15.5,
    fontWeight: '500',
    color: colors.textPrimary,
    flexWrap: 'wrap',
  },
});
