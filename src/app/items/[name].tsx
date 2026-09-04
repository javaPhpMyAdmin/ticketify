import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  Divider,
  Icon,
  IconButton,
  Text,
  View,
} from '@/components';
import { monthKeyToLabel, useItemDetail, normalizeItemName } from '@/features/home';
import { RenameItemModal, useRenameItem } from '@/features/items';
import { formatCurrency, formatShortDate } from '@/lib/format';
import { useSettingsStore } from '@/stores/use-settings-store';
import { colors, radii, spacing, typography } from '@/theme';

/**
 * Item drill-down: one normalized product's monthly total plus each
 * individual purchase (store, ticket date, amount), wherever it was bought.
 * Answers "cuánto gasté en menú del día este mes" across categories and
 * stores — the identity lens that complements the category drill-down. The
 * optional `month` search param (`YYYY-MM`, from the History tab) scopes the
 * aggregation; without it the current month is used.
 *
 * A pencil button in the header opens the shared `RenameItemModal`: the
 * write goes through `useRenameItem` (server-side UPDATE on
 * `purchase_items`), which also invalidates the home feed and item-search
 * caches so the renamed item shows up everywhere on the next render. On
 * success the screen `router.replace`s itself to the new normalized URL
 * so the address bar matches the bucket the item now belongs to.
 */
export default function ItemDetailScreen() {
  const { name, month } = useLocalSearchParams<{
    name: string;
    month?: string;
  }>();
  const currency = useSettingsStore((s) => s.currency);
  const itemName = name ?? '';
  const { total, purchases } = useItemDetail(itemName, month);

  const { mutate: renameItem, isLoading: isRenaming, error: renameError } =
    useRenameItem();
  const [renameOpen, setRenameOpen] = useState(false);

  const handleRename = async (newName: string) => {
    // The detail screen is keyed on the normalized NAME in the URL, not
    // the underlying `purchase_items.id`. Pull the id off the first
    // matching purchase in the store so the UPDATE targets the exact
    // row the user is looking at. If the row was hydrated without an id
    // (e.g. an offline fixture), `purchaseItemId` is undefined and we
    // bail — better than a write that touches the wrong row.
    const targetId = purchases[0]?.purchaseItemId;
    if (!targetId) return;
    const result = await renameItem(targetId, newName);
    if (result.status === 'ok') {
      setRenameOpen(false);
      // `router.replace` (not `router.back`) so the new URL matches the
      // bucket the renamed item now belongs to; back would lose the
      // success state and the user would never see the renamed screen.
      const nextPath =
        '/items/' + encodeURIComponent(normalizeItemName(result.newName));
      router.replace(nextPath as never);
    }
    // On `error`, leave the modal open so the user sees the inline
    // errorMessage; the parent's `error` state drives the field group.
  };

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
        <IconButton
          icon="pencil"
          iconSize={20}
          onPress={() => setRenameOpen(true)}
          accessibilityLabel="Editar nombre del producto"
        />
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
              <>
                {/* The label intentionally excludes the visible caption so
                    VoiceOver doesn't double-announce "Toca para ver el
                    ticket" (label + hint). */}
                <Pressable
                  key={`${purchase.receiptId}-${idx}`}
                  onPress={() => router.push(`/receipts/${purchase.receiptId}`)}
                  accessibilityRole="button"
                  accessibilityHint="Toca para ver el ticket"
                  accessibilityLabel={`${purchase.storeName}, ${formatShortDate(purchase.date)}`}
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
                    <Text style={styles.purchaseCaption} numberOfLines={1}>
                      Toca para ver el ticket
                    </Text>
                  </View>
                  <Text style={styles.purchaseAmount}>
                    {formatCurrency(purchase.amount, currency)}
                  </Text>
                </View>
                </Pressable>
              </>
            ))
          )}
        </View>
      </ScrollView>

      <RenameItemModal
        visible={renameOpen}
        currentName={itemName}
        isLoading={isRenaming}
        errorMessage={renameError}
        onChange={() => {
          // The modal owns its own buffer; this is a no-op hook so
          // parents that want to react to keystrokes (e.g. for telemetry)
          // have a slot. We intentionally don't track the value here —
          // it's captured on save.
        }}
        onCancel={() => setRenameOpen(false)}
        onSave={handleRename}
      />
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
  purchaseCaption: {
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
