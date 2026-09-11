import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
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
 * The household read tri-states: while the read has NOT produced a result
 * — the RPC is in flight, OR the household store has not hydrated yet (a
 * cold start/deep link can land here with scope=household before the
 * household row loads, which disables the query) — a "Cargando datos del
 * hogar…" placeholder replaces the list and a dash replaces the total (a
 * zero here would be a false read). When the read FAILED with no rows an
 * error EmptyState with a Retry action replaces the list. The empty
 * message ("Sin gastos…") is only ever shown after a read SUCCEEDED with
 * zero rows: the household RPC resolved (an empty month is a valid
 * household state), or the personal store/query resolved with no spend.
 * Personal scope renders exactly as before.
 */
export default function CategoryDetailScreen() {
  const { key, month, scope } = useLocalSearchParams<{
    key: string;
    month?: string;
    scope?: string;
  }>();
  const currency = useSettingsStore((s) => s.currency);
  // PR 3 (`app-i18n`): drill-down copy reads from the `analytics` +
  // `common` namespaces — total label, pending/empty/error messages,
  // back a11y.
  const { t } = useTranslation(['analytics', 'common']);
  const householdScope = scope === 'household' ? 'household' : 'personal';
  const {
    category,
    total,
    items,
    isLoading,
    isError,
    errorMessage,
    retry,
    householdId,
  } = useCategoryDetail(
    key ?? 'otros',
    month,
    householdScope,
  );
  const household = householdScope === 'household';
  // Pending = the household read has NOT produced a result yet: the RPC is
  // in flight, or the household store has not hydrated (cold start / deep
  // link before the row loads — the query sits disabled). Either way the
  // list must not render a false "no spend" and the total must not render
  // a false zero — the dash/loading placeholder says "not ready" instead.
  const pending = household && (isLoading || !householdId);
  // isError only ever fires on the household path (personal resolves from
  // the receipts store and never fails — see useCategoryDetail).
  const totalPlaceholder = pending || isError;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t('common:back')}
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
          <Text style={styles.totalLabel}>{t('analytics:totalKicker')}</Text>
          <Text style={styles.totalAmount}>
            {totalPlaceholder ? '—' : formatCurrency(total, currency)}
          </Text>
        </View>

        <View style={styles.itemsCard}>
          {pending ? (
            <Text style={styles.empty}>{t('analytics:loadingHousehold')}</Text>
          ) : household && isError ? (
            <EmptyState
              icon="exclamationmark.triangle.fill"
              title={errorMessage}
              actionLabel={t('common:retry')}
              onAction={retry}
            />
          ) : items.length === 0 ? (
            <Text style={styles.empty}>
              {t('analytics:drillDownItemEmpty')}
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
