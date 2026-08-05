import { router } from 'expo-router';
import { Image, Platform, ScrollView, StyleSheet } from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import {
  Card,
  CategoryCard,
  Divider,
  Fab,
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
 * siblings (the FAB) render behind the native tab bar. `TAB_BAR_HEIGHT` is
 * the UIKit base height (49pt); the home-indicator inset is added at render
 * time via `useSafeAreaInsets` so the FAB sits above the tab bar, not
 * behind its glass. On Android the Material 3 NavigationBar is taller (80dp)
 * and renders fully opaque, so we bump the offset on that platform.
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
          <Text style={styles.sectionTitle}>Categorías de gastos</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoryStrip}
          >
            {categories.map((c) => (
              <CategoryCard
                key={c.name}
                name={c.name}
                amount={c.amount}
                currency={currency}
                icon={c.icon}
              />
            ))}
          </ScrollView>
        </View>

        {/* Recent receipts */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recibos recientes</Text>
          <Card padding={spacing.sm}>
            {receipts.map((r, idx) => (
              <View key={r.id}>
                <ReceiptRow
                  name={r.name}
                  date={r.date}
                  amount={r.amount}
                  currency={currency}
                />
                {idx < receipts.length - 1 ? <Divider /> : null}
              </View>
            ))}
          </Card>
        </View>
      </ScrollView>

      <View
        style={[
          styles.fabWrap,
          { bottom: insets.bottom + TAB_BAR_HEIGHT + spacing.xl },
        ]}
        pointerEvents="box-none"
      >
        <Fab
          label="Escanear recibo"
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
    paddingBottom: Platform.select({ ios: 120, android: 156, default: 120 }),
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
    ...typography.headlineMd,
    color: colors.textPrimary,
  },
  categoryStrip: {
    gap: spacing.md,
    paddingRight: spacing.xl,
  },
  fabWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
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
