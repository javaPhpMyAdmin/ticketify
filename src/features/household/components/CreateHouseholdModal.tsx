/**
 * Create household modal — bottom sheet with a name input that
 * calls the `createHousehold` RPC on submit. Works on both iOS and Android
 * (unlike Alert.prompt which is iOS-only).
 *
 * On success the sheet closes first; the household store is only updated
 * after the dismissal animation finishes, so the parent screen never
 * swaps branches while this Modal is still animating.
 */
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { BottomSheet, Spinner, Text } from '@/components';
import { useSessionUser } from '@/features/auth';
import {
  createHousehold,
  READ_ERROR_MESSAGE,
} from '@/lib/supabase/feature-access';
import { queryClient } from '@/lib/query-client';
import { queryKeys } from '@/lib/query-keys';
import { useDialogStore } from '@/stores/use-dialog-store';
import { useHouseholdStore } from '@/stores/use-household-store';
import { useSettingsStore } from '@/stores/use-settings-store';
import { colors, radii, spacing, typography } from '@/theme';

/** Rough duration of the native slide-down animation. */
const DISMISS_ANIMATION_MS = 400;

export interface CreateHouseholdModalProps {
  visible: boolean;
  onClose: () => void;
}

export function CreateHouseholdModal({
  visible,
  onClose,
}: CreateHouseholdModalProps) {
  // PR 3 (`app-i18n`): title, helper, placeholder, a11y, button label,
  // and the success toast copy read from the `household` + `settings`
  // + `common` namespaces.
  const { t } = useTranslation(['household', 'settings', 'common']);
  const { userId } = useSessionUser();
  const setHouseholdSharing = useSettingsStore((s) => s.setHouseholdSharing);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (loading || !userId) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('household:householdCreateChooseName'));
      return;
    }
    setLoading(true);
    setError(null);
    const result = await createHousehold(trimmed);
    setLoading(false);
    if (result.status === 'ok') {
      // Close before touching any store: updating the household store
      // re-renders the parent into its "household" branch, and doing it
      // while this Modal is visible tears the native window down without
      // its dismissal animation (sheet freezes half-open).
      setName('');
      setError(null);
      onClose();
      setTimeout(() => {
        useHouseholdStore.getState().setHousehold(result.data, 'owner');
        useHouseholdStore.getState().setMembers([]);
        setHouseholdSharing(true);
        void queryClient.invalidateQueries({
          queryKey: queryKeys.household(userId),
        });
        // The sheet is already hidden by this point, so the dialog (a root
        // overlay View that paints below any open native Modal window) is
        // visible over the destination screen.
        useDialogStore.getState().show({
          title: t('settings:okShort'),
          message: t('household:householdCreatedSuccess', { name: trimmed }),
          primaryLabel: t('common:ok'),
        });
      }, DISMISS_ANIMATION_MS);
    } else {
      setError(
        result.status === 'error'
          ? result.message
          : READ_ERROR_MESSAGE(),
      );
    }
  };

  const handleClose = () => {
    setName('');
    setError(null);
    onClose();
  };

  const isValid = name.trim().length >= 2;

  return (
    <BottomSheet
      visible={visible}
      onClose={handleClose}
      title={t('household:householdCreate')}
      closeIcon="text"
      keyboardMode="avoidingView"
      headerCentered
    >
      <View style={styles.body}>
        <Text style={styles.helper}>
          {t('household:householdCreateHelper')}
        </Text>

        <TextInput
          value={name}
          onChangeText={(v) => {
            setName(v);
            setError(null);
          }}
          placeholder={t('settings:householdNamePlaceholder')}
          placeholderTextColor={colors.textSecondary}
          maxLength={30}
          autoCorrect={false}
          editable={!loading}
          style={styles.input}
          accessibilityLabel={t('settings:householdNameLabel')}
          returnKeyType="done"
          blurOnSubmit
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          onPress={handleCreate}
          disabled={!isValid || loading}
          style={({ pressed }) => [
            styles.createButton,
            (!isValid || loading) && styles.createButtonDisabled,
            pressed && styles.createButtonPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={t('household:householdCreateA11y')}
        >
          {loading ? (
            <Spinner size="sm" color={colors.onPrimary} />
          ) : (
            <Text style={styles.createButtonText}>{t('household:householdCreateAction')}</Text>
          )}
        </Pressable>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  helper: {
    ...typography.bodyMd,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  input: {
    ...typography.bodyMd,
    fontSize: 18,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    textAlign: 'center',
    fontWeight: '600',
  },
  error: {
    ...typography.labelSm,
    color: colors.danger,
    textAlign: 'center',
  },
  createButton: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  createButtonDisabled: {
    opacity: 0.5,
  },
  createButtonPressed: {
    opacity: 0.85,
  },
  createButtonText: {
    ...typography.labelSm,
    color: colors.onPrimary,
    fontWeight: '700',
    fontSize: 15,
  },
});
