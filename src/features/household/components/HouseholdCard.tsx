/**
 * Household summary card for the home feed. Shows the household name,
 * total spend for the current month, and member count. Tapping navigates
 * to the household settings screen.
 *
 * Only rendered when the user has a household (household_sharing is on
 * and household_id is set on the profile).
 */
import { StyleSheet } from 'react-native';
import { router } from 'expo-router';

import { Card, Pressable, Text, View } from '@/components';
import { useHouseholdStore } from '@/stores/use-household-store';
import { useSettingsStore } from '@/stores/use-settings-store';
import { formatCurrency } from '@/lib/format';
import { colors, spacing, typography } from '@/theme';

interface HouseholdCardProps {
  /** Total household spend for the current month, or null when loading. */
  householdTotal: number | null;
  /** True while the household total query is loading. */
  isLoading: boolean;
}

export function HouseholdCard({ householdTotal, isLoading }: HouseholdCardProps) {
  const household = useHouseholdStore((s) => s.household);
  const members = useHouseholdStore((s) => s.members);
  const currency = useSettingsStore((s) => s.currency);
  const sharingEnabled = useSettingsStore((s) => s.household_sharing);

  // Don't render if sharing is off or no household exists.
  if (!sharingEnabled || !household) return null;

  const memberCount = members.length;
  const memberLabel =
    memberCount === 1
      ? '1 miembro'
      : memberCount > 0
        ? `${memberCount} miembros`
        : '';

  return (
    <Pressable
      onPress={() => router.push('/settings/household')}
      accessibilityRole="button"
      accessibilityLabel={`Hogar ${household.name}. Tocar para ver detalles.`}
    >
      <Card style={styles.card}>
        <View style={styles.row}>
          <View style={styles.info}>
            <Text style={styles.label}>Gasto del hogar</Text>
            <Text style={styles.name} numberOfLines={1}>
              {household.name}
            </Text>
          </View>
          <View style={styles.amountContainer}>
            {isLoading ? (
              <Text style={styles.amount}>…</Text>
            ) : (
              <Text style={styles.amount}>
                {formatCurrency(householdTotal ?? 0, currency)}
              </Text>
            )}
          </View>
        </View>
        {memberLabel ? (
          <Text style={styles.members}>{memberLabel}</Text>
        ) : null}
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  info: {
    flex: 1,
    gap: 2,
  },
  label: {
    ...typography.labelSm,
    color: colors.textSecondary,
  },
  name: {
    ...typography.bodyMd,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  amountContainer: {
    alignItems: 'flex-end',
  },
  amount: {
    ...typography.headlineMd,
    color: colors.primary,
  },
  members: {
    ...typography.labelSm,
    color: colors.textSecondary,
  },
});
