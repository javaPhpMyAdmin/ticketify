import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

import { Text, View } from '@/components/atoms';
import { Card } from '@/components/molecules/Card';
import { Chip } from '@/components/molecules/Chip';
import { colors, spacing, typography } from '@/theme';

export interface ProfileHeaderProps {
  name: string;
  /** First letter shown in the avatar bubble when `avatarUrl` is absent. */
  initial?: string;
  /** Optional remote image URL. */
  avatarUrl?: string | null;
  /** Optional line under the name, e.g. the auth email address. */
  subtitle?: string;
  /**
   * Access tier. Drives the localized chip label. Omit it to render no chip
   * at all — the profile screen omits it while the RevenueCat entitlement is
   * still resolving, so a Pro user never sees a momentary "free" chip.
   */
  tier?: 'free' | 'pro';
}

/**
 * The user card on the profile screen. Renders the avatar (remote image when
 * `avatarUrl` is present, otherwise the initial), display name, optional
 * subtitle, and the tier chip. If the remote image fails to load, it falls
 * back to the initial-letter bubble so the avatar is never an empty circle.
 *
 * The chip label is resolved HERE, from the `settings` catalog, rather than
 * accepted as a `tierLabel` prop. A label prop is a localization hole: the
 * profile screen passed `undefined` and this component filled the gap with a
 * hardcoded `"Plan Gratuito"`, so an English user saw Spanish on the one card
 * that states what they are paying for. Deriving it from the catalog means
 * there is no value a caller can supply that skips translation.
 */
export function ProfileHeader({
  name,
  initial,
  avatarUrl,
  subtitle,
  tier,
}: ProfileHeaderProps) {
  // The namespace must be an ARRAY. `useTranslation('settings')` with a single
  // string puts `settings` in the default namespace, which would make the
  // namespace-prefixed keys below fail to resolve against the typed resources.
  const { t } = useTranslation(['settings']);
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
          {/* Post-cutover (0039) there is no `frozen` state — the gate is
              binary, so the two keys below are the whole chip vocabulary.
              The chip is omitted entirely when `tier` is undefined (the
              profile screen hides it until the entitlement resolves). */}
          {tier ? (
            <Chip
              label={t(tier === 'free' ? 'settings:proPlan' : 'settings:proActive')}
            />
          ) : null}
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
