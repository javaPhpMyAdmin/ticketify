/**
 * Dev-only mock for the parse pipeline — lets UI work (loading animation,
 * review screen, chip states) be exercised without hitting the edge
 * function or spending Gemini tokens.
 *
 * Enable with `EXPO_PUBLIC_MOCK_PARSE=1` in `.env` (or the shell), and tune
 * how long "Procesando recibo…" stays on screen with
 * `EXPO_PUBLIC_MOCK_PARSE_DELAY_MS` (default 2500). Env vars are inlined at
 * build time by Expo, so restart the dev server after changing them.
 *
 * SECURITY: like the other mock flags, this is gated on `__DEV__` so a
 * Release / EAS build never compiles the mock branch (Expo inlines
 * `EXPO_PUBLIC_*` into every build profile; `__DEV__` is false in release).
 *
 * The fixture mirrors what the edge function returns after the client
 * mapping: a card receipt with a Maestro debit, items whose sum equals the
 * total (so the review screen shows "Coincide"), and an impulse-free list.
 */
import { tempId, todayLocalISO } from '@/lib/format';
import type { ParsedReceipt } from '../api';

export const USE_MOCK_PARSE =
  __DEV__ && process.env.EXPO_PUBLIC_MOCK_PARSE === '1';

export const MOCK_PARSE_DELAY_MS = Number(
  process.env.EXPO_PUBLIC_MOCK_PARSE_DELAY_MS ?? 2500,
);

export function mockParsedReceipt(): ParsedReceipt {
  return {
    store: 'Supermercado Don Pedro',
    // Local calendar time, not a UTC slice: the draft's purchase_date seeds
    // the saved receipt and must land in the current month on Home even for
    // late-evening scans in UTC-x zones.
    date: todayLocalISO(),
    total: 12800.5,
    payment_method: 'card',
    card_brand: 'Maestro',
    card_type: 'debit',
    items: [
      {
        temp_id: tempId(),
        name: 'Yerba mate 1kg',
        quantity: 1,
        unit_price: 6500,
        total_price: 6500,
        category_id: null,
        is_impulse: false,
        ai_suggested_category_id: 'otros',
      },
      {
        temp_id: tempId(),
        name: 'Leche entera 1L',
        quantity: 1,
        unit_price: 1800,
        total_price: 1800,
        category_id: null,
        is_impulse: false,
        ai_suggested_category_id: 'lacteos',
      },
      {
        temp_id: tempId(),
        name: 'Pan francés',
        quantity: 2,
        unit_price: 1200,
        total_price: 2400,
        category_id: null,
        is_impulse: false,
        ai_suggested_category_id: 'panaderia',
      },
      {
        temp_id: tempId(),
        name: 'Queso cremoso',
        quantity: 1,
        unit_price: 2100.5,
        total_price: 2100.5,
        category_id: null,
        is_impulse: false,
        ai_suggested_category_id: 'lacteos',
      },
    ],
  };
}
