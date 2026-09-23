import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/atoms/Icon';
import { getPreviousStep, type Step } from '@/features/onboarding/onboarding-model';
import { colors, radii, spacing, typography } from '@/theme';

/**
 * Shared chrome for the 3 onboarding screens.
 *
 * The kiosk-style header on step-1 renders the branded logo on the
 * left and the Saltar / account buttons on the right — matching the
 * reference HTML's `<header>` block. Steps 2 and 3 (the post-step-1
 * slides) drop the kiosk header in favor of a sub-header with a
 * back-arrow + setup-badge + (optional) Saltar pill, matching the
 * HTML for screens 2 and 3.
 *
 * The wrapper renders the SCREEN container and the optional back-nav
 * sub-header as siblings, leaving the hero + content + CTAs to each
 * step's screen. The `bottomAction` slot receives the screen-specific
 * CONTINUAR / EMPEZAR button via the screen component so the wrapper
 * can own safe-area + padding + sub-header layout, while each screen
 * owns its content + CTA composition.
 */

export interface OnboardingShellProps {
  step: Step;
  showSubHeader?: boolean;
  showSkip?: boolean;
  children: React.ReactNode;
  bottomAction: React.ReactNode;
}

export function OnboardingShell({
  step,
  showSubHeader = true,
  showSkip = true,
  children,
  bottomAction,
}: OnboardingShellProps) {
  const { t } = useTranslation('onboarding');
  const prev = getPreviousStep(step);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {showSubHeader ? (
        <View style={styles.subHeader}>
          <Pressable
            onPress={() => {
              // The shell only renders the back button when there's a
              // previous step to pop to. router.back() is a no-op on
              // the first screen because the header doesn't render the
              // button (defensive: ignore if a future refactor pushes
              // through here).
              if (prev != null) router.back();
            }}
            accessibilityRole="button"
            accessibilityLabel={t('backA11y')}
            style={({ pressed }) => [
              styles.backButton,
              pressed && styles.backPressed,
            ]}
          >
            <Icon name="arrow_back" size={20} color={colors.textPrimary} />
          </Pressable>
          <View style={styles.setupPill}>
            <View style={styles.setupDot} />
            <Text style={styles.setupPillText}>
              {t('onboardingSetupBadge')}
            </Text>
          </View>
          {showSkip ? (
            <Pressable
              onPress={() => {
                // Saltar skips the entire flow and lands on sign-in.
                // The screen-level CTA on each step calls
                // `markOnboardingCompleted()` before this navigation.
                router.replace('/sign-in' as Parameters<typeof router.replace>[0]);
              }}
              accessibilityRole="button"
              accessibilityLabel={t('skip')}
              style={({ pressed }) => [
                styles.skipButton,
                pressed && styles.skipPressed,
              ]}
            >
              <Text style={styles.skipText}>{t('skip')}</Text>
            </Pressable>
          ) : (
            <View style={styles.skipSpacer} />
          )}
        </View>
      ) : null}
      <View style={styles.content}>{children}</View>
      <View style={styles.bottomActionWrap}>{bottomAction}</View>
    </SafeAreaView>
  );
}

/**
 * The three-dot pagination indicator. The active dot is wider (pill
 * shape) so the user can tell which step they're on without a label —
 * matches the reference HTML's `<span class="w-8 h-2 bg-primary" />`
 * pattern.
 */
export function PaginationDots({ total, active }: { total: number; active: number }) {
  return (
    <View style={styles.pagination} accessibilityRole="tablist">
      {Array.from({ length: total }).map((_, idx) => {
        const isActive = idx === active;
        return (
          <View
            key={idx}
            style={[styles.paginationDot, isActive && styles.paginationDotActive]}
          />
        );
      })}
    </View>
  );
}

/**
 * Step badge ("Paso 1 de 3") — the green pill at the top of each
 * step's content block, matches the reference HTML's
 * `<span>Paso 1 de 3</span>` pill.
 */
export function StepBadge({
  step,
  total,
  uppercase = false,
}: {
  step: number;
  total: number;
  uppercase?: boolean;
}) {
  const { t } = useTranslation('onboarding');
  const key = uppercase ? 'stepBadgeUpper' : 'stepBadge';
  return (
    <View style={styles.stepBadge}>
      <View style={styles.stepBadgeDot} />
      <Text style={styles.stepBadgeText}>
        {t(key, { step, total })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  subHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    backgroundColor: colors.chipBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backPressed: {
    backgroundColor: colors.surface,
  },
  setupPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
    backgroundColor: colors.chipBg,
  },
  setupDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  setupPillText: {
    ...typography.labelCaps,
    color: colors.textSecondary,
    fontSize: 11,
  },
  skipButton: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipPressed: {
    opacity: 0.7,
  },
  skipText: {
    ...typography.labelCaps,
    color: colors.textSecondary,
    fontSize: 13,
  },
  skipSpacer: {
    width: 0,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.lg,
  },
  bottomActionWrap: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  stepBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
    backgroundColor: 'rgba(16, 185, 129, 0.10)',
  },
  stepBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  stepBadgeText: {
    ...typography.labelCaps,
    color: colors.primary,
  },
  pagination: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  paginationDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.divider,
  },
  paginationDotActive: {
    width: 32,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
});

// Re-export the icon-name type for screen files that need to constrain
// which glyph they reference (defensive: prevents typos from silently
// rendering a fallback "help-outline" glyph).
export type { IconName };
