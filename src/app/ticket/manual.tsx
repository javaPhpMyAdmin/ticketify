import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import { router, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  Card,
  Chip,
  DatePickerField,
  Fab,
  Icon,
  IconButton,
  Text,
  View,
} from '@/components';
import { useSessionUser } from '@/features/auth';
import { getExpenseCategory } from '@/features/home/categories';
import {
  buildEditorReviewItem,
  autoTotal,
  emptyManualDraft,
  formatManualErrors,
  CategoryPickerModal,
  ItemEditorModal,
  QUOTA_ERROR_MESSAGE,
  QuotaExceededError,
  SAVE_ERROR_MESSAGE,
  saveManualReceipt,
  validateManualForm,
  useReceiptDraftActions,
  useReceiptDraftDraft,
  buildManualDraft,
  cardTypeLabels,
  cardTypeOptions,
  paymentMethods,
} from '@/features/tickets';
import { formatDateES } from '@/components/molecules/DatePickerField/calendar';
import { formatCurrency, todayLocalISO } from '@/lib/format';
import { useSettingsStore } from '@/stores/use-settings-store';
import { useToastStore } from '@/stores/use-toast-store';
import { colors, radii, spacing, typography } from '@/theme';
import type { CardType, ReviewItem } from '@/types';

/**
 * Home to the manual purchase entry (REQ-002..008). Builds a draft with a
 * store name, purchase date (new in-repo DatePicker), payment method (with a
 * display-only card-type selector), an items editor (add/edit/remove), an
 * auto-recalculated total, and saves via `saveManualReceipt`.
 *
 * Card type is DISPLAY ONLY (decision #1137): it lives in local screen state
 * and is passed to `buildManualDraft`, which keeps it in `draft.card_type`,
 * but `saveManualReceipt` / `buildSaveReceiptArgs` never send card fields to
 * the RPC.
 */
