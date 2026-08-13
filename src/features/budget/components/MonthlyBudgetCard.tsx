import { StyleSheet } from 'react-native';

import { BudgetCard, Card, Pressable, Text, View } from '@/components';
import { formatCurrency } from '@/lib/format';
import { colors, spacing } from '@/theme';

export interface MonthlyBudgetCardProps {
  spent: number;
  limit: number;
  currency: string;
  /** When true, also renders a "Wants / Snacks" callout under the card. */
  showCallout?: boolean;
  wantsSnacksTotal?: number;
  /**
   * Optional tap handler for the "Wants / Snacks" callout. When provided,
   * the callout becomes a pressable affordance that opens a per-item
   * breakdown of impulse spend (the home screen owns the modal — the card
   * itself only declares the affordance). When omitted, the callout stays
   * static so callers without a wired handler keep their previous layout.
   */
  onPressSnacks?: () => void;
}

/**
 * Feature-level composition: a `BudgetCard` and, optionally, the
 * "Wants / Snacks" micro-expense callout that lives next to it on
 * the home screen. When `onPressSnacks` is provided the callout body
 * becomes a Pressable, preserving the existing Card chrome. The callout
 * stays a static `View` when no handler is wired so callers without the
 * breakdown modal still render unchanged.
 */
export function MonthlyBudgetCard({
  spent,
  limit,
  currency,
  showCallout = false,
  wantsSnacksTotal = 0,
  onPressSnacks,
}: MonthlyBudgetCardProps) {
  // The Card chrome (background, border, padding, radius) is provided by
  // the organism and shared by both branches. Only the body container
  // switches between a static View and a Pressable, so the layout is
  // pixel-stable across states.
  const body = (
    <>
      <View style={{ backgroundColor: colors.surface }}>
        <Text style={styles.kicker}>MICROGASTOS</Text>
        <Text style={styles.calloutLabel}>Antojos/Snacks</Text>
      </View>
      <View style={styles.calloutRow}>
        <View
          style={{
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.surface,
          }}
        >
          <Text
            style={{
              fontSize: 18,
              fontWeight: '900',
              color: colors.primary,
            }}
          >
            {formatCurrency(wantsSnacksTotal, currency)}
          </Text>
          <Text style={styles.calloutAmount}>este mes</Text>
        </View>
      </View>
    </>
  );

  return (
    <View style={styles.wrap}>
      <BudgetCard spent={spent} limit={limit} currency={currency} />
      {showCallout ? (
        onPressSnacks ? (
          <Card style={styles.calloutCard}>
            <Pressable
              onPress={onPressSnacks}
              disabled={wantsSnacksTotal === 0}
              accessibilityRole="button"
              accessibilityLabel="Ver desglose de antojos/snacks"
              accessibilityState={{ disabled: wantsSnacksTotal === 0 }}
              style={({ pressed }) => [
                styles.calloutPressable,
                pressed && styles.calloutPressed,
              ]}
            >
              {body}
            </Pressable>
          </Card>
        ) : (
          <Card style={styles.calloutCard}>
            <View style={styles.calloutPressable}>{body}</View>
          </Card>
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.lg,
  },
  calloutCard: {
    padding: 0,
    overflow: 'hidden',
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
  },
  calloutPressable: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  calloutPressed: {
    opacity: 0.85,
  },
  kicker: {
    // ...typography.labelCaps,
    fontSize: 17,
    fontWeight: '900',
    color: colors.textSecondary,
  },
  calloutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  calloutLabel: {
    // ...typography.bodyLg,
    color: colors.textPrimary,
    top: 2,
    fontWeight: '600',
    fontSize: 22,
  },
  calloutAmount: {
    // ...typography.labelSm,
    color: colors.textSecondary,
    fontSize: 16,
    fontWeight: '700',
  },
});
