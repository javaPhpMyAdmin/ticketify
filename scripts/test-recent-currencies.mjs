#!/usr/bin/env node
/**
 * Node harness for the recent-currencies feature added by slice c1:
 *
 *   - `src/lib/recent-currencies.ts` — the PURE ordering / de-dupe / cap /
 *     catalog-filter rules.
 *   - `src/stores/recent-currencies-storage.ts` — the best-effort AsyncStorage
 *     mirror, exercised through its `__testing__` factory so a Node process
 *     never loads the native module.
 *
 * Mirrors `scripts/test-onboarding-storage.mjs`: compile the TS modules with
 * `tsc` into a temp dir, install a `Module._resolveFilename` hook to remap the
 * native AsyncStorage package to the in-memory stub, then assert behaviour.
 *
 * Contracts asserted:
 *
 *   Pure (`pushRecentCurrency`)
 *     1. caps at `MAX_RECENT_CURRENCIES` (5).
 *     2. de-dupes case-insensitively ('usd' collapses into 'USD').
 *     3. a new code lands at the front.
 *     4. never mutates the input array (returns a fresh array).
 *
 *   Pure (`sanitizeRecentCurrencies`)
 *     5. drops codes outside `supported`.
 *     6. de-dupes (case-insensitively) and upper-cases survivors.
 *     7. caps at 5.
 *
 *   Storage
 *     8. missing key → `[]`.
 *     9. round-trips a saved list.
 *    10. corrupt / non-array JSON → `[]` (never throws).
 *    11. a forced backend error on read → `[]`
 *        (`__TEST_FORCE_ASYNC_STORAGE_ERROR__`).
 *    12. a forced backend error on write → no throw.
 *    13. the versioned key is exported as `ticketify.recent-currencies.v1`.
 *
 * Plus structural pins against the real source files (compile-only / regex):
 *   - `src/lib/recent-currencies.ts` is dependency-free (no imports).
 *   - `use-settings-store.ts` delegates to the pure module and keeps no local
 *     cap constant.
 *
 * Usage: pnpm test:recent-currencies
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const tscBin = require.resolve('typescript/bin/tsc');
const harnessConfig = join(__dirname, 'tsconfig.recent-currencies-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'recent-currencies-test-'));
const outDir = join(workdir, 'out');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  const started = Date.now();
  try {
    await fn();
    passed += 1;
    console.log(`  ok    ${name} (${Date.now() - started}ms)`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL  ${name}`);
    console.error(String((err && err.stack) || err));
  }
}

function compile() {
  execFileSync(
    process.execPath,
    [tscBin, '-p', harnessConfig, '--outDir', outDir],
    { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] },
  );
}

/**
 * Remap `@/` to the compiled output and the native AsyncStorage module to the
 * in-memory stub. The storage module resolves AsyncStorage through a lazy
 * `require`, so without the remap the default-path tests would try to load the
 * native package and crash. Same pattern as `test-onboarding-storage.mjs`.
 */
function installRequireHook() {
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function rewrittenResolve(request, ...rest) {
    if (request.startsWith('@/')) {
      request = join(outDir, 'src', request.slice(2));
    } else if (request === '@react-native-async-storage/async-storage') {
      request = join(__dirname, 'test-stubs', 'async-storage.ts');
    }
    return originalResolve.call(this, request, ...rest);
  };
}

function load(mod) {
  return import(pathToFileURL(join(outDir, mod)).href);
}

