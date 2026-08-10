import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card, Divider, Icon, Pressable, Text, View } from '@/components';
import { useProfile } from '@/features/profile';
import { useSettingsStore } from '@/stores/use-settings-store';
import { colors, spacing, typography } from '@/theme';

/**
 * The currencies the app offers (ISO 4217 codes). The labels are
 * user-facing Spanish copy, matching the app's neutral Spanish style.
 */
const CURRENCIES: ReadonlyArray<{ code: string; label: string }> = [
  { code: 'UYU', label: 'Peso uruguayo' },
  { code: 'USD', label: 'Dólar estadounidense' },
  { code: 'ARS', label: 'Peso argentino' },
  { code: 'BRL', label: 'Real brasileño' },
];

/**
 * Full-screen currency selector reached from the profile screen's
 * "Moneda" row (`/settings/currency`). Tapping a row persists
 * `profiles.currency` through `useProfile().setCurrency` and goes back;
 * the profile and budget queries are invalidated by the hook, and the
 * settings store re-hydrates from the profile row. A failed write shows
 * the user-safe message inline instead of navigating.
 */
export default function CurrencySelectorScreen() {
  const currency = useSettingsStore((s) => s.currency);
  const { setCurrency } = useProfile();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelect = async (code: string) => {
    if (saving) return;
    // Tapping the already-active currency has nothing to persist — close.
    if (code === currency) {
      router.back();
      return;
    }
    setSaving(true);
    setError(null);
    const result = await setCurrency(code);
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
        <Text style={styles.title}>Moneda</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Card padding={spacing.xs}>
          {CURRENCIES.map((item, idx) => {
            const selected = item.code === currency;
            return (
              <View key={item.code}>
                <Pressable
                  onPress={() => handleSelect(item.code)}
                  disabled={saving}
                  style={styles.row}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={item.label}
                >
                  <Text style={styles.label} numberOfLines={1}>
                    {item.label}
                  </Text>
                  <Text style={[styles.code, selected && styles.codeSelected]}>
                    {item.code}
                  </Text>
                  {selected ? (
                    <Icon name="checkmark" size={18} color={colors.primary} />
                  ) : null}
                </Pressable>
                {idx < CURRENCIES.length - 1 ? <Divider /> : null}
              </View>
            );
          })}
        </Card>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
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
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    gap: spacing.md,
  },
  label: {
    flex: 1,
    ...typography.bodyLg,
    color: colors.textPrimary,
  },
  code: {
    ...typography.bodyMd,
    color: colors.textSecondary,
  },
  codeSelected: {
    color: colors.primaryDark,
  },
  error: {
    ...typography.labelSm,
    color: colors.danger,
  },
});
