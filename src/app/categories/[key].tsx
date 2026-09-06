import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Divider, EmptyState, Icon, Text, View } from '@/components';
import { monthKeyToLabel, useCategoryDetail } from '@/features/home';
import { formatCurrency } from '@/lib/format';
import { useSettingsStore } from '@/stores/use-settings-store';
import { colors, radii, spacing, typography } from '@/theme';

/**
 * Category drill-down: the selected month's total for one spending
 * category, followed by the item-level breakdown ("cuánto gasté en cada
 * cosa"), sorted by amount desc. Identical items across receipts are
 * grouped and summed so repeated purchases collapse into one row. The
 * optional `month` search param (`YYYY-MM`, from the History tab) scopes
 * the aggregation; without it the current month is used (Home cards). The
 * optional `scope` search param (`household` from History/Analytics in
 * household mode) switches the data source from personal store reads to
 * the `get_household_category_items` RPC (migration 0028) so all household
 * members' items are shown. The header shows the month label for past
 * months so the drill-down stays anchored.
 *
 * The household read tri-states: while the RPC is pending a "Cargando
 * datos del hogar…" placeholder replaces the list (and a dash replaces the
 * total — a zero here would be a false read); when it failed with no rows
 * an error EmptyState with a Retry action replaces the list; the empty
 * message ("Sin gastos…") is only ever shown after the RPC SUCCEEDED with
 * zero rows. Personal scope renders exactly as before.
 */
export default function CategoryDetailScreen() {
  const { key, month, scope } = useLocalSearchParams<{
    key: string;
    month?: string;
    scope?: string;
  }>();
  const currency = useSettingsStore((s) => s.currency);
  const householdScope = scope === 'household' ? 'household' : 'personal';
  const {
    category,
    total,
    items,
    isLoading,
    isError,
    errorMessage,
    retry,
  } = useCategoryDetail(
    key ?? 'otros',
    month,
    householdScope,
  );
  const household = householdScope === 'household';
  // Pending/failed household read: never render a zero total as if it were
  // real spend — the dash says "not ready" instead.
  const totalPlaceholder = household && (isLoading || isError);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Volver"
        >
          <Icon name="arrow.left" size={24} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>{category.label}</Text>
          {month ? (
            <Text style={styles.subtitle}>{monthKeyToLabel(month)}</Text>
          ) : null}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.totalCard}>
          <View style={styles.iconCircle}>
            <Icon name={category.icon} size={24} color={colors.primary} />
          </View>
          <Text style={styles.totalLabel}>TOTAL DEL MES</Text>
          <Text style={styles.totalAmount}>
            {totalPlaceholder ? '—' : formatCurrency(total, currency)}
          </Text>
        </View>

        <View style={styles.itemsCard}>
          {household && isLoading ? (
            <Text style={styles.empty}>Cargando datos del hogar…</Text>
          ) : household && isError ? (
            <EmptyState
              icon="exclamationmark.triangle.fill"
              title={errorMessage}
              actionLabel="Reintentar"
              onAction={retry}
            />
          ) : items.length === 0 ? (
            <Text style={styles.empty}>
              Sin gastos en esta categoría este mes.
            </Text>
          ) : (
            items.map((item, idx) => (
              <View key={item.name}>
                <View style={styles.itemRow}>
                  <Text style={styles.itemName} numberOfLines={1}>
                    {item.name.charAt(0).toUpperCase() + item.name.slice(1)}
                    {(item.quantity ?? 1) > 1 ? ` ×${item.quantity}` : ''}
                  </Text>
                  <Text style={styles.itemAmount}>
                    {formatCurrency(item.amount, currency)}
                  </Text>
                </View>
                {idx < items.length - 1 ? <Divider /> : null}
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  title: {
    // ...typography.headlineMd,
    fontSize: 20,
    fontWeight: '900',
    color: colors.textSecondary,
  },
  headerText: {
    flex: 1,
    gap: spacing.xs,
  },
  subtitle: {
    ...typography.bodyMd,
    color: colors.textSecondary,
  },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  totalCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.sm,
    alignItems: 'center',
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.chipBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  totalLabel: {
    fontSize: 17,
    fontWeight: '900',
    color: colors.textSecondary,
  },
  totalAmount: {
    ...typography.displayCurrency,
    color: colors.textPrimary,
  },
  itemsCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  itemName: {
    // ...typography.bodyMd,
    fontSize: 17,
    fontWeight: '600',
    color: colors.textSecondary,
    flex: 1,
  },
  itemAmount: {
    // ...typography.headlineMd,
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  empty: {
    ...typography.bodyMd,
    color: colors.textSecondary,
  },
});
