import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card, Icon, Pressable, Spinner, Text, View } from '@/components';
import {
  budgetKeysFromCatalog,
  budgetSavePayload,
  mergeBudgetDraftSeeds,
  seedBudgetDrafts,
  useCategoryBudgets,
} from '@/features/analytics';
import { useCategoryCatalog } from '@/features/categories/hooks/useCategoryCatalog';
import { currentMonthKey } from '@/features/home';
import {
  EXPENSE_CATEGORIES,
  resolveCategoryDisplay,
} from '@/features/home/categories';
import { colors, radii, spacing, typography } from '@/theme';

/**
 * Full-screen per-category budget editor reached from the profile screen's
 * "Presupuestos por categoría" row (`/settings/category-budgets`).
 *
 * PR 7 (category-management): lists the rows of the MERGED catalog — the 13
 * canonical categories plus the user's OWN custom categories (custom rows
 * render their own label/color via `resolveCategoryDisplay`, D3/D4). While
 * the catalog is still loading the list falls back to the 13 canonical keys
 * (identical to the pre-PR7 shape), then the custom rows join in.
 *
 * "Guardar" upserts non-zero amounts for the current month (keyed by the
 * single `currentMonthKey()` — NFR-2 device-local month) and deletes zero
 * amounts (clearing the budget = delete-on-zero). The batch is built by the
 * pure `budgetSavePayload` form helper; pre-filled with existing budget
 * amounts via `seedBudgetDrafts`.
 *
 * CRITICAL-1 (PR 7 re-gate): delete-on-zero is only safe when the payload
 * covers exactly the keys the user was SHOWN. Save is therefore blocked
 * while either read is incomplete (loading OR failed — a failed budgets
 * read renders the error instead of an editable all-empty form), and a
 * catalog that expands mid-draft merges its new keys into the drafts.
 */
