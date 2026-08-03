import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProfileHeader, Text, View } from '@/components';
import {
  AccountSettingsList,
  UsageLimitsCard,
  useProfile,
  type AccountSettingRow,
} from '@/features/profile';
import { useSettingsStore } from '@/stores/use-settings-store';
import { colors, spacing, typography } from '@/theme';

export default function ProfileScreen() {
  const { user, usage, setHouseholdSharing } = useProfile();
  const currency = useSettingsStore((s) => s.currency);
  const household = useSettingsStore((s) => s.household_sharing);
  const setHousehold = useSettingsStore((s) => s.setHouseholdSharing);

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
});
