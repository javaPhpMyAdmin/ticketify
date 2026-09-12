import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Image, Platform, ScrollView, StyleSheet, View } from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Card, EmptyState, Icon, Pressable, Text } from '@/components';
import type { PriceAlert } from '@/features/analytics';
import {
  buildOverviewHeadline,
  CategoryBudgetRow,
  MonthlyOverviewCard,
  TopItemsBreakdown,
  useMonthlyOverview,
  useMonthlyTotals,
  usePriceAlerts,
} from '@/features/analytics';
import { categoryDetailHref } from '@/features/charts';
import {
  useAvailableMonthKeys,
  useMonthNavigation,
  useMonthReceipts,
} from '@/features/home';
import { getExpenseCategory } from '@/features/home/categories';
import {
  aggregateItemsByMonth,
  currentMonthKey,
  monthKeyToLabel,
  monthKeyToMonthName,
  previousMonthKey,
} from '@/features/home/hooks/useHomeFeed';
import { useProEntitlement } from '@/features/pro';
import { useLocaleStore } from '@/i18n/stores/useLocaleStore';
import { useHouseholdStore } from '@/stores/use-household-store';
import { useSettingsStore } from '@/stores/use-settings-store';
import { colors, radii, spacing, typography } from '@/theme';
import { useSessionStore, useSessionUser } from '../../features/auth';

/**
 * Same FAB-clearance pattern as the home screen: native tabs do not push
 * content past the tab bar, so we add `insets.bottom + TAB_BAR_HEIGHT` to
 * the scroll's bottom inset. Without this the last card (top items) sits
 * behind the tab bar on both platforms.
 */
const ANALYTICS_TAB_BAR_HEIGHT = Platform.select({
  ios: 49,
  android: 80,
  default: 49,
});

/**
 * Analytics (RPC): a month-scoped dashboard. The month selector moves
 * within the months that actually have receipts (`getAvailableMonthKeys`),
 * same pattern as the History tab, and every block follows the chosen month —
 * overview card, price alerts, and top items. The current month stays
 * reachable even when it has no data yet ("Sin artículos este mes.").
 */