export default function ManualEntryScreen() {
  const { t } = useTranslation(['tickets', 'a11y', 'common']);
  const { userId } = useSessionUser();
  const currency = useSettingsStore((s) => s.currency);
  const { draft } = useReceiptDraftDraft();
  const { startDraft, setStore, setDate, setPayment, upsertItem, removeItem, clear } =
    useReceiptDraftActions();

  // Display-only card type (never persisted).
  const [cardType, setCardType] = useState<CardType | null>(null);

  // REQ-002: fresh draft on entry (no photo, empty items, total 0, today)
  // with the spec's payment default. The shared scan seed defaults the
  // draft to 'card' (correct for the camera flow); the manual screen must
  // NOT inherit it, so it overrides with the REQ-002 payment defaults
  // ('other', no card type — decision #1137 keeps card_type display-only).
  useEffect(() => {
    startDraft('');
    const init = emptyManualDraft();
    setPayment(init.payment_method);
    setCardType(init.card_type);
  }, [startDraft, setPayment]);

  // ── Date picker ───────────────────────────────────────────────────────
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  // ── Item editor ───────────────────────────────────────────────────────
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorTarget, setEditorTarget] = useState<ReviewItem | null>(null);

  const openAddItem = () => {
    setEditorTarget(null);
    setEditorOpen(true);
  };
  const openEditItem = (item: ReviewItem) => {
    setEditorTarget(item);
    setEditorOpen(true);
  };
  const handleSaveItem = (values: {
    name: string;
    quantity: number;
    unit_price: number;
  }) => {
    const next: ReviewItem = editorTarget
      ? {
          ...editorTarget,
          name: values.name,
          quantity: values.quantity,
          unit_price: values.unit_price,
          total_price: values.quantity * values.unit_price,
        }
      : buildEditorReviewItem({
          name: values.name,
          quantity: values.quantity,
          unit_price: values.unit_price,
        });
    upsertItem(next);
    setEditorOpen(false);
    setEditorTarget(null);
  };

  // ── Category picker for an item ───────────────────────────────────────
  const [categoryTarget, setCategoryTarget] = useState<ReviewItem | null>(null);
  const handleSelectCategory = (key: string) => {
    if (!categoryTarget) return;
    upsertItem({ ...categoryTarget, category_id: key });
    setCategoryTarget(null);
  };

  // ── Submission ────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [submitErrors, setSubmitErrors] = useState<string[]>([]);

  const handleSubmit = async () => {
    if (savingRef.current || !draft || !userId) return;
    savingRef.current = true;
    setSaving(true);
    setSubmitErrors([]);
    try {
      // REQ-006: total auto-computed from Σ(qty × unit_price).
      const total = autoTotal(draft.items);
      const manualDraft = buildManualDraft(
        draft.store_name,
        draft.purchase_date,
        draft.items,
        total,
        draft.payment_method,
        cardType,
      );
      // Block submit with user-friendly es-AR errors (REQ-006).
      const codes = validateManualForm(manualDraft);
      if (codes.length > 0) {
        setSubmitErrors(formatManualErrors(codes));
        savingRef.current = false;
        setSaving(false);
        return;
      }
      await saveManualReceipt(userId, manualDraft);
      clear();
      useToastStore.getState().show('Compra guardada.', 'success');
      router.dismiss();
    } catch (err) {
      savingRef.current = false;
      setSaving(false);
      useToastStore
        .getState()
        .show(
          err instanceof QuotaExceededError
            ? QUOTA_ERROR_MESSAGE
            : SAVE_ERROR_MESSAGE,
        );
    }
  };

  // Recompute total whenever items change (REQ-006).
  const total = draft ? autoTotal(draft.items) : 0;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.topBar}>
          <IconButton
            icon="xmark"
            iconSize={22}
            onPress={() => {
              clear();
              router.dismiss();
            }}
            accessibilityLabel={t('tickets:manualClose')}
          />
          <Text style={styles.topBarTitle}>{t('tickets:manualTitle')}</Text>
          <View style={styles.topBarSpacer} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Store + date */}
          <Card>
            <View style={styles.fieldStack}>
              <View style={styles.fieldWrap}>
                <Text style={styles.kicker}>{t('tickets:manualStoreKicker')}</Text>
                <TextInput
                  value={draft?.store_name ?? ''}
                  onChangeText={setStore}
                  style={styles.input}
                  placeholder={t('tickets:manualStorePlaceholder')}
                  placeholderTextColor={colors.textSecondary}
                />
              </View>
              <View style={styles.fieldWrap}>
                <Text style={styles.kicker}>{t('tickets:manualDateKicker')}</Text>
                <Pressable
                  onPress={() => setDatePickerOpen(true)}
                  style={({ pressed }) => [
                    styles.dateTrigger,
                    pressed && styles.dateTriggerPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={t('tickets:manualDatePick')}
                >
                  <Icon name="calendar" size={18} color={colors.textPrimary} />
                  <Text style={styles.dateValue}>
                    {formatDateES(draft?.purchase_date ?? null, todayLocalISO())}
                  </Text>
                  <Icon
                    name="chevron.right"
                    size={16}
                    color={colors.textSecondary}
                  />
                </Pressable>
              </View>
            </View>
          </Card>

          {/* Payment */}
          <Card>
            <Text style={styles.kicker}>{t('tickets:manualPaymentKicker')}</Text>
            <View style={styles.paymentRow}>
              {paymentMethods.map((m) => {
                const label =
                  m.key === 'card' &&
                  draft?.payment_method === 'card' &&
                  cardType
                    ? `${t('tickets:manualTarjetaPrefix')} ${cardTypeLabels[cardType]}`
                    : m.label;
                return (
                  <Pressable
                    key={m.key}
                    onPress={() => {
                      setPayment(m.key);
                      if (m.key !== 'card') setCardType(null);
                    }}
                  >
                    <Chip label={label} selected={draft?.payment_method === m.key} />
                  </Pressable>
                );
              })}
            </View>
            {/* Card type selector — display-only (decision #1137): never
                persisted by saveManualReceipt / buildSaveReceiptArgs. */}
            {draft?.payment_method === 'card' ? (
              <View style={styles.cardTypeRow}>
                <Text style={styles.cardTypeLabel}>{t('tickets:manualCardType')}</Text>
                {cardTypeOptions.map((opt) => (
                  <Pressable key={opt.key} onPress={() => setCardType(opt.key)}>
                    <Chip label={opt.label} selected={cardType === opt.key} />
                  </Pressable>
                ))}
              </View>
            ) : null}
          </Card>

          {/* Items */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>
                {t('tickets:manualItemsHeader', { count: draft?.items.length ?? 0 })}
              </Text>
              <Pressable
                onPress={openAddItem}
                style={({ pressed }) => [
                  styles.addButton,
                  pressed && styles.addButtonPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={t('tickets:manualAddItem')}
              >
                <Icon name="plus" size={16} color={colors.surface} />
                <Text style={styles.addButtonLabel}>{t('tickets:manualAddItemShort')}</Text>
              </Pressable>
            </View>
            {draft?.items?.length ? (
              <Card padding={spacing.sm}>
                {draft.items.map((item, idx) => {
                  // Resolve the chip label through the expense-category
                  // registry (same as ReviewItemRow): slug → label ('lacteos'
                  // → 'Lácteos'). Unknown slugs bucket into 'otros' → 'Otros'.
                  const effectiveCategoryId =
                    item.category_id ?? item.ai_suggested_category_id;
                  const categoryLabel = getExpenseCategory(
                    effectiveCategoryId ?? 'otros',
                  ).label;
                  return (
                    <View key={item.temp_id}>
                      {idx > 0 ? <View style={styles.rowDivider} /> : null}
                      <View style={styles.itemRow}>
                        <View style={styles.itemMain}>
                          <Text style={styles.itemName} numberOfLines={1}>
                            {item.name}
                          </Text>
                          <Text style={styles.itemSub}>
                            {item.quantity} × {formatCurrency(item.unit_price, currency)}
                          </Text>
                        </View>
                        <Text style={styles.itemTotal}>
                          {formatCurrency(item.total_price, currency)}
                        </Text>
                        <Pressable
                          onPress={() => openEditItem(item)}
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityLabel={`Editar ${item.name}`}
                          style={styles.itemAction}
                        >
                          <Icon name="pencil" size={18} color={colors.textSecondary} />
                        </Pressable>
                        <Pressable
                          onPress={() => removeItem(item.temp_id)}
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityLabel={`Eliminar ${item.name}`}
                          style={styles.itemAction}
                        >
                          <Icon name="trash" size={18} color={colors.danger} />
                        </Pressable>
                      </View>
                      <View style={styles.itemCategoryRow}>
                        <Pressable
                          onPress={() => setCategoryTarget(item)}
                          accessibilityRole="button"
                          accessibilityLabel={`${t('a11y:categoryOfItem')} ${item.name}`}
                        >
                          <Chip label={categoryLabel} />
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
              </Card>
            ) : (
              <Text style={styles.noItems}>{t('tickets:manualNoItems')}</Text>
            )}
          </View>

          {/* Inline submit errors */}
          {submitErrors.length > 0 ? (
            <View style={styles.errorBox}>
              {submitErrors.map((e) => (
                <Text key={e} style={styles.errorText}>
                  • {e}
                </Text>
              ))}
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <View style={styles.totalRow}>
            <Text style={styles.kicker}>{t('tickets:manualTotal')}</Text>
            <Text style={styles.totalValue}>{formatCurrency(total, currency)}</Text>
          </View>
          <Fab
            label={t('tickets:manualSave')}
            icon="checkmark"
            onPress={() => void handleSubmit()}
            disabled={saving}
          />
        </View>
      </SafeAreaView>

      <DatePickerField
        visible={datePickerOpen}
        value={draft?.purchase_date ?? null}
        onPick={(iso) => {
          setDatePickerOpen(false);
          setDate(iso);
        }}
        onClose={() => setDatePickerOpen(false)}
      />

      <ItemEditorModal
        visible={editorOpen}
        initialValues={
          editorTarget
            ? {
                name: editorTarget.name,
                quantity: editorTarget.quantity,
                unit_price: editorTarget.unit_price,
              }
            : null
        }
        onSave={handleSaveItem}
        onClose={() => {
          setEditorOpen(false);
          setEditorTarget(null);
        }}
      />

      <CategoryPickerModal
        visible={!!categoryTarget}
        itemName={categoryTarget?.name ?? ''}
        selectedKey={
          categoryTarget?.category_id ?? categoryTarget?.ai_suggested_category_id ?? null
        }
        onSelect={handleSelectCategory}
        onClose={() => setCategoryTarget(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
  },
  topBarTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.primary,
  },
  topBarSpacer: {
    width: 40,
  },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: 160,
    gap: spacing.lg,
  },
  fieldStack: {
    gap: spacing.lg,
  },
  fieldWrap: {
    gap: spacing.xs,
  },
  kicker: {
    ...typography.labelCaps,
    color: colors.textSecondary,
  },
  input: {
    ...typography.headlineMd,
    color: colors.textPrimary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.sm,
  },
  dateTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.sm,
  },
  dateTriggerPressed: {
    opacity: 0.6,
  },
  dateValue: {
    ...typography.headlineMd,
    color: colors.textPrimary,
    flex: 1,
  },
  paymentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  cardTypeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.lg,
  },
  cardTypeLabel: {
    ...typography.labelSm,
    color: colors.textSecondary,
    fontWeight: '600',
    marginRight: spacing.xs,
  },
  section: {
    gap: spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    ...typography.headlineMd,
    color: colors.textPrimary,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
  },
  addButtonPressed: {
    opacity: 0.85,
  },
  addButtonLabel: {
    ...typography.labelSm,
    color: colors.surface,
    fontWeight: '700',
  },
  rowDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  itemMain: {
    flex: 1,
    gap: 2,
  },
  itemName: {
    ...typography.bodyLg,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  itemSub: {
    ...typography.labelSm,
    color: colors.textSecondary,
  },
  itemTotal: {
    ...typography.headlineMd,
    color: colors.textPrimary,
  },
  itemAction: {
    padding: spacing.xs,
  },
  itemCategoryRow: {
    marginTop: spacing.sm,
  },
  noItems: {
    ...typography.bodyMd,
    color: colors.textSecondary,
  },
  errorBox: {
    backgroundColor: colors.danger,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 2,
  },
  errorText: {
    ...typography.labelSm,
    color: colors.surface,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  totalValue: {
    ...typography.headlineLg,
    color: colors.textPrimary,
  },
});