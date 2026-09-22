/**
 * Pro paywall screen (pro-subscription spec — REQ-PRO-2..5) — Kinetic Finance rewrite.
 *
 * Reachable from any Pro-locked affordance (the `ProLock` CTA, the
 * profile's export row when free, the charts entry card when free).
 * Session-gated only (free users MUST be able to reach it), so it sits
 * inside the same `Stack.Protected` as the rest of the signed-in app.
 *
 * Layout (top → bottom):
 *
 *   1. Native Stack header — `paywallProTitle` (the localized "PRO
 *      Subscription" label) on the left, an account icon and a close
 *      icon rendered via `headerRight`.
 *   2. Hero block — PRO eyebrow pill + H1 headline + subtitle + a
 *      decorative 3-card mockup illustration (AI SYNC / verified / +28%).
 *   3. Features list — 5 rows, each on a card surface with a rounded
 *      icon container + title + description.
 *   4. Plan selector — two tappable cards (annual selected by default,
 *      monthly as the alternate). Tapping flips the selection AND the
 *      CTA copy (see `getCtaCopy` in `paywall-model.ts`).
 *   5. Primary CTA — `primary` background, full width, `arrow_forward`,
 *      copy resolved by `getCtaCopy(selectedPlan, annualTrialDays)`.
 *   6. Secondary text button — `cancelOrFreeTier`, routes back / dismiss.
 *   7. Trust strip — 3 microcopy items with icons, separated by dots.
 *   8. Legal footer — `autoRenewalNotice` + `legalPrefix` +
 *      `termsAndConditionsLink` + `privacyPolicyLink`, the same links
 *      used elsewhere in the app (`openLegalDocument`).
 *
 * State machine (preserved from the pre-rewrite contract):
 *
 *   - `loading` — initial fetch of offerings in flight.
 *   - `ready` — offerings available; user can tap a plan.
 *   - `purchasing` — a purchase / restore is in flight (per-plan busy).
 *   - `error` — offerings or purchase failed; user can retry.
 *
 * Per-plan busy model: `isPlanBusy(plan, purchasingPlan, state)` from
 * `paywall-model.ts` keeps the spinner localized to the tapped plan
 * (the regression where one busy flag spun both buttons is fixed at the
 * model — see `scripts/test-paywall-model.mjs`).
 *
 * CTA copy model: `getCtaCopy(selectedPlan, annualTrialDays)` from the
 * same model returns a `{ key, values? }` shape the screen renders via
 * `t(cta.key, cta.values)`. Source-pin test enforces the wiring so a
 * future inline-branch refactor fails loudly.
 *
 * The plan-card caption color (annual's emphasis card) uses
 * `planCaptionColor(true)` — white on emerald — so the "14 DÍAS GRATIS"
 * chip stays legible on the primary background.
 */
