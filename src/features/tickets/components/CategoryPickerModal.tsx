import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, TextInput } from 'react-native';
import { useTranslation } from 'react-i18next';

import { BottomSheet, FieldGroup, Icon, Pressable, Text, View } from '@/components';
import { useSessionUser } from '@/features/auth';
import {
  CATEGORY_ALREADY_EXISTS_MESSAGE,
  useCategoryCatalog,
} from '@/features/categories';
import { colors, radii, spacing, typography } from '@/theme';
import type { CategoryKind } from '@/types';

import {
  CATEGORY_CREATE_DEFAULT_ICON,
  CATEGORY_PALETTE_COLORS,
  MAX_CATEGORY_NAME_LENGTH,
  canDismissCategoryPicker,
  canonicalFallbackRows,
  categoryCollisionSlugs,
  categoryCreateFormError,
  categoryCreateNameFieldError,
  isCurrentCategoryCreateSession,
  pickerRowsFromCatalog,
  seamCreateErrorKey,
  validateCategoryCreateInput,
  type CategoryPickerRow,
} from '../category-picker-form';

export interface CategoryPickerModalProps {
  /** Whether the sheet is open. Kept mounted so closing animates. */
  visible: boolean;
  /** Name of the item being categorized (shown in the title). */
  itemName: string;
  /** Currently selected category key, if any. */
  selectedKey: string | null;
  /** Called with the chosen category key (or 'otros'). */
  onSelect: (categoryKey: string) => void;
  /** Called when the user dismisses the picker. */
  onClose: () => void;
}

/**
 * Category picker for a receipt line item (manual + review screens):
 * a modal bottom sheet listing every category in the user's catalog — the
 * canonical 13 plus their own custom rows, canonical-first — with an
 * inline "create category" form (change `category-management` — PR 3).
 *
 * The list and the create flow consume `useCategoryCatalog` (D3): the
 * grid renders the MERGED catalog through `pickerRowsFromCatalog`
 * (falling back to the static canonical 13 while it loads or after a
 * read failure — no second fetch), and create uses the hook's `create`
 * mutation with `slugify` + `slugCollides` pre-blocking (D4). A created
 * row becomes selectable immediately: the form derives the slug from the
 * name, awaits the mutation (which invalidates the catalog query), then
 * calls `onSelect(slug)`. The 23505 race maps to the SAME friendly copy
 * via the hook's `createError`.
 *
 * The user's tap both confirms the category and closes the sheet — the
 * AI suggestion stays untouched in `ai_suggested_category_id`, the
 * user's choice is written to `category_id`, and the save path prefers
 * the user's choice.
 *
 * Chrome parity notes (kept from the pre-BottomSheet version) mirror the
 * list mode exactly; the create form switches the sheet to `scrollable`
 * + `keyboardMode="listeners"` (the same keyboard handling the shared
 * editor sheets use) so the inputs never fight the transparent Modal.
 */
