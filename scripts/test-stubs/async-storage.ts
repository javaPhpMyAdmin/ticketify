/**
 * Test stub for `@react-native-async-storage/async-storage` used by the
 * onboarding storage harness.
 *
 * `getItem` / `setItem` / `removeItem` mirror the real API surface but
 * operate on an in-memory map. The `__TEST_FORCE_ASYNC_STORAGE_ERROR__`
 * env flag forces `getItem` / `setItem` / `removeItem` to reject — the
 * storage helper must collapse the rejection to a safe default instead
 * of crashing the gate.
 */

const storage = new Map<string, string>();

function shouldForceError(): boolean {
  return process.env.__TEST_FORCE_ASYNC_STORAGE_ERROR__ === '1';
}

export function getItem(key: string): Promise<string | null> {
  if (shouldForceError()) {
    return Promise.reject(new Error('forced: AsyncStorage unavailable'));
  }
  return Promise.resolve(storage.has(key) ? (storage.get(key) as string) : null);
}

export function setItem(key: string, value: string): Promise<void> {
  if (shouldForceError()) {
    return Promise.reject(new Error('forced: AsyncStorage unavailable'));
  }
  storage.set(key, value);
  return Promise.resolve();
}

export function removeItem(key: string): Promise<void> {
  if (shouldForceError()) {
    return Promise.reject(new Error('forced: AsyncStorage unavailable'));
  }
  storage.delete(key);
  return Promise.resolve();
}
