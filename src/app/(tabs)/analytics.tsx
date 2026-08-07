import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon, Text } from '@/components';
import { CategoryBreakdownList, useMonthlyTotals, usePriceAlerts } from '@/features/analytics';
import { formatYearMonth } from '@/lib/format';
import { utcYearMonth } from '@/lib/query-keys';
import { colors, radii, spacing, typography } from '@/theme';

export default function AnalyticsScreen() {
  const { totals, error } = useMonthlyTotals();
  const alerts = usePriceAlerts();
  // Same UTC derivation the totals RPC uses, so the subtitle always names the
  // live data month (e.g. "Agosto 2026").
  const monthLabel = formatYearMonth(utcYearMonth(), { full: true, capitalize: true });
  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Analítica</Text>
        <Text style={styles.subtitle}>{monthLabel}</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {alerts.map((alert) => (
          <View key={alert.name} style={styles.alertBanner}>
            <Icon name="exclamationmark.triangle.fill" size={20} color={colors.danger} />
            <View style={styles.alertTextWrap}>
              <Text style={styles.alertText}>
                {alert.name}{' '}
                {alert.changePct >= 0 ? 'subió' : 'bajó'}{' '}
                {Math.abs(alert.changePct)}% vs el mes pasado
              </Text>
            </View>
          </View>
        ))}
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
  alertBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  alertTextWrap: {
    flex: 1,
  },
  alertText: {
    ...typography.bodyMd,
    color: colors.textPrimary,
  },
});
