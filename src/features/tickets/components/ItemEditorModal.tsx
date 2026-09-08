import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { BottomSheet, FieldGroup, Text } from '@/components';
import { parseQuantity } from '@/features/tickets/manual-form';
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
}

/**
 * Bottom-sheet modal for adding or editing a line item in the manual
 * entry screen.  Shares the `BottomSheet` shell (transparent slide-up
 * `Modal`, handle bar, header with kicker/title + close, safe-area body).
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
 *
 * Keyboard: `keyboardMode="listeners"` on the sheet measures the REAL
 * keyboard height (a transparent Modal never receives `adjustResize`)
 * and pads the scrollable body with `keyboardHeight + spacing.lg` — the
 * exact formula the pre-BottomSheet version applied manually, now owned
 * by the shell.  The buffer reseed below still runs ONLY on the `visible`
 * flip, never on a parent re-render.
 */
export function ItemEditorModal({
  visible,
  initialValues,
  onSave,
  onClose,
}: ItemEditorModalProps) {
  const [name, setName] = useState(initialValues?.name ?? '');
  const [quantityStr, setQuantityStr] = useState(
    initialValues != null ? String(initialValues.quantity) : '1',
  );
  const [priceStr, setPriceStr] = useState(
    initialValues != null ? String(initialValues.unit_price) : '',
  );

  // Latch the latest initialValues into a ref so the seed effect can depend
  // ONLY on `visible`. The parent passes an inline object for initialValues,
  // which changes identity on every parent render — depending on it directly
  // would re-seed (wiping user input) on any re-render while the sheet is
  // open (4R reliability fix).
  const initialRef = useRef(initialValues);
  useEffect(() => {
    initialRef.current = initialValues;
  });

  // Re-seed the internal buffers only when the sheet opens (visible flips
  // false → true), never on a parent re-render while it stays open.
  useEffect(() => {
    if (!visible) return;
    const initial = initialRef.current;
    setName(initial?.name ?? '');
    setQuantityStr(initial != null ? String(initial.quantity) : '1');
    setPriceStr(initial != null ? String(initial.unit_price) : '');
  }, [visible]);

  const trimmed = name.trim();
  const quantity = parseQuantity(quantityStr);
  const unit_price = parseFloat(priceStr);
  const canSave =
    trimmed.length > 0 &&
    quantity !== null &&
    Number.isFinite(unit_price) &&
    unit_price >= 0;

  const handleSave = () => {
    if (!canSave || quantity === null) return;
    onSave({ name: trimmed, quantity, unit_price });
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      kicker="AGREGAR ARTÍCULO"
      title={initialValues ? 'Editar artículo' : 'Nuevo artículo'}
      backdropColor="rgba(0, 0, 0, 0.5)"
      keyboardMode="listeners"
      scrollable
      divider
      contentContainerStyle={styles.body}
    >
      <FieldGroup label="Nombre del producto">
        <TextInput
          value={name}
          onChangeText={setName}
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
            onChangeText={setQuantityStr}
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
            value={priceStr}
            onChangeText={setPriceStr}
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