export function CategoryPickerModal({
  visible,
  itemName,
  selectedKey,
  onSelect,
  onClose,
}: CategoryPickerModalProps) {
  const { t } = useTranslation(['tickets', 'common']);
  const { userId } = useSessionUser();
  const { catalog, create, isCreating, createError } = useCategoryCatalog();

  // Fresh token per dismissal: a create that resolves AFTER the sheet was
  // closed must not select (cancel must cancel — see handleCreate).
  const sessionRef = useRef(0);

  const [mode, setMode] = useState<'list' | 'create'>('list');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CategoryKind | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);

  const resetForm = () => {
    setName('');
    setKind(null);
    setColor(null);
    setAttempted(false);
  };

  // Closing the sheet always lands back on the list with a fresh form,
  // and invalidates any create that is still in flight.
  useEffect(() => {
    if (!visible) {
      setMode('list');
      resetForm();
      sessionRef.current += 1;
    }
  }, [visible]);

  const catalogRows = pickerRowsFromCatalog(catalog);
  // Grid rows: the merged catalog (canonical-first + own). The static
  // canonical 13 keep the grid alive pre-load / read-failure.
  const rows = catalogRows.length > 0 ? catalogRows : canonicalFallbackRows();

  const validation = validateCategoryCreateInput(
    name,
    kind,
    color,
    categoryCollisionSlugs(catalog),
  );
  const collides =
    validation.ok === false && validation.reason === 'slug_collides';
  // Collision blocks the press outright (with live feedback); the other
  // field errors surface when the user attempts to create.
  const canPressCreate =
    name.trim().length > 0 && !collides && !isCreating;

  // Name-field errors: live collision shows while typing regardless of
  // attempt; the other name-family reasons surface on submit.
  const nameErrorKey = categoryCreateNameFieldError(validation, attempted);
  const nameError = nameErrorKey ? t(nameErrorKey) : undefined;

  // Form-level error: gated behind `attempted` so a pristine (reopened,
  // or name-edited) form never shows a STALE createError; the seam copy
  // is always resolved to a localized key, never rendered verbatim.
  const formErrorKey = categoryCreateFormError(
    validation,
    attempted,
    seamCreateErrorKey(createError, CATEGORY_ALREADY_EXISTS_MESSAGE),
  );
  const formError = formErrorKey ? t(formErrorKey) : undefined;

  const handleCreate = async () => {
    setAttempted(true);
    if (!validation.ok || !kind || !color) return;
    // Capture the sheet session: only THIS session may select on success.
    const session = sessionRef.current;
    try {
      await create({
        name: name.trim(),
        kind,
        icon: CATEGORY_CREATE_DEFAULT_ICON,
        color,
      });
      // The selection is optimistic-post-commit — the catalog refetch
      // (invalidateQueries) is fire-and-forget, so the derived slug is
      // what the DB row carries; select it regardless of the refetch.
      // The session guard still drops the selection if the sheet was
      // dismissed while the mutation was in flight — a cancelled create
      // must not categorize the item (spec: created rows become
      // selectable immediately).
      if (isCurrentCategoryCreateSession(session, sessionRef.current)) {
        onSelect(validation.slug);
      }
    } catch {
      // createError surfaced from the hook; stay in the form.
    }
  };

  const openCreate = () => {
    resetForm();
    setMode('create');
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      backdropLabel={t('categoryPickerBackdropA11y')}
      backdropColor="rgba(0, 0, 0, 0.5)"
      surface
      radius="xl"
      maxHeight="70%"
      showCloseButton={false}
      handleStyle={styles.handle}
      sheetPaddingTop={spacing.md}
      includeBottomInset={false}
      scrollable={mode === 'create'}
      keyboardMode={mode === 'create' ? 'listeners' : undefined}
      dismissable={canDismissCategoryPicker(isCreating)}
    >
      {mode === 'list' ? (
        <ListMode
          rows={rows}
          selectedKey={selectedKey}
          onSelectRow={(slug) => onSelect(slug)}
          onCreatePress={openCreate}
          title={t('categoryPickerTitle')}
          createLabel={t('categoryCreateTitle')}
          itemName={itemName}
          canCreate={!!userId}
          isCreating={isCreating}
        />
      ) : (
        <View style={styles.body}>
          <Text style={styles.title}>{t('categoryCreateTitle')}</Text>
          <Text style={styles.itemName} numberOfLines={1}>
            {itemName}
          </Text>
          <FieldGroup
            label={t('categoryCreateNameLabel')}
            error={nameError}
          >
            <TextInput
              value={name}
              onChangeText={(text) => {
                setName(text);
                // Editing the name invalidates the previous attempt's
                // error state — a stale seam createError must not linger
                // on a form the user is actively revising.
                setAttempted(false);
              }}
              style={styles.input}
              placeholder={t('categoryCreateNamePlaceholder')}
              placeholderTextColor={colors.textSecondary}
              maxLength={MAX_CATEGORY_NAME_LENGTH}
              autoFocus
              editable={!isCreating}
              accessibilityLabel={t('categoryCreateNameLabel')}
            />
          </FieldGroup>
          <FieldGroup label={t('categoryCreateKindLabel')}>
            <View style={styles.chipRow}>
              <Pressable
                onPress={() => setKind('need')}
                disabled={isCreating}
                style={({ pressed }) => [
                  styles.cell,
                  kind === 'need' && styles.cellSelected,
                  pressed && styles.cellPressed,
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: kind === 'need' }}
                accessibilityLabel={t('categoryCreateKindNeed')}
              >
                <Text
                  style={[
                    styles.cellLabel,
                    kind === 'need' && styles.cellLabelSelected,
                  ]}
                >
                  {t('categoryCreateKindNeed')}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setKind('want')}
                disabled={isCreating}
                style={({ pressed }) => [
                  styles.cell,
                  kind === 'want' && styles.cellSelected,
                  pressed && styles.cellPressed,
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: kind === 'want' }}
                accessibilityLabel={t('categoryCreateKindWant')}
              >
                <Text
                  style={[
                    styles.cellLabel,
                    kind === 'want' && styles.cellLabelSelected,
                  ]}
                >
                  {t('categoryCreateKindWant')}
                </Text>
              </Pressable>
            </View>
          </FieldGroup>
          <FieldGroup label={t('categoryCreateColorLabel')}>
            <View style={styles.paletteRow}>
              {CATEGORY_PALETTE_COLORS.map((hex) => {
                const selected = color === hex;
                return (
                  <Pressable
                    key={hex}
                    onPress={() => setColor(hex)}
                    disabled={isCreating}
                    style={({ pressed }) => [
                      styles.swatch,
                      { backgroundColor: hex },
                      selected && styles.swatchSelected,
                      pressed && styles.cellPressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`${t('categoryCreateColorLabel')} ${hex}`}
                  />
                );
              })}
            </View>
          </FieldGroup>
          {formError ? (
            <Text style={styles.formError}>{formError}</Text>
          ) : null}
          <View style={styles.actions}>
            <Pressable
              onPress={onClose}
              disabled={isCreating}
              style={({ pressed }) => [
                styles.actionButton,
                styles.cancelButton,
                pressed && styles.actionPressed,
                isCreating && styles.actionDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel={t('common:cancel')}
            >
              <Text style={styles.cancelLabel}>{t('common:cancel')}</Text>
            </Pressable>
            <Pressable
              onPress={handleCreate}
              disabled={!canPressCreate}
              style={({ pressed }) => [
                styles.actionButton,
                styles.saveButton,
                pressed && styles.actionPressed,
                !canPressCreate && styles.actionDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel={t('categoryCreateAction')}
              accessibilityState={{ disabled: !canPressCreate }}
            >
              <Text style={styles.saveLabel}>
                {isCreating
                  ? t('common:saveLoading')
                  : t('categoryCreateAction')}
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </BottomSheet>
  );
}

/** The list: grid of catalog rows + the create affordance cell. */
function ListMode({
  rows,
  selectedKey,
  onSelectRow,
  onCreatePress,
  title,
  createLabel,
  itemName,
  canCreate,
  isCreating,
}: {
  rows: CategoryPickerRow[];
  selectedKey: string | null;
  onSelectRow: (slug: string) => void;
  onCreatePress: () => void;
  title: string;
  createLabel: string;
  itemName: string;
  canCreate: boolean;
  isCreating: boolean;
}) {
  return (
    <View style={styles.body}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.itemName} numberOfLines={1}>
        {itemName}
      </Text>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.grid}
        showsVerticalScrollIndicator={false}
      >
        {rows.map((row) => {
          const selected = row.slug === selectedKey;
          return (
            <Pressable
              key={row.slug}
              onPress={() => onSelectRow(row.slug)}
              disabled={isCreating}
              style={({ pressed }) => [
                styles.cell,
                selected && styles.cellSelected,
                pressed && styles.cellPressed,
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled: isCreating }}
              accessibilityLabel={row.label}
            >
              <Icon
                name={row.icon}
                size={20}
                color={selected ? colors.primary : colors.textSecondary}
              />
              <Text
                style={[
                  styles.cellLabel,
                  selected && styles.cellLabelSelected,
                ]}
                numberOfLines={1}
              >
                {row.label}
              </Text>
            </Pressable>
          );
        })}
        {canCreate ? (
          <Pressable
            onPress={onCreatePress}
            disabled={isCreating}
            style={({ pressed }) => [
              styles.cell,
              styles.createCell,
              pressed && styles.cellPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={createLabel}
          >
            <Icon name="plus" size={20} color={colors.primary} />
            <Text style={[styles.cellLabel, styles.createCellLabel]} numberOfLines={1}>
              {createLabel}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  // Pre-BottomSheet handle parity: the shell defaults to 40/`colors.border`;
  // this picker's handle has always been 36/`colors.divider`.
  handle: {
    width: 36,
    backgroundColor: colors.divider,
  },
  // Body carries the sheet-level padding the old version applied to the
  // whole sheet: horizontal inset + bottom padding under the grid.
  body: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  title: {
    ...typography.headlineMd,
    color: colors.textPrimary,
  },
  itemName: {
    ...typography.bodyMd,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  scroll: {
    flexGrow: 0,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  cell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.chipBg,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  cellSelected: {
    backgroundColor: colors.primaryContainer,
    borderColor: colors.primary,
  },
  cellPressed: {
    transform: [{ scale: 0.97 }],
  },
  cellLabel: {
    ...typography.bodyMd,
    color: colors.textSecondary,
  },
  cellLabelSelected: {
    color: colors.primaryDark,
    fontWeight: '600',
  },
  createCell: {
    backgroundColor: colors.surface,
    borderColor: colors.primary,
    borderStyle: 'dashed',
  },
  createCellLabel: {
    color: colors.primary,
    fontWeight: '600',
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
  chipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  paletteRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  swatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  swatchSelected: {
    borderColor: colors.primary,
  },
  formError: {
    ...typography.labelSm,
    color: colors.danger,
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