import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/atoms/Icon';
import {
  OnboardingShell,
  PaginationDots,
  StepBadge,
} from '@/features/onboarding/components/OnboardingShell';
import { ScannerHeroMockup } from '@/features/onboarding/components/ScannerHeroMockup';
import { TOTAL_STEPS } from '@/features/onboarding/onboarding-model';
import { markOnboardingCompleted } from '@/features/onboarding/onboarding-storage';
import { colors, radii, spacing, typography } from '@/theme';

/**
 * Step 1 — the AI Scanner screen. The flow entry point, no back-arrow
 * on the sub-header, no sub-header at all (matches the reference
 * HTML which only renders the kiosk top chrome on step 1 and the
 * sub-header on steps 2-3).
 *
 * Wire-up:
 *
 *   - `Continuar` → push to step-2 (inter-step nav keeps the back arrow
 *     working on subsequent steps).
 *   - SALTAR (in the kiosk header) → mark complete + replace to
 *     /sign-in.
 *   - "¿Ya tienes una cuenta? Iniciar sesión" → replace to /sign-in.
 */

export default function Step1Screen() {
  const { t } = useTranslation('onboarding');

  // The secondary "¿Ya tenés una cuenta? Iniciar sesión" link routes
  // to sign-in AND marks the wizard complete. Without the mark the
  // gate would re-route the user back into onboarding on the next
  // launch (an annoying infinite-loop for users who explicitly opt
  // to skip). The flag write is fire-and-forget so the navigation
  // happens immediately.
  const handleSignIn = () => {
    void markOnboardingCompleted();
    router.replace('/sign-in' as Parameters<typeof router.replace>[0]);
  };

  return (
    <OnboardingShell
      step="step-1"
      showSubHeader={false}
      showSkip={false}
      bottomAction={
        <View style={styles.bottomWrap}>
          <Pressable
            onPress={() => router.push('/onboarding/step-2' as Parameters<typeof router.push>[0])}
            accessibilityRole="button"
            accessibilityLabel={t('continue')}
            style={({ pressed }) => [
              styles.primaryCta,
              pressed && styles.primaryCtaPressed,
            ]}
          >
            <Text style={styles.primaryCtaText}>{t('continue')}</Text>
            <Icon name="arrow_forward" size={20} color={colors.onPrimary} />
          </Pressable>
          <Pressable
            onPress={handleSignIn}
            accessibilityRole="link"
            style={({ pressed }) => [styles.secondaryLink, pressed && styles.secondaryLinkPressed]}
          >
            <Text style={styles.secondaryLinkText}>
              {t('hasAccountPrompt') + ' '}
              <Text style={styles.secondaryLinkAccent}>{t('signInLink')}</Text>
            </Text>
          </Pressable>
        </View>
      }
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <ScannerHeroMockup />
        <View style={styles.copyBlock}>
          <StepBadge step={1} total={TOTAL_STEPS} uppercase />
          <Text style={styles.headline}>{t('step1.headline')}</Text>
          <Text style={styles.body}>{t('step1.body')}</Text>
        </View>
        <PaginationDots total={TOTAL_STEPS} active={0} />
      </ScrollView>
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    alignItems: 'stretch',
    gap: spacing.lg,
  },
  copyBlock: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  headline: {
    ...typography.headlineLgMobile,
    color: colors.textPrimary,
    textAlign: 'center',
    paddingHorizontal: spacing.xs,
  },
  body: {
    ...typography.bodyMd,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: spacing.sm,
  },
  bottomWrap: {
    gap: spacing.sm,
  },
  primaryCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 56,
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
  },
  primaryCtaPressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.95,
  },
  primaryCtaText: {
    ...typography.headlineMd,
    color: colors.onPrimary,
    fontSize: 15,
  },
  secondaryLink: {
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  secondaryLinkPressed: {
    opacity: 0.7,
  },
  secondaryLinkText: {
    ...typography.labelSm,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  secondaryLinkAccent: {
    color: colors.primary,
    fontWeight: '700',
  },
});
