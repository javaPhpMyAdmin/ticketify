import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { BottomSheet, FieldGroup, Icon, Text } from '@/components';
import { useCategoryCatalog } from '@/features/categories';
import { getExpenseCategory } from '@/features/home/categories';
import { parseQuantity } from '@/features/tickets/manual-form';
import { colors, radii, spacing, typography } from '@/theme';

import {
  categoryAfterDelete,
  pickerRowForCategory,
} from '../category-picker-form';
import { CategoryPickerModal } from './CategoryPickerModal';

/** The values the editor collects: the line fields plus the chosen category
 * (app-level SLUG, or null — "No category chosen → category_id = null"). */
export interface ItemEditorValues {
  name: string;
  quantity: number;
  unit_price: number;
  category_id: string | null;
}

export interface ItemEditorModalProps {
  /** Whether the sheet is open. Kept mounted so closing animates. */
  visible: boolean;
  /** Pre-populated values for editing an existing item (null = adding). */
  initialValues: ItemEditorValues | null;
  /** Called when the user taps save with validated values. */
  onSave: (values: ItemEditorValues) => void;
  /** Called when the user dismisses without saving. */
  onClose: () => void;
  /**
   * PR 5 (category-management): a delete/reassign RESOLVED inside the
   * stacked picker. The editor rebuckets its own buffer AND forwards the
   * resolution so the parent sweeps the WHOLE draft (W1) — every sibling
   * referencing the deleted slug resolves to the same explicit fallback.
   */
  onCategoryDeleted?: (deletedSlug: string, fallbackSlug: string) => void;
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
  onCategoryDeleted,
}: ItemEditorModalProps) {
  const { t } = useTranslation(['tickets', 'a11y', 'common']);
  const { catalog } = useCategoryCatalog();
  const [name, setName] = useState(initialValues?.name ?? '');
  const [quantityStr, setQuantityStr] = useState(
    initialValues != null ? String(initialValues.quantity) : '1',
  );
  const [priceStr, setPriceStr] = useState(
    initialValues != null ? String(initialValues.unit_price) : '',
  );
  // PR 5: the buffered category choice (app-level slug or null). Seeded
  // from initialValues so EDITING an item opens on its current category.
  const [categoryId, setCategoryId] = useState<string | null>(
    initialValues?.category_id ?? null,
  );
  // PR 5 (D6 sheet-on-sheet): the shared picker stacks OVER the editor —
  // its own open state keeps the two sheets independent.
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);

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
    setCategoryId(initial?.category_id ?? null);
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
    onSave({ name: trimmed, quantity, unit_price, category_id: categoryId });
  };

  // The category row label: same consumer pattern as every other chip —
  // custom slugs render their own name via the catalog; the static registry
  // fallback covers the pre-load beat while the catalog is still empty; null
  // (no choice) stays SIN CATEGORÍA, never the 'otros' fallback.
  const categoryRow = categoryId
    ? (pickerRowForCategory(catalog, categoryId) ??
      getExpenseCategory(categoryId))
    : null;
  const categoryLabel =
    categoryRow?.label ?? t('tickets:noCategory');

  // W1: a delete/reassign resolved inside the stacked picker must (1)
  // rebucket THIS editor's buffer if its own selection was deleted, and
  // (2) forward the resolution so the parent sweeps the whole draft.
  // Rebucketing delegates to the shared `categoryAfterDelete` helper.
  const handleForwardDelete = (
    deletedSlug: string,
    fallbackSlug: string,
  ) => {
    setCategoryId((current) =>
      categoryAfterDelete(current, deletedSlug, fallbackSlug),
    );
    onCategoryDeleted?.(deletedSlug, fallbackSlug);
  };

  return (
    <>
      <BottomSheet
        visible={visible}
        onClose={onClose}
        kicker={t('tickets:itemEditorKicker')}
      title={
        initialValues
          ? t('tickets:itemEditorEditTitle')
          : t('tickets:itemEditorNewTitle')
      }
      backdropColor="rgba(0, 0, 0, 0.5)"
      keyboardMode="listeners"
      scrollable
      divider
      contentContainerStyle={styles.body}
    >
      <FieldGroup label={t('tickets:itemNameFieldLabel')}>
        <TextInput
          value={name}
          onChangeText={setName}
          style={styles.input}
          placeholder={t('tickets:itemNamePlaceholder')}
          placeholderTextColor={colors.textSecondary}
          keyboardType="default"
          autoFocus
          maxLength={120}
          accessibilityLabel={t('tickets:itemNameFieldLabel')}
        />
      </FieldGroup>
      <View style={styles.row}>
        <FieldGroup label={t('tickets:itemQuantityLabel')} style={{ flex: 1 }}>
          <TextInput
            value={quantityStr}
            onChangeText={setQuantityStr}
            style={styles.input}
            placeholder="1"
            placeholderTextColor={colors.textSecondary}
            keyboardType="number-pad"
            accessibilityLabel={t('tickets:itemQuantityLabel')}
          />
        </FieldGroup>
        <View style={{ width: spacing.md }} />
        <FieldGroup label={t('tickets:itemUnitPriceLabel')} style={{ flex: 1 }}>
          <TextInput
            value={priceStr}
            onChangeText={setPriceStr}
            style={styles.input}
            placeholder="0.00"
            placeholderTextColor={colors.textSecondary}
            keyboardType="decimal-pad"
            accessibilityLabel={t('tickets:itemUnitPriceLabel')}
          />
        </FieldGroup>
      </View>
      {/* PR 5 (D6): the category row — opens the stacked picker. The
          label resolves through the merged catalog (custom slugs render
          their own name); a null choice renders SIN CATEGORÍA, never the
          'otros' fallback. */}
      <FieldGroup label={t('tickets:categoryPickerTitle')}>
        <Pressable
          onPress={() => setCategoryPickerOpen(true)}
          style={({ pressed }) => [
            styles.categoryRow,
            pressed && styles.categoryRowPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`${t('a11y:categoryOfItem')} ${trimmed || t('tickets:itemNamePlaceholder')}`}
        >
          <Text style={styles.categoryValue}>{categoryLabel}</Text>
          <Icon name="chevron.right" size={16} color={colors.textSecondary} />
        </Pressable>
      </FieldGroup>
      <Text style={styles.helper}>{t('tickets:itemEditorHelper')}</Text>
      <View style={styles.actions}>
        <Pressable
          onPress={onClose}
          style={({ pressed }) => [
            styles.actionButton,
            styles.cancelButton,
            pressed && styles.actionPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={t('common:cancel')}
        >
          <Text style={styles.cancelLabel}>{t('common:cancel')}</Text>
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
          accessibilityLabel={t('common:save')}
          accessibilityState={{ disabled: !canSave }}
        >
          <Text style={styles.saveLabel}>{t('tickets:manualAddItemShort')}</Text>
        </Pressable>
      </View>
    </BottomSheet>

    {/* PR 5 (D6 sheet-on-sheet): the shared picker stacks OVER the editor.
        Both are Modal-backed sheets; the later-mounted picker renders on
        top when its own `visible` flips. It reuses the identical enhanced
        picker the chip path uses — create+assign and delete/reassign are
        one code path. */}
    <CategoryPickerModal
      visible={categoryPickerOpen}
      itemName={trimmed || t('tickets:itemNamePlaceholder')}
      selectedKey={categoryId}
      onSelect={(key) => {
        setCategoryId(key);
        setCategoryPickerOpen(false);
      }}
      onCategoryDeleted={handleForwardDelete}
      onClose={() => setCategoryPickerOpen(false)}
    />
  </>
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
  // PR 5: the category row — a tappable strip that opens the stacked
  // picker; mirrors the date-trigger visual language (label + chevron).
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  categoryRowPressed: {
    opacity: 0.6,
  },
  categoryValue: {
    ...typography.bodyLg,
    color: colors.textPrimary,
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