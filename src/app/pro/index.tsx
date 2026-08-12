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
  const { refresh } = useProEntitlement();
  const [state, setState] = useState<PaywallState>('loading');
  const [offerings, setOfferings] = useState<OfferingsView | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

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
    await refresh();
    if (result.isPro) {
      router.back();
    } else {
      setErrorMessage('No encontramos compras activas para tu cuenta.');
      setState('error');
    }
  };

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
});
