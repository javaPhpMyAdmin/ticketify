import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Image, Platform, ScrollView, StyleSheet, View } from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import {
  BreakdownRowSkeleton,
  Card,
  EmptyState,
  Icon,
  Pressable,
  Text,
} from '@/components';
import {
  CategoryBudgetRow,
  InsightBanner,
  MetricSummaryCard,
  useMonthlyOverview,
  useMonthlyTotals,
  usePriceAlerts,
} from '@/features/analytics';
import type { PriceAlert } from '@/features/analytics';
import {
  InsightHeroCard,
  WeeklyBarChart,
  aggregateDailyAverage,
  aggregateSpendTrend,
  aggregateWeeklySpend,
  getTopCategory,
} from '@/features/charts';
import { getExpenseCategory } from '@/features/home/categories';
import {
  currentMonthKey,
  getAvailableMonthKeys,
  monthKeyToLabel,
  previousMonthKey,
} from '@/features/home/hooks/useHomeFeed';
import { formatCurrency } from '@/lib/format';
import { useProEntitlement } from '@/features/pro';
import { useReceiptsStore } from '@/stores/use-receipts-store';
import { useSettingsStore } from '@/stores/use-settings-store';
import { colors, radii, spacing, typography } from '@/theme';
import { useSessionStore } from '../../features/auth';

/**
 * Build a chronological window of `count` months ending at `monthKey`.
 * Used to feed the hero line chart a stable x-axis regardless of which
 * months actually have receipts.
 */
function lastNMonths(monthKey: string, count: number): string[] {
  const months: string[] = [monthKey];
  let current = monthKey;
  for (let i = 1; i < count; i++) {
    current = previousMonthKey(current);
    months.unshift(current);
  }
  return months;
}

/**
 * Same FAB-clearance pattern as the home screen: native tabs do not push
 * content past the tab bar, so we add `insets.bottom + TAB_BAR_HEIGHT` to
 * the scroll's bottom inset. Without this the last row of the category
 * breakdown sits behind the tab bar on both platforms.
 */
const ANALYTICS_TAB_BAR_HEIGHT = Platform.select({
  ios: 49,
  android: 80,
  default: 49,
});

/**
 * Analytics (Insights v2): a month-scoped dashboard. The month selector moves
 * within the months that actually have receipts (`getAvailableMonthKeys`),
 * same pattern as the History tab, and every block follows the chosen month —
 * hero card, insight banner, weekly chart, summary cards, and category rows.
 * The current month stays reachable even when it has no data yet
 * ("Sin categorías este mes."). The category breakdown keeps the existing
 * RPC-backed loading/error/empty states; the hero/weekly/summary cards are
 * store-derived and render immediately.
 */
