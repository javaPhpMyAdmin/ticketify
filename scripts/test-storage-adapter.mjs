/**
 * Node round-trip harness for the chunked SecureStore storage adapter.
 *
 * Exercises the REAL module (compiled with tsc into a temp dir) against an
 * in-memory backend — no device, no expo-secure-store required. Covers the
 * reliability re-gate findings: byte boundaries, CJK/emoji/astral characters
 * never split, exact multi-chunk round-trips, rollback on mid-write failure,
 * corrupt/capped meta, equal-length torn reads, and best-effort surplus
 * cleanup.
 *
 * Run: pnpm test:adapter
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const tscBin = join(root, 'node_modules', '.bin', 'tsc');

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

const utf8Length = (s) => new TextEncoder().encode(s).length;

/** In-memory SecureStoreBackend. Fault injection swaps a method when needed. */
function createMemoryBackend() {
  const store = new Map();
  return {
    store,
    backend: {
      getItemAsync: async (key) => (store.has(key) ? store.get(key) : null),
      setItemAsync: async (key, value) => {
        store.set(key, value);
      },
      deleteItemAsync: async (key) => {
        store.delete(key);
      },
    },
  };
}

const metaKey = (base) => `${base}.meta`;
const chunkKey = (base, i) => `${base}.${i}`;

