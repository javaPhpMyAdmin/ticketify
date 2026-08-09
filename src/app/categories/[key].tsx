import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Divider, Icon, Text, View } from '@/components';
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
 * header shows the month label for past months so the drill-down stays
 * anchored.
 */
export default function CategoryDetailScreen() {
  const { key, month } = useLocalSearchParams<{
    key: string;
    month?: string;
  }>();
  const currency = useSettingsStore((s) => s.currency);
  const { category, total, items } = useCategoryDetail(key ?? 'otros', month);

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
            {formatCurrency(total, currency)}
          </Text>
        </View>

        <View style={styles.itemsCard}>
          {items.length === 0 ? (
            <Text style={styles.empty}>
              Sin gastos en esta categoría este mes.
            </Text>
          ) : (
            items.map((item, idx) => (
              <View key={item.name}>
                <View style={styles.itemRow}>
                  <Text style={styles.itemName} numberOfLines={1}>
                    {item.name.charAt(0).toUpperCase() + item.name.slice(1)}
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
