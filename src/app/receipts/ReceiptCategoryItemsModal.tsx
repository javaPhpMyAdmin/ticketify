import { FlatList, Modal, Pressable, StyleSheet, View, type ListRenderItem } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Divider, EmptyState, Icon, Text } from '@/components';
import { formatCurrency } from '@/lib/format';
import { colors, radii, spacing, typography } from '@/theme';

/** One line item of THIS receipt inside the tapped category. */
export interface ReceiptCategoryItem {
  name: string;
  amount: number;
  /** Bought quantity; rendered as " ×N" only when greater than 1. */
  quantity?: number;
}

export interface ReceiptCategoryItemsModalProps {
  visible: boolean;
  /** Display label of the category, e.g. "Lácteos". */
  categoryLabel: string;
  /** The category's total from THIS receipt (`category_totals[slug]`). */
  total: number;
  /** Items from this receipt filtered to the category. */
  items: ReceiptCategoryItem[];
  currency?: string;
  onClose: () => void;
}

/**
 * Bottom-sheet modal listing ONLY the tapped receipt's items in one
 * category, opened by tapping a row in the receipt detail "Categorías"
 * card. Same shell as `DayDetailModal`: transparent backdrop so the
 * receipt stays visible, slides up via `animationType="slide"`, dismisses
 * on backdrop tap or the close button. The header pins the category label
 * and this receipt's category total; each row shows the item name (with
 * " ×qty" when the receipt bought more than one unit) and its amount.
 *
 * The pinned "Total en este recibo" comes from `category_totals[slug]` (the
 * final discounted amount), while each row shows `item.amount` — the
 * pre-discount line. The two grains can disagree by design; do not "fix"
 * the header to re-sum the rows (mirror of `DayDetailModal`).
 */
export function ReceiptCategoryItemsModal({
  visible,
  categoryLabel,
  total,
  items,
  currency = 'UYU',
  onClose,
}: ReceiptCategoryItemsModalProps) {
  const renderItem: ListRenderItem<ReceiptCategoryItem> = ({ item, index }) => (
    <View>
      {index > 0 ? <Divider /> : null}
      <View style={styles.row}>
        <Text style={styles.rowName} numberOfLines={2}>
          {item.name}
          {(item.quantity ?? 0) > 1 ? ` ×${item.quantity}` : ''}
        </Text>
        <Text style={styles.rowAmount}>
          {formatCurrency(item.amount, currency)}
        </Text>
      </View>
    </View>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <Pressable
          style={styles.backdropTouch}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Cerrar artículos de la categoría"
        />
        <SafeAreaView style={styles.sheet} edges={['bottom']}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.kicker}>{categoryLabel}</Text>
              <Text style={styles.title}>Artículos de la categoría</Text>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Cerrar"
              style={styles.closeButton}
            >
              <Icon name="xmark" size={22} color={colors.textPrimary} />
            </Pressable>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total en este ticket</Text>
            <Text style={styles.totalAmount}>
              {formatCurrency(total, currency)}
            </Text>
          </View>
          <Divider />
          {items.length === 0 ? (
            <View style={styles.emptyWrap}>
              <EmptyState
                icon="doc.text"
                title="Sin artículos en esta categoría."
                body="Este ticket no tiene artículos detallados en esta categoría."
              />
            </View>
          ) : (
            <FlatList
              data={items}
              keyExtractor={(item, index) => `${item.name}-${index}`}
              renderItem={renderItem}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            />
          )}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  // Pressable layer that catches taps outside the sheet — sits behind the
  // sheet visually but covers the rest of the screen so `onPress` closes
  // the modal even on the dimmed area.
  backdropTouch: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    paddingTop: spacing.sm,
    maxHeight: '80%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  kicker: {
    ...typography.labelCaps,
    color: colors.textSecondary,
  },
  title: {
    ...typography.headlineMd,
    color: colors.textPrimary,
  },
  closeButton: {
    padding: spacing.xs,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
  },
  totalLabel: {
    ...typography.bodyMd,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  totalAmount: {
    ...typography.headlineMd,
    color: colors.primary,
  },
  listContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  rowName: {
    ...typography.bodyLg,
    color: colors.textPrimary,
    flex: 1,
  },
  rowAmount: {
    ...typography.bodyLg,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  emptyWrap: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
  },
});
