import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card, FieldGroup, Icon, Pressable, Spinner, Text, View } from '@/components';
import { useProfile } from '@/features/profile';
import { useSettingsStore } from '@/stores/use-settings-store';
import { colors, radii, spacing, typography } from '@/theme';

/**
 * Full-screen budget editor reached from the profile screen's
 * "Presupuesto mensual" row (`/settings/budget`).
 *
 * Lets the user replace `profiles.monthly_budget` with a new whole-number
 * amount. The input is pre-filled with the current profile value (via
 * `useProfile().user.monthly_budget`) and writes through
 * `useProfile().setBudget`, which:
 *
 * - persists to Supabase scoped to `auth.uid() = id`;
 * - invalidates the profile and budget queries so the home budget card
 *   and this screen re-read the new limit on next render;
 * - returns the standard `ProfileWriteResult` (the same one the currency
 *   editor uses — generic user-safe copy on failure, never raw PostgREST).
 *
 * The screen is keyboard-aware via `KeyboardAvoidingView`: the input is the
 * only field, so a single offset is enough to keep it above the keyboard on
 * both platforms (the currency screen uses the same pattern).
 */
export default function BudgetEditorScreen() {
  const { user, setBudget } = useProfile();
  const currency = useSettingsStore((s) => s.currency);

  // Local string state so the user can clear the field and retype; an empty
  // string is a valid intermediate state and is sent as 0 only on save.
  const [draft, setDraft] = useState<string>(
    user ? String(user.monthly_budget) : '',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The profile query loads after the screen mounts; keep the draft in sync
  // with the server value until the user touches it. A touch ("dirty") is
  // approximated by `saving` or any focused state — for this single-input
  // form we just don't overwrite after first interaction, which the dirty
  // sentinel below tracks with an effect flag.
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (dirty || saving) return;
    if (user) setDraft(String(user.monthly_budget));
  }, [user, dirty, saving]);

  const parsed = Number.parseInt(draft, 10);
  const valid =
    draft.trim() !== '' && Number.isFinite(parsed) && parsed >= 0;

  const handleSave = async () => {
    if (saving || !valid) return;
    setSaving(true);
    setError(null);
    const result = await setBudget(parsed);
    if (result.status === 'ok') {
      router.back();
    } else {
      setSaving(false);
      setError(result.message);
    }
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
        <Text style={styles.title}>Presupuesto mensual</Text>
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
          <Card>
            <FieldGroup
              label={`Monto (${currency})`}
              helper="Monto máximo que querés gastar este mes."
              error={error ?? undefined}
            >
              <TextInput
                value={draft}
                onChangeText={(v) => {
                  setDirty(true);
                  setDraft(v.replace(/[^0-9]/g, ''));
                }}
                keyboardType="number-pad"
                inputMode="numeric"
                maxLength={9}
                placeholder="0"
                placeholderTextColor={colors.textSecondary}
                editable={!saving}
                style={styles.input}
                accessibilityLabel="Monto del presupuesto"
              />
            </FieldGroup>
          </Card>

          <Pressable
            onPress={handleSave}
            disabled={!valid || saving}
            accessibilityRole="button"
            accessibilityLabel="Guardar presupuesto"
            style={({ pressed }) => [
              styles.saveButton,
              (!valid || saving) && styles.saveButtonDisabled,
              pressed && styles.saveButtonPressed,
            ]}
          >
            {saving ? (
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
  input: {
    ...typography.headlineMd,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
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