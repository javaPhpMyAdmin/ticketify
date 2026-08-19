import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card, Icon, Pressable, Spinner, Text, View } from '@/components';
import { useCategoryBudgets } from '@/features/analytics';
import {
  EXPENSE_CATEGORIES,
  type ExpenseCategoryKey,
} from '@/features/home/categories';
import { useFrozenGuard } from '@/features/pro';
import { utcYearMonth } from '@/lib/query-keys';
import { colors, radii, spacing, typography } from '@/theme';

/**
 * Full-screen per-category budget editor reached from the profile screen's
 * "Presupuestos por categoría" row (`/settings/category-budgets`).
 *
 * Lists all 13 canonical categories from `EXPENSE_CATEGORIES` with numeric
 * inputs. "Guardar" upserts non-zero amounts for the current month and
 * deletes zero amounts (clearing the budget). Pre-filled with existing
 * budget amounts from the `category_budgets` table.
 */
export default function CategoryBudgetsScreen() {
  const yearMonth = utcYearMonth();
  const { budgets, isLoading, save, isSaving } = useCategoryBudgets(yearMonth);
  const { guard } = useFrozenGuard();

  // Build a map of category_slug → existing amount
  const existingMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const b of budgets) {
      map[b.category_slug] = b.amount;
    }
    return map;
  }, [budgets]);

  // Local draft state: one string per category
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Sync drafts with server data until user touches the form
  useEffect(() => {
    if (dirty || submitting) return;
    const initial: Record<string, string> = {};
    for (const key of Object.keys(EXPENSE_CATEGORIES)) {
      const existing = existingMap[key];
      initial[key] = existing !== undefined ? String(existing) : '';
    }
    setDrafts(initial);
  }, [existingMap, dirty, submitting]);

  const categoryKeys = useMemo(
    () => Object.keys(EXPENSE_CATEGORIES) as ExpenseCategoryKey[],
    [],
  );

  const handleSave = async () => {
    if (isSaving || submitting) return;
    return guard(async () => {
      setSubmitting(true);
      setError(null);

      const budgetsToSave = categoryKeys.map((key) => {
        const raw = drafts[key] ?? '';
        const parsed = Number.parseInt(raw, 10);
        const amount =
          raw.trim() !== '' && Number.isFinite(parsed) && parsed >= 0
            ? parsed
            : 0;
        return { category_slug: key, amount };
      });

      try {
        await save(budgetsToSave);
        router.back();
      } catch {
        setSubmitting(false);
        setError('No se pudieron guardar los presupuestos. Inténtalo de nuevo.');
      }
    });
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Volver"
        >
          <Icon name="arrow.left" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.title}>Presupuestos por categoría</Text>
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
          {isLoading ? (
            <View style={styles.loadingWrap}>
              <Spinner size="sm" color={colors.primary} />
            </View>
          ) : (
            <Card>
              {categoryKeys.map((key, index) => {
                const cat = EXPENSE_CATEGORIES[key];
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
                          { backgroundColor: cat.background },
                        ]}
                      />
                      <Text style={styles.rowLabel}>{cat.label}</Text>
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
                      accessibilityLabel={`Presupuesto ${cat.label}`}
                    />
                  </View>
                );
              })}
            </Card>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            onPress={handleSave}
            disabled={isSaving || submitting}
            accessibilityRole="button"
            accessibilityLabel="Guardar presupuestos"
            style={({ pressed }) => [
              styles.saveButton,
              (isSaving || submitting) && styles.saveButtonDisabled,
              pressed && styles.saveButtonPressed,
            ]}
          >
            {isSaving || submitting ? (
              <Spinner size="sm" color={colors.onPrimary} />
            ) : (
              <Text style={styles.saveButtonText}>Guardar</Text>
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
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  iconDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  rowLabel: {
    ...typography.bodyMd,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  input: {
    ...typography.bodyMd,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
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
