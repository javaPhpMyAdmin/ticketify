import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { Pressable, ProfileHeader, Spinner, Text, View } from '@/components';
import { useSessionStore, useSessionUser } from '@/features/auth';
import {
  AccountSettingsList,
  UsageLimitsCard,
  useProfile,
  type AccountSettingRow,
} from '@/features/profile';
import { useSettingsStore } from '@/stores/use-settings-store';
import { colors, spacing, typography } from '@/theme';

export default function ProfileScreen() {
  const { user, usage, error, setHouseholdSharing } = useProfile();
  const currency = useSettingsStore((s) => s.currency);
  const household = useSettingsStore((s) => s.household_sharing);
  const setHousehold = useSettingsStore((s) => s.setHouseholdSharing);
  const signOut = useSessionStore((s) => s.signOut);
  const { email } = useSessionUser();

  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const settings: AccountSettingRow[] = [
    {
      id: 'export',
      label: 'Exportar datos',
      icon: 'square.and.arrow.up',
      trailing: { type: 'chevron' },
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
      id: 'household',
      label: 'Uso compartido del hogar',
      icon: 'person.fill',
      trailing: {
        type: 'switch',
        value: household,
        onChange: (v) => {
          setHousehold(v);
          setHouseholdSharing(v);
        },
      },
    },
  ];

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError(null);
    try {
      // SIGNED_OUT fires through onAuthStateChange: the session clears and the
      // root gate closes to the sign-in screen (user-auth spec: sign out on
      // demand → back to sign-in).
      await signOut();
    } catch {
      // Only a genuine sign-out failure surfaces here (the local session is
      // still intact). An offline/5xx server revoke clears the local session
      // and fires SIGNED_OUT first, so the store treats it as success — the
      // user IS signed out on this device, and a "could not sign out" message
      // would be dead the moment the gate unmounts this screen. The copy is
      // deliberately generic: a raw supabase-js/GoTrue message must never
      // reach the UI (same posture as sign-in and sign-up).
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
            // subtitle={email ?? undefined}
            tier={user.tier}
          />
        ) : null}

        {usage ? <UsageLimitsCard usage={usage} /> : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>CONFIGURACIÓN </Text>
          <AccountSettingsList rows={settings} />
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
    // ...typography.headlineMd,
    fontSize: 20,
    fontWeight: '900',
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
