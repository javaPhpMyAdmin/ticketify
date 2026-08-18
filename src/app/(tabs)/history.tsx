import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
} from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import { EmptyState, Icon, Pressable, SearchRowSkeleton, Text, View } from '@/components';
import { useMonthlyTotals } from '@/features/analytics';
import {
  aggregateCategoriesByMonth,
  aggregateCategoryItemCounts,
  CategoryBudgetCard,
  currentMonthKey,
  getAvailableMonthKeys,
  monthKeyToLabel,
  SegmentedBudgetBar,
  useItemSearch,
} from '@/features/home';
import { getExpenseCategory } from '@/features/home/categories';
import { formatCurrency } from '@/lib/format';
import { categoryDetailHref } from '@/features/charts';
import { useHouseholdStore } from '@/stores/use-household-store';
import { useReceiptsStore } from '@/stores/use-receipts-store';
import { useSettingsStore } from '@/stores/use-settings-store';
import { colors, radii, spacing, typography } from '@/theme';
import { useSessionStore } from '../../features/auth';

/**
 * NativeTabs (iOS) does not push screen content up: the ScrollView must clear
 * the native tab bar itself or the last category card hides behind its glass.
 * Same values as the Home screen's FAB: UIKit base height (49pt) plus the
 * home-indicator inset at render time; Android's Material 3 NavigationBar is
 * taller and fully opaque.
 */
const TAB_BAR_HEIGHT = Platform.select({ ios: 49, android: 80, default: 49 });

/**
 * Monthly spending history: navigate month → categories, each card
 * drilling into `/categories/[key]?month=…`. The month selector moves
 * within the months that actually have receipts (`getAvailableMonthKeys`),
 * so empty months never appear as steps; the current month stays reachable
 * even when it has no data yet ("Sin gastos este mes.").
 */
