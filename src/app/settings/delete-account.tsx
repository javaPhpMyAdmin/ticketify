import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card, Icon, Pressable, Spinner, Text, View, TypedConfirmation } from '@/components';
import { useSessionStore } from '@/features/auth';
import { useProEntitlement } from '@/features/pro';
import { showManageSubscriptions } from '@/lib/revenuecat';
import { useDialogStore } from '@/stores/use-dialog-store';
import { useToastStore } from '@/stores/use-toast-store';
import { colors, radii, spacing, typography } from '@/theme';

/**
 * Delete-account screen (REQ-ACCTDEL-1..14, REQ-HOUSE-DEL-1..2).
 *
 * Reached from the danger-toned "Eliminar cuenta" row on the profile
 * screen. Three sections, top to bottom:
 *
 *   1. Subscription banner — Pro users see a Google Play caveat
 *      (`deleteAccountBannerPro*`) + a deep-link to the platform-native
 *      subscription manager; Free users get the shorter banner.
 *   2. Pre-delete export nudge (Pro only) — pushes `/settings/export` so
 *      Pro users can save their data before pulling the trigger.
 *   3. TypedConfirmation — `typedPrompt = 'ELIMINAR'` (es-AR canonical;
 *      mirrors `settings:deleteAccountTypedPrompt`). The primary button
 *      enables only on exact case-insensitive trimmed match.
 *
 * On confirm:
 *   - `useSessionStore.deleteAccount()` runs the manual cleanup chain
 *     (the SIGNED_OUT listener does NOT fire after hard delete).
 *   - `status === 'ok'` → `router.replace('/sign-in')` (replace, not
 *     push, so back from sign-in doesn't land on a deleted account).
 *   - `code === 'household_owner_with_members'` → toast + push to
 *     `/settings/household`. The typed value is preserved across the
 *     detour via `useSessionStore.deleteAccountDraft`.
 *   - other errors → dialog with localized retry copy.
 *
 * Cross-route typed-value preservation (REQ-HOUSE-DEL-2):
 *   - On mount: seed `useState` from the store draft (if any) so a
 *     round-trip from the household screen restores what the user typed.
 *   - On every keystroke: write through to the store.
 *   - On unmount: clear the store draft (success, cancel, give-up).
 */
