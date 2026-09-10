#!/usr/bin/env node
/**
 * Node harness for the category-budget rollover hook
 * (`src/features/analytics/hooks/useCategoryBudgets.ts`, REQ-B scenarios).
 *
 * Covers the REQ-B rollover scenarios (persistence via
 * `markCategoryBudgetRolloverApplied`, migration 0030):
 *   1. Copy previous month on first read (empty current → prev budgets copied)
 *   2. Rows exist → skip rollover
 *   3. Prev empty → marker still written (sentinel), ref guard prevents loop
 *   4. Past month → skip rollover
 *   5. Removed slug not copied (not in EXPENSE_CATEGORIES)
 *   6. Amount ≤ 0 not copied (delete-on-zero filtered)
 *   7. Double-mount idempotent (two instances, same result)
 *   8. Rollover write error → no invalidate, no loop
 *   9. Save after rollover → edited row survives, no re-copy on revisit
 *  10. Invalidate keys → rollover success invalidates categoryBudgets + monthlyTotals
 *  11. Prev read error → no mark, no invalidate, no loop
 *  12. Household mode (rolloverEnabled=false) → no rollover at all
 *  13. Delete-on-zero remount → sentinel survives, no re-rollover
 *  14. All-reads error seam → hook error state, no mark, no crash
 *
 * The hook is mounted inside a real React tree (jsdom + react-dom/client +
 * act()) wrapped in a real QueryClientProvider — the exact pattern
 * scripts/test-run-rate-hook.mjs and scripts/test-monthly-cache.mjs use.
 *
 * Determinism: currentMonthKey / previousMonthKey are stubbed via
 * `@/features/home/hooks/useHomeFeed`; userId via `@/features/auth`;
 * readCategoryBudgets / upsertCategoryBudgets / markCategoryBudgetRolloverApplied
 * via feature-access mock seams. No real clock, no network.
 *
 * Usage: pnpm test:category-budget-rollover
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
const harnessConfig = join(__dirname, 'tsconfig.category-budget-rollover-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'category-budget-rollover-test-'));
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
// Require-hook: redirect problematic modules to stubs / mocks.
// @tanstack/react-query is NOT redirected — the real package is used.
// ---------------------------------------------------------------------------
function installRequireHook() {
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function rewrittenResolve(request, ...rest) {
    if (request === '@/features/auth') {
      request = join(outDir, 'scripts', 'test-stubs', 'auth.js');
    } else if (request === '@/features/home/hooks/useHomeFeed') {
      request = join(outDir, 'scripts', 'test-stubs', 'useHomeFeed.js');
    } else if (request === '@/lib/supabase') {
      request = join(outDir, 'scripts', 'test-stubs', 'supabase.js');
    } else if (request === '@/lib/supabase/feature-access') {
      request = join(__dirname, 'test-mocks', 'feature-access.js');
    } else if (request === '@/lib/supabase/storage-adapter') {
      request = join(outDir, 'scripts', 'test-stubs', 'storage-adapter.js');
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

/** A single CategoryBudget row (rollover_applied false unless flagged). */
function makeBudget(slug, amount, month, rolloverApplied = false) {
  return {
    user_id: 'test-user-id',
    category_slug: slug,
    amount,
    month,
    rollover_applied: rolloverApplied,
  };
}

/** The rollover sentinel row: durable "rollover ran for this month" record. */
function makeSentinel(month) {
  return makeBudget('__rollover__', 0, month, true);
}

