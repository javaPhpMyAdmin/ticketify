#!/usr/bin/env node
/**
 * Node harness for the categories feature module
 * (`src/features/categories/`, change `category-management` PR 2).
 *
 * Three sections:
 *
 *   A — PURE catalog helpers (`catalog.ts`): slugify, slugCollides,
 *       mergeCategoryCatalog, resolveCategory. No supabase, plain functions.
 *
 *   B — The data-access seam (`api.ts`) through the REAL compiled test
 *       double for `@/lib/supabase` (scripts/test-stubs/supabase.ts) and the
 *       REAL compiled `@/lib/supabase/feature-access` (honest seam —
 *       READ_ERROR_MESSAGE() falls back to the canonical es-AR copy because
 *       i18next is not initialized in plain node). Covers every discriminated
 *       branch: ok / error / unconfigured reads, ok / 23505 / generic-write
 *       failures, fail-closed 0-row delete, and the reassign bulk UPDATE.
 *
 *   C — `queryKeys.categories` + the REAL `useCategoryCatalog` hook mounted
 *       in jsdom inside a real QueryClientProvider (pattern:
 *       test-run-rate-hook.mjs). Proves the split/merge, the no-user gate
 *       (zero reads), the post-mutation invalidation refetch, and the
 *       23505 → user-safe createError copy.
 *
 * RED→GREEN (strict TDD): run `pnpm test:categories` BEFORE the source
 * files exist — tsc fails to find `src/features/categories/*` and the
 * harness exits non-zero (the RED). After the GREEN, chained into
 * `pnpm test` (package.json).
 *
 * Usage: pnpm test:categories
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require_ = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const tscBin = require_.resolve('typescript/bin/tsc');
const harnessConfig = join(__dirname, 'tsconfig.categories-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'categories-test-'));
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

// ---------------------------------------------------------------------------
// Require-hook: redirect problematic modules to stubs. The REAL compiled
// `@/lib/supabase/feature-access` and `@/lib/supabase/query-adapters` are
// used (honest seam: READ_ERROR_MESSAGE() falls back to the canonical es-AR
// copy in plain node — i18next loads but is never initialized).
// @tanstack/react-query is NOT redirected — the real package is used.
// ---------------------------------------------------------------------------
function installRequireHook() {
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function rewrittenResolve(request, ...rest) {
    if (request === '@/features/auth') {
      request = join(outDir, 'scripts', 'test-stubs', 'auth.js');
    } else if (request === '@/lib/supabase') {
      request = join(outDir, 'scripts', 'test-stubs', 'supabase.js');
    } else if (request === 'react-native') {
      request = join(outDir, 'scripts', 'test-stubs', 'react-native.js');
    } else if (request.startsWith('@/')) {
      request = join(outDir, 'src', request.slice(2));
    }
    return originalResolve.call(this, request, ...rest);
  };
}

// ---------------------------------------------------------------------------
// Compile
// ---------------------------------------------------------------------------
function compile() {
  execFileSync(
    process.execPath,
    [tscBin, '-p', harnessConfig, '--outDir', outDir],
    { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] },
  );
}

function load(mod) {
  return import(pathToFileURL(join(outDir, mod)).href);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The canonical 13 slugs (EXPENSE_CATEGORIES) — hardcoded here so the pure
 *  tests never drag in `@/features/home/categories` (which pulls components).
 */
const CANONICAL_SLUGS = [
  'bebidas',
  'refrescos',
  'lacteos',
  'panaderia',
  'snacks',
  'alimentos',
  'higiene',
  'limpieza',
  'carnes',
  'frutas-verduras',
  'farmacia',
  'servicios',
  'otros',
];

/** One `categories` row (migration 0032 shape: user_id null = global). */
function catRow(overrides) {
  return {
    id: `cat-${overrides.slug}`,
    slug: overrides.slug,
    name: overrides.name ?? overrides.slug,
    kind: 'need',
    icon: 'dot',
    color: '#CCCCCC',
    sort_order: 1,
    user_id: null,
    ...overrides,
  };
}

