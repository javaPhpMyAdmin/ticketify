/**
 * Persists the recently-chosen currency codes (`useSettingsStore.recentCurrencies`)
 * in `@react-native-async-storage/async-storage`.
 *
 * Mirrors `src/i18n/storage/localeSecureStore.ts` in shape: one versioned key,
 * two thin async seams, and a hard "never throws" contract so the store stays
 * the in-memory authority while this module is a best-effort mirror.
 *
 *   - `loadRecentCurrencies()` collapses a missing / corrupt / unparseable
 *     value to `[]` (a fresh install and a broken blob are the same thing to
 *     the caller).
 *   - `saveRecentCurrencies(list)` swallows a write failure (logged). A failed
 *     mirror must NEVER block a currency selection; the next selection retries.
 *
 * The AsyncStorage module is resolved through a LAZY `require` inside a
 * try/catch, exactly like `src/lib/revenuecat.ts` and
 * `src/features/tickets/api.ts`. The native-bound package cannot be loaded in
 * plain Node (its ESM entry fails to resolve), and every test harness that
 * compiles `use-settings-store.ts` — `test-profile-hook`, `test-monthly-cache`,
 * `test-household-category-items` — would crash at module load if this were a
 * top-level `import`. Staying lazy keeps this module loadable there, where the
 * seam simply degrades to "no stored recents".
 */
export const RECENT_CURRENCIES_KEY = 'ticketify.recent-currencies.v1';

/**
 * The minimal AsyncStorage surface this module needs. The real module
 * satisfies it structurally (`getItem` / `setItem` return promises).
 */
interface AsyncStorageBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/**
 * Resolve the AsyncStorage backend lazily, or `null` when the native module is
 * unavailable (plain-Node harness, unlinked native module). Never throws.
 */
function getBackend(): AsyncStorageBackend | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require('@react-native-async-storage/async-storage') as
      | ({ default?: AsyncStorageBackend } & AsyncStorageBackend)
      | undefined;
    if (!loaded) return null;
    // The CJS build exports `{ default: AsyncStorage }` (interop shape); fall
    // back to the module itself when a future version exports it directly.
    return loaded.default ?? loaded;
  } catch {
    return null;
  }
}

/**
 * Read the persisted recent codes, most-recent-first. Returns `[]` when no
 * value is stored, the value is not a JSON array, or parsing fails — the
 * adapter never throws, so callers can rely on `[]` meaning "no stored list".
 * Non-string members of a stored array are dropped rather than trusted.
 */
export async function loadRecentCurrencies(): Promise<string[]> {
  try {
    const backend = getBackend();
    if (!backend) return [];
    const raw = await backend.getItem(RECENT_CURRENCIES_KEY);
    if (raw == null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((code): code is string => typeof code === 'string');
  } catch {
    return [];
  }
}

/**
 * Persist the recent codes. Best-effort: failures are swallowed and logged, so
 * an AsyncStorage write failure can never block a currency selection. The
 * in-memory store has already updated by the time this runs.
 */
export async function saveRecentCurrencies(list: string[]): Promise<void> {
  try {
    const backend = getBackend();
    if (!backend) return;
    await backend.setItem(RECENT_CURRENCIES_KEY, JSON.stringify(list));
  } catch (err) {
    console.warn('[settings] failed to persist recent currencies', err);
  }
}
