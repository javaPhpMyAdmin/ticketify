/**
 * Chunked SecureStore-backed storage adapter for the Supabase client.
 *
 * supabase-js expects the AsyncStorage contract (`getItem` / `setItem` /
 * `removeItem`) and persists the full session JSON (user + access/refresh
 * tokens). That JSON can exceed SecureStore's 2048-byte per-value limit, so
 * values are split into chunks of at most `CHUNK_MAX_BYTES` UTF-8 bytes and
 * stored under derived keys:
 *
 *   <storageKey>.meta  -> { count, length } chunk metadata
 *   <storageKey>.0..n  -> the value chunks
 *
 * supabase-js storage keys look like `sb-<ref>-auth-token` (letters, digits,
 * hyphens), so every derived key stays inside the SecureStore key charset
 * `[A-Za-z0-9._-]` — no colons or other reserved characters.
 *
 * Chunk boundaries respect UTF-8 BYTE length, not UTF-16 code units: session
 * JSON embeds user metadata (display names, avatar URLs) that can carry CJK
 * or emoji characters (2-4 bytes per code unit), so a char-counted chunk can
 * silently exceed the 2048-byte value limit and be rejected by the native
 * module. Chunking walks code points, so a surrogate pair is never split
 * across two chunks and the JSON is never corrupted.
 *
 * Writes are failure-safe: the previous chunks are snapshotted before new
 * chunks overwrite their slots, and meta is committed last. If any write
 * fails, the old chunks are restored (or, as a last resort, wiped) so getItem
 * returns the previous valid session or null — never truncated garbage. This
 * matters because auto-refresh rewrites the session on a timer.
 *
 * `removeItem` deletes meta and sweeps a bounded range of chunk keys — not
 * just the ones meta references — so orphan chunks (from a crash between the
 * meta write and surplus cleanup) can never retain refresh tokens after
 * sign-out.
 *
 * The adapter is only usable where `expo-secure-store` exposes a native
 * backend (iOS/Android). On web the module is empty, so availability is
 * checked and callers get a descriptive error instead of a TypeError. There
 * is deliberately NO fallback to insecure storage (e.g. AsyncStorage).
 *
 * The native `expo-secure-store` module is loaded lazily so the pure chunking
 * logic stays testable in isolation (an in-memory backend can be injected via
 * `createSecureStoreAdapter`).
 */

/**
 * Safe byte budget per chunk. SecureStore rejects values over 2048 bytes, so
 * 1800 leaves headroom for platform overhead while keeping the JSON intact.
 */
export const CHUNK_MAX_BYTES = 1800;

/**
 * Hard cap on stored chunks. 16 chunks * 1800 bytes is roughly 28 KB of
 * session JSON — far beyond any realistic session payload. It also bounds the
 * meta count accepted by `parseMeta` and the `removeItem` sweep, so corrupt
 * meta can never drive an unbounded native-call loop.
 */
export const MAX_CHUNKS = 16;

const META_SUFFIX = '.meta';

const STORAGE_UNAVAILABLE_MESSAGE =
  'SecureStore is not available on this platform; auth sessions cannot be ' +
  'persisted (no insecure fallback is used).';

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

/**
 * UTF-8 byte length of a single code point. A `for...of` string iteration
 * yields code points, so a surrogate pair is handled as one unit and can never
 * be measured or split mid-character.
 */
function utf8ByteLengthOf(codePoint: string): number {
  const code = codePoint.codePointAt(0) ?? 0;
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  if (code < 0x10000) return 3;
  return 4;
}

/**
 * Split a value into chunks of at most `maxBytes` UTF-8 bytes each, iterating
 * code points so a multi-byte character (including surrogate pairs) is never
 * split across two chunks. Pure and node-testable.
 */
