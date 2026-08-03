import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { Card, Divider, Icon, Pressable, ProfileHeader, Spinner, Text, View } from '@/components';
import {
  AccountSettingsList,
  UsageLimitsCard,
  useProfile,
  type AccountSettingRow,
} from '@/features/profile';
import { useSessionStore } from '@/features/auth';
import { authenticatedSwitchAction } from '@/lib/auth/mode-switch';
import { useSettingsStore } from '@/stores/use-settings-store';
import { colors, radii, spacing, typography } from '@/theme';

interface ModeRow {
  id: 'demo' | 'authenticated';
  label: string;
  caption: string;
  icon: 'sparkles' | 'person.fill';
  active: boolean;
  onPress: () => void;
}

export default function ProfileScreen() {
  const { user, usage, setHouseholdSharing } = useProfile();
  const currency = useSettingsStore((s) => s.currency);
  const household = useSettingsStore((s) => s.household_sharing);
  const setHousehold = useSettingsStore((s) => s.setHouseholdSharing);
  const mode = useSettingsStore((s) => s.mode);
  const setMode = useSettingsStore((s) => s.setMode);
  const session = useSessionStore((s) => s.session);
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

  // Mode switch rows (demo-mode spec, ADR-4). Demo is always reachable and
  // swaps the data source to fixtures; Authenticated promotes the mode when a
  // session exists and presents the sign-in flow when it does not (the mode
  // stays 'demo' in that case, so back returns to the fixture app).
  const modeRows: ModeRow[] = [
    {
      id: 'demo',
      label: 'Demo Mode',
      caption: 'Browse with sample data, no account needed',
      icon: 'sparkles',
      active: mode === 'demo',
      onPress: () => setMode('demo'),
    },
    {
      id: 'authenticated',
      label: 'Authenticated',
      caption: session?.user.email
        ? `Signed in as ${session.user.email}`
        : 'Sign in to use your account',
      icon: 'person.fill',
      active: mode === 'authenticated',
      onPress: () => {
        if (authenticatedSwitchAction(session != null) === 'promote') {
          setMode('authenticated');
        } else {
          router.push('/sign-in');
        }
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
      // Only a genuine sign-out failure surfaces here (the local session is
      // still intact). An offline/5xx server revoke clears the local session
      // and fires SIGNED_OUT first, so the store treats it as success — the
      // user IS signed out on this device, and a "could not sign out" message
      // would be dead the moment the gate unmounts this screen.
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

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Data Source</Text>
          <Card padding={spacing.xs}>
            {modeRows.map((row, idx) => (
              <View key={row.id}>
                <Pressable
                  style={styles.modeRow}
                  onPress={row.onPress}
                  accessibilityRole="button"
                  accessibilityLabel={row.label}
                  accessibilityState={{ selected: row.active }}
                >
                  <View style={styles.iconBubble}>
                    <Icon name={row.icon} size={18} color={colors.textPrimary} />
                  </View>
                  <View style={styles.modeRowBody}>
                    <Text style={styles.modeRowLabel}>{row.label}</Text>
                    <Text style={styles.modeRowCaption} numberOfLines={1}>
                      {row.caption}
                    </Text>
                  </View>
                  {row.active ? (
                    <Icon name="checkmark" size={18} color={colors.primary} />
                  ) : null}
                </Pressable>
                {idx < modeRows.length - 1 ? <Divider /> : null}
              </View>
            ))}
          </Card>
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
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    gap: spacing.md,
  },
  iconBubble: {
    width: 32,
    height: 32,
    borderRadius: radii.DEFAULT,
    backgroundColor: colors.chipBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeRowBody: {
    flex: 1,
    gap: 2,
  },
  modeRowLabel: {
    ...typography.bodyLg,
    color: colors.textPrimary,
  },
  modeRowCaption: {
    ...typography.bodyMd,
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
