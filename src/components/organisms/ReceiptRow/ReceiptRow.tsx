import { useEffect, useState } from 'react';
import { Image, StyleSheet } from 'react-native';

import {
  Icon,
  Pressable,
  Spinner,
  Text,
  View,
  type IconName,
} from '@/components';
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
  // Loading covers BOTH async phases: signed-URL resolution (`signing`,
  // photoSource still null) and image decode (onLoadStart→onLoadEnd).
  // The 40×40 slot shows a spinner instead of a blank box; the icon
  // fallback stays for rows without a photo or after a load error.
  const [signing, setSigning] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageReady, setImageReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const classified = resolveReceiptPhotoPath(imageUrl);
    setSigning(false);
    setImageLoading(false);
    setImageReady(false);
    setImageFailed(false);
    if (!classified) {
      setPhotoSource(null);
      return;
    }
    if (classified.kind === 'url') {
      setPhotoSource(classified.value);
      return;
    }
    setSigning(true);
    getSignedReceiptPhotoUrl(classified.value).then((signed) => {
      if (!cancelled) {
        setPhotoSource(signed);
        setSigning(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  // Demo images (picsum) and remote ticket photos can fail offline; fall
  // back to the icon circle instead of rendering a blank box.
  const [imageFailed, setImageFailed] = useState(false);
  // Show spinner from the moment we start resolving until the image is fully
  // decoded. Without `imageReady`, there's a gap between signing=false and
  // onLoadStart where the image renders blank before the spinner appears.
  const thumbnailLoading =
    !imageFailed &&
    (signing || imageLoading || (photoSource !== null && !imageReady));
  const row = (
    <>
      {photoSource && !imageFailed ? (
        <View style={styles.iconCircle}>
          {!imageReady && <Spinner size="sm" style={styles.spinnerOverlay} />}
          <Image
            source={{ uri: photoSource }}
            style={[styles.thumbnail, !imageReady && styles.thumbnailHidden]}
            onLoadStart={() => setImageLoading(true)}
            onLoadEnd={() => {
              setImageLoading(false);
              setImageReady(true);
            }}
            onError={() => {
              setImageLoading(false);
              setImageFailed(true);
            }}
          />
        </View>
      ) : thumbnailLoading ? (
        <View style={styles.iconCircle}>
          <Spinner size="sm" />
        </View>
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
            gap: spacing.sm,
          }}
        >
          {/* The 60pt fixed envelope can't fit a third caption line, so the
              hint rides the date line (" · " separator) and truncates before
              it can collide with the amount. */}
          <Text style={styles.date} numberOfLines={1}>
            {formatShortDate(date)}
            <Text style={styles.caption}> · Toca para ver el ticket</Text>
          </Text>
          <Text style={styles.amount}>{formatCurrency(amount, currency)}</Text>
        </View>
      </View>
    </>
  );

  if (onPress) {
    return (
      {/* The label intentionally excludes the visible caption so VoiceOver
          doesn't double-announce "Toca para ver el ticket" (label + hint). */}
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityHint="Toca para ver el ticket"
        accessibilityLabel={`${name}, ${formatShortDate(date)}, ${formatCurrency(amount, currency)}`}
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
  thumbnailHidden: {
    opacity: 0,
    position: 'absolute',
  },
  spinnerOverlay: {
    position: 'absolute',
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
    fontSize: 17,
    fontWeight: '800',
    flex: 1,
  },
  caption: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '400',
  },
  amount: {
    color: '#606060',
    fontSize: 20,
    fontWeight: '900',
  },
});
