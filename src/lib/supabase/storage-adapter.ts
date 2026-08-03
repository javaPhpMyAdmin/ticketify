/**
 * Chunked SecureStore-backed storage adapter for the Supabase client.
 *
 * supabase-js expects the AsyncStorage contract (`getItem` / `setItem` /
 * `removeItem`) and persists the full session JSON (user + access/refresh
 * tokens). That JSON can exceed SecureStore's 2048-byte per-value limit, so
 * values are split into chunks of at most `CHUNK_MAX_CHARS` characters and
 * stored under derived keys:
 *
 *   <storageKey>.meta  -> { count, length } chunk metadata
 *   <storageKey>.0..n  -> the value chunks
 *
 * supabase-js storage keys look like `sb-<ref>-auth-token` (letters, digits,
 * hyphens), so every derived key stays inside the SecureStore key charset
 * `[A-Za-z0-9._-]` — no colons or other reserved characters.
 *
 * `removeItem` deletes the meta key and every chunk it references. When meta
 * is missing (an interrupted write, or a value written by a layout without
 * meta) it sweeps a bounded range of chunk keys so the expired-token cleanup
 * path can never leave orphan chunks behind.
 *
 * The native `expo-secure-store` module is loaded lazily so the pure chunking
 * logic stays testable in isolation (an in-memory backend can be injected via
 * `createSecureStoreAdapter`).
 */

export const CHUNK_MAX_CHARS = 1800;

/**
 * Number of chunk keys swept when meta is missing. 16 chunks * 1800 chars is
 * roughly 28 KB of session JSON — far beyond any realistic session payload.
 */
const MAX_CHUNKS = 16;

const META_SUFFIX = '.meta';

export type SecureStoreBackend = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};

/** The storage contract supabase-js `auth.storage` expects. */
export type StorageAdapter = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

type ChunkMeta = {
  count: number;
  length: number;
};

export function splitIntoChunks(
  value: string,
  maxChars: number = CHUNK_MAX_CHARS,
): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += maxChars) {
    chunks.push(value.slice(i, i + maxChars));
  }
  return chunks;
}

function parseMeta(raw: string | null): ChunkMeta | null {
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ChunkMeta>;
    if (Number.isSafeInteger(parsed.count) && (parsed.count ?? 0) > 0) {
      return { count: parsed.count as number, length: parsed.length ?? 0 };
    }
  } catch {
    // Corrupt meta is treated as absent; the next setItem rewrites it.
  }
  return null;
}

const chunkKey = (base: string, index: number): string => `${base}.${index}`;
const metaKey = (base: string): string => `${base}${META_SUFFIX}`;

export function createSecureStoreAdapter(
  backend: SecureStoreBackend,
): StorageAdapter {
  return {
    async getItem(key: string): Promise<string | null> {
      const meta = parseMeta(await backend.getItemAsync(metaKey(key)));
      if (meta == null) return null;

      const parts: string[] = [];
      for (let i = 0; i < meta.count; i++) {
        const chunk = await backend.getItemAsync(chunkKey(key, i));
        if (chunk == null) return null; // torn read — behave like no session
        parts.push(chunk);
      }
      return parts.join('');
    },

    async setItem(key: string, value: string): Promise<void> {
      if (value.length === 0) {
        await this.removeItem(key);
        return;
      }

      const oldMeta = parseMeta(await backend.getItemAsync(metaKey(key)));

      const chunks = splitIntoChunks(value);
      for (let i = 0; i < chunks.length; i++) {
        await backend.setItemAsync(chunkKey(key, i), chunks[i]);
      }
      // Meta goes last so a torn write stays invisible to getItem.
      const meta: ChunkMeta = { count: chunks.length, length: value.length };
      await backend.setItemAsync(metaKey(key), JSON.stringify(meta));

      // Drop surplus chunks left by a previous, larger value.
      const oldCount = oldMeta?.count ?? 0;
      if (oldCount > chunks.length) {
        for (let i = chunks.length; i < oldCount; i++) {
          await backend.deleteItemAsync(chunkKey(key, i));
        }
      }
    },

    async removeItem(key: string): Promise<void> {
      const meta = parseMeta(await backend.getItemAsync(metaKey(key)));
      const count = meta?.count ?? 0;

      if (count > 0) {
        for (let i = 0; i < count; i++) {
          await backend.deleteItemAsync(chunkKey(key, i));
        }
        await backend.deleteItemAsync(metaKey(key));
        return;
      }

      // Missing/corrupt meta: sweep a bounded range of chunk keys to clean up
      // any torn write. deleteItemAsync is a no-op for absent keys on both
      // platforms, so this is safe even when nothing was ever stored.
      for (let i = 0; i < MAX_CHUNKS; i++) {
        await backend.deleteItemAsync(chunkKey(key, i));
      }
      await backend.deleteItemAsync(metaKey(key));
    },
  };
}

let sharedAdapter: StorageAdapter | null = null;

async function resolveAdapter(): Promise<StorageAdapter> {
  if (sharedAdapter == null) {
    const SecureStore = await import('expo-secure-store');
    sharedAdapter = createSecureStoreAdapter({
      getItemAsync: SecureStore.getItemAsync,
      setItemAsync: SecureStore.setItemAsync,
      deleteItemAsync: SecureStore.deleteItemAsync,
    });
  }
  return sharedAdapter;
}

/**
 * Default adapter wired to `expo-secure-store`. The native module is resolved
 * lazily on the first call so importing this module never touches native code.
 */
export const secureStoreAdapter: StorageAdapter = {
  getItem: (key) => resolveAdapter().then((adapter) => adapter.getItem(key)),
  setItem: (key, value) =>
    resolveAdapter().then((adapter) => adapter.setItem(key, value)),
  removeItem: (key) =>
    resolveAdapter().then((adapter) => adapter.removeItem(key)),
};
