import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card, Divider, Icon, Pressable, Text, View } from '@/components';
import { useProfile } from '@/features/profile';
import es419Currency from '@/i18n/locales/es-419/currency.json';
import { isCurrencySelected } from '@/lib/currency-selection';
import { SUPPORTED_CURRENCIES } from '@/lib/format';
import { useSettingsStore } from '@/stores/use-settings-store';
import { colors, spacing, typography } from '@/theme';

/**
 * The label keys this screen may ask i18next for, derived from the SHIPPED
 * Spanish base catalog rather than a hand-written union. A supported code
 * with no `currency.<code>` key is a `tsc` error here, not a raw key painted
 * on screen at runtime.
 */
type CurrencyKey = keyof typeof es419Currency;

/**
 * Full-screen currency selector reached from the profile screen's
 * "Moneda" row (`/settings/currency`). Tapping a row persists
 * `profiles.currency` through `useProfile().setCurrency` and goes back;
 * the profile and budget queries are invalidated by the hook, and the
 * settings store re-hydrates from the profile row. A failed write shows
 * the user-safe message inline instead of navigating.
 *
 * Rows are driven by `SUPPORTED_CURRENCIES` — the one catalog in
 * `src/lib/format.ts` — so this screen can never drift from what the app
 * actually supports. Labels come from the `currency` catalog, so the
 * locale-aware name (e.g. "Uruguayan peso" in en, "Peso uruguayo" in
 * es-AR) wins at render time; the code stays the ISO 4217 string for
 * storage.
 */
export default function CurrencySelectorScreen() {
  const { t } = useTranslation(['settings', 'currency', 'common']);
  const currency = useSettingsStore((s) => s.currency);
  const { setCurrency } = useProfile();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelect = async (code: (typeof SUPPORTED_CURRENCIES)[number]) => {
    if (saving) return;
    // Tapping the already-active currency has nothing to persist — close.
    // Deliberately case-SENSITIVE while the row's `selected` above is not: this
    // guard answers "is there anything to WRITE?", and writing the uppercase
    // spelling over a stored lowercase 'usd' is a normalization of the same ISO
    // code, not a currency change. It is also the only path that repairs such a
    // stored value. The reverse trade — tapping a DIFFERENT row — is a genuine
    // re-base and is exactly what the selected-row fix removes the temptation
    // for.
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
          {SUPPORTED_CURRENCIES.map((code, idx) => {
            // The one place the picker decides which row is the user's
            // currency, and it case-folds on purpose — see
            // `isCurrencySelected`. A raw `code === currency` here is the
            // regression this change set exists to prevent: a stored lowercase
            // 'usd' renders correctly in every formatter (they case-fold) yet
            // matches no UPPERCASE catalog code, so no row looks selected and
            // the a11y `selected` state is false for all 14. Both the checkmark
            // and `accessibilityState` read this one value, so they cannot
            // drift apart.
            const selected = isCurrencySelected(code, currency);
            // Currency code is the runtime key. `satisfies` (not `as`) is
            // load-bearing: a plain `as` would happily narrow a 15-member
            // union down to the 14 the catalog ships and pass, so the guard
            // below would be decorative. This makes an unresolvable code a
            // tsc error instead of a raw key painted on screen.
            const labelKey = `currency:${code}` satisfies `currency:${CurrencyKey}`;
            const label = t(labelKey);
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
                {idx < SUPPORTED_CURRENCIES.length - 1 ? <Divider /> : null}
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
