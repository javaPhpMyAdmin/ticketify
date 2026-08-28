/**
 * Create household modal — bottom sheet with a name input that
 * calls the `createHousehold` RPC on submit. Works on both iOS and Android
 * (unlike Alert.prompt which is iOS-only).
 *
 * On success the sheet closes first; the household store is only updated
 * after the dismissal animation finishes, so the parent screen never
 * swaps branches while this Modal is still animating.
 */
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState } from 'react';

import { Spinner, Text } from '@/components';
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
  const { userId } = useSessionUser();
  const setHouseholdSharing = useSettingsStore((s) => s.setHouseholdSharing);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (loading || !userId) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Elegí un nombre para tu hogar.');
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
          title: '¡Listo!',
          message: `Creaste el hogar "${trimmed}".`,
          primaryLabel: 'Aceptar',
        });
      }, DISMISS_ANIMATION_MS);
    } else {
      setError(
        result.status === 'error'
          ? result.message
          : READ_ERROR_MESSAGE,
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
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.backdrop}
      >
        <Pressable style={styles.backdropTouch} onPress={handleClose} />
        <SafeAreaView style={styles.sheet} edges={['bottom']}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.kicker}>Crear hogar</Text>
            <Pressable
              onPress={handleClose}
              hitSlop={12}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel="Cerrar"
            >
              <Text style={styles.closeX}>✕</Text>
            </Pressable>
          </View>

          <View style={styles.body}>
            <Text style={styles.helper}>
              Elegí un nombre para identificar a tu hogar (ej: &quot;Familia Pérez&quot;).
            </Text>

            <TextInput
              value={name}
              onChangeText={(v) => {
                setName(v);
                setError(null);
              }}
              placeholder="Mi hogar"
              placeholderTextColor={colors.textSecondary}
              maxLength={30}
              autoCorrect={false}
              editable={!loading}
              style={styles.input}
              accessibilityLabel="Nombre del hogar"
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
              accessibilityLabel="Crear hogar"
            >
              {loading ? (
                <Spinner size="sm" color={colors.onPrimary} />
              ) : (
                <Text style={styles.createButtonText}>Crear</Text>
              )}
            </Pressable>
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  backdropTouch: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    paddingTop: spacing.sm,
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
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },
  kicker: {
    ...typography.headlineMd,
    color: colors.textPrimary,
  },
  closeButton: {
    padding: spacing.xs,
  },
  closeX: {
    fontSize: 20,
    color: colors.textSecondary,
    fontWeight: '600',
  },
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
