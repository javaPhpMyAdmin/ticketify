import type { CardType, PaymentMethod } from '@/types';
import { PAYMENT_METHOD_LABELS } from '@/types';

/**
 * Shared payment picker data for the ticket entry screens (scan review and
 * manual). Picker order: card first (the most common scan result), then the
 * rest. Labels come from the shared `PAYMENT_METHOD_LABELS` map
 * (types/index.ts), the same source the export builders use.
 */
export const paymentMethods: { key: PaymentMethod; label: string }[] = (
  ['card', 'cash', 'apple_pay', 'google_pay', 'transfer', 'other'] as const
).map((key) => ({ key, label: PAYMENT_METHOD_LABELS[key] }));

/** Spanish labels for the card kind detected on the receipt. */
export const cardTypeLabels: Record<CardType, string> = {
  debit: 'Débito',
  credit: 'Crédito',
};

/**
 * Card-kind chips for the manual entry's display-only card-type selector.
 * Not persisted (decision #1137) — purely for the UI picker.
 */
export const cardTypeOptions: { key: CardType; label: string }[] = [
  { key: 'debit', label: 'Débito' },
  { key: 'credit', label: 'Crédito' },
];
