import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card, Divider, Icon, Pressable, Text, View } from '@/components';
import { useProfile } from '@/features/profile';
import { useSettingsStore } from '@/stores/use-settings-store';
import { colors, spacing, typography } from '@/theme';

/**
 * The currencies the app offers (ISO 4217 codes). Labels are pulled
 * from the `currency` catalog so the locale-aware name (e.g.
 * "Uruguayan peso" in en, "Peso uruguayo" in es-AR) wins at render
 * time. The code stays as the ISO 4217 string for storage.
 */
const CURRENCY_CODES: ReadonlyArray<string> = [
  'UYU',
  'USD',
  'ARS',
  'BRL',
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
  const { t } = useTranslation(['settings', 'currency', 'common']);
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
          accessibilityLabel={t('common:back')}
        >
          <Icon name="arrow.left" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.title}>{t('settings:currencyTitle')}</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Card padding={spacing.xs}>
          {CURRENCY_CODES.map((code, idx) => {
            const selected = code === currency;
            // Currency code is the runtime key — the catalog type guarantees
            // these exact 4 strings resolve, but TS can't follow a dynamic
            // template against a fixed union, so we narrow via `as`.
            const label = t(`currency:${code}` as
              | 'currency:UYU'
              | 'currency:USD'
              | 'currency:ARS'
              | 'currency:BRL');
            return (
              <View key={code}>
                <Pressable
                  onPress={() => handleSelect(code)}
                  disabled={saving}
                  style={styles.row}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={label}
                >
                  <Text style={styles.label} numberOfLines={1}>
                    {label}
                  </Text>
                  <Text style={[styles.code, selected && styles.codeSelected]}>
                    {code}
                  </Text>
                  {selected ? (
                    <Icon name="checkmark" size={18} color={colors.primary} />
                  ) : null}
                </Pressable>
                {idx < CURRENCY_CODES.length - 1 ? <Divider /> : null}
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
