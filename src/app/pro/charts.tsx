/**
 * Pro charts screen (pro-subscription spec — REQ-CHART-1..6).
 *
 * Wraps the body in `<ProRouteGuard>` so a free user opening `/pro/charts`
 * sees the lock screen instead of the charts; once entitled, the body
 * renders the full Pro experience — the Insights v2 redesign that used to
 * live in the free analytics tab: hero spend card, insight banner, weekly
 * bar chart, summary cards, and the category budget rows.
 *
 * The month selector moves within the months that actually have receipts
 * (`getAvailableMonthKeys`), same pattern as the History tab, and every
 * month-scoped block follows the chosen month — hero, banner, summary
 * cards, and category rows. The weekly chart is store-derived and covers
 * the current week regardless of the selected month. The category rows
 * keep the RPC-backed loading/error/empty states; the hero/weekly/summary
 * cards are store-derived and render immediately.
 *
 * "Volver" closes the route — the screen is always pushed from the
 * analytics charts entry card, so back is the right action.
 */
import { Stack, router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

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
} from '@/features/analytics';
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
import { ProRouteGuard } from '@/features/pro';
import { useReceiptsStore } from '@/stores/use-receipts-store';
import { useSettingsStore } from '@/stores/use-settings-store';
import { colors, radii, spacing, typography } from '@/theme';

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

export default function ChartsScreen() {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <Stack.Screen options={{ title: 'Estadísticas Pro' }} />
      <ProRouteGuard
        lockTitle="Estadísticas Pro"
        lockBody="Las gráficas avanzadas están incluidas en Pro. Suscribite para desbloquearlas."
        lockActionLabel="Conocer Pro"
      >
        <ChartsBody />
      </ProRouteGuard>
    </SafeAreaView>
  );
}

/**
 * Charts body. Pulled out so the `<ProRouteGuard>` doesn't re-mount the
 * scroll view + month selector every time the gate flips — the lock is
 * the only thing that swaps.
 */
function ChartsBody() {
  // The home feed hook owns the `records` query and hydrates the
  // receipts store; reading the store directly is the same data path
  // the History tab takes, so all screens stay in sync.
  const list = useReceiptsStore((s) => s.list);
  const currency = useSettingsStore((s) => s.currency);
  const [monthKey, setMonthKey] = useState(currentMonthKey);

  const monthKeys = useMemo(() => getAvailableMonthKeys(list), [list]);
  const {
    totals,
    isLoading: totalsLoading,
    error,
    hasData: totalsHasData,
    refetch,
  } = useMonthlyTotals(monthKey);
  const overview = useMonthlyOverview(monthKey);

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
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <View style={styles.header}>
        <Text style={styles.title}>Tus tendencias</Text>
        <Text style={styles.subtitle}>
          Visualizá tu gasto a lo largo del tiempo, por categoría y por semana.
        </Text>
      </View>

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

      <Pressable
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Volver"
        style={({ pressed }) => [
          styles.backButton,
          pressed && styles.backPressed,
        ]}
      >
        <Icon name="arrow.left" size={18} color={colors.primary} />
        <Text style={styles.backText}>Volver</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  header: {
    gap: spacing.xs,
  },
  title: {
    ...typography.headlineLg,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.bodyMd,
    color: colors.textSecondary,
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
    fontSize: 20,
    fontWeight: '900',
    color: colors.textSecondary,
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
  section: {
    gap: spacing.md,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '600',
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
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radii.lg,
  },
  backPressed: {
    opacity: 0.85,
  },
  backText: {
    ...typography.bodyMd,
    color: colors.primary,
    fontWeight: '700',
  },
});
