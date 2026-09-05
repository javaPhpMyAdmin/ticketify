import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Image, Platform, StyleSheet } from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import {
  EmptyState,
  Fab,
  Icon,
  MonthlyBudgetCardSkeleton,
  Pressable,
  ReceiptRow,
  ReceiptRowSkeleton,
  Text,
  View,
} from '@/components';
import {
  MonthlyBudgetCard,
  SnacksBreakdownModal,
  useBudget,
} from '@/features/budget';
import {
  currentMonthKey,
  mapPurchaseRowsToHomeFeed,
  monthKeyToLabel,
  useAvailableMonthKeys,
  useHouseholdMonthTotal,
  useMonthNavigation,
  useMonthReceipts,
} from '@/features/home';
import {
  HouseholdCard,
  HouseholdCardSkeleton,
  useHousehold,
} from '@/features/household';
import { useFrozenGuard } from '@/features/pro';
import { TrialBanner } from '@/features/pro/components/TrialBanner';
import { useSettingsStore } from '@/stores/use-settings-store';
import { colors, radii, spacing, typography } from '@/theme';
import { useSessionStore, useSessionUser } from '../../features/auth';

/**
 * NativeTabs (iOS) does not push screen content up: the first ScrollView
 * adjusts its own content inset automatically, but absolutely-positioned
 * siblings (the scan FAB) render behind the native tab bar. `TAB_BAR_HEIGHT`
 * is the UIKit base height (49pt); the home-indicator inset is added at
 * render time via `useSafeAreaInsets` so the FAB floats above the tab bar,
 * not behind its glass. On Android the Material 3 NavigationBar is taller
 * (80dp) and renders fully opaque, so we bump the offset on that platform.
 */
const TAB_BAR_HEIGHT = Platform.select({ ios: 49, android: 80, default: 49 });

export default function HomeScreen() {
  const [snacksOpen, setSnacksOpen] = useState(false);
  const [monthKey, setMonthKey] = useState(currentMonthKey);
  const currency = useSettingsStore((s) => s.currency);
  // Budget limit is global (one `monthly_budget` profile value); only
  // `spent` is scoped to the selected month.
  const {
    budget,
    spent,
    error: budgetError,
    isLoading: budgetLoading,
    hasData: budgetHasData,
    isRefetching: budgetRefetching,
  } = useBudget(monthKey);
  // Kept only for the household card + its loading flag. The receipts list,
  // categories and snacks total come from `useMonthReceipts` below so every
  // month renders the SAME unified structure off the full-month rows.
  const { householdTotal, isLoading: feedLoading } =
    useHouseholdMonthTotal(monthKey);
  // Full-month receipts for whichever month is selected. Powers the
  // receipts list, category strip and snacks total for ANY month, and never
  // writes the receipts store (REQ-10). isLoading is surfaced so the month
  // view never flashes an empty state as a false empty month.
  const { data: monthList, isLoading: monthLoading } =
    useMonthReceipts(monthKey);
  const { userId } = useSessionUser();
  const { guard } = useFrozenGuard();
  const insets = useSafeAreaInsets();
  const { session } = useSessionStore();
  const { household, members: householdMembers } = useHousehold();

  // Reset to the current month whenever the Home tab re-focuses (REQ-11):
  // month navigation is deliberately NOT persisted across navigations.
  useFocusEffect(
    useCallback(() => {
      setMonthKey(currentMonthKey());
    }, []),
  );
  // Canonical name key is `full_name` (see profile-sync); `name` is kept as a
  // legacy fallback. Both can be absent (email signup sets no metadata).
  const fullName =
    session?.user?.user_metadata?.full_name ??
    session?.user?.user_metadata?.name ??
    '';
  const firstName = fullName.trim().split(' ')[0];
  const displayName = firstName || 'Usuario';
  const avatarUrl = session?.user?.user_metadata?.avatar_url;

  // ── Month selector (REQ-5) ──────────────────────────────────────────────
  // Available months derive from the full-month query data (not the store),
  // newest first. The current (possibly empty) month is always reachable
  // via the "newer" chevron, so navigating older never strands the user.
  const monthKeys = useAvailableMonthKeys(userId);
  const { canGoNewer, canGoOlder, goNewer, goOlder } = useMonthNavigation(
    monthKeys,
    monthKey,
    setMonthKey,
  );

  // Unified per-month feed: receipts + categories + snacks total derived
  // from the FULL month's rows for the SELECTED month. Works identically
  // for the current and past months, and never writes the receipts store.
  const monthFeed = useMemo(
    () => mapPurchaseRowsToHomeFeed(monthList, householdTotal, monthKey),
    [monthList, householdTotal, monthKey],
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <FlatList
        // While the month read is in flight the list must render the
        // loading skeletons (ListEmptyComponent), so `data` is gated on
        // `monthLoading` — preserves the previous ScrollView ternary,
        // where loading masked both stale store rows and a false empty
        // month. The derivation itself (`mapPurchaseRowsToHomeFeed` +
        // `useMonthReceipts`) is untouched.
        data={monthLoading ? [] : monthFeed.receipts}
        keyExtractor={(r) => r.id}
        renderItem={({ item: r }) => (
          <ReceiptRow
            name={r.name}
            date={r.date}
            amount={r.amount}
            currency={currency}
            imageUrl={r.imageUrl}
            onPress={() => router.push(`/receipts/${r.id}`)}
          />
        )}
        ListHeaderComponent={
          // Everything above the virtualized rows keeps the EXACT order
          // and content of the previous ScrollView; only the receipts
          // themselves became list items. `listHeader` carries the outer
          // scroll rhythm (16pt between sections) that used to live on
          // `scrollContent.gap`.
          <View style={styles.listHeader}>
            <View style={styles.greeting}>
              <View style={styles.greetingLeft}>
                <Text style={styles.greetingText}>¡Hola {displayName}!</Text>
                {householdMembers.length > 1 ? (
                  <HouseholdAvatars
                    members={householdMembers}
                    currentUserId={session?.user?.id}
                  />
                ) : null}
              </View>
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
            </View>

            <TrialBanner />

            {/* Month selector — lets you browse any month. The current month is
                always reachable via the "newer" chevron even when it has no
                receipts (REQ-5 / forward-navigation fix). */}
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

            {/* Budget card + snacks callout — shown for ALL months, scoped to
                the selected month's `spent`. */}
            {budgetLoading ? (
              <MonthlyBudgetCardSkeleton />
            ) : budgetError && !budgetHasData ? (
              // A failed budget read must never look like "Límite: $0" —
              // surface the user-safe message instead of a card claiming a
              // limit that was never read.
              <Text style={styles.error}>{budgetError}</Text>
            ) : (
              <>
                <MonthlyBudgetCard
                  spent={spent}
                  limit={budget.amount}
                  currency={currency}
                  showCallout
                  wantsSnacksTotal={monthFeed.wantsSnacksTotal}
                  onPressSnacks={() => setSnacksOpen(true)}
                />
                {/* Background refetch failed but the last good budget is on
                    screen — keep the section, only show error when NOT refetching
                    so transient failures after save don't flash red. */}
                {budgetError && !budgetRefetching ? (
                  <Text style={styles.error}>{budgetError}</Text>
                ) : null}
              </>
            )}

            {/* Household summary card — only when the user has a household.
                Shown even for solo households: the user's visual styling on
                this card should always stay visible (per user preference),
                and the card disappears once no household exists. While the
                household-total read is in flight a neutral skeleton keeps
                the card's footprint so the layout doesn't jump. */}
            {household ? (
              feedLoading ? (
                <HouseholdCardSkeleton />
              ) : (
                <HouseholdCard
                  householdTotal={householdTotal}
                  isLoading={feedLoading}
                />
              )
            ) : null}

            {/* Total + receipt list — shown for ALL months. `sectionBottom`
                reproduces the old 12pt `section` rhythm between the title
                and the first row / empty state below (the rows now live
                outside this View, so the section gap is inert here). */}
            <View style={[styles.section, styles.sectionBottom]}>
              <View style={styles.totalRow}>
                <Text style={styles.sectionTitle}>
                  {monthLoading
                    ? '…'
                    : `${monthFeed.receipts.length}{' '}${
                        monthFeed.receipts.length !== 1
                          ? 'tickets escaneados'
                          : 'ticket escaneado'
                      }`}
                </Text>
              </View>
            </View>
          </View>
        }
        ListEmptyComponent={
          // Loading wins over the empty state — exactly like the old
          // ternary (`monthLoading` → skeletons, else empty month).
          monthLoading ? (
            <View style={styles.receiptList}>
              {[0, 1, 2].map((i) => (
                <ReceiptRowSkeleton key={i} />
              ))}
            </View>
          ) : (
            <EmptyState
              icon="doc.text"
              title="Sin tickets este mes."
              body="Este mes no tiene tickets."
            />
          )
        }
        ItemSeparatorComponent={() => <View style={styles.rowSeparator} />}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={10}
      />

      <View
        style={[
          styles.fabWrap,
          { bottom: insets.bottom + TAB_BAR_HEIGHT + spacing.sm },
        ]}
        pointerEvents="box-none"
      >
        <Fab
          label="Escanear ticket"
          icon="camera.fill"
          onPress={() => guard(() => router.push('/ticket/camera'))}
        />
      </View>

      <SnacksBreakdownModal
        visible={snacksOpen}
        onClose={() => setSnacksOpen(false)}
        monthKey={monthKey}
      />
    </SafeAreaView>
  );
}

