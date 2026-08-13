import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  Divider,
  Icon,
  Text,
} from '@/components';
import { monthKeyToLabel, useStoreDetail } from '@/features/home';
import { formatCurrency, formatShortDate } from '@/lib/format';
import { useSettingsStore } from '@/stores/use-settings-store';
import { colors, radii, spacing, typography } from '@/theme';

/**
 * Store drill-down: the receipts the user scanned at the named store
 * in the selected month, plus the store's monthly total — the answer
 * to "qué compré en Coto este mes". A sibling route to `/items/[name]`
 * (which is item-centric), so the screen, the URL semantics, and the
 * back-stack history all stay clear even when both are reached from the
 * Pro charts screen.
 *
 * Rows aggregate at the RECEIPT level: one row per ticket the user
 * scanned at this store, with that ticket's subtotal as the row amount,
 * sorted newest first. Tapping a row navigates to the ticket photo at
 * `/receipts/[id]`. The header reflects the store name and the month so
 * the user can always tell which drill-down they're in.
 */
export default function StoreDetailScreen() {
  const { name, month } = useLocalSearchParams<{
    name: string;
    month?: string;
  }>();
  const currency = useSettingsStore((s) => s.currency);
  const storeName = name ?? '';
  const { total, purchases } = useStoreDetail(storeName, month);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <Stack.Screen options={{ title: storeName }} />
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
            {storeName}
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
          <Text style={styles.totalLabel}>TOTAL DEL MES</Text>
          <Text style={styles.totalAmount}>
            {formatCurrency(total, currency)}
          </Text>
        </View>

        <View style={styles.purchasesCard}>
          {purchases.length === 0 ? (
            <Text style={styles.empty}>
              Sin compras en esta tienda este mes.
            </Text>
          ) : (
            purchases.map((purchase, idx) => (
              <Pressable
                key={purchase.receiptId}
                onPress={() => router.push(`/receipts/${purchase.receiptId}`)}
                accessibilityRole="button"
                accessibilityLabel={`Compra del ${formatShortDate(purchase.date)} por ${formatCurrency(purchase.amount, currency)}`}
              >
                {idx > 0 ? <Divider /> : null}
                <View style={styles.purchaseRow}>
                  <View style={styles.purchaseBody}>
                    <Text style={styles.purchaseItemName} numberOfLines={1}>
                      Ticket del {formatShortDate(purchase.date)}
                    </Text>
                    <Text style={styles.purchaseDate}>
                      {purchase.receiptId
                        ? 'Toca para ver el recibo'
                        : 'Recibo sin id'}
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
  purchaseItemName: {
    ...typography.bodyMd,
    color: colors.textPrimary,
    fontWeight: '600',
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
