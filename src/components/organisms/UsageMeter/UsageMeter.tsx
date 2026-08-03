import { StyleSheet } from 'react-native';

import { Card, ProgressBar, Text, View } from '@/components';
import { colors, spacing, typography } from '@/theme';

export interface UsageMeterProps {
  used: number;
  limit: number;
  kicker?: string;
  resetLabel?: string;
  upgradeLabel?: string;
}

/**
 * Free-tier scan usage card. Renders "Scans Used X/Y", a "Reset in N
 * days" note, a `ProgressBar`, and the upgrade pitch. Clamps the
 * fill at 1 so users on the pro tier don't see a broken bar.
 */
export function UsageMeter({
  used,
  limit,
  kicker = 'Monthly Free AI Scans',
  resetLabel = 'Reset in 12 days',
  upgradeLabel = 'Upgrade for unlimited.',
}: UsageMeterProps) {
  const ratio = limit > 0 ? Math.min(1, used / limit) : 0;
  return (
    <Card>
      <Text style={styles.kicker}>{kicker}</Text>
      <View style={styles.row}>
        <Text style={styles.used}>
          Scans Used {used}/{limit}
        </Text>
        <Text style={styles.reset}>{resetLabel}</Text>
      </View>
      <View style={styles.progressWrap}>
        <ProgressBar value={ratio} />
      </View>
      <Text style={styles.upgrade}>{upgradeLabel}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  kicker: {
    ...typography.labelCaps,
    color: colors.textSecondary,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: spacing.sm,
  },
  used: {
    ...typography.headlineMd,
    color: colors.textPrimary,
  },
  reset: {
    ...typography.labelSm,
    color: colors.textSecondary,
  },
  progressWrap: {
    marginTop: spacing.md,
  },
  upgrade: {
    ...typography.bodyMd,
    color: colors.primary,
    fontWeight: '600',
    marginTop: spacing.md,
  },
});
