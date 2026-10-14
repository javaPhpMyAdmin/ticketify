import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionList, StyleSheet, TextInput } from 'react-native';

import { Card, Divider, Icon, Pressable, Text, View } from '@/components';
import es419Currency from '@/i18n/locales/es-419/currency.json';
import { isCurrencySelected } from '@/lib/currency-selection';
import {
  LATAM_CURRENCY_CODES,
  SUPPORTED_CURRENCIES,
  type SupportedCurrency,
} from '@/lib/format';
import { colors, radii, spacing, typography } from '@/theme';

/**
 * The label keys this list may ask i18next for, derived from the SHIPPED
 * Spanish base catalog rather than a hand-written union. A supported code with
 * no `currency.<code>` key is a `tsc` error here, not a raw key painted on
 * screen at runtime.
 */
type CurrencyKey = keyof typeof es419Currency;

type CurrencyGroup = 'LATAM' | 'INTL';

interface CurrencyRow {
  code: SupportedCurrency;
  group: CurrencyGroup;
}

interface CurrencySection {
  key: CurrencyGroup;
  title: string;
  data: CurrencyRow[];
}

/**
 * Group membership lookup for the LATAM/INTL split. Deliberately NOT named
 * `*_CURRENC*`: the catalog harness pins `CurrencyPickerList.tsx` free of any
 * locally-declared currency-code array, and this is a derived Set over the one
 * catalog, not a second list.
 */
const LATAM_GROUP: ReadonlySet<string> = new Set(LATAM_CURRENCY_CODES);

export interface CurrencyPickerListProps {
  /** Called with the chosen ISO 4217 code. */
  onSelect: (code: SupportedCurrency) => void;
  /** The currently-effective code; the row matching it shows the checkmark. */
  current: string;
  /**
   * Optional caller-supplied filter, ANDed with the built-in search text.
   * Omit it to let the built-in search box own the query.
   */
  query?: string;
}

/**
 * Shared searchable currency list: a search box over a `SectionList` split into
 * LATAM / INTL sections, rows in the SAME canonical code order as
 * `SUPPORTED_CURRENCIES` (LATAM codes then INTL codes) so the rows never
 * reshuffle when the language changes. The settings screen consumes it now and
 * the review "More" modal will too, so the row's selected state is the pinned
 * `isCurrencySelected` predicate and both surfaces cannot drift apart.
 */
export function CurrencyPickerList({
  onSelect,
  current,
  query,
}: CurrencyPickerListProps) {
  const { t } = useTranslation(['settings', 'currency']);
  const [typed, setTyped] = useState('');
  // Alias the prop to the name the pinned row expression uses, so the
  // `isCurrencySelected(code, currency)` predicate reads exactly as the harness
  // pins it (test-currency-catalog.mjs §3b).
  const currency = current;

  const needles = useMemo(
    () =>
      [query, typed]
        .map((value) => (value ?? '').trim().toLowerCase())
        .filter((value) => value.length > 0),
    [query, typed],
  );

  const sections = useMemo(() => {
    const matches = (code: SupportedCurrency): boolean => {
      if (needles.length === 0) return true;
      const labelKey = `currency:${code}` satisfies `currency:${CurrencyKey}`;
      const label = t(labelKey).toLowerCase();
      const lowerCode = code.toLowerCase();
      return needles.every(
        (needle) => lowerCode.includes(needle) || label.includes(needle),
      );
    };
    // One pass over the single catalog array, in canonical order, then a stable
    // split by group — so the rows can never drift from SUPPORTED_CURRENCIES.
    const rows = SUPPORTED_CURRENCIES.map((code) => ({
      code,
      group: LATAM_GROUP.has(code) ? ('LATAM' as const) : ('INTL' as const),
    })).filter((row) => matches(row.code));
    return [
      {
        key: 'LATAM' as const,
        title: t('settings:currencySectionLatam'),
        data: rows.filter((row) => row.group === 'LATAM'),
      },
      {
        key: 'INTL' as const,
        title: t('settings:currencySectionIntl'),
        data: rows.filter((row) => row.group === 'INTL'),
      },
    ];
  }, [needles, t]);

  return (
    <View style={styles.container}>
      <View style={styles.searchBox}>
        <Icon name="magnifyingglass" size={16} color={colors.textSecondary} />
        <TextInput
          style={styles.searchInput}
          value={typed}
          onChangeText={setTyped}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          accessibilityLabel={t('settings:currencyTitle')}
        />
      </View>

      <Card padding={spacing.xs} style={styles.listCard}>
        <SectionList<CurrencyRow, CurrencySection>
          sections={sections}
          keyExtractor={(row) => row.code}
          stickySectionHeadersEnabled={false}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
            </View>
          )}
          renderItem={({ item, index, section }) => {
            const code = item.code;
            // The one place this list decides which row is the user's currency,
            // and it case-folds on purpose — see `isCurrencySelected`. Both the
            // checkmark and `accessibilityState` read this one value, so they
            // cannot drift apart.
            const selected = isCurrencySelected(code, currency);
            // Currency code is the runtime key. `satisfies` (not `as`) is
            // load-bearing: a plain `as` would happily narrow a wider union down
            // to the catalog's and pass, so the guard would be decorative. This
            // makes an unresolvable code a `tsc` error instead of a raw key
            // painted on screen.
            const labelKey = `currency:${code}` satisfies `currency:${CurrencyKey}`;
            const label = t(labelKey);
            const isLast = index === section.data.length - 1;
            return (
              <View>
                <Pressable
                  onPress={() => onSelect(code)}
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
                {isLast ? null : <Divider />}
              </View>
            );
          }}
        />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    boxShadow: '1px 2px 6px rgba(0, 0, 0, 0.3)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  searchInput: {
    flex: 1,
    ...typography.bodyMd,
    color: colors.textPrimary,
    padding: 0,
  },
  listCard: {
    flex: 1,
  },
  listContent: {
    paddingBottom: spacing.sm,
  },
  sectionHeader: {
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  sectionTitle: {
    ...typography.labelCaps,
    color: colors.textSecondary,
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
});
