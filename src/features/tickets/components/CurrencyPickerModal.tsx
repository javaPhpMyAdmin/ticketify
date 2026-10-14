import { useTranslation } from 'react-i18next';
import { StyleSheet, useWindowDimensions } from 'react-native';

import { BottomSheet, View } from '@/components';
import { CurrencyPickerList } from '@/components/CurrencyPickerList';
import type { SupportedCurrency } from '@/lib/format';
import { spacing } from '@/theme';

export interface CurrencyPickerModalProps {
  /** Whether the sheet is open. Kept mounted so closing animates. */
  visible: boolean;
  /** The currently-effective code; the matching row shows the checkmark. */
  current: string;
  /** Called with the chosen ISO 4217 code. */
  onSelect: (code: SupportedCurrency) => void;
  /** Called when the user dismisses the sheet (backdrop tap / hardware back). */
  onClose: () => void;
}

/**
 * Full-catalog currency picker as a bottom sheet, opened by the review screen's
 * persistent "More" chip. It only FRAMES the shared `CurrencyPickerList` —
 * search box, LATAM / INTL sections and the selected-row logic all come from
 * that one component, so the sheet and the settings screen cannot drift apart.
 *
 * The caller owns the WRITE: selecting a row invokes `onSelect` and the caller
 * decides what to persist (and whether to close) — the same split
 * `CategoryPickerModal` uses. It is patterned on that modal for the sheet
 * chrome (surface, radius, `sheetPaddingTop`, `includeBottomInset={false}`) so
 * both sheets sit at the same height and inset.
 */
export function CurrencyPickerModal({
  visible,
  current,
  onSelect,
  onClose,
}: CurrencyPickerModalProps) {
  const { t } = useTranslation(['settings', 'common']);
  const { height } = useWindowDimensions();

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t('settings:currencyTitle')}
      showCloseButton={false}
      backdropLabel={t('common:cancel')}
      surface
      radius="xl"
      maxHeight="80%"
      sheetPaddingTop={spacing.md}
      includeBottomInset={false}
    >
      {/*
        The shared list fills its parent (`flex: 1`), so the sheet must give it a
        BOUNDED height for its internal `SectionList` to size and scroll: a
        zero-basis flex child inside a content-sized sheet collapses to 0 (see
        the `scrollBody` note in BottomSheet.tsx). A percentage height would be
        circular against a content-driven sheet, so the bound is a point value —
        a constant share of the viewport, capped by the sheet's own `maxHeight`.
      */}
      <View style={[styles.listWrap, { height: Math.round(height * 0.6) }]}>
        <CurrencyPickerList current={current} onSelect={onSelect} />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  listWrap: {
    width: '100%',
  },
});
