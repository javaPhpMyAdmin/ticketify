import { StyleSheet } from 'react-native';

import {
  Icon,
  Pressable,
  Text,
  View,
  type IconName,
} from '@/components/atoms';
import { Card } from '@/components/molecules/Card';
import { colors, radii, spacing, typography } from '@/theme';

export interface EmptyStateProps {
  /** Optional SF Symbol / Material icon above the title. */
  icon?: IconName;
  title: string;
  /** Optional supporting copy under the title. */
  body?: string;
  /** When set (with `onAction`), renders a primary action button. */
  actionLabel?: string;
  onAction?: () => void;
  /** Wrap the state in a framed `Card` (e.g. inside scroll sections). */
  framed?: boolean;
}

/**
 * Centered empty / error state: icon, title, optional body and an
 * optional primary action. Used wherever a section has no data (so a
 * blank area is never rendered) or a read failed (so the user never
 * sees a false "no data" message). Themed entirely through tokens.
 */
export function EmptyState({
  icon,
  title,
  body,
  actionLabel,
  onAction,
  framed = false,
}: EmptyStateProps) {
  const content = (
    <View style={styles.content}>
      {icon ? (
        <View style={styles.iconCircle}>
          <Icon name={icon} size={30} color={colors.textSecondary} />
        </View>
      ) : null}
      <Text style={styles.title}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          style={({ pressed }) => [
            styles.action,
            pressed && styles.actionPressed,
          ]}
        >
          <Text style={styles.actionText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );

  return framed ? <Card style={styles.framedCard}>{content}</Card> : content;
}

const styles = StyleSheet.create({
  content: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.lg,
  },
  framedCard: {
    alignItems: 'center',
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: radii.full,
    backgroundColor: colors.chipBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...typography.headlineMd,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  body: {
    ...typography.bodyMd,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  action: {
    marginTop: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  actionPressed: {
    transform: [{ scale: 0.98 }],
  },
  actionText: {
    ...typography.bodyMd,
    color: colors.onPrimary,
    fontWeight: '700',
  },
});
