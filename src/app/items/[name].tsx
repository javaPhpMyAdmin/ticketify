import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Divider, Icon, Text, View } from '@/components';
import { monthKeyToLabel, useItemDetail } from '@/features/home';
import { formatCurrency, formatShortDate } from '@/lib/format';
import { useSettingsStore } from '@/stores/use-settings-store';
import { colors, radii, spacing, typography } from '@/theme';

/**
 * Item drill-down (mock): one normalized product's monthly total plus each
 * individual purchase (store, ticket date, amount), wherever it was bought.
 * Answers "cuánto gasté en menú del día este mes" across categories and
 * stores — the identity lens that complements the category drill-down. The
 * optional `month` search param (`YYYY-MM`, from the History tab) scopes the
 * aggregation; without it the current month is used.
 */
export default function ItemDetailScreen() {
  const { name, month } = useLocalSearchParams<{
    name: string;
    month?: string;
  }>();
  const currency = useSettingsStore((s) => s.currency);
  const itemName = name ?? '';
  const { total, purchases } = useItemDetail(itemName, month);

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
          <Text style={styles.title} numberOfLines={1}>
            {itemName}
          </Text>
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
            <Icon name="cart.fill" size={24} color={colors.primary} />
          </View>
          <Text style={styles.totalLabel}>Total del mes</Text>
          <Text style={styles.totalAmount}>
            {formatCurrency(total, currency)}
          </Text>
        </View>

        <View style={styles.purchasesCard}>
          {purchases.length === 0 ? (
            <Text style={styles.empty}>
              Sin compras de este producto este mes.
            </Text>
          ) : (
            purchases.map((purchase, idx) => (
              <Pressable
                key={`${purchase.receiptId}-${idx}`}
                onPress={() => router.push(`/receipts/${purchase.receiptId}`)}
                accessibilityRole="button"
              >
                {idx > 0 ? <Divider /> : null}
                <View style={styles.purchaseRow}>
                  <View style={styles.purchaseBody}>
                    <Text style={styles.storeName} numberOfLines={1}>
                      {purchase.storeName}
                    </Text>
                    <Text style={styles.purchaseDate}>
                      {formatShortDate(purchase.date)}
                    </Text>
                  </View>
                  <Text style={styles.purchaseAmount}>
                    {formatCurrency(purchase.amount, currency)}
                  </Text>
                </View>
              </Pressable>
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
    ...typography.headlineMd,
    color: colors.textPrimary,
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
    ...typography.labelCaps,
    color: colors.textSecondary,
  },
  totalAmount: {
    ...typography.displayCurrency,
    color: colors.textPrimary,
  },
  purchasesCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  purchaseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  purchaseBody: {
    flex: 1,
    gap: spacing.xs,
  },
  storeName: {
    ...typography.bodyMd,
    color: colors.textPrimary,
  },
  purchaseDate: {
    ...typography.bodyMd,
    color: colors.textSecondary,
    fontSize: 12,
  },
  purchaseAmount: {
    ...typography.headlineMd,
    color: colors.textPrimary,
  },
  empty: {
    ...typography.bodyMd,
    color: colors.textSecondary,
  },
});
