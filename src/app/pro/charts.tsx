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
 * month-scoped block follows the chosen month — hero (daily spend curve,
 * servicios included), banner, summary cards, category rows, and the
 * per-store bars. The weekly chart is store-derived and covers the
 * current week regardless of the selected month; utility bills
 * ("servicios") are excluded from the daily bars, the daily average, and
 * the day-detail sheet. Tapping a daily bar opens the day's item detail;
 * tapping a store bar drills into `/stores/[name]?month=...`. The
 * category rows keep the RPC-backed loading/error/empty states; the
 * hero/weekly/summary/store cards are store-derived and render
 * immediately.
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
  CapsuleBarChart,
  DayDetailModal,
  StoreBars,
  aggregateDailyAverage,
  aggregateDailySpend,
  aggregateDayItems,
  aggregateDayTotal,
  aggregateSpendTrend,
  aggregateStoresByMonth,
  aggregateWeeklySpend,
  aggregateYearlySpend,
  categoryDetailHref,
  getMondayOfWeek,
  getTopCategory,
  pickMaxSpendIndex,
  WEEKDAY_NAMES,
} from '@/features/charts';
import { getExpenseCategory } from '@/features/home/categories';
import {
  currentMonthKey,
  getAvailableMonthKeys,
  monthKeyToLabel,
  previousMonthKey,
} from '@/features/home/hooks/useHomeFeed';
import { formatCurrency, MONTHS_SHORT_ES, todayLocalISO, yearLabel } from '@/lib/format';
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

/** Granularity of the capsule bar chart card. */
type ChartPeriod = 'week' | 'month' | 'year';

const PERIOD_OPTIONS: { key: ChartPeriod; label: string }[] = [
  { key: 'week', label: 'Por día' },
  { key: 'month', label: 'Por mes' },
  { key: 'year', label: 'Por año' },
];

/**
 * Capitalized Spanish short month name for a `YYYY-MM` key (e.g.
 * `2026-08` → `Ago`), matching the chart label style of the reference.
 */
