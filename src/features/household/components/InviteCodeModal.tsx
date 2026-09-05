/**
 * Invite code modal — bottom sheet that shows the household's reusable
 * invite code on open (read-first: reuses the most recent unconsumed code
 * and only generates a new one when none exists), with copy + share.
 */
import {
  Modal,
  Pressable,
  Share,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';

import { Icon, Spinner, Text } from '@/components';
import { useSessionUser } from '@/features/auth';
import {
  generateInviteCode,
  READ_ERROR_MESSAGE,
  readActiveInviteCode,
} from '@/lib/supabase/feature-access';
import { useDialogStore } from '@/stores/use-dialog-store';
import { useHouseholdStore } from '@/stores/use-household-store';
import { colors, radii, spacing, typography } from '@/theme';

export interface InviteCodeModalProps {
  visible: boolean;
  onClose: () => void;
}

/** Rough duration of the native slide-down animation. */
const DISMISS_ANIMATION_MS = 400;

/**
 * Bottom-sheet modal that shows a household invite code. On open it READ-FIRST
 * reuses the most recent unconsumed/unexpired code (readActiveInviteCode) and
 * only calls `generateInviteCode` when no active code exists — the RPC
 * rate-limits to 3 unconsumed codes per 24h, so generating on every open
 * would eventually dead-end the user. Shows the 6-char code with copy and
 * share buttons, and displays the expiry window ("Vence en 72h").
 */
export function InviteCodeModal({ visible, onClose }: InviteCodeModalProps) {
  const { userId } = useSessionUser();
  const householdId = useHouseholdStore((s) => s.household?.id);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !householdId || !userId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      // Read-first: reuse an existing unconsumed/unexpired code instead of
      // generating a new one every time the sheet opens. The RPC rate-limits
      // to 3 unconsumed codes per 24h, so blind generation on open would
      // eventually dead-end the user with a rate-limit error.
      const active = await readActiveInviteCode(householdId);
      if (cancelled) return;
      if (active.status === 'ok' && active.data) {
        setCode(active.data.code);
        useHouseholdStore.getState().setInviteCode(active.data);
      } else if (active.status === 'ok') {
        // No reusable code — generate a fresh one (the common case on the
        // first open; afterwards the read above reuses it).
        const result = await generateInviteCode(householdId);
        if (cancelled) return;
        if (result.status === 'ok') {
          setCode(result.data.code);
          useHouseholdStore.getState().setInviteCode(result.data);
        } else {
          setError(
            result.status === 'error'
              ? result.message
              : 'No se pudo generar el código.',
          );
        }
      } else if (active.status === 'error') {
        // A read failure is likely network — show the error, do NOT retry
        // generation blindly (it would consume a rate-limit slot).
        setError(active.message);
      } else {
        // unconfigured client — reads are impossible; generic read copy.
        setError(READ_ERROR_MESSAGE);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, householdId, userId]);

  const handleClose = () => {
    setCode(null);
    setError(null);
    useHouseholdStore.getState().setInviteCode(null);
    onClose();
  };

  const copyCode = async () => {
    if (!code) return;
    await Clipboard.setStringAsync(code);
    // Close the sheet BEFORE the confirmation: DialogHost paints as a root
    // overlay View, which sits BELOW an open native Modal window — a dialog
    // shown while the sheet is still up would be invisible. Tradeoff vs the
    // old native Alert (which floated above the sheet): the sheet closes on
    // copy and the confirm appears after its dismissal animation.
    handleClose();
    setTimeout(() => {
      useDialogStore.getState().show({
        title: 'Copiado',
        message: 'Compartí el código con quien quieras invitar.',
        primaryLabel: 'Aceptar',
      });
    }, DISMISS_ANIMATION_MS);
  };

  const shareCode = async () => {
    if (!code) return;
    await Share.share({
      message: `Unite a mi hogar en Ticketify con este código: ${code}`,
    });
  };

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
            <Text style={styles.kicker}>Invitar a mi hogar</Text>
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
            {loading ? (
              <View style={styles.loadingWrap}>
                <Spinner size="sm" color={colors.primary} />
                <Text style={styles.loadingText}>Generando código...</Text>
              </View>
            ) : error ? (
              <Text style={styles.error}>{error}</Text>
            ) : code ? (
              <>
                <Text style={styles.code}>{code}</Text>
                <Text style={styles.expiry}>Vence en 72h</Text>

                <View style={styles.actions}>
                  <Pressable
                    onPress={copyCode}
                    style={({ pressed }) => [
                      styles.primaryButton,
                      pressed && styles.primaryButtonPressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Copiar código"
                  >
                    <Icon
                      name="doc.on.doc"
                      size={18}
                      color={colors.onPrimary}
                    />
                    <Text style={styles.primaryButtonText}>Copiar</Text>
                  </Pressable>

                  <Pressable
                    onPress={shareCode}
                    style={({ pressed }) => [
                      styles.secondaryButton,
                      pressed && styles.secondaryButtonPressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Compartir código"
                  >
                    <Icon
                      name="square.and.arrow.up"
                      size={18}
                      color={colors.textPrimary}
                    />
                    <Text style={styles.secondaryButtonText}>Compartir</Text>
                  </Pressable>
                </View>
              </>
            ) : null}
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
    alignItems: 'center',
    gap: spacing.lg,
  },
  loadingWrap: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    gap: spacing.md,
  },
  loadingText: {
    ...typography.bodyMd,
    color: colors.textSecondary,
  },
  error: {
    ...typography.labelSm,
    color: colors.danger,
    textAlign: 'center',
  },
  code: {
    ...typography.displayCurrency,
    fontSize: 36,
    color: colors.primary,
    letterSpacing: 8,
    fontWeight: '800',
    textAlign: 'center',
  },
  expiry: {
    ...typography.labelSm,
    color: colors.textSecondary,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    width: '100%',
    marginTop: spacing.sm,
  },
  primaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  primaryButtonPressed: {
    opacity: 0.85,
  },
  primaryButtonText: {
    ...typography.labelSm,
    color: colors.onPrimary,
    fontWeight: '700',
    fontSize: 15,
  },
  secondaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  secondaryButtonPressed: {
    opacity: 0.85,
  },
  secondaryButtonText: {
    ...typography.labelSm,
    color: colors.textPrimary,
    fontWeight: '700',
    fontSize: 15,
  },
});
