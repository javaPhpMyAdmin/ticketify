import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { BackHandler, Image, ScrollView, StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';

import { Card, Divider, Icon, IconButton, Pressable, Spinner, Text, View } from '@/components';
import { useSessionUser } from '@/features/auth';
import { getExpenseCategory } from '@/features/home/categories';
import {
  deleteReceipt,
  fetchPurchaseDetail,
  purchaseToDraft,
} from '@/features/tickets';
import type { PurchaseWithItems } from '@/features/tickets';
import { formatCurrency, formatShortDate } from '@/lib/format';
import { queryKeys } from '@/lib/query-keys';
import {
  getSignedReceiptPhotoUrl,
  resolveReceiptPhotoPath,
} from '@/lib/supabase/receipt-photo';
import { useReceiptsStore } from '@/stores/use-receipts-store';
import { useDialogStore } from '@/stores/use-dialog-store';
import { useSettingsStore } from '@/stores/use-settings-store';
import { colors, radii, spacing, typography } from '@/theme';
import { ReceiptCategoryItemsModal } from './ReceiptCategoryItemsModal';

/**
 * View-only receipt detail: the ticket photo the user took, plus the
 * receipt meta (store, date, total), its category breakdown, and item
 * lines. Reached from the Home "Recibos recientes" rows (`/receipts/:id`).
 * Tapping the photo opens it fullscreen; tapping a category row opens a
 * bottom sheet with ONLY this receipt's items in that category (the
 * category rows reuse the expense-category registry so labels/icons match
 * the Home strip). Read-only on purpose — editing and saving live in the
 * scan-flow review screen (`ticket/review/[id]`), which keeps working
 * untouched.
 */

/**
 * Maps `PurchaseWithItems` (from `fetchPurchaseDetail`) into the
 * `HomeFeedReceiptRow` shape the UI renders. Category totals are
 * derived by summing item amounts per category slug — the same
 * aggregation `buildFeedRow` uses for the home feed.
 */
function purchaseToFeedRow(p: PurchaseWithItems) {
  const items = (p.items ?? []).map((i) => ({
    name: i.name,
    amount: i.total_price,
    quantity: i.quantity,
    unit_price: i.unit_price,
    category: i.category?.slug ?? 'otros',
    is_impulse: i.is_impulse,
  }));
  const category_totals: Record<string, number> = {};
  for (const item of items) {
    category_totals[item.category] =
      (category_totals[item.category] ?? 0) + item.amount;
  }
  return {
    id: p.id,
    store_name: p.store_name ?? '',
    purchase_date: p.purchase_date,
    scanned_at: null,
    total: p.total,
    image_url: p.image_url,
    status: p.status,
    payment_method: p.payment_method,
    wants_snacks_total: items
      .filter((i) => i.is_impulse)
      .reduce((sum, i) => sum + i.amount, 0),
    category_totals,
    items,
  };
}

export default function ReceiptDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useSessionUser();
  const currency = useSettingsStore((s) => s.currency);

  // ── Primary data source: fetchPurchaseDetail by ID ────────────────────
  // This page is deep-linkable (receipts/:id) and must work on cold start
  // WITHOUT the Home feed having mounted first. Instead of searching
  // month-scoped list queries (which miss receipts older than last month),
  // we fetch the receipt directly by its ID — no month dependency. The
  // edit flow already calls `fetchPurchaseDetail` (below), so the cache
  // is shared between the display and edit paths.
  const detailQuery = useQuery({
    queryKey: queryKeys.receiptDetail(userId!, id!),
    enabled: !!userId && !!id,
    queryFn: () => fetchPurchaseDetail(userId!, id!),
  });

  // ── Derive receipt + category_totals from the fetched purchase ────────
  const rawReceipt = detailQuery.data;
  const receipt = rawReceipt
    ? purchaseToFeedRow(rawReceipt)
    : undefined;

  // ── Loading gate: session bootstrap OR query in flight ────────────────
  const isSessionLoading = !userId;
  const isLoading = isSessionLoading || detailQuery.isLoading;
  const [photoOpen, setPhotoOpen] = useState(false);
  // Slug of the category whose item sheet is open (`null` = closed).
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  // Demo images (picsum) and remote ticket photos can fail offline; fall
  // back to the "Sin foto del ticket" placeholder instead of a blank box.
  const [photoFailed, setPhotoFailed] = useState(false);
  // Guards the destructive delete while its mutation is in flight.
  const [deleting, setDeleting] = useState(false);
  // Guards the edit fetch + navigation while it is in flight (a double tap
  // must not stack two review screens).
  const [loading, setLoading] = useState(false);
  // Tracks whether this screen is still mounted: an awaited fetch that
  // resolves after the user already backed out must not push a review
  // screen on top of wherever they navigated.
  const mounted = useRef(true);
  // Ref guard for the edit navigation: the `loading` STATE alone is racy
  // (it commits on the next render), so a fast double tap would pass the
  // check twice and stack two review screens — same savingRef pattern the
  // review screen uses.
  const editInFlight = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // Android back button: close the photo overlay before navigating back.
  useEffect(() => {
    if (!photoOpen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (photoScaleJs.current > 1) {
        resetPhotoZoom();
      } else {
        setPhotoOpen(false);
      }
      return true; // consumed
    });
    return () => sub.remove();
  }, [photoOpen]);

  // Fullscreen photo zoom: pinch (scale) + double-tap (reset) + pan
  // (translate, clamped so the image edges stay inside the viewport).
  // The backdrop's onPress reads `photoScale` to decide between close
  // (at 1×) and reset (while zoomed). The container dimensions feed the
  // pan clamp — at scale `s`, the image is `s`× the container, so the
  // translate budget is `(s − 1) / 2` in each axis.
  const photoScale = useSharedValue(1);
  const photoSavedScale = useSharedValue(1);
  const photoTx = useSharedValue(0);
  const photoTy = useSharedValue(0);
  const photoSavedTx = useSharedValue(0);
  const photoSavedTy = useSharedValue(0);
  const photoContainerW = useSharedValue(0);
  const photoContainerH = useSharedValue(0);
  // JS-readable mirror of the shared scale value, used by the backdrop
  // Pressable handler (which runs on the JS thread, not the worklet).
  const photoScaleJs = useRef(1);

  const resetPhotoZoom = () => {
    photoScale.value = withTiming(1);
    photoSavedScale.value = 1;
    photoTx.value = withTiming(0);
    photoTy.value = withTiming(0);
    photoSavedTx.value = 0;
    photoSavedTy.value = 0;
    photoScaleJs.current = 1;
  };

  const photoPinch = Gesture.Pinch()
    .onUpdate((e) => {
      const next = photoSavedScale.value * e.scale;
      const clamped = Math.max(1, Math.min(4, next));
      photoScale.value = clamped;
      photoScaleJs.current = clamped;
    })
    .onEnd(() => {
      photoSavedScale.value = photoScale.value;
      // Reset pan at 1× so the next pinch starts centered.
      if (photoScale.value === 1) {
        photoTx.value = withTiming(0);
        photoTy.value = withTiming(0);
        photoSavedTx.value = 0;
        photoSavedTy.value = 0;
      }
    });

  const photoPan = Gesture.Pan()
    .onUpdate((e) => {
      if (photoScale.value <= 1) return;
      const w = photoContainerW.value;
      const h = photoContainerH.value;
      if (w === 0 || h === 0) return;
      const maxX = (w * (photoScale.value - 1)) / 2;
      const maxY = (h * (photoScale.value - 1)) / 2;
      photoTx.value = Math.max(
        -maxX,
        Math.min(maxX, e.translationX + photoSavedTx.value),
      );
      photoTy.value = Math.max(
        -maxY,
        Math.min(maxY, e.translationY + photoSavedTy.value),
      );
    })
    .onEnd(() => {
      photoSavedTx.value = photoTx.value;
      photoSavedTy.value = photoTy.value;
    });

  const photoDoubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      // Worklet → JS: the reset mutates shared values + a regular ref,
      // so jump back to JS to keep `photoScaleJs.current` in sync.
      runOnJS(resetPhotoZoom)();
    });

  // Pinch + pan run together (two-finger zoom and drag); the double-tap
  // competes with them but fires only when fingers are still.
  const photoGesture = Gesture.Simultaneous(
    photoPinch,
    Gesture.Simultaneous(photoPan, photoDoubleTap),
  );

  const photoAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: photoTx.value },
      { translateY: photoTy.value },
      { scale: photoScale.value },
    ],
  }));

  const handlePhotoBackdropPress = () => {
    if (photoScaleJs.current > 1) {
      resetPhotoZoom();
    } else {
      setPhotoOpen(false);
    }
  };

  // The stored photo reference may be a ready http(s) URL (seed/demo rows)
  // or an object path in the private `receipts` bucket — resolve the path
  // to a signed URL (expires ~1h) before rendering. The effect keys on the
  // RAW string so re-renders (photo modal toggle) never re-resolve.
  const [photoSource, setPhotoSource] = useState<string | null>(null);
  // True while the signed URL is being fetched — shows a loading state
  // instead of "Sin foto del ticket" so the user knows the photo is coming.
  const [photoLoading, setPhotoLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const classified = resolveReceiptPhotoPath(receipt?.image_url);
    if (!classified) {
      setPhotoSource(null);
      setPhotoLoading(false);
      return;
    }
    if (classified.kind === 'url') {
      setPhotoSource(classified.value);
      setPhotoLoading(false);
      return;
    }
    setPhotoLoading(true);
    getSignedReceiptPhotoUrl(classified.value).then((signed) => {
      if (!cancelled) {
        setPhotoSource(signed);
        setPhotoLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setPhotoLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [receipt?.image_url]);

  // Edit flow: loads the full purchase row (the feed list row only carries
  // display data), seeds the review draft in the store, then pushes the
  // review screen in EDIT mode — the same form, seeded draft, no parse.
  const handleEditPress = async () => {
    if (editInFlight.current || loading || deleting || !userId) return;
    editInFlight.current = true;
    setLoading(true);
    try {
      const purchase = await fetchPurchaseDetail(userId, id);
      useReceiptsStore.getState().seedEdit(purchaseToDraft(purchase), id);
      if (mounted.current) router.push(`/ticket/review/${id}`);
    } catch (err) {
      if (mounted.current) {
        useDialogStore.getState().show({
          title: 'No se pudo editar el recibo',
          message: err instanceof Error ? err.message : undefined,
          primaryLabel: 'Aceptar',
        });
      }
    } finally {
      editInFlight.current = false;
      if (mounted.current) setLoading(false);
    }
  };

  // Delete flow: confirm first (destructive), then remove the row + storage
  // photo and pop back — the home feed refetches via the invalidation inside
  // deleteReceipt. The store list row is purged too, so the detail screen
  // can't render a deleted receipt before the refetch lands (or offline).
  const deleteAndBack = async () => {
    if (!userId || deleting || loading) return;
    setDeleting(true);
    try {
      await deleteReceipt(userId, id);
      useReceiptsStore.getState().removeReceiptRow(id);
      // `disabled={deleting}` only disables the custom header/footer
      // buttons — the native back gesture stays active. Guard the pop with
      // `mounted` so a manual back out mid-delete never double-pops.
      if (mounted.current) router.back();
    } catch (err) {
      setDeleting(false);
      useDialogStore.getState().show({
        title: 'No se pudo eliminar el recibo',
        message: err instanceof Error ? err.message : undefined,
        primaryLabel: 'Aceptar',
      });
    }
  };

  const handleDeletePress = () => {
    if (deleting || loading) return;
    useDialogStore.getState().show({
      title: 'Eliminar recibo',
      message:
        'Se eliminará el recibo y su foto. Esta acción no se puede deshacer.',
      primaryLabel: 'Eliminar',
      tone: 'danger',
      secondaryLabel: 'Cancelar',
      onPrimary: () => void deleteAndBack(),
    });
  };

  const header = (
    <View style={styles.header}>
      <Pressable
        onPress={deleting ? undefined : () => router.back()}
        disabled={deleting}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Volver"
      >
        <Icon name="arrow.left" size={24} color={colors.textPrimary} />
      </Pressable>
      <Text style={styles.title}>Detalle del recibo</Text>
    </View>
  );

  if (isLoading && !receipt) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        {header}
        <View style={styles.notFound}>
          <Spinner size="sm" color={colors.textSecondary} />
          <Text style={styles.notFoundText}>Cargando recibo…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (detailQuery.isError && !receipt) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        {header}
        <View style={styles.notFound}>
          <Icon name="exclamationmark.triangle.fill" size={32} color={colors.danger} />
          <Text style={styles.notFoundText}>
            No se pudo cargar el recibo
          </Text>
          <Pressable
            onPress={() => detailQuery.refetch()}
            style={styles.retryButton}
            accessibilityRole="button"
            accessibilityLabel="Reintentar"
          >
            <Text style={styles.retryLabel}>Reintentar</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

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
  // Items of the open category sheet: THIS receipt's lines filtered by the
  // tapped category slug, plus the category's total from this receipt.
  const openCategoryItems = openCategory
    ? items.filter((item) => item.category === openCategory)
    : [];
  const openCategoryTotal = openCategory ? (categoryTotals[openCategory] ?? 0) : 0;
  const openCategoryLabel = openCategory
    ? getExpenseCategory(openCategory).label
    : '';

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
        ) : photoLoading || (receipt?.image_url && !photoFailed) ? (
          <View style={styles.photoPlaceholder}>
            <Spinner size="sm" color={colors.textSecondary} />
            <Text style={styles.photoPlaceholderText}>Cargando recibo...</Text>
          </View>
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
                    onPress={() => setOpenCategory(entry.key)}
                    accessibilityRole="button"
                    accessibilityLabel={`Ver artículos de ${entry.def.label}`}
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
                    <View style={styles.itemInfo}>
                      <Text style={styles.itemName} numberOfLines={1}>
                        {item.name}
                      </Text>
                      {(item.quantity ?? 1) > 1 ? (
                        <Text style={styles.itemQty}>
                          Cant. {item.quantity}
                        </Text>
                      ) : null}
                    </View>
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

      {/* Footer actions */}
      <View style={styles.footerWrap}>
        <Pressable
          onPress={() => void handleEditPress()}
          disabled={loading || deleting}
          style={[
            styles.footerAction,
            (loading || deleting) && styles.footerActionDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Editar recibo"
        >
          <Text style={styles.footerActionLabel}>
            {loading ? 'Cargando…' : 'Editar'}
          </Text>
        </Pressable>
        <Pressable
          onPress={handleDeletePress}
          disabled={loading || deleting}
          style={[
            styles.footerAction,
            styles.footerActionDanger,
            (loading || deleting) && styles.footerActionDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Eliminar recibo"
        >
          <Text style={styles.footerActionLabel}>
            {deleting ? 'Eliminando…' : 'Eliminar'}
          </Text>
        </Pressable>
      </View>

      {/* Fullscreen photo overlay — rendered as a regular View (not Modal)
          so GestureDetector works reliably on Android. */}
      {photoOpen ? (
        <View style={styles.photoModalBackdrop}>
          {/* Backdrop press: closes the overlay at 1×, resets the zoom when
              the user is already zoomed in (so the close gesture doesn't
              require the user to first reset). gesture-handler consumes
              double-tap / pinch touches before this fires. */}
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={handlePhotoBackdropPress}
            accessibilityRole="button"
            accessibilityLabel="Cerrar foto"
          />
          {/* Visible close button: a real tappable `IconButton` (the
              backdrop press below still closes at 1× / resets the zoom
              while zoomed). Closing always resets the zoom first — same
              contract as the backdrop and Android-back paths — so the
              next open never renders pre-zoomed/panned. Positioned via
              `photoModalClose` so it sits above the backdrop. */}
          <IconButton
            icon="xmark"
            iconSize={22}
            color={colors.textInverse}
            backgroundColor="rgba(0,0,0,0.4)"
            onPress={() => {
              resetPhotoZoom();
              setPhotoOpen(false);
            }}
            accessibilityLabel="Cerrar foto"
            style={styles.photoModalClose}
          />
          <Animated.View
            style={[styles.photoModalImageWrap, photoAnimatedStyle]}
            onLayout={(e) => {
              photoContainerW.value = e.nativeEvent.layout.width;
              photoContainerH.value = e.nativeEvent.layout.height;
            }}
          >
            <GestureDetector gesture={photoGesture}>
              <Image
                source={photoSource ? { uri: photoSource } : undefined}
                style={styles.photoModalImage}
                resizeMode="contain"
                onError={() => {
                  setPhotoOpen(false);
                  setPhotoFailed(true);
                }}
              />
            </GestureDetector>
          </Animated.View>
        </View>
      ) : null}

      <ReceiptCategoryItemsModal
        visible={openCategory !== null}
        categoryLabel={openCategoryLabel}
        total={openCategoryTotal}
        items={openCategoryItems}
        currency={currency}
        onClose={() => setOpenCategory(null)}
      />
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
    // Leaves room for the sticky edit/delete footer overlay.
    paddingBottom: 200,
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
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.92)',
    justifyContent: 'center',
    zIndex: 999,
    elevation: 999,
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
  // Animated.View that hosts the zoom transform. `flex: 1` makes it
  // fill the backdrop so `onLayout` measures the full viewport; the
  // Image inside fills this View at 1× and is what the pinch scales.
  // `overflow: hidden` on the backdrop (default for RN <View>) clips
  // the scaled image to the screen.
  photoModalImageWrap: {
    flex: 1,
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
  itemInfo: {
    flex: 1,
    gap: 2,
  },
  itemName: {
    ...typography.bodyMd,
    color: colors.textPrimary,
  },
  itemQty: {
    ...typography.labelSm,
    color: colors.textSecondary,
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
  retryButton: {
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.full,
    backgroundColor: colors.primary,
  },
  retryLabel: {
    ...typography.headlineMd,
    color: colors.textInverse,
  },
  footerWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerAction: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderRadius: radii.full,
    backgroundColor: colors.primary,
    minHeight: 48,
  },
  footerActionDanger: {
    backgroundColor: colors.danger,
  },
  footerActionDisabled: {
    opacity: 0.5,
  },
  footerActionLabel: {
    ...typography.headlineMd,
    color: colors.textInverse,
  },
});