export default function DeleteAccountScreen() {
  const { t } = useTranslation(['settings', 'common', 'auth', 'pro']);
  const { isPro } = useProEntitlement();

  // Seed local state from the cross-route draft so a user who returned
  // from the household screen finds their typed value still there.
  // Read once at mount — subsequent store updates are write-through only.
  const initialDraft = useSessionStore.getState().deleteAccountDraft;
  const [typedValue, setTypedValue] = useState<string>(
    initialDraft?.typedValue ?? '',
  );
  const [deleting, setDeleting] = useState(false);

  // Write-through: every keystroke updates the store draft so a household
  // detour preserves the input verbatim (design §14 Decision 2 — store,
  // not router params, so the literal ELIMINAR never leaks into the nav log).
  useEffect(() => {
    useSessionStore.getState().setDeleteAccountDraft({ typedValue });
  }, [typedValue]);

  // On unmount: drop the draft. The screen is leaving for one of three
  // reasons — success (cleanup ran inside `deleteAccount()`), back/press,
  // or household detour where the household screen takes over the flow.
  // Either way the draft should not survive the screen lifetime.
  useEffect(() => {
    return () => {
      useSessionStore.getState().setDeleteAccountDraft(null);
    };
  }, []);

  // Post-cutover (0039): subscriptionStatus is `'none' | 'active'` only
  // (no 'trial'). The active check collapses to the binary `isPro` from
  // the entitlement hook (which is `true` iff the SDK reports an active
  // `pro` entitlement OR the DB says `subscription_status === 'active'`).
  const isSubscriptionActive = isPro;

  const handleConfirm = async () => {
    if (deleting) return;
    setDeleting(true);
    const result = await useSessionStore.getState().deleteAccount();
    setDeleting(false);

    if (result.status === 'ok') {
      // replace (not push) so back from sign-in doesn't land on the
      // deleted account screen.
      router.replace('/sign-in');
      return;
    }

    // Map error code → UX. The screen controls ALL localized copy keyed
    // on `code`; the wrapper returns an empty `message` by design.
    if (result.code === 'household_owner_with_members') {
      useToastStore
        .getState()
        .show(t('settings:deleteAccountErrorHouseholdOwnerBody'), 'default');
      router.replace('/settings/household');
      return;
    }

    // Per REQ-ACCTDEL-11: an `unauthenticated` envelope means the user's
    // JWT expired between mount and confirm (rare in practice — the
    // SIGNED_OUT listener would normally have routed them out first).
    // Re-route to `/sign-in` so they can re-authenticate and retry.
    if (result.code === 'unauthenticated') {
      router.replace('/sign-in');
      return;
    }

    if (
      result.code === 'revenuecat_revoke_failed' ||
      result.code === 'internal'
    ) {
      const bodyKey =
        result.code === 'revenuecat_revoke_failed'
          ? 'settings:deleteAccountErrorRevokeBody'
          : 'settings:deleteAccountErrorInternalBody';
      useDialogStore.getState().show({
        title: t('settings:deleteAccountErrorTitle'),
        message: t(bodyKey),
        primaryLabel: t('settings:deleteAccountErrorRetry'),
        tone: 'danger',
      });
      return;
    }
  };

  const handleManageSubscription = async () => {
    await showManageSubscriptions();
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t('common:back')}
        >
          <Icon name="arrow.left" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.title}>{t('settings:deleteAccount')}</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── 1. Subscription banner ──────────────────────────────────── */}
        <Card
          style={[
            styles.banner,
            isSubscriptionActive ? styles.bannerPro : styles.bannerFree,
          ]}
        >
          <Text style={styles.bannerTitle}>
            {isSubscriptionActive
              ? t('settings:deleteAccountBannerProTitle')
              : t('settings:deleteAccountBannerFreeTitle')}
          </Text>
          <Text style={styles.bannerBody}>
            {isSubscriptionActive
              ? t('settings:deleteAccountBannerProBody')
              : t('settings:deleteAccountBannerFreeBody')}
          </Text>
          {isSubscriptionActive ? (
            <Pressable
              onPress={handleManageSubscription}
              style={({ pressed }) => [
                styles.bannerAction,
                pressed && styles.bannerActionPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={t('pro:manageSubscription')}
            >
              <Text style={styles.bannerActionText}>
                {t('settings:deleteAccountBannerProAction')}
              </Text>
              <Icon name="chevron.right" size={16} color={colors.primary} />
            </Pressable>
          ) : null}
        </Card>

        {/* ── 2. Pre-delete export nudge (Pro only) ───────────────────── */}
        {isPro ? (
          <Pressable
            onPress={() => router.push('/settings/export')}
            style={({ pressed }) => [
              styles.exportNudge,
              pressed && styles.exportNudgePressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={t(
              'settings:deleteAccountExportNudgeAction',
            )}
          >
            <Icon
              name="square.and.arrow.up"
              size={20}
              color={colors.primary}
            />
            <View style={styles.exportNudgeBody}>
              <Text style={styles.exportNudgeTitle}>
                {t('settings:deleteAccountExportNudgeTitle')}
              </Text>
              <Text style={styles.exportNudgeAction}>
                {t('settings:deleteAccountExportNudgeAction')}
              </Text>
            </View>
            <Icon name="chevron.right" size={18} color={colors.primary} />
          </Pressable>
        ) : null}

        {/* ── 3. TypedConfirmation ────────────────────────────────────── */}
        <View style={styles.confirmWrap}>
          <TypedConfirmation
            title={t('settings:deleteAccountConfirmTitle')}
            body={t('settings:deleteAccountConfirmBody')}
            typedPrompt={t('settings:deleteAccountTypedPrompt')}
            typedValue={typedValue}
            onTypedValueChange={setTypedValue}
            primaryLabel={t('settings:deleteAccountTypedAction')}
            onPrimary={handleConfirm}
            primaryDisabled={deleting}
            tone="danger"
            inputHint={t('settings:deleteAccountInputHint')}
            inputAccessibilityLabel={t(
              'settings:deleteAccountFinalWarning',
            )}
          />

          {deleting ? (
            <View style={styles.spinnerOverlay} pointerEvents="none">
              <Spinner size="lg" color={colors.danger} />
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  title: {
    ...typography.headlineLgMobile,
    color: colors.textPrimary,
  },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  // ── Subscription banner ──────────────────────────────────────────────
  banner: {
    gap: spacing.sm,
  },
  bannerPro: {
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  bannerFree: {
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  bannerTitle: {
    ...typography.bodyLg,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  bannerBody: {
    ...typography.bodyMd,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  bannerAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  bannerActionPressed: {
    opacity: 0.7,
  },
  bannerActionText: {
    ...typography.labelSm,
    color: colors.primary,
    fontWeight: '700',
    fontSize: 14,
  },
  // ── Export nudge ─────────────────────────────────────────────────────
  exportNudge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.primaryContainer,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  exportNudgePressed: {
    opacity: 0.85,
  },
  exportNudgeBody: {
    flex: 1,
    gap: 2,
  },
  exportNudgeTitle: {
    ...typography.bodyMd,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  exportNudgeAction: {
    ...typography.labelSm,
    color: colors.primary,
    fontWeight: '700',
    fontSize: 13,
  },
  // ── TypedConfirmation wrap ───────────────────────────────────────────
  confirmWrap: {
    position: 'relative',
  },
  spinnerOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
    borderRadius: radii.lg,
  },
});
