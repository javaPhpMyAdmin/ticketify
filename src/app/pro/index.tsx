/**
 * Pro paywall screen (pro-subscription spec — REQ-PRO-2..5).
 *
 * Reachable from any Pro-locked affordance (the `ProLock` CTA, the
 * profile's export row when free, the charts entry card when free).
 * Session-gated only (free users MUST be able to reach it), so it sits
 * inside the same `Stack.Protected` as the rest of the signed-in app.
 *
 * State machine:
 *
 *   - `loading` — initial fetch of offerings in flight.
 *   - `ready` — offerings available; user can tap "Suscribirse".
 *   - `purchasing` — a purchase / restore is in flight.
 *   - `error` — offerings or purchase failed; user can retry.
 *
 * On a successful purchase the screen calls `useProEntitlement().refresh()`
 * so the gate flips to `'unlocked'` and any screen behind a
 * `ProRouteGuard` re-renders its children in place.
 *
 * Intro caption (REQ-PRO-INTRO-CAPTION, slice C):
 * When a package has an intro offer configured (Play Console / App Store
 * Connect native intro offer), `PlanButton` renders a caption line above
 * the price reading "{{trialDays}} días gratis, después $X.XX/mes"
 * (locale-aware copy). The caption is hidden when no intro offer is
 * configured. Android returns `UNKNOWN` for intro eligibility (the SDK
 * can't tell on Android), so the simpler implementation is to show
 * the caption whenever `introPhase !== null` and let Play re-state
 * the terms at checkout time.
 *
 * Post-cutover (0039): trial CTA + billing note + frozen card + trial
 * countdown are all gone — the trial lifecycle moved to Play Console /
 * App Store Connect native intro offers + the RevenueCat webhook.
 */
import { Stack, router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  Card,
  Divider,
  Icon,
  Pressable,
  Spinner,
  Text,
  View,
} from '@/components';
import { useProEntitlement } from '@/features/pro';
import {
  isPlanBusy,
  planCaptionColor,
  type PlanKey,
  type PaywallState,
} from '@/features/pro/paywall-model';
import { syncSubscriptionStatus } from '@/lib/supabase/feature-access';
import {
  buildIntroCaption,
  getOfferings,
  isNativeAvailable,
  purchasePackage,
  restorePurchases,
  type OfferingsSnapshot,
} from '@/lib/revenuecat';
import { colors, radii, spacing, typography } from '@/theme';

