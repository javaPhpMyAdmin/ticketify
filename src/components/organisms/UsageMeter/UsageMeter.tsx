import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

import { Icon, Pressable, Text, View } from '@/components/atoms';
import { Card } from '@/components/molecules/Card';
import { ProgressBar } from '@/components/molecules/ProgressBar';
import { colors, spacing, typography } from '@/theme';
import { computeQuotaState } from '@/features/home/quota';
import i18next from 'i18next';

export interface UsageMeterProps {
  used: number;
  /**
   * Monthly cap. `null` after migration 0011 marks the row as
   * Pro-unlimited (set_profile_tier writes NULL on GRANT) — see
   * pro-subscription spec REQ-QUOTA-2 / REQ-QUOTA-6.
   */
  limit: number | null;
  /**
   * Client Pro entitlement (RevenueCat). Wins over any stale numeric
   * limit so a paying user never sees a partial meter or the upgrade
   * pitch (CRITICAL-2).
   */
  isPro: boolean;
  kicker?: string;
  /** Override for the "Reset in N days" label. Defaults to a computed
   *  "Se restablece el 1º de {próximo mes}" instead of a hardcoded day count. */
  resetLabel?: string;
  upgradeLabel?: string;
  /** Override for the paywall CTA copy. Only rendered when exhausted. */
  ctaLabel?: string;
}

/**
 * Profile-screen scan-usage card (pro-subscription spec — REQ-QUOTA-6,
 * REQ-GATE-4, REQ-GATE-5). Three branches driven by
 * `computeQuotaState(used, limit, isPro)`:
 *
 *   - **Pro** (`unlimited`): renders the "Ilimitado" label, hides the
 *     progress bar, hides the upgrade pitch entirely. The CRITICAL-2
 *     invariant.
 *   - **Free + exhausted**: renders the danger copy, a full progress
 *     bar, and a pressable paywall CTA. Tapping it routes to `/pro`.
 *   - **Free + remaining**: renders "Escaneos usados X de Y" + a
 *     proportional progress bar.
 */
export function UsageMeter({
  used,
  limit,
  isPro,
  kicker,
  resetLabel,
  upgradeLabel,
  ctaLabel,
}: UsageMeterProps) {
  // PR 3 (`app-i18n`): every hardcoded label on this card reads from the
  // `settings` namespace. The reset label interpolates the locale-aware
  // `date.monthFull.<n>` so the "next month" name follows the active
  // language (e.g. "septiembre" in es-AR, "September" in en).
  const { t } = useTranslation(['settings', 'common']);
  const finalKicker = kicker ?? t('settings:usageKicker');
  const finalUpgradeLabel =
    upgradeLabel ?? t('settings:usageUpgradeLabel');
  const finalCtaLabel = ctaLabel ?? t('settings:usageCtaLabel');
  const state = computeQuotaState(used, limit, isPro);
  // The monthly quota resets on the 1st of the NEXT month. Compute the
  // upcoming month name dynamically via i18next.t('date:monthFull.<n>'),
  // e.g. today in August → "Se restablece el 1º de septiembre" (es-AR) /
  // "Resets on the 1st of September" (en).
  const nextMonthIndex = (new Date().getMonth() + 1) % 12;
  const nextMonthName = i18next.isInitialized
    ? (i18next.t as (k: string) => string)(
        `date:monthFull.${nextMonthIndex}`,
      )
    : '';
  const computedResetLabel =
    resetLabel ??
    `${t('settings:usageResetPrefix')} ${nextMonthName}`.trim();

  if (state.unlimited) {
    return (
      <Card>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.kicker}>{t('settings:usageLimitKicker')}</Text>
            {/* Pro header: "Ilimitado" replaces the free-tier kicker
                ("Escaneos gratuitos mensuales") and sits right under
                "LÍMITE DE USO", in primary for extra visual weight. */}
            <Text style={[styles.kicker, styles.kickerStrong]}>
              {t('settings:usageUnlimited')}
            </Text>
          </View>
          <Icon name="qrcode.viewfinder" size={33} color={colors.primary} />
        </View>
        <View style={styles.row}>
          <Text style={styles.used}>{t('settings:usageScansUsed')}</Text>
          <Text style={styles.usedValue}>{used}</Text>
        </View>
      </Card>
    );
  }

  return (
    <Card>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.kicker}>{t('settings:usageLimitKicker')}</Text>
          <Text style={styles.kicker}>{finalKicker}</Text>
        </View>
        <Icon name="qrcode.viewfinder" size={33} color={colors.primary} />
      </View>
      <View style={styles.row}>
        <Text style={styles.used}>{t('settings:usageScansUsed')}</Text>
        <Text style={styles.usedValue}>
          {used}/{state.effectiveLimit}
        </Text>
      </View>
      <View style={styles.progressWrap}>
        <ProgressBar value={state.ratio} />
      </View>
      <Text style={styles.reset}>{computedResetLabel}</Text>
      {state.exhausted ? (
        <>
          <Text style={styles.upgrade}>{finalUpgradeLabel}</Text>
          <Pressable
            style={styles.cta}
            onPress={() => router.push('/pro')}
            accessibilityRole="button"
            accessibilityLabel={finalCtaLabel}
          >
            <Text style={styles.ctaText}>{finalCtaLabel}</Text>
          </Pressable>
        </>
      ) : (
        <Text style={styles.upgrade}>{finalUpgradeLabel}</Text>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
  },
  headerLeft: {
    backgroundColor: colors.surface,
  },
  kicker: {
    fontSize: 17,
    fontWeight: '900',
    color: colors.textSecondary,
  },
  // Pro header second line: primary color makes "Ilimitado" read
  // stronger than the neutral kicker it replaces.
  kickerStrong: {
    color: colors.primary,
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
  usedValue: {
    color: colors.textPrimary,
    fontWeight: '900',
  },
  progressWrap: {
    marginTop: spacing.md,
  },
  reset: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  upgrade: {
    fontSize: 15,
    color: 'green',
    fontWeight: '800',
    marginTop: spacing.xs,
  },
  cta: {
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 12,
  },
  ctaText: {
    color: colors.onPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
});
