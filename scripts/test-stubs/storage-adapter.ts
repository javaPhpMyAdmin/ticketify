/**
 * Test double for `@/lib/supabase/storage-adapter` (session-restore
 * harness). In-memory backend so the compiled session store runs in plain
 * node; the adapter's chunking itself is already covered by `pnpm
 * test:adapter` on the real module.
 */
const store = new Map<string, string>();
let available = true;
let hangAvailability = false;

/**
 * The storage contract the app's modules expect from the adapter (mirrors
 * the real `StorageAdapter` in src/lib/supabase/storage-adapter.ts so the
 * compiled legal/pending modules type-check against this double).
 */
export type StorageAdapter = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

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

export async function isSecureStoreAvailable(): Promise<boolean> {
  if (hangAvailability) return new Promise<boolean>(() => {});
  return available;
}

export const secureStoreAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    return store.has(key) ? (store.get(key) ?? null) : null;
  },
  setItem: async (key: string, value: string): Promise<void> => {
    store.set(key, value);
  },
  removeItem: async (key: string): Promise<void> => {
    store.delete(key);
  },
};