function shortMonthLabel(monthKey: string): string {
  const month = Number(monthKey.slice(5, 7));
  const label = MONTHS_SHORT_ES[month - 1] ?? '';
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * ISO date of the `index`-th day of the week whose Monday is
 * `weekStartISO` (0 = Monday), using the exact same Monday-start math as
 * `aggregateWeeklySpend` so the tapped bar and the bar's amount always
 * agree. The week start comes from the caller (one local-derived value
 * shared by the bars, the highlight, and this tap mapping — they can
 * never diverge).
 */
function weekDayISO(weekStartISO: string, index: number): string {
  const date = new Date(`${weekStartISO}T00:00:00`);
  date.setDate(date.getDate() + index);
  return date.toISOString().slice(0, 10);
}

/** Full weekday + day-of-month label for a day ISO, e.g. "Lunes 11". */
function dayLabel(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00`);
  return `${WEEKDAY_NAMES[date.getDay()]} ${date.getDate()}`;
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
  const [period, setPeriod] = useState<ChartPeriod>('week');
  // ISO date of the day whose detail sheet is open (`null` = closed). Only
  // the week view opens it — bars in the month/year views stay inert.
  const [tappedDay, setTappedDay] = useState<string | null>(null);

  const monthKeys = useMemo(() => getAvailableMonthKeys(list), [list]);

  // Monday of the current week, derived from the LOCAL today. Single source
  // of truth for the weekly bars, the today highlight, and the tap → day
  // ISO: a UTC slice (`toISOString`) drifts a day for late-evening stamps
  // in UTC-x zones (Sunday evening would mis-highlight and mis-week), so
  // the app convention is `todayLocalISO()` everywhere else — this keeps
  // the week chart on the same calendar.
  const weekStartISO = useMemo(() => getMondayOfWeek(todayLocalISO()), []);

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
  // Daily spend curve for the hero line chart: one point per day of the
  // selected month, zero-filled, `receipt.total` (servicios included —
  // the hero header total includes them too).
  const dailySpend = useMemo(
    () => aggregateDailySpend(list, monthKey),
    [list, monthKey],
  );
  // Per-store totals for the "Por tienda" horizontal bars (month-scoped).
  const stores = useMemo(
    () => aggregateStoresByMonth(list, monthKey),
    [list, monthKey],
  );
  const dailyAverage = useMemo(
    () => aggregateDailyAverage(list, monthKey, ['servicios']),
    [list, monthKey],
  );
  const topCategory = useMemo(
    () => getTopCategory(list, monthKey),
    [list, monthKey],
  );

  // Check if any budgets are configured for the selected month
  const hasAnyBudgets = useMemo(
    () => totals.some((t) => t.budget_limit !== null),
    [totals],
  );
  // Line items for the open day-detail sheet. `tappedDay` guards the
  // aggregator so it never runs on an empty ISO date.
  const tappedDayItems = useMemo(() => {
    if (!tappedDay) return [];
    const dayReceipts = list.filter((r) => r.purchase_date.slice(0, 10) === tappedDay);
    if (dayReceipts.length > 0) {
      console.warn(`[day-detail] ${tappedDay}: ${dayReceipts.length} receipts`, dayReceipts.map((r) => ({
        id: r.id,
        store: r.store_name,
        total: r.total,
        itemsLen: r.items?.length ?? 'undef',
        catTotals: r.category_totals,
      })));
    }
    return aggregateDayItems(list, tappedDay, ['servicios']);
  }, [list, tappedDay]);
  // Headline total for the open day-detail sheet — the EXACT number the
  // weekly bar showed for that day (`aggregateDayTotal`: receipt totals
  // minus servicios, clamped at 0). The item list alone can't reproduce
  // it (items are pre-discount lines), so the modal displays this instead
  // of re-summing the rows.
  const tappedDayTotal = useMemo(
    () => (tappedDay ? aggregateDayTotal(list, tappedDay, ['servicios']) : 0),
    [list, tappedDay],
  );

  // ── Annual trend card ──────────────────────────────────────────────
  const currentYear = String(new Date().getFullYear());
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const availableYears = useMemo(
    () =>
      [...new Set(list.map((r) => r.purchase_date.slice(0, 4)))].sort(),
    [list],
  );
  const monthsOfYear = useMemo(() => {
    const y = selectedYear;
    return Array.from({ length: 12 }, (_, i) =>
      `${y}-${String(i + 1).padStart(2, '0')}`,
    );
  }, [selectedYear]);
  const annualTrend = useMemo(
    () => aggregateSpendTrend(list, monthsOfYear),
    [list, monthsOfYear],
  );
  const hasAnnualData = annualTrend.some((p) => p.total > 0);
  const currentMonthIdx = new Date().getMonth(); // 0–11
  const highlightIdx = selectedYear === currentYear ? currentMonthIdx : -1;

  const canGoPrevYear =
    availableYears.length > 0 && selectedYear > availableYears[0];
  const canGoNextYear = selectedYear < currentYear;
  const goPrevYear = () =>
    setSelectedYear(String(Number(selectedYear) - 1));
  const goNextYear = () =>
    setSelectedYear(String(Number(selectedYear) + 1));

  /**
   * Items for the capsule bar chart card, derived from the selected
   * granularity. The highlight marks the "active" bucket: the max-spend
   * day for the week view, the last (selected) month for the 6-month
   * trend, and the current calendar year for the year view.
   */
  const chartData = useMemo(() => {
    if (period === 'week') {
      // The highlighted bar is the day with the HIGHEST amount (first max
      // wins when tied); when every day is $0 no bar is highlighted. The
      // week start comes from `weekStartISO` (local-derived, shared with
      // the tap→day mapping), so bars and the detail sheet stay aligned.
      const weekPoints = aggregateWeeklySpend(list, weekStartISO, ['servicios']);
      const maxIndex = pickMaxSpendIndex(weekPoints.map((p) => p.amount));
      return {
        title: 'Esta semana',
        // Utility bills (servicios) stay out of the daily bars — the same
        // exclusion the day-detail sheet applies.
        items: weekPoints.map((point, index) => ({
          label: point.initial,
          value: point.amount,
          highlight: maxIndex === index,
        })),
      };
    }
    if (period === 'month') {
      const lastIndex = trendData.length - 1;
      return {
        title: 'Últimos 6 meses',
        items: trendData.map((point, index) => ({
          label: shortMonthLabel(point.month),
          value: point.total,
          highlight: index === lastIndex,
        })),
      };
    }
    const currentYear = String(new Date().getFullYear());
    return {
      title: 'Por año',
      items: aggregateYearlySpend(list).map((point) => ({
        label: point.year,
        value: point.total,
        highlight: point.year === currentYear,
      })),
    };
  }, [list, period, trendData, weekStartISO]);

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
    <>
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
        monthKey={monthKey}
        total={overview.currentTotal}
        deltaPct={overview.changePct}
        previousMonthLabel={previousMonthLabel}
        dailyData={dailySpend}
        currency={currency}
        onDayPress={(dayIndex) => {
          const day = String(dayIndex + 1).padStart(2, '0');
          setTappedDay(`${monthKey}-${day}`);
        }}
      />
      <InsightBanner
        deltaPct={overview.changePct}
        previousMonthLabel={previousMonthLabel}
      />
      <Card>
        <View style={styles.chartHeader}>
          <Text style={styles.chartTitle} numberOfLines={1}>
            {chartData.title}
          </Text>
          <View style={styles.segmentedControl}>
            {PERIOD_OPTIONS.map((option) => {
              const active = period === option.key;
              return (
                <Pressable
                  key={option.key}
                  onPress={() => setPeriod(option.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[styles.segment, active && styles.segmentActive]}
                >
                  <Text
                    style={[
                      styles.segmentLabel,
                      active && styles.segmentLabelActive,
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        {/* The weekly bars exclude servicios (utility bills); the caption
            documents that so the card title isn't read as the full daily
            spend. Month/year views include servicios, so the note only
            renders for the week period. */}
        {period === 'week' ? (
          <Text style={styles.weeklyCaption}>Por día · sin servicios</Text>
        ) : null}
        <CapsuleBarChart
          items={chartData.items}
          currency={currency}
          onPressItem={
            period === 'week'
              ? (_item, index) => setTappedDay(weekDayISO(weekStartISO, index))
              : undefined
          }
        />
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

      {/* ── Tendencia anual ──────────────────────────────────────────── */}
      <Card>
        <View style={styles.yearSelector}>
          <Pressable
            onPress={goPrevYear}
            disabled={!canGoPrevYear}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Año anterior"
            accessibilityState={{ disabled: !canGoPrevYear }}
          >
            <Icon
              name="chevron.left"
              size={22}
              color={canGoPrevYear ? colors.textPrimary : colors.textSecondary}
            />
          </Pressable>
          <Text style={styles.yearLabel}>{yearLabel(selectedYear)}</Text>
          <Pressable
            onPress={goNextYear}
            disabled={!canGoNextYear}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Año siguiente"
            accessibilityState={{ disabled: !canGoNextYear }}
          >
            <Icon
              name="chevron.right"
              size={22}
              color={canGoNextYear ? colors.textPrimary : colors.textSecondary}
            />
          </Pressable>
        </View>
        {hasAnnualData ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ minWidth: 12 * 44 }}
          >
            <CapsuleBarChart
              items={annualTrend.map((point, i) => ({
                label: shortMonthLabel(point.month),
                value: point.total,
                highlight: i === highlightIdx,
              }))}
              currency={currency}
              onPressItem={(_item, index) => {
                const monthKey = monthsOfYear[index];
                setMonthKey(monthKey);
              }}
            />
          </ScrollView>
        ) : (
          <Text style={styles.emptyYear}>Sin gastos este año</Text>
        )}
      </Card>

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
              <>
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
                        percent={t.percent_of_total}
                        icon={category.icon}
                        limit={t.budget_limit ?? undefined}
                        currency={currency}
                        // Drill into the existing category detail screen
                        // (same History pattern via `categoryDetailHref`):
                        // current month omits the month param, any other
                        // month scopes it.
                        onPress={() =>
                          router.push(
                            categoryDetailHref(
                              t.category_slug,
                              monthKey,
                              currentMonthKey(),
                            ),
                          )
                        }
                      />
                    );
                  })}
                </View>
              </Card>
              {/* CTA: show when no budgets are configured for the month */}
              {!hasAnyBudgets ? (
                <Pressable
                  onPress={() => router.push('/settings/category-budgets')}
                  style={({ pressed }) => [
                    styles.budgetCta,
                    pressed && styles.budgetCtaPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Configurar presupuestos por categoría"
                >
                  <Icon
                    name="chart.pie.fill"
                    size={18}
                    color={colors.primary}
                  />
                  <Text style={styles.budgetCtaText}>
                    Configurar presupuestos
                  </Text>
                </Pressable>
              ) : null}
              </>
            )}
            {/* Background refetch failed but the last good totals are on
                screen — keep them and add a subtle inline note. */}
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Por tienda</Text>
        <Card padding={spacing.lg}>
          <StoreBars
            data={stores}
            // Receipts with no store name aggregate to the `sin tienda`
            // fallback, whose drill-down screen can't reproduce the bar's
            // total (empty store_name normalizes to '' on that screen).
            // Tapping it would open a $0 page — so the row is inert.
            onRowPress={(store) =>
              store.storeId === 'sin tienda'
                ? undefined
                : router.push(
                    `/stores/${encodeURIComponent(store.storeId)}?month=${monthKey}`,
                  )
            }
          />
        </Card>
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
      <DayDetailModal
        visible={tappedDay !== null}
        isoDate={tappedDay ?? ''}
        dayLabel={tappedDay ? dayLabel(tappedDay) : ''}
        items={tappedDayItems}
        total={tappedDayTotal}
        currency={currency}
        onClose={() => setTappedDay(null)}
      />
    </>
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
  yearSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  yearLabel: {
    fontSize: 20,
    fontWeight: '900',
    color: colors.textSecondary,
  },
  emptyYear: {
    ...typography.bodyMd,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  chartHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  chartTitle: {
    ...typography.bodyLg,
    color: colors.textPrimary,
    fontWeight: '700',
    flexShrink: 1,
  },
  // Documentational note under the weekly card title: the bars exclude
  // servicios. Only rendered for the week period.
  weeklyCaption: {
    ...typography.labelSm,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: colors.border,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.full,
    padding: 3,
    gap: 2,
  },
  segment: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
  },
  segmentActive: {
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  segmentLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  segmentLabelActive: {
    color: colors.textPrimary,
    fontWeight: '700',
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
  budgetCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 12,
  },
  budgetCtaPressed: {
    opacity: 0.85,
  },
  budgetCtaText: {
    ...typography.bodyMd,
    color: colors.primary,
    fontWeight: '700',
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
