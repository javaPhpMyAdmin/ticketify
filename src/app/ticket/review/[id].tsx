import { useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, TextInput } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
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
import {
  ReceiptItemsList,
  useReceiptDraftActions,
  useReceiptDraftDraft,
  useScanTicket,
} from '@/features/tickets';
import { formatCurrency } from '@/lib/format';
import { colors, radii, spacing, typography } from '@/theme';
import type { PaymentMethod } from '@/types';

const paymentMethods: { key: PaymentMethod; label: string }[] = [
  { key: 'card', label: 'Card' },
  { key: 'cash', label: 'Cash' },
  { key: 'apple_pay', label: 'Apple Pay' },
  { key: 'transfer', label: 'Transfer' },
];

export default function ReviewReceiptScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const { draft } = useReceiptDraftDraft();
  const { setStore, setPayment, upsertItem, clear } = useReceiptDraftActions();
  // The scan flow is the single entry point for parsing: `scan()` runs
  // the upload + parse pipeline and seeds the store with the draft.
  const { scan } = useScanTicket({ userId: null });

  const [parsing, setParsing] = useState(true);

  // Mock parse after a short delay so we can show the loading state.
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      await scan(draft?.image_url ?? '');
      if (cancelled) return;
      setParsing(false);
    }, 2000);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // We intentionally key this on the route id only — the parse is
    // a one-shot effect for the lifetime of the review screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  const itemsTotal = draft?.items.reduce((acc, i) => acc + i.total_price, 0) ?? 0;
  const matches = draft ? Math.abs(itemsTotal - draft.total) < 0.01 : false;

  const handleConfirm = () => {
    // TODO: persist to Supabase via the `saveReceipt` helper in
    // `features/tickets/api.ts`.
    clear();
    router.dismiss();
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
            accessibilityLabel="Close review"
          />
          {draft?.image_url ? (
            <Image source={{ uri: draft.image_url }} style={styles.thumb} />
          ) : (
            <View style={[styles.thumb, styles.thumbEmpty]}>
              <Icon name="doc.text" size={18} color={colors.textSecondary} />
            </View>
          )}
          <View style={{ flex: 1 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent}>
          {parsing ? (
            <View style={styles.parsingWrap}>
              <Text style={styles.parsingTitle}>Parsing receipt…</Text>
              <Text style={styles.parsingHint}>Sending to Google Gemini 1.5 Flash</Text>
            </View>
          ) : (
            <>
              {/* Store + date + payment */}
              <Card>
                <Text style={styles.kicker}>STORE</Text>
                <TextInput
                  value={draft?.store_name ?? ''}
                  onChangeText={setStore}
                  style={styles.storeInput}
                  placeholder="Store name"
                  placeholderTextColor={colors.textSecondary}
                />
                <View style={styles.metaRow}>
                  <View style={styles.metaCol}>
                    <Text style={styles.kicker}>DATE</Text>
                    <Text style={styles.metaValue}>{draft?.purchase_date ?? '—'}</Text>
                  </View>
                  <View style={styles.metaCol}>
                    <Text style={styles.kicker}>PAYMENT</Text>
                    <View style={styles.paymentRow}>
                      {paymentMethods.map((m) => (
                        <Pressable key={m.key} onPress={() => setPayment(m.key)}>
                          <Chip
                            label={m.label}
                            selected={draft?.payment_method === m.key}
                          />
                        </Pressable>
                      ))}
                    </View>
                  </View>
                </View>
              </Card>

              {/* Items */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                  Parsed Items ({draft?.items.length ?? 0})
                </Text>
                {draft?.items ? (
                  <ReceiptItemsList
                    items={draft.items}
                    onToggleImpulse={(item, v) => upsertItem({ ...item, is_impulse: v })}
                  />
                ) : null}
              </View>
            </>
          )}
        </ScrollView>

        {!parsing ? (
          <View style={styles.footerWrap}>
            <View style={styles.totalRow}>
              <Text style={styles.kicker}>Receipt Total</Text>
              <Text style={styles.totalValue}>
                {formatCurrency(itemsTotal, 'USD')}
              </Text>
            </View>
            <View style={styles.matchesRow}>
              <Text
                style={[styles.matchesText, { color: matches ? colors.primary : colors.danger }]}
              >
                {matches ? 'Matches' : 'Mismatch'}
              </Text>
              {!matches ? (
                <Text style={styles.matchesDetail}>
                  Declared {formatCurrency(draft?.total ?? 0, 'USD')}
                </Text>
              ) : null}
            </View>
            <Fab
              label="Confirm & Save"
              icon="bolt.fill"
              onPress={handleConfirm}
              style={styles.confirmFab}
            />
          </View>
        ) : null}
      </SafeAreaView>
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
    paddingHorizontal: spacing.lg,
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
  parsingWrap: {
    paddingVertical: spacing.xxl * 2,
    alignItems: 'center',
    gap: spacing.sm,
  },
  parsingTitle: {
    ...typography.headlineMd,
    color: colors.textPrimary,
  },
  parsingHint: {
    ...typography.bodyMd,
    color: colors.textSecondary,
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
  confirmFab: {
    marginTop: spacing.sm,
  },
});
