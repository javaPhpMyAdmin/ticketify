import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { BottomSheet, FieldGroup, Text } from '@/components';
import { colors, radii, spacing, typography } from '@/theme';

export interface RenameItemModalProps {
  /** Whether the sheet is open. Kept mounted so closing animates. */
  visible: boolean;
  /** The current name shown in the input when the modal opens. */
  currentName: string;
  /** True while the parent's write hook is in flight (disables the save button). */
  isLoading: boolean;
  /** Optional parent-provided error to surface inside the field group. */
  errorMessage?: string | null;
  /**
   * Fires on every keystroke. The modal keeps an INTERNAL buffer so the
   * input stays interactive during the parent's async write; the parent
   * reads the latest value through `onSave` only.
   */
  onChange: (next: string) => void;
  /** Closes the modal without saving (cancel button + backdrop + system back). */
  onCancel: () => void;
  /**
   * Save handler — fires with the trimmed, validated name. The parent is
   * expected to call `sanitizeItemName` (or `useRenameItem`'s internal
   * validation) and react to the discriminated result.
   */
  onSave: (value: string) => void;
}

/**
 * Bottom-sheet modal for renaming a purchase item. Shared by the post-scan
 * detail screen (server-persisted via `useRenameItem`) and the review
 * screen (local draft mutation, persisted on CONFIRM).
 *
 * PRESENTATIONAL ONLY: no Supabase, no hooks, no side effects beyond the
 * local TextInput buffer. The parent owns the write — the modal just
 * provides the chrome and a "save" / "cancel" decision. This keeps the
 * same UI available from both flows without duplicating logic.
 *
 * Shares the `BottomSheet` shell: slide-from-bottom modal, `transparent`,
 * backdrop tap-to-close, handle bar, header with kicker + title + close
 * button, body padded to the safe-area bottom. The Android keyboard is
 * handled by the sheet in `listeners` mode (a transparent `Modal` never
 * receives `adjustResize`), leaving the input-focused logic (autoFocus,
 * buffer reseed on open) here.
 */
export function RenameItemModal({
  visible,
  currentName,
  isLoading,
  errorMessage,
  onChange,
  onCancel,
  onSave,
}: RenameItemModalProps) {
  // PR 3 (`app-i18n`): modal chrome (kicker, title, field label, helper,
  // button labels, a11y) reads from the `analytics` namespace; the
  // input value is user-data.
  const { t } = useTranslation(['analytics', 'common']);
  // The input keeps its own buffer so the parent's async write doesn't
  // yank the user's text out from under them. We sync from `currentName`
  // every time the modal OPENS (not on every prop change) — that way the
  // parent can pass the same `currentName` on every render without
  // fighting the user's in-progress edits.
  const [draft, setDraft] = useState(currentName);

  useEffect(() => {
    if (visible) {
      setDraft(currentName);
    }
  }, [visible, currentName]);

  const trimmed = draft.trim();
  const canSave = trimmed.length > 0 && !isLoading;

  return (
    <BottomSheet
      visible={visible}
      onClose={onCancel}
      kicker={t('analytics:renameKicker')}
      title={t('analytics:renameTitle')}
      backdropColor="rgba(0, 0, 0, 0.5)"
      keyboardMode="listeners"
      scrollable
      divider
      contentContainerStyle={styles.body}
    >
      <FieldGroup
        label={t('analytics:renameFieldLabel')}
        error={errorMessage ?? undefined}
      >
        <TextInput
          value={draft}
          onChangeText={(next) => {
            setDraft(next);
            onChange(next);
          }}
          style={styles.input}
          placeholder={t('analytics:renamePlaceholder')}
          placeholderTextColor={colors.textSecondary}
          keyboardType="default"
          autoFocus
          maxLength={120}
          editable={!isLoading}
          accessibilityLabel={t('analytics:renameFieldLabel')}
        />
      </FieldGroup>
      <Text style={styles.helper}>
        {t('analytics:renameHelper')}
      </Text>
      <View style={styles.actions}>
        <Pressable
          onPress={onCancel}
          disabled={isLoading}
          style={({ pressed }) => [
            styles.actionButton,
            styles.cancelButton,
            pressed && styles.actionPressed,
            isLoading && styles.actionDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel={t('common:cancel')}
        >
          <Text style={styles.cancelLabel}>{t('common:cancel')}</Text>
        </Pressable>
        <Pressable
          onPress={() => onSave(trimmed)}
          disabled={!canSave}
          style={({ pressed }) => [
            styles.actionButton,
            styles.saveButton,
            pressed && styles.actionPressed,
            !canSave && styles.actionDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel={t('common:save')}
          accessibilityState={{ disabled: !canSave }}
        >
          <Text style={styles.saveLabel}>
            {isLoading ? t('common:saveLoading') : t('common:save')}
          </Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  input: {
    ...typography.bodyLg,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  helper: {
    ...typography.labelSm,
    color: colors.textSecondary,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  actionButton: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    backgroundColor: colors.chipBg,
  },
  saveButton: {
    backgroundColor: colors.primary,
  },
  actionPressed: {
    opacity: 0.85,
  },
  actionDisabled: {
    opacity: 0.5,
  },
  cancelLabel: {
    ...typography.labelSm,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  saveLabel: {
    ...typography.labelSm,
    color: colors.surface,
    fontWeight: '700',
  },
});
