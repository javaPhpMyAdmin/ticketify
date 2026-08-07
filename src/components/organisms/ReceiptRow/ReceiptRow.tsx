import { useState } from 'react';
import { Image, StyleSheet } from 'react-native';

import { Icon, Pressable, Text, View, type IconName } from '@/components';
import { formatCurrency, formatShortDate } from '@/lib/format';
import { colors, radii, spacing, typography } from '@/theme';

export interface ReceiptRowProps {
  name: string;
  date: string; // ISO
  amount: number;
  currency?: string;
  iconName?: IconName;
  iconColor?: string;
  iconBg?: string;
  /** When set, the row renders as a pressable button (receipt detail). */
  onPress?: () => void;
  /** Ticket photo URL; when truthy it replaces the icon circle with a thumbnail. */
  imageUrl?: string | null;
}

export function ReceiptRow({
  name,
  date,
  amount,
  currency = 'UYU',
  iconName = 'doc.text',
  iconColor = colors.textPrimary,
  iconBg = colors.chipBg,
  onPress,
  imageUrl,
}: ReceiptRowProps) {
  // Demo images (picsum) and remote ticket photos can fail offline; fall
  // back to the icon circle instead of rendering a blank box.
  const [imageFailed, setImageFailed] = useState(false);
  const row = (
    <>
      {imageUrl && !imageFailed ? (
        <Image
          source={{ uri: imageUrl }}
          style={styles.thumbnail}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <View style={[styles.iconCircle, { backgroundColor: iconBg }]}>
          <Icon name={iconName} size={18} color={iconColor} />
        </View>
      )}
      <View style={styles.middle}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.date}>{formatShortDate(date)}</Text>
      </View>
      <Text style={styles.amount}>{formatCurrency(amount, currency)}</Text>
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        {row}
      </Pressable>
    );
  }
  return <View style={styles.row}>{row}</View>;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.primary,
    gap: spacing.md,
  },
  // Same active state as the History screen's cards (DESIGN.md).
  pressed: {
    transform: [{ scale: 0.98 }],
  },
  thumbnail: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
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
