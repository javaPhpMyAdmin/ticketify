import { router, Stack, useLocalSearchParams } from 'expo-router';
import LottieView from 'lottie-react-native';
import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Animated,
  Image,
  ScrollView,
  StyleSheet,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  Card,
  Chip,
  Fab,
  Icon,
  IconButton,
  Pressable,
  Text,
  View,
} from '@/components';
import { useSessionUser } from '@/features/auth';
import { RenameItemModal, sanitizeItemName } from '@/features/items';
import {
  buildFeedRow,
  CategoryPickerModal,
  QUOTA_ERROR_MESSAGE,
  QuotaExceededError,
  ReceiptItemsList,
  reviewItemsToFeedItems,
  saveReceipt,
  updateReceipt,
  useReceiptDraftActions,
  useReceiptDraftDraft,
  useScanTicket,
} from '@/features/tickets';
import { formatCurrency, todayLocalISO } from '@/lib/format';
import {
  getSignedReceiptPhotoUrl,
  resolveReceiptPhotoPath,
} from '@/lib/supabase/receipt-photo';
import { useDialogStore } from '@/stores/use-dialog-store';
import { useReceiptsStore } from '@/stores/use-receipts-store';
import { useSettingsStore } from '@/stores/use-settings-store';
import { useToastStore } from '@/stores/use-toast-store';
import { colors, radii, spacing, typography } from '@/theme';
import type { CardType, PaymentMethod, ReviewItem } from '@/types';
import { PAYMENT_METHOD_LABELS } from '@/types';

/**
 * User-safe copy for save failures. Same posture as the profile/budget
 * `WRITE_ERROR_MESSAGE`: never leak raw PostgREST text to the user.
 * Lives inline here (review is its own feature concern) — mirrors the
 * `RENAME_ITEM_ERROR_MESSAGE` constant pattern in `useRenameItem`.
 */
const SAVE_ERROR_MESSAGE = 'No se pudo guardar. Inténtalo de nuevo.';

// Picker order: card first (the most common scan result), then the rest.
// Labels come from the shared `PAYMENT_METHOD_LABELS` map (types/index.ts),
// the same source the export builders use — the six pairs live in one place.
const paymentMethods: { key: PaymentMethod; label: string }[] = (
  ['card', 'cash', 'apple_pay', 'google_pay', 'transfer', 'other'] as const
).map((key) => ({ key, label: PAYMENT_METHOD_LABELS[key] }));

/** Spanish labels for the card kind detected on the receipt. */
const cardTypeLabels: Record<CardType, string> = {
  debit: 'Débito',
  credit: 'Crédito',
};

/** Capitalizes the first letter of the brand for display. */
function capitalize(value: string): string {
  return value.length > 0
    ? value.charAt(0).toUpperCase() + value.slice(1)
    : value;
}

/**
 * Catches a render throw from LottieView when the native module is
 * unavailable: the processing phase falls back to a static placeholder
 * instead of blanking the whole screen.
 */
class LottieErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export default function ReviewReceiptScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const { userId } = useSessionUser();
  // Edit mode only when the route id matches the stored editing id: the
  // camera flow pushes a fresh temp id that never equals a purchase uuid,
  // so a stale edit session can't hijack a new scan.
  const editingId = useReceiptsStore((s) => s.editingId);
  const editingMode = editingId !== null && editingId === params.id;
  // The receipt is denominated in the user's currency setting (default
  // UYU), the same store Home/History read — never a hardcoded code.
  const currency = useSettingsStore((s) => s.currency);
  const { draft } = useReceiptDraftDraft();
  const { setStore, setPayment, upsertItem, clear } = useReceiptDraftActions();
  // The scan flow is the single entry point for parsing: `scan()` runs
  // the upload + parse pipeline and seeds the store with the draft. A
  // failure leaves the store untouched, so the screen shows a retry state
  // instead of a half-empty form.
  const { scan, error: scanError, reset } = useScanTicket();

  // Edit skips the parse entirely: the draft was seeded before navigation,
  // so the form is ready on mount (no processing flash).
  const [parsing, setParsing] = useState(!editingMode);
  // Once the parse resolves the screen shows a short success beat before
  // revealing the review form: `processing` -> `success` -> form.
  const [phase, setPhase] = useState<'processing' | 'success'>('processing');
  // Marching dots shared by both parsing labels ("Procesando recibo" and
  // "Esperá un momento") so they always animate in sync.
  const dotOpacity = useRef([
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ]).current;
  const checkScale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // The dots are separate text nodes (baseline row siblings), so they get
    // real native views and opacity animates on the native driver. They sit
    // in the JS tree long enough that the 3 values are negligible either way.
    const loop = Animated.loop(
      Animated.stagger(220, [
        Animated.timing(dotOpacity[0], {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(dotOpacity[1], {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(dotOpacity[2], {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(dotOpacity[0], {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(dotOpacity[1], {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(dotOpacity[2], {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [dotOpacity]);

  // A fast real parse would flash a sub-second "Procesando recibo" beat,
  // so the floor below keeps the processing phase readable. The scan runs
  // the real parse with no artificial delay of its own, so this floor is
  // the only pacing on the screen.
  const MIN_PROCESSING_MS = 800;
  // How long the green success check stays on screen before the form.
  const SUCCESS_MS = 750;

  const runParse = useCallback(async () => {
    setParsing(true);
    setPhase('processing');
    reset();
    try {
      const startedAt = Date.now();
      await scan(draft?.image_url ?? '');
      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_PROCESSING_MS) {
        await new Promise<void>((resolve) =>
          setTimeout(resolve, MIN_PROCESSING_MS - elapsed),
        );
      }
      setPhase('success');
      Animated.spring(checkScale, {
        toValue: 1,
        friction: 5,
        tension: 90,
        useNativeDriver: true,
      }).start();
      await new Promise<void>((resolve) => setTimeout(resolve, SUCCESS_MS));
    } catch (err) {
      // A rejected scan (e.g. the parse-ticket edge function timing out) used
      // to escape as an unhandled promise rejection — dev showed a raw red
      // error overlay instead of real user copy. Now the failure is surfaced
      // through the global dialog store; `scan()` already sets `scanError`, so
      // the inline retry block below remains the retry affordance. The host
      // dismisses the dialog itself, so there is no onPrimary callback.
      useDialogStore.getState().show({
        title: 'No se pudo procesar el ticket',
        message:
          err instanceof Error
            ? err.message
            : 'No se pudo procesar el ticket. Inténtalo de nuevo.',
        primaryLabel: 'Aceptar',
      });
    } finally {
      // Guaranteed cleanup: a rejected scan must never leave the screen
      // stuck on the infinite "Procesando recibo…" state.
      setParsing(false);
    }
  }, [checkScale, draft?.image_url, reset, scan]);

  useEffect(() => {
    if (editingMode) {
      // Editing an existing receipt: the draft was already seeded by the
      // detail screen (seedEdit), so no parse runs here — there is no local
      // file to scan and re-parsing would clobber the seeded draft.
      if (!draft) {
        // The store was reset between seed and mount (rare): back out
        // instead of rendering an empty form.
        router.back();
        return;
      }
      return;
    }
    void runParse();
    // We intentionally key this on the route id only — the parse is
    // a one-shot effect for the lifetime of the review screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  const itemsTotal =
    draft?.items.reduce((acc, i) => acc + i.total_price, 0) ?? 0;
  // The declared total may legitimately be LOWER than the item sum when the
  // payment method earned a discount (e.g. "Desc. de ley 19210" debit-card
  // discount, printed on the receipt AFTER the items). A total that is
  // HIGHER than the item sum, on the other hand, can never be explained by a
  // discount and signals a parse error. So the check only flags the
  // impossible direction (paid more than the items add up to).
  // In edit mode the user is intentionally changing items, so the declared
  // total may lag behind — skip the mismatch check.
  const matches = editingMode
    ? true
    : draft
    ? draft.total <= itemsTotal + 0.01
    : false;

  // Read-only card detail shown inside the "Tarjeta" chip, e.g.
  // "Tarjeta · Maestro Débito". Gated on the selected payment method:
  // showing a card brand next to "Efectivo"/"Transferencia" would be
  // contradictory review data. The chip falls back to plain "Tarjeta"
  // when the parse detected no card, brand, or kind.
  const cardInfo =
    draft?.payment_method === 'card'
      ? [
          draft.card_brand ? capitalize(draft.card_brand) : null,
          draft.card_type ? cardTypeLabels[draft.card_type] : null,
        ]
          .filter(Boolean)
          .join(' ')
      : '';

  const [saving, setSaving] = useState(false);
  // Edit-mode thumbnail: the seeded draft carries the persisted storage path
  // (private bucket) which is NOT renderable — resolve a signed URL for
  // DISPLAY only, never mutating the `image_url` value updateReceipt will
  // save. In scan mode the draft carries a LOCAL file uri that renders
  // directly.
  const [thumbSource, setThumbSource] = useState<string | null>(null);
  // Signed URLs expire (RECEIPT_PHOTO_EXPIRY_SECONDS) and remote photos can
  // fail offline: once the Image errors, fall back to the placeholder
  // instead of a broken box (same pattern the detail screen uses).
  const [thumbFailed, setThumbFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setThumbFailed(false);
    const raw = draft?.image_url;
    if (!raw) {
      setThumbSource(null);
      return;
    }
    if (editingMode) {
      const classified = resolveReceiptPhotoPath(raw);
      if (!classified) {
        setThumbSource(null);
        return;
      }
      if (classified.kind === 'url') {
        setThumbSource(classified.value);
        return;
      }
      getSignedReceiptPhotoUrl(classified.value).then((signed) => {
        if (!cancelled) setThumbSource(signed);
      });
    } else {
      setThumbSource(raw);
    }
    return () => {
      cancelled = true;
    };
  }, [draft?.image_url, editingMode]);
  // Which item the rename modal is editing (null = closed). The edit
  // mutates the LOCAL draft only — `saveReceipt` already takes
  // `item.name` (tickets/api.ts:482), so the new name flows through on
  // CONFIRM. We intentionally do NOT call `useRenameItem` here:
  // touching the DB on every edit would race with the eventual confirm
  // write and could double-persist the rename for users who edit and
  // then cancel.
  const [renameTarget, setRenameTarget] = useState<ReviewItem | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const renameOpen = renameTarget !== null;

  const handleSelectRename = (newName: string) => {
    if (!renameTarget) return;
    // Same validation the post-scan hook runs — both flows share
    // `sanitizeItemName` so the rules (trim, non-empty, ≤120) live in
    // exactly one place.
    const sanitised = sanitizeItemName(newName);
    if (!sanitised.ok) {
      // Keep the modal open so the inline errorMessage stays visible.
      setRenameError(sanitised.message);
      return;
    }
    upsertItem({ ...renameTarget, name: sanitised.value });
    setRenameError(null);
    setRenameTarget(null);
  };

  // Which item's category the picker is editing (null = closed). The user's
  // tap writes the chosen key to `item.category_id`; the AI suggestion stays
  // in `ai_suggested_category_id` and the save path prefers the user's pick.
  // The modal stays mounted (visible=false) so its slide-out animation runs;
  // `lastCategoryTarget` keeps the title/number on screen while it animates.
  const [categoryTarget, setCategoryTarget] = useState<ReviewItem | null>(null);
  const lastCategoryTarget = useRef<ReviewItem | null>(null);
  if (categoryTarget) lastCategoryTarget.current = categoryTarget;
  const sheetTarget = categoryTarget ?? lastCategoryTarget.current;

  const handleSelectCategory = (categoryKey: string) => {
    if (!sheetTarget) return;
    upsertItem({ ...sheetTarget, category_id: categoryKey });
    setCategoryTarget(null);
  };
  // Synchronous double-tap guard: the `saving` state is async, so two taps
  // in the same frame would both read it as false and run the save twice.
  // The ref is set before any await, so a second tap in the same frame is
  // rejected immediately.
  const savingRef = useRef(false);

  const handleConfirm = async () => {
    // The save is async; guard against double-taps so the receipt is not
    // persisted twice (two `purchases` rows) and the screen is dismissed
    // exactly once.
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      if (draft && userId) {
        if (editingMode) {
          // editingMode guarantees editingId === params.id, so the route id
          // IS the purchase being edited.
          await updateReceipt(userId, params.id, draft);
          // The store list row is derived from the edited draft so the
          // detail screen shows the NEW values immediately — the home feed
          // refetch confirms later, but without this the detail screen would
          // keep the stale row forever while offline.
          const current = useReceiptsStore.getState();
          const existing = current.list.find((r) => r.id === params.id);
          // Aggregates through the same shared builder the home reads use
          // (category_totals / wants_snacks_total), so the edited row and
          // the feed can never drift apart.
          const row = buildFeedRow(
            {
              id: params.id,
              store_name: draft.store_name,
              purchase_date: draft.purchase_date,
              scanned_at: existing?.scanned_at ?? todayLocalISO(),
              total: draft.total,
              image_url: draft.image_url || null,
              status: 'confirmed',
            },
            reviewItemsToFeedItems(draft.items),
          );
          current.upsertReceiptRow(row);
        } else {
          await saveReceipt(userId, draft);
        }
      }
      clear();
      // Toast BEFORE `router.dismiss()` so the user lands on the previous
      // screen with a confirmation already on-screen. The `ToastHost` is
      // mounted at the root in `_layout.tsx`, so it survives the unmount
      // and renders on the destination route instead of dying with the
      // review screen.
      useToastStore
        .getState()
        .show(
          editingMode ? 'Cambios guardados.' : 'Recibo guardado.',
          'success',
        );
      router.dismiss();
    } catch (err) {
      // Writes can reject (network, RLS); the review screen stays up with
      // the draft intact so the user can retry. The toast surfaces the
      // error inline (root-mounted host) — no blocking Alert — and uses
      // the same user-safe posture as the profile/budget writes
      // (never raw PostgREST text). A HARD quota rejection surfaces its
      // own upgrade copy instead of the generic save message.
      savingRef.current = false;
      setSaving(false);
      useToastStore
        .getState()
        .show(
          err instanceof QuotaExceededError
            ? QUOTA_ERROR_MESSAGE
            : SAVE_ERROR_MESSAGE,
        );
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        {/* Top bar */}
        <View style={styles.topBar}>
          <IconButton
            icon="xmark"
            iconSize={22}
            onPress={() => {
              clear();
              router.dismiss();
            }}
            accessibilityLabel="Cerrar revisión"
          />
          <Text
            style={{ fontSize: 20, fontWeight: '700', color: colors.primary }}
          >
            Revisando ticket escaneado
          </Text>
          {thumbSource && !thumbFailed ? (
            <Image
              source={{ uri: thumbSource }}
              style={styles.thumb}
              onError={() => setThumbFailed(true)}
            />
          ) : (
            <View style={[styles.thumb, styles.thumbEmpty]}>
              <Icon name="doc.text" size={18} color={colors.textSecondary} />
            </View>
          )}
          <View style={{ flex: 1 }} />
        </View>

        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            parsing && styles.scrollContentParsing,
          ]}
        >
          {parsing ? (
            phase === 'success' ? (
              <View style={styles.parsingWrap}>
                <View style={styles.checkBubble}>
                  <Animated.View
                    style={{
                      transform: [{ scale: checkScale }],
                    }}
                  >
                    <Icon name="checkmark" size={40} color={colors.surface} />
                  </Animated.View>
                </View>
                <Text style={styles.parsingTitle}>Recibo listo</Text>
              </View>
            ) : (
              <View style={styles.parsingWrap}>
                <LottieErrorBoundary
                  fallback={
                    <View
                      style={[
                        styles.parsingAnimation,
                        styles.parsingAnimationFallback,
                      ]}
                    >
                      <Icon
                        name="doc.text"
                        size={44}
                        color={colors.textSecondary}
                      />
                    </View>
                  }
                >
                  <LottieView
                    source={require('../../../../assets/images/notebook-writing.json')}
                    autoPlay
                    loop
                    style={styles.parsingAnimation}
                  />
                </LottieErrorBoundary>
                {/* The dots are SIBLING text nodes in a baseline row, not
                    nested inside the label: React Native flattens nested
                    <Text>, so an inner Animated.Text never gets its own
                    native node and opacity can't animate (regardless of
                    driver). Separate nodes keep the dots on the same line
                    AND give them a real node to animate. */}
                <View style={styles.parsingRow}>
                  <Text style={styles.parsingTitle}>Procesando ticket</Text>
                  {dotOpacity.map((dot, index) => (
                    <Animated.Text
                      key={index}
                      style={[
                        styles.parsingTitle,
                        styles.parsingDot,
                        { opacity: dot },
                      ]}
                    >
                      .
                    </Animated.Text>
                  ))}
                </View>
                <View style={styles.parsingRow}>
                  <Text style={styles.parsingHint}>Espera un momento</Text>
                  {dotOpacity.map((dot, index) => (
                    <Animated.Text
                      key={index}
                      style={[
                        styles.parsingHint,
                        styles.parsingDot,
                        { opacity: dot },
                      ]}
                    >
                      .
                    </Animated.Text>
                  ))}
                </View>
              </View>
            )
          ) : scanError ? (
            // `scan` starts a draft before parsing, so on failure the store
            // still holds an empty draft — the retry state must not depend on
            // the draft being absent.
            <View style={styles.parsingWrap}>
              <Text style={styles.parsingTitle}>
                No se pudo procesar este ticket
              </Text>
              <Text style={styles.parsingHint}>
                Revisa que la foto sea clara e inténtalo de nuevo.
              </Text>
              <Pressable
                onPress={() => void runParse()}
                style={styles.retryButton}
                accessibilityRole="button"
              >
                <Text style={styles.retryLabel}>Intentar de nuevo</Text>
              </Pressable>
            </View>
          ) : (
            <>
              {/* Store + date + payment */}
              <Card>
                <Text style={styles.kicker}>TIENDA</Text>
                <TextInput
                  value={draft?.store_name ?? ''}
                  onChangeText={setStore}
                  style={styles.storeInput}
                  placeholder="Nombre de la tienda"
                  placeholderTextColor={colors.textSecondary}
                />
                <View style={styles.metaRow}>
                  <View style={styles.metaCol}>
                    <Text style={styles.kicker}>FECHA</Text>
                    <Text style={styles.metaValue}>
                      {draft?.purchase_date ?? '—'}
                    </Text>
                  </View>
                  <View style={styles.metaCol}>
                    <Text style={styles.kicker}>PAGO</Text>
                    <View style={styles.paymentRow}>
                      {paymentMethods.map((m) => {
                        const label =
                          m.key === 'card' &&
                          draft?.payment_method === 'card' &&
                          cardInfo
                            ? `Tarjeta · ${cardInfo}`
                            : m.label;
                        return (
                          <Pressable
                            key={m.key}
                            onPress={() => setPayment(m.key)}
                          >
                            <Chip
                              label={label}
                              selected={draft?.payment_method === m.key}
                            />
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                </View>
              </Card>

              {/* Items */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                  Artículos procesados ({draft?.items.length ?? 0})
                </Text>
                {draft?.items ? (
                  <ReceiptItemsList
                    items={draft.items}
                    currency={currency}
                    onPressCategory={(item) => setCategoryTarget(item)}
                    onToggleImpulse={(item, v) =>
                      upsertItem({ ...item, is_impulse: v })
                    }
                    onEditName={(item) => {
                      setRenameError(null);
                      setRenameTarget(item);
                    }}
                  />
                ) : null}
              </View>
            </>
          )}
        </ScrollView>

        {!parsing ? (
          <View style={styles.footerWrap}>
            <View style={styles.totalRow}>
              <Text style={styles.kicker}>Total del ticket</Text>
              <Text style={styles.totalValue}>
                {formatCurrency(draft?.total ?? itemsTotal, currency)}
              </Text>
            </View>
            {/* EDIT mode (soft hint, inline next to the total): the user is
                in the middle of editing the total — the items will catch up
                when they touch them — so a red footer banner would be
                noisy. Show a one-line hint next to the total instead. */}
            {editingMode && !matches ? (
              <Text style={styles.matchesInlineHint}>
                No coincide con la suma de los artículos
              </Text>
            ) : null}
            {/* SCAN mode (error banner in footer): the user is confirming a
                parse result, and a mismatch there is a real error path.
                Keep the existing footer banner with the green "Coincide"
                badge and the helpful "Incluye descuento de $X" detail.
                The badge is rendered ONLY when a working draft exists: during
                the save→clear→dismiss transition `draft` becomes null for a
                single frame, and `matches` would otherwise evaluate to a
                false "No coincide" — the guard shows nothing instead of a
                misleading verdict on that transient frame. */}
            {!editingMode && draft ? (
              <View style={styles.matchesRow}>
                <Text
                  style={[
                    styles.matchesText,
                    { color: matches ? colors.primary : colors.danger },
                  ]}
                >
                  {matches ? 'Coincide' : 'No coincide'}
                </Text>
                {!matches ? (
                  <Text style={styles.matchesDetail}>
                    Declarado {formatCurrency(draft.total, currency)}
                  </Text>
                ) : itemsTotal > (draft?.total ?? 0) + 0.01 ? (
                  <Text style={styles.matchesDetail}>
                    Incluye descuento de{' '}
                    {formatCurrency(itemsTotal - (draft?.total ?? 0), currency)}
                  </Text>
                ) : null}
              </View>
            ) : null}
            <Fab
              label="Confirmar y guardar"
              icon="bolt.fill"
              onPress={() => void handleConfirm()}
              disabled={saving}
              style={styles.confirmFab}
            />
          </View>
        ) : null}
      </SafeAreaView>

      <CategoryPickerModal
        visible={!!categoryTarget}
        itemName={sheetTarget?.name ?? ''}
        selectedKey={
          sheetTarget
            ? sheetTarget.category_id ?? sheetTarget.ai_suggested_category_id
            : null
        }
        onSelect={handleSelectCategory}
        onClose={() => setCategoryTarget(null)}
      />

      <RenameItemModal
        visible={renameOpen}
        currentName={renameTarget?.name ?? ''}
        isLoading={false}
        errorMessage={renameError}
        onChange={() => {
          // No-op: the modal owns its own buffer. This slot exists so
          // future telemetry / inline-validation hooks have a place to
          // hook in without an API change.
        }}
        onCancel={() => {
          setRenameError(null);
          setRenameTarget(null);
        }}
        onSave={handleSelectRename}
      />
    </>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  thumb: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
  },
  thumbEmpty: {
    backgroundColor: colors.chipBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: 200,
    gap: spacing.lg,
  },
  // While parsing there is no scrollable form, so the status block can
  // take the full height and sit centered instead of hugging the top bar.
  scrollContentParsing: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  parsingWrap: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  checkBubble: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    marginBottom: spacing.md,
  },
  parsingAnimation: {
    width: 140,
    height: 140,
    marginBottom: spacing.xs,
  },
  // Static stand-in for the Lottie animation when the native module is
  // unavailable (LottieErrorBoundary fallback).
  parsingAnimationFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.chipBg,
    borderRadius: radii.md,
  },
  parsingTitle: {
    ...typography.headlineLg,
    fontSize: 34,
    lineHeight: 42,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  parsingHint: {
    ...typography.bodyLg,
    fontSize: 20,
    lineHeight: 26,
    color: colors.textSecondary,
  },
  // Row layout keeps the marching dots on the same line as the label:
  // baseline alignment sits them on the text baseline, and as separate
  // nodes (not nested Text) they animate reliably.
  parsingRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  parsingDot: {
    // Inline dots inherit the label's font metrics via the style array;
    // this only pins the extra spacing before the first dot.
    marginLeft: 2,
  },
  retryButton: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: radii.md,
  },
  retryLabel: {
    ...typography.labelSm,
    color: colors.surface,
    textAlign: 'center',
  },
  kicker: {
    ...typography.labelCaps,
    color: colors.textSecondary,
  },
  storeInput: {
    ...typography.headlineMd,
    color: colors.textPrimary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.sm,
    marginTop: spacing.xs,
  },
  metaRow: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginTop: spacing.lg,
  },
  metaCol: {
    flex: 1,
    gap: spacing.xs,
  },
  metaValue: {
    ...typography.bodyLg,
    color: colors.textPrimary,
  },
  paymentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  section: {
    gap: spacing.md,
  },
  sectionTitle: {
    ...typography.headlineMd,
    color: colors.textPrimary,
  },
  footerWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  totalValue: {
    ...typography.headlineLg,
    color: colors.textPrimary,
  },
  matchesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  matchesText: {
    ...typography.labelSm,
    fontWeight: '700',
  },
  matchesDetail: {
    ...typography.labelSm,
    color: colors.textSecondary,
  },
  // Inline hint shown in EDIT mode when the user just bumped `total`
  // and the items haven't caught up yet. Lives next to the total value
  // (in the footer) so it's right where the user's eyes are, not as a
  // red banner at the bottom of the screen.
  matchesInlineHint: {
    ...typography.labelSm,
    color: colors.danger,
  },
  confirmFab: {
    marginTop: spacing.sm,
  },
});
