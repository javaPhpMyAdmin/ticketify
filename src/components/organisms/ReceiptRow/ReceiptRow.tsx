import { StyleSheet } from 'react-native';

import { Icon, Text, View, type IconName } from '@/components';
import { colors, spacing, typography } from '@/theme';
import { formatCurrency, formatShortDate } from '@/lib/format';

export interface ReceiptRowProps {
  name: string;
  date: string; // ISO
  amount: number;
  currency?: string;
  iconName?: IconName;
  iconColor?: string;
  iconBg?: string;
}

export function ReceiptRow({
  name,
  date,
  amount,
  currency = 'USD',
  iconName = 'doc.text',
  iconColor = colors.textPrimary,
  iconBg = colors.chipBg,
}: ReceiptRowProps) {
  return (
    <View style={styles.row}>
      <View style={[styles.iconCircle, { backgroundColor: iconBg }]}>
        <Icon name={iconName} size={18} color={iconColor} />
      </View>
      <View style={styles.middle}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.date}>{formatShortDate(date)}</Text>
      </View>
      <Text style={styles.amount}>{formatCurrency(amount, currency)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  middle: {
    flex: 1,
    gap: 2,
  },
  name: {
    ...typography.bodyLg,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  date: {
    ...typography.bodyMd,
    color: colors.textSecondary,
  },
  amount: {
    ...typography.headlineMd,
    color: colors.textPrimary,
  },
});
