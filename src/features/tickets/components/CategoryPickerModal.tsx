import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, TextInput } from 'react-native';
import { useTranslation } from 'react-i18next';

import { BottomSheet, FieldGroup, Icon, Pressable, Text, View } from '@/components';
import { useSessionUser } from '@/features/auth';
import {
  CATEGORY_ALREADY_EXISTS_MESSAGE,
  countCategoryItems,
  useCategoryCatalog,
} from '@/features/categories';
import { colors, radii, spacing, typography } from '@/theme';
import { truncateCategoryName } from '@/lib/format';
import type { CategoryKind } from '@/types';

import {
  CATEGORY_CREATE_DEFAULT_ICON,
  CATEGORY_DELETE_ERROR_KEYS,
  CATEGORY_PALETTE_COLORS,
  MAX_CATEGORY_NAME_LENGTH,
  canDismissCategoryPicker,
  canonicalFallbackRows,
  categoryCollisionSlugs,
  categoryCreateFormError,
  categoryCreateNameFieldError,
  confirmCategoryDelete,
  confirmCategoryReassignDelete,
  customCategorySlugs,
  hasReassignTarget,
  isCurrentCategoryCreateSession,
  pickerRowsFromCatalog,
  reassignmentTargets,
  requestCategoryDelete,
  seamCreateErrorKey,
  validateCategoryCreateInput,
  type CategoryDeleteActions,
  type CategoryDeleteOutcome,
  type CategoryPickerRow,
} from '../category-picker-form';