async function run() {
  console.log('\n[tests] compiling recent-currencies modules…');
  compile();
  console.log('[tests] loading compiled modules…');
  installRequireHook();

  const pure = await load('src/lib/recent-currencies.js');
  const storage = await load('src/stores/recent-currencies-storage.js');
  const { createRecentCurrenciesStorage } = storage.__testing__;
  const { RECENT_CURRENCIES_KEY } = storage;
  const { MAX_RECENT_CURRENCIES, pushRecentCurrency, sanitizeRecentCurrencies } =
    pure;

  const buildBackend = () => {
    const map = new Map();
    return {
      getItem: (k) => Promise.resolve(map.has(k) ? map.get(k) : null),
      setItem: (k, v) => {
        map.set(k, v);
        return Promise.resolve();
      },
      _map: map,
    };
  };

  // ── pure: pushRecentCurrency ─────────────────────────────────────────────
  console.log('\n[tests] pushRecentCurrency (pure)\n');

  await test('MAX_RECENT_CURRENCIES is 5', () => {
    assert.equal(MAX_RECENT_CURRENCIES, 5);
  });

  await test('caps at MAX_RECENT_CURRENCIES — the oldest code falls off', () => {
    const list = ['USD', 'EUR', 'BRL', 'UYU', 'MXN'];
    const next = pushRecentCurrency(list, 'JPY');
    assert.equal(next.length, MAX_RECENT_CURRENCIES);
    assert.deepEqual(next, ['JPY', 'USD', 'EUR', 'BRL', 'UYU']);
    assert.ok(!next.includes('MXN'), 'the 5th-oldest code must be evicted');
  });

  await test("de-dupes case-insensitively — pushing 'usd' collapses existing 'USD'", () => {
    const next = pushRecentCurrency(['USD', 'EUR', 'BRL'], 'usd');
    assert.deepEqual(next, ['USD', 'EUR', 'BRL']);
    assert.equal(
      next.filter((code) => code.toUpperCase() === 'USD').length,
      1,
      'USD must appear exactly once',
    );
  });

  await test('a new code lands at the FRONT without disturbing the rest', () => {
    assert.deepEqual(pushRecentCurrency(['EUR', 'BRL'], 'USD'), [
      'USD',
      'EUR',
      'BRL',
    ]);
  });

  await test('the pushed code is upper-cased', () => {
    assert.deepEqual(pushRecentCurrency([], 'usd'), ['USD']);
  });

  await test('never mutates the input array (returns a fresh array)', () => {
    const list = ['USD', 'EUR', 'BRL'];
    const snapshot = [...list];
    const next = pushRecentCurrency(list, 'MXN');
    assert.deepEqual(list, snapshot, 'input array was mutated');
    assert.notEqual(next, list, 'must return a NEW array reference');
  });

  // ── pure: sanitizeRecentCurrencies ───────────────────────────────────────
  console.log('\n[tests] sanitizeRecentCurrencies (pure)\n');

  await test('drops codes the catalog no longer ships', () => {
    assert.deepEqual(
      sanitizeRecentCurrencies(['USD', 'XXX', 'EUR'], ['USD', 'EUR']),
      ['USD', 'EUR'],
    );
  });

  await test('de-dupes (case-insensitively) and upper-cases survivors', () => {
    assert.deepEqual(
      sanitizeRecentCurrencies(['usd', 'USD', 'eur'], ['USD', 'EUR']),
      ['USD', 'EUR'],
    );
  });

  await test('caps at MAX_RECENT_CURRENCIES', () => {
    const supported = ['USD', 'EUR', 'BRL', 'UYU', 'MXN', 'JPY', 'CLP'];
    const next = sanitizeRecentCurrencies(supported, supported);
    assert.equal(next.length, MAX_RECENT_CURRENCIES);
    assert.deepEqual(next, ['USD', 'EUR', 'BRL', 'UYU', 'MXN']);
  });

  await test('preserves order (most-recent-first) while filtering', () => {
    assert.deepEqual(
      sanitizeRecentCurrencies(['MXN', 'XXX', 'BRL'], ['BRL', 'MXN']),
      ['MXN', 'BRL'],
    );
  });

  await test('never mutates the input array', () => {
    const list = ['USD', 'EUR'];
    const snapshot = [...list];
    sanitizeRecentCurrencies(list, ['USD', 'EUR']);
    assert.deepEqual(list, snapshot, 'input array was mutated');
  });

  // ── storage: injected factory ────────────────────────────────────────────
  console.log('\n[tests] recent-currencies storage (injected backend)\n');

  await test('missing key → returns []', async () => {
    const helper = createRecentCurrenciesStorage(buildBackend());
    assert.deepEqual(await helper.loadRecentCurrencies(), []);
  });

  await test('round-trips a saved list', async () => {
    const helper = createRecentCurrenciesStorage(buildBackend());
    await helper.saveRecentCurrencies(['USD', 'EUR', 'BRL']);
    assert.deepEqual(await helper.loadRecentCurrencies(), ['USD', 'EUR', 'BRL']);
  });

  await test('writes valid JSON under RECENT_CURRENCIES_KEY', async () => {
    const backend = buildBackend();
    const helper = createRecentCurrenciesStorage(backend);
    await helper.saveRecentCurrencies(['USD']);
    assert.equal(backend._map.get(RECENT_CURRENCIES_KEY), '["USD"]');
  });

  await test('corrupt JSON → returns [] (never throws)', async () => {
    const backend = buildBackend();
    backend._map.set(RECENT_CURRENCIES_KEY, '{not json');
    const helper = createRecentCurrenciesStorage(backend);
    assert.deepEqual(await helper.loadRecentCurrencies(), []);
  });

  await test('non-array JSON → returns [] (defensive)', async () => {
    const backend = buildBackend();
    backend._map.set(RECENT_CURRENCIES_KEY, '{"USD":true}');
    const helper = createRecentCurrenciesStorage(backend);
    assert.deepEqual(await helper.loadRecentCurrencies(), []);
  });

  await test('non-string members of a stored array are dropped', async () => {
    const backend = buildBackend();
    backend._map.set(RECENT_CURRENCIES_KEY, '["USD",42,null,"EUR"]');
    const helper = createRecentCurrenciesStorage(backend);
    assert.deepEqual(await helper.loadRecentCurrencies(), ['USD', 'EUR']);
  });

  await test('a backend rejection on read → returns [] (never throws)', async () => {
    const helper = createRecentCurrenciesStorage({
      getItem: () => Promise.reject(new Error('forced: backend down')),
      setItem: () => Promise.resolve(),
    });
    assert.deepEqual(await helper.loadRecentCurrencies(), []);
  });

  await test('a backend rejection on write → no throw (best-effort mirror)', async () => {
    let setCalled = false;
    const helper = createRecentCurrenciesStorage({
      getItem: () => Promise.resolve(null),
      setItem: () => {
        setCalled = true;
        return Promise.reject(new Error('forced: backend down'));
      },
    });
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args);
    try {
      await helper.saveRecentCurrencies(['USD']);
    } finally {
      console.warn = originalWarn;
    }
    assert.equal(setCalled, true, 'the write must be attempted, then swallowed');
    assert.equal(warnings.length, 1, 'the swallowed failure must be logged once');
  });

  // ── storage: production default path + forced-error env flag ─────────────
  console.log('\n[tests] recent-currencies storage (default backend + env flag)\n');

  await test('the production default path round-trips through AsyncStorage', async () => {
    await storage.saveRecentCurrencies(['BRL', 'EUR']);
    assert.deepEqual(await storage.loadRecentCurrencies(), ['BRL', 'EUR']);
  });

  await test('__TEST_FORCE_ASYNC_STORAGE_ERROR__ → read collapses to []', async () => {
    process.env.__TEST_FORCE_ASYNC_STORAGE_ERROR__ = '1';
    try {
      assert.deepEqual(await storage.loadRecentCurrencies(), []);
    } finally {
      delete process.env.__TEST_FORCE_ASYNC_STORAGE_ERROR__;
    }
  });

  await test('__TEST_FORCE_ASYNC_STORAGE_ERROR__ → write does not throw', async () => {
    process.env.__TEST_FORCE_ASYNC_STORAGE_ERROR__ = '1';
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args);
    try {
      await storage.saveRecentCurrencies(['USD']);
    } finally {
      console.warn = originalWarn;
      delete process.env.__TEST_FORCE_ASYNC_STORAGE_ERROR__;
    }
    assert.equal(warnings.length, 1, 'the swallowed failure must be logged once');
  });

  // ── structural pins ──────────────────────────────────────────────────────
  console.log('\n[tests] structural pins\n');

  await test('RECENT_CURRENCIES_KEY is exported and equals ticketify.recent-currencies.v1', () => {
    assert.equal(
      typeof RECENT_CURRENCIES_KEY,
      'string',
      'the key must be exported as a string constant',
    );
    assert.equal(RECENT_CURRENCIES_KEY, 'ticketify.recent-currencies.v1');
  });

  await test('storage exposes __testing__.createRecentCurrenciesStorage (factory seam)', () => {
    const source = readFileSync(
      join(root, 'src/stores/recent-currencies-storage.ts'),
      'utf8',
    );
    assert.match(source, /export\s+const\s+__testing__\s*=/);
    assert.match(source, /createRecentCurrenciesStorage/);
  });

  await test('the pure module is dependency-free (no imports)', () => {
    const source = readFileSync(join(root, 'src/lib/recent-currencies.ts'), 'utf8');
    assert.doesNotMatch(
      source,
      /^\s*import\s/m,
      'src/lib/recent-currencies.ts must import nothing (pure, loadable anywhere)',
    );
  });

  await test('use-settings-store.ts delegates to the pure module', () => {
    const source = readFileSync(
      join(root, 'src/stores/use-settings-store.ts'),
      'utf8',
    );
    assert.match(
      source,
      /from\s*'@\/lib\/recent-currencies'/,
      'the store must import the pure rules',
    );
    assert.match(source, /pushRecentCurrencyPure\(/);
    assert.match(source, /sanitizeRecentCurrencies\(/);
    assert.doesNotMatch(
      source,
      /RECENT_CURRENCIES_CAP/,
      'the local cap constant must be gone — the pure module owns it now',
    );
  });

  console.log('');
  if (failed > 0) {
    console.error(`[tests] ${failed} failed, ${passed} passed`);
    process.exitCode = 1;
  } else {
    console.log(`[tests] all ${passed} tests passed`);
  }
  rmSync(workdir, { recursive: true, force: true });
}

try {
  await run();
} catch (err) {
  console.error('[tests] harness crashed:', err);
  process.exitCode = 1;
  rmSync(workdir, { recursive: true, force: true });
}
