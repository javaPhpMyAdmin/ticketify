import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CurrencyPickerList } from '@/components/CurrencyPickerList';
import { Icon, Pressable, Text, View } from '@/components';
import { useProfile } from '@/features/profile';
import { SUPPORTED_CURRENCIES } from '@/lib/format';
import { useSettingsStore } from '@/stores/use-settings-store';
import { colors, spacing, typography } from '@/theme';

/**
 * Full-screen currency selector reached from the profile screen's
 * "Moneda" row (`/settings/currency`). Tapping a row persists
 * `profiles.currency` through `useProfile().setCurrency` and goes back;
 * the profile and budget queries are invalidated by the hook, and the
 * settings store re-hydrates from the profile row. A failed write shows
 * the user-safe message inline instead of navigating.
 *
 * The conversation between user and catalog (search box, LATAM / INTL
 * sections, selected row) lives in the shared `CurrencyPickerList`, which this
 * screen only drives: `SUPPORTED_CURRENCIES` — the one catalog in
 * `src/lib/format.ts` — still feeds it, so this screen can never drift from
 * what the app actually supports. This screen's own job is the write: the
 * store's recent-currency history is updated by `setCurrency`, and the picker's
 * "already current" case just closes.
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

      <CurrencyPickerList current={currency} onSelect={handleSelect} />

      {error ? <Text style={styles.error}>{error}</Text> : null}
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
  error: {
    ...typography.labelSm,
    color: colors.danger,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },
});
