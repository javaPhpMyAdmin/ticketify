/**
 * Test double for `@/lib/supabase/storage-adapter` (reliability re-gate
 * harness). In-memory backend so the compiled session store and
 * auth-mode-storage modules run in plain node; the adapter's chunking itself
 * is already covered by `pnpm test:adapter` on the real module.
 */
const store = new Map<string, string>();
let available = true;
let hangAvailability = false;

export function __resetStorage(): void {
  store.clear();
  available = true;
  hangAvailability = false;
}

export function __setStorageAvailable(value: boolean): void {
  available = value;
}

/** When true, `isSecureStoreAvailable()` never resolves (timeout branch). */
export function __setStorageHang(value: boolean): void {
  hangAvailability = value;
}

export function __seedStoredValue(key: string, value: string): void {
  store.set(key, value);
}

export function __readStoredValue(key: string): string | undefined {
  return store.get(key);
}

export async function isSecureStoreAvailable(): Promise<boolean> {
  if (hangAvailability) return new Promise<boolean>(() => {});
  return available;
}

export const secureStoreAdapter = {
  getItem: async (key: string): Promise<string | null> =>
    store.has(key) ? (store.get(key) ?? null) : null,
  setItem: async (key: string, value: string): Promise<void> => {
    store.set(key, value);
  },
  removeItem: async (key: string): Promise<void> => {
    store.delete(key);
  },
};
