import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card, Divider, Icon, Pressable, Text, View } from '@/components';
import { useLocaleStore, type LocaleOverride } from '@/i18n/stores/useLocaleStore';
import { colors, spacing, typography } from '@/theme';

/**
 * The four override values offered in the selector, in fixed order
 * (REQ-3: `Automático (es-AR)`, English, Español (Argentina),
 * Português (Brasil)). The `auto` option always defers to the device
 * locale; the other three pin the UI language regardless of device
 * locale or override.
 *
 * Each row's label is rendered from the `settingsLanguage.*` namespace
 * via `t()` so the selector is fully localized from day 1 (no hardcoded
 * Spanish in this screen). The auto option keeps the literal
 * ` (es-AR)` segment in every locale so users always know the
 * fallback.
 *
 * `labelKey` is typed as a literal union (not `string`) so the
 * `t()` call stays type-safe — the union is verified against the
 * `ResourceNamespaceMap` augmentation in `src/i18n/types.ts` and
 * any typo fails the typecheck.
 */
type Option = {
  value: LocaleOverride;
  /** Key under `settingsLanguage.*` whose value is the visible label. */
  labelKey:
    | 'settingsLanguage:auto'
    | 'settingsLanguage:en'
    | 'settingsLanguage:es-AR'
    | 'settingsLanguage:pt-BR';
};

const OPTIONS: ReadonlyArray<Option> = [
  { value: 'auto', labelKey: 'settingsLanguage:auto' },
  { value: 'en', labelKey: 'settingsLanguage:en' },
  { value: 'es-AR', labelKey: 'settingsLanguage:es-AR' },
  { value: 'pt-BR', labelKey: 'settingsLanguage:pt-BR' },
];

/**
 * Full-screen language selector reached from the profile screen's
 * "Idioma" row (`/settings/language`). Tapping a row writes the new
 * override through `useLocaleStore.setOverride()` (which persists to
 * secure-store AND calls `i18next.changeLanguage()` live), then pops
 * back so the user lands on the profile screen with the new language
 * already in effect.
 *
 * Selecting the already-active option is a no-op — the store writes the
 * same value and `changeLanguage` is a no-op for an unchanged language.
 * The user can still close the screen with the back arrow at the top.
 */
export default function LanguageSelectorScreen() {
  const { t } = useTranslation(['common', 'settingsLanguage']);
  const override = useLocaleStore((s) => s.override);
  const setOverride = useLocaleStore((s) => s.setOverride);

  const handleSelect = async (value: LocaleOverride) => {
    // Skip the work for the already-active option so we don't churn
    // the secure-store write + re-render cycle when the user just
    // taps the current row out of curiosity.
    if (value === override) {
      router.back();
      return;
    }
    await setOverride(value);
    router.back();
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
        <Text style={styles.title}>{t('settingsLanguage:title')}</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Card padding={spacing.xs}>
          {OPTIONS.map((option, idx) => {
            const selected = option.value === override;
            return (
              <View key={option.value}>
                <Pressable
                  onPress={() => handleSelect(option.value)}
                  style={styles.row}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={t(option.labelKey)}
                >
                  <Text style={styles.label} numberOfLines={1}>
                    {t(option.labelKey)}
                  </Text>
                  {selected ? (
                    <Icon name="checkmark" size={18} color={colors.primary} />
                  ) : null}
                </Pressable>
                {idx < OPTIONS.length - 1 ? <Divider /> : null}
              </View>
            );
          })}
        </Card>
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
});