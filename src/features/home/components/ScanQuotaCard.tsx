import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import { Card, Pressable, ProgressBar, Text, View } from '@/components';
import { colors, spacing, typography } from '@/theme';
import { computeQuotaState } from '../quota';
import { useScanQuota } from '../hooks/useScanQuota';

/**
 * Compact scan-quota strip for the home screen (pro-subscription spec
 * — REQ-QUOTA-6, REQ-GATE-4). Hides itself until the usage row loads,
 * so a slow read never leaves a blank card.
 *
 * Branches (driven by `computeQuotaState`):
 *
 *   - **Pro** (`unlimited === true`): renders the "Ilimitado" label and
 *     NO paywall CTA. The CRITICAL-2 invariant: a paying user must
 *     never see the upgrade pitch, even if their scan_usage row still
 *     carries a stale numeric limit (set_profile_tier writes NULL on
 *     GRANT, but the row stays numeric until the next scan).
 *   - **Free + exhausted**: renders the danger caption "Sin escaneos
 *     disponibles" and a pressable CTA that pushes the paywall
 *     (`/pro`).
 *   - **Free + remaining**: renders "X de Y" + the progress bar.
 *
 * Spanish copy is intentionally parallel with the rest of the home
 * screen ("Escaneos este mes", "Mejorar a Pro").
 */
export function ScanQuotaCard() {
  const { usage, isPro } = useScanQuota();
  if (!usage) return null;

  const state = computeQuotaState(usage.used, usage.limit, isPro);

  if (state.unlimited) {
    return (
      <Card padding={spacing.md}>
        <View style={styles.row}>
          <Text style={styles.kicker}>Escaneos este mes</Text>
          <Text style={styles.detail}>{usage.used} usados</Text>
        </View>
        <View style={styles.remainingWrap}>
          <Text style={styles.remaining}>Ilimitado</Text>
        </View>
      </Card>
    );
  }

  if (state.exhausted) {
    return (
      <Card padding={spacing.md}>
        <View style={styles.row}>
          <Text style={styles.kicker}>Escaneos este mes</Text>
          <Text style={styles.detail}>
            {usage.used}/{state.effectiveLimit} usados
          </Text>
        </View>
        <View style={styles.remainingWrap}>
          <Text style={[styles.remaining, styles.exhausted]}>
            Sin escaneos disponibles
          </Text>
        </View>
        <Pressable
          style={styles.upgradeCta}
          onPress={() => router.push('/pro')}
          accessibilityRole="button"
          accessibilityLabel="Mejorar a Pro para obtener escaneos ilimitados"
        >
          <Text style={styles.upgradeCtaText}>Mejorar a Pro</Text>
        </Pressable>
      </Card>
    );
  }

  return (
    <Card padding={spacing.md}>
      <View style={styles.row}>
        <Text style={styles.kicker}>Escaneos este mes</Text>
        <Text style={styles.detail}>
          {usage.used}/{state.effectiveLimit} usados
        </Text>
      </View>
      <View style={styles.remainingWrap}>
        <Text style={styles.remaining}>{`Quedan ${state.remaining}`}</Text>
      </View>
      <View style={styles.progressWrap}>
        <ProgressBar value={state.ratio} />
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
  upgradeCta: {
    marginTop: spacing.md,
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 12,
  },
  upgradeCtaText: {
    color: colors.onPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
});