export default function AnalyticsScreen() {
  const insets = useSafeAreaInsets();
  const list = useReceiptsStore((s) => s.list);
  const currency = useSettingsStore((s) => s.currency);
  const { isPro } = useProEntitlement();
  const [monthKey, setMonthKey] = useState(currentMonthKey);

  const monthKeys = useMemo(() => getAvailableMonthKeys(list), [list]);
  const {
    totals,
    isLoading: totalsLoading,
    error,
    hasData: totalsHasData,
    refetch,
  } = useMonthlyTotals(monthKey);
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

  // Store-derived lenses for the Insights layout. These are independent of
  // the RPC-backed category breakdown so the hero/weekly/summary cards can
  // render immediately while the breakdown section keeps its existing
  // loading/error/empty states.
  const trendData = useMemo(
    () => aggregateSpendTrend(list, lastNMonths(monthKey, 6)),
    [list, monthKey],
  );
  const weeklyData = useMemo(() => aggregateWeeklySpend(list), [list]);
  const dailyAverage = useMemo(
    () => aggregateDailyAverage(list, monthKey),
    [list, monthKey],
  );
  const topCategory = useMemo(
    () => getTopCategory(list, monthKey),
    [list, monthKey],
  );

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

      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            // Clear the native tab bar so the last row of the breakdown
            // stays visible: insets.bottom + tab bar height + a breath of
            // spacing. Without this the last category sits behind the
            // tab bar on Android (Material 3 NavigationBar is ~80dp).
            paddingBottom:
              insets.bottom + ANALYTICS_TAB_BAR_HEIGHT + spacing.lg,
          },
        ]}
      >
        <InsightHeroCard
          monthLabel={monthKeyToLabel(monthKey)}
          total={overview.currentTotal}
          deltaPct={overview.changePct}
          previousMonthLabel={previousMonthLabel}
          trendData={trendData}
          currency={currency}
        />
        <InsightBanner
          deltaPct={overview.changePct}
          previousMonthLabel={previousMonthLabel}
        />
        <ChartsEntryCard isPro={isPro} />
        {alerts.map((alert) => (
          <PriceAlertBanner key={alert.name} alert={alert} isPro={isPro} />
        ))}
        <Card>
          <Text style={styles.chartTitle}>Esta semana</Text>
          <WeeklyBarChart data={weeklyData} currency={currency} />
        </Card>
        <View style={styles.summaryRow}>
          <MetricSummaryCard
            label="Top categoría"
            value={topCategory?.name ?? '—'}
            subtext={
              topCategory
                ? formatCurrency(topCategory.amount, currency)
                : 'Sin gastos'
            }
            icon="chart.pie.fill"
          />
          <MetricSummaryCard
            label="Promedio diario"
            value={formatCurrency(dailyAverage, currency)}
            subtext="Por día en el mes"
            icon="calendar"
          />
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Por categoría</Text>
          {totalsLoading ? (
            <View style={styles.skeletonList}>
              {[0, 1, 2, 3].map((i) => (
                <BreakdownRowSkeleton key={i} />
              ))}
            </View>
          ) : error && !totalsHasData ? (
            // The failed RPC read must not render as a false "no data" —
            // show the user-safe message with a retry instead of the
            // breakdown (only when there is no retained data to keep).
            <EmptyState
              framed
              icon="exclamationmark.triangle.fill"
              title={error}
              actionLabel="Reintentar"
              onAction={() => refetch()}
            />
          ) : (
            <>
              {totals.length === 0 ? (
                <EmptyState title="Sin categorías este mes." />
              ) : (
                <Card padding={spacing.lg}>
                  <View style={styles.categoryList}>
                    {totals.map((t) => {
                      const category = getExpenseCategory(t.category_slug);
                      return (
                        <CategoryBudgetRow
                          key={t.category_id}
                          categoryKey={t.category_slug}
                          name={t.category_name}
                          amount={t.total}
                          percent={t.percent_of_total * 100}
                          icon={category.icon}
                          currency={currency}
                        />
                      );
                    })}
                  </View>
                </Card>
              )}
              {/* Background refetch failed but the last good totals are on
                  screen — keep them and add a subtle inline note. */}
              {error ? <Text style={styles.error}>{error}</Text> : null}
            </>
          )}
        </View>
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
  section: {
    gap: spacing.md,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '600',
  },
  chartTitle: {
    ...typography.bodyLg,
    color: colors.textPrimary,
    fontWeight: '700',
    marginBottom: spacing.md,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  categoryList: {
    gap: spacing.sm,
  },
  skeletonList: {
    gap: spacing.lg,
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
  entryPressable: {
    // Card already paints its own background/border; the pressable only
    // needs to fade on press for tactile feedback.
  },
  entryPressed: {
    opacity: 0.85,
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  entryIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  entryIconCircleLocked: {
    backgroundColor: colors.chipBg,
  },
  entryTextWrap: {
    flex: 1,
    gap: 2,
  },
  entryTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  entryTitle: {
    fontSize: 17,
    fontWeight: '900',
    color: colors.textPrimary,
  },
  entryBody: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  proPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.full,
    backgroundColor: colors.primary,
  },
  proPillText: {
    fontSize: 11,
    fontWeight: '900',
    color: colors.onPrimary,
    letterSpacing: 0.05 * 16,
    textTransform: 'uppercase',
  },
  alertTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  alertBannerPressed: {
    opacity: 0.85,
  },
});

/**
 * Charts entry card (pro-subscription spec — REQ-GATE-1, REQ-CHART-*).
 *
 * Single affordance linking the free analytics tab to the Pro charts
 * screen. Two render paths, both share the card shell so the layout
 * stays consistent with `MonthlyOverviewCard` above:
 *
 * - `isPro === true`: chevron + "Ver estadísticas" → `/pro/charts`.
 * - `isPro === false`: lock icon + "Estadísticas Pro" + small "Pro"
 *   pill → `/pro` (the paywall). A lock UX tells the user the feature
 *   is gated without making them guess; the Pro pill makes the upsell
 *   explicit so the path is unambiguous.
 *
 * The card is mounted after `InsightHeroCard` and `InsightBanner` so the
 * entry sits in the natural reading flow under the headline stat. While the entitlement is still `isLoading` the store defaults
 * `isPro` to `false` (M4 contract), which renders the lock UX — the
 * safest default since a free user opening the screen MUST see the
 * paywall CTA rather than a route that will bounce them back.
 */
