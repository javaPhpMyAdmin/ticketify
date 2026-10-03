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
 *
 * FALLING BACK TO `USD` IS NOT SILENT. Every failure mode here ends in a real
 * user's profile row being born with the wrong currency, and the wrong
 * currency is a wrong balance rather than a cosmetic bug — so each path
 * announces itself:
 *
 *   - `getLocales()` returned an EMPTY list → debug. The native module is
 *     alive and simply has nothing to say yet (a headless/emulator boot); a
 *     real device always reports at least one locale.
 *   - `getLocales()` THREW → warn. The native bridge is unavailable or broken,
 *     which is the case worth a device log.
 *
 * Neither branch reads a second time, retries, or throws: the region is a
 * nicety for a row that does not exist yet, and the user picks the real
 * currency in settings anyway. Logging is fire-and-forget and carries NO user
 * identifiers — the locale/region string is a device setting, not PII, and
 * nothing user-specific is interpolated.
 */
export function detectDeviceDefaultCurrency(): SupportedCurrency {
  try {
    const locales = getLocales();
    const first = locales[0];
    if (locales.length === 0) {
      console.debug(
        '[currency] device region unavailable: getLocales() returned no locales; the profile row will be created with the USD default',
      );
      return detectDefaultCurrency(undefined);
    }
    return detectDefaultCurrency(first?.languageTag, first?.regionCode);
  } catch (err) {
    // Read the message only. A native-bridge failure can carry a stack with
    // device paths in it, and none of that belongs in an analytics-grade log.
    console.warn(
      '[currency] device region detection failed; falling back to the USD default:',
      err instanceof Error ? err.message : 'non-Error thrown by the native module',
    );
    return detectDefaultCurrency(undefined);
  }
}