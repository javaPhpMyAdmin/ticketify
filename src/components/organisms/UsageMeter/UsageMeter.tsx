import { StyleSheet } from 'react-native';

import { Card, Icon, ProgressBar, Text, View } from '@/components';
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
  kicker = 'Escaneos gratuitos mensuales',
  resetLabel = 'Se restablece en 12 días',
  upgradeLabel = 'Actualiza para obtener escaneos ilimitados.',
}: UsageMeterProps) {
  const ratio = limit > 0 ? Math.min(1, used / limit) : 0;
  return (
    <Card>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: colors.surface,
        }}
      >
        <View style={{ backgroundColor: colors.surface }}>
          <Text style={styles.kicker}>LÍMITE DE USO</Text>
          <Text style={styles.kicker}>{kicker}</Text>
        </View>
        <Icon name="qrcode.viewfinder" size={33} color={colors.primary} />
      </View>
      <View style={styles.row}>
        <Text style={styles.used}>Escaneos usados</Text>
        <Text style={{ color: colors.textPrimary, fontWeight: '900' }}>
          {used}/{limit}
        </Text>
      </View>
      <View style={styles.progressWrap}>
        <ProgressBar value={ratio} />
      </View>
      <Text style={styles.reset}>{resetLabel}</Text>
      <Text style={styles.upgrade}>{upgradeLabel}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  kicker: {
    // ...typography.labelCaps,
    fontSize: 17,
    fontWeight: '900',
    color: colors.textSecondary,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
  },
  used: {
    ...typography.headlineMd,
    color: colors.textPrimary,
  },
  reset: {
    // ...typography.labelSm,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  progressWrap: {
    marginTop: spacing.md,
  },
  upgrade: {
    // ...typography.bodyMd,
    fontSize: 15,
    color: 'green',
    fontWeight: '800',
    marginTop: spacing.xs,
  },
});