export interface CategoryPickerModalProps {
  /** Whether the sheet is open. Kept mounted so closing animates. */
  visible: boolean;
  /** Name of the item being categorized (shown in the title). */
  itemName: string;
  /** Currently selected category key, if any. */
  selectedKey: string | null;
  /**
   * Called with the chosen category key (or 'otros'), or null when the user
   * clears the selection (spec: "No category chosen → category_id = null").
   * NOTE: the delete/reassign flow does NOT go through onSelect — it reports
   * through `onCategoryDeleted` and the parent sweeps the draft; the delete's
   * empty-path resolution is the EXPLICIT 'otros' slug (never a silent null).
   */
  onSelect: (categoryKey: string | null) => void;
  /**
   * Called when a delete/reassign RESOLVES, with the deleted slug and the
   * explicit resolution EVERY draft reference to it must get — the
   * reassignment target (blocked delete) or the EXPLICIT 'otros' slug (empty
   * delete: the app-wide persisted fallback — "NULLs never persist",
   * buildSaveReceiptArgs/updateReceipt map unresolved/null to 'otros' at
   * save). The PARENT owns the draft, so it sweeps ALL items through
   * `sweepDraftAfterDelete`: a sibling item carrying the deleted slug must
   * NEVER drift per-item — every reference resolves to the SAME resolution,
   * and on the empty path that resolution is 'otros' VISIBLY (the picker
   * shows it on the freed items), never a silent later re-bucket. The
   * picker's own target item is part of that sweep — onSelect is NOT called
   * on a delete success.
   */
  onCategoryDeleted: (deletedSlug: string, fallbackSlug: string) => void;
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
  onCategoryDeleted,
  onClose,
}: CategoryPickerModalProps) {
  const { t } = useTranslation(['tickets', 'common']);
  const { userId } = useSessionUser();
  const {
    catalog,
    create,
    isCreating,
    createError,
    delete: deleteCategory,
    isDeleting,
    reassign,
    isReassigning,
  } = useCategoryCatalog();

  // Fresh token per dismissal: a create that resolves AFTER the sheet was
  // closed must not select (cancel must cancel — see handleCreate).
  const sessionRef = useRef(0);

  const [mode, setMode] = useState<'list' | 'create'>('list');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CategoryKind | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);

  // ── Delete flow (slice 4/7 — D1 block-delete policy) ──────────────────────
  // `pendingDelete` is the own custom row being deleted ({ id, slug }).
  // `deleteOutcome` comes from the pure orchestrators in
  // category-picker-form, which drive blocked-vs-empty-vs-error rendering;
  // `reassignTargetSlug` is the EXPLICIT reassignment target the user picks
  // in the blocked view (never silent, spec REQ-BLOCK-DELETE).
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    slug: string;
  } | null>(null);
  const [deleteOutcome, setDeleteOutcome] = useState<CategoryDeleteOutcome | null>(null);
  const [reassignTargetSlug, setReassignTargetSlug] = useState<string | null>(null);
  // The count phase is async but is NOT a hook mutation — track it so the
  // dismissal gate covers the WHOLE delete flow (W4: a cancel mid-count must
  // never leave a stale outcome to apply after the sheet was closed).
  const [isDeleteCounting, setIsDeleteCounting] = useState(false);

  const resetForm = () => {
    setName('');
    setKind(null);
    setColor(null);
    setAttempted(false);
  };

  // Closing the sheet always lands back on the list with a fresh form,
  // a cancelled delete flow, and an invalidated in-flight create.
  useEffect(() => {
    if (!visible) {
      setMode('list');
      resetForm();
      setPendingDelete(null);
      setDeleteOutcome(null);
      setReassignTargetSlug(null);
      sessionRef.current += 1;
    }
  }, [visible]);

  // The delete seams, wired to the RLS-scoped API + hook mutations. Every
  // adapter maps rejects to `{ ok: false }` so the pure orchestrators
  // fail closed on the exact step — the modal never guesses a step.
  // `userId` gates the count the same way the hook gates every mutation.
  const deleteActions: CategoryDeleteActions = useMemo(
    () => ({
      count: (categoryId) =>
        countCategoryItems(userId ?? '', categoryId).then((result) =>
          result.status === 'ok'
            ? { ok: true, count: result.data }
            : { ok: false, count: 0 },
        ),
      reassign: async (fromId, toId) => {
        try {
          await reassign({ fromId, toId });
          return { ok: true };
        } catch {
          return { ok: false };
        }
      },
      deleteRow: async (categoryId) => {
        try {
          await deleteCategory(categoryId);
          return { ok: true };
        } catch {
          return { ok: false };
        }
      },
    }),
    [userId, reassign, deleteCategory],
  );

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

  // ── Delete flow handlers (D1) ─────────────────────────────────────────────
  // Only the caller's OWN custom rows (sort_order >= 100) gain the
  // long-press delete affordance; canonical rows never do.
  const ownCustomSlugs = customCategorySlugs(catalog);

  const handleLongPressRow = async (row: CategoryPickerRow) => {
    const entry = catalog[row.slug];
    if (!entry) return;
    setPendingDelete({ id: entry.id, slug: entry.slug });
    // W4: reset BEFORE the count await — a previous flow's outcome must
    // never render inside the next delete flow.
    setDeleteOutcome(null);
    setIsDeleteCounting(true);
    try {
      // The count decides the path: > 0 → blocked (reassign first), 0 →
      // empty delete allowed. A count failure fails closed to the error view.
      setDeleteOutcome(await requestCategoryDelete(deleteActions, entry.id));
    } finally {
      setIsDeleteCounting(false);
    }
  };

  const cancelDelete = () => {
    setPendingDelete(null);
    setDeleteOutcome(null);
    setReassignTargetSlug(null);
  };

  // Blocked path: reassign to the EXPLICIT target, then delete. On success the
  // resolution is REPORTED to the parent (onCategoryDeleted) — the parent
  // sweeps the whole draft so every sibling reference to the deleted slug
  // resolves to this SAME target (W1: never a silent 'otros').
  const handleConfirmReassignDelete = async () => {
    if (!pendingDelete || !reassignTargetSlug) return;
    const pending = pendingDelete;
    const fallbackSlug = reassignTargetSlug;
    // W5: a concurrent catalog refetch may drop the target row mid-flow —
    // dereferencing a vanished entry would throw inside this async handler
    // and leave the sheet stuck on the blocked view. Surface the reassign
    // error step instead (never a throw).
    if (!hasReassignTarget(catalog, fallbackSlug)) {
      setDeleteOutcome({ status: 'error', step: 'reassign' });
      return;
    }
    // Snapshot before the await: state setters can run while the mutation is
    // in flight, so TS narrowing on `pendingDelete` does not survive it.
    const target = catalog[fallbackSlug];
    const outcome = await confirmCategoryReassignDelete(
      deleteActions,
      pending.id,
      target.id,
    );
    if (outcome.status === 'deleted') {
      onCategoryDeleted(pending.slug, fallbackSlug);
    } else {
      setDeleteOutcome(outcome);
    }
  };

  // Empty path: delete directly (FK RESTRICT is the DB backstop against the
  // count/delete race). The resolution is the EXPLICIT 'otros' slug — the
  // app-wide persisted fallback ("NULLs never persist": the save seams map
  // unresolved/null to 'otros', api.ts buildSaveReceiptArgs / updateReceipt).
  // The re-bucket is VISIBLE in the picker on every freed item — by design,
  // never a silent per-item drift at save time.
  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    // Snapshot before the await (same narrowing rationale as above).
    const pending = pendingDelete;
    const outcome = await confirmCategoryDelete(deleteActions, pending.id);
    if (outcome.status === 'deleted') {
      onCategoryDeleted(pending.slug, 'otros');
    } else {
      setDeleteOutcome(outcome);
    }
  };

  // Delete-flow views. `deleteOutcome === null` = the count is in flight.
  // The `'error'` branch is narrowed EXPLICITLY: the outcome union includes
  // the transient `'deleted'` status (a successful confirm calls
  // onCategoryDeleted and the PARENT closes the sheet without ever rendering
  // this view), so only the `'error'` member carries `step`.
  const deleteView =
    pendingDelete && deleteOutcome
      ? deleteOutcome.status === 'in-use'
        ? {
            kind: 'blocked' as const,
            count: deleteOutcome.count,
            targets: reassignmentTargets(catalog, pendingDelete.slug),
          }
        : deleteOutcome.status === 'empty'
          ? { kind: 'confirm' as const }
          : deleteOutcome.status === 'error'
            ? {
                kind: 'error' as const,
                errorKey: CATEGORY_DELETE_ERROR_KEYS[deleteOutcome.step],
              }
            : null
      : null;

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
      dismissable={canDismissCategoryPicker(
        isCreating || isDeleting || isReassigning || isDeleteCounting,
      )}
    >
      {mode === 'list' && !pendingDelete ? (
        <ListMode
          rows={rows}
          selectedKey={selectedKey}
          onSelectRow={(slug) => onSelect(slug)}
          onCreatePress={openCreate}
          onLongPressRow={handleLongPressRow}
          ownCustomSlugs={ownCustomSlugs}
          title={t('categoryPickerTitle')}
          createLabel={t('categoryCreateTitle')}
          itemName={itemName}
          canCreate={!!userId}
          isCreating={isCreating}
        />
      ) : pendingDelete ? (
        deleteView ? (
          deleteView.kind === 'blocked' ? (
            <BlockedDeleteView
              title={t('categoryReassignTitle')}
              banner={
                deleteView.count === 1
                  ? t('categoryDeleteInUse_one', {
                      count: deleteView.count,
                    })
                  : t('categoryDeleteInUse_other', {
                      count: deleteView.count,
                    })
              }
              targetLabel={t('categoryReassignToLabel')}
              targets={deleteView.targets}
              selectedSlug={reassignTargetSlug}
              onPickTarget={(slug) => setReassignTargetSlug(slug)}
              confirmLabel={t('categoryDeleteConfirm')}
              onConfirm={handleConfirmReassignDelete}
              onCancel={cancelDelete}
              cancelLabel={t('common:cancel')}
              busy={isDeleting || isReassigning}
            />
          ) : deleteView.kind === 'confirm' ? (
            <ConfirmDeleteView
              title={t('categoryDeleteConfirm')}
              itemName={itemName}
              confirmLabel={t('categoryDeleteConfirm')}
              onConfirm={handleConfirmDelete}
              onCancel={cancelDelete}
              cancelLabel={t('common:cancel')}
              busy={isDeleting || isReassigning}
            />
          ) : (
            <ErrorDeleteView
              message={t(deleteView.errorKey)}
              onDone={cancelDelete}
              doneLabel={t('common:ok')}
            />
          )
        ) : (
          <View style={styles.body}>
            <Text style={styles.title}>{t('categoryDeleteConfirm')}</Text>
            <Text style={styles.itemName} numberOfLines={1}>
              {itemName}
            </Text>
            {/* Count phase: async but quick — a localized status so the
                blocked view never appears to hang (existing common:loading,
                no new i18n keys). */}
            <Text style={styles.bodySm}>{t('common:loading')}</Text>
          </View>
        )
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
  onLongPressRow,
  ownCustomSlugs,
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
  onLongPressRow: (row: CategoryPickerRow) => void;
  ownCustomSlugs: string[];
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
          // Slice 4/7 (D1): only the caller's OWN custom rows carry the
          // long-press delete affordance; canonical rows are never
          // deletable from the picker.
          const deletable = ownCustomSlugs.includes(row.slug);
          return (
            <Pressable
              key={row.slug}
              onPress={() => onSelectRow(row.slug)}
              onLongPress={
                deletable ? () => onLongPressRow(row) : undefined
              }
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
                {truncateCategoryName(row.label)}
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

/**
 * Blocked delete (D1): an in-use custom category cannot be deleted — the
 * banner explains why (with the exact count), the user picks an EXPLICIT
 * reassignment target (the whole grid minus the deleted row — canonical
 * rows including 'otros' stay valid, per spec), then confirms. No silent
 * re-bucket, ever.
 */
function BlockedDeleteView({
  title,
  banner,
  targetLabel,
  targets,
  selectedSlug,
  onPickTarget,
  confirmLabel,
  onConfirm,
  onCancel,
  cancelLabel,
  busy,
}: {
  title: string;
  banner: string;
  targetLabel: string;
  targets: CategoryPickerRow[];
  selectedSlug: string | null;
  onPickTarget: (slug: string) => void;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  cancelLabel: string;
  busy: boolean;
}) {
  const canConfirm = !!selectedSlug && !busy;
  return (
    <View style={styles.body}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.deleteBanner}>{banner}</Text>
      <Text style={styles.deleteTargetLabel}>{targetLabel}</Text>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.grid}
        showsVerticalScrollIndicator={false}
      >
        {targets.map((row) => {
          const selected = row.slug === selectedSlug;
          return (
            <Pressable
              key={row.slug}
              onPress={() => onPickTarget(row.slug)}
              disabled={busy}
              style={({ pressed }) => [
                styles.cell,
                selected && styles.cellSelected,
                pressed && styles.cellPressed,
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled: busy }}
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
                {truncateCategoryName(row.label)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={styles.actions}>
        <Pressable
          onPress={onCancel}
          disabled={busy}
          style={({ pressed }) => [
            styles.actionButton,
            styles.cancelButton,
            pressed && styles.actionPressed,
            busy && styles.actionDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel={cancelLabel}
        >
          <Text style={styles.cancelLabel}>{cancelLabel}</Text>
        </Pressable>
        <Pressable
          onPress={onConfirm}
          disabled={!canConfirm}
          style={({ pressed }) => [
            styles.actionButton,
            styles.saveButton,
            pressed && styles.actionPressed,
            !canConfirm && styles.actionDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel={confirmLabel}
          accessibilityState={{ disabled: !canConfirm }}
        >
          <Text style={styles.saveLabel}>{confirmLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Empty-path delete: the count came back 0, so the category holds no
 * purchases — a plain confirm flips to the direct delete.
 */
function ConfirmDeleteView({
  title,
  itemName,
  confirmLabel,
  onConfirm,
  onCancel,
  cancelLabel,
  busy,
}: {
  title: string;
  itemName: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  cancelLabel: string;
  busy: boolean;
}) {
  return (
    <View style={styles.body}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.itemName} numberOfLines={1}>
        {itemName}
      </Text>
      <View style={styles.actions}>
        <Pressable
          onPress={onCancel}
          disabled={busy}
          style={({ pressed }) => [
            styles.actionButton,
            styles.cancelButton,
            pressed && styles.actionPressed,
            busy && styles.actionDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel={cancelLabel}
        >
          <Text style={styles.cancelLabel}>{cancelLabel}</Text>
        </Pressable>
        <Pressable
          onPress={onConfirm}
          disabled={busy}
          style={({ pressed }) => [
            styles.actionButton,
            styles.saveButton,
            pressed && styles.actionPressed,
            busy && styles.actionDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel={confirmLabel}
          accessibilityState={{ disabled: busy }}
        >
          <Text style={styles.saveLabel}>{confirmLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Fail-closed delete error (D1): the exact step (count / reassign /
 * delete) resolves to its localized tickets key — raw backend copy never
 * renders. The user returns to the list untouched.
 */
function ErrorDeleteView({
  message,
  onDone,
  doneLabel,
}: {
  message: string;
  onDone: () => void;
  doneLabel: string;
}) {
  return (
    <View style={styles.body}>
      <Text style={styles.formError}>{message}</Text>
      <View style={styles.actions}>
        <Pressable
          onPress={onDone}
          style={({ pressed }) => [
            styles.actionButton,
            styles.saveButton,
            pressed && styles.actionPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={doneLabel}
        >
          <Text style={styles.saveLabel}>{doneLabel}</Text>
        </Pressable>
      </View>
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
  // Small helper status text (count-phase loading, etc.).
  bodySm: {
    ...typography.labelSm,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  // Blocked-delete banner (D1): in-use copy with the exact purchase count.
  deleteBanner: {
    ...typography.bodyMd,
    color: colors.textSecondary,
  },
  deleteTargetLabel: {
    ...typography.labelSm,
    color: colors.textPrimary,
    fontWeight: '600',
    marginTop: spacing.xs,
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