const HOUSEHOLD_AVATAR_SIZE = 28;
const HOUSEHOLD_AVATAR_OVERLAP = 8;
const MAX_DISPLAY_MEMBERS = 3;

/**
 * Overlapping household member avatars, GitHub-contributors style.
 * Shows up to 3 members (excluding the current user); if more exist,
 * the last position shows a "+N" count badge.
 */
function HouseholdAvatars({
  members,
  currentUserId,
}: {
  members: { full_name?: string; avatar_url?: string; user_id: string }[];
  currentUserId?: string;
}) {
  const otherMembers = members.filter((m) => m.user_id !== currentUserId);
  if (otherMembers.length === 0) return null;

  const shown = otherMembers.slice(0, MAX_DISPLAY_MEMBERS);
  const overflow = otherMembers.length - MAX_DISPLAY_MEMBERS;

  return (
    <View style={haStyles.container}>
      {shown.map((member, idx) => {
        const initials = (member.full_name ?? 'U')
          .split(' ')
          .map((w) => w.charAt(0))
          .slice(0, 2)
          .join('')
          .toUpperCase();

        return (
          <View
            key={member.user_id}
            style={[
              haStyles.avatarWrap,
              idx > 0 && { marginLeft: -HOUSEHOLD_AVATAR_OVERLAP },
            ]}
          >
            {member.avatar_url ? (
              <Image
                source={{ uri: member.avatar_url }}
                style={haStyles.avatar}
              />
            ) : (
              <View style={[haStyles.avatar, haStyles.avatarFallback]}>
                <Text style={haStyles.avatarInitial}>{initials}</Text>
              </View>
            )}
          </View>
        );
      })}
      {overflow > 0 ? (
        <View
          style={[
            haStyles.avatarWrap,
            { marginLeft: -HOUSEHOLD_AVATAR_OVERLAP },
          ]}
        >
          <View style={[haStyles.avatar, haStyles.overflowBadge]}>
            <Text style={haStyles.overflowText}>+{overflow}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const haStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarWrap: {
    width: HOUSEHOLD_AVATAR_SIZE,
    height: HOUSEHOLD_AVATAR_SIZE,
  },
  avatar: {
    width: HOUSEHOLD_AVATAR_SIZE,
    height: HOUSEHOLD_AVATAR_SIZE,
    borderRadius: HOUSEHOLD_AVATAR_SIZE / 2,
    borderWidth: 2,
    borderColor: colors.background,
  },
  avatarFallback: {
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.background,
  },
  overflowBadge: {
    backgroundColor: colors.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overflowText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.primaryDark,
  },
});

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    // Clear the floating scan FAB: it sits at
    // insets.bottom + TAB_BAR_HEIGHT + spacing.xl (~103pt) and is ~56pt
    // tall, so its top edge lands ~159pt from the bottom. Content must
    // scroll past that, or the last card hides behind the button.
    paddingBottom: Platform.select({ ios: 184, android: 184, default: 184 }),
  },
  // Header wrapper above the virtualized rows: carries the 16pt section
  // rhythm the removed `scrollContent.gap` used to provide (FlatList gaps
  // would also space the ROWS, shifting the receipts zone 12→16pt, so the
  // gap moved here instead — see `rowSeparator`/`sectionBottom`).
  listHeader: {
    gap: spacing.lg,
  },
  // The receipts title is the header's LAST block; the 12pt below it
  // reproduces the old `section.gap` between title and rows/empty state
  // (the rows now live outside the section View, so its gap is inert).
  sectionBottom: {
    marginBottom: spacing.md,
  },
  // 12pt between virtualized rows — the old `receiptList.gap`.
  rowSeparator: {
    height: spacing.md,
  },
  greeting: {
    paddingTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  greetingLeft: {
    flex: 1,
    gap: spacing.xs,
  },
  greetingText: {
    ...typography.headlineLgMobile,
    color: colors.textPrimary,
  },
  section: {
    gap: spacing.md,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '600',
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
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 10,
    gap: spacing.sm,
  },
  receiptList: {
    gap: spacing.md,
  },
  error: {
    ...typography.labelSm,
    color: colors.danger,
  },
  fabWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  avatar: {
    width: 50,
    height: 50,
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
});
