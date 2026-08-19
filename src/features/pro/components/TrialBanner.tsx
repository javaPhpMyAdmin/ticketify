/**
 * Trial countdown banner (subscription-trial spec — REQ-STATUS-1).
 *
 * A compact, non-blocking bar shown when the user is mid-trial.
 * Displays "Prueba PRO: X días restantes" and taps through to /pro.
 * Only renders when `isTrialing === true` — otherwise returns null.
 */
import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import { Pressable, Text, View } from '@/components';
import { useProEntitlement } from '@/features/pro';
import { colors, radii, spacing, typography } from '@/theme';

export function TrialBanner() {
  const { isTrialing, daysRemaining } = useProEntitlement();

  if (!isTrialing) return null;

  const label =
    daysRemaining === 1
      ? 'Prueba PRO: 1 día restante'
      : `Prueba PRO: ${daysRemaining} días restantes`;

  return (
    <Pressable
      onPress={() => router.push('/pro')}
      accessibilityRole="button"
      accessibilityLabel="Ver planes de suscripción"
      style={({ pressed }) => [styles.banner, pressed && styles.bannerPressed]}
    >
      <View style={styles.content}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.hint}>Ver planes</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.primaryContainer,
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
    color: colors.primaryDark,
    flex: 1,
  },
  hint: {
    ...typography.labelSm,
    color: colors.primary,
    fontWeight: '700',
  },
});
