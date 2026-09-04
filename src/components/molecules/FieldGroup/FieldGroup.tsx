import type { ReactNode } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { Text, View } from '@/components/atoms';
import { colors, spacing, typography } from '@/theme';

export interface FieldGroupProps {
  /** Optional label rendered in the label-caps kicker style. */
  label?: string;
  /** The control — a TextInput, a Switch row, a chip group, etc. */
  children: ReactNode;
  /** Optional helper text rendered below the control. */
  helper?: string;
  /** Optional error text. Overrides `helper` styling to danger. */
  error?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Vertical stack of: optional label (label-caps kicker), the control,
 * and optional helper or error text. Standardises the spacing used in
 * the review screen and any future forms.
 */
export function FieldGroup({ label, children, helper, error, style }: FieldGroupProps) {
  const footer = error ?? helper;
  return (
    <View style={[styles.base, style]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      {children}
      {footer ? (
        <Text style={[styles.helper, error ? styles.error : null]}>{footer}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    gap: spacing.xs,
  },
  label: {
    ...typography.labelCaps,
    color: colors.textSecondary,
  },
  helper: {
    ...typography.labelSm,
    color: colors.textSecondary,
  },
  error: {
    color: colors.danger,
  },
});
