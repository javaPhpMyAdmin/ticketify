import { useState } from 'react';
import { StyleSheet, TextInput } from 'react-native';

import { Pressable, Text, View } from '@/components/atoms';
import { Card } from '@/components/molecules/Card';
import { colors, radii, spacing, typography } from '@/theme';

import { matchesTypedConfirmation } from './lib/match';
import type { TypedConfirmationProps } from './types';

/**
 * TypedConfirmation — destructive-flow confirmation that requires the user
 * to type an exact string (e.g. `'ELIMINAR'`) before the primary action
 * enables. Standalone organism (NOT a slot on `useDialogStore`) because
 * the dialog store's API doesn't model a controlled TextInput and the
 * danger-toned text field outline would require a new `DialogOptions`
 * field that would leak into every dialog call site.
 *
 * Match rule: `matchesTypedConfirmation(value, prompt)` — see
 * `./lib/match.ts`. The primary button is disabled unless the typed value
 * matches case-insensitive trimmed AND the parent hasn't forced-disable
 * it (e.g. during an in-flight request).
 *
 * Accessibility:
 * - TextInput `accessibilityLabel` describes the irreversible nature so
 *   VoiceOver / TalkBack announce the consequence of the input.
 * - Primary button receives a tone-styled label; `accessibilityRole="button"`
 *   is the default for `Pressable`.
 */
export function TypedConfirmation({
  title,
  body,
  typedPrompt,
  typedValue,
  onTypedValueChange,
  primaryLabel,
  onPrimary,
  primaryDisabled = false,
  tone = 'danger',
  secondaryLabel,
  onSecondary,
  inputAccessibilityLabel,
  inputHint,
}: TypedConfirmationProps) {
  // Track focus so the TextInput outline paints with the tone color while
  // the user is engaged. The static rest state keeps the neutral border
  // to avoid screaming "danger" on every paint.
  const [focused, setFocused] = useState(false);

  const matches = matchesTypedConfirmation(typedValue, typedPrompt);
  const disabled = primaryDisabled || !matches;
  const dangerTone = tone === 'danger';

  return (
    <Card
      padding={spacing.lg}
      style={[
        styles.card,
        dangerTone && styles.cardDanger,
      ]}
    >
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>

      <View style={styles.inputGroup}>
        <TextInput
          value={typedValue}
          onChangeText={onTypedValueChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoCapitalize="characters"
          // Disable autocorrect — the typedPrompt is a specific word in
          // CAPS (e.g. ELIMINAR), autocorrect would mangle it.
          autoCorrect={false}
          spellCheck={false}
          // The user must type the exact prompt; spellcheck would surface
          // red underlines on the exact-match word.
          placeholder={typedPrompt}
          placeholderTextColor={colors.textSecondary}
          editable={!primaryDisabled}
          accessibilityLabel={
            inputAccessibilityLabel ??
            `Escribí ${typedPrompt} para confirmar la acción irreversible.`
          }
          style={[
            styles.input,
            dangerTone && styles.inputDanger,
            focused && dangerTone && styles.inputDangerFocused,
          ]}
        />
        {inputHint ? (
          <Text style={styles.inputHint}>{inputHint}</Text>
        ) : null}
      </View>

      <Pressable
        onPress={onPrimary}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        accessibilityLabel={`${primaryLabel} — acción irreversible`}
        style={({ pressed }) => [
          styles.primary,
          dangerTone ? styles.primaryDanger : styles.primaryDefault,
          disabled && styles.primaryDisabled,
          pressed && !disabled && styles.primaryPressed,
        ]}
      >
        <Text
          style={[
            styles.primaryText,
            dangerTone ? styles.primaryTextDanger : styles.primaryTextDefault,
            disabled && styles.primaryTextDisabled,
          ]}
        >
          {primaryLabel}
        </Text>
      </Pressable>

      {secondaryLabel && onSecondary ? (
        <Pressable
          onPress={onSecondary}
          accessibilityRole="button"
          accessibilityLabel={secondaryLabel}
          style={({ pressed }) => [
            styles.secondary,
            pressed && styles.secondaryPressed,
          ]}
        >
          <Text style={styles.secondaryText}>{secondaryLabel}</Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
  },
  cardDanger: {
    borderColor: colors.danger,
  },
  title: {
    ...typography.headlineMd,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  body: {
    ...typography.bodyMd,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  inputGroup: {
    gap: spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  inputDanger: {
    borderColor: colors.danger,
  },
  inputDangerFocused: {
    borderWidth: 2,
    paddingHorizontal: spacing.md - 1, // keep the visible width steady
  },
  inputHint: {
    ...typography.labelSm,
    color: colors.textSecondary,
  },
  primary: {
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  primaryDefault: {
    backgroundColor: colors.primary,
  },
  primaryDanger: {
    backgroundColor: colors.danger,
  },
  primaryDisabled: {
    backgroundColor: colors.divider,
  },
  primaryPressed: {
    opacity: 0.85,
  },
  primaryText: {
    ...typography.labelSm,
    fontWeight: '700',
    fontSize: 15,
  },
  primaryTextDefault: {
    color: colors.onPrimary,
  },
  primaryTextDanger: {
    color: colors.onDanger,
  },
  primaryTextDisabled: {
    color: colors.textSecondary,
  },
  secondary: {
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryPressed: {
    opacity: 0.7,
  },
  secondaryText: {
    ...typography.labelSm,
    color: colors.textSecondary,
    fontWeight: '600',
    fontSize: 15,
  },
});
