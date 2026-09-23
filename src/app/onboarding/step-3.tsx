import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/atoms/Icon';
import { InsightsHeroMockup } from '@/features/onboarding/components/InsightsHeroMockup';
import {
  OnboardingShell,
  PaginationDots,
  StepBadge,
} from '@/features/onboarding/components/OnboardingShell';
import {
  getStepIndex,
  isLastStep,
  TOTAL_STEPS,
} from '@/features/onboarding/onboarding-model';
import { markOnboardingCompleted } from '@/features/onboarding/onboarding-storage';
import { openLegalDocument } from '@/lib/legal-navigation';
import { colors, radii, spacing, typography } from '@/theme';

/**
 * Step 3 — the Insights screen. Terminal step: the CTA copy flips
 * from "Continuar" to "Empezar ahora" and tapping it (a) marks the
 * flag complete via `markOnboardingCompleted()` and (b) replaces to
 * /sign-up so the user can create their account.
 *
 * The legal footer renders the `legalPrefix` + `legalTermsLink` +
 * `legalPrivacyLink` triple, with both links routing via
 * `openLegalDocument` — the same `/legal/{terms,privacy}` routes the
 * paywall + sign-up screens already link to. No new legal routes are
 * created.
 */

export default function Step3Screen() {
  const { t } = useTranslation('onboarding');

  const handleEmpezar = async () => {
    // The wizard is complete — flag first (so the gate stays open on
    // subsequent launches), then nav to sign-up. The async/await keeps
    // the marker write strictly ordered: if it fails the helper
    // silently swallows and the navigation still happens.
    await markOnboardingCompleted();
    router.replace('/sign-up' as Parameters<typeof router.replace>[0]);
  };

  return (
    <OnboardingShell
      step="step-3"
      showSubHeader
      showSkip={false}
      bottomAction={
        <View style={styles.bottomWrap}>
          <Pressable
            onPress={handleEmpezar}
            accessibilityRole="button"
            accessibilityLabel={t('startNow')}
            style={({ pressed }) => [
              styles.primaryCta,
              pressed && styles.primaryCtaPressed,
            ]}
          >
            <Text style={styles.primaryCtaText}>{t('startNow')}</Text>
            <Icon name="bolt" size={20} color={colors.onPrimary} />
          </Pressable>
          {/* Legal footer — Al continuar aceptas nuestros Términos y Política… */}
          <View style={styles.legalFooter}>
            <Text style={styles.legalPrefix}>{t('legalPrefix')}</Text>
            <View style={styles.legalLinksRow}>
              <Pressable
                onPress={() => openLegalDocument('terms')}
                accessibilityRole="link"
              >
                <Text style={styles.legalLink}>{t('legalTermsLink')}</Text>
              </Pressable>
              <Text style={styles.legalConjunction}> & </Text>
              <Pressable
                onPress={() => openLegalDocument('privacy')}
                accessibilityRole="link"
              >
                <Text style={styles.legalLink}>{t('legalPrivacyLink')}</Text>
              </Pressable>
              <Text style={styles.legalConjunction}>.</Text>
            </View>
          </View>
        </View>
      }
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <InsightsHeroMockup />
        <View style={styles.copyBlock}>
          <StepBadge
            step={getStepIndex('step-3')}
            total={TOTAL_STEPS}
          />
          <Text style={styles.headline}>{t('step3.headline')}</Text>
          <Text style={styles.body}>{t('step3.body')}</Text>
        </View>
        <PaginationDots total={TOTAL_STEPS} active={2} />
      </ScrollView>
    </OnboardingShell>
  );
}

// Reference the model helper so it's clear this terminal screen is
// keyed off `isLastStep` — the harness still reads the literal
// in source-pin tests, but the import keeps the seam honest.
export const __terminalContract = isLastStep;

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    alignItems: 'stretch',
    gap: spacing.lg,
  },
  copyBlock: {
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
  legalFooter: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingTop: spacing.sm,
  },
  legalPrefix: {
    ...typography.labelSm,
    color: colors.textSecondary,
    fontSize: 11,
    textAlign: 'center',
  },
  legalLinksRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  legalConjunction: {
    ...typography.labelSm,
    color: colors.textSecondary,
    fontSize: 11,
  },
  legalLink: {
    ...typography.labelSm,
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});