interface ChartsEntryCardProps {
  isPro: boolean;
}

function ChartsEntryCard({ isPro }: ChartsEntryCardProps) {
  if (isPro) {
    return (
      <Pressable
        onPress={() => router.push('/pro/charts')}
        accessibilityRole="button"
        accessibilityLabel="Ver estadísticas Pro"
        style={({ pressed }) => [
          styles.entryPressable,
          pressed && styles.entryPressed,
        ]}
      >
        <Card>
          <View style={styles.entryRow}>
            <View style={styles.entryIconCircle}>
              <Icon name="chart.bar.fill" size={22} color={colors.primary} />
            </View>
            <View style={styles.entryTextWrap}>
              <Text style={styles.entryTitle}>Ver estadísticas</Text>
              <Text style={styles.entryBody}>
                Tendencias de gasto, categorías y tiendas
              </Text>
            </View>
            <Icon
              name="chevron.right"
              size={22}
              color={colors.textSecondary}
            />
          </View>
        </Card>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={() => router.push('/pro')}
      accessibilityRole="button"
      accessibilityLabel="Desbloquear Estadísticas Pro"
      style={({ pressed }) => [
        styles.entryPressable,
        pressed && styles.entryPressed,
      ]}
    >
      <Card>
        <View style={styles.entryRow}>
          <View style={[styles.entryIconCircle, styles.entryIconCircleLocked]}>
            <Icon name="lock.fill" size={22} color={colors.textSecondary} />
          </View>
          <View style={styles.entryTextWrap}>
            <View style={styles.entryTitleRow}>
              <Text style={styles.entryTitle}>Estadísticas Pro</Text>
              <View style={styles.proPill}>
                <Text style={styles.proPillText}>Pro</Text>
              </View>
            </View>
            <Text style={styles.entryBody}>
              Tendencias de gasto, categorías y tiendas
            </Text>
          </View>
          <Icon
            name="chevron.right"
            size={22}
            color={colors.textSecondary}
          />
        </View>
      </Card>
    </Pressable>
  );
}

/**
 * Price-alert banner (pro-subscription spec — REQ-GATE-2). One alert per
 * `(identity, current-month)` tuple that crossed the 5% threshold; the
 * banner is always visible (REQ-GATE-1: Pro features shown with a lock,
 * not hidden) so free users see that an alert exists and the Pro pill
 * makes the upsell explicit.
 *
 * Tap routing:
 *
 * - `isPro === true`: `onPress` navigates to the source receipt detail
 *   at `/receipts/${alert.receiptId}`. The id is captured deterministically
 *   by `computePriceAlerts` (S2: latest `purchase_date`, tie-break `id`
 *   ascending) so two runs on the same data land on the same receipt.
 * - `isPro === false`: `onPress` pushes the paywall (`/pro`). The banner
 *   content still renders so the user understands what they would unlock.
 */
interface PriceAlertBannerProps {
  alert: PriceAlert;
  isPro: boolean;
}

function PriceAlertBanner({ alert, isPro }: PriceAlertBannerProps) {
  const handlePress = () => {
    if (isPro && alert.receiptId) {
      router.push(`/receipts/${alert.receiptId}`);
    } else {
      router.push('/pro');
    }
  };
  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={
        isPro ? 'Ver recibo de la alerta de precio' : 'Desbloquear Alerta de precio Pro'
      }
      style={({ pressed }) => [
        styles.alertBanner,
        pressed && styles.alertBannerPressed,
      ]}
    >
      <Icon
        name="exclamationmark.triangle.fill"
        size={26}
        color={colors.danger}
      />
      <View style={styles.wrapTextIcon}>
        <View style={styles.alertTitleRow}>
          <Text style={styles.priceAlert}>Alerta de precio</Text>
          {!isPro ? (
            <View style={styles.proPill}>
              <Text style={styles.proPillText}>Pro</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.alertTextWrap}>
          <Text style={styles.alertText}>
            {alert.name} {alert.changePct >= 0 ? 'aumentó' : 'bajó'}{' '}
            <Text style={{ fontSize: 17.5, fontWeight: 900, color: 'black' }}>
              {Math.abs(alert.changePct)}%
            </Text>{' '}
            desde el mes pasado.
          </Text>
        </View>
      </View>
    </Pressable>
  );
}
