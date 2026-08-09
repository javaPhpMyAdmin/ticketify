import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Modal, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card, Divider, Icon, Pressable, Text, View } from '@/components';
import {
  currentMonthKey,
  getMonthKey,
} from '@/features/home';
import { getExpenseCategory } from '@/features/home/categories';
import { formatCurrency, formatShortDate } from '@/lib/format';
import {
  getSignedReceiptPhotoUrl,
  resolveReceiptPhotoPath,
} from '@/lib/supabase/receipt-photo';
import { useReceiptsStore } from '@/stores/use-receipts-store';
import { useSettingsStore } from '@/stores/use-settings-store';
import { colors, radii, spacing, typography } from '@/theme';

/**
 * View-only receipt detail: the ticket photo the user took, plus the
 * receipt meta (store, date, total), its category breakdown, and item
 * lines. Reached from the Home "Recibos recientes" rows (`/receipts/:id`).
 * Tapping the photo opens it fullscreen; the category rows reuse the
 * expense-category registry so labels/icons match the Home strip.
 * Read-only on purpose — editing and saving live in the scan-flow review
 * screen (`ticket/review/[id]`), which keeps working untouched.
 */
export default function ReceiptDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const list = useReceiptsStore((s) => s.list);
  const currency = useSettingsStore((s) => s.currency);
  const [photoOpen, setPhotoOpen] = useState(false);
  // Demo images (picsum) and remote ticket photos can fail offline; fall
  // back to the "Sin foto del ticket" placeholder instead of a blank box.
  const [photoFailed, setPhotoFailed] = useState(false);
  const receipt = list.find((r) => r.id === id);

  // The stored photo reference may be a ready http(s) URL (seed/demo rows)
  // or an object path in the private `receipts` bucket — resolve the path
  // to a signed URL (expires ~1h) before rendering. The effect keys on the
  // RAW string so re-renders (photo modal toggle) never re-resolve.
  const [photoSource, setPhotoSource] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const classified = resolveReceiptPhotoPath(receipt?.image_url);
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
  }, [receipt?.image_url]);

  const header = (
    <View style={styles.header}>
      <Pressable
        onPress={() => router.back()}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Volver"
      >
        <Icon name="arrow.left" size={24} color={colors.textPrimary} />
      </Pressable>
      <Text style={styles.title}>Detalle del recibo</Text>
    </View>
  );

  if (!receipt) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        {header}
        <View style={styles.notFound}>
          <Text style={styles.notFoundText}>Recibo no encontrado</Text>
        </View>
      </SafeAreaView>
    );
  }

  const items = receipt.items ?? [];
  const categoryTotals = receipt.category_totals ?? {};
  const categoryEntries = Object.entries(categoryTotals)
    .map(([key, amount]) => ({ key, amount, def: getExpenseCategory(key) }))
    .sort((a, b) => b.amount - a.amount);
  // Tapping a category opens its monthly drill-down for the month the
  // receipt belongs to (same route the History screen uses).
  const receiptMonthKey = getMonthKey(receipt.purchase_date);
  const isCurrentMonth = receiptMonthKey === currentMonthKey();

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {header}

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {photoSource && !photoFailed ? (
          <Pressable
            onPress={() => setPhotoOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Ver foto en pantalla completa"
          >
            <Image
              source={{ uri: photoSource }}
              style={styles.photo}
              resizeMode="cover"
              onError={() => setPhotoFailed(true)}
            />
          </Pressable>
        ) : (
          <View style={styles.photoPlaceholder}>
            <Icon name="doc.text" size={40} color={colors.textSecondary} />
            <Text style={styles.photoPlaceholderText}>Sin foto del ticket</Text>
          </View>
        )}

        <Card>
          <View style={styles.metaRow}>
            <View style={styles.metaCol}>
              <Text style={styles.kicker}>TIENDA</Text>
              <Text style={styles.metaValue}>{receipt.store_name}</Text>
            </View>
          </View>
          <View style={styles.metaRow}>
            <View style={styles.metaCol}>
              <Text style={styles.kicker}>FECHA</Text>
              <Text style={styles.metaValue}>
                {formatShortDate(receipt.purchase_date)}
              </Text>
            </View>
            <View style={styles.metaCol}>
              <Text style={styles.kicker}>TOTAL</Text>
              <Text style={styles.metaValue}>
                {formatCurrency(receipt.total, currency)}
              </Text>
            </View>
          </View>
        </Card>

        {categoryEntries.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Categorías</Text>
            <Card padding={spacing.lg}>
              {categoryEntries.map((entry, idx) => (
                <View key={entry.key}>
                  <Pressable
                    onPress={() =>
                      router.push(
                        isCurrentMonth
                          ? `/categories/${entry.key}`
                          : `/categories/${entry.key}?month=${receiptMonthKey}`,
                      )
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`Ver gastos de ${entry.def.label}`}
                    style={({ pressed }) => pressed && styles.catRowPressed}
                  >
                    <View style={styles.catRow}>
                      <View style={styles.catIcon}>
                        <Icon
                          name={entry.def.icon}
                          size={16}
                          color={colors.primary}
                        />
                      </View>
                      <Text style={styles.catName} numberOfLines={1}>
                        {entry.def.label}
                      </Text>
                      <Text style={styles.catAmount}>
                        {formatCurrency(entry.amount, currency)}
                      </Text>
                    </View>
                  </Pressable>
                  {idx < categoryEntries.length - 1 ? <Divider /> : null}
                </View>
              ))}
            </Card>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Artículos</Text>
          <Card padding={spacing.lg}>
            {items.length > 0 ? (
              items.map((item, idx) => (
                <View key={`${item.name}-${idx}`}>
                  <View style={styles.itemRow}>
                    <Text style={styles.itemName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.itemAmount}>
                      {formatCurrency(item.amount, currency)}
                    </Text>
                  </View>
                  {idx < items.length - 1 ? <Divider /> : null}
                </View>
              ))
            ) : (
              <Text style={styles.empty}>Sin artículos detallados.</Text>
            )}
          </Card>
        </View>
      </ScrollView>

      <Modal
        visible={photoOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPhotoOpen(false)}
      >
        <Pressable
          style={styles.photoModalBackdrop}
          onPress={() => setPhotoOpen(false)}
          accessibilityRole="button"
          accessibilityLabel="Cerrar foto"
        >
          <View style={styles.photoModalClose} pointerEvents="none">
            <Icon name="xmark" size={24} color={colors.surface} />
          </View>
          <Image
            source={photoSource ? { uri: photoSource } : undefined}
            style={styles.photoModalImage}
            resizeMode="contain"
            // If the photo fails to load fullscreen (offline dev), close the
            // modal and let the detail view fall back to the placeholder.
            onError={() => {
              setPhotoOpen(false);
              setPhotoFailed(true);
            }}
          />
        </Pressable>
      </Modal>
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
    gap: spacing.lg,
  },
  photo: {
    width: '100%',
    height: 340,
    borderRadius: radii.lg,
    backgroundColor: colors.chipBg,
  },
  photoPlaceholder: {
    width: '100%',
    height: 340,
    borderRadius: radii.lg,
    backgroundColor: colors.chipBg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  photoPlaceholderText: {
    ...typography.bodyMd,
    color: colors.textSecondary,
  },
  photoModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.92)',
    justifyContent: 'center',
  },
  photoModalClose: {
    position: 'absolute',
    top: spacing.xl,
    right: spacing.xl,
    zIndex: 1,
  },
  photoModalImage: {
    width: '100%',
    height: '100%',
  },
  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  catIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.chipBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  catName: {
    ...typography.bodyMd,
    color: colors.textPrimary,
    flex: 1,
  },
  catRowPressed: {
    opacity: 0.7,
  },
  catAmount: {
    ...typography.headlineMd,
    color: colors.textPrimary,
  },
  kicker: {
    ...typography.labelCaps,
    color: colors.textSecondary,
  },
  metaRow: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  metaCol: {
    flex: 1,
    gap: spacing.xs,
  },
  metaValue: {
    ...typography.bodyLg,
    color: colors.textPrimary,
  },
  section: {
    gap: spacing.md,
  },
  sectionTitle: {
    ...typography.headlineMd,
    color: colors.textPrimary,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  itemName: {
    ...typography.bodyMd,
    color: colors.textPrimary,
    flex: 1,
  },
  itemAmount: {
    ...typography.headlineMd,
    color: colors.textPrimary,
  },
  empty: {
    ...typography.bodyMd,
    color: colors.textSecondary,
  },
  notFound: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notFoundText: {
    ...typography.bodyMd,
    color: colors.textSecondary,
  },
});
