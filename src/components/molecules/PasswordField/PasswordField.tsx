import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  StyleSheet,
  TextInput,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { Icon, Pressable, View } from '@/components/atoms';
import { colors, radii, spacing, typography } from '@/theme';

export interface PasswordFieldProps {
  /** Controlled value. */
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  /** Translated error text — when set, the field border mirrors it in the
   *  danger color (the message itself is rendered by the caller's
   *  FieldGroup). */
  error?: string;
  /** Blur pass-through so screens can wire blur validation. */
  onBlur?: () => void;
  onSubmitEditing?: () => void;
  returnKeyType?: TextInputProps['returnKeyType'];
  /** Passed straight to the TextInput. */
  autoComplete?: TextInputProps['autoComplete'];
  /** Passed straight to the TextInput (defaults to the platform's `none`
   *  when omitted). */
  textContentType?: TextInputProps['textContentType'];
  accessibilityLabel?: string;
  testID?: string;
  editable?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Boxed password input with an inline visibility toggle (eye / eye.slash),
 * shared by the sign-in and sign-up forms so the toggle state and
 * `secureTextEntry` wiring live in ONE place. The label and helper/error
 * text belong to the caller's FieldGroup; this field only mirrors the
 * error state onto its border (danger), matching the screens' error
 * visuals. The toggle is a real button with the localized
 * show/hide-password a11y label; the input stays editable so autofill
 * keeps working while the value is revealed.
 */
export function PasswordField({
  value,
  onChangeText,
  placeholder,
  error,
  onBlur,
  onSubmitEditing,
  returnKeyType,
  autoComplete,
  textContentType,
  accessibilityLabel,
  testID,
  editable,
  style,
}: PasswordFieldProps) {
  const { t } = useTranslation(['auth']);
  const [visible, setVisible] = useState(false);

  return (
    <View style={[styles.box, error ? styles.boxError : null, style]}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textSecondary}
        secureTextEntry={!visible}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete={autoComplete}
        textContentType={textContentType}
        editable={editable}
        onBlur={onBlur}
        onSubmitEditing={onSubmitEditing}
        returnKeyType={returnKeyType}
        accessibilityLabel={accessibilityLabel}
        testID={testID}
        style={styles.input}
      />
      <Pressable
        onPress={() => setVisible((wasVisible) => !wasVisible)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={
          visible ? t('auth:hidePassword') : t('auth:showPassword')
        }
        style={styles.toggle}
      >
        <Icon
          name={visible ? 'eye.slash' : 'eye'}
          size={20}
          color={colors.textSecondary}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    boxShadow: '1px 2px 6px rgba(0, 0, 0, 0.3)',
  },
  boxError: {
    borderColor: colors.danger,
  },
  input: {
    ...typography.bodyMd,
    color: colors.textPrimary,
    flex: 1,
    paddingLeft: spacing.md,
    paddingVertical: spacing.md,
  },
  toggle: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
});