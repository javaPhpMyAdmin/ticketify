import { useSettingsStore } from '@/stores/use-settings-store';

/**
 * Read-only view of the currency-hydration gate.
 *
 * A separate hook (instead of components importing `useSettingsStore`
 * directly) is what keeps the rule enforceable: there is exactly ONE way to
 * ask whether the profile currency is known, so a screen cannot accidentally
 * read `currency` and assume the value is real. A `useCurrency()` pairing
 * would be the tempting next export and is deliberately absent — handing out
 * both together invites exactly the misuse this hook exists to prevent.
 *
 * While this returns `false` the currency formatters withhold their symbol,
 * so money screens render the bare grouped number rather than a confidently
 * wrong unit.
 */
export function useCurrencyHydrated(): boolean {
  return useSettingsStore((s) => s.currencyHydrated);
}