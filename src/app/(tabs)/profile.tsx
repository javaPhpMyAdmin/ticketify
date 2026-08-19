import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { Pressable, ProfileHeader, Spinner, Text, View } from '@/components';
import { useSessionStore, useSessionUser } from '@/features/auth';
import { useProEntitlement } from '@/features/pro';
import {
  AccountSettingsList,
  UsageLimitsCard,
  useProfile,
  type AccountSettingRow,
} from '@/features/profile';
import { leaveHousehold } from '@/lib/supabase/feature-access';
import { queryClient } from '@/lib/query-client';
import { queryKeys } from '@/lib/query-keys';
import { useHouseholdStore } from '@/stores/use-household-store';
import { useSettingsStore } from '@/stores/use-settings-store';
import { colors, spacing, typography } from '@/theme';

export default function ProfileScreen() {
  const { user, usage, error } = useProfile();
  const currency = useSettingsStore((s) => s.currency);
  const household = useSettingsStore((s) => s.household_sharing);
  const setHousehold = useSettingsStore((s) => s.setHouseholdSharing);
  const signOut = useSessionStore((s) => s.signOut);
  const { email } = useSessionUser();
  const { isPro, isLoading: proLoading, subscriptionStatus, trialEndsAt, daysRemaining, isFrozen } =
    useProEntitlement();

  const householdName = useHouseholdStore((s) => s.household?.name);

  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [togglingHousehold, setTogglingHousehold] = useState(false);
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
      id: 'export',
      label: 'Exportar datos',
      icon: 'square.and.arrow.up',
      trailing: { type: 'chevron' },
      onPress: () => router.push(exportTarget),
    },
    {
      id: 'currency',
      label: 'Moneda',
      value: `${currency}`,
      icon: 'creditcard',
      trailing: { type: 'chevron' },
      onPress: () => router.push('/settings/currency'),
    },
    {
      id: 'budget',
      label: 'Presupuesto mensual',
      icon: 'chart.pie.fill',
      trailing: { type: 'chevron' },
      onPress: () => router.push('/settings/budget'),
    },
    {
      id: 'category-budgets',
      label: 'Presupuestos por categoría',
      icon: 'chart.bar.fill',
      trailing: { type: 'chevron' },
      onPress: () => router.push('/settings/category-budgets'),
    },
    {
      id: 'household',
      label: 'Uso compartido del hogar',
      value: household && householdName ? householdName : undefined,
      icon: 'person.fill',
      trailing: {
        type: 'switch',
        value: household,
        onChange: handleHouseholdToggle,
      },
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

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        {user ? (
          <ProfileHeader
            name={user.full_name ?? 'Tú'}
            avatarUrl={user.avatar_url}
            tier={user.tier}
          />
        ) : null}

        {/* ── Subscription status ── */}
        {(() => {
          if (proLoading) return null;

          // Active paid subscriber
          if (subscriptionStatus === 'active') {
            return (
              <View style={styles.statusRow}>
                <View style={styles.statusBadgeActive}>
                  <Text style={styles.statusBadgeText}>PRO</Text>
                </View>
                <Text style={styles.statusLabel}>Suscripción activa</Text>
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
                accessibilityLabel="Ver planes"
              >
                <View style={styles.statusBadgeTrial}>
                  <Text style={styles.statusBadgeTrialText}>
                    {daysRemaining}
                  </Text>
                </View>
                <View style={styles.statusTextCol}>
                  <Text style={styles.statusLabel}>Prueba PRO activa</Text>
                  <Text style={styles.statusHint}>
                    {daysRemaining === 1
                      ? 'Queda 1 día'
                      : `Quedan ${daysRemaining} días`}
                  </Text>
                </View>
                <Text style={styles.statusLink}>Ver planes</Text>
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
                accessibilityLabel="Ver planes"
              >
                <Text style={styles.statusLabelExpired}>
                  Prueba expirada
                </Text>
                <Text style={styles.statusLink}>Ver planes</Text>
              </Pressable>
            );
          }

          // Free user (no trial used)
          return (
            <Pressable
              onPress={() => router.push('/pro')}
              style={({ pressed }) => [
                styles.statusRow,
                pressed && styles.statusRowPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Empezar prueba gratis"
            >
              <Text style={styles.statusLabel}>Gratis</Text>
              <Text style={styles.statusLink}>Empezar prueba gratis</Text>
            </Pressable>
          );
        })()}

        {usage ? <UsageLimitsCard usage={usage} isPro={isPro} /> : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>CONFIGURACIÓN </Text>
          <AccountSettingsList rows={settings} />
          {!isPro && !proLoading ? (
            <Text style={styles.proNote}>Función premium</Text>
          ) : null}
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
            accessibilityLabel="Cerrar sesión"
          >
            {signingOut ? (
              <Spinner size="sm" color={colors.danger} />
            ) : (
              <Text style={styles.signOutText}>Cerrar sesión</Text>
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
  proNote: {
    ...typography.labelSm,
    color: colors.textSecondary,
  },
  error: {
    ...typography.labelSm,
    color: colors.danger,
  },
  signOutButton: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 12,
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
});
