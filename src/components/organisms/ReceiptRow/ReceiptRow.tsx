import { useEffect, useState } from 'react';
import { Image, StyleSheet } from 'react-native';

import { Icon, Pressable, Text, View, type IconName } from '@/components';
import { formatCurrency, formatShortDate } from '@/lib/format';
import {
  getSignedReceiptPhotoUrl,
  resolveReceiptPhotoPath,
} from '@/lib/supabase/receipt-photo';
import { colors, radii, spacing } from '@/theme';

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
  // The stored photo reference may be a ready http(s) URL (seed/demo rows)
  // or an object path in the private `receipts` bucket — resolve the path
  // to a signed URL (expires ~1h) before rendering. The effect keys on the
  // RAW string so re-renders never re-resolve the signed URL.
  const [photoSource, setPhotoSource] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const classified = resolveReceiptPhotoPath(imageUrl);
    if (!classified) {
      setPhotoSource(null);
      return;
    }
    if (classified.kind === 'url') {
      setPhotoSource(classified.value);
      return;
    }
    getSignedReceiptPhotoUrl(classified.value).then((signed) => {
      if (!cancelled) setPhotoSource(signed);
    });
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  // Demo images (picsum) and remote ticket photos can fail offline; fall
  // back to the icon circle instead of rendering a blank box.
  const [imageFailed, setImageFailed] = useState(false);
  const row = (
    <>
      {photoSource && !imageFailed ? (
        <Image
          source={{ uri: photoSource }}
          style={styles.thumbnail}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <View style={[styles.iconCircle, { backgroundColor: iconBg }]}>
          <Icon name={iconName} size={18} color={iconColor} />
        </View>
      )}
      <View style={{ width: '80%', height: 60 }}>
        <View style={styles.middle}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
        </View>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Text style={styles.date}>{formatShortDate(date)}</Text>
          <Text style={styles.amount}>{formatCurrency(amount, currency)}</Text>
        </View>
      </View>
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
    borderWidth: 2.5,
    borderColor: '#d8d7d7',
    gap: spacing.md,
  },
  // Same active state as the History screen's cards (DESIGN.md).
  pressed: {
    transform: [{ scale: 0.98 }],
    backgroundColor: 'transparent',
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
    fontWeight: '600',
    fontSize: 20,
    color: colors.textSecondary,
  },
  date: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '700',
  },
  amount: {
    color: '#606060',
    fontSize: 20,
    fontWeight: '900',
  },
});
