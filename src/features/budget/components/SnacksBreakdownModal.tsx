import { useMemo } from 'react';
import { FlatList, StyleSheet, View, type ListRenderItem } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';

import { BottomSheet, Divider, EmptyState, Spinner, Text } from '@/components';
import { useSettingsStore } from '@/stores/use-settings-store';
import { colors, spacing, typography } from '@/theme';
import { formatCurrency } from '@/lib/format';
import { readMonthlyImpulseItems } from '@/lib/supabase/feature-access';
import { toQueryData } from '@/lib/supabase/query-adapters';
import { useSessionUser } from '@/features/auth';
import { queryKeys } from '@/lib/query-keys';

export interface SnacksBreakdownModalProps {
  visible: boolean;
  onClose: () => void;
  /** The `YYYY-MM` month whose impulse items this modal breaks down. */
  monthKey: string;
}

interface ImpulseItem {
  name: string;
  amount: number;
}

/**
 * Bottom-sheet style modal showing the per-item breakdown of the
 * Home "Antojos / Snacks" callout for the current month.
 *
 * Data comes from the `monthly_impulse_items` RPC (server-side) so the
 * breakdown loads ALL impulse items instantly, regardless of how many
 * infinite-scroll pages the user has loaded.
 */
export function SnacksBreakdownModal({
  visible,
  onClose,
  monthKey,
}: SnacksBreakdownModalProps) {
  const { t } = useTranslation('settings');
  const currency = useSettingsStore((s) => s.currency);
  const { userId } = useSessionUser();

  const itemsQuery = useQuery<ImpulseItem[]>({
    queryKey: queryKeys.monthlyImpulseItems(userId!, monthKey),
    enabled: !!userId && visible,
    queryFn: async () => {
      const result = await readMonthlyImpulseItems(monthKey);
      return toQueryData(result);
    },
  });

  const rows = itemsQuery.data ?? [];
  const total = useMemo(
    () => rows.reduce((sum, row) => sum + row.amount, 0),
    [rows],
  );

  const renderItem: ListRenderItem<ImpulseItem> = ({ item, index }) => (
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
    <BottomSheet
      visible={visible}
      onClose={onClose}
      kicker={t('snacksModalKicker')}
      title={t('snacksModalTitle')}
      backdropLabel={t('snacksModalBackdropA11y')}
    >
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>{t('snacksModalTotal')}</Text>
        <Text style={styles.totalAmount}>
          {formatCurrency(total, currency)}
        </Text>
      </View>
      <Divider />
      {itemsQuery.isPending ? (
        // RPC in flight: spinner instead of a false "Sin antojos" empty
        // state + $0 flash. The total row above stays $0 while loading.
        <View style={styles.loadingWrap}>
          <Spinner />
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.emptyWrap}>
          <EmptyState
            icon="bag.fill"
            title={t('snacksModalEmptyTitle')}
            body={t('snacksModalEmptyBody')}
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
    </BottomSheet>
  );
}

/** Capitalize the first letter for display; aggregator names stay lowercase. */
function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const styles = StyleSheet.create({
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
  loadingWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
});
