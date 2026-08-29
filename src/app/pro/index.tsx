/**
 * Pro paywall screen (pro-subscription spec — REQ-PRO-2..5).
 *
 * Reachable from any Pro-locked affordance (the `ProLock` CTA, the
 * profile's export row when free, the charts entry card when free).
 * Session-gated only (free users MUST be able to reach it), so it sits
 * inside the same `Stack.Protected` as the rest of the signed-in app.
 *
 * State machine:
 *
 *   - `loading` — initial fetch of offerings in flight.
 *   - `ready` — offerings available; user can tap "Suscribirse".
 *   - `purchasing` — a purchase / restore is in flight.
 *   - `error` — offerings or purchase failed; user can retry.
 *
 * On a successful purchase the screen calls `useProEntitlement().refresh()`
 * so the gate flips to `'unlocked'` and any screen behind a
 * `ProRouteGuard` re-renders its children in place.
 */
import { Stack, router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  Card,
  Divider,
  Icon,
  Pressable,
  Spinner,
  Text,
  View,
} from '@/components';
import { useProEntitlement } from '@/features/pro';
import { startFreeTrial, syncSubscriptionStatus } from '@/lib/supabase/feature-access';
import { useProStore } from '@/stores/use-pro-store';
import {
  getOfferings,
  isNativeAvailable,
  purchasePackage,
  restorePurchases,
} from '@/lib/revenuecat';
import { colors, radii, spacing, typography } from '@/theme';

type PaywallState = 'loading' | 'ready' | 'purchasing' | 'error';

interface OfferingsView {
  monthly: string | null;
  annual: string | null;
}

export default function PaywallScreen() {
  const { refresh, subscriptionStatus, trialEndsAt, isFrozen, daysRemaining, everPaid } =
    useProEntitlement();
  const setSubscriptionState = useProStore((s) => s.setSubscriptionState);
  const [state, setState] = useState<PaywallState>('loading');
  const [offerings, setOfferings] = useState<OfferingsView | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [trialLoading, setTrialLoading] = useState(false);

  const loadOfferings = useCallback(async () => {
    setState('loading');
    setErrorMessage(null);
    if (!isNativeAvailable()) {
      setErrorMessage('Compras no disponibles en este entorno.');
      setState('error');
      return;
    }
    const next = await getOfferings();
    if (!next) {
      setErrorMessage('No pudimos cargar los planes. Reintentá.');
      setState('error');
      return;
    }
    setOfferings(next);
    setState('ready');
  }, []);

  useEffect(() => {
    void loadOfferings();
  }, [loadOfferings]);

  const handlePurchase = async (identifier: string) => {
    if (state === 'purchasing') return;
    setState('purchasing');
    setErrorMessage(null);
    const result = await purchasePackage(identifier);
    if (!result.ok) {
      setErrorMessage(result.error ?? 'No se pudo completar la compra.');
      setState('error');
      return;
    }
    // Optimistically sync subscription_status to the DB before the
    // RevenueCat webhook arrives. Non-blocking: if this fails, the
    // webhook will reconcile the state.
    if (result.isPro) {
      void syncSubscriptionStatus('active');
    }
    await refresh();
    if (result.isPro) {
      router.back();
    } else {
      setErrorMessage(
        'La compra se completó, pero la suscripción aún no se refleja. Reintentá en unos segundos.',
      );
      setState('error');
    }
  };

  const handleRestore = async () => {
    if (restoring || state === 'purchasing') return;
    setRestoring(true);
    setErrorMessage(null);
    const result = await restorePurchases();
    setRestoring(false);
    if (!result.ok) {
      setErrorMessage(result.error ?? 'No se pudo restaurar la compra.');
      setState('error');
      return;
    }
    // Optimistically sync subscription_status to the DB after restore.
    // Non-blocking: the webhook will reconcile if this fails.
    if (result.isPro) {
      void syncSubscriptionStatus('active');
    }
    await refresh();
    if (result.isPro) {
      router.back();
    } else {
      setErrorMessage('No encontramos compras activas para tu cuenta.');
      setState('error');
    }
  };

  const handleStartTrial = async () => {
    if (trialLoading) return;
    setTrialLoading(true);
    setErrorMessage(null);
    const result = await startFreeTrial();
    setTrialLoading(false);
    if (result.status === 'error') {
      setErrorMessage(
        result.message.includes('already')
          ? 'Ya usaste tu prueba gratuita.'
          : 'No se pudo activar la prueba. Inténtalo de nuevo.',
      );
      setState('error');
      return;
    }
    if (result.status === 'ok') {
      // Set trial state in the store so the gate flips immediately.
      const now = new Date();
      const trialEnd = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
      setSubscriptionState('trial', trialEnd.toISOString());
      router.back();
    }
  };

  // Can start trial: not pro, no active trial, no previous trial (trial_ends_at is null)
  // and never ever paid (a former paid user cannot start a free trial again, 0021).
  const canStartTrial =
    subscriptionStatus === 'none' &&
    trialEndsAt === null &&
    !isFrozen &&
    !everPaid;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <Stack.Screen options={{ title: 'Pro', headerShown: true }} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Suscribite a Pro</Text>
          <Text style={styles.subtitle}>
            Desbloqueá todas las funciones con un pago único mensual o anual.
          </Text>
        </View>

        <Card style={styles.benefitsCard}>
          <Benefit icon="qr-code-scanner" label="Escaneos ilimitados" />
          <Divider />
          <Benefit icon="chart.bar.fill" label="Estadísticas avanzadas" />
          <Divider />
          <Benefit icon="square.and.arrow.up" label="Exportar recibos" />
          <Divider />
          <Benefit icon="bolt.fill" label="Alertas de precio" />
        </Card>

        {/* ── Trial expired message ── */}
        {isFrozen ? (
          <View style={styles.expiredCard}>
            <Icon
              name="clock.fill"
              size={24}
              color={colors.danger}
            />
            <View style={styles.expiredContent}>
              <Text style={styles.expiredTitle}>
                Tu prueba gratuita expiró
              </Text>
              {trialEndsAt ? (
                <Text style={styles.expiredSubtitle}>
                  Tu acceso finalizó el{' '}
                  {new Date(trialEndsAt).toLocaleDateString('es-AR', {
                    day: 'numeric',
                    month: 'long',
                  })}
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}

        {/* ── Active trial countdown ── */}
        {subscriptionStatus === 'trial' && !isFrozen ? (
          <View style={styles.trialActiveCard}>
            <Icon name="sparkles" size={20} color={colors.primary} />
            <Text style={styles.trialActiveText}>
              Tu prueba PRO está activa — {daysRemaining}{' '}
              {daysRemaining === 1 ? 'día restante' : 'días restantes'}
            </Text>
          </View>
        ) : null}

        {/* ── Start free trial CTA ── */}
        {canStartTrial ? (
          <Pressable
            onPress={handleStartTrial}
            disabled={trialLoading || state === 'purchasing'}
            accessibilityRole="button"
            accessibilityLabel="Empezar prueba gratis"
            style={({ pressed }) => [
              styles.trialButton,
              pressed && styles.trialButtonPressed,
              (trialLoading || state === 'purchasing') &&
                styles.trialButtonBusy,
            ]}
          >
            {trialLoading ? (
              <Spinner size="sm" color={colors.primary} />
            ) : (
              <View style={styles.trialButtonContent}>
                <Text style={styles.trialButtonText}>
                  Empezar prueba gratis
                </Text>
                <Text style={styles.trialButtonSubtitle}>
                  5 días gratis
                </Text>
              </View>
            )}
          </Pressable>
        ) : null}

        {state === 'loading' ? (
          <View style={styles.loadingRow}>
            <Spinner size="sm" color={colors.primary} />
            <Text style={styles.loadingText}>Cargando planes…</Text>
          </View>
        ) : null}

        {state !== 'loading' && offerings ? (
          <View style={styles.plans}>
            {offerings.monthly ? (
              <PlanButton
                label="Mensual"
                onPress={() => handlePurchase(offerings.monthly!)}
                busy={state === 'purchasing'}
              />
            ) : null}
            {offerings.annual ? (
              <PlanButton
                label="Anual"
                emphasis
                onPress={() => handlePurchase(offerings.annual!)}
                busy={state === 'purchasing'}
              />
            ) : null}
            {!offerings.monthly && !offerings.annual ? (
              <Text style={styles.emptyPlans}>
                No hay planes disponibles por el momento.
              </Text>
            ) : null}
          </View>
        ) : null}

        {state === 'error' && errorMessage ? (
          <View style={styles.errorRow}>
            <Icon
              name="exclamationmark.triangle.fill"
              size={18}
              color={colors.danger}
            />
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

        <Pressable
          onPress={handleRestore}
          disabled={restoring || state === 'purchasing'}
          accessibilityRole="button"
          accessibilityLabel="Restaurar compras"
          style={({ pressed }) => [
            styles.restoreButton,
            pressed && styles.restorePressed,
          ]}
        >
          {restoring ? (
            <Spinner size="sm" color={colors.primary} />
          ) : (
            <Text style={styles.restoreText}>Restaurar compras</Text>
          )}
        </Pressable>

        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Cancelar"
          style={({ pressed }) => [
            styles.cancelButton,
            pressed && styles.cancelPressed,
          ]}
        >
          <Text style={styles.cancelText}>Cancelar</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

interface BenefitProps {
  icon: Parameters<typeof Icon>[0]['name'];
  label: string;
}

function Benefit({ icon, label }: BenefitProps) {
  return (
    <View style={styles.benefitRow}>
      <Icon name={icon} size={20} color={colors.primary} />
      <Text style={styles.benefitLabel}>{label}</Text>
    </View>
  );
}

interface PlanButtonProps {
  label: string;
  emphasis?: boolean;
  onPress: () => void;
  busy: boolean;
}

function PlanButton({ label, emphasis, onPress, busy }: PlanButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={`Suscribirse ${label}`}
      style={({ pressed }) => [
        styles.planButton,
        emphasis && styles.planButtonEmphasis,
        pressed && styles.planButtonPressed,
        busy && styles.planButtonBusy,
      ]}
    >
      {busy ? (
        <Spinner size="sm" color={emphasis ? colors.onPrimary : colors.primary} />
      ) : (
        <Text
          style={[
            styles.planButtonText,
            emphasis && styles.planButtonTextEmphasis,
          ]}
        >
          Suscribirse · {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  header: {
    gap: spacing.sm,
  },
  title: {
    ...typography.headlineLg,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.bodyMd,
    color: colors.textSecondary,
  },
  benefitsCard: {
    paddingVertical: spacing.xs,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  benefitLabel: {
    ...typography.bodyLg,
    color: colors.textPrimary,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  loadingText: {
    ...typography.bodyMd,
    color: colors.textSecondary,
  },
  plans: {
    gap: spacing.md,
  },
  planButton: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radii.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planButtonEmphasis: {
    backgroundColor: colors.primary,
  },
  planButtonPressed: {
    opacity: 0.85,
  },
  planButtonBusy: {
    opacity: 0.7,
  },
  planButtonText: {
    ...typography.bodyLg,
    color: colors.primary,
    fontWeight: '700',
  },
  planButtonTextEmphasis: {
    color: colors.onPrimary,
  },
  emptyPlans: {
    ...typography.bodyMd,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  errorText: {
    ...typography.bodyMd,
    color: colors.danger,
    flex: 1,
  },
  restoreButton: {
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  restorePressed: {
    opacity: 0.7,
  },
  restoreText: {
    ...typography.bodyMd,
    color: colors.primary,
    fontWeight: '700',
  },
  cancelButton: {
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelPressed: {
    opacity: 0.7,
  },
  cancelText: {
    ...typography.bodyMd,
    color: colors.textSecondary,
  },
  // ── Trial CTA ──
  trialButton: {
    borderWidth: 2,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    borderRadius: radii.lg,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trialButtonPressed: {
    opacity: 0.85,
  },
  trialButtonBusy: {
    opacity: 0.7,
  },
  trialButtonContent: {
    alignItems: 'center',
    gap: 2,
  },
  trialButtonText: {
    ...typography.bodyLg,
    color: colors.primary,
    fontWeight: '700',
  },
  trialButtonSubtitle: {
    ...typography.labelSm,
    color: colors.primaryDark,
  },
  // ── Trial expired ──
  expiredCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  expiredContent: {
    flex: 1,
    gap: 2,
  },
  expiredTitle: {
    ...typography.bodyLg,
    fontWeight: '700',
    color: colors.danger,
  },
  expiredSubtitle: {
    ...typography.labelSm,
    color: colors.textSecondary,
  },
  // ── Active trial countdown ──
  trialActiveCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primaryContainer,
    borderRadius: radii.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  trialActiveText: {
    ...typography.bodyMd,
    fontWeight: '600',
    color: colors.primaryDark,
    flex: 1,
  },
});
