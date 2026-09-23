import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/atoms/Icon';
import { BudgetHeroMockup } from '@/features/onboarding/components/BudgetHeroMockup';
import {
  OnboardingShell,
  PaginationDots,
  StepBadge,
} from '@/features/onboarding/components/OnboardingShell';
import {
  getStepIndex,
  TOTAL_STEPS,
} from '@/features/onboarding/onboarding-model';
import { markOnboardingCompleted } from '@/features/onboarding/onboarding-storage';
import { colors, radii, spacing, typography } from '@/theme';

/**
 * Step 2 — the Budget screen. Renders the sub-header (back arrow +
 * setup pill + Saltar) and the budget card mockup + copy block.
 *
 * Wire-up:
 *
 *   - The sub-header's back button → router.back() to step-1.
 *   - SALTAR → mark complete + replace to /sign-in.
 *   - CONTINUAR → push to step-3.
 *
 * The legal footer links (Términos / Privacy Policy) reuse the shared
 * `openLegalDocument` seam — the same one the paywall + sign-up +
 * consent-gate flows use, so the routes + a11y labels stay consistent.
 */

export default function Step2Screen() {
  const { t } = useTranslation('onboarding');

  const handleSkipToSignIn = async () => {
    await markOnboardingCompleted();
    router.replace('/sign-in' as Parameters<typeof router.replace>[0]);
  };

  return (
    <OnboardingShell
      step="step-2"
      showSubHeader
      showSkip
      bottomAction={
        <View style={styles.bottomWrap}>
          <Pressable
            onPress={() => router.push('/onboarding/step-3' as Parameters<typeof router.push>[0])}
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
            onPress={handleSkipToSignIn}
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
        <BudgetHeroMockup />
        <View style={styles.copyBlock}>
          <StepBadge
            step={getStepIndex('step-2')}
            total={TOTAL_STEPS}
            uppercase
          />
          <Text style={styles.headline}>{t('step2.headline')}</Text>
          <Text style={styles.body}>{t('step2.body')}</Text>
        </View>
        <PaginationDots total={TOTAL_STEPS} active={1} />
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
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  headline: {
    ...typography.headlineLgMobile,
    color: colors.textPrimary,
  },
  body: {
    ...typography.bodyMd,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  bottomWrap: {
    gap: spacing.sm,
  },
  primaryCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 52,
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
    textDecorationLine: 'underline',
    textDecorationColor: 'rgba(16, 185, 129, 0.40)',
  },
});
