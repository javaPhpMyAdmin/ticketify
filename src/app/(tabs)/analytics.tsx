import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '@/components';
import { CategoryBreakdownList, useMonthlyTotals } from '@/features/analytics';
import { formatYearMonth } from '@/lib/format';
import { utcYearMonth } from '@/lib/query-keys';
import { colors, spacing, typography } from '@/theme';

export default function AnalyticsScreen() {
  const { totals, error } = useMonthlyTotals();
  // Same UTC derivation the totals RPC uses, so the subtitle always names the
  // live data month (e.g. "Agosto 2026").
  const monthLabel = formatYearMonth(utcYearMonth(), { full: true, capitalize: true });
  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Analítica</Text>
        <Text style={styles.subtitle}>{monthLabel}</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <CategoryBreakdownList rows={totals} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  title: {
    ...typography.headlineLg,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.bodyMd,
    color: colors.textSecondary,
    marginTop: -spacing.md,
  },
  error: {
    ...typography.labelSm,
    color: colors.danger,
  },
});
