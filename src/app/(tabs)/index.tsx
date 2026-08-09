import { router } from 'expo-router';
import { Image, Platform, ScrollView, StyleSheet } from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import {
  CategoryCard,
  Fab,
  Icon,
  Pressable,
  ReceiptRow,
  Text,
  View,
} from '@/components';
import { MonthlyBudgetCard, useBudget } from '@/features/budget';
import { useHomeFeed } from '@/features/home';
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
  const currency = useSettingsStore((s) => s.currency);
  const { budget, spent } = useBudget();
  const { categories, receipts, wantsSnacksTotal } = useHomeFeed();
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

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
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

        <MonthlyBudgetCard
          spent={spent}
          limit={budget.amount}
          currency={currency}
          showCallout
          wantsSnacksTotal={wantsSnacksTotal}
        />

        {/* Categories */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Categorías de gastos</Text>
            <Pressable
              onPress={() => router.push('/history')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Ver historial"
              style={styles.historyLink}
            >
              <Icon name="calendar" size={16} color={colors.primary} />
              <Text style={styles.historyLinkText}>Historial</Text>
            </Pressable>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoryStrip}
          >
            {categories.map((c) => (
              <CategoryCard
                key={c.key}
                name={c.name}
                amount={c.amount}
                currency={currency}
                icon={c.icon}
                onPress={() => router.push(`/categories/${c.key}`)}
              />
            ))}
          </ScrollView>
        </View>

        {/* Recent receipts */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Tickets recientes</Text>
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
          </View>
        </View>
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
          onPress={() => router.push('/ticket/camera')}
        />
      </View>
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
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  historyLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  historyLinkText: {
    color: colors.primary,
    fontWeight: '600',
    fontSize: 17,
  },
  categoryStrip: {
    gap: spacing.md,
    paddingRight: spacing.xl,
  },
  receiptList: {
    gap: spacing.md,
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
