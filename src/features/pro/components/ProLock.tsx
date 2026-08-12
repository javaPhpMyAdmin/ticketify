/**
 * Lock affordance for Pro-gated content (feature-gating spec).
 *
 * Renders inside `ProRouteGuard` whenever the user is not Pro. The
 * affordance mirrors the existing `EmptyState` pattern so the screen
 * looks intentional rather than broken: a lock icon, a "Función Pro"
 * label, supporting copy, and a primary CTA that pushes the paywall
 * (`/pro`). The CTA is wired through `router.push('/pro')` — the
 * paywall is reachable by anyone, signed-in or not, so free users can
 * self-upgrade in place.
 */
import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import {
  Card,
  Icon,
  Pressable,
  Text,
  View,
  type IconName,
} from '@/components';
import { colors, radii, spacing } from '@/theme';

export interface ProLockProps {
  /** SF Symbol / Material icon shown above the title. Defaults to lock. */
  icon?: IconName;
  /** Headline copy. Defaults to the spec's neutral "Función Pro". */
  title?: string;
  /** Supporting body copy explaining what unlocks the feature. */
  body?: string;
  /** CTA label. Defaults to "Conocer Pro". */
  actionLabel?: string;
}

/**
 * Centered lock affordance: icon in a tinted circle, title, body, and
 * a primary CTA that navigates to the paywall. Used by `ProRouteGuard`
 * and any screen that wants to surface a Pro-only feature behind a
 * visible lock (export row, charts entry, analytics price-alert banner).
 */
export function ProLock({
  icon = 'lock.fill',
  title = 'Función Pro',
  body = 'Suscribite para desbloquear esta función.',
  actionLabel = 'Conocer Pro',
}: ProLockProps) {
  return (
    <Card style={styles.card}>
      <View style={styles.content}>
        <View style={styles.iconCircle}>
          <Icon name={icon} size={32} color={colors.primary} />
        </View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
        <Pressable
          onPress={() => router.push('/pro')}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
        >
          <Text style={styles.actionText}>{actionLabel}</Text>
        </Pressable>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    marginHorizontal: spacing.xl,
    marginVertical: spacing.lg,
  },
  content: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.lg,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: radii.full,
    backgroundColor: colors.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  action: {
    marginTop: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  actionPressed: {
    transform: [{ scale: 0.98 }],
  },
  actionText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.onPrimary,
  },
});
