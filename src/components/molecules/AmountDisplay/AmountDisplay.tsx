import { StyleSheet, type StyleProp, type TextStyle } from 'react-native';

import { Text } from '@/components';
import { colors, typography } from '@/theme';
import { formatCurrency } from '@/lib/format';

export interface AmountDisplayProps {
  value: number;
  currency?: string;
  /** When true, renders in `danger` instead of `textPrimary`. */
  negative?: boolean;
  /** When true, renders the secondary (smaller) variant. */
  small?: boolean;
  style?: StyleProp<TextStyle>;
}

/**
 * The big-number currency renderer used on the dashboard budget card
 * and the analytics total. Default size is `display-currency` (40/48),
 * opt into the secondary `headline-md` (20/26) for in-list usage.
 */
export function AmountDisplay({
  value,
  currency = 'USD',
  negative = false,
  small = false,
  style,
}: AmountDisplayProps) {
  return (
    <Text
      style={[
        small ? styles.small : styles.large,
        { color: negative ? colors.danger : colors.textPrimary },
        style,
      ]}
    >
      {formatCurrency(value, currency)}
    </Text>
  );
}

const styles = StyleSheet.create({
  large: {
    ...typography.displayCurrency,
  },
  small: {
    ...typography.headlineMd,
  },
});
