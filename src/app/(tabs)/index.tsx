import { router } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Image, Platform, ScrollView, StyleSheet } from 'react-native';
import type { NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import {
  MonthlyBudgetCardSkeleton,
  EmptyState,
  Fab,
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
import { useFrozenGuard } from '@/features/pro';
import { TrialBanner } from '@/features/pro/components/TrialBanner';
import { useHomeFeed } from '@/features/home';
import { HouseholdCard } from '@/features/household';
import { useSettingsStore } from '@/stores/use-settings-store';
import { colors, spacing, typography } from '@/theme';
import { useSessionStore } from '../../features/auth';

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
  const currency = useSettingsStore((s) => s.currency);
  const {
    budget,
    spent,
    error: budgetError,
    isLoading: budgetLoading,
    hasData: budgetHasData,
    isRefetching: budgetRefetching,
  } = useBudget();
  const {
    receipts,
    wantsSnacksTotal,
    householdTotal,
    isLoading: feedLoading,
    error: feedError,
    hasData: feedHasData,
    isRefetching: feedRefetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useHomeFeed();
  const { guard } = useFrozenGuard();
  const insets = useSafeAreaInsets();
  const { session } = useSessionStore();
  // Canonical name key is `full_name` (see profile-sync); `name` is kept as a
  // legacy fallback. Both can be absent (email signup sets no metadata).
  const fullName =
    session?.user?.user_metadata?.full_name ??
    session?.user?.user_metadata?.name ??
    '';
  const firstName = fullName.trim().split(' ')[0];
  const displayName = firstName || 'Usuario';
  const avatarUrl = session?.user?.user_metadata?.avatar_url;

  // Infinite scroll: fetch next page when user scrolls near the bottom.
  const loadMoreRef = useRef(false);
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!hasNextPage || isFetchingNextPage || loadMoreRef.current) return;
      const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
      const distFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
      if (distFromBottom < 400) {
        loadMoreRef.current = true;
        Promise.resolve(fetchNextPage()).finally(() => {
          loadMoreRef.current = false;
        });
      }
    },
    [hasNextPage, isFetchingNextPage, fetchNextPage],
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={200}
      >
        <View style={styles.greeting}>
          <Text style={styles.greetingText}>¡Hola {displayName}!</Text>
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
              wantsSnacksTotal={wantsSnacksTotal}
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

        {/* Household summary card — only visible when the user has a household */}
        <HouseholdCard
          householdTotal={householdTotal}
          isLoading={feedLoading}
        />

        {feedError && !feedHasData ? (
          // A failed feed read with nothing to show must never render as
          // a false empty feed — surface the message instead of sections.
          <Text style={styles.error}>{feedError}</Text>
        ) : (
          <>
            {/* Background refetch failed but the last good feed is on
                screen — keep the sections, only show error when NOT refetching
                so transient failures after save don't flash red. */}
            {feedError && !feedRefetching ? (
              <Text style={styles.error}>{feedError}</Text>
            ) : null}
            {/* Recent receipts */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Tickets recientes</Text>
              {feedLoading ? (
                <View style={styles.receiptList}>
                  {[0, 1, 2].map((i) => (
                    <ReceiptRowSkeleton key={i} />
                  ))}
                </View>
              ) : receipts.length === 0 ? (
                <EmptyState
                  icon="doc.text"
                  title="Aún no hay tickets recientes."
                  body="Escanea tu primer recibo para empezar."
                  actionLabel="Escanear recibo"
                  onAction={() => guard(() => router.push('/ticket/camera'))}
                />
              ) : (
                <View style={styles.receiptList}>
                  {receipts.map((r) => (
                    <ReceiptRow
                      key={r.id}
                      name={r.name}
                      date={r.date}
                      amount={r.amount}
                      currency={currency}
                      imageUrl={r.imageUrl}
                      onPress={() => router.push(`/receipts/${r.id}`)}
                    />
                  ))}
                  {isFetchingNextPage && (
                    <View style={{ paddingVertical: spacing.md }}>
                      {[0, 1, 2].map((i) => (
                        <ReceiptRowSkeleton key={i} />
                      ))}
                    </View>
                  )}
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>

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
      />
    </SafeAreaView>
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
    // Clear the floating scan FAB: it sits at
    // insets.bottom + TAB_BAR_HEIGHT + spacing.xl (~103pt) and is ~56pt
    // tall, so its top edge lands ~159pt from the bottom. Content must
    // scroll past that, or the last card hides behind the button.
    paddingBottom: Platform.select({ ios: 184, android: 184, default: 184 }),
    gap: spacing.lg,
  },
  greeting: {
    paddingTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'space-between',
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
