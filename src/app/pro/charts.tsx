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
 *
 * Card subtitles show a MONTH-OVER-MONTH DELTA next to the month label
 * (`"+12% vs. febrero"`, `"−8% vs. enero"`). The delta is colored
 * green/red/grey: less spend than previous is good (primary), more is
 * bad (danger), equal is neutral. When the previous month has no
 * receipts at all, the delta is suppressed (we don't know whether the
 * change is an improvement — "no data" is meaningfully different from
 * "you spent $0").
 */
import { Stack, router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  TextStyle,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  CategoryDonut,
  StoreBars,
  TrendChart,
  aggregateMonthlyDelta,
  aggregateSpendTrend,
  aggregateStoresByMonth,
  type CategorySlice,
  type MonthlyDelta,
  type StoreBar,
  type TrendPoint,
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
  previousMonthKey,
} from '@/features/home/hooks/useHomeFeed';
import { ProRouteGuard } from '@/features/pro';
import { useReceiptsStore } from '@/stores/use-receipts-store';
import { colors, radii, spacing, typography } from '@/theme';
import { useSettingsStore } from '@/stores/use-settings-store';

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
 * Build the colored delta fragment: `"+12% vs. febrero"` (or `null`
 * when the previous month has no data — "no data" is meaningfully
 * different from "you spent $0"). The percentage is integer-rounded
 * with an explicit sign so the user never wonders "is +12 a gain or a
 * loss?". Negative deltas use the proper minus glyph (`−`, U+2212).
 *
 * The returned object is rendered via a tiny `<DeltaSubtitle>` fragment
 * — the month label stays in default `colors.textSecondary` and the
 * delta fragment is colored by outcome.
 */
interface CaptionParts {
  monthLabel: string;
  /** Pre-formatted delta string. Null when there's no previous-month data. */
  deltaText: string | null;
  /** Color to apply to the delta text. */
  deltaColor: string;
}

function buildCaption(month: string, delta: MonthlyDelta): CaptionParts {
  const monthLabel = monthKeyToLabel(month);
  if (delta.previous === null || delta.deltaPct === null) {
    return { monthLabel, deltaText: null, deltaColor: colors.textSecondary };
  }
  const pct = Math.round(delta.deltaPct);
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : '';
  const previousLabel = monthKeyToLabel(previousMonthKey(month))
    .split(' ')[0]
    .toLowerCase();
  const deltaText = `${sign}${Math.abs(pct)}% vs. ${previousLabel}`;
  const deltaColor =
    pct === 0
      ? colors.textSecondary
      : pct < 0
        ? colors.primary
        : colors.danger;
  return { monthLabel, deltaText, deltaColor };
}

function DeltaSubtitle({ parts }: { parts: CaptionParts }) {
  if (!parts.deltaText) {
    return <Text style={styles.cardSubtitle}>{parts.monthLabel}</Text>;
  }
  // Color only the delta fragment. The leading separator " · " and the
  // trailing comparison label stay in the default subtitle color so
  // the eye reads the percentage as the salient piece of information.
  const deltaStyle: TextStyle[] = [
    styles.cardSubtitle,
    { color: parts.deltaColor, fontWeight: '700' },
  ];
  return (
    <Text style={styles.cardSubtitle}>
      {parts.monthLabel}
      <Text style={deltaStyle}>{`  ·  ${parts.deltaText}`}</Text>
    </Text>
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
  const currency = useSettingsStore((s) => s.currency);

  const availableMonths = useMemo(() => getAvailableMonthKeys(list), [list]);
  const initialMonth = useMemo(() => {
    if (availableMonths.length === 0) return currentMonthKey();
    return availableMonths[0];
  }, [availableMonths]);

  const [selectedMonth, setSelectedMonth] = useState(initialMonth);

  useEffect(() => {
    if (availableMonths.length === 0) return;
    if (!availableMonths.includes(selectedMonth)) {
      setSelectedMonth(availableMonths[0]);
    }
  }, [availableMonths, selectedMonth]);

  const trendData = useMemo<TrendPoint[]>(
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

  // The same monthly delta surfaces in all three card subtitles — the
  // cards all describe the same month, so the comparison is consistent.
  const monthlyDelta = useMemo(
    () => aggregateMonthlyDelta(list, selectedMonth),
    [list, selectedMonth],
  );
  const caption = useMemo(
    () => buildCaption(selectedMonth, monthlyDelta),
    [selectedMonth, monthlyDelta],
  );

  // Whether the user has ANY receipts ever — drives the empty-state
  // CTA: only when the answer is "no, you've never scanned anything"
  // do we offer to scan now. A month that's just empty inside a busy
  // account gets the bare empty copy (the user already knows how to
  // scan).
  const hasAnyReceipts = list.length > 0;

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
        <DeltaSubtitle parts={caption} />
        <View style={styles.chartHolder}>
          <TrendChart data={trendData} />
        </View>
        {!hasAnyReceipts ? (
          <Text style={styles.emptyHint}>
            Escaneá tu primer ticket para empezar.
          </Text>
        ) : null}
      </Card>

      <Card>
        <Text style={styles.cardTitle}>Por categoría</Text>
        <DeltaSubtitle parts={caption} />
        <View style={styles.donutHolder}>
          <CategoryDonut data={donutData} size={160} currency={currency} />
        </View>
      </Card>

      <Card>
        <Text style={styles.cardTitle}>Por tienda</Text>
        <DeltaSubtitle parts={caption} />
        <View style={styles.chartHolder}>
          <StoreBars
            data={storeData}
            onRowPress={(store) =>
              router.push(
                `/stores/${encodeURIComponent(store.storeName)}?month=${encodeURIComponent(selectedMonth)}`,
              )
            }
          />
        </View>
        {storeData.length === 0 && !hasAnyReceipts ? (
          <Text style={styles.emptyHint}>
            Escaneá tu primer ticket para ver tus tiendas acá.
          </Text>
        ) : null}
      </Card>

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
    alignItems: 'stretch',
  },
  emptyHint: {
    ...typography.bodyMd,
    color: colors.textSecondary,
    marginTop: spacing.md,
    fontStyle: 'italic',
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

// `buildCaption` and `DeltaSubtitle` are intentionally not exported —
// they're internal helpers. `export { deltaSubtitle }` was scoped out
// of the spec; keeping the file pure presentation prevents accidental
// use from outside the screen.