// Global (canonical) rows — sort_order < 100.
const bebidas = catRow({ slug: 'bebidas', name: 'Bebidas', sort_order: 5 });
const farmacia = catRow({ slug: 'farmacia', name: 'Farmacia', sort_order: 80 });
const otros = catRow({ slug: 'otros', name: 'Sin categoría', sort_order: 99 });

// Own rows (user-scoped custom) — sort_order >= 100.
const delivery = catRow({
  slug: 'delivery',
  name: 'Delivery',
  kind: 'want',
  icon: 'package',
  color: '#7C3AED',
  sort_order: 100,
  user_id: 'test-user-id',
});
const gimnasio = catRow({
  slug: 'gimnasio',
  name: 'Gimnasio',
  kind: 'want',
  icon: 'dumbbell',
  color: '#F59E0B',
  sort_order: 101,
  user_id: 'test-user-id',
});
// A custom row SHADOWING a canonical slug (user-first by construction).
const farmaciaOwn = catRow({
  slug: 'farmacia',
  name: 'Mi Farmacia',
  sort_order: 100,
  user_id: 'test-user-id',
});

/** The canonical es-AR read-error copy (i18next uninitialized in node). */
const READ_ERROR_FALLBACK = 'No se pudieron cargar los datos. Inténtalo de nuevo.';

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
async function run() {
  console.log('\n[tests] compiling categories modules…');
  await compile();
  globalThis.__DEV__ = false;
  installRequireHook();
  console.log('[tests] loading compiled modules…');

  const catMod = await load('src/features/categories/catalog.js');
  const {
    slugify,
    slugCollides,
    mergeCategoryCatalog,
    resolveCategory,
  } = catMod;

  const apiMod = await load('src/features/categories/api.js');
  const {
    readCategoryCatalog,
    createCustomCategory,
    deleteCustomCategory,
    reassignCategoryItems,
    CATEGORY_ALREADY_EXISTS_MESSAGE,
    CREATE_CATEGORY_ERROR_MESSAGE,
    DELETE_CATEGORY_ERROR_MESSAGE,
    REASSIGN_CATEGORY_ERROR_MESSAGE,
  } = apiMod;

  const stub = await load('scripts/test-stubs/supabase.js');
  const keysMod = await load('src/lib/query-keys.js');
  const hookMod = await load('src/features/categories/hooks/useCategoryCatalog.js');
  const { useCategoryCatalog } = hookMod;
  const authStub = await load('scripts/test-stubs/auth.js');

  // Real React + react-query + react-dom for mounting the real hook
  const React = require_('react');
  const { act } = React;
  const { createRoot } = require_('react-dom/client');
  const { QueryClient, QueryClientProvider } = require_('@tanstack/react-query');

  // React 19 requires this flag for act() to work outside Jest/Vitest
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  // jsdom for a minimal DOM (react-dom/client needs a container element)
  const { JSDOM } = require_('jsdom');
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
    writable: true,
  });

  // -----------------------------------------------------------------------
  // Hook-mount helpers (pattern: test-run-rate-hook.mjs)
  // -----------------------------------------------------------------------
  function makeQueryClient() {
    return new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });
  }

  /**
   * Mount a hook inside a real React tree with QueryClientProvider.
   * Returns { ref, unmount, waitFor } — ref.current is always the latest hook
   * return. `waitFor(predicate)` polls until `predicate(ref.current)` is
   * truthy (bounded), flushing async query/mutation/refetch work each round.
   */
  function mountHook(hookFn, queryClient) {
    let hookResult = undefined;
    let hookError = null;

    function TestComp() {
      try {
        hookResult = hookFn();
      } catch (e) {
        hookError = e;
      }
      return null;
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(TestComp),
        ),
      );
    });

    const waitFor = async (predicate, { timeout = 2000 } = {}) => {
      const deadline = Date.now() + timeout;
      for (;;) {
        for (let i = 0; i < 3; i += 1) {
          await act(async () => {
            await new Promise((r) => setTimeout(r, 0));
          });
        }
        if (predicate(hookResult)) return hookResult;
        if (Date.now() > deadline) {
          throw new Error(
            `waitFor timed out after ${timeout}ms; last result: ` +
              JSON.stringify(hookResult),
          );
        }
      }
    };

    return {
      ref: {
        get current() { return hookResult; },
        get error() { return hookError; },
      },
      unmount: () => {
        act(() => root.unmount());
        if (container.parentNode) container.parentNode.removeChild(container);
      },
      queryClient,
      waitFor,
    };
  }

  /**
   * Count of pure READ chains on `categories` since the last stub reset.
   * Write chains (insert/delete/update) ALSO begin with `from('categories')`
   * in the supabase double, so their entries are subtracted — a read is a
   * `from` with no accompanying write-kind entry.
   */
  const categoryReads = () => {
    const log = stub.__getCallLog();
    const froms = log.filter((e) => e.kind === 'from' && e.table === 'categories');
    const writeFroms = log.filter(
      (e) =>
        e.table === 'categories' &&
        (e.kind === 'insert' || e.kind === 'update' || e.kind === 'delete' || e.kind === 'upsert'),
    ).length;
    return froms.length - writeFroms;
  };

  // =========================================================================
  // SECTION A — pure catalog helpers (catalog.ts)
  // =========================================================================
  console.log('\n[tests] A. pure catalog helpers\n');

  await test('slugify: accents, case, collapse (D4 examples)', async () => {
    assert.equal(slugify('Café & Deli'), 'cafe-deli');
    assert.equal(slugify('Frutas y Verduras'), 'frutas-y-verduras');
    assert.equal(slugify('Lácteos'), 'lacteos');
    assert.equal(slugify('Farmacia'), 'farmacia');
    assert.equal(slugify('NAÑEZ'), 'nanez', 'uppercase + ñ decompose and lowercase');
  });

  await test('slugify: symbols, emoji, whitespace, empty', async () => {
    assert.equal(slugify('Café ☕ Deli'), 'cafe-deli', 'emoji collapses to a dash');
    assert.equal(slugify('  Frutas   y  Verduras  '), 'frutas-y-verduras');
    assert.equal(slugify('Frutas_y-Verduras'), 'frutas-y-verduras', 'runs collapse to a single dash');
    assert.equal(slugify('Frutas_-_Verduras'), 'frutas-verduras', 'symbol-only runs collapse fully');
    assert.equal(slugify('Frutas _y_ Verduras'), 'frutas-y-verduras', 'mixed symbol/space runs still keep word separation');
    assert.equal(slugify(''), '');
    assert.equal(slugify('💸'), '', 'emoji-only input slugs to empty');
    assert.equal(slugify('   '), '');
  });

  await test('slugCollides: canonical set membership', async () => {
    const canonical = new Set(CANONICAL_SLUGS);
    assert.equal(slugCollides('farmacia', canonical), true, 'canonical slug collides');
    assert.equal(slugCollides('otros', canonical), true);
    assert.equal(slugCollides('delivery', canonical), false, 'free slug passes');
    assert.equal(slugCollides('', canonical), false);
  });

  await test('slugCollides: own custom slugs + array input', async () => {
    const own = new Set(['delivery', 'gimnasio']);
    assert.equal(slugCollides('gimnasio', own), true);
    assert.equal(slugCollides('bebidas', own), false);
    // Tolerates a plain string[] (defensive input normalization).
    assert.equal(slugCollides('delivery', ['delivery', 'gimnasio']), true);
    assert.equal(slugCollides('farmacia', ['delivery', 'gimnasio']), false);
  });

  await test('mergeCategoryCatalog: canonical-first, deterministic, strips user_id', async () => {
    const merged = mergeCategoryCatalog([bebidas, farmacia, otros], [delivery, gimnasio]);
    assert.deepEqual(Object.keys(merged), [
      'bebidas',
      'farmacia',
      'otros',
      'delivery',
      'gimnasio',
    ], 'global rows first by sort_order, then custom rows');
    assert.deepEqual(merged.delivery, {
      id: 'cat-delivery',
      slug: 'delivery',
      name: 'Delivery',
      kind: 'want',
      icon: 'package',
      color: '#7C3AED',
      sort_order: 100,
    }, 'merged entry carries the DB row fields WITHOUT user_id');
  });

  await test('mergeCategoryCatalog: input order does not matter (determinism)', async () => {
    const shuffled = mergeCategoryCatalog([otros, farmacia, bebidas], [gimnasio, delivery]);
    const sorted = mergeCategoryCatalog([bebidas, farmacia, otros], [delivery, gimnasio]);
    assert.deepEqual(shuffled, sorted, 'any input order yields the identical record');
    assert.deepEqual(Object.keys(shuffled), ['bebidas', 'farmacia', 'otros', 'delivery', 'gimnasio']);
  });

  await test('mergeCategoryCatalog: own row shadows a canonical slug (user-first)', async () => {
    const merged = mergeCategoryCatalog([bebidas, farmacia, otros], [farmaciaOwn, delivery]);
    assert.equal(merged.farmacia.id, farmaciaOwn.id, 'the user row wins the slug');
    assert.equal(merged.farmacia.name, 'Mi Farmacia');
    assert.equal(merged.farmacia.user_id, undefined, 'no user_id leaks into the catalog');
    // Shadowed canonical row stays reachable under its own (overridden) slug only.
    assert.equal(merged.farmacia.sort_order, 100, 'custom sort_order carried');
  });

  await test('resolveCategory: known row, unknown → otros, null → otros', async () => {
    const merged = mergeCategoryCatalog([bebidas, farmacia, otros], [delivery, gimnasio]);
    assert.equal(resolveCategory(merged, 'bebidas'), merged.bebidas);
    assert.equal(resolveCategory(merged, 'delivery'), merged.delivery);
    assert.equal(resolveCategory(merged, 'no-such-slug'), merged.otros, 'unknown slug falls back to otros');
    assert.equal(resolveCategory(merged, null), merged.otros, 'null slug falls back to otros');
    assert.equal(resolveCategory(merged, undefined), merged.otros, 'undefined slug falls back to otros');
  });

  await test('resolveCategory: empty catalog → undefined (fallback chain, D3)', async () => {
    assert.equal(resolveCategory({}, 'bebidas'), undefined, 'unknown slug, no otros row');
    assert.equal(resolveCategory({}, 'otros'), undefined, 'even otros is absent pre-load');
    assert.equal(resolveCategory({}, null), undefined);
  });

  await test('mergeCategoryCatalog: __proto__ slug cannot corrupt lookup (null prototype)', async () => {
    const protoRow = catRow({ slug: '__proto__', name: 'Delivery', kind: 'want', sort_order: 100, user_id: 'test-user-id' });
    const merged = mergeCategoryCatalog([bebidas], [protoRow]);
    assert.equal(Object.getPrototypeOf(merged), null, 'catalog has a null prototype');
    assert.equal(merged['name'], undefined, 'no inherited lookup through Object.prototype');
    assert.equal(merged['toString'], undefined);
    assert.equal(typeof merged['__proto__'], 'object', '__proto__ is an own data property, not the prototype');
    assert.equal(merged['__proto__'].name, 'Delivery');
  });

  // =========================================================================
  // SECTION B — api.ts through the real compiled supabase double
  // =========================================================================
  console.log('\n[tests] B. data-access seam (api.ts)\n');

  await test('readCategoryCatalog: ok + exact server-side query', async () => {
    stub.__resetSupabaseBehavior();
    stub.__setTableRead('categories', { rows: [bebidas, otros, delivery] });
    const result = await readCategoryCatalog('test-user-id');
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.data, [bebidas, otros, delivery]);
    assert.deepEqual(stub.__getQueryCalls('categories'), [
      { op: 'or', filter: 'user_id.is.null,user_id.eq.test-user-id' },
      { op: 'order', column: 'sort_order,slug', opts: undefined },
      { op: 'limit', count: 500 },
    ], 'global ∨ own in ONE query, deterministic order, bounded');
  });

  await test('readCategoryCatalog: error → user-safe read copy', async () => {
    stub.__resetSupabaseBehavior();
    stub.__setTableRead('categories', {
      rows: null,
      error: { message: 'relation "categories" does not exist', code: '42P01' },
    });
    const result = await readCategoryCatalog('test-user-id');
    assert.deepEqual(result, { status: 'error', message: READ_ERROR_FALLBACK });
  });

  await test('readCategoryCatalog: unconfigured → gate before any backend call', async () => {
    stub.__resetSupabaseBehavior();
    stub.__setSupabaseConfigInputs('https://YOUR-PROJECT.supabase.co', 'YOUR-ANON-KEY');
    try {
      const result = await readCategoryCatalog('test-user-id');
      assert.deepEqual(result, { status: 'unconfigured' });
      assert.equal(categoryReads(), 0, 'no from() call may fire unconfigured');
    } finally {
      stub.__setSupabaseConfigInputs('https://real-project.supabase.co', 'real-anon-key');
    }
  });

  await test('createCustomCategory: ok — exact insert payload + returned row', async () => {
    stub.__resetSupabaseBehavior();
    const result = await createCustomCategory('test-user-id', {
      name: 'Delivery',
      kind: 'want',
      icon: 'package',
      color: '#7C3AED',
    });
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.data, {
      id: 'stub-insert-0-0',
      user_id: 'test-user-id',
      slug: 'delivery',
      name: 'Delivery',
      kind: 'want',
      icon: 'package',
      color: '#7C3AED',
      sort_order: 100,
    });
    assert.deepEqual(stub.__getInserted('categories'), [{
      id: 'stub-insert-0-0',
      user_id: 'test-user-id',
      slug: 'delivery',
      name: 'Delivery',
      kind: 'want',
      icon: 'package',
      color: '#7C3AED',
      sort_order: 100,
    }], 'slug derived from the name; sort_order >= 100 (canonical rows are < 100)');
  });

  await test('createCustomCategory: server-issued values win over crafted payload (user_id, slug)', async () => {
    stub.__resetSupabaseBehavior();
    const result = await createCustomCategory('test-user-id', {
      name: 'Custom Name',
      kind: 'want',
      icon: 'package',
      color: '#7C3AED',
      user_id: 'other-user-id',
      slug: 'hacked',
    });
    assert.equal(result.status, 'ok');
    assert.deepEqual(stub.__getInserted('categories'), [{
      id: 'stub-insert-0-0',
      user_id: 'test-user-id',
      slug: 'custom-name',
      name: 'Custom Name',
      kind: 'want',
      icon: 'package',
      color: '#7C3AED',
      sort_order: 100,
    }], 'server userId + slugified slug win; crafted user_id/slug overrides ignored');
  });

  await test('createCustomCategory: emoji-only name → friendly copy, no insert', async () => {
    stub.__resetSupabaseBehavior();
    const result = await createCustomCategory('test-user-id', {
      name: '💸',
      kind: 'want',
      icon: 'package',
      color: '#7C3AED',
    });
    assert.deepEqual(result, { status: 'error', message: CREATE_CATEGORY_ERROR_MESSAGE });
    assert.equal(
      stub.__getCallLog().filter((e) => e.kind === 'insert').length,
      0,
      'no insert may fire for an empty slug',
    );
  });

  await test('createCustomCategory: whitespace-only name → friendly copy, no insert', async () => {
    stub.__resetSupabaseBehavior();
    const result = await createCustomCategory('test-user-id', {
      name: '   ',
      kind: 'need',
      icon: 'dot',
      color: '#000',
    });
    assert.deepEqual(result, { status: 'error', message: CREATE_CATEGORY_ERROR_MESSAGE });
    assert.equal(
      stub.__getCallLog().filter((e) => e.kind === 'insert').length,
      0,
      'no insert may fire for a whitespace-only name',
    );
  });

  await test('createCustomCategory: 23505 → friendly duplicate copy', async () => {
    stub.__resetSupabaseBehavior();
    stub.__failNextInsert('categories', {
      message: 'duplicate key value violates unique constraint "categories_user_slug_idx"',
      code: '23505',
    });
    const result = await createCustomCategory('test-user-id', {
      name: 'Delivery',
      kind: 'want',
      icon: 'package',
      color: '#7C3AED',
    });
    assert.deepEqual(result, {
      status: 'error',
      message: CATEGORY_ALREADY_EXISTS_MESSAGE,
    });
    assert.equal(CATEGORY_ALREADY_EXISTS_MESSAGE, 'Esa categoría ya existe.');
  });

  await test('createCustomCategory: generic write failure → create copy', async () => {
    stub.__resetSupabaseBehavior();
    stub.__failNextInsert('categories', { message: 'network down', code: '600' });
    const result = await createCustomCategory('test-user-id', {
      name: 'Delivery',
      kind: 'want',
      icon: 'package',
      color: '#7C3AED',
    });
    assert.deepEqual(result, { status: 'error', message: CREATE_CATEGORY_ERROR_MESSAGE });
  });

  await test('deleteCustomCategory: ok — scoped to own rows, returns deleted', async () => {
    stub.__resetSupabaseBehavior();
    stub.__setDeleteRead('categories', [{ id: 'cat-delivery' }]);
    const result = await deleteCustomCategory('test-user-id', 'cat-delivery');
    assert.deepEqual(result, { status: 'ok', data: null });
    assert.deepEqual(stub.__getQueryCalls('categories'), [
      { op: 'eq', column: 'id', value: 'cat-delivery' },
      { op: 'eq', column: 'user_id', value: 'test-user-id' },
    ], 'delete guarded by id AND user_id (RLS-parity at the query level)');
  });

  await test('deleteCustomCategory: 0 rows → fail-closed (nothing deleted is an error)', async () => {
    stub.__resetSupabaseBehavior();
    // UNARMED delete-with-select resolves [] — the 0-row fail-closed case.
    const result = await deleteCustomCategory('test-user-id', 'cat-delivery');
    assert.deepEqual(result, { status: 'error', message: DELETE_CATEGORY_ERROR_MESSAGE });
  });

  await test('deleteCustomCategory: backend failure → delete copy', async () => {
    stub.__resetSupabaseBehavior();
    stub.__failNextDelete('categories');
    const result = await deleteCustomCategory('test-user-id', 'cat-delivery');
    assert.deepEqual(result, { status: 'error', message: DELETE_CATEGORY_ERROR_MESSAGE });
  });

  await test('reassignCategoryItems: moved count = affected rows (bulk UPDATE)', async () => {
    stub.__resetSupabaseBehavior();
    stub.__setDeleteRead('purchase_items', [{ id: 'pi-1' }, { id: 'pi-2' }]);
    const result = await reassignCategoryItems('test-user-id', 'cat-delivery', 'cat-otros');
    assert.deepEqual(result, { status: 'ok', data: { moved: 2 } });
    assert.deepEqual(stub.__getUpdated('purchase_items'), { category_id: 'cat-otros' });
    assert.deepEqual(stub.__getQueryCalls('purchase_items'), [
      { op: 'eq', column: 'category_id', value: 'cat-delivery' },
    ], 'RLS scopes the UPDATE server-side (purchase_items has no user_id column)');
  });

  await test('reassignCategoryItems: backend failure → reassign copy', async () => {
    stub.__resetSupabaseBehavior();
    stub.__failNextUpdate('purchase_items');
    const result = await reassignCategoryItems('test-user-id', 'cat-delivery', 'cat-otros');
    assert.deepEqual(result, { status: 'error', message: REASSIGN_CATEGORY_ERROR_MESSAGE });
  });

  await test('createCustomCategory: unconfigured → gate before any insert', async () => {
    stub.__resetSupabaseBehavior();
    stub.__setSupabaseConfigInputs('https://YOUR-PROJECT.supabase.co', 'YOUR-ANON-KEY');
    try {
      const result = await createCustomCategory('test-user-id', {
        name: 'Delivery',
        kind: 'want',
        icon: 'package',
        color: '#7C3AED',
      });
      assert.deepEqual(result, { status: 'unconfigured' });
      assert.equal(
        stub.__getCallLog().filter((e) => e.kind === 'insert').length,
        0,
        'no insert may fire unconfigured',
      );
    } finally {
      stub.__setSupabaseConfigInputs('https://real-project.supabase.co', 'real-anon-key');
    }
  });

  // =========================================================================
  // SECTION C — queryKeys.categories + the REAL hook (jsdom mount)
  // =========================================================================
  console.log('\n[tests] C. query keys + real hook\n');

  await test('queryKeys.categories embeds the userId', async () => {
    assert.deepEqual(keysMod.queryKeys.categories('u1'), ['categories', 'u1']);
  });

  await test('hook: merged catalog from global + own rows (split by user_id)', async () => {
    stub.__resetSupabaseBehavior();
    authStub.__setUserId('test-user-id');
    stub.__setTableRead('categories', {
      rows: [bebidas, farmacia, otros, delivery, gimnasio],
    });
    const { ref, unmount, waitFor } = mountHook(useCategoryCatalog, makeQueryClient());
    try {
      await waitFor((r) => !!r && Object.keys(r.catalog).length === 5);
      assert.deepEqual(
        Object.keys(ref.current.catalog),
        ['bebidas', 'farmacia', 'otros', 'delivery', 'gimnasio'],
        'canonical first, then custom (both ordered)',
      );
      assert.deepEqual(ref.current.catalog.delivery, {
        id: 'cat-delivery',
        slug: 'delivery',
        name: 'Delivery',
        kind: 'want',
        icon: 'package',
        color: '#7C3AED',
        sort_order: 100,
      });
      assert.equal(ref.current.error, null);
      assert.equal(ref.current.isLoading, false);
    } finally {
      unmount();
    }
  });

  await test('hook: no user → zero reads, empty catalog', async () => {
    stub.__resetSupabaseBehavior();
    authStub.__setUserId(null);
    stub.__setTableRead('categories', { rows: [bebidas, otros, delivery] });
    const { ref, unmount, waitFor } = mountHook(useCategoryCatalog, makeQueryClient());
    try {
      await waitFor((r) => !!r && r.catalog !== undefined);
      for (let i = 0; i < 3; i += 1) {
        await act(async () => {
          await new Promise((r) => setTimeout(r, 0));
        });
      }
      assert.deepEqual(ref.current.catalog, {}, 'nothing loads without a user');
      assert.equal(categoryReads(), 0, 'the query is gated on userId');
      assert.equal(ref.current.error, null);
    } finally {
      unmount();
      authStub.__setUserId('test-user-id');
    }
  });

  await test('hook: read failure → user-safe error string, empty catalog', async () => {
    stub.__resetSupabaseBehavior();
    authStub.__setUserId('test-user-id');
    stub.__setTableRead('categories', {
      rows: null,
      error: { message: 'boom', code: '42P01' },
    });
    const { ref, unmount, waitFor } = mountHook(useCategoryCatalog, makeQueryClient());
    try {
      await waitFor((r) => !!r && r.error !== null);
      assert.equal(ref.current.error, READ_ERROR_FALLBACK);
      assert.deepEqual(ref.current.catalog, {});
    } finally {
      unmount();
    }
  });

  await test('hook: delete invalidates → refetch picks up fresh rows', async () => {
    stub.__resetSupabaseBehavior();
    authStub.__setUserId('test-user-id');
    stub.__setTableRead('categories', { rows: [bebidas, otros] });
    const { ref, unmount, waitFor } = mountHook(useCategoryCatalog, makeQueryClient());
    try {
      await waitFor((r) => !!r && Object.keys(r.catalog).length === 2);
      assert.equal(categoryReads(), 1, 'initial load only');

      // Simulate a concurrent change: the catalog now has a new custom row.
      stub.__setTableRead('categories', { rows: [bebidas, otros, delivery] });
      // The delete itself succeeds (armed deleted rows).
      stub.__setDeleteRead('categories', [{ id: 'cat-delivery' }]);

      await ref.current.delete('cat-delivery');
      await waitFor((r) => !!r && r.catalog.delivery !== undefined);
      assert.equal(categoryReads(), 2, 'invalidation triggered exactly one refetch');
      assert.equal(ref.current.deleteError, null);
    } finally {
      unmount();
    }
  });

  await test('hook: duplicate create → createError carries the friendly copy', async () => {
    stub.__resetSupabaseBehavior();
    authStub.__setUserId('test-user-id');
    stub.__setTableRead('categories', { rows: [bebidas, otros] });
    const { ref, unmount, waitFor } = mountHook(useCategoryCatalog, makeQueryClient());
    try {
      await waitFor((r) => !!r && Object.keys(r.catalog).length === 2);
      stub.__failNextInsert('categories', {
        message: 'duplicate key value violates unique constraint "categories_user_slug_idx"',
        code: '23505',
      });
      await assert.rejects(
        () =>
          ref.current.create({
            name: 'Delivery',
            kind: 'want',
            icon: 'package',
            color: '#7C3AED',
          }),
        /Esa categoría ya existe\./,
      );
      await waitFor((r) => !!r && r.createError !== null);
      assert.equal(
        ref.current.createError,
        'Esa categoría ya existe.',
        'mutation error mapped to the user-safe String via toQueryErrorMessage',
      );
      // The failed create must NOT have invalidated anything.
      assert.equal(categoryReads(), 1, 'no refetch after a failed create');
    } finally {
      unmount();
    }
  });

  await test('hook: no-user mutations reject fail-closed with zero backend calls', async () => {
    stub.__resetSupabaseBehavior();
    authStub.__setUserId(null);
    const { ref, unmount } = mountHook(useCategoryCatalog, makeQueryClient());
    try {
      await assert.rejects(
        () => ref.current.create({ name: 'Delivery', kind: 'want', icon: 'package', color: '#7C3AED' }),
        /No se pudo crear la categoría\. Inténtalo de nuevo\./,
      );
      await assert.rejects(
        () => ref.current.delete('cat-delivery'),
        /No se pudo eliminar la categoría\. Inténtalo de nuevo\./,
      );
      await assert.rejects(
        () => ref.current.reassign({ fromId: 'cat-delivery', toId: 'cat-otros' }),
        /No se pudieron reasignar los gastos\. Inténtalo de nuevo\./,
      );
      for (let i = 0; i < 3; i += 1) {
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      }
      assert.equal(stub.__getCallLog().length, 0, 'no backend interaction at all');
    } finally {
      unmount();
      authStub.__setUserId('test-user-id');
    }
  });

  // =========================================================================
  // Summary
  // =========================================================================
  console.log(`\n[tests] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  rmSync(workdir, { recursive: true, force: true });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});