export default function HistoryScreen() {
  const list = useReceiptsStore((s) => s.list);
  const currency = useSettingsStore((s) => s.currency);
  const insets = useSafeAreaInsets();
  const [monthKey, setMonthKey] = useState(currentMonthKey);
  // Item search: empty query shows the category list; typing switches the
  // scroll area to product-level results (cross-category, month-scoped).
  const [query, setQuery] = useState('');
  const isSearching = query.trim().length > 0;
  const {
    results: searchResults,
    isLoading: searchLoading,
    error: searchError,
    hasData: searchHasData,
  } = useItemSearch(query, monthKey);
  // Visually excluded search results ("eliminar" del listado). Local-only:
  // never touches the DB, and it resets whenever the query changes so a new
  // search starts from the full result set.
  const [hiddenItems, setHiddenItems] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const visibleResults = searchResults.filter(
    (item) => !hiddenItems.has(item.name),
  );
  const { session } = useSessionStore();
  const fullName =
    session?.user?.user_metadata?.full_name ??
    session?.user?.user_metadata?.name ??
    '';
  const firstName = fullName.trim().split(' ')[0];
  const displayName = firstName || 'Usuario';
  const avatarUrl = session?.user?.user_metadata?.avatar_url;

  // Personal vs household view toggle
  const [viewMode, setViewMode] = useState<'personal' | 'household'>('personal');
  const householdId = useHouseholdStore((s) => s.household?.id);
  const hasHousehold = !!householdId;

  // Household-scoped category totals (when in household mode)
  const {
    totals: householdTotals,
    isLoading: householdTotalsLoading,
    error: householdTotalsError,
    hasData: householdTotalsHasData,
  } = useMonthlyTotals(
    monthKey,
    viewMode === 'household' ? householdId : null,
  );

  // Combined total across every VISIBLE result row: searching "yerba"
  // matches both "Yerba 1kg" and "Yerba mate 1kg" as separate rows, and this
  // subtotal answers "cuánto gasté en yerba en total" without inventing a
  // product identity that merges them. Items excluded from the list are
  // excluded from this total too.
  const searchTotal = visibleResults.reduce(
    (sum, item) => sum + item.amount,
    0,
  );

  const monthKeys = useMemo(() => getAvailableMonthKeys(list), [list]);
  const categories = useMemo(
    () => aggregateCategoriesByMonth(list, monthKey),
    [list, monthKey],
  );
  const categoryItemCounts = useMemo(
    () => aggregateCategoryItemCounts(list, monthKey),
    [list, monthKey],
  );
  // Percent base for the category cards: what the month actually spent on
  // categorized items (the bar + cards only cover the categories that
  // appear, so the total must be their sum, not the whole month's spend).
  const monthTotal = useMemo(
    () => categories.reduce((sum, category) => sum + category.amount, 0),
    [categories],
  );

  // `monthKeys` is newest-first. The selected month may not be in it (e.g.
  // the current month with no receipts yet): it is then newer than
  // everything, so only "older" is enabled and it jumps to the newest
  // month that has data.
  const currentIndex = monthKeys.indexOf(monthKey);
  const canGoNewer = currentIndex > 0;
  const canGoOlder =
    currentIndex === -1
      ? monthKeys.length > 0
      : currentIndex < monthKeys.length - 1;

  const goOlder = () => {
    setMonthKey(
      currentIndex === -1 ? monthKeys[0] : monthKeys[currentIndex + 1],
    );
    setHiddenItems(new Set());
  };
  const goNewer = () => {
    setMonthKey(monthKeys[currentIndex - 1]);
    setHiddenItems(new Set());
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.push('/profile')}
          accessibilityLabel="Abrir perfil"
          accessibilityRole="button"
        >
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarInitial}>
                {displayName.charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
        </Pressable>
        <Text style={styles.title}>Ticketify</Text>
        <Icon name="calendar" size={30} color={colors.primary} />
      </View>

      {/* Month selector + total stay pinned above the scroll so the user
          always sees which month they're looking at and how much it cost
          while browsing the category cards. */}
      <View style={styles.fixedHeader}>
        <View style={styles.monthSelector}>
          <Pressable
            onPress={goOlder}
            disabled={!canGoOlder}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Mes anterior"
            accessibilityState={{ disabled: !canGoOlder }}
          >
            <Icon
              name="chevron.left"
              size={22}
              color={canGoOlder ? colors.textPrimary : colors.textSecondary}
            />
          </Pressable>
          <Text style={styles.monthLabel}>{monthKeyToLabel(monthKey)}</Text>
          <Pressable
            onPress={goNewer}
            disabled={!canGoNewer}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Mes siguiente"
            accessibilityState={{ disabled: !canGoNewer }}
          >
            <Icon
              name="chevron.right"
              size={22}
              color={canGoNewer ? colors.textPrimary : colors.textSecondary}
            />
          </Pressable>
        </View>

        <View style={styles.searchBox}>
          <Icon name="magnifyingglass" size={16} color={colors.textSecondary} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={(text) => {
              setQuery(text);
              setHiddenItems(new Set());
            }}
            placeholder={viewMode === 'household' ? 'Buscador no disponible en modo hogar' : 'Buscar producto…'}
            placeholderTextColor={colors.textSecondary}
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="while-editing"
            accessibilityLabel="Buscar producto"
            editable={viewMode !== 'household'}
          />
        </View>

        {/* Personal / Household toggle — only when the user has a household */}
        {hasHousehold ? (
          <View style={styles.viewToggle}>
            {(['personal', 'household'] as const).map((mode) => {
              const active = viewMode === mode;
              return (
                <Pressable
                  key={mode}
                  onPress={() => {
                    setViewMode(mode);
                    setQuery('');
                    setHiddenItems(new Set());
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[styles.viewSegment, active && styles.viewSegmentActive]}
                >
                  <Text
                    style={[
                      styles.viewSegmentLabel,
                      active && styles.viewSegmentLabelActive,
                    ]}
                  >
                    {mode === 'personal' ? 'Mi gasto' : 'Hogar'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          // Clear the native tab bar: without this the last category card
          // sits behind its glass and can't be scrolled above it.
          { paddingBottom: insets.bottom + TAB_BAR_HEIGHT + spacing.lg },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {isSearching ? (
          // Loading and error must never flash the false "Sin resultados":
          // a slow search renders skeletons, a failed one an error state —
          // and only when there is no retained data to keep showing.
          searchLoading ? (
            <View style={styles.searchResults}>
              {[0, 1, 2].map((i) => (
                <SearchRowSkeleton key={i} />
              ))}
            </View>
          ) : searchError && !searchHasData ? (
            <EmptyState
              icon="exclamationmark.triangle.fill"
              title={searchError}
            />
          ) : searchResults.length === 0 ? (
            <Text style={styles.empty}>
              Sin resultados para “{query.trim()}”.
            </Text>
          ) : visibleResults.length === 0 ? (
            <View style={styles.searchResults}>
              <View style={styles.searchTotalRow}>
                <Text style={styles.searchTotalLabel}>
                  {hiddenItems.size === searchResults.length
                    ? 'Todos ocultos'
                    : '0 artículos'}
                </Text>
                <Text style={styles.searchTotalAmount}>
                  {formatCurrency(0, currency)}
                </Text>
              </View>
              <Text style={styles.empty}>
                Ocultaste todos los resultados de “{query.trim()}”.
              </Text>
              <Pressable
                style={({ pressed }) => [
                  styles.restoreButton,
                  pressed && styles.searchResultPressed,
                ]}
                onPress={() => setHiddenItems(new Set())}
                accessibilityRole="button"
                accessibilityLabel="Restaurar resultados"
              >
                <Text style={styles.restoreButtonText}>
                  Restaurar resultados
                </Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.searchResults}>
              <View style={styles.searchTotalRow}>
                <View style={styles.searchTotalLeft}>
                  <Text style={styles.searchTotalLabel}>
                    {visibleResults.length}{' '}
                    {visibleResults.length === 1 ? 'artículo' : 'artículos'}
                  </Text>
                  {hiddenItems.size > 0 ? (
                    <Pressable
                      onPress={() => setHiddenItems(new Set())}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Restaurar resultados"
                    >
                      <Text style={styles.restoreLink}>Restaurar</Text>
                    </Pressable>
                  ) : null}
                </View>
                <Text style={styles.searchTotalAmount}>
                  {formatCurrency(searchTotal, currency)}
                </Text>
              </View>
              {visibleResults.map((item) => (
                <View key={item.name} style={styles.searchResultWrap}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.searchResultRow,
                      pressed && styles.searchResultPressed,
                    ]}
                    onPress={() =>
                      router.push(
                        `/items/${encodeURIComponent(
                          item.name,
                        )}?month=${monthKey}`,
                      )
                    }
                    accessibilityRole="button"
                  >
                    <Text style={styles.searchResultName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.searchResultAmount}>
                      {formatCurrency(item.amount, currency)}
                    </Text>
                    <View style={styles.searchWrapGo}>
                      <Text style={styles.searchGo} numberOfLines={1}>
                        VER
                      </Text>
                      <Icon
                        name="chevron.right"
                        size={16}
                        color={colors.onPrimary}
                      />
                    </View>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [
                      styles.hideItemButton,
                      pressed && styles.hideItemPressed,
                    ]}
                    onPress={() =>
                      setHiddenItems(
                        (prev) => new Set(prev).add(item.name),
                      )
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`Ocultar ${item.name}`}
                  >
                    <Icon
                      name="xmark"
                      size={14}
                      color={colors.textSecondary}
                    />
                  </Pressable>
                </View>
              ))}
            </View>
          )
        ) : viewMode === 'household' ? (
          // Household mode: show RPC-backed category totals
          householdTotalsLoading ? (
            <Text style={styles.empty}>Cargando datos del hogar…</Text>
          ) : householdTotalsError && !householdTotalsHasData ? (
            <EmptyState
              icon="exclamationmark.triangle.fill"
              title={householdTotalsError}
            />
          ) : householdTotals.length === 0 ? (
            <Text style={styles.empty}>Sin gastos este mes en el hogar.</Text>
          ) : (
            <View style={styles.categoryList}>
              {householdTotals.map((t) => {
                const category = getExpenseCategory(t.category_slug);
                return (
                  <CategoryBudgetCard
                    key={t.category_id}
                    categoryKey={t.category_slug}
                    name={t.category_name}
                    amount={t.total}
                    percent={t.percent_of_total}
                    currency={currency}
                    icon={category.icon}
                    itemCount={t.item_count}
                    onPress={() =>
                      router.push(
                        categoryDetailHref(t.category_slug, monthKey, currentMonthKey()),
                      )
                    }
                  />
                );
              })}
            </View>
          )
        ) : categories.length === 0 ? (
          <Text style={styles.empty}>Sin gastos este mes.</Text>
        ) : (
          <View style={styles.categoryList}>
            <SegmentedBudgetBar categories={categories} />
            {categories.map((category) => {
              const percent =
                monthTotal === 0 ? 0 : (category.amount / monthTotal) * 100;
              return (
                <CategoryBudgetCard
                  key={category.key}
                  categoryKey={category.key}
                  name={category.name}
                  amount={category.amount}
                  percent={percent}
                  currency={currency}
                  icon={category.icon}
                  itemCount={categoryItemCounts[category.key]}
                  onPress={() =>
                    router.push(
                      categoryDetailHref(category.key, monthKey, currentMonthKey()),
                    )
                  }
                />
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 25,
  },
  avatarFallback: {
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    ...typography.headlineMd,
    color: colors.background,
  },
  searchWrapGo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    padding: 10,
    borderRadius: 10,
    backgroundColor: colors.primary,
  },
  searchGo: {
    fontSize: 19,
    fontWeight: 900,
    lineHeight: 24,
    letterSpacing: 0.5,
    color: colors.onPrimary,
  },
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    // ...typography.headlineLgMobile,
    fontSize: 25,
    fontWeight: '900',
    color: colors.primary,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  fixedHeader: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    height: 50,
  },
  searchInput: {
    flex: 1,
    ...typography.bodyMd,
    color: colors.textPrimary,
    padding: 0,
  },
  searchResults: {
    gap: spacing.sm,
  },
  searchTotalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  searchTotalLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  searchTotalLabel: {
    ...typography.labelCaps,
    color: colors.textSecondary,
  },
  searchTotalAmount: {
    ...typography.headlineMd,
    color: colors.primary,
  },
  searchResultWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  searchResultRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  searchResultPressed: {
    transform: [{ scale: 0.98 }],
  },
  hideItemButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  hideItemPressed: {
    opacity: 0.6,
  },
  restoreLink: {
    ...typography.labelCaps,
    color: colors.primary,
    textDecorationLine: 'underline',
  },
  restoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  restoreButtonText: {
    ...typography.bodyMd,
    color: colors.onPrimary,
    fontWeight: '700',
  },
  searchResultName: {
    ...typography.bodyMd,
    color: colors.textPrimary,
    flex: 1,
  },
  searchResultAmount: {
    ...typography.headlineMd,
    color: colors.textPrimary,
  },
  monthSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  monthLabel: {
    // ...typography.headlineMd,
    fontSize: 20,
    fontWeight: '900',
    color: colors.textSecondary,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 10,
  },
  totalLabel: {
    ...typography.labelCaps,
    color: colors.primary,
  },
  totalAmount: {
    ...typography.headlineMd,
    color: colors.primary,
  },
  categoryList: {
    gap: spacing.md,
  },
  viewToggle: {
    flexDirection: 'row',
    backgroundColor: colors.border,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.full,
    padding: 3,
    gap: 2,
  },
  viewSegment: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
  },
  viewSegmentActive: {
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  viewSegmentLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  viewSegmentLabelActive: {
    color: colors.textPrimary,
    fontWeight: '700',
  },
  empty: {
    ...typography.bodyMd,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
});
