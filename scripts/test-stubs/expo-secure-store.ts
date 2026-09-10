/**
 * Test stub for `expo-secure-store` used by the i18n init harness.
 *
 * `getItemAsync` / `setItemAsync` / `deleteItemAsync` mirror the real
 * API surface but operate on an in-memory map. The
 * `__TEST_FORCE_SECURE_STORE_ERROR__` env flag forces `getItemAsync`
 * to reject — the store + adapter contract is that a thrown error
 * from this module must collapse to `null` (no override) instead of
 * crashing the boot.
 */

const storage = new Map<string, string>();

export function getItemAsync(key: string): Promise<string | null> {
  if (process.env.__TEST_FORCE_SECURE_STORE_ERROR__ === '1') {
    return Promise.reject(new Error('forced: SecureStore unavailable'));
  }
  return Promise.resolve(storage.get(key) ?? null);
}

export function setItemAsync(key: string, value: string): Promise<void> {
  storage.set(key, value);
  return Promise.resolve();
}

export function deleteItemAsync(key: string): Promise<void> {
  storage.delete(key);
  return Promise.resolve();
}

export async function isAvailableAsync(): Promise<boolean> {
  return true;
}