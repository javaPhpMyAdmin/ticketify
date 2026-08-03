import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Pressable, ProfileHeader, Spinner, Text, View } from '@/components';
import {
  AccountSettingsList,
  UsageLimitsCard,
  useProfile,
  type AccountSettingRow,
} from '@/features/profile';
import { useSessionStore } from '@/features/auth';
import { useSettingsStore } from '@/stores/use-settings-store';
import { colors, spacing, typography } from '@/theme';

export default function ProfileScreen() {
  const { user, usage, setHouseholdSharing } = useProfile();
  const currency = useSettingsStore((s) => s.currency);
  const household = useSettingsStore((s) => s.household_sharing);
  const setHousehold = useSettingsStore((s) => s.setHouseholdSharing);
  const mode = useSettingsStore((s) => s.mode);
  const signOut = useSessionStore((s) => s.signOut);

  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const settings: AccountSettingRow[] = [
    { id: 'export', label: 'Export Data', icon: 'square.and.arrow.up', trailing: { type: 'chevron' } },
    { id: 'currency', label: 'Currency', value: `${currency}`, icon: 'creditcard', trailing: { type: 'chevron' } },
    {
      id: 'household',
      label: 'Household Sharing',
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
      // SIGNED_OUT fires through onAuthStateChange: the session clears, the
      // mode stays 'authenticated', and the root gate closes to the sign-in
      // screen (user-auth spec: sign out on demand → back to sign-in).
      await signOut();
    } catch (err) {
      setSignOutError(
        err instanceof Error ? err.message : 'Could not sign out. Please try again.',
      );
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        {user ? (
          <ProfileHeader name={user.full_name ?? 'You'} tier={user.tier} />
        ) : null}

        {usage ? <UsageLimitsCard usage={usage} /> : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account Settings</Text>
          <AccountSettingsList rows={settings} />
        </View>

        {mode === 'authenticated' ? (
          <View style={styles.section}>
            {signOutError ? <Text style={styles.error}>{signOutError}</Text> : null}
            <Pressable
              style={styles.signOutButton}
              onPress={handleSignOut}
              disabled={signingOut}
              accessibilityRole="button"
              accessibilityLabel="Sign out"
            >
              {signingOut ? (
                <Spinner size="sm" color={colors.danger} />
              ) : (
                <Text style={styles.signOutText}>Sign Out</Text>
              )}
            </Pressable>
          </View>
        ) : null}
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
    ...typography.headlineMd,
    color: colors.textPrimary,
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
