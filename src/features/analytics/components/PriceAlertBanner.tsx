import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

import { Icon, Pressable, Text, View } from '@/components';
import {
  isPriceIncrease,
  type PriceAlert,
} from '@/features/analytics/price-alerts';
import { currentMonthKey } from '@/features/home/hooks/useHomeFeed';
import { colors, radii, spacing } from '@/theme';

/**
 * Price-alert banner (pro-subscription spec — REQ-GATE-2). One alert per
 * `(identity, current-month)` tuple that crossed the 5% threshold; the
 * banner is always visible (REQ-GATE-1: Pro features shown with a lock,
 * not hidden) so free users see that an alert exists and the Pro pill
 * makes the upsell explicit.
 *
 * Tap routing (three cases):
 *
 * - `!isPro`: `onPress` pushes the paywall (`/pro`). The banner
 *   content still renders so the user understands what they would unlock.
 * - `isPro && alert.receiptId`: `onPress` navigates to the source receipt detail
 *   at `/receipts/${id}` carrying the alert identity so that screen can mount
 *   the comparison that used to live inline: `month` (the `monthKey` prop,
 *   falling back to `currentMonthKey()`), `name`, `unit` and
 *   `previousReceiptId`. Query values go through `URLSearchParams`; the path
 *   id is `encodeURIComponent`-escaped and the typed href is cast `as never`
 *   (same pattern as `app/items/[name].tsx`). The id is captured
 *   deterministically by `computePriceAlerts` (S2: latest `purchase_date`,
 *   tie-break `id` ascending) so two runs on the same data land on the same
 *   receipt.
 * - `isPro && !alert.receiptId`: no-op (do nothing; never the paywall).
 */
export interface PriceAlertBannerProps {
  alert: PriceAlert;
  isPro: boolean;
  /** Month whose alerts produced this banner; defaults to the current month. */
  monthKey?: string;
}

export function PriceAlertBanner({
  alert,
  isPro,
  monthKey,
}: PriceAlertBannerProps) {
  const { t } = useTranslation(['analytics']);
  // A Pro user with an id-less alert has nothing to open (receiptId is
  // optional and can be an empty string). The banner stays readable, but it
  // must not announce a dead action to assistive tech.
  const canAct = !isPro || !!alert.receiptId;
  // red = increase, green = drop
  const priceIncreased = isPriceIncrease(alert.changePct);
  const handlePress = () => {
    if (!isPro) {
      router.push('/pro');
      return;
    }
    if (alert.receiptId) {
      // URLSearchParams already escapes each value; encoding them again would
      // double-escape (expo-router decodes once) and break the alert lookup on
      // the detail screen. Only the path segment needs explicit escaping.
      const params = new URLSearchParams({
        month: monthKey ?? currentMonthKey(),
        name: alert.name,
        unit: alert.unit,
        previousReceiptId: alert.previousReceiptId,
      });
      router.push(
        `/receipts/${encodeURIComponent(alert.receiptId)}?${params.toString()}` as never,
      );
    }
  };
  return (
    <Pressable
      onPress={canAct ? handlePress : undefined}
      disabled={!canAct}
      accessibilityRole={canAct ? 'button' : undefined}
      accessibilityHint={
        canAct
          ? isPro
            ? t('analytics:priceAlertA11yHint')
            : t('analytics:priceAlertProA11yHint')
          : undefined
      }
      accessibilityLabel={
        canAct
          ? isPro
            ? t('analytics:priceAlertA11y')
            : t('analytics:priceAlertProA11y')
          : undefined
      }
      style={({ pressed }) => [
        styles.alertBanner,
        priceIncreased ? styles.alertBannerUp : styles.alertBannerDown,
        pressed && styles.alertBannerPressed,
      ]}
    >
      <Icon
        name="exclamationmark.triangle.fill"
        size={26}
        color={priceIncreased ? colors.danger : colors.primaryDark}
      />
      <View style={styles.wrapTextIcon}>
        <View style={styles.alertTitleRow}>
          <Text
            style={[
              styles.priceAlert,
              { color: priceIncreased ? colors.danger : colors.primaryDark },
            ]}
          >
            {t('analytics:priceAlertTitle')}
          </Text>
          {!isPro ? (
            <View style={[styles.proPill, styles.proPillRow]}>
              <Icon name="lock.fill" size={11} color={colors.onPrimary} />
              <Text style={styles.proPillText}>{t('analytics:proPill')}</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.alertTextWrap}>
          <Text style={styles.alertText}>
            {alert.name}{' '}
            {priceIncreased
              ? t('analytics:priceAlertUp')
              : t('analytics:priceAlertDown')}{' '}
            <Text style={{ fontSize: 17.5, fontWeight: 900, color: 'black' }}>
              {Math.abs(alert.changePct)}%
            </Text>{' '}
            {t('analytics:priceAlertSince')}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

// Softer than the theme's saturated green so the DOWN card is as subtle as the
// pale-red UP card (#f9e9e9 / #fbbbbb). The icon and title keep primaryDark.
const DROP_BACKGROUND = '#edf7f0';
const DROP_BORDER = '#c8e6d2';

const styles = StyleSheet.create({
  alertBanner: {
    height: 100,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: spacing.md,
  },
  alertBannerUp: {
    backgroundColor: '#f9e9e9',
    borderColor: '#fbbbbb',
  },
  alertBannerDown: {
    backgroundColor: DROP_BACKGROUND,
    borderColor: DROP_BORDER,
  },
  alertBannerPressed: {
    opacity: 0.85,
  },
  alertTextWrap: {
    // Override the themed View's theme.background default so the tint shows.
    backgroundColor: 'transparent',
    flex: 1,
    width: '90%',
  },
  alertText: {
    fontSize: 15.5,
    fontWeight: '500',
    color: colors.textPrimary,
    flexWrap: 'wrap',
  },
  alertTitleRow: {
    // Override the themed View's theme.background default so the tint shows.
    backgroundColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  priceAlert: {
    fontSize: 20,
    fontWeight: 900,
    color: colors.danger,
    padding: 2,
  },
  proPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.full,
    backgroundColor: colors.primary,
  },
  proPillText: {
    fontSize: 11,
    fontWeight: '900',
    color: colors.onPrimary,
    letterSpacing: 0.05 * 16,
    textTransform: 'uppercase',
  },
  proPillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  wrapTextIcon: {
    // Override the themed View's theme.background default so the tint shows.
    backgroundColor: 'transparent',
    flexDirection: 'column',
    paddingLeft: 5,
  },
});
