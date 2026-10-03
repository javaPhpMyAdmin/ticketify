/**
 * Device-currency adapter — the ONLY native `getLocales()` reader on the
 * currency path.
 *
 * `detectDefaultCurrency` in `detector.ts` stays pure (no native bridge, no
 * `Intl.*`), and `profile-sync.ts` stays Supabase-only, so the native read
 * lives here instead — the same separation `localeSecureStore.ts` keeps for
 * SecureStore. Mirrors `useLocaleStore.ts`'s `resolveActiveLocale`: read
 * `getLocales()[0]`, pass BOTH the tag and the platform's own `regionCode`
 * (on iOS that answer beats parsing the tag), and fail soft.
 *
 * The result is written at profile-row CREATION only, by
 * `ensureProfileCurrency`'s create-only INSERT. Nothing here writes.
 */
import { getLocales } from 'expo-localization';

import { detectDefaultCurrency } from './detector';
import type { SupportedCurrency } from '@/lib/format';

/**
 * The currency a first-launch profile row is born with, derived from the
 * device region. Always a supported code — an unknown, missing or failing
 * region resolves to `USD` rather than throwing, so sign-in never breaks on a
 * native-bridge hiccup.
 */
export function detectDeviceDefaultCurrency(): SupportedCurrency {
  try {
    const first = getLocales()[0];
    return detectDefaultCurrency(first?.languageTag, first?.regionCode);
  } catch {
    return detectDefaultCurrency(undefined);
  }
}