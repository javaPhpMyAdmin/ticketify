/**
 * Pro charts placeholder (pro-subscription spec — REQ-CHART-1+).
 *
 * Wraps its body in `<ProRouteGuard>` so the screen mounts behind the
 * Pro gate. The placeholder copy makes the deferred status explicit
 * (charts ship in a later slice — M6.3) so a Pro user opening the
 * screen during the rollout understands why the area is empty.
 *
 * The "Volver" button returns to the previous screen; `router.back()`
 * is the right action because the route was pushed from the analytics
 * charts entry card or the charts tab.
 */
import { Stack, router } from 'expo-router';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon, Pressable, Text, View } from '@/components';
import { ProRouteGuard } from '@/features/pro';
import { colors, spacing, typography } from '@/theme';

export default function ChartsScreen() {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <Stack.Screen options={{ title: 'Estadísticas Pro' }} />
      <ProRouteGuard
        lockTitle="Estadísticas Pro"
        lockBody="Las gráficas avanzadas están incluidas en Pro. Suscribite para desbloquearlas."
        lockActionLabel="Conocer Pro"
      >
        <View style={styles.content}>
          <View style={styles.iconCircle}>
            <Icon name="chart.bar.fill" size={36} color={colors.primary} />
          </View>
          <Text style={styles.title}>Las gráficas llegan en una próxima actualización</Text>
          <Text style={styles.body}>
            Estamos preparando las visualizaciones Pro. Vuelve pronto para ver
            tendencias de gasto, categorías y tiendas.
          </Text>
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Volver"
            style={({ pressed }) => [styles.backButton, pressed && styles.backPressed]}
          >
            <Text style={styles.backText}>Volver</Text>
          </Pressable>
        </View>
      </ProRouteGuard>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...typography.headlineMd,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  body: {
    ...typography.bodyMd,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  backButton: {
    marginTop: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  backPressed: {
    opacity: 0.85,
  },
  backText: {
    ...typography.bodyMd,
    color: colors.onPrimary,
    fontWeight: '700',
  },
});