import { Stack, router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  Icon,
  IconButton,
  Spinner,
  Text,
} from '@/components';
import { useProEntitlement } from '@/features/pro';
import {
  getCtaCopy,
  isPlanBusy,
  planCaptionColor,
  type PlanKey,
  type PaywallState,
} from '@/features/pro/paywall-model';
import { openLegalDocument } from '@/lib/legal-navigation';
import { syncSubscriptionStatus } from '@/lib/supabase/feature-access';
import {
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
  // User-selected plan. Annual is the default (matches the reference
  // design + the screen's "Best value" framing for the annual card).
  const [selectedPlan, setSelectedPlan] = useState<PlanKey>('annual');

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

  const handleCancel = () => {
    // The secondary action — same `router.back()` shape as the pre-
    // rewrite screen, so any deep-link entry that bypasses the native
    // header's back button still gets a safe exit. (The native header's
    // back gesture is wired by Expo Router and does NOT call this.)
    router.back();
  };

  const headerTitle = t('paywallProTitle');

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: headerTitle,
          headerShown: true,
          headerRight: () => (
            <View style={styles.headerRight}>
              <IconButton
                icon="person.fill"
                onPress={() => router.push('/(tabs)/profile' as never)}
                accessibilityLabel={t('accountA11y')}
                iconSize={18}
              />
              <IconButton
                icon="xmark"
                onPress={() => router.back()}
                accessibilityLabel={t('closePaywallA11y')}
                iconSize={18}
              />
            </View>
          ),
        }}
      />
      <ScrollView contentContainerStyle={styles.content}>
        <Hero />
        <FeaturesList />

        {state === 'loading' ? (
          <View style={styles.loadingRow}>
            <Spinner size="sm" color={colors.primary} />
            <Text style={styles.loadingText}>{t('loadingPlans')}</Text>
          </View>
        ) : null}

        {state !== 'loading' && offerings ? (
          <PlanSelector
            offerings={offerings}
            selected={selectedPlan}
            purchasingPlan={purchasingPlan}
            paywallState={state}
            onSelect={setSelectedPlan}
            onPurchase={handlePurchase}
          />
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

        <PrimaryCta
          offerings={offerings}
          selectedPlan={selectedPlan}
          purchasingPlan={purchasingPlan}
          paywallState={state}
          onPress={handlePurchase}
          onRestore={handleRestore}
          restoring={restoring}
        />

        <Pressable
          onPress={handleCancel}
          accessibilityRole="button"
          accessibilityLabel={t('cancelOrFreeTier')}
          style={({ pressed }) => [
            styles.cancelButton,
            pressed && styles.cancelPressed,
          ]}
        >
          <Text style={styles.cancelText}>{t('cancelOrFreeTier')}</Text>
        </Pressable>

        <TrustStrip />
        <LegalFooter />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Hero block — eyebrow pill + H1 + subtitle + decorative mockup.
// The mockup is intentionally illustrative; its values are decorative
// (TICKETIFY PRO / "$128.40" / "+28%") and never enter the user data
// flow. All copy comes from the i18n catalog so a locale switch rerenders
// the eyebrow, headline, subtitle, and micro-labels atomically.
// ─────────────────────────────────────────────────────────────────────────

function Hero() {
  const { t } = useTranslation('pro');
  return (
    <View style={styles.hero}>
      <View style={styles.heroEyebrow}>
        <Icon name="sparkles" size={14} color={colors.primary} />
        <Text style={styles.heroEyebrowText}>{t('heroEyebrow')}</Text>
      </View>
      <Text style={styles.heroHeadline}>{t('heroHeadline')}</Text>
      <Text style={styles.heroSubtitle}>{t('heroSubtitle')}</Text>
      <HeroMockup />
    </View>
  );
}

function HeroMockup() {
  const { t } = useTranslation('pro');
  return (
    <View style={styles.heroMockupWrap}>
      <View style={styles.heroMockupGlow} />
      <View style={styles.heroMockup}>
        <View style={styles.heroMockupCardLeft}>
          <View style={styles.heroMockupCardLeftRow}>
            <Icon name="receipt" size={14} color={colors.primary} />
            <Text style={styles.heroMockupCardEyebrow}>
              {t('heroMockAiSync')}
            </Text>
          </View>
          <View style={styles.heroMockupBarLong} />
          <View style={styles.heroMockupBarShort} />
          <View style={styles.heroMockupTotalRow}>
            <Text style={styles.heroMockupTotalLabel}>
              {t('heroMockTotalLabel')}
            </Text>
            <Text style={styles.heroMockupTotalValue}>
              {t('heroMockTotalValue')}
            </Text>
          </View>
        </View>
        <View style={styles.heroMockupCenter}>
          <View style={styles.heroMockupCenterBadge}>
            <Icon
              name="checkmark.seal.fill"
              size={20}
              color={colors.onPrimary}
            />
          </View>
          <View style={styles.heroMockupCenterCaption}>
            <View style={styles.heroMockupDot} />
            <Text style={styles.heroMockupCenterCaptionText}>
              {t('heroMockUnlimited')}
            </Text>
          </View>
        </View>
        <View style={styles.heroMockupCardRight}>
          <View style={styles.heroMockupCardRightRow}>
            <Icon
              name="chart.line.uptrend.xyaxis"
              size={14}
              color={colors.primary}
            />
            <Text style={styles.heroMockupCardRightValue}>
              {t('heroMockSavingValue')}
            </Text>
          </View>
          <Text style={styles.heroMockupCardRightLabel}>
            {t('heroMockSavingLabel')}
          </Text>
          <HeroMiniChart />
        </View>
      </View>
    </View>
  );
}

/**
 * Tiny line chart glyph used in the hero mockup. Pure presentational
 * Views (no SVG dependency) — three angled segments read as a spark
 * line at small sizes. Values are decorative.
 */
function HeroMiniChart() {
  return (
    <View style={styles.heroMiniChart}>
      <View style={[styles.heroMiniChartBar, { height: 4 }]} />
      <View style={[styles.heroMiniChartBar, { height: 8 }]} />
      <View style={[styles.heroMiniChartBar, { height: 6 }]} />
      <View style={[styles.heroMiniChartBar, { height: 10 }]} />
      <View style={[styles.heroMiniChartBar, { height: 12 }]} />
      <View style={[styles.heroMiniChartBar, { height: 9 }]} />
      <View style={[styles.heroMiniChartBar, { height: 14 }]} />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Features list — 5 rows of (rounded icon container + title + description).
// Title keys (`benefitXxx`) already exist from slice C; description
// siblings (`benefitXxxDescription`) were added in the rewrite. The
// row order below mirrors the reference design exactly (top → bottom:
// scan, stats, export, alerts, household).
// ─────────────────────────────────────────────────────────────────────────

const FEATURE_ROWS: readonly {
  icon: Parameters<typeof Icon>[0]['name'];
  titleKey:
    | 'benefitUnlimitedScans'
    | 'benefitAdvancedStats'
    | 'benefitExportTickets'
    | 'benefitPriceAlerts'
    | 'benefitHousehold5';
  descriptionKey:
    | 'benefitUnlimitedScansDescription'
    | 'benefitAdvancedStatsDescription'
    | 'benefitExportTicketsDescription'
    | 'benefitPriceAlertsDescription'
    | 'benefitHousehold5Description';
}[] = [
  {
    icon: 'doc.viewfinder',
    titleKey: 'benefitUnlimitedScans',
    descriptionKey: 'benefitUnlimitedScansDescription',
  },
  {
    icon: 'chart.bar.xaxis',
    titleKey: 'benefitAdvancedStats',
    descriptionKey: 'benefitAdvancedStatsDescription',
  },
  {
    icon: 'arrow.down.circle',
    titleKey: 'benefitExportTickets',
    descriptionKey: 'benefitExportTicketsDescription',
  },
  {
    icon: 'bell.badge.fill',
    titleKey: 'benefitPriceAlerts',
    descriptionKey: 'benefitPriceAlertsDescription',
  },
  {
    icon: 'person.3.fill',
    titleKey: 'benefitHousehold5',
    descriptionKey: 'benefitHousehold5Description',
  },
];

function FeaturesList() {
  const { t } = useTranslation('pro');
  return (
    <View style={styles.features}>
      {FEATURE_ROWS.map((row) => (
        <FeatureRow
          key={row.titleKey}
          icon={row.icon}
          title={t(row.titleKey)}
          description={t(row.descriptionKey)}
        />
      ))}
    </View>
  );
}

interface FeatureRowProps {
  icon: Parameters<typeof Icon>[0]['name'];
  title: string;
  description: string;
}

function FeatureRow({ icon, title, description }: FeatureRowProps) {
  return (
    <View style={styles.featureRow}>
      <View style={styles.featureIconContainer}>
        <Icon name={icon} size={16} color={colors.primary} />
      </View>
      <View style={styles.featureText}>
        <Text style={styles.featureTitle}>{title}</Text>
        <Text style={styles.featureDescription}>{description}</Text>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Plan selector — 2 cards (annual + monthly). Tapping either card sets
// the screen-level `selectedPlan`, which drives the CTA copy (via
// `getCtaCopy`) and the per-card "selected" indicator. The annual card
// carries the savings badge + the trial chip + the green equivalent-
// monthly subline; the monthly card carries a smaller trial chip + a
// cancellation reassurance line. Both fall back to the same render
// shape when the offering is missing (e.g. before the SDK finishes).
// ─────────────────────────────────────────────────────────────────────────

interface PlanSelectorProps {
  offerings: OfferingsSnapshot;
  selected: PlanKey;
  purchasingPlan: PlanKey | null;
  paywallState: PaywallState;
  onSelect: (plan: PlanKey) => void;
  onPurchase: (plan: PlanKey) => void;
}

function PlanSelector({
  offerings,
  selected,
  purchasingPlan,
  paywallState,
  onSelect,
  onPurchase,
}: PlanSelectorProps) {
  const { t } = useTranslation('pro');
  return (
    <View style={styles.planSelector}>
      {offerings.annual ? (
        <PlanCard
          kind="annual"
          package={offerings.annual}
          selected={selected === 'annual'}
          busy={isPlanBusy('annual', purchasingPlan, paywallState)}
          onSelect={onSelect}
          onPress={() => onPurchase('annual')}
        />
      ) : null}
      {offerings.monthly ? (
        <PlanCard
          kind="monthly"
          package={offerings.monthly}
          selected={selected === 'monthly'}
          busy={isPlanBusy('monthly', purchasingPlan, paywallState)}
          onSelect={onSelect}
          onPress={() => onPurchase('monthly')}
        />
      ) : null}
      {!offerings.monthly && !offerings.annual ? (
        <Text style={styles.emptyPlans}>{t('noPlansAvailable')}</Text>
      ) : null}
    </View>
  );
}

interface PlanCardProps {
  kind: PlanKey;
  package: NonNullable<OfferingsSnapshot[PlanKey]>;
  selected: boolean;
  busy: boolean;
  onSelect: (plan: PlanKey) => void;
  onPress: () => void;
}

function PlanCard({
  kind,
  package: pkg,
  selected,
  busy,
  onSelect,
  onPress,
}: PlanCardProps) {
  const { t } = useTranslation('pro');
  const isAnnual = kind === 'annual';

  // The card's first line pulls the localized plan name from the
  // existing `planMonthly` / `planAnnual` keys (slice C). The trial
  // chip / billing caption / equivalent-monthly / cancellation note
  // come from the rewrite's new keys. Both surfaces are required.
  const planName = isAnnual ? t('planAnnual') : t('planMonthly');

  // For annual: pull the equivalent-monthly subline from the intro
  // caption's `priceAfterTrial` (the recurring price AFTER the trial).
  // The hardcoded reference shows "$4.16 / mes" — that's the same
  // `priceAfterTrial` formatted by the SDK with the i18n template
  // `planAnnualEquivalentMonthly` ("Equivale a solo $X / mes"). For
  // monthly: the cancellation note is hardcoded reassurance copy.
  const introPhase = pkg.introPhase;
  const equivalentMonthlyLine = introPhase
    ? t('planAnnualEquivalentMonthly', {
        price: introPhase.priceAfterTrial,
      })
    : t('planAnnualBillCaption');

  return (
    <Pressable
      onPress={() => onSelect(kind)}
      onLongPress={onPress}
      disabled={busy}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${planName} · ${selected ? t('planSelectedA11y') : ''}`}
      style={({ pressed }) => [
        styles.planCard,
        isAnnual ? styles.planCardAnnual : styles.planCardMonthly,
        selected && styles.planCardSelected,
        pressed && styles.planCardPressed,
        busy && styles.planCardBusy,
      ]}
    >
      {isAnnual ? (
        <View style={styles.planBadge}>
          <Icon name="flame.fill" size={12} color={colors.onPrimary} />
          <Text style={styles.planBadgeText}>{t('planBadgeSavings')}</Text>
        </View>
      ) : null}
      <View style={styles.planCardRow}>
        <View style={styles.planCardLeft}>
          <View
            style={[
              styles.planRadio,
              selected && styles.planRadioSelected,
            ]}
          >
            {selected ? <View style={styles.planRadioDot} /> : null}
          </View>
          <View style={styles.planCardLeftText}>
            <View style={styles.planCardTitleRow}>
              <Text style={styles.planCardTitle}>{planName}</Text>
              <View
                style={[
                  styles.planTrialChip,
                  isAnnual
                    ? styles.planTrialChipNeutral
                    : styles.planTrialChipEmphasis,
                ]}
              >
                <Text
                  style={[
                    styles.planTrialChipText,
                    // The emphasis (annual) card carries the trial chip
                    // on a NEUTRAL background — its label needs the
                    // dark-on-light contrast (`textPrimary`). The
                    // monthly card uses the emerald emphasis chip —
                    // the same neutral-on-emerald contract from the
                    // pre-rewrite `planCaptionColor` model.
                    { color: planCaptionColor(isAnnual) },
                  ]}
                >
                  {isAnnual
                    ? t('planAnnualTrialChip')
                    : t('planMonthlyTrialChip')}
                </Text>
              </View>
            </View>
            <Text style={styles.planCardBody}>
              {isAnnual
                ? t('planAnnualBillCaption')
                : t('planMonthlyTrialCaption', {
                    price: pkg.priceString,
                  })}
            </Text>
            <Text
              style={[
                styles.planCardSubline,
                isAnnual
                  ? styles.planCardSublineEmphasis
                  : styles.planCardSublineNeutral,
              ]}
            >
              {isAnnual ? equivalentMonthlyLine : t('planMonthlyCancellationNote')}
            </Text>
          </View>
        </View>
        <View style={styles.planCardRight}>
          <Text style={styles.planCardPrice}>{pkg.priceString}</Text>
          <Text style={styles.planCardPriceUnit}>
            {isAnnual ? t('planPerYear') : t('planPerMonth')}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Primary CTA — full-width, `primary` background, `arrow_forward` icon.
// Copy is resolved by `getCtaCopy(selectedPlan, annualTrialDays)` — the
// pure model returns a `{ key, values? }` shape; the screen renders it
// via `t(cta.key, cta.values)`. The busy spinner on the CTA itself
// reuses the per-plan busy model (`isPlanBusy` for the SELECTED plan).
// ─────────────────────────────────────────────────────────────────────────

interface PrimaryCtaProps {
  offerings: OfferingsSnapshot | null;
  selectedPlan: PlanKey;
  purchasingPlan: PlanKey | null;
  paywallState: PaywallState;
  onPress: (plan: PlanKey) => void;
  onRestore: () => void;
  restoring: boolean;
}

function PrimaryCta({
  offerings,
  selectedPlan,
  purchasingPlan,
  paywallState,
  onPress,
  onRestore,
  restoring,
}: PrimaryCtaProps) {
  const { t } = useTranslation('pro');

  // The CTA copy follows the SELECTED plan (the user picks a card, then
  // taps the CTA). The trial-days interpolation comes from the ANNUAL
  // offering's introPhase — the monthly plan never carries a trial CTA.
  const annualTrialDays = offerings?.annual?.introPhase?.trialDays ?? null;
  const cta = getCtaCopy(selectedPlan, annualTrialDays);
  const ctaCopy = t(cta.key, cta.values);
  const busy = isPlanBusy(selectedPlan, purchasingPlan, paywallState);

  return (
    <View style={styles.ctaWrap}>
      <Pressable
        onPress={() => onPress(selectedPlan)}
        disabled={busy || paywallState === 'loading'}
        accessibilityRole="button"
        accessibilityLabel={ctaCopy}
        style={({ pressed }) => [
          styles.cta,
          pressed && styles.ctaPressed,
          busy && styles.ctaBusy,
        ]}
      >
        {busy ? (
          <Spinner size="sm" color={colors.onPrimary} />
        ) : (
          <>
            <Text style={styles.ctaText}>{ctaCopy}</Text>
            <Icon name="arrow.right" size={18} color={colors.onPrimary} />
          </>
        )}
      </Pressable>
      <Pressable
        onPress={onRestore}
        disabled={restoring || paywallState === 'purchasing'}
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
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Trust strip — 3 microcopy items with icons, separated by dots.
// Centered horizontally on a single row; wraps gracefully on narrow
// screens via `flexWrap` on the outer container.
// ─────────────────────────────────────────────────────────────────────────

function TrustStrip() {
  const { t } = useTranslation('pro');
  return (
    <View style={styles.trustStrip}>
      <View style={styles.trustItem}>
        <Icon name="lock.fill" size={13} color={colors.primary} />
        <Text style={styles.trustItemText}>{t('trustSecurePayment')}</Text>
      </View>
      <View style={styles.trustDot} />
      <View style={styles.trustItem}>
        <Icon
          name="calendar.badge.checkmark"
          size={13}
          color={colors.primary}
        />
        <Text style={styles.trustItemText}>{t('trustCancelAnytime')}</Text>
      </View>
      <View style={styles.trustDot} />
      <View style={styles.trustItem}>
        <Icon name="star.fill" size={13} color={colors.primary} />
        <Text style={styles.trustItemText}>{t('trustSupport247')}</Text>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Legal footer — `autoRenewalNotice` + `legalPrefix` + terms + privacy.
// Mirrors the pre-rewrite contract: the same four i18n keys feed the
// renewal copy, the legal prefix, and the two in-app links. The links
// route through `openLegalDocument` (the same shared seam used by the
// sign-up consent footer, the profile Legal rows, and the consent gate).
// ─────────────────────────────────────────────────────────────────────────

/**
 * The renewal period token interpolated into `autoRenewalNotice`. The
 * es-AR / en / pt-BR catalogs each ship their own period word in the
 * `autoRenewalPeriodAnnual` key so the screen never hardcodes a
 * locale-specific noun. (The legal text reads "La suscripción se
 * renueva automáticamente cada {{period}} hasta que la canceles." —
 * `period` is the only locale-dependent word. The screen uses the
 * annual variant by default since the annual plan is the default
 * selection; a future per-plan variant could swap in
 * `autoRenewalPeriodMonthly`.)
 */
const ANNUAL_PERIOD_KEY = 'autoRenewalPeriodAnnual' as const;

function LegalFooter() {
  const { t } = useTranslation('pro');
  return (
    <View style={styles.legalFooter}>
      <Text style={styles.legalText}>
        {t('autoRenewalNotice', { period: t(ANNUAL_PERIOD_KEY) })}
      </Text>
      <View style={styles.legalLinks}>
        <Text style={styles.legalText}>{t('legalPrefix')}</Text>
        <Pressable
          onPress={() => openLegalDocument('terms')}
          accessibilityRole="link"
          accessibilityLabel={t('termsAndConditionsLink')}
        >
          <Text style={styles.legalLink}>{t('termsAndConditionsLink')}</Text>
        </Pressable>
        <Text style={styles.legalText}>{' & '}</Text>
        <Pressable
          onPress={() => openLegalDocument('privacy')}
          accessibilityRole="link"
          accessibilityLabel={t('privacyPolicyLink')}
        >
          <Text style={styles.legalLink}>{t('privacyPolicyLink')}</Text>
        </Pressable>
        <Text style={styles.legalText}>{'.'}</Text>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Stylesheet — Kinetic Finance palette, type, and spacing tokens.
// All color/spacing/typography values come from the theme; alpha is
// expressed via rgba() (the existing convention across the app).
// ─────────────────────────────────────────────────────────────────────────

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
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  hero: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  heroEyebrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
    backgroundColor: 'rgba(16, 185, 129, 0.10)',
  },
  heroEyebrowText: {
    ...typography.labelCaps,
    color: colors.primary,
  },
  heroHeadline: {
    ...typography.headlineLgMobile,
    color: colors.textPrimary,
    textAlign: 'center',
    paddingHorizontal: spacing.sm,
  },
  heroSubtitle: {
    ...typography.bodyMd,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
  },
  heroMockupWrap: {
    width: '100%',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  heroMockupGlow: {
    position: 'absolute',
    top: -spacing.xxl,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: 'rgba(16, 185, 129, 0.20)',
    opacity: 0.6,
  },
  heroMockup: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    width: '100%',
    minHeight: 96,
  },
  heroMockupCardLeft: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: radii.md,
    padding: spacing.sm,
    gap: 4,
    transform: [{ rotate: '-3deg' }],
  },
  heroMockupCardLeftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroMockupCardEyebrow: {
    ...typography.labelCaps,
    color: colors.primary,
    fontSize: 10,
  },
  heroMockupBarLong: {
    height: 4,
    width: 56,
    backgroundColor: colors.border,
    borderRadius: radii.full,
  },
  heroMockupBarShort: {
    height: 4,
    width: 44,
    backgroundColor: colors.border,
    borderRadius: radii.full,
  },
  heroMockupTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  heroMockupTotalLabel: {
    ...typography.labelSm,
    color: colors.textSecondary,
    fontSize: 11,
  },
  heroMockupTotalValue: {
    ...typography.labelSm,
    color: colors.textPrimary,
    fontWeight: '700',
    fontSize: 11,
  },
  heroMockupCenter: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginHorizontal: -spacing.xs,
  },
  heroMockupCenterBadge: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '6deg' }],
  },
  heroMockupCenterCaption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  heroMockupDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
  heroMockupCenterCaptionText: {
    ...typography.labelCaps,
    color: colors.primary,
    fontSize: 10,
  },
  heroMockupCardRight: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: radii.md,
    padding: spacing.sm,
    alignItems: 'flex-end',
    gap: 4,
    transform: [{ rotate: '3deg' }],
  },
  heroMockupCardRightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  heroMockupCardRightValue: {
    ...typography.labelCaps,
    color: colors.primary,
    fontSize: 11,
  },
  heroMockupCardRightLabel: {
    ...typography.labelCaps,
    color: colors.textSecondary,
    fontSize: 10,
  },
  heroMiniChart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    height: 14,
  },
  heroMiniChartBar: {
    width: 4,
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  features: {
    gap: spacing.sm,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  featureIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(16, 185, 129, 0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: {
    flex: 1,
    gap: 2,
  },
  featureTitle: {
    ...typography.headlineMd,
    color: colors.textPrimary,
    fontSize: 13,
    lineHeight: 16,
  },
  featureDescription: {
    ...typography.bodyMd,
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 14,
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
  planSelector: {
    gap: spacing.md,
  },
  planCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  planCardAnnual: {
    // The annual (emphasis) card stays on the white surface; the
    // "selected" state below swaps in the deeper shadow + checked
    // indicator. We intentionally do NOT paint the emphasis card in
    // `colors.primary` — the green equivalent-monthly subline + the
    // green left-edge accent do that work, keeping the layout
    // tonally consistent with the pre-rewrite surface treatment.
  },
  planCardMonthly: {},
  planCardSelected: {
    borderColor: colors.primary,
    borderWidth: 2,
    boxShadow: '0 4px 12px rgba(16, 185, 129, 0.25)',
  },
  planCardPressed: {
    opacity: 0.85,
  },
  planCardBusy: {
    opacity: 0.7,
  },
  planBadge: {
    position: 'absolute',
    top: -spacing.sm,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.full,
    backgroundColor: colors.primary,
  },
  planBadgeText: {
    ...typography.labelCaps,
    color: colors.onPrimary,
    fontSize: 11,
  },
  planCardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  planCardLeft: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.md,
  },
  planRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  planRadioSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  planRadioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.onPrimary,
  },
  planCardLeftText: {
    flex: 1,
    gap: spacing.xs,
  },
  planCardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  planCardTitle: {
    ...typography.headlineMd,
    color: colors.textPrimary,
  },
  planTrialChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.sm,
  },
  planTrialChipNeutral: {
    backgroundColor: colors.chipBg,
  },
  planTrialChipEmphasis: {
    backgroundColor: 'rgba(16, 185, 129, 0.10)',
  },
  planTrialChipText: {
    ...typography.labelCaps,
    fontSize: 10,
  },
  planCardBody: {
    ...typography.bodyMd,
    color: colors.textSecondary,
    fontSize: 13,
  },
  planCardSubline: {
    ...typography.labelSm,
  },
  planCardSublineEmphasis: {
    color: colors.primary,
    fontWeight: '600',
  },
  planCardSublineNeutral: {
    color: colors.textSecondary,
  },
  planCardRight: {
    alignItems: 'flex-end',
  },
  planCardPrice: {
    ...typography.headlineLgMobile,
    color: colors.textPrimary,
  },
  planCardPriceUnit: {
    ...typography.labelSm,
    color: colors.textSecondary,
  },
  ctaWrap: {
    gap: spacing.md,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.xl,
    boxShadow: '0 6px 16px rgba(16, 185, 129, 0.25)',
  },
  ctaPressed: {
    transform: [{ scale: 0.98 }],
  },
  ctaBusy: {
    opacity: 0.8,
  },
  ctaText: {
    ...typography.headlineMd,
    color: colors.onPrimary,
  },
  cancelButton: {
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelPressed: {
    opacity: 0.7,
  },
  cancelText: {
    ...typography.labelSm,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  restoreButton: {
    paddingVertical: spacing.sm,
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
  trustStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  trustItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  trustItemText: {
    ...typography.labelCaps,
    color: colors.textSecondary,
    fontSize: 11,
  },
  trustDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  legalFooter: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  legalText: {
    ...typography.labelSm,
    color: colors.textSecondary,
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
  },
  legalLinks: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 4,
  },
  legalLink: {
    ...typography.labelSm,
    color: colors.textSecondary,
    fontSize: 11,
    textDecorationLine: 'underline',
    fontWeight: '600',
  },
});
