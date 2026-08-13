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
  CategoryBreakdownList,
  MonthlyOverviewCard,
  TopItemsBreakdown,
  useMonthlyOverview,
  useMonthlyTotals,
  usePriceAlerts,
} from '@/features/analytics';
import type { PriceAlert } from '@/features/analytics';
import {
  aggregateItemsByMonth,
  currentMonthKey,
  getAvailableMonthKeys,
  monthKeyToLabel,
  previousMonthKey,
} from '@/features/home/hooks/useHomeFeed';
import { useProEntitlement } from '@/features/pro';
import { useReceiptsStore } from '@/stores/use-receipts-store';
import { useSettingsStore } from '@/stores/use-settings-store';
import { colors, radii, spacing, typography } from '@/theme';
import { useSessionStore } from '../../features/auth';

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
 * Analytics (RPC): a month-scoped dashboard. The month selector moves
 * within the months that actually have receipts (`getAvailableMonthKeys`),
 * same pattern as the History tab, and every block follows the chosen month —
 * overview card, price alerts, top items, and category totals. The current
 * month stays reachable even when it has no data yet ("Sin artículos este
 * mes."). The subtitle keeps the live UTC month because `useMonthlyTotals`
 * defaults to it.
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
        <MonthlyOverviewCard
          overview={overview}
          currency={currency}
          previousMonthLabel={previousMonthLabel}
        />
        <ChartsEntryCard isPro={isPro} />
        {alerts.map((alert) => (
          <PriceAlertBanner key={alert.name} alert={alert} isPro={isPro} />
        ))}
        <TopItemsBreakdown
          rows={topItems}
          total={monthTotal}
          currency={currency}
          title="Top Artículos"
        />
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
            <CategoryBreakdownList rows={totals} />
            {/* Background refetch failed but the last good totals are on
                screen — keep them and add a subtle inline note. */}
            {error ? <Text style={styles.error}>{error}</Text> : null}
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
