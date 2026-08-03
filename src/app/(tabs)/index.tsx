import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { Card, CategoryCard, Divider, Fab, ReceiptRow, Text, View } from '@/components';
import { MonthlyBudgetCard, useBudget } from '@/features/budget';
import { useSettingsStore } from '@/stores/use-settings-store';
import { colors, spacing, typography } from '@/theme';

const wantsSnacksTotal = 142;

const categories = [
  { name: 'Groceries', amount: 450, icon: 'sparkles' as const },
  { name: 'Drinks', amount: 85, icon: 'sparkles' as const },
  { name: 'Snacks', amount: 142, icon: 'sparkles' as const },
];

const recentReceipts = [
  { id: 'r1', name: 'Whole Foods Market', date: '2026-08-02', amount: 42.18 },
  { id: 'r2', name: 'Café Martinez', date: '2026-08-01', amount: 7.5 },
  { id: 'r3', name: 'Kiosco 24hs', date: '2026-07-30', amount: 3.2 },
];

export default function HomeScreen() {
  const currency = useSettingsStore((s) => s.currency);
  const { budget, spent } = useBudget();

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.greeting}>
          <Text style={styles.greetingText}>Hello, Alex!</Text>
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
            {recentReceipts.map((r, idx) => (
              <View key={r.id}>
                <ReceiptRow
                  name={r.name}
                  date={r.date}
                  amount={r.amount}
                  currency={currency}
                />
                {idx < recentReceipts.length - 1 ? <Divider /> : null}
              </View>
            ))}
          </Card>
        </View>
      </ScrollView>

      <View style={styles.fabWrap} pointerEvents="box-none">
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
    bottom: spacing.xl,
    alignItems: 'center',
  },
});