export default function CategoryBudgetsScreen() {
  const { t } = useTranslation(['settings', 'common']);
  // NFR-2: month key must come from the device-local calendar
  // (`currentMonthKey`) so the saved month always equals the displayed
  // month — a UTC-derived month key diverges in UTC-x timezones at
  // month boundaries.
  const yearMonth = currentMonthKey();
  const {
    budgets,
    isLoading,
    error: budgetsError,
    save,
    isSaving,
  } = useCategoryBudgets(yearMonth);
  // PR 7: the editable key set is the same DYNAMIC catalog the budgets hook
  // consumes for rollover validKeys — one shared query key, so this second
  // mount resolves from cache without an extra network read.
  const { catalog, isLoading: catalogLoading } = useCategoryCatalog();

  // Editable rows: merged catalog keys once loaded, canonical keys while
  // unknown (pre-PR7 shape during the load window).
  const categoryKeys = useMemo(
    () => budgetKeysFromCatalog(catalog, Object.keys(EXPENSE_CATEGORIES)),
    [catalog],
  );

  // Local draft state: one string per category
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Sync drafts with server data until user input diverges. Persisted
  // amounts prefill; every catalog key (incl. freshly created custom rows)
  // starts empty.
  //
  // CRITICAL-1 (PR 7 re-gate): while the form is DIRTY the seed must not be
  // skipped wholesale — when the catalog expands mid-draft (a failed catalog
  // read fell back to the 13 canonical keys, the user typed, then a
  // background refetch healed and added custom keys this screen never
  // seeded), the NEW keys are merged into the drafts via
  // `mergeBudgetDraftSeeds`. A budget that already exists server-side must
  // be SEEN (seeded with its amount), never silently deleted by a zero
  // payload on save. Existing drafts are never overwritten.
  useEffect(() => {
    if (submitting) return;
    const initial = seedBudgetDrafts(categoryKeys, budgets);
    // Only replace the drafts object when the computed values actually
    // differ from the previous ones. Returning `prev` (same reference)
    // when unchanged prevents a fresh-object setState on every effect run,
    // which previously caused "Maximum update depth exceeded".
    setDrafts((prev) => {
      if (dirty) {
        return mergeBudgetDraftSeeds(prev, initial);
      }
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(initial);
      const same =
        prevKeys.length === nextKeys.length &&
        prevKeys.every((k) => prev[k] === initial[k]);
      return same ? prev : initial;
    });
  }, [budgets, categoryKeys, dirty, submitting]);

  const handleSave = async () => {
    // CRITICAL-1 (PR 7 re-gate): never build the save payload while a read
    // is incomplete. `budgetSavePayload` is pure and correct for its inputs,
    // but incomplete inputs map unseen keys to 0, and the API layer turns
    // amount <= 0 into delete-on-zero — a silent mass delete. The form hides
    // behind the spinner during loads but Guardar stays rendered, and a
    // FAILED budgets read would otherwise show an all-empty editable form;
    // both states must make the payload unmakable.
    //
    // Deliberate divergence from the visible `disabled` prop below:
    // `isLoading`/`catalogLoading` are intentionally NOT in the button's
    // disabled style — the spinner replaces the form during loads and
    // disabling the button for those two states would flash it during the
    // brief load window. This guard is the source of truth for loading;
    // DO NOT "simplify" disabled to include them without also keeping this
    // early return (a tap during load must remain a no-op, not a save).
    if (
      isLoading ||
      catalogLoading ||
      !!budgetsError ||
      isSaving ||
      submitting
    ) {
      return;
    }
    // Post-cutover (0039, revenuecat-trial-migration slice B + C): the
    // gate is binary (no 'frozen' state). The route-level gate blocks
    // frozen-trial users from reaching this screen — no per-action
    // `guard()` wrapper is needed. The previous `useFrozenGuard().guard()`
    // wrapper (migration 0035) is now a no-op pass-through; inlined for
    // clarity.
    setSubmitting(true);
    setError(null);

    // Every catalog row mapped to its parsed amount; empty/invalid inputs
    // become 0, which the API layer converts into delete-on-zero.
    const budgetsToSave = budgetSavePayload(categoryKeys, drafts);

    try {
      await save(budgetsToSave);
      router.back();
    } catch {
      setSubmitting(false);
      setError(t('settings:categoryBudgetSaveError'));
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t('common:back')}
        >
          <Icon name="arrow.left" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.title}>{t('settings:categoryBudgetsTitle')}</Text>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {isLoading || catalogLoading ? (
            <View style={styles.loadingWrap}>
              <Spinner size="sm" color={colors.primary} />
            </View>
          ) : budgetsError ? (
            <Text style={styles.error}>{budgetsError}</Text>
          ) : (
            <Card style={{ backgroundColor: colors.surface }}>
              {categoryKeys.map((key, index) => {
                const visual = resolveCategoryDisplay(catalog, key);
                return (
                  <View
                    key={key}
                    style={[
                      styles.row,
                      index < categoryKeys.length - 1 && styles.rowBorder,
                    ]}
                  >
                    <View style={styles.rowLeft}>
                      <View
                        style={[
                          styles.iconDot,
                          { backgroundColor: visual.background },
                        ]}
                      />
                      <Text style={styles.rowLabel}>{visual.label}</Text>
                    </View>
                    <TextInput
                      value={drafts[key] ?? ''}
                      onChangeText={(v) => {
                        setDirty(true);
                        setDrafts((prev) => ({
                          ...prev,
                          [key]: v.replace(/[^0-9]/g, ''),
                        }));
                      }}
                      keyboardType="number-pad"
                      inputMode="numeric"
                      maxLength={7}
                      placeholder="0"
                      placeholderTextColor={colors.textSecondary}
                      editable={!isSaving && !submitting}
                      style={styles.input}
                      accessibilityLabel={`${t(
                        'settings:categoryBudgetLabel',
                      )} ${visual.label}`}
                    />
                  </View>
                );
              })}
            </Card>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            onPress={handleSave}
            disabled={isSaving || submitting || !!budgetsError}
            accessibilityRole="button"
            accessibilityLabel={t('settings:saveCategoryBudgets')}
            style={({ pressed }) => [
              styles.saveButton,
              (isSaving || submitting || !!budgetsError) &&
                styles.saveButtonDisabled,
              pressed && styles.saveButtonPressed,
            ]}
          >
            {isSaving || submitting ? (
              <Spinner size="sm" color={colors.onPrimary} />
            ) : (
              <Text style={styles.saveButtonText}>{t('common:save')}</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  title: {
    ...typography.headlineLgMobile,
    color: colors.textPrimary,
  },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
    backgroundColor: colors.surface,
  },
  loadingWrap: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
    backgroundColor: colors.surface,
  },
  iconDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.surface,
  },
  rowLabel: {
    ...typography.bodyMd,
    color: colors.textPrimary,
    fontWeight: '500',
    backgroundColor: colors.surface,
  },
  input: {
    ...typography.bodyMd,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    boxShadow: '1px 2px 6px rgba(0, 0, 0, 0.3)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    minWidth: 80,
    textAlign: 'right',
  },
  error: {
    ...typography.labelSm,
    color: colors.danger,
  },
  saveButton: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonPressed: {
    opacity: 0.85,
  },
  saveButtonText: {
    ...typography.labelSm,
    color: colors.onPrimary,
    fontWeight: '700',
    fontSize: 15,
  },
});
