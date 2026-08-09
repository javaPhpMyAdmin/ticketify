import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
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
import { useSessionStore } from '../../features/auth';

/**
 * Analytics (RPC): a month-scoped dashboard. The month selector moves
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
  const { session } = useSessionStore();
  const fullName =
    session?.user?.user_metadata?.full_name ??
    session?.user?.user_metadata?.name ??
    '';
  const firstName = fullName.trim().split(' ')[0];
  const displayName = firstName || 'Usuario';
  const avatarUrl = session?.user?.user_metadata?.avatar_url;

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
      <View style={styles.header}>
        <Pressable
          onPress={() => router.push('/profile')}
          accessibilityLabel="Abrir perfil"
          accessibilityRole="button"
        >
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarInitial}>
                {displayName.charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
        </Pressable>
        <Text style={styles.title}>Ticketify</Text>
        <Icon name="qr-code-scanner" size={33} color={colors.primary} />
      </View>
      <View style={styles.fixedHeader}>
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
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {error ? <Text style={styles.error}>{error}</Text> : null}

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
  fixedHeader: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 25,
  },
  avatarFallback: {
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    ...typography.headlineMd,
    color: colors.background,
  },
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
    fontSize: 25,
    fontWeight: '900',
    color: colors.primary,
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
    // ...typography.headlineMd,
    fontSize: 20,
    fontWeight: '900',
    color: colors.textSecondary,
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
