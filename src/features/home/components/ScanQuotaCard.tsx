import { StyleSheet } from 'react-native';

import { Card, ProgressBar, Text, View } from '@/components';
import { colors, spacing, typography } from '@/theme';
import { useScanQuota } from '../hooks/useScanQuota';

/**
 * Compact scan-quota strip for the home screen. Hides itself until the
 * usage row loads, so a slow read never leaves a blank card. When the
 * monthly allowance is exhausted the caption switches to the danger color
 * — the user should see the limit before tapping "Escanear recibo".
 */
export function ScanQuotaCard() {
  const { usage } = useScanQuota();
  if (!usage) return null;

  const remaining = Math.max(usage.scans_limit - usage.scans_used, 0);
  const exhausted = remaining === 0;
  const ratio =
    usage.scans_limit > 0 ? Math.min(1, usage.scans_used / usage.scans_limit) : 0;

  return (
    <Card padding={spacing.md}>
      <View style={styles.row}>
        <Text style={styles.kicker}>Escaneos este mes</Text>
        <Text style={styles.detail}>
          {usage.scans_used}/{usage.scans_limit} usados
        </Text>
      </View>
      <View style={styles.remainingWrap}>
        <Text style={[styles.remaining, exhausted && styles.exhausted]}>
          {exhausted ? 'Sin escaneos disponibles' : `Quedan ${remaining}`}
        </Text>
      </View>
      <View style={styles.progressWrap}>
        <ProgressBar value={ratio} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  kicker: {
    ...typography.labelCaps,
    color: colors.textSecondary,
  },
  detail: {
    ...typography.labelSm,
    color: colors.textSecondary,
  },
  remainingWrap: {
    marginTop: spacing.sm,
  },
  remaining: {
    ...typography.headlineMd,
    color: colors.textPrimary,
  },
  exhausted: {
    color: colors.danger,
  },
  progressWrap: {
    marginTop: spacing.md,
  },
});
