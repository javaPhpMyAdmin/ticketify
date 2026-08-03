/**
 * Test double for `@/lib/supabase/storage-adapter` (reliability re-gate
 * harness). In-memory backend so the compiled session store and
 * auth-mode-storage modules run in plain node; the adapter's chunking itself
 * is already covered by `pnpm test:adapter` on the real module.
 */
const store = new Map<string, string>();
let available = true;
let hangAvailability = false;
let hangItemReads = false;

export function __resetStorage(): void {
  store.clear();
  available = true;
  hangAvailability = false;
  hangItemReads = false;
}

export function __setStorageAvailable(value: boolean): void {
  available = value;
}

/** When true, `isSecureStoreAvailable()` never resolves (timeout branch). */
export function __setStorageHang(value: boolean): void {
  hangAvailability = value;
}

/**
 * When true, `getItem`/`setItem`/`removeItem` never resolve — simulates a
 * hung SecureStore backend so the harness can exercise the mode-read timeout
 * (W-2) independently of the availability probe.
 */
export function __setStorageReadHang(value: boolean): void {
  hangItemReads = value;
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

const hung = <T,>(): Promise<T> => new Promise<T>(() => {});

export const secureStoreAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    if (hangItemReads) return hung<string | null>();
    return store.has(key) ? (store.get(key) ?? null) : null;
  },
  setItem: async (key: string, value: string): Promise<void> => {
    if (hangItemReads) return hung<void>();
    store.set(key, value);
  },
  removeItem: async (key: string): Promise<void> => {
    if (hangItemReads) return hung<void>();
    store.delete(key);
  },
};