export default function PaywallScreen() {
  const { refresh } = useProEntitlement();
  const { t } = useTranslation('pro');
  const [state, setState] = useState<PaywallState>('loading');
  const [offerings, setOfferings] = useState<OfferingsSnapshot | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  // Which plan's purchase is in flight. Per-plan busy (NOT the shared
  // `state === 'purchasing'` flag) so a monthly tap does NOT spin the
  // annual button (the regression: white spinner on the emerald button).
  const [purchasingPlan, setPurchasingPlan] = useState<PlanKey | null>(null);

  const loadOfferings = useCallback(async () => {
    setState('loading');
    setErrorMessage(null);
    if (!isNativeAvailable()) {
      setErrorMessage(t('errorNotAvailable'));
      setState('error');
      return;
    }
    const next = await getOfferings();
    if (!next) {
      setErrorMessage(t('errorGeneric'));
      setState('error');
      return;
    }
    setOfferings(next);
    setState('ready');
  }, [t]);

  useEffect(() => {
    void loadOfferings();
  }, [loadOfferings]);

  const handlePurchase = async (plan: PlanKey) => {
    if (state === 'purchasing') return;
    // Resolve the SDK identifier from the loaded offerings; the buttons
    // only render when the offering exists, so this is the same
    // non-null contract as the old `offerings.monthly!.identifier`.
    const identifier =
      plan === 'monthly'
        ? offerings?.monthly?.identifier
        : offerings?.annual?.identifier;
    if (!identifier) {
      setErrorMessage(t('errorGeneric'));
      setState('error');
      return;
    }
    setPurchasingPlan(plan);
    setState('purchasing');
    setErrorMessage(null);
    const result = await purchasePackage(identifier);
    if (!result.ok) {
      setErrorMessage(result.error ?? t('errorPurchaseFailed'));
      setState('error');
      return;
    }
    // Optimistically sync subscription_status to the DB before the
    // RevenueCat webhook arrives. Non-blocking: if this fails, the
    // webhook will reconcile the state.
    if (result.isPro) {
      void syncSubscriptionStatus('active');
    }
    await refresh();
    if (result.isPro) {
      router.back();
    } else {
      setErrorMessage(t('errorSyncDelayed'));
      setState('error');
    }
  };

  const handleRestore = async () => {
    if (restoring || state === 'purchasing') return;
    setRestoring(true);
    setErrorMessage(null);
    const result = await restorePurchases();
    setRestoring(false);
    if (!result.ok) {
      setErrorMessage(result.error ?? t('errorRestoreFailed'));
      setState('error');
      return;
    }
    // Optimistically sync subscription_status to the DB after restore.
    // Non-blocking: the webhook will reconcile if this fails.
    if (result.isPro) {
      void syncSubscriptionStatus('active');
    }
    await refresh();
    if (result.isPro) {
      router.back();
    } else {
      setErrorMessage(t('errorRestoreNone'));
      setState('error');
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <Stack.Screen options={{ title: t('paywallTitle'), headerShown: true }} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('paywallHeaderTitle')}</Text>
          <Text style={styles.subtitle}>{t('paywallHeaderSubtitle')}</Text>
        </View>

        <Card style={styles.benefitsCard}>
          <Benefit
            icon="qr-code-scanner"
            label={t('benefitUnlimitedScans')}
          />
          <Divider />
          <Benefit
            icon="chart.bar.fill"
            label={t('benefitAdvancedStats')}
          />
          <Divider />
          <Benefit
            icon="square.and.arrow.up"
            label={t('benefitExportTickets')}
          />
          <Divider />
          <Benefit
            icon="bolt.fill"
            label={t('benefitPriceAlerts')}
          />
        </Card>

        {state === 'loading' ? (
          <View style={styles.loadingRow}>
            <Spinner size="sm" color={colors.primary} />
            <Text style={styles.loadingText}>{t('loadingPlans')}</Text>
          </View>
        ) : null}

        {state !== 'loading' && offerings ? (
          <View style={styles.plans}>
            {offerings.monthly ? (
              <PlanButton
                label={t('planMonthly')}
                introPhase={offerings.monthly.introPhase}
                onPress={() => handlePurchase('monthly')}
                busy={isPlanBusy('monthly', purchasingPlan, state)}
              />
            ) : null}
            {offerings.annual ? (
              <PlanButton
                label={t('planAnnual')}
                emphasis
                introPhase={offerings.annual.introPhase}
                onPress={() => handlePurchase('annual')}
                busy={isPlanBusy('annual', purchasingPlan, state)}
              />
            ) : null}
            {!offerings.monthly && !offerings.annual ? (
              <Text style={styles.emptyPlans}>
                {t('noPlansAvailable')}
              </Text>
            ) : null}
          </View>
        ) : null}

        {state === 'error' && errorMessage ? (
          <View style={styles.errorRow}>
            <Icon
              name="exclamationmark.triangle.fill"
              size={18}
              color={colors.danger}
            />
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

        <Pressable
          onPress={handleRestore}
          disabled={restoring || state === 'purchasing'}
          accessibilityRole="button"
          accessibilityLabel={t('restorePurchases')}
          style={({ pressed }) => [
            styles.restoreButton,
            pressed && styles.restorePressed,
          ]}
        >
          {restoring ? (
            <Spinner size="sm" color={colors.primary} />
          ) : (
            <Text style={styles.restoreText}>{t('restorePurchases')}</Text>
          )}
        </Pressable>

        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t('cancelBack')}
          style={({ pressed }) => [
            styles.cancelButton,
            pressed && styles.cancelPressed,
          ]}
        >
          <Text style={styles.cancelText}>{t('cancelBack')}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

interface BenefitProps {
  icon: Parameters<typeof Icon>[0]['name'];
  label: string;
}

function Benefit({ icon, label }: BenefitProps) {
  return (
    <View style={styles.benefitRow}>
      <Icon name={icon} size={20} color={colors.primary} />
      <Text style={styles.benefitLabel}>{label}</Text>
    </View>
  );
}

interface PlanButtonProps {
  label: string;
  emphasis?: boolean;
  /**
   * Intro-offer projection from `getOfferings()` (slice B). When set,
   * the caption "{{trialDays}} días gratis, después $X.XX/mes" renders
   * above the price (REQ-PRO-INTRO-CAPTION). When null, no caption
   * renders (no intro offer configured for this package).
   */
  introPhase: { priceAfterTrial: string; trialDays: number; cycles: number } | null;
  onPress: () => void;
  busy: boolean;
}

function PlanButton({
  label,
  emphasis,
  introPhase,
  onPress,
  busy,
}: PlanButtonProps) {
  const { t } = useTranslation('pro');
  // Compute the intro caption via the pure substitution helper (slice C).
  // The template is fetched once via i18n so each locale renders the
  // appropriate copy. The helper itself does no formatting — trialDays
  // is rendered as-is (integer) and priceAfterTrial as already-
  // formatted by the SDK (e.g. "$5.99", "ARS 1.499,00").
  const caption =
    introPhase !== null
      ? buildIntroCaption(introPhase, t('planIntroCaption'))
      : null;

  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={
        caption !== null
          ? `${t('subscribeAction')} · ${label} · ${caption}`
          : `${t('subscribeAction')} · ${label}`
      }
      style={({ pressed }) => [
        styles.planButton,
        emphasis && styles.planButtonEmphasis,
        pressed && styles.planButtonPressed,
        busy && styles.planButtonBusy,
      ]}
    >
      {busy ? (
        <Spinner size="sm" color={emphasis ? colors.onPrimary : colors.primary} />
      ) : (
        <View style={styles.planButtonContent}>
          {/* Intro caption renders ABOVE the price — the visual hierarchy
              matches the consumer's intent: "free first, then $X.XX". */}
          {caption !== null ? (
            <Text
              style={[
                styles.planButtonCaption,
                // Per-emphasis caption color (same single-source contract
                // as the Spinner above): the emphasis (emerald) button
                // reads its caption in `onPrimary` (white); the plain
                // button keeps `primary`.
                { color: planCaptionColor(!!emphasis) },
              ]}
            >
              {caption}
            </Text>
          ) : null}
          <Text
            style={[
              styles.planButtonText,
              emphasis && styles.planButtonTextEmphasis,
            ]}
          >
            {t('subscribeAction')} · {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  header: {
    gap: spacing.sm,
  },
  title: {
    ...typography.headlineLg,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.bodyMd,
    color: colors.textSecondary,
  },
  benefitsCard: {
    paddingVertical: spacing.xs,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  benefitLabel: {
    ...typography.bodyLg,
    color: colors.textPrimary,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  loadingText: {
    ...typography.bodyMd,
    color: colors.textSecondary,
  },
  plans: {
    gap: spacing.md,
  },
  planButton: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radii.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planButtonEmphasis: {
    backgroundColor: colors.primary,
  },
  planButtonPressed: {
    opacity: 0.85,
  },
  planButtonBusy: {
    opacity: 0.7,
  },
  planButtonContent: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  // Caption sits visually above the price line. Smaller font so it reads
  // as a hint, not a competing CTA. The COLOR is deliberately NOT set
  // here — it comes from `planCaptionColor(emphasis)` at the call site
  // (the pure model owns the per-emphasis contrast: white on the emerald
  // button, primary on the plain one).
  planButtonCaption: {
    ...typography.labelSm,
    fontWeight: '600',
  },
  planButtonText: {
    ...typography.bodyLg,
    color: colors.primary,
    fontWeight: '700',
  },
  planButtonTextEmphasis: {
    color: colors.onPrimary,
  },
  emptyPlans: {
    ...typography.bodyMd,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  errorText: {
    ...typography.bodyMd,
    color: colors.danger,
    flex: 1,
  },
  restoreButton: {
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  restorePressed: {
    opacity: 0.7,
  },
  restoreText: {
    ...typography.bodyMd,
    color: colors.primary,
    fontWeight: '700',
  },
  cancelButton: {
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelPressed: {
    opacity: 0.7,
  },
  cancelText: {
    ...typography.bodyMd,
    color: colors.textSecondary,
  },
});
