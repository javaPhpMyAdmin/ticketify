import { StyleSheet } from 'react-native';

import { Card, Chip, Text, View } from '@/components';
import { colors, spacing, typography } from '@/theme';

export interface ProfileHeaderProps {
  name: string;
  /** First letter shown in the avatar bubble when `avatarUrl` is absent. */
  initial?: string;
  /** Optional remote image URL. */
  avatarUrl?: string | null;
  /** Tier label. 'free' -> "Free Tier", 'pro' -> "Pro Tier". */
  tier: 'free' | 'pro';
}

/**
 * The user card on the profile screen. Renders the avatar bubble,
 * display name, and the tier chip.
 */
export function ProfileHeader({ name, initial, avatarUrl, tier }: ProfileHeaderProps) {
  const avatarText = (initial ?? name?.[0] ?? '?').toUpperCase();
  return (
    <Card>
      <View style={styles.row}>
        <View style={styles.avatar}>
          {/* The avatar intentionally renders an initial; a real image
              loader will replace this once `avatarUrl` is wired up. */}
          {avatarUrl ? null : <Text style={styles.avatarText}>{avatarText}</Text>}
        </View>
        <View style={styles.info}>
          <Text style={styles.name}>{name}</Text>
          <Chip label={tier === 'free' ? 'Free Tier' : 'Pro Tier'} />
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    ...typography.headlineMd,
    color: colors.primaryDark,
    fontWeight: '700',
  },
  info: {
    flex: 1,
    gap: spacing.xs,
  },
  name: {
    ...typography.headlineMd,
    color: colors.textPrimary,
  },
});
