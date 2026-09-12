import type { CardType, PaymentMethod } from '@/types';

/**
 * Shared payment picker data for the ticket entry screens (scan review and
 * manual). Picker order: card first (the most common scan result), then the
 * rest.
 *
 * Labels are NOT precomputed here — each entry carries the CATALOG KEY that
 * resolves the label, so React components call `t(key)` at render time and
 * the export builders call `i18next.t(key)` at call time (REQ-10). A
 * precomputed module-level string would freeze the label at import time and
 * never react to a language change.
 */
export const PAYMENT_METHOD_KEYS: readonly PaymentMethod[] = [
  'card',
  'cash',
  'apple_pay',
  'google_pay',
  'transfer',
  'other',
];

/**
 * Catalog key for each payment-method label (common namespace). Typed as
 * literals (`as const`) so `t(PAYMENT_METHOD_LABEL_KEYS[method])` passes
 * the strict i18next key union (src/i18n/types.ts) instead of a loose
 * `string`.
 */
export const PAYMENT_METHOD_LABEL_KEYS = {
  card: 'common:paymentMethodCard',
  cash: 'common:paymentMethodCash',
  apple_pay: 'common:paymentMethodApplePay',
  google_pay: 'common:paymentMethodGooglePay',
  transfer: 'common:paymentMethodTransfer',
  other: 'common:paymentMethodOther',
} as const;

/**
 * Catalog key for each card-kind label (tickets namespace). Literal-typed
 * for the same strict-key reason as `PAYMENT_METHOD_LABEL_KEYS`.
 */
export const CARD_TYPE_LABEL_KEYS = {
  debit: 'tickets:cardTypeDebit',
  credit: 'tickets:cardTypeCredit',
} as const;

/** Card-kind picker keys for the manual entry's display-only selector. */
export const CARD_TYPE_KEYS: readonly CardType[] = ['debit', 'credit'];