const outDir = mkdtempSync(join(tmpdir(), 'storage-adapter-test-'));
try {
  // Compile the REAL adapter module. It has zero static imports, so the
  // compiled output is self-contained and runs in plain Node.
  execFileSync(
    tscBin,
    [
      'src/lib/supabase/storage-adapter.ts',
      '--outDir', outDir,
      '--module', 'commonjs',
      '--target', 'es2020',
      '--strict',
      '--esModuleInterop',
    ],
    { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] },
  );

  const require = createRequire(import.meta.url);
  const adapterModule = require(join(outDir, 'storage-adapter.js'));

  test('exactly 1800 bytes -> 1 chunk', () => {
    const chunks = adapterModule.splitIntoChunks('a'.repeat(1800));
    assert.equal(chunks.length, 1);
    assert.equal(utf8Length(chunks[0]), 1800);
  });

  test('1801 bytes -> 2 chunks', () => {
    const chunks = adapterModule.splitIntoChunks('a'.repeat(1801));
    assert.equal(chunks.length, 2);
    assert.ok(utf8Length(chunks[0]) <= adapterModule.CHUNK_MAX_BYTES);
  });

  test('CJK/emoji/astral never split; every chunk <= 1800 bytes; exact round-trip', () => {
    const payload = '😀漢字🎉𠮷'.repeat(500); // 4-byte emoji, 3-byte CJK, astral
    const chunks = adapterModule.splitIntoChunks(payload);
    assert.ok(chunks.length > 1);
    for (const chunk of chunks) {
      assert.ok(utf8Length(chunk) <= adapterModule.CHUNK_MAX_BYTES);
    }
    assert.equal(chunks.join(''), payload); // surrogate pairs intact
  });

  test('exact round-trip: multi-chunk > 2048-byte payload', async () => {
    const { backend, store } = createMemoryBackend();
    const adapter = adapterModule.createSecureStoreAdapter(backend);
    const payload = '🙂token-'.repeat(600); // ~6 KB, > SecureStore's 2048 B
    await adapter.setItem('sb-test-token', payload);
    const expectedChunks = adapterModule.splitIntoChunks(payload).length;
    assert.equal(store.size, 1 + expectedChunks); // meta + chunks
    assert.equal(await adapter.getItem('sb-test-token'), payload);
  });

  test('rollback on mid-write failure restores previous session', async () => {
    const { backend, store } = createMemoryBackend();
    const adapter = adapterModule.createSecureStoreAdapter(backend);
    const oldValue = 'old-session-' + 'x'.repeat(4000);
    await adapter.setItem('sb-test-token', oldValue);

    // Swap in a fault-injecting write: fail on the FIRST chunk write of the
    // rewrite (call 1, after the old chunks are snapshotted).
    let setCalls = 0;
    backend.setItemAsync = async (key, value) => {
      setCalls += 1;
      if (setCalls === 1) throw new Error('injected setItemAsync failure');
      store.set(key, value);
    };

    await assert.rejects(
      () => adapter.setItem('sb-test-token', 'new-session-' + 'y'.repeat(4000)),
      /injected setItemAsync failure/,
    );
    // Old meta never moved; old chunks restored -> previous session intact.
    assert.equal(await adapter.getItem('sb-test-token'), oldValue);
  });

  test('corrupt / capped meta -> getItem returns null', async () => {
    const { backend } = createMemoryBackend();
    const adapter = adapterModule.createSecureStoreAdapter(backend);
    for (const raw of [
      'not json',
      '{"count":0,"length":5,"hash":1}',
      '{"count":999,"length":5,"hash":1}',
      '{"count":2.5,"length":5,"hash":1}',
      '{"count":2,"length":5,"hash":"abc"}',
      '{"count":2,"length":-3,"hash":1}',
      '{"count":2,"length":5}',
    ]) {
      await backend.setItemAsync(metaKey('sb-test-token'), raw);
      assert.equal(await adapter.getItem('sb-test-token'), null, `meta ${raw}`);
    }
  });

  test('equal-length torn read -> null (length check alone misses it)', async () => {
    const { backend } = createMemoryBackend();
    const adapter = adapterModule.createSecureStoreAdapter(backend);
    // Old session, 3 chunks, then a crash mid-rewrite: the NEW chunks land but
    // the OLD meta stays. Old and new values share the same total length, so
    // only the content hash can detect the tear.
    await adapter.setItem('sb-test-token', 'A'.repeat(3700));
    const newChunks = adapterModule.splitIntoChunks('X'.repeat(3700));
    assert.equal(newChunks.length, 3);
    for (let i = 0; i < newChunks.length; i++) {
      await backend.setItemAsync(chunkKey('sb-test-token', i), newChunks[i]);
    }
    assert.equal(await adapter.getItem('sb-test-token'), null);
  });

  test('mixed-chunk tear (old meta, new + old chunks) -> null', async () => {
    const { backend } = createMemoryBackend();
    const adapter = adapterModule.createSecureStoreAdapter(backend);
    await adapter.setItem('sb-test-token', 'A'.repeat(3700));
    // Overwrite only chunk 0 with new content; chunks 1-2 stay from the old
    // value. Joined length still matches the old meta -> hash must reject it.
    await backend.setItemAsync(chunkKey('sb-test-token', 0), 'X'.repeat(1800));
    assert.equal(await adapter.getItem('sb-test-token'), null);
  });

  test('surplus-chunk cleanup failure does not throw after committed write', async () => {
    const { backend } = createMemoryBackend();
    const adapter = adapterModule.createSecureStoreAdapter(backend);
    await adapter.setItem('sb-test-token', 'a'.repeat(4000)); // 3 chunks
    // Every delete fails from now on; overwriting with a 1-chunk value must
    // still succeed (cleanup is best-effort, data is already committed).
    backend.deleteItemAsync = async () => {
      throw new Error('injected deleteItemAsync failure');
    };
    await adapter.setItem('sb-test-token', 'small');
    assert.equal(await adapter.getItem('sb-test-token'), 'small');
  });

  test('empty value behaves like removeItem', async () => {
    const { backend } = createMemoryBackend();
    const adapter = adapterModule.createSecureStoreAdapter(backend);
    await adapter.setItem('sb-test-token', 'something');
    await adapter.setItem('sb-test-token', '');
    assert.equal(await adapter.getItem('sb-test-token'), null);
  });

  test('setItem throws when the value exceeds MAX_CHUNKS and writes nothing', async () => {
    const { backend, store } = createMemoryBackend();
    const adapter = adapterModule.createSecureStoreAdapter(backend);
    const oversized =
      'x'.repeat(adapterModule.CHUNK_MAX_BYTES * adapterModule.MAX_CHUNKS + 1);
    await assert.rejects(
      () => adapter.setItem('sb-test-token', oversized),
      /exceeds storage capacity/,
    );
    // The cap check happens BEFORE any native write: no meta, no chunks.
    assert.equal(store.size, 0, 'nothing was written');
    assert.equal(await adapter.getItem('sb-test-token'), null);
  });

  test('concurrent setItem calls serialize per key: no overlapping chunk writes', async () => {
    const { backend, store } = createMemoryBackend();
    const adapter = adapterModule.createSecureStoreAdapter(backend);

    // Record max concurrent native writes. Each native write yields 5ms, so
    // WITHOUT the per-key queue the two setItem calls interleave at chunk
    // granularity (both launched in the same tick); WITH it, one write fully
    // completes before the next begins.
    let active = 0;
    let maxActive = 0;
    const originalSet = backend.setItemAsync.bind(backend);
    backend.setItemAsync = async (key, value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      try {
        return await originalSet(key, value);
      } finally {
        active -= 1;
      }
    };

    const a = 'A'.repeat(4000);
    const b = 'B'.repeat(4000);
    const [ra, rb] = await Promise.allSettled([
      adapter.setItem('sb-test-token', a),
      adapter.setItem('sb-test-token', b),
    ]);
    assert.equal(ra.status, 'fulfilled');
    assert.equal(rb.status, 'fulfilled');
    assert.equal(maxActive, 1, 'chunk writes never overlap');

    // One complete value survives (last writer wins); a torn mix would fail
    // the length/hash validation and read back as null.
    const value = await adapter.getItem('sb-test-token');
    assert.ok(value === a || value === b, 'one complete value, never a torn mix');
  });

  test('a failed setItem does not block later writes on the same key', async () => {
    const { backend, store } = createMemoryBackend();
    const adapter = adapterModule.createSecureStoreAdapter(backend);
    let fail = true;
    backend.setItemAsync = async (key, value) => {
      if (fail && key === chunkKey('sb-test-token', 0)) {
        throw new Error('injected setItemAsync failure');
      }
      store.set(key, value);
    };
    await assert.rejects(
      () => adapter.setItem('sb-test-token', 'x'.repeat(2000)),
      /injected setItemAsync failure/,
    );
    fail = false;
    await adapter.setItem('sb-test-token', 'ok-value');
    assert.equal(await adapter.getItem('sb-test-token'), 'ok-value');
  });

  test('removeItem sweeps orphan chunks beyond the meta count', async () => {
    const { backend, store } = createMemoryBackend();
    const adapter = adapterModule.createSecureStoreAdapter(backend);
    await adapter.setItem('sb-test-token', 'a'.repeat(4000)); // 3 chunks + meta
    // Simulate a crash between the meta write and surplus cleanup: an orphan
    // chunk beyond `count` still carrying the old refresh token. The sweep
    // must reach it even though no meta references it.
    await backend.setItemAsync(chunkKey('sb-test-token', 5), 'orphan-token');
    assert.equal(store.size, 5, 'meta + chunks 0-2 + orphan 5');
    await adapter.removeItem('sb-test-token');
    assert.equal(store.size, 0, 'meta and every chunk, orphan included, are gone');
    assert.equal(await adapter.getItem('sb-test-token'), null);
  });
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

let passed = 0;
let failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn(); // awaited so async tests never report false passes
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
