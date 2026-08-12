/**
 * Pro charts screen (pro-subscription spec — REQ-CHART-1..6).
 *
 * Wraps the body in `<ProRouteGuard>` so a free user opening `/pro/charts`
 * sees the lock screen instead of the charts; once entitled, the body
 * renders the full Pro experience: a month selector (horizontal chips),
 * the spend trend line, a donut of category shares, and a horizontal
 * bar chart of store totals. All three charts read from the SAME
 * `records` array the free analytics consume, so a switch between tabs
 * never shows different numbers for the same month.
 *
 * The month selector defaults to the most recent month that has data;
 * if the current month has no receipts yet it falls back to the newest
 * month in `availableMonths`. "Volver" closes the route — the screen
 * is always pushed from the analytics charts entry card, so back is
 * the right action.
 */
import { Stack, router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  CategoryDonut,
  StoreBars,
  TrendChart,
  aggregateSpendTrend,
  aggregateStoresByMonth,
  type CategorySlice,
  type StoreBar,
} from '@/features/charts';
import {
  Card,
  Chip,
  Icon,
  Pressable,
  Text,
} from '@/components';
import {
  aggregateCategoriesByMonth,
  currentMonthKey,
  getAvailableMonthKeys,
  monthKeyToLabel,
} from '@/features/home/hooks/useHomeFeed';
import { ProRouteGuard } from '@/features/pro';
import { useReceiptsStore } from '@/stores/use-receipts-store';
import { colors, radii, spacing, typography } from '@/theme';

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
  // the History tab takes, so all three screens stay in sync.
  const list = useReceiptsStore((s) => s.list);

  const availableMonths = useMemo(() => getAvailableMonthKeys(list), [list]);
  const initialMonth = useMemo(() => {
    if (availableMonths.length === 0) return currentMonthKey();
    // availableMonths is newest-first; pick the most recent month that
    // already has data so the user always lands on a chart, not an empty
    // placeholder.
    return availableMonths[0];
  }, [availableMonths]);

  const [selectedMonth, setSelectedMonth] = useState(initialMonth);

  // If `selectedMonth` becomes invalid (e.g. records were cleared while
  // the screen was open) snap back to the newest available month.
  useEffect(() => {
    if (availableMonths.length === 0) return;
    if (!availableMonths.includes(selectedMonth)) {
      setSelectedMonth(availableMonths[0]);
    }
  }, [availableMonths, selectedMonth]);

  const trendData = useMemo(
    () => aggregateSpendTrend(list, [...availableMonths].reverse()),
    [list, availableMonths],
  );

  const donutData: CategorySlice[] = useMemo(
    () =>
      aggregateCategoriesByMonth(list, selectedMonth).map((category) => ({
        id: category.key,
        name: category.name,
        amount: category.amount,
      })),
    [list, selectedMonth],
  );

  const storeData: StoreBar[] = useMemo(
    () => aggregateStoresByMonth(list, selectedMonth),
    [list, selectedMonth],
  );

  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <View style={styles.header}>
        <Text style={styles.title}>Tus tendencias</Text>
        <Text style={styles.subtitle}>
          Visualizá tu gasto a lo largo del tiempo, por categoría y por tienda.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Seleccionar mes</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {availableMonths.map((month) => (
            <Chip
              key={month}
              label={monthKeyToLabel(month).split(' ')[0]}
              selected={month === selectedMonth}
              onPress={() => setSelectedMonth(month)}
            />
          ))}
        </ScrollView>
      </View>

      <Card>
        <Text style={styles.cardTitle}>Tendencia</Text>
        <Text style={styles.cardSubtitle}>Gasto mensual</Text>
        <View style={styles.chartHolder}>
          <TrendChart data={trendData} />
        </View>
      </Card>

      <Card>
        <Text style={styles.cardTitle}>Por categoría</Text>
        <Text style={styles.cardSubtitle}>{monthKeyToLabel(selectedMonth)}</Text>
        <View style={styles.donutHolder}>
          <CategoryDonut data={donutData} size={160} />
        </View>
      </Card>

      <Card>
        <Text style={styles.cardTitle}>Por tienda</Text>
        <Text style={styles.cardSubtitle}>{monthKeyToLabel(selectedMonth)}</Text>
        <View style={styles.chartHolder}>
          <StoreBars data={storeData} />
        </View>
      </Card>

      <Pressable
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Volver"
        style={({ pressed }) => [styles.backButton, pressed && styles.backPressed]}
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
  section: {
    gap: spacing.sm,
  },
  sectionTitle: {
    ...typography.labelSm,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.05 * 16,
    fontWeight: '700',
  },
  chipRow: {
    gap: spacing.sm,
    paddingRight: spacing.sm,
  },
  cardTitle: {
    ...typography.headlineMd,
    color: colors.textPrimary,
  },
  cardSubtitle: {
    ...typography.bodyMd,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  chartHolder: {
    marginTop: spacing.md,
  },
  donutHolder: {
    marginTop: spacing.md,
    alignItems: 'center',
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
