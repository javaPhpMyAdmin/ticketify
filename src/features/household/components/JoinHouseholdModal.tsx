/**
 * Join household modal — bottom sheet with a 6-char code input that
 * calls the `joinHousehold` RPC on submit.
 */
import {
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState } from 'react';

import { Icon, Spinner, Text } from '@/components';
import { useSessionUser } from '@/features/auth';
import { joinHousehold } from '@/lib/supabase/feature-access';
import { useDialogStore } from '@/stores/use-dialog-store';
import { colors, radii, spacing, typography } from '@/theme';

export interface JoinHouseholdModalProps {
  visible: boolean;
  onClose: () => void;
}

/** Rough duration of the native slide-down animation. */
const DISMISS_ANIMATION_MS = 400;

/**
 * Bottom-sheet modal for joining a household via a 6-char invite code.
 * Auto-uppercases input, calls `joinHousehold` on submit, and shows
 * error states for common failure scenarios.
 */
export function JoinHouseholdModal({ visible, onClose }: JoinHouseholdModalProps) {
  const { userId } = useSessionUser();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleJoin = async () => {
    if (loading || !userId) return;
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length !== 6) {
      setError('El código debe tener 6 caracteres.');
      return;
    }
    setLoading(true);
    setError(null);
    const result = await joinHousehold(trimmed);
    setLoading(false);
    if (result.status === 'ok') {
      // Close the sheet BEFORE showing the dialog: DialogHost is a root
      // overlay View, which paints BELOW an open native Modal window — a
      // dialog shown while the sheet is still up would be invisible. Reuse
      // CreateHouseholdModal's pattern: confirm after the dismissal
      // animation finishes.
      setCode('');
      onClose();
      setTimeout(() => {
        useDialogStore.getState().show({
          title: '¡Listo!',
          message: 'Te uniste al hogar.',
          primaryLabel: 'Aceptar',
        });
      }, DISMISS_ANIMATION_MS);
    } else {
      setError(
        result.status === 'error'
          ? result.message
          : 'No se pudo unir al hogar. Verificá el código.',
      );
    }
  };

  const handleClose = () => {
    setCode('');
    setError(null);
    onClose();
  };

  const isValid = code.trim().length === 6;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTouch} onPress={handleClose} />
        <SafeAreaView style={styles.sheet} edges={['bottom']}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.kicker}>Unirse a un hogar</Text>
            <Pressable
              onPress={handleClose}
              hitSlop={12}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel="Cerrar"
            >
              <Icon name="xmark" size={22} color={colors.textPrimary} />
            </Pressable>
          </View>

          <View style={styles.body}>
            <Text style={styles.helper}>
              Pedile el código de 6 caracteres a quien creó el hogar.
            </Text>

            <TextInput
              value={code}
              onChangeText={(v) => {
                setCode(v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6));
                setError(null);
              }}
              placeholder="ABC123"
              placeholderTextColor={colors.textSecondary}
              maxLength={6}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!loading}
              style={styles.input}
              accessibilityLabel="Código de invitación"
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              onPress={handleJoin}
              disabled={!isValid || loading}
              style={({ pressed }) => [
                styles.joinButton,
                (!isValid || loading) && styles.joinButtonDisabled,
                pressed && styles.joinButtonPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Unirse al hogar"
            >
              {loading ? (
                <Spinner size="sm" color={colors.onPrimary} />
              ) : (
                <Text style={styles.joinButtonText}>Unirse</Text>
              )}
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
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
    ...typography.displayCurrency,
    fontSize: 28,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    textAlign: 'center',
    letterSpacing: 4,
    fontWeight: '700',
  },
  error: {
    ...typography.labelSm,
    color: colors.danger,
    textAlign: 'center',
  },
  joinButton: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  joinButtonDisabled: {
    opacity: 0.5,
  },
  joinButtonPressed: {
    opacity: 0.85,
  },
  joinButtonText: {
    ...typography.labelSm,
    color: colors.onPrimary,
    fontWeight: '700',
    fontSize: 15,
  },
});
