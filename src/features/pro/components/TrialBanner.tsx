/**
 * Trial countdown banner (subscription-trial spec — REQ-STATUS-1).
 *
 * A compact, non-blocking bar shown when the user is mid-trial.
 * Displays "Prueba PRO: X días restantes" and taps through to /pro.
 * Only renders when `isTrialing === true` — otherwise returns null.
 */
import { router } from 'expo-router';
import { StyleSheet, View as RNView } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Pressable, Text } from '@/components';
import { useProEntitlement } from '@/features/pro/hooks/useProEntitlement';
import { colors, radii, spacing, typography } from '@/theme';

export function TrialBanner() {
  const { isTrialing, daysRemaining } = useProEntitlement();
  // The countdown reads its pluralized copy from the `pro` namespace;
  // the "see plans" hint reuses the existing `settings:seePlans` key.
  const { t } = useTranslation(['pro', 'settings']);

  if (!isTrialing) return null;

  const label = t('trialBannerDays', { count: daysRemaining });

  return (
    <Pressable
      onPress={() => router.push('/pro')}
      accessibilityRole="button"
      accessibilityLabel="Ver planes de suscripción"
      style={({ pressed }) => [styles.banner, pressed && styles.bannerPressed]}
    >
      <RNView style={styles.content}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.hint}>{t('settings:seePlans')}</Text>
      </RNView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  bannerPressed: {
    opacity: 0.85,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    ...typography.bodyMd,
    fontWeight: '600',
    color: colors.onPrimary,
    flex: 1,
  },
  hint: {
    ...typography.labelSm,
    color: colors.onPrimary,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
});
