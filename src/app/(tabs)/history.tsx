import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  Card,
  Chip,
  Icon,
  Pressable,
  Text,
  TransactionItem,
  View,
  type TransactionKind,
} from '@/components';
import { useTransactionBreakdown } from '@/features/transactions';
import { colors, radii, spacing, typography } from '@/theme';
import { formatRelativeDay } from '@/lib/format';

interface HistoryEntry {
  id: string;
  merchant: string;
  date: string; // ISO
  category: string;
  needs: number;
  wants: number;
  income: number;
}

const filters: { key: TransactionKind; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'needs', label: 'Needs' },
  { key: 'wants', label: 'Wants' },
  { key: 'income', label: 'Income' },
];

const mockEntries: HistoryEntry[] = [
  { id: '1', merchant: 'Whole Foods Market', date: '2026-08-03T12:30:00', category: 'Groceries', needs: 42.18, wants: 0, income: 0 },
  { id: '2', merchant: 'Café Martinez', date: '2026-08-03T09:15:00', category: 'Drinks', needs: 0, wants: 7.5, income: 0 },
  { id: '3', merchant: 'Kiosco 24hs', date: '2026-08-02T20:00:00', category: 'Snacks', needs: 0, wants: 3.2, income: 0 },
  { id: '4', merchant: 'Salary', date: '2026-08-01T08:00:00', category: 'Income', needs: 0, wants: 0, income: 2200 },
  { id: '5', merchant: 'Carrefour', date: '2026-07-31T18:30:00', category: 'Cleaning', needs: 18.4, wants: 0, income: 0 },
];

/**
 * Row wrapper: derives the display amount / breakdown through
 * `useTransactionBreakdown` and forwards them to the pure-render
 * `TransactionItem`.
 */
function TransactionRow({
  entry,
  filter,
  hideDivider,
}: {
  entry: HistoryEntry;
  filter: TransactionKind;
  hideDivider: boolean;
}) {
  const { amount, breakdown, isIncome } = useTransactionBreakdown(entry, filter);
  return (
    <TransactionItem
      merchant={entry.merchant}
      date={entry.date}
      category={entry.category}
      amount={amount}
      breakdown={breakdown}
      isIncome={isIncome}
      hideDivider={hideDivider}
    />
  );
}

export default function HistoryScreen() {
  const [filter, setFilter] = useState<TransactionKind>('all');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return mockEntries.filter((e) => {
      if (q && !e.merchant.toLowerCase().includes(q)) return false;
      if (filter === 'needs' && e.needs <= 0) return false;
      if (filter === 'wants' && e.wants <= 0) return false;
      if (filter === 'income' && e.income <= 0) return false;
      return true;
    });
  }, [filter, query]);

  // Group by day for the SectionList feel.
  const sections = useMemo(() => {
    const map = new Map<string, HistoryEntry[]>();
    for (const e of filtered) {
      const day = e.date.slice(0, 10);
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(e);
    }
    return Array.from(map.entries()).map(([day, data]) => ({ day, data }));
  }, [filtered]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>History</Text>
      </View>

      <View style={styles.searchRow}>
        <View style={styles.searchInputWrap}>
          <Icon name="magnifyingglass" size={18} color={colors.textSecondary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search transactions"
            placeholderTextColor={colors.textSecondary}
            style={styles.searchInput}
          />
        </View>
        <Pressable style={styles.monthButton} accessibilityRole="button">
          <Text style={styles.monthButtonText}>Aug 2026</Text>
          <Icon name="chevron.down" size={16} color={colors.textPrimary} />
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipStrip}
      >
        {filters.map((f) => (
          <Pressable key={f.key} onPress={() => setFilter(f.key)}>
            <Chip label={f.label} selected={filter === f.key} />
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.listContent}>
        {sections.map((section) => (
          <View key={section.day} style={styles.section}>
            <Text style={styles.dayHeader}>{formatRelativeDay(section.day)}</Text>
            <Card padding={spacing.sm}>
              {section.data.map((entry, idx) => (
                <TransactionRow
                  key={entry.id}
                  entry={entry}
                  filter={filter}
                  hideDivider={idx >= section.data.length - 1}
                />
              ))}
            </Card>
          </View>
        ))}
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
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  title: {
    ...typography.headlineLgMobile,
    color: colors.textPrimary,
  },
  searchRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  searchInputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.DEFAULT,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: {
    flex: 1,
    ...typography.bodyMd,
    color: colors.textPrimary,
  },
  monthButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.DEFAULT,
    borderWidth: 1,
    borderColor: colors.border,
  },
  monthButtonText: {
    ...typography.labelSm,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  chipStrip: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  listContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  section: {
    gap: spacing.sm,
  },
  dayHeader: {
    ...typography.labelCaps,
    color: colors.textSecondary,
  },
});