/** Aug 2026 budgets (previous month). */
const augBudgets = [
  makeBudget('alimentos', 50000, '2026-08'),
  makeBudget('carnes', 30000, '2026-08'),
  makeBudget('removed-slug', 10000, '2026-08'),   // not in EXPENSE_CATEGORIES
  makeBudget('limpieza', 0, '2026-08'),             // amount ≤ 0 → filtered
];

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
async function run() {
  console.log('\n[tests] compiling category-budget rollover modules…');
  await compile();
  globalThis.__DEV__ = false;
  installRequireHook();
  console.log('[tests] loading compiled modules…');

  const hookMod = await load('src/features/analytics/hooks/useCategoryBudgets.js');
  const { useCategoryBudgets } = hookMod;

  const authStub = await load('scripts/test-stubs/auth.js');
  const homeFeedStub = await load('scripts/test-stubs/useHomeFeed.js');

  // Feature-access mock (controllable per test via __set* seams)
  const faMock = require_(join(__dirname, 'test-mocks', 'feature-access.js'));

  // Real React + react-query + react-dom for mounting hooks
  const React = require_('react');
  const { act } = React;
  const { createRoot } = require_('react-dom/client');
  const { QueryClient, QueryClientProvider, useQuery } = require_('@tanstack/react-query');

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

  // Deterministic clock: current month key is pinned.
  homeFeedStub.__setCurrentMonthKey('2026-09');
  authStub.__setUserId('test-user-id');

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
   * Returns { ref, unmount, waitFor, queryClient }.
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

  // =========================================================================
  // REQ-B: Copy previous month on first read
  // =========================================================================
  console.log('\n[tests] REQ-B rollover scenarios\n');

  await test('copy-on-first-read: empty current + prev budgets → mark fires', async () => {
    faMock.__reset();
    authStub.__setUserId('test-user-id');
    homeFeedStub.__setCurrentMonthKey('2026-09');

    // Current month empty, previous month has budgets (incl. filtered rows)
    faMock.__setReadCategoryBudgets(async (userId, yearMonth) => {
      if (yearMonth === '2026-09') return { status: 'ok', data: [] };
      return { status: 'ok', data: augBudgets };
    });

    let markCalls = 0;
    let lastMarkArgs = null;
    faMock.__setMarkCategoryBudgetRolloverApplied(async (budgets, yearMonth, userId) => {
      markCalls += 1;
      lastMarkArgs = { budgets: [...budgets], yearMonth, userId };
      return { status: 'ok', data: null };
    });

    const { ref, unmount, waitFor } = mountHook(
      () => useCategoryBudgets('2026-09'),
      makeQueryClient(),
    );

    try {
      await waitFor(() => markCalls >= 1, { timeout: 3000 });
      // Allow post-rollover invalidation to settle
      for (let i = 0; i < 3; i++) {
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      }
      assert.equal(markCalls, 1, 'mark fires exactly once');
      assert.equal(lastMarkArgs.yearMonth, '2026-09');
      assert.equal(lastMarkArgs.userId, 'test-user-id');
      // Filter: alimentos (valid, 50000) + carnes (valid, 30000);
      // removed-slug (not in EXPENSE_CATEGORIES) + limpieza (0) filtered out
      const slugs = lastMarkArgs.budgets.map((b) => b.category_slug).sort();
      assert.deepEqual(slugs, ['alimentos', 'carnes']);
      assert.deepEqual(
        lastMarkArgs.budgets.map((b) => b.amount).sort((a, b) => a - b),
        [30000, 50000],
      );
    } finally {
      unmount();
    }
  });

  // =========================================================================
  // REQ-B: Rows exist → no rollover
  // =========================================================================
  await test('rows-exist: current has budgets → skip rollover', async () => {
    faMock.__reset();
    authStub.__setUserId('test-user-id');
    homeFeedStub.__setCurrentMonthKey('2026-09');

    // Current month already has budgets
    const currentBudgets = [makeBudget('alimentos', 40000, '2026-09')];
    faMock.__setReadCategoryBudgets(async (userId, yearMonth) => {
      if (yearMonth === '2026-09') return { status: 'ok', data: currentBudgets };
      return { status: 'ok', data: augBudgets };
    });

    let markCalls = 0;
    faMock.__setMarkCategoryBudgetRolloverApplied(async () => {
      markCalls += 1;
      return { status: 'ok', data: null };
    });

    const { ref, unmount, waitFor } = mountHook(
      () => useCategoryBudgets('2026-09'),
      makeQueryClient(),
    );

    try {
      await waitFor((r) => !!r && r.budgets.length > 0);
      // Flush extra rounds to confirm no late rollover
      for (let i = 0; i < 4; i++) {
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      }
      assert.equal(markCalls, 0, 'rollover must not fire when rows exist');
      assert.equal(ref.current.budgets.length, 1);
      assert.equal(ref.current.budgets[0].category_slug, 'alimentos');
      assert.equal(ref.current.budgets[0].amount, 40000);
    } finally {
      unmount();
    }
  });

  // =========================================================================
  // REQ-B: Prev empty → marker still written, ref guard prevents re-fire
  // =========================================================================
  await test('prev-empty: marker written with zero copies, no loop (non-vacuous)', async () => {
    faMock.__reset();
    authStub.__setUserId('test-user-id');
    homeFeedStub.__setCurrentMonthKey('2026-09');

    // Both current and prev are empty
    faMock.__setReadCategoryBudgets(async () => ({ status: 'ok', data: [] }));

    let markCalls = 0;
    let lastMarkBudgets = null;
    faMock.__setMarkCategoryBudgetRolloverApplied(async (budgets) => {
      markCalls += 1;
      lastMarkBudgets = budgets;
      return { status: 'ok', data: null };
    });

    const { ref, unmount, waitFor } = mountHook(
      () => useCategoryBudgets('2026-09'),
      makeQueryClient(),
    );

    try {
      // Wait for query to resolve + rollover to run
      await waitFor(() => markCalls >= 1, { timeout: 3000 });
      // Flush extra rounds — ref guard must prevent re-fire
      for (let i = 0; i < 6; i++) {
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      }
      // Non-vacuous: the marker IS written even with nothing to copy, but
      // exactly once. Read count: initial current + prev + invalidate refetch.
      assert.equal(markCalls, 1, 'mark fires exactly once despite empty prev');
      assert.deepEqual(lastMarkBudgets, [], 'no copies when prev is empty');
      // Prove the ref guard is what stops the loop (not an empty mutation):
      // a broken guard would re-read prev every render → unbounded growth.
      assert.equal(
        faMock.__getReadCategoryBudgetsCallCount(),
        3,
        'reads: initial + prev + invalidate refetch — no more',
      );
      assert.equal(ref.current.budgets.length, 0);
    } finally {
      unmount();
    }
  });

  // =========================================================================
  // REQ-B: Past month → skip rollover
  // =========================================================================
  await test('past-month: yearMonth !== currentMonthKey → no rollover', async () => {
    faMock.__reset();
    authStub.__setUserId('test-user-id');
    homeFeedStub.__setCurrentMonthKey('2026-09');

    faMock.__setReadCategoryBudgets(async () => ({ status: 'ok', data: [] }));

    let markCalls = 0;
    faMock.__setMarkCategoryBudgetRolloverApplied(async () => {
      markCalls += 1;
      return { status: 'ok', data: null };
    });

    const { ref, unmount, waitFor } = mountHook(
      () => useCategoryBudgets('2026-08'),  // past month
      makeQueryClient(),
    );

    try {
      await waitFor((r) => !!r && r.isLoading === false);
      for (let i = 0; i < 4; i++) {
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      }
      assert.equal(markCalls, 0, 'past month must not trigger rollover');
      assert.equal(ref.current.budgets.length, 0);
    } finally {
      unmount();
    }
  });

  // =========================================================================
  // REQ-B: Removed slug not copied
  // =========================================================================
  await test('removed-slug: slug not in EXPENSE_CATEGORIES → filtered out', async () => {
    faMock.__reset();
    authStub.__setUserId('test-user-id');
    homeFeedStub.__setCurrentMonthKey('2026-09');

    // Previous month has a slug that doesn't exist in EXPENSE_CATEGORIES
    const prevBudgets = [
      makeBudget('alimentos', 50000, '2026-08'),
      makeBudget('nonexistent-slug', 25000, '2026-08'),
    ];
    faMock.__setReadCategoryBudgets(async (userId, yearMonth) => {
      if (yearMonth === '2026-08') return { status: 'ok', data: prevBudgets };
      return { status: 'ok', data: [] };
    });

    let markCalls = 0;
    let lastMarkBudgets = null;
    faMock.__setMarkCategoryBudgetRolloverApplied(async (budgets) => {
      markCalls += 1;
      lastMarkBudgets = budgets;
      return { status: 'ok', data: null };
    });

    const { ref, unmount, waitFor } = mountHook(
      () => useCategoryBudgets('2026-09'),
      makeQueryClient(),
    );

    try {
      await waitFor(() => markCalls >= 1);
      for (let i = 0; i < 3; i++) {
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      }
      assert.equal(markCalls, 1);
      const slugs = lastMarkBudgets.map((b) => b.category_slug);
      assert.ok(!slugs.includes('nonexistent-slug'), 'removed slug must not be copied');
      assert.ok(slugs.includes('alimentos'), 'valid slug must be copied');
    } finally {
      unmount();
    }
  });

  // =========================================================================
  // REQ-B: Amount ≤ 0 not copied
  // =========================================================================
  await test('amount-le-0: delete-on-zero rows → not copied', async () => {
    faMock.__reset();
    authStub.__setUserId('test-user-id');
    homeFeedStub.__setCurrentMonthKey('2026-09');

    const prevBudgets = [
      makeBudget('alimentos', 50000, '2026-08'),
      makeBudget('carnes', 0, '2026-08'),      // deleted via delete-on-zero
      makeBudget('limpieza', -5000, '2026-08'), // negative → filtered
    ];
    faMock.__setReadCategoryBudgets(async (userId, yearMonth) => {
      if (yearMonth === '2026-08') return { status: 'ok', data: prevBudgets };
      return { status: 'ok', data: [] };
    });

    let markCalls = 0;
    let lastMarkBudgets = null;
    faMock.__setMarkCategoryBudgetRolloverApplied(async (budgets) => {
      markCalls += 1;
      lastMarkBudgets = budgets;
      return { status: 'ok', data: null };
    });

    const { ref, unmount, waitFor } = mountHook(
      () => useCategoryBudgets('2026-09'),
      makeQueryClient(),
    );

    try {
      await waitFor(() => markCalls >= 1);
      for (let i = 0; i < 3; i++) {
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      }
      assert.equal(markCalls, 1);
      const slugs = lastMarkBudgets.map((b) => b.category_slug);
      assert.ok(!slugs.includes('carnes'), 'amount 0 must not be copied');
      assert.ok(!slugs.includes('limpieza'), 'negative amount must not be copied');
      assert.ok(slugs.includes('alimentos'), 'valid positive amount must be copied');
    } finally {
      unmount();
    }
  });

  // =========================================================================
  // REQ-B: Double-mount idempotent
  // =========================================================================
  await test('double-mount: two instances → both fire, writes are idempotent', async () => {
    faMock.__reset();
    authStub.__setUserId('test-user-id');
    homeFeedStub.__setCurrentMonthKey('2026-09');

    // Current empty, prev has budgets
    faMock.__setReadCategoryBudgets(async (userId, yearMonth) => {
      if (yearMonth === '2026-09') return { status: 'ok', data: [] };
      return { status: 'ok', data: [makeBudget('alimentos', 50000, '2026-08')] };
    });

    let markCalls = 0;
    const markPayloads = [];
    faMock.__setMarkCategoryBudgetRolloverApplied(async (budgets) => {
      markCalls += 1;
      markPayloads.push(
        budgets.map((b) => ({ category_slug: b.category_slug, amount: b.amount })),
      );
      return { status: 'ok', data: null };
    });

    const qc1 = makeQueryClient();
    const qc2 = makeQueryClient();
    const { ref: ref1, unmount: unmount1, waitFor: waitFor1 } = mountHook(
      () => useCategoryBudgets('2026-09'),
      qc1,
    );
    const { ref: ref2, unmount: unmount2, waitFor: waitFor2 } = mountHook(
      () => useCategoryBudgets('2026-09'),
      qc2,
    );

    try {
      await waitFor1(() => markCalls >= 1);
      await waitFor2(() => markCalls >= 2, { timeout: 3000 });
      for (let i = 0; i < 3; i++) {
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      }
      // Each mount has its own ref guard → each fires once; the marker write
      // is PK-idempotent, so the payloads are identical (final rows unchanged).
      assert.equal(markCalls, 2, 'one rollover write per mounted instance');
      assert.deepEqual(
        markPayloads[0],
        markPayloads[1],
        'both mounts copy the SAME rows (idempotent upsert)',
      );
      assert.ok(ref1.current !== undefined, 'first mount result exists');
      assert.ok(ref2.current !== undefined, 'second mount result exists');
    } finally {
      unmount1();
      unmount2();
    }
  });

  // =========================================================================
  // REQ-B: Rollover write error → no invalidate, no loop
  // =========================================================================
  await test('rollover-error: mark fails → no invalidation, no loop', async () => {
    faMock.__reset();
    authStub.__setUserId('test-user-id');
    homeFeedStub.__setCurrentMonthKey('2026-09');

    // Current empty, prev has budgets
    faMock.__setReadCategoryBudgets(async (userId, yearMonth) => {
      if (yearMonth === '2026-09') return { status: 'ok', data: [] };
      return { status: 'ok', data: [makeBudget('alimentos', 50000, '2026-08')] };
    });

    let markCalls = 0;
    faMock.__setMarkCategoryBudgetRolloverApplied(async () => {
      markCalls += 1;
      return { status: 'error', message: 'network error' };
    });

    const { ref, unmount, waitFor } = mountHook(
      () => useCategoryBudgets('2026-09'),
      makeQueryClient(),
    );

    try {
      await waitFor(() => markCalls >= 1, { timeout: 3000 });
      // Flush extra rounds — must NOT loop
      for (let i = 0; i < 6; i++) {
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      }
      assert.equal(markCalls, 1, 'mark fires exactly once even on error');
      // No-op result → onSuccess skips invalidation → no extra reads
      // (initial current + prev only, no refetch).
      assert.equal(
        faMock.__getReadCategoryBudgetsCallCount(),
        2,
        'no invalidation → no refetch (read count stays at initial + prev)',
      );
      // budgets remain empty (error → no data)
      assert.equal(ref.current.budgets.length, 0);
    } finally {
      unmount();
    }
  });

  // =========================================================================
  // REQ-B: Rollover preserves user changes on revisit
  // =========================================================================
  await test('save-after-rollover: edited row survives, no re-copy on revisit', async () => {
    faMock.__reset();
    authStub.__setUserId('test-user-id');
    homeFeedStub.__setCurrentMonthKey('2026-09');

    // In-memory store: mark/upsert write, reads serve — like the real DB.
    const store = new Map(); // yearMonth → CategoryBudget[]
    faMock.__setReadCategoryBudgets(async (userId, yearMonth) => ({
      status: 'ok',
      data: [...(store.get(yearMonth) ?? [])],
    }));

    let markCalls = 0;
    const markPayloads = [];
    faMock.__setMarkCategoryBudgetRolloverApplied(async (budgets, yearMonth, userId) => {
      markCalls += 1;
      markPayloads.push(budgets);
      store.set(yearMonth, [
        ...(store.get(yearMonth) ?? []).filter(
          (b) => !budgets.some((nb) => nb.category_slug === b.category_slug),
        ),
        ...budgets.map((b) => makeBudget(b.category_slug, b.amount, yearMonth, true)),
        makeSentinel(yearMonth),
      ]);
      return { status: 'ok', data: null };
    });

    let upsertCalls = 0;
    faMock.__setUpsertCategoryBudgets(async (budgets, yearMonth, userId) => {
      upsertCalls += 1;
      const current = store.get(yearMonth) ?? [];
      const remaining = current.filter(
        (b) => !budgets.some((nb) => nb.category_slug === b.category_slug),
      );
      // Delete-on-zero semantics (same as the real upsertCategoryBudgets):
      // amount <= 0 → row removed; amount > 0 → row replaced.
      const cleared = budgets.filter((b) => b.amount <= 0).map((b) => b.category_slug);
      store.set(yearMonth, [
        ...remaining.filter((b) => !cleared.includes(b.category_slug)),
        ...budgets
          .filter((b) => b.amount > 0)
          .map((b) => makeBudget(b.category_slug, b.amount, yearMonth)),
      ]);
      return { status: 'ok', data: null };
    });

    // Prev month seeded before mount
    store.set('2026-08', [makeBudget('alimentos', 50000, '2026-08')]);

    const { ref, unmount, waitFor } = mountHook(
      () => useCategoryBudgets('2026-09'),
      makeQueryClient(),
    );

    try {
      // First read: empty current → rollover copies prev (mark #1)
      await waitFor(() => markCalls >= 1, { timeout: 3000 });
      // Post-rollover refetch serves the copied row (+ sentinel)
      await waitFor((r) => !!r && r.budgets.length === 2 && r.budgets.some((b) => b.amount === 50000), { timeout: 3000 });

      // User edits the copied row to $60,000 via save() — upsert #1
      await act(async () => {
        await ref.current.save([{ category_slug: 'alimentos', amount: 60000 }]);
      });
      // Refetch after save returns the edited row (+ sentinel)
      await waitFor((r) => !!r && r.budgets.some((b) => b.category_slug === 'alimentos' && b.amount === 60000), { timeout: 3000 });

      // Flush rounds — rollover MUST NOT re-copy 50000 over the edit
      for (let i = 0; i < 6; i++) {
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      }

      assert.equal(markCalls, 1, 'one rollover copy — no re-copy');
      assert.equal(upsertCalls, 1, 'one user save');
      const alimentos = ref.current.budgets.find((b) => b.category_slug === 'alimentos');
      assert.equal(alimentos.amount, 60000, 'edited amount preserved');
      assert.equal(markPayloads[0][0].amount, 50000, 'rollover copied prev limit');
    } finally {
      unmount();
    }
  });

  // =========================================================================
  // REQ-B: Rollover onSuccess invalidates both categoryBudgets and monthlyTotals
  // =========================================================================
  await test('invalidate-keys: rollover success → invalidates categoryBudgets + monthlyTotals', async () => {
    faMock.__reset();
    authStub.__setUserId('test-user-id');
    homeFeedStub.__setCurrentMonthKey('2026-09');

    let markCalls = 0;
    faMock.__setMarkCategoryBudgetRolloverApplied(async () => {
      markCalls += 1;
      return { status: 'ok', data: null };
    });

    // Fetch counters for the two keys the rollover onSuccess must invalidate.
    // The watcher query is mounted in the same tree, so an invalidation makes
    // it refetch (observable), exactly as surfacing would in the app.
    // Single read seam: counts current-month reads AND serves the prev month
    // (a second __setReadCategoryBudgets would overwrite this one).
    let currentReads = 0;
    let totalsFetches = 0;
    faMock.__setReadCategoryBudgets(async (userId, yearMonth) => {
      if (yearMonth === '2026-09') {
        currentReads += 1;
        return { status: 'ok', data: [] };
      }
      return { status: 'ok', data: [makeBudget('alimentos', 50000, '2026-08')] };
    });

    function useHookWithTotalsWatcher() {
      useCategoryBudgets('2026-09');
      // React Query hook must be called unconditionally (hooks-order rule)
      useQuery({
        queryKey: ['analytics', 'monthly-totals', 'test-user-id', '2026-09'],
        queryFn: async () => {
          totalsFetches += 1;
          return [];
        },
      });
      return {};
    }

    const { ref, unmount, waitFor } = mountHook(
      useHookWithTotalsWatcher,
      makeQueryClient(),
    );

    try {
      // Both queries fire their initial fetch at mount.
      await waitFor(() => currentReads >= 1 && totalsFetches >= 1, { timeout: 3000 });
      // Rollover: mutation fires, onSuccess invalidates BOTH keys → both refetch.
      await waitFor(() => markCalls >= 1, { timeout: 3000 });
      await waitFor(() => currentReads >= 2 && totalsFetches >= 2, { timeout: 3000 });
      for (let i = 0; i < 3; i++) {
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      }
      assert.equal(markCalls, 1, 'rollover write fired once');
      assert.equal(currentReads, 2, 'categoryBudgets key invalidated → refetch');
      assert.equal(totalsFetches, 2, 'monthlyTotals key invalidated → refetch');
      assert.ok(ref.current !== undefined, 'hook mounted');
    } finally {
      unmount();
    }
  });

  // =========================================================================
  // R4-W: Prev read error → no mark, no invalidate, no loop
  // =========================================================================
  await test('prev-read-error: prev month read fails → no mark, no invalidate, no loop', async () => {
    faMock.__reset();
    authStub.__setUserId('test-user-id');
    homeFeedStub.__setCurrentMonthKey('2026-09');

    // Current month reads fine (empty); the PREV month read fails — the
    // rollover must abort before writing anything (no copies, no marker).
    faMock.__setReadCategoryBudgets(async (userId, yearMonth) => {
      if (yearMonth === '2026-08') {
        return { status: 'error', message: 'network error' };
      }
      return { status: 'ok', data: [] };
    });

    let markCalls = 0;
    faMock.__setMarkCategoryBudgetRolloverApplied(async () => {
      markCalls += 1;
      return { status: 'ok', data: null };
    });

    const { ref, unmount, waitFor } = mountHook(
      () => useCategoryBudgets('2026-09'),
      makeQueryClient(),
    );

    try {
      await waitFor((r) => !!r && r.isLoading === false && !r.error);
      // Flush extra rounds — must NOT loop
      for (let i = 0; i < 6; i++) {
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      }
      assert.equal(markCalls, 0, 'prev read error → rollover aborts before writing');
      // No invalidate either: initial current read + prev read, no refetch.
      assert.equal(
        faMock.__getReadCategoryBudgetsCallCount(),
        2,
        'no invalidation → no refetch',
      );
      assert.equal(ref.current.budgets.length, 0);
    } finally {
      unmount();
    }
  });

  // =========================================================================
  // AD-6: Household mode (rolloverEnabled=false) → no rollover at all
  // =========================================================================
  await test('household-no-rollover: rolloverEnabled=false → nothing fires', async () => {
    faMock.__reset();
    authStub.__setUserId('test-user-id');
    homeFeedStub.__setCurrentMonthKey('2026-09');

    // Current empty, prev has budgets — yet nothing must be copied.
    faMock.__setReadCategoryBudgets(async (userId, yearMonth) => {
      if (yearMonth === '2026-09') return { status: 'ok', data: [] };
      return { status: 'ok', data: augBudgets };
    });

    let markCalls = 0;
    faMock.__setMarkCategoryBudgetRolloverApplied(async () => {
      markCalls += 1;
      return { status: 'ok', data: null };
    });

    const { ref, unmount, waitFor } = mountHook(
      () => useCategoryBudgets('2026-09', false),
      makeQueryClient(),
    );

    try {
      await waitFor((r) => !!r && r.isLoading === false && !r.error);
      for (let i = 0; i < 4; i++) {
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      }
      assert.equal(markCalls, 0, 'household mode must never roll over');
      assert.equal(
        faMock.__getReadCategoryBudgetsCallCount(),
        1,
        'no prev read either — gate short-circuits before the mutation',
      );
      assert.equal(ref.current.budgets.length, 0);
    } finally {
      unmount();
    }
  });

  // =========================================================================
  // REQ-B: Delete-on-zero + remount → sentinel survives, no re-rollover
  // =========================================================================
  await test('delete-on-zero-remount: sentinel survives clearing + remount → no re-rollover', async () => {
    faMock.__reset();
    authStub.__setUserId('test-user-id');
    homeFeedStub.__setCurrentMonthKey('2026-09');

    // In-memory store: mark/upsert write, reads serve — like the real DB.
    const store = new Map(); // yearMonth → CategoryBudget[]
    faMock.__setReadCategoryBudgets(async (userId, yearMonth) => ({
      status: 'ok',
      data: [...(store.get(yearMonth) ?? [])],
    }));

    let markCalls = 0;
    faMock.__setMarkCategoryBudgetRolloverApplied(async (budgets, yearMonth, userId) => {
      markCalls += 1;
      store.set(yearMonth, [
        ...(store.get(yearMonth) ?? []).filter(
          (b) => !budgets.some((nb) => nb.category_slug === b.category_slug),
        ),
        ...budgets.map((b) => makeBudget(b.category_slug, b.amount, yearMonth, true)),
        makeSentinel(yearMonth),
      ]);
      return { status: 'ok', data: null };
    });

    let upsertCalls = 0;
    faMock.__setUpsertCategoryBudgets(async (budgets, yearMonth, userId) => {
      upsertCalls += 1;
      const current = store.get(yearMonth) ?? [];
      const remaining = current.filter(
        (b) => !budgets.some((nb) => nb.category_slug === b.category_slug),
      );
      // Delete-on-zero semantics (same as the real upsertCategoryBudgets):
      // amount <= 0 → row removed; amount > 0 → row replaced.
      const cleared = budgets.filter((b) => b.amount <= 0).map((b) => b.category_slug);
      store.set(yearMonth, [
        ...remaining.filter((b) => !cleared.includes(b.category_slug)),
        ...budgets
          .filter((b) => b.amount > 0)
          .map((b) => makeBudget(b.category_slug, b.amount, yearMonth)),
      ]);
      return { status: 'ok', data: null };
    });

    // Simulated history: rollover already ran for 2026-09 (a previous session
    // copied alimentos 50000 + wrote the sentinel). Now the user clears the
    // copied budget via delete-on-zero.
    store.set('2026-09', [
      makeBudget('alimentos', 50000, '2026-09', true),
      makeSentinel('2026-09'),
    ]);

    const first = mountHook(() => useCategoryBudgets('2026-09'), makeQueryClient());
    try {
      await first.waitFor((r) => !!r && !r.isLoading && !r.error);
      // User clears the copied budget (amount 0 → delete-on-zero).
      await act(async () => {
        await first.ref.current.save([{ category_slug: 'alimentos', amount: 0 }]);
      });
      await first.waitFor(
        (r) => !!r && r.budgets.length === 1 && r.budgets[0].category_slug === '__rollover__',
        { timeout: 3000 },
      );
      assert.equal(markCalls, 0, 'rows exist (sentinel) → no re-rollover on first mount');
      assert.equal(upsertCalls, 1, 'user save deleted the copied row');
    } finally {
      first.unmount();
    }

    // Remount (fresh QueryClient — app restart): only the sentinel remains.
    // The durable marker must prevent a second rollover.
    const second = mountHook(() => useCategoryBudgets('2026-09'), makeQueryClient());
    try {
      await second.waitFor(
        (r) => !!r && !r.isLoading && !r.error && r.budgets.length === 1,
        { timeout: 3000 },
      );
      for (let i = 0; i < 4; i++) {
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      }
      assert.equal(markCalls, 0, 'remount sees the sentinel → no re-rollover');
      assert.equal(second.ref.current.budgets.length, 1, 'only the sentinel row');
      assert.equal(
        second.ref.current.budgets[0].category_slug,
        '__rollover__',
        'sentinel survives delete-on-zero',
      );
    } finally {
      second.unmount();
    }
  });

  // =========================================================================
  // R4-W: All reads fail (seam) → hook error state, no mark, no crash
  // =========================================================================
  await test('all-reads-error: __setReadCategoryBudgetsError → error state, no mark, no crash', async () => {
    faMock.__reset();
    authStub.__setUserId('test-user-id');
    homeFeedStub.__setCurrentMonthKey('2026-09');

    // Every read (current + prev) fails via the global seam.
    faMock.__setReadCategoryBudgetsError('network error');

    let markCalls = 0;
    faMock.__setMarkCategoryBudgetRolloverApplied(async () => {
      markCalls += 1;
      return { status: 'ok', data: null };
    });

    const { ref, unmount, waitFor } = mountHook(
      () => useCategoryBudgets('2026-09'),
      makeQueryClient(),
    );

    try {
      // The current-month query rejects through toQueryData → hook error.
      await waitFor((r) => !!r && r.isLoading === false && !!r.error, { timeout: 3000 });
      for (let i = 0; i < 4; i++) {
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      }
      assert.equal(markCalls, 0, 'read error → rollover never starts');
      assert.equal(ref.current.error, faMock.READ_ERROR_MESSAGE(), 'user-safe error surfaced');
      assert.equal(ref.current.budgets.length, 0);
      assert.equal(ref.current.isLoading, false);
    } finally {
      unmount();
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