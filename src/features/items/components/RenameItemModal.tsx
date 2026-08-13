import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Divider, FieldGroup, Icon, Text } from '@/components';
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
 * Visual chrome matches `SnacksBreakdownModal`: slide-from-bottom modal,
 * `transparent`, backdrop tap-to-close, handle bar, header with kicker
 * + title + close button, body padded to the safe-area bottom.
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
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="Cerrar"
        />
        <SafeAreaView style={styles.sheet} edges={['bottom']}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.kicker}>EDITAR</Text>
              <Text style={styles.title}>Editar nombre del producto</Text>
            </View>
            <Pressable
              onPress={onCancel}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Cerrar"
              style={styles.closeButton}
            >
              <Icon name="xmark" size={22} color={colors.textPrimary} />
            </Pressable>
          </View>
          <Divider />
          {/* `KeyboardAvoidingView` lifts the input above the keyboard. On
              iOS the system modal is its own window, so `padding` adds bottom
              space. On Android we also use `padding`: the activity's
              `windowSoftInputMode` does not reliably resize a transparent
              `Modal`, so leaving `behavior` undefined leaves the keyboard
              covering the input. The sheet's `maxHeight` + `flexShrink: 1`
              here lets the content compress instead of overflowing. */}
          <KeyboardAvoidingView
            style={styles.keyboardAvoidingWrapper}
            behavior="padding"
          >
            <ScrollView
              contentContainerStyle={styles.body}
              keyboardShouldPersistTaps="handled"
            >
              <FieldGroup label="Nombre del producto" error={errorMessage ?? undefined}>
                <TextInput
                  value={draft}
                  onChangeText={(next) => {
                    setDraft(next);
                    onChange(next);
                  }}
                  style={styles.input}
                  placeholder="Ej. Café con leche"
                  placeholderTextColor={colors.textSecondary}
                  keyboardType="default"
                  autoFocus
                  maxLength={120}
                  editable={!isLoading}
                  accessibilityLabel="Nombre del producto"
                />
              </FieldGroup>
              <Text style={styles.helper}>
                El buscador ignora acentos.
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
                  accessibilityLabel="Cancelar"
                >
                  <Text style={styles.cancelLabel}>Cancelar</Text>
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
                  accessibilityLabel="Guardar"
                  accessibilityState={{ disabled: !canSave }}
                >
                  <Text style={styles.saveLabel}>
                    {isLoading ? 'Guardando…' : 'Guardar'}
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  // The wrapper must NOT stretch (`flex: 1` / `flexBasis: 0`): the sheet
  // sizes itself by content (only `maxHeight` is set), so a zero-basis
  // flex child collapses to 0 height and hides the body. `flexShrink: 1`
  // keeps content height but lets the sheet compress on small screens or
  // when the iOS keyboard padding makes the body exceed `maxHeight`.
  keyboardAvoidingWrapper: {
    flexShrink: 1,
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    paddingTop: spacing.sm,
    maxHeight: '80%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  kicker: {
    ...typography.labelCaps,
    color: colors.textSecondary,
  },
  title: {
    ...typography.headlineMd,
    color: colors.textPrimary,
  },
  closeButton: {
    padding: spacing.xs,
  },
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
