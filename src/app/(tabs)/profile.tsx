import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { Pressable, ProfileHeader, Spinner, Text, View } from '@/components';
import { useSessionStore, useSessionUser } from '@/features/auth';
import { JoinHouseholdModal } from '@/features/household/components/JoinHouseholdModal';
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
  const { user, usage, error, getHouseholdId } = useProfile();
  const currency = useSettingsStore((s) => s.currency);
  const household = useSettingsStore((s) => s.household_sharing);
  const setHousehold = useSettingsStore((s) => s.setHouseholdSharing);
  const signOut = useSessionStore((s) => s.signOut);
  const { email } = useSessionUser();
  const { isPro, isLoading: proLoading } = useProEntitlement();

  const householdName = useHouseholdStore((s) => s.household?.name);

  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [joinModalVisible, setJoinModalVisible] = useState(false);
  const [togglingHousehold, setTogglingHousehold] = useState(false);
  const { userId } = useSessionUser();

  // Export is a Pro feature (REQ-GATE-1): free users see the row, but
  // tapping it routes to the paywall instead of the exporter. The row
  // stays visible so users know what unlocks with Pro — hiding it would
  // remove the upgrade signal entirely.
  const exportTarget = !isPro && !proLoading ? '/pro' : '/settings/export';

  const handleHouseholdToggle = async (value: boolean) => {
    if (togglingHousehold) return;

    if (value) {
      // ── Turning ON ──────────────────────────────────────────────────
      if (!isPro) {
        router.push('/pro');
        return;
      }
      setTogglingHousehold(true);
      try {
        const householdId = await getHouseholdId();
        setHousehold(true);
        if (householdId) {
          router.push('/settings/household');
        } else {
          setJoinModalVisible(true);
        }
      } finally {
        setTogglingHousehold(false);
      }
    } else {
      // ── Turning OFF ─────────────────────────────────────────────────
      const householdId = await getHouseholdId();
      if (householdId) {
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
      <ScrollView contentContainerStyle={styles.content}>
        {user ? (
          <ProfileHeader
            name={user.full_name ?? 'Tú'}
            avatarUrl={user.avatar_url}
            tier={user.tier}
          />
        ) : null}

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

      <JoinHouseholdModal
        visible={joinModalVisible}
        onClose={() => setJoinModalVisible(false)}
      />
    </SafeAreaView>
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
});
