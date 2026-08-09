import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';

import { Card, Chip, Text, View } from '@/components';
import { colors, spacing, typography } from '@/theme';

export interface ProfileHeaderProps {
  name: string;
  /** First letter shown in the avatar bubble when `avatarUrl` is absent. */
  initial?: string;
  /** Optional remote image URL. */
  avatarUrl?: string | null;
  /** Optional line under the name, e.g. the auth email address. */
  subtitle?: string;
  /** Tier label. 'free' -> "Free Tier", 'pro' -> "Pro Tier". */
  tier: 'free' | 'pro';
}

/**
 * The user card on the profile screen. Renders the avatar (remote image when
 * `avatarUrl` is present, otherwise the initial), display name, optional
 * subtitle, and the tier chip. If the remote image fails to load, it falls
 * back to the initial-letter bubble so the avatar is never an empty circle.
 */
export function ProfileHeader({
  name,
  initial,
  avatarUrl,
  subtitle,
  tier,
}: ProfileHeaderProps) {
  const avatarText = (initial ?? name?.[0] ?? '?').toUpperCase();
  const [avatarFailed, setAvatarFailed] = useState(false);
  // A new avatar URL means a fresh load: reset the failure flag so the image
  // gets a chance to render (and a failed URL does not stick permanently).
  useEffect(() => setAvatarFailed(false), [avatarUrl]);
  return (
    <Card style={{ backgroundColor: colors.surface }}>
      <View style={styles.row}>
        <View style={styles.avatar}>
          {avatarUrl && !avatarFailed ? (
            <Image
              source={{ uri: avatarUrl }}
              style={styles.avatarImage}
              contentFit="cover"
              accessible={false}
              onError={() => setAvatarFailed(true)}
            />
          ) : (
            <Text style={styles.avatarText}>{avatarText}</Text>
          )}
        </View>
        <View style={styles.info}>
          <Text style={styles.name}>{name}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          <Chip label={tier === 'free' ? 'Plan Gratuito' : 'Plan Pro'} />
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
    backgroundColor: colors.surface,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  avatarText: {
    ...typography.headlineMd,
    color: colors.primaryDark,
    fontWeight: '700',
    backgroundColor: colors.surface,
  },
  info: {
    flex: 1,
    gap: spacing.xs,
    backgroundColor: colors.surface,
  },
  name: {
    // ...typography.headlineMd,
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.bodyMd,
    color: colors.textSecondary,
    backgroundColor: colors.surface,
  },
});