export function splitIntoChunks(
  value: string,
  maxBytes: number = CHUNK_MAX_BYTES,
): string[] {
  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;

  for (const codePoint of value) {
    const bytes = utf8ByteLengthOf(codePoint);
    if (currentBytes > 0 && currentBytes + bytes > maxBytes) {
      chunks.push(current);
      current = codePoint;
      currentBytes = bytes;
    } else {
      current += codePoint;
      currentBytes += bytes;
    }
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

function parseMeta(raw: string | null): ChunkMeta | null {
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ChunkMeta>;
    const { count, length } = parsed;
    const countValid =
      Number.isSafeInteger(count) && (count ?? 0) > 0 && (count ?? 0) <= MAX_CHUNKS;
    const lengthValid =
      length == null ||
      (Number.isSafeInteger(length) && (length as number) >= 0);
    if (countValid && lengthValid) {
      return { count: count as number, length: length ?? 0 };
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

      const joined = parts.join('');
      // meta.length validates the reconstruction: a mismatch means a torn or
      // corrupt write, so behave like no session rather than return garbage.
      if (meta.length > 0 && joined.length !== meta.length) return null;
      return joined;
    },

    async setItem(key: string, value: string): Promise<void> {
      if (value.length === 0) {
        await this.removeItem(key);
        return;
      }

      const oldMeta = parseMeta(await backend.getItemAsync(metaKey(key)));
      const oldCount = oldMeta?.count ?? 0;

      const chunks = splitIntoChunks(value);
      if (chunks.length > MAX_CHUNKS) {
        throw new Error(
          `Value exceeds storage capacity: ${chunks.length} chunks, ` +
            `cap is MAX_CHUNKS=${MAX_CHUNKS}`,
        );
      }

      // Snapshot the previous chunks before overwriting their slots. Meta is
      // only committed last, so old meta + restored chunks = old session.
      const oldParts: (string | null)[] = [];
      if (oldCount > 0) {
        for (let i = 0; i < oldCount; i++) {
          oldParts.push(await backend.getItemAsync(chunkKey(key, i)));
        }
      }

      try {
        for (let i = 0; i < chunks.length; i++) {
          await backend.setItemAsync(chunkKey(key, i), chunks[i]);
        }
        // Meta goes last so a torn write stays invisible to getItem.
        const meta: ChunkMeta = { count: chunks.length, length: value.length };
        await backend.setItemAsync(metaKey(key), JSON.stringify(meta));
      } catch (error) {
        // Roll back: restore the chunks we overwrote and delete any new ones,
        // leaving the still-unmodified old meta pointing at the old session.
        // If the rollback itself fails, wipe everything as a last resort so
        // getItem returns null — never truncated garbage.
        let restored = true;
        try {
          for (let i = 0; i < chunks.length; i++) {
            const old = i < oldCount ? oldParts[i] : null;
            if (old != null) {
              await backend.setItemAsync(chunkKey(key, i), old);
            } else {
              await backend.deleteItemAsync(chunkKey(key, i));
            }
          }
        } catch {
          restored = false;
        }
        if (!restored) {
          try {
            await this.removeItem(key);
          } catch {
            // Best effort; the original error still propagates.
          }
        }
        throw error; // fail loud — never silently fall back
      }

      // Drop surplus chunks left by a previous, larger value.
      if (oldCount > chunks.length) {
        for (let i = chunks.length; i < oldCount; i++) {
          await backend.deleteItemAsync(chunkKey(key, i));
        }
      }
    },

    async removeItem(key: string): Promise<void> {
      const meta = parseMeta(await backend.getItemAsync(metaKey(key)));
      const count = meta?.count ?? 0;

      // Delete meta first (getItem now reads no session), then sweep every
      // chunk key in a bounded range — including orphans beyond `count` left
      // by a crash between the meta write and surplus cleanup. deleteItemAsync
      // is a no-op for absent keys on both platforms, so sweeping is safe.
      await backend.deleteItemAsync(metaKey(key));
      for (let i = 0; i < Math.max(count, MAX_CHUNKS); i++) {
        await backend.deleteItemAsync(chunkKey(key, i));
      }
    },
  };
}

let sharedAdapter: StorageAdapter | null = null;
let availabilityResolved = false;

/**
 * Resolve the native backend once and cache it. Returns `null` when no native
 * SecureStore backend exists (web, or a module build without the native API),
 * so callers can detect unsupported storage instead of hitting a TypeError on
 * an undefined method.
 */
async function resolveAdapter(): Promise<StorageAdapter | null> {
  if (!availabilityResolved) {
    availabilityResolved = true;
    const SecureStore = await import('expo-secure-store');

    const onWeb =
      typeof window !== 'undefined' && typeof window.document !== 'undefined';
    const hasNativeApi =
      typeof SecureStore.getItemAsync === 'function' &&
      typeof SecureStore.setItemAsync === 'function' &&
      typeof SecureStore.deleteItemAsync === 'function';
    const available =
      !onWeb &&
      hasNativeApi &&
      (typeof SecureStore.isAvailableAsync !== 'function' ||
        (await SecureStore.isAvailableAsync()));

    if (available) {
      sharedAdapter = createSecureStoreAdapter({
        getItemAsync: SecureStore.getItemAsync,
        setItemAsync: SecureStore.setItemAsync,
        deleteItemAsync: SecureStore.deleteItemAsync,
      });
    }
  }
  return sharedAdapter;
}

/**
 * True when a native SecureStore backend is present (iOS/Android). Exported so
 * callers (e.g. the session-restore gate) can detect unsupported platforms
 * before touching auth storage.
 */
export async function isSecureStoreAvailable(): Promise<boolean> {
  return (await resolveAdapter()) != null;
}

/**
 * Default adapter wired to `expo-secure-store`. The native module is resolved
 * lazily on the first call so importing this module never touches native code.
 * On platforms without a native backend the methods reject with a descriptive
 * error (fail loud) instead of a TypeError — there is no insecure fallback.
 */
export const secureStoreAdapter: StorageAdapter = {
  getItem: async (key) => {
    const adapter = await resolveAdapter();
    if (adapter == null) throw new Error(STORAGE_UNAVAILABLE_MESSAGE);
    return adapter.getItem(key);
  },
  setItem: async (key, value) => {
    const adapter = await resolveAdapter();
    if (adapter == null) throw new Error(STORAGE_UNAVAILABLE_MESSAGE);
    return adapter.setItem(key, value);
  },
  removeItem: async (key) => {
    const adapter = await resolveAdapter();
    if (adapter == null) throw new Error(STORAGE_UNAVAILABLE_MESSAGE);
    return adapter.removeItem(key);
  },
};
