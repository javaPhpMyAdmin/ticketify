import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '@/components';
import { CategoryBreakdownList, useMonthlyTotals } from '@/features/analytics';
import { colors, spacing, typography } from '@/theme';

export default function AnalyticsScreen() {
  const { totals } = useMonthlyTotals();
  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Analytics</Text>
        <Text style={styles.subtitle}>August 2026</Text>
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
});
