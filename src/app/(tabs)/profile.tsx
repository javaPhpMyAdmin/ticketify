import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Pressable, ProfileHeader, Spinner, Text, View } from '@/components';
import { useSessionStore, useSessionUser } from '@/features/auth';
import { useProEntitlement } from '@/features/pro';
import {
  AccountSettingsList,
  UsageLimitsCard,
  useProfile,
  type AccountSettingRow,
} from '@/features/profile';
import { useLocaleStore } from '@/i18n/stores/useLocaleStore';
import { legalUrlFor } from '@/lib/legal-urls';
import { openExternalUrl } from '@/lib/open-external-url';
import { showManageSubscriptions } from '@/lib/revenuecat';
import { leaveHousehold } from '@/lib/supabase/feature-access';
import { queryClient } from '@/lib/query-client';
import { queryKeys } from '@/lib/query-keys';
import { useHouseholdStore } from '@/stores/use-household-store';
import { useSettingsStore } from '@/stores/use-settings-store';
import { colors, spacing, typography } from '@/theme';

export default function ProfileScreen() {
  const { t } = useTranslation(['settings', 'common', 'auth', 'pro']);
  const { user, usage, error } = useProfile();
  const currency = useSettingsStore((s) => s.currency);
  const household = useSettingsStore((s) => s.household_sharing);
  const setHousehold = useSettingsStore((s) => s.setHouseholdSharing);
  const signOut = useSessionStore((s) => s.signOut);
  const { email } = useSessionUser();
  const { isPro, isLoading: proLoading, subscriptionStatus, trialEndsAt, daysRemaining, isFrozen, everPaid } =
    useProEntitlement();
  const localeOverride = useLocaleStore((s) => s.override);
  const activeLocale = useLocaleStore((s) => s.activeLocale);

  const householdName = useHouseholdStore((s) => s.household?.name);

  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [togglingHousehold, setTogglingHousehold] = useState(false);
  const [managingSubscription, setManagingSubscription] = useState(false);
  const [manageSubscriptionError, setManageSubscriptionError] = useState<string | null>(null);
  const { userId } = useSessionUser();

  // Export is a Pro feature (REQ-GATE-1): free users see the row, but
  // tapping it routes to the paywall instead of the exporter. The row
  // stays visible so users know what unlocks with Pro — hiding it would
  // remove the upgrade signal entirely.
  const exportTarget = !isPro && !proLoading ? '/pro' : '/settings/export';

  const handleHouseholdToggle = async (value: boolean) => {
    if (togglingHousehold) return;

    // Use the household_id already cached from the profile query instead of
    // making a fresh network request via getHouseholdId() — eliminates the
    // toggle delay.
    const cachedHouseholdId = user?.household_id ?? null;

    if (value) {
      // ── Turning ON ──────────────────────────────────────────────────
      // Owner-pays rule: free users can access the household settings
      // screen to join an existing household via invite code. The server
      // will reject create_household if the caller isn't Pro/trialing.
      setHousehold(true);
      // Always go to the household settings screen which shows both
      // "Crear hogar" and "Unirse con código" when no household exists.
      router.push('/settings/household');
    } else {
      // ── Turning OFF ─────────────────────────────────────────────────
      if (cachedHouseholdId) {
        setTogglingHousehold(true);
        try {
          const result = await leaveHousehold();
          if (result.status === 'ok') {
            useHouseholdStore.getState().reset();
          }
        } finally {
          setTogglingHousehold(false);
        }
      }
      setHousehold(false);
      if (userId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.household(userId),
        });
      }
    }
  };

  const settings: AccountSettingRow[] = [
    {
      id: 'profile-edit',
      label: t('settings:editProfile'),
      icon: 'pencil',
      trailing: { type: 'chevron' },
      onPress: () => router.push('/settings/profile-edit'),
    },
    {
      id: 'export',
      label: t('settings:export'),
      icon: 'square.and.arrow.up',
      trailing: { type: 'chevron' },
      onPress: () => router.push(exportTarget),
    },
    {
      id: 'currency',
      label: t('settings:currency'),
      value: `${currency}`,
      icon: 'creditcard',
      trailing: { type: 'chevron' },
      onPress: () => router.push('/settings/currency'),
    },
    {
      id: 'budget',
      label: t('settings:monthlyBudget'),
      icon: 'chart.pie.fill',
      trailing: { type: 'chevron' },
      onPress: () => router.push('/settings/budget'),
    },
    {
      id: 'category-budgets',
      label: t('settings:categoryBudgets'),
      icon: 'chart.bar.fill',
      trailing: { type: 'chevron' },
      onPress: () => router.push('/settings/category-budgets'),
    },
    {
      id: 'household',
      label: t('settings:household'),
      value: household && householdName ? householdName : undefined,
      icon: 'person.fill',
      trailing: {
        type: 'switch',
        value: household,
        onChange: handleHouseholdToggle,
      },
    },
    {
      id: 'language',
      label: t('settings:language'),
      // Surface the current override as a chip so the user knows
      // which language is active without opening the selector. The
      // raw override tag is fine here — `auto` reads as "device
      // locale", the locale codes as themselves.
      value: localeOverride,
      icon: 'globe',
      trailing: { type: 'chevron' },
      onPress: () => router.push('/settings/language'),
    },
    {
      // Destructive action — visually separated from the standard
      // settings block by the dangerSection wrapper below. The row
      // itself uses `tone: 'danger'` so the icon and label paint in
      // `colors.danger` (AccountSettingsList extension from WU-3.6).
      id: 'delete-account',
      label: t('settings:deleteAccount'),
      icon: 'trash',
      tone: 'danger',
      trailing: { type: 'chevron' },
      onPress: () => router.push('/settings/delete-account'),
    },
  ];

  // Legal documents open in the external browser (REQ-3). Deliberately a
  // separate row set — appending these to `settings[]` would shift the
  // slice/danger split below, so the Legal group renders as its own
  // section between the main list and the danger zone.
  const legalRows: AccountSettingRow[] = [
    {
      id: 'privacy-policy',
      label: t('settings:privacyPolicy'),
      icon: 'doc.text',
      trailing: { type: 'chevron' },
      onPress: () => void openExternalUrl(legalUrlFor('privacy', activeLocale)),
    },
    {
      id: 'terms-and-conditions',
      label: t('settings:termsConditions'),
      icon: 'doc.on.doc',
      trailing: { type: 'chevron' },
      onPress: () => void openExternalUrl(legalUrlFor('terms', activeLocale)),
    },
  ];

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError(null);
    try {
      await signOut();
    } catch {
      setSignOutError('No se pudo cerrar la sesión. Inténtalo de nuevo.');
    } finally {
      setSigningOut(false);
    }
  };

  // Opens the platform-native subscription management screen (Google
  // Play on Android, App Store on iOS). Google Play policy forbids
  // in-app cancellation of subscriptions managed by the Play Store —
  // this is the supported escape hatch. Errors surface inline so a
  // misconfigured install is observable instead of a silent no-op.
  const handleManageSubscription = async () => {
    if (managingSubscription) return;
    setManagingSubscription(true);
    setManageSubscriptionError(null);
    try {
      const result = await showManageSubscriptions();
      if (!result.ok && result.error) {
        setManageSubscriptionError(result.error);
      }
    } finally {
      setManagingSubscription(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        {user ? (
          <ProfileHeader
            name={user.full_name ?? 'Tú'}
            avatarUrl={user.avatar_url}
            tier={user.tier}
            // A frozen trial (expired) is no longer a paying Pro user; show
            // the real lifecycle state instead of the access-tier chip.
            tierLabel={isFrozen ? 'Prueba expirada' : undefined}
          />
        ) : null}

        {/* ── Subscription status ── */}
        {(() => {
          if (proLoading) return null;

          // Active paid subscriber
          if (subscriptionStatus === 'active') {
            return (
              <View style={styles.statusGroup}>
                <View style={styles.statusRow}>
                  <View style={styles.statusBadgeActive}>
                    <Text style={styles.statusBadgeText}>PRO</Text>
                  </View>
                  <Text style={styles.statusLabel}>{t('settings:proActive')}</Text>
                </View>
                <Pressable
                  onPress={handleManageSubscription}
                  disabled={managingSubscription}
                  style={({ pressed }) => [
                    styles.manageSubscriptionButton,
                    pressed && styles.pressablePressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={t('pro:manageSubscription')}
                >
                  <Text style={styles.manageSubscriptionText}>
                    {t('pro:manageSubscription')}
                  </Text>
                  <Text style={styles.manageSubscriptionChevron}>›</Text>
                </Pressable>
              </View>
            );
          }

          // Active trial
          if (subscriptionStatus === 'trial' && !isFrozen) {
            return (
              <Pressable
                onPress={() => router.push('/pro')}
                style={({ pressed }) => [
                  styles.statusRow,
                  pressed && styles.statusRowPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={t('settings:seePlans')}
              >
                <View style={styles.statusBadgeTrial}>
                  <Text style={styles.statusBadgeTrialText}>
                    {daysRemaining}
                  </Text>
                </View>
                <View style={styles.statusTextCol}>
                  <Text style={styles.statusLabel}>{t('settings:trialActive')}</Text>
                  <Text style={styles.statusHint}>
                    {t('common:subscription.daysRemaining', { count: daysRemaining })}
                  </Text>
                </View>
                <Text style={styles.statusLink}>{t('settings:seePlans')}</Text>
              </Pressable>
            );
          }

          // Expired trial
          if (isFrozen) {
            return (
              <Pressable
                onPress={() => router.push('/pro')}
                style={({ pressed }) => [
                  styles.statusRow,
                  styles.statusRowExpired,
                  pressed && styles.statusRowPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={t('settings:seePlans')}
              >
                <Text style={styles.statusLabelExpired}>
                  {t('settings:trialExpired')}
                </Text>
                <Text style={styles.statusLink}>{t('settings:seePlans')}</Text>
              </Pressable>
            );
          }

          // Expired trial — but NOT frozen (trial ran out and the account was
          // normalized back to Free): already used the free trial, so this is
          // a past user, not a prospect. Show the real lifecycle state instead
          // of wrongly offering "Empezar prueba gratis" again (the paywall
          // allows a fresh trial only when `status === 'none'` AND no
          // trialEndsAt AND not frozen). "Ver planes" still routes to the
          // paywall for a paid upgrade.
          if (subscriptionStatus === 'expired') {
            return (
              <Pressable
                onPress={() => router.push('/pro')}
                style={({ pressed }) => [
                  styles.statusRow,
                  pressed && styles.statusRowPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={t('settings:seePlans')}
              >
                <Text style={styles.statusLabel}>{t('settings:freePlan')}</Text>
                <Text style={styles.statusLink}>{t('settings:seePlans')}</Text>
              </Pressable>
            );
          }

          // Free user (no trial used). If the user has EVER paid (monotonic
          // flag, 0021) they cannot start a free trial again — show the same
          // "Plan Gratis / Ver planes" as the expired branch instead of
          // offering a trial that the server would reject.
          return everPaid ? (
            <Pressable
              onPress={() => router.push('/pro')}
              style={({ pressed }) => [
                styles.statusRow,
                pressed && styles.statusRowPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={t('settings:seePlans')}
            >
              <Text style={styles.statusLabel}>{t('settings:freePlan')}</Text>
              <Text style={styles.statusLink}>{t('settings:seePlans')}</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => router.push('/pro')}
              style={({ pressed }) => [
                styles.statusRow,
                pressed && styles.statusRowPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={t('settings:startFreeTrial')}
            >
              <Text style={styles.statusLabel}>{t('settings:free')}</Text>
              <Text style={styles.statusLink}>{t('settings:startFreeTrial')}</Text>
            </Pressable>
          );
        })()}

        {usage ? <UsageLimitsCard usage={usage} isPro={isPro} /> : null}

        {manageSubscriptionError ? (
          <Text style={styles.error}>{manageSubscriptionError}</Text>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings:sectionTitle')}</Text>
          <AccountSettingsList rows={settings.slice(0, settings.length - 1)} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings:legalSectionTitle')}</Text>
          <AccountSettingsList rows={legalRows} />
        </View>

        {/* Destructive actions sit in their own section, separated from the
            standard settings block by a hairline + spacing. The last row
            (`delete-account`) is rendered here so it reads as a "danger
            zone" affordance instead of another routine setting. */}
        <View style={styles.dangerSection}>
          <Text style={styles.dangerSectionTitle}>
            {t('settings:deleteAccountSectionTitle')}
          </Text>
          <AccountSettingsList rows={[settings[settings.length - 1]]} />
        </View>

        <View style={styles.section}>
          {signOutError ? (
            <Text style={styles.error}>{signOutError}</Text>
          ) : null}
          <Pressable
            style={styles.signOutButton}
            onPress={handleSignOut}
            disabled={signingOut}
            accessibilityRole="button"
            accessibilityLabel={t('auth:signOut')}
          >
            {signingOut ? (
              <Spinner size="sm" color={colors.danger} />
            ) : (
              <Text style={styles.signOutText}>{t('auth:signOut')}</Text>
            )}
          </Pressable>
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
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: 100,
    gap: spacing.lg,
  },
  section: {
    gap: spacing.md,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: colors.textSecondary,
  },
  dangerSection: {
    gap: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  dangerSectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.danger,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  error: {
    ...typography.labelSm,
    color: colors.danger,
  },
  signOutButton: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 12,
    boxShadow: '1px 2px 6px rgba(0, 0, 0, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  signOutText: {
    ...typography.labelSm,
    color: colors.danger,
    fontWeight: '700',
  },
  // ── Subscription status ──
  statusGroup: {
    gap: spacing.sm,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  statusRowPressed: {
    opacity: 0.7,
  },
  statusRowExpired: {
    borderWidth: 1,
    borderColor: colors.danger,
  },
  statusBadgeActive: {
    backgroundColor: colors.primary,
    borderRadius: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  statusBadgeText: {
    ...typography.labelSm,
    fontWeight: '800',
    color: colors.onPrimary,
  },
  statusBadgeTrial: {
    backgroundColor: colors.primaryContainer,
    borderRadius: 8,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusBadgeTrialText: {
    ...typography.labelSm,
    fontWeight: '800',
    color: colors.primaryDark,
  },
  statusTextCol: {
    flex: 1,
    gap: 1,
  },
  statusLabel: {
    ...typography.bodyMd,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  statusLabelExpired: {
    ...typography.bodyMd,
    fontWeight: '600',
    color: colors.danger,
    flex: 1,
  },
  statusHint: {
    ...typography.labelSm,
    color: colors.textSecondary,
  },
  statusLink: {
    ...typography.labelSm,
    fontWeight: '700',
    color: colors.primary,
  },
  manageSubscriptionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  manageSubscriptionText: {
    ...typography.bodyMd,
    fontWeight: '600',
    color: colors.primary,
  },
  manageSubscriptionChevron: {
    ...typography.headlineMd,
    color: colors.textSecondary,
    fontWeight: '300',
  },
  pressablePressed: {
    opacity: 0.7,
  },
});
