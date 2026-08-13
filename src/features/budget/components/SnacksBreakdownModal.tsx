import { useMemo } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  View,
  type ListRenderItem,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Divider, EmptyState, Icon, Text } from '@/components';
import { useSettingsStore } from '@/stores/use-settings-store';
import { colors, radii, spacing, typography } from '@/theme';
import { formatCurrency } from '@/lib/format';
import {
  aggregateImpulseItemsByMonth,
  currentMonthKey,
  type CategoryItemSummary,
  type ReceiptSpendRecord,
} from '@/features/home/hooks/useHomeFeed';
import { useReceiptsStore } from '@/stores/use-receipts-store';

export interface SnacksBreakdownModalProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * Bottom-sheet style modal showing the per-item breakdown of the
 * Home "Antojos / Snacks" callout for the current month.
 *
 * Opens with `transparent` so the home screen stays visible behind the
 * scrim, slides up from the bottom via `animationType="slide"`, and
 * dismisses on backdrop tap or the close button. The data comes from
 * `useReceiptsStore.list` (the same store the home feed hydrates) so the
 * modal renders whatever the user already sees on the home card — no
 * extra network round-trip, no race with the feed refetch.
 *
 * Items are scoped to the **current month** and to those flagged
 * `is_impulse === true` (older receipts that predate the flag are
 * excluded on purpose — the modal's contract is "things you marked as
 * impulse", not "everything possibly impulse"). Aggregation is the new
 * pure `aggregateImpulseItemsByMonth` (in `useHomeFeed`), so the result
 * is testable in isolation and identical to a future server-derived
 * breakdown without any UI changes.
 */
export function SnacksBreakdownModal({ visible, onClose }: SnacksBreakdownModalProps) {
  const currency = useSettingsStore((s) => s.currency);
  const receipts = useReceiptsStore((s) => s.list);

  const monthKey = currentMonthKey();
  const rows = useMemo(
    () => aggregateImpulseItemsByMonth(receipts as ReceiptSpendRecord[], monthKey),
    [receipts, monthKey],
  );
  const total = useMemo(
    () => rows.reduce((sum, row) => sum + row.amount, 0),
    [rows],
  );

  const renderItem: ListRenderItem<CategoryItemSummary> = ({ item, index }) => (
    <View>
      {index > 0 ? <Divider /> : null}
      <View style={styles.row}>
        <Text style={styles.rowName} numberOfLines={2}>
          {capitalize(item.name)}
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
          accessibilityLabel="Cerrar desglose"
        />
        <SafeAreaView style={styles.sheet} edges={['bottom']}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.kicker}>Antojos/Snacks</Text>
              <Text style={styles.title}>Desglose del mes</Text>
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
            <Text style={styles.totalLabel}>Total del mes</Text>
            <Text style={styles.totalAmount}>
              {formatCurrency(total, currency)}
            </Text>
          </View>
          <Divider />
          {rows.length === 0 ? (
            <View style={styles.emptyWrap}>
              <EmptyState
                icon="bag.fill"
                title="Sin antojos este mes."
                body="Marcá un item como impulso al escanear un ticket para verlo acá."
              />
            </View>
          ) : (
            <FlatList
              data={rows}
              keyExtractor={(item) => item.name}
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

/** Capitalize the first letter for display; aggregator names stay lowercase. */
function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
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