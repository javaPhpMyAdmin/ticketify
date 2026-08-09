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

import { Icon, Pressable, Text, View } from '@/components';
import { CategoryCard } from '@/components/organisms/CategoryCard';
import {
  aggregateCategoriesByMonth,
  currentMonthKey,
  getAvailableMonthKeys,
  monthKeyToLabel,
  useItemSearch,
} from '@/features/home';
import { formatCurrency } from '@/lib/format';
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
  const searchResults = useItemSearch(query, monthKey);
  const { session } = useSessionStore();
  const fullName =
    session?.user?.user_metadata?.full_name ??
    session?.user?.user_metadata?.name ??
    '';
  const firstName = fullName.trim().split(' ')[0];
  const displayName = firstName || 'Usuario';
  const avatarUrl = session?.user?.user_metadata?.avatar_url;

  // Combined total across every result row: searching "yerba" matches both
  // "Yerba 1kg" and "Yerba mate 1kg" as separate rows, and this subtotal
  // answers "cuánto gasté en yerba en total" without inventing a product
  // identity that merges them.
  const searchTotal = searchResults.reduce((sum, item) => sum + item.amount, 0);

  const monthKeys = useMemo(() => getAvailableMonthKeys(list), [list]);
  const categories = useMemo(
    () => aggregateCategoriesByMonth(list, monthKey),
    [list, monthKey],
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

  const goOlder = () =>
    setMonthKey(
      currentIndex === -1 ? monthKeys[0] : monthKeys[currentIndex + 1],
    );
  const goNewer = () => setMonthKey(monthKeys[currentIndex - 1]);

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
        <Icon name="calendar" size={30} color={colors.textSecondary} />
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
            onChangeText={setQuery}
            placeholder="Buscar producto…"
            placeholderTextColor={colors.textSecondary}
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="while-editing"
            accessibilityLabel="Buscar producto"
          />
        </View>
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
          searchResults.length === 0 ? (
            <Text style={styles.empty}>
              Sin resultados para “{query.trim()}”.
            </Text>
          ) : (
            <View style={styles.searchResults}>
              <View style={styles.searchTotalRow}>
                <Text style={styles.searchTotalLabel}>
                  {searchResults.length}{' '}
                  {searchResults.length === 1 ? 'artículo' : 'artículos'}
                </Text>
                <Text style={styles.searchTotalAmount}>
                  {formatCurrency(searchTotal, currency)}
                </Text>
              </View>
              {searchResults.map((item) => (
                <Pressable
                  key={item.name}
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
              ))}
            </View>
          )
        ) : categories.length === 0 ? (
          <Text style={styles.empty}>Sin gastos este mes.</Text>
        ) : (
          <View style={styles.categoryList}>
            {categories.map((category) => (
              <CategoryCard
                key={category.key}
                icon={category.icon}
                name={category.name}
                amount={category.amount}
                currency={currency}
                layout="list"
                style={styles.categoryCard}
                onPress={() =>
                  router.push(
                    monthKey === currentMonthKey()
                      ? `/categories/${category.key}`
                      : `/categories/${category.key}?month=${monthKey}`,
                  )
                }
              />
            ))}
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
  searchTotalLabel: {
    ...typography.labelCaps,
    color: colors.textSecondary,
  },
  searchTotalAmount: {
    ...typography.headlineMd,
    color: colors.primary,
  },
  searchResultRow: {
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
    ...typography.headlineMd,
    color: colors.textPrimary,
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
  categoryCard: {
    width: '100%',
  },
  empty: {
    ...typography.bodyMd,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
});