export default function AnalyticsScreen() {
  const { t } = useTranslation(['household', 'analytics', 'common']);
  const insets = useSafeAreaInsets();
  const currency = useSettingsStore((s) => s.currency);
  const { isPro } = useProEntitlement();
  const [monthKey, setMonthKey] = useState(currentMonthKey);
  // Personal vs household view toggle — mirrors history.tsx pattern.
  const [viewMode, setViewMode] = useState<'personal' | 'household'>(
    'personal',
  );
  const householdId = useHouseholdStore((s) => s.household?.id);
  const hasHousehold = !!householdId;

  // Full-month receipts for the selected month (personal scope). The store
  // list is used ONLY as a loading fallback inside the hook; once the query
  // resolves, all month-scoped aggregation below runs on the FULL month.
  const { data: fullMonthList } = useMonthReceipts(monthKey);
  const { userId } = useSessionUser();

  // Month-scoped category totals: in household mode they come from the RPC
  // aggregation; in personal mode they are the cache-backed personal totals
  // with budget limits merged (AD-5). The hook also derives `monthTotal`
  // (sum of the totals) — the headline value for household mode.
  const {
    totals: monthTotals,
    monthTotal: householdMonthTotal,
    isLoading: monthTotalsLoading,
    error: monthTotalsError,
    hasData: monthTotalsHasData,
  } = useMonthlyTotals(monthKey, viewMode === 'household' ? householdId : null);

  // Whether any budget is set decides the "Configurar"/"Editar" affordance
  // label (charts pattern).
  const hasAnyBudgets = useMemo(
    () => monthTotals.some((t) => t.budget_limit !== null),
    [monthTotals],
  );

  const monthKeys = useAvailableMonthKeys(userId);
  const alerts = usePriceAlerts(monthKey);
  const overview = useMonthlyOverview(monthKey);
  // "TOTAL GASTADO" derives from the FULL month's receipts already loaded
  // here (same as Home), not from the monthly cache — on a cache miss the
  // cache-backed `overview.currentTotal` can read 0, so we override it with
  // the real month total the moment the full-month rows resolve. This keeps
  // the overview's badge (change %) cache-backed while the headline total is
  // always the true sum of the month's receipts.
  const overviewTotal = useMemo(
    () =>
      fullMonthList
        .filter((r) => r.purchase_date.slice(0, 7) === monthKey)
        .reduce((sum, r) => sum + (r.total ?? 0), 0),
    [fullMonthList, monthKey],
  );
  const { session } = useSessionStore();
  const fullName =
    session?.user?.user_metadata?.full_name ??
    session?.user?.user_metadata?.name ??
    '';
  // The active UI locale comes from the locale store (set before
  // `changeLanguage` fires), so month labels re-render on locale swaps.
  const locale = useLocaleStore((s) => s.activeLocale);
  const firstName = fullName.trim().split(' ')[0];
  const displayName = firstName || t('common:userFallback');
  const avatarUrl = session?.user?.user_metadata?.avatar_url;

  // Headline scope follows the view toggle. In household mode "TOTAL GASTADO"
  // is the HOUSEHOLD total (sum of the RPC category totals), not the caller's
  // personal receipt sum — a personal figure next to the household category
  // list below would contradict it. The change-% badge is personal-scoped
  // (useMonthlyOverview reads the personal `monthly_user_totals` cache), so it
  // is dropped in household mode. When the household RPC has not resolved
  // (loading/error) the headline is a neutral placeholder — never a false
  // "$0.00" — mirroring the body's loading/error branch.
  const headline = buildOverviewHeadline(viewMode, {
    householdMonthTotal,
    overviewTotal,
    personalChangePct: overview.changePct,
    hasHouseholdData: monthTotalsHasData,
  });

  // Full month item list feeds the bar denominator (percent of the whole
  // month, not of the top-N slice); only the top 5 rows render. Utility
  // bills (servicios) are excluded: they would own the ranking as receipt
  // line items, but they are not consumption.
  const allItems = useMemo(
    () => aggregateItemsByMonth(fullMonthList, monthKey, ['servicios']),
    [fullMonthList, monthKey],
  );
  const topItems = allItems.slice(0, 5);
  // `topItemsTotal` feeds the bar denominator — percent of the WHOLE month
  // (not of the top-N slice), even though only the top 5 rows render.
  const topItemsTotal = allItems.reduce((sum, item) => sum + item.amount, 0);

  // `monthKeys` is newest-first. The selected month may not be in it (e.g.
  // the current month with no receipts yet): `useMonthNavigation` synthesizes
  // the current month at the front so it stays reachable via "newer".
  const { canGoNewer, canGoOlder, goOlder, goNewer } = useMonthNavigation(
    monthKeys,
    monthKey,
    setMonthKey,
  );

  const previousMonthName = monthKeyToMonthName(
    locale,
    previousMonthKey(monthKey),
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.push('/profile')}
          accessibilityLabel={t('household:openProfile')}
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
        <Text style={styles.title}>{t('household:ticketifyTitle')}</Text>
        <Icon name="qr-code-scanner" size={33} color={colors.primary} />
      </View>
      <View style={styles.fixedHeader}>
        <View style={styles.monthSelector}>
          <Pressable
            onPress={goOlder}
            disabled={!canGoOlder}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t('household:previousMonth')}
            accessibilityState={{ disabled: !canGoOlder }}
          >
            <Icon
              name="chevron.left"
              size={22}
              color={canGoOlder ? colors.textPrimary : colors.textSecondary}
            />
          </Pressable>
          <Text style={styles.monthLabel}>{monthKeyToLabel(locale, monthKey)}</Text>
          <Pressable
            onPress={goNewer}
            disabled={!canGoNewer}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t('household:nextMonth')}
            accessibilityState={{ disabled: !canGoNewer }}
          >
            <Icon
              name="chevron.right"
              size={22}
              color={canGoNewer ? colors.textPrimary : colors.textSecondary}
            />
          </Pressable>
        </View>

        {/* Personal / Household toggle — only when the user has a household */}
        {hasHousehold ? (
          <View style={styles.viewToggle}>
            {(['personal', 'household'] as const).map((mode) => {
              const active = viewMode === mode;
              return (
                <Pressable
                  key={mode}
                  onPress={() => setViewMode(mode)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[
                    styles.viewSegment,
                    active && styles.viewSegmentActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.viewSegmentLabel,
                      active && styles.viewSegmentLabelActive,
                    ]}
                  >
                    {mode === 'personal' ? t('household:mySpending') : t('household:household')}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            // Clear the native tab bar so the last card stays visible:
            // insets.bottom + tab bar height + a breath of spacing.
            // Without this the last row sits behind the tab bar on
            // Android (Material 3 NavigationBar is ~80dp).
            paddingBottom:
              insets.bottom + ANALYTICS_TAB_BAR_HEIGHT + spacing.lg,
          },
        ]}
      >
        <MonthlyOverviewCard
          overview={{
            ...overview,
            currentTotal: headline.headlineTotal ?? 0,
            changePct: headline.headlineChangePct,
          }}
          placeholder={headline.headlineTotal === null}
          currency={currency}
          previousMonthName={previousMonthName}
        />
        <ChartsEntryCard isPro={isPro} />
        {alerts.map((alert) => (
          <PriceAlertBanner key={alert.name} alert={alert} isPro={isPro} />
        ))}
        {viewMode === 'household' ? (
          monthTotalsLoading ? (
            <Card>
              <Text style={styles.empty}>{t('household:loadingHousehold')}</Text>
            </Card>
          ) : monthTotalsError && !monthTotalsHasData ? (
            <EmptyState
              framed
              icon="exclamationmark.triangle.fill"
              title={monthTotalsError}
            />
          ) : monthTotals.length === 0 ? (
            <Card>
              <Text style={styles.empty}>
                {t('analytics:noCategoriesHousehold')}
              </Text>
            </Card>
          ) : (
            <Card padding={spacing.lg}>
              <View style={styles.categoryList}>
                {monthTotals.map((t) => {
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
                      onPress={() =>
                        router.push(
                          categoryDetailHref(
                            t.category_slug,
                            monthKey,
                            currentMonthKey(),
                            'household',
                          ),
                        )
                      }
                    />
                  );
                })}
              </View>
            </Card>
          )
        ) : (
            <>
              <TopItemsBreakdown
                rows={topItems}
                total={topItemsTotal}
                currency={currency}
                title={t('analytics:topItems')}
              />
              {/* Personal "Categorías" section (AD-8): the cache-backed totals
                  already carry merged budget limits (useMonthlyCache → AD-5),
                  so CategoryBudgetRow renders bars exactly where a budget
                  exists. New section — TopItemsBreakdown stays above it. */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>{t('analytics:categories')}</Text>
                  <Pressable
                    onPress={() => router.push('/settings/category-budgets')}
                    style={({ pressed }) => [
                      styles.budgetLink,
                      pressed && styles.budgetLinkPressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={t('analytics:configureBudgetsA11y')}
                  >
                    <Icon name="pencil" size={14} color={colors.primary} />
                    <Text style={styles.budgetLinkText}>
                      {hasAnyBudgets ? t('analytics:editBudgets') : t('analytics:configureBudgets')}
                    </Text>
                  </Pressable>
                </View>
                {monthTotalsLoading ? (
                  <Card padding={spacing.lg}>
                    <Text style={styles.empty}>{t('analytics:loadingCategories')}</Text>
                  </Card>
                ) : monthTotalsError && !monthTotalsHasData ? (
                  <EmptyState
                    framed
                    icon="exclamationmark.triangle.fill"
                    title={monthTotalsError}
                  />
                ) : monthTotals.length === 0 ? (
                  <Card padding={spacing.lg}>
                    <Text style={styles.empty}>{t('analytics:noCategories')}</Text>
                  </Card>
                ) : (
                  <Card padding={spacing.lg}>
                    <View style={styles.categoryList}>
                      {monthTotals.map((t) => {
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
                )}
                {monthTotalsError ? (
                  <Text style={styles.error}>{monthTotalsError}</Text>
                ) : null}
              </View>
            </>
          )}
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
  viewToggle: {
    flexDirection: 'row',
    backgroundColor: colors.border,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.full,
    padding: 3,
    gap: 2,
  },
  viewSegment: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
  },
  viewSegmentActive: {
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  viewSegmentLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  viewSegmentLabelActive: {
    color: colors.textPrimary,
    fontWeight: '700',
  },
  categoryList: {
    gap: spacing.sm,
  },
  empty: {
    ...typography.bodyMd,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
  section: {
    gap: spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '600',
  },
  budgetLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  budgetLinkPressed: {
    backgroundColor: colors.surface,
  },
  budgetLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  error: {
    ...typography.labelSm,
    color: colors.danger,
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
 * The card is mounted after `MonthlyOverviewCard` (around line 152-156)
 * so the entry sits in the natural reading flow under the headline
 * stat. While the entitlement is still `isLoading` the store defaults
 * `isPro` to `false` (M4 contract), which renders the lock UX — the
 * safest default since a free user opening the screen MUST see the
 * paywall CTA rather than a route that will bounce them back.
 */
interface ChartsEntryCardProps {
  isPro: boolean;
}

function ChartsEntryCard({ isPro }: ChartsEntryCardProps) {
  const { t } = useTranslation(['analytics']);
  if (isPro) {
    return (
      <Pressable
        onPress={() => router.push('/pro/charts')}
        accessibilityRole="button"
        accessibilityLabel={t('analytics:viewStatsA11y')}
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
              <Text style={styles.entryTitle}>{t('analytics:viewStats')}</Text>
              <Text style={styles.entryBody}>
                {t('analytics:statsProBody')}
              </Text>
            </View>
            <Icon name="chevron.right" size={22} color={colors.textSecondary} />
          </View>
        </Card>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={() => router.push('/pro')}
      accessibilityRole="button"
      accessibilityLabel={t('analytics:statsProA11y')}
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
              <Text style={styles.entryTitle}>{t('analytics:statsPro')}</Text>
              <View style={styles.proPill}>
                <Text style={styles.proPillText}>{t('analytics:proPill')}</Text>
              </View>
            </View>
            <Text style={styles.entryBody}>
              {t('analytics:statsProBody')}
            </Text>
          </View>
          <Icon name="chevron.right" size={22} color={colors.textSecondary} />
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
  const { t } = useTranslation(['analytics']);
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
      accessibilityHint={
        isPro ? t('analytics:priceAlertA11yHint') : t('analytics:priceAlertProA11yHint')
      }
      accessibilityLabel={
        isPro
          ? t('analytics:priceAlertA11y')
          : t('analytics:priceAlertProA11y')
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
          <Text style={styles.priceAlert}>{t('analytics:priceAlertTitle')}</Text>
          {!isPro ? (
            <View style={styles.proPill}>
              <Text style={styles.proPillText}>{t('analytics:proPill')}</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.alertTextWrap}>
          <Text style={styles.alertText}>
            {alert.name} {alert.changePct >= 0 ? t('analytics:priceAlertUp') : t('analytics:priceAlertDown')}{' '}
            <Text style={{ fontSize: 17.5, fontWeight: 900, color: 'black' }}>
              {Math.abs(alert.changePct)}%
            </Text>{' '}
            {t('analytics:priceAlertSince')}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}
