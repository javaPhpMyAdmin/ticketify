import { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
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

export interface ItemEditorModalProps {
  /** Whether the sheet is open. Kept mounted so closing animates. */
  visible: boolean;
  /** Pre-populated values for editing an existing item (null = adding). */
  initialValues: {
    name: string;
    quantity: number;
    unit_price: number;
  } | null;
  /** Called when the user taps save with validated values. */
  onSave: (values: { name: string; quantity: number; unit_price: number }) => void;
  /** Called when the user dismisses without saving. */
  onClose: () => void;
  /** Optional error message surfaced in the name field. */
  errorMessage?: string | null;
  /** Reset the error when user changes values. */
  onClearError?: () => void;
}

/**
 * Bottom-sheet modal for adding or editing a line item in the manual
 * entry screen.  Follows the RenameItemModal / CategoryPickerModal
 * pattern: transparent RN `Modal`, slide-from-bottom, handle bar,
 * safe-area body.
 *
 * Three inputs: name (TextInput, autoFocus), quantity (number input),
 * unit_price (number input).  The save button is disabled when the
 * trimmed name is empty or either number is not a valid positive
 * integer/float (quantity must be an integer > 0; price >= 0).
 *
 * OWN STATE ONLY: the parent owns the save — the modal holds its
 * internal text buffers so user input never gets yanked during an
 * async handler (even though the parent saves synchronously, the
 * pattern stays consistent with RenameItemModal).
 */
export function ItemEditorModal({
  visible,
  initialValues,
  onSave,
  onClose,
  errorMessage,
  onClearError,
}: ItemEditorModalProps) {
  const [name, setName] = useState(initialValues?.name ?? '');
  const [quantityStr, setQuantityStr] = useState(
    initialValues != null ? String(initialValues.quantity) : '1',
  );
  const [priceStr, setPriceStr] = useState(
    initialValues != null ? String(initialValues.unit_price) : '',
  );
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const priceRef = useRef<TextInput>(null);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // Re-seed internal buffers when the modal opens (same as RenameItemModal).
  useEffect(() => {
    if (!visible) return;
    setName(initialValues?.name ?? '');
    setQuantityStr(initialValues != null ? String(initialValues.quantity) : '1');
    setPriceStr(initialValues != null ? String(initialValues.unit_price) : '');
    onClearError?.();
  }, [visible, initialValues, onClearError]);

  const trimmed = name.trim();
  const quantity = parseInt(quantityStr, 10);
  const unit_price = parseFloat(priceStr);
  const canSave =
    trimmed.length > 0 &&
    Number.isInteger(quantity) &&
    quantity > 0 &&
    Number.isFinite(unit_price) &&
    unit_price >= 0;

  const handleSave = () => {
    if (!canSave) return;
    onSave({ name: trimmed, quantity, unit_price });
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Cerrar"
        />
        <SafeAreaView style={styles.sheet} edges={['bottom']}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.kicker}>AGREGAR ARTÍCULO</Text>
              <Text style={styles.title}>
                {initialValues ? 'Editar artículo' : 'Nuevo artículo'}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Cerrar"
              style={styles.closeButton}
            >
              <Icon name="xmark" size={22} color={colors.textPrimary} />
            </Pressable>
          </View>
          <Divider />
          <ScrollView
            style={styles.scrollBody}
            contentContainerStyle={[
              styles.body,
              { paddingBottom: keyboardHeight + spacing.lg },
            ]}
            keyboardShouldPersistTaps="handled"
          >
            <FieldGroup label="Nombre del producto" error={errorMessage ?? undefined}>
              <TextInput
                value={name}
                onChangeText={(next) => {
                  setName(next);
                  onClearError?.();
                }}
                style={styles.input}
                placeholder="Ej. Café con leche"
                placeholderTextColor={colors.textSecondary}
                keyboardType="default"
                autoFocus
                maxLength={120}
                accessibilityLabel="Nombre del producto"
              />
            </FieldGroup>
            <View style={styles.row}>
              <FieldGroup label="Cantidad" style={{ flex: 1 }}>
                <TextInput
                  value={quantityStr}
                  onChangeText={(next) => {
                    setQuantityStr(next);
                    onClearError?.();
                  }}
                  style={styles.input}
                  placeholder="1"
                  placeholderTextColor={colors.textSecondary}
                  keyboardType="number-pad"
                  accessibilityLabel="Cantidad"
                />
              </FieldGroup>
              <View style={{ width: spacing.md }} />
              <FieldGroup label="Precio unitario" style={{ flex: 1 }}>
                <TextInput
                  ref={priceRef}
                  value={priceStr}
                  onChangeText={(next) => {
                    setPriceStr(next);
                    onClearError?.();
                  }}
                  style={styles.input}
                  placeholder="0.00"
                  placeholderTextColor={colors.textSecondary}
                  keyboardType="decimal-pad"
                  accessibilityLabel="Precio unitario"
                />
              </FieldGroup>
            </View>
            <Text style={styles.helper}>
              El precio se calcula como cantidad × precio unitario
            </Text>
            <View style={styles.actions}>
              <Pressable
                onPress={onClose}
                style={({ pressed }) => [
                  styles.actionButton,
                  styles.cancelButton,
                  pressed && styles.actionPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Cancelar"
              >
                <Text style={styles.cancelLabel}>Cancelar</Text>
              </Pressable>
              <Pressable
                onPress={handleSave}
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
                <Text style={styles.saveLabel}>Agregar</Text>
              </Pressable>
            </View>
          </ScrollView>
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
  scrollBody: {
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
  row: {
    flexDirection: 'row',
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