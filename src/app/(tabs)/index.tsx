import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { Card, CategoryCard, Divider, Fab, ReceiptRow, Text, View } from '@/components';
import { MonthlyBudgetCard, useBudget } from '@/features/budget';
import { useHomeFeed } from '@/features/home';
import { useSettingsStore } from '@/stores/use-settings-store';
import { colors, spacing, typography } from '@/theme';

/**
 * NativeTabs (iOS) does not push screen content up: the first ScrollView
 * adjusts its own content inset automatically, but absolutely-positioned
 * siblings (the FAB) render behind the native tab bar. `TAB_BAR_HEIGHT` is
 * the UIKit base height (49pt); the home-indicator inset is added at render
 * time via `useSafeAreaInsets` so the FAB sits above the tab bar, not
 * behind its glass.
 */
const TAB_BAR_HEIGHT = 49;

export default function HomeScreen() {
  const currency = useSettingsStore((s) => s.currency);
  const { budget, spent } = useBudget();
  const { categories, receipts, wantsSnacksTotal } = useHomeFeed();
  const insets = useSafeAreaInsets();

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.greeting}>
          {/* Neutral greeting: profile names are not wired into the home
              header yet, so the header never pretends to know the user. */}
          <Text style={styles.greetingText}>Hello!</Text>
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
          <Text style={styles.sectionTitle}>Spending Categories</Text>
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
          <Text style={styles.sectionTitle}>Recent Receipts</Text>
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
        style={[styles.fabWrap, { bottom: insets.bottom + TAB_BAR_HEIGHT + spacing.xl }]}
        pointerEvents="box-none"
      >
        <Fab
          label="Scan Ticket"
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
    paddingBottom: 120,
    gap: spacing.lg,
  },
  greeting: {
    paddingTop: spacing.sm,
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
});
