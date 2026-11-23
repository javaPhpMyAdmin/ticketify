#!/usr/bin/env node
/**
 * Executed truth table for the DB-authoritative entitlement reconciliation
 * (`src/features/pro/entitlement-reconcile.ts`).
 *
 * Unlike the source-pin harnesses, this one COMPILES the real module with
 * stubbed leaf deps and EXECUTES `reconcileEntitlementFromDB` against injected
 * readers/setters. The contracts pinned here:
 *
 *   - RC-cached `isPro=true` is NOT a grant: DB free/none revokes it.
 *   - DB pro/active grants even when RC reports free.
 *   - A failed/unconfigured/missing profile read leaves `isPro` untouched.
 *   - A listener-driven grant younger than 60s protects the user from webhook
 *     lag; stale grants (and grants for another user) do not.
 *   - `ever_paid` is monotonic — never written back to false.
 *   - Dev overrides short-circuit before any read.
 *   - A successful read invalidates the profile query.
 *   - The reconciled flag drives `computeQuotaState().unlimited`.
 *
 * Usage: pnpm test:entitlement-reconcile
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const tscBin = require.resolve('typescript/bin/tsc');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'entitlement-reconcile-test-'));
const modulePath = join(
  root,
  'src',
  'features',
  'pro',
  'entitlement-reconcile.ts',
);
const source = readFileSync(modulePath, 'utf8');
const srcDir = join(workdir, 'src');
const stubDir = join(workdir, 'lib-stubs');
const outDir = join(workdir, 'out');

let passed = 0;
let failed = 0;
// Populated from the compiled module in run() so makeDeps can close over the
// real grant-map implementation without a module-scope import cycle.
let isFreshListenerGrantImpl = () => false;

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
// Compile the REAL modules with only the leaf deps stubbed.
// ---------------------------------------------------------------------------

function compile() {
  mkdirSync(srcDir, { recursive: true });
  mkdirSync(stubDir, { recursive: true });

  const compiledSource = source
    .replace(
      /from '@\/lib\/supabase\/feature-access'/g,
      "from '../lib-stubs/feature-access'",
    )
    .replace(
      /from '@\/stores\/use-pro-store'/g,
      "from '../lib-stubs/use-pro-store'",
    )
    .replace(
      /from '@\/lib\/query-client'/g,
      "from '../lib-stubs/query-client'",
    )
    .replace(
      /from '@\/lib\/query-keys'/g,
      "from '../lib-stubs/query-keys'",
    )
    .replace(
      /from '@\/lib\/with-timeout'/g,
      "from './with-timeout'",
    );
  writeFileSync(join(srcDir, 'entitlement-reconcile.ts'), compiledSource);

  // Real bounded-wait helper — the 2.5s tap guard is part of the contract.
  copyFileSync(
    join(root, 'src', 'lib', 'with-timeout.ts'),
    join(srcDir, 'with-timeout.ts'),
  );

  // './gate' is a relative import — compile the real pure gate module beside
  // the reconciler so the dev-override behavior is the shipped behavior.
  copyFileSync(
    join(root, 'src', 'features', 'pro', 'gate.ts'),
    join(srcDir, 'gate.ts'),
  );
  // Zero-import pure quota module — used to prove the reconciled flag is the
  // one that drives `unlimited` at the scan gate.
  copyFileSync(
    join(root, 'src', 'features', 'home', 'quota.ts'),
    join(srcDir, 'quota.ts'),
  );

  writeFileSync(
    join(stubDir, 'feature-access.ts'),
    `export const __profileRow: any = {
       status: 'ok',
       data: { tier: 'free', subscription_status: 'none', ever_paid: false },
     };
     export async function readProfileRow(_userId: string): Promise<any> {
       return __profileRow;
     }
   `,
  );
  writeFileSync(
    join(stubDir, 'use-pro-store.ts'),
    `export const __store: { isPro: boolean; everPaid: boolean } = { isPro: false, everPaid: false };
     const setEverPaid = (everPaid: boolean) => { __store.everPaid = everPaid; };
     export const useProStore: any = {
       getState: () => ({ ...__store, setEverPaid }),
       setState: (patch: Partial<typeof __store>) => { Object.assign(__store, patch); },
       setEverPaid,
     };
   `,
  );
  writeFileSync(
    join(stubDir, 'query-client.ts'),
    `export const __invalidations: unknown[] = [];
     export const queryClient: any = {
       invalidateQueries: (opts: {queryKey: unknown}) => { __invalidations.push(opts.queryKey); },
     };
    `,
  );
  writeFileSync(
    join(stubDir, 'query-keys.ts'),
    `export const queryKeys: any = {
       profile: (userId: string) => ['profile', userId],
     };
    `,
  );
  writeFileSync(
    join(workdir, 'globals.d.ts'),
    'declare const __DEV__: unknown;\n',
  );
  writeFileSync(
    join(workdir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          module: 'commonjs',
          moduleResolution: 'node',
          target: 'es2020',
          lib: ['es2020', 'dom'],
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          forceConsistentCasingInFileNames: true,
          rootDir: '.',
          outDir: './out',
        },
        include: ['./src/*.ts', './lib-stubs/*.ts', './globals.d.ts'],
      },
      null,
      2,
    ),
  );

  execFileSync(process.execPath, [tscBin, '-p', 'tsconfig.json'], {
    cwd: workdir,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
}

function load(mod) {
  return import(pathToFileURL(join(outDir, mod)).href);
}

// Fixtures ------------------------------------------------------------------

function okRow(overrides = {}) {
  return {
    status: 'ok',
    data: {
      tier: 'free',
      subscription_status: 'none',
      ever_paid: false,
      ...overrides,
    },
  };
}

const NOW = 1_000_000;

function makeDeps(options = {}) {
  const calls = { reads: [], setPro: [], setEverPaid: [], invalidate: [] };
  const store = {
    isPro: options.initialIsPro ?? false,
    everPaid: options.initialEverPaid ?? false,
  };
  let clock = options.now ?? NOW;
  return {
    calls,
    store: () => ({ ...store }),
    advanceClock(ms) {
      clock += ms;
    },
    setClock(value) {
      clock = value;
    },
    deps: {
      readProfile: async (userId) => {
        calls.reads.push(userId);
        const result = options.readResult ?? okRow();
        const resolved =
          typeof result === 'function' ? result(userId, calls) : result;
        return await resolved;
      },
      getStore: () => ({ ...store }),
      setPro: (isPro) => {
        calls.setPro.push(isPro);
        store.isPro = isPro;
        if (options.bumpClockOnSetPro !== undefined) {
          clock = options.bumpClockOnSetPro;
        }
      },
      setEverPaid: (everPaid) => {
        calls.setEverPaid.push(everPaid);
        store.everPaid = store.everPaid || everPaid;
      },
      invalidateProfile: (userId) => {
        calls.invalidate.push(userId);
        if (options.bumpClockOnInvalidate !== undefined) {
          clock = options.bumpClockOnInvalidate;
        }
      },
      now: () => (options.nowFn ? options.nowFn() : clock),
      timeoutMs: options.timeoutMs ?? 2500,
      freshGrantFor:
        options.freshGrantFor ??
        ((userId, nowMs) => isFreshListenerGrantImpl(userId, nowMs)),
      overrides: {
        isProOverrideEnabled: () => false,
        isProExpiredOverrideEnabled: () => false,
        ...(options.overrideFns ?? {}),
      },
    },
  };
}

// ---------------------------------------------------------------------------

async function run() {
  console.log('\n[tests] compiling entitlement-reconcile modules…');
  compile();
  console.log('[tests] loading compiled modules…');
  globalThis.__DEV__ = false;
  const mod = await load('src/entitlement-reconcile.js');
  const {
    decideReconciledEntitlement,
    isProFromProfileRow,
    recordListenerGrant,
    clearListenerGrant,
    clearListenerGrants,
    clearEntitlementCache,
    markRevoked,
    isFreshListenerGrant,
    reconcileEntitlementFromDB,
    getFastPathVerdict,
    DB_VERDICT_TTL_MS,
  } = mod;
  isFreshListenerGrantImpl = isFreshListenerGrant;
  const { computeQuotaState, FREE_DEFAULT_LIMIT } = await load('src/quota.js');

  console.log('\n[tests] A. dbIsPro projection (tier × subscription_status)\n');

  await test('pro + active → true', () => {
    assert.equal(
      isProFromProfileRow({ tier: 'pro', subscription_status: 'active' }),
      true,
    );
  });

  await test('free + none → false (the expired-sandbox row)', () => {
    assert.equal(
      isProFromProfileRow({ tier: 'free', subscription_status: 'none' }),
      false,
    );
  });

  await test('tier alone or status alone never grants', () => {
    for (const row of [
      { tier: 'pro', subscription_status: 'none' },
      { tier: 'free', subscription_status: 'active' },
      { tier: null, subscription_status: 'active' },
    ]) {
      assert.equal(isProFromProfileRow(row), false, JSON.stringify(row));
    }
  });

  console.log('\n[tests] B. executed truth table (rc flag × db verdict × grace)\n');

  await test('RC cached isPro=true + DB free/none, no fresh grant → false (revocation)', async () => {
    clearListenerGrants();
    clearEntitlementCache();
    const t = makeDeps({
      initialIsPro: true,
      readResult: okRow({ ever_paid: true }),
    });
    const verdict = await reconcileEntitlementFromDB('u1', () => true, t.deps);
    assert.equal(verdict, false);
    assert.deepEqual(t.calls.setPro, [false], 'must write the DB verdict');
    assert.deepEqual(t.calls.invalidate, ['u1'], 'profile cache must settle');
  });

  await test('RC cached isPro=false + DB pro/active → true (grant)', async () => {
    clearListenerGrants();
    clearEntitlementCache();
    const t = makeDeps({
      initialIsPro: false,
      readResult: okRow({ tier: 'pro', subscription_status: 'active' }),
    });
    const verdict = await reconcileEntitlementFromDB('u1', () => true, t.deps);
    assert.equal(verdict, true);
    assert.deepEqual(t.calls.setPro, [true]);
  });

  await test('readFailed → keep previous isPro, no write, no invalidation', async () => {
    clearListenerGrants();
    clearEntitlementCache();
    const t = makeDeps({
      initialIsPro: true,
      readResult: { status: 'error', message: 'offline' },
    });
    const verdict = await reconcileEntitlementFromDB('u1', () => true, t.deps);
    assert.equal(verdict, true);
    assert.deepEqual(t.calls.setPro, [], 'a failed read must not touch isPro');
    assert.deepEqual(t.calls.invalidate, []);
  });

  await test('unconfigured + missing-profile reads fail closed the same way', async () => {
    clearListenerGrants();
    clearEntitlementCache();
    for (const readResult of [
      { status: 'unconfigured' },
      { status: 'missing-profile' },
    ]) {
      const t = makeDeps({ initialIsPro: true, readResult });
      const verdict = await reconcileEntitlementFromDB('u1', () => true, t.deps);
      assert.equal(verdict, true, JSON.stringify(readResult));
      assert.deepEqual(t.calls.setPro, []);
    }
  });

  await test('an `ok` result with no row is treated as a failed read', async () => {
    clearListenerGrants();
    clearEntitlementCache();
    const t = makeDeps({
      initialIsPro: true,
      readResult: { status: 'ok', data: null },
    });
    const verdict = await reconcileEntitlementFromDB('u1', () => true, t.deps);
    assert.equal(verdict, true);
    assert.deepEqual(t.calls.setPro, []);
  });

  console.log('\n[tests] B2. bounded DB read + per-user verdict cache\n');

  await test('a hung profile read times out through withTimeout and keeps the verdict', async () => {
    clearListenerGrants();
    clearEntitlementCache();
    clearEntitlementCache();
    const t = makeDeps({
      initialIsPro: true,
      readResult: new Promise(() => {}),
      timeoutMs: 10,
    });
    const verdict = await reconcileEntitlementFromDB('u1', () => true, t.deps);
    assert.equal(verdict, true, 'a hung read must never hang the scan tap');
    assert.deepEqual(t.calls.setPro, []);
    assert.deepEqual(t.calls.invalidate, []);
  });

  await test('a failed read prefers the last DB-verified verdict over the stale store', async () => {
    clearListenerGrants();
    clearEntitlementCache();
    clearEntitlementCache();
    const first = makeDeps({
      readResult: okRow({ tier: 'pro', subscription_status: 'active' }),
    });
    assert.equal(await reconcileEntitlementFromDB('u1', () => true, first.deps), true);

    // Simulate a later cached RC value that regressed to false. The cached DB
    // verdict (true) must win over that raw store read.
    const second = makeDeps({
      initialIsPro: false,
      readResult: { status: 'error', message: 'offline' },
    });
    assert.equal(await reconcileEntitlementFromDB('u1', () => true, second.deps), true);
    assert.deepEqual(second.calls.setPro, [true]);
    assert.deepEqual(second.calls.invalidate, []);
  });

  await test('a revoking DB verdict stays authoritative on a later failed read', async () => {
    clearListenerGrants();
    clearEntitlementCache();
    clearEntitlementCache();
    const first = makeDeps({ initialIsPro: true, readResult: okRow() });
    assert.equal(await reconcileEntitlementFromDB('u1', () => true, first.deps), false);

    const second = makeDeps({
      initialIsPro: true,
      readResult: { status: 'error', message: 'offline' },
    });
    assert.equal(await reconcileEntitlementFromDB('u1', () => true, second.deps), false);
    assert.deepEqual(second.calls.setPro, [false]);
  });

  await test('clearEntitlementCache drops BOTH verdicts and grants on user change / sign-out', async () => {
    clearListenerGrants();
    clearEntitlementCache();
    const first = makeDeps({
      readResult: okRow({ tier: 'pro', subscription_status: 'active' }),
    });
    await reconcileEntitlementFromDB('u1', () => true, first.deps);
    recordListenerGrant('u1', NOW);
    clearEntitlementCache();
    const second = makeDeps({
      initialIsPro: false,
      readResult: { status: 'error', message: 'offline' },
    });
    assert.equal(await reconcileEntitlementFromDB('u1', () => true, second.deps), false);
    assert.deepEqual(second.calls.setPro, [], 'no stale verdict or grant may survive the clear');
  });

  await test('a cached verdict older than DB_VERDICT_TTL_MS is ignored on a failed read', async () => {
    clearListenerGrants();
    clearEntitlementCache();
    const first = makeDeps({
      now: NOW,
      readResult: okRow({ tier: 'pro', subscription_status: 'active' }),
    });
    assert.equal(await reconcileEntitlementFromDB('u1', () => true, first.deps), true);

    const second = makeDeps({
      initialIsPro: false,
      now: NOW + DB_VERDICT_TTL_MS + 1,
      readResult: { status: 'error', message: 'offline' },
    });
    assert.equal(
      await reconcileEntitlementFromDB('u1', () => true, second.deps),
      false,
      'a stale true verdict must not fabricate Pro after the TTL',
    );
    assert.deepEqual(second.calls.setPro, []);
  });

  await test('a fresh cached verdict is still used inside DB_VERDICT_TTL_MS', async () => {
    clearListenerGrants();
    clearEntitlementCache();
    const first = makeDeps({
      now: NOW,
      readResult: okRow({ tier: 'pro', subscription_status: 'active' }),
    });
    await reconcileEntitlementFromDB('u1', () => true, first.deps);

    const second = makeDeps({
      initialIsPro: false,
      now: NOW + DB_VERDICT_TTL_MS - 1,
      readResult: { status: 'error', message: 'offline' },
    });
    assert.equal(await reconcileEntitlementFromDB('u1', () => true, second.deps), true);
    assert.deepEqual(second.calls.setPro, [true]);
  });

  await test('markRevoked prevents a failed read from re-granting Pro', async () => {
    clearListenerGrants();
    clearEntitlementCache();
    const first = makeDeps({
      readResult: okRow({ tier: 'pro', subscription_status: 'active' }),
    });
    assert.equal(await reconcileEntitlementFromDB('u1', () => true, first.deps), true);

    // The RC listener reports isPro=false: it clears the pending grant AND
    // overwrites the cached verdict with a fresh false.
    recordListenerGrant('u1', NOW);
    clearListenerGrant('u1');
    markRevoked('u1', NOW);

    const second = makeDeps({
      initialIsPro: false,
      now: NOW + 1_000,
      readResult: { status: 'error', message: 'offline' },
    });
    assert.equal(await reconcileEntitlementFromDB('u1', () => true, second.deps), false);
    assert.deepEqual(second.calls.setPro, [], 'a failed read must not fabricate a grant');
  });

  console.log('\n[tests] B3. failed read preserves a fresh grant with no usable verdict cache\n');

  await test('fresh grant + failed read + NO verdict cache still returns Pro', async () => {
    clearListenerGrants();
    clearEntitlementCache();
    const t = makeDeps({
      initialIsPro: false,
      readResult: { status: 'error', message: 'offline' },
      freshGrantFor: () => true,
    });
    const verdict = await reconcileEntitlementFromDB('u1', () => true, t.deps);
    assert.equal(verdict, true, 'a fresh RC grant must survive a failed DB read');
  });

  await test('fresh grant + empty DB read + NO verdict cache still returns Pro', async () => {
    clearListenerGrants();
    clearEntitlementCache();
    const t = makeDeps({
      initialIsPro: false,
      readResult: { status: 'ok', data: null },
      freshGrantFor: () => true,
    });
    assert.equal(
      await reconcileEntitlementFromDB('u1', () => true, t.deps),
      true,
      'an empty row is not evidence of revocation',
    );
  });

  await test('fresh grant + timed-out DB read + NO verdict cache still returns Pro', async () => {
    clearListenerGrants();
    clearEntitlementCache();
    const t = makeDeps({
      initialIsPro: false,
      readResult: new Promise(() => {}),
      timeoutMs: 10,
      freshGrantFor: () => true,
    });
    assert.equal(
      await reconcileEntitlementFromDB('u1', () => true, t.deps),
      true,
      'a bounded timeout must not drop a fresh grant',
    );
  });

  await test('fresh grant + failed read + EXPIRED verdict cache still returns Pro', async () => {
    clearListenerGrants();
    clearEntitlementCache();
    const first = makeDeps({ now: NOW, readResult: okRow() });
    assert.equal(await reconcileEntitlementFromDB('u1', () => true, first.deps), false);
    const second = makeDeps({
      initialIsPro: false,
      now: NOW + DB_VERDICT_TTL_MS + 1,
      readResult: { status: 'error', message: 'offline' },
      freshGrantFor: () => true,
    });
    assert.equal(
      await reconcileEntitlementFromDB('u1', () => true, second.deps),
      true,
      'the grant must survive even after the cached verdict expires',
    );
  });

  await test('unchanged verdict and ever_paid skip the redundant profile invalidation', async () => {
    clearListenerGrants();
    clearEntitlementCache();
    const t = makeDeps({ readResult: okRow() }); // DB already free, store already free
    assert.equal(await reconcileEntitlementFromDB('u1', () => true, t.deps), false);
    assert.deepEqual(t.calls.setPro, [false]);
    assert.deepEqual(t.calls.setEverPaid, []);
    assert.deepEqual(t.calls.invalidate, [], 'no profile change means no invalidation');
  });

  console.log('\n[tests] B4. concurrent same-user reads, read-time verdict capture, cache clear\n');

  await test('concurrent same-user calls share one in-flight profile read', async () => {
    clearListenerGrants();
    clearEntitlementCache();
    let releaseRead;
    let readStarted = 0;
    const readGate = new Promise((resolve) => {
      releaseRead = resolve;
    });
    const t = makeDeps({
      initialIsPro: false,
      readResult: async (userId) => {
        readStarted += 1;
        assert.equal(userId, 'u1');
        await readGate;
        return okRow({ tier: 'pro', subscription_status: 'active' });
      },
    });

    const p1 = reconcileEntitlementFromDB('u1', () => true, t.deps);
    const p2 = reconcileEntitlementFromDB('u1', () => true, t.deps);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(readStarted, 1, 'same-user concurrent calls must not spawn extra reads');

    releaseRead();
    assert.deepEqual(await Promise.all([p1, p2]), [true, true]);
    assert.equal(readStarted, 1, 'settlement must not trigger a second read');
    assert.deepEqual(t.calls.setPro, [true], 'shared result must be applied once');
  });

  await test('verifiedAt reflects DB read completion, not downstream state writes', async () => {
    clearListenerGrants();
    clearEntitlementCache();
    const t = makeDeps({
      initialIsPro: false,
      readResult: async () => {
        t.setClock(NOW + 5_000);
        return okRow({ tier: 'pro', subscription_status: 'active' });
      },
      bumpClockOnSetPro: NOW + 20_000,
      bumpClockOnInvalidate: NOW + 20_000,
    });

    const verdict = await reconcileEntitlementFromDB('u1', () => true, t.deps);
    assert.equal(verdict, true);

    const fast = getFastPathVerdict('u1', NOW + 5_100);
    assert.ok(fast, 'verdict should be cached from read completion time');
    assert.equal(fast.verifiedAt, NOW + 5_000, 'verifiedAt must not be extended by slow writes');
    assert.equal(fast.isPro, true);

    assert.equal(
      getFastPathVerdict('u1', NOW + DB_VERDICT_TTL_MS + 5_001),
      null,
      'TTL must expire relative to read completion, not post-write time',
    );
  });

  await test('clearEntitlementCache allows a fresh read after a cached verdict', async () => {
    clearListenerGrants();
    clearEntitlementCache();
    let readCount = 0;
    const t = makeDeps({
      initialIsPro: false,
      readResult: async () => {
        readCount += 1;
        return readCount === 1
          ? okRow({ tier: 'pro', subscription_status: 'active' })
          : okRow({ tier: 'free', subscription_status: 'none' });
      },
    });

    assert.equal(await reconcileEntitlementFromDB('u1', () => true, t.deps), true);
    clearEntitlementCache();
    assert.equal(getFastPathVerdict('u1', NOW), null, 'cache clear must drop fast-path verdict');

    assert.equal(await reconcileEntitlementFromDB('u1', () => true, t.deps), false);
    assert.equal(readCount, 2, 'cache clear must allow a new authoritative read');
  });

  await test('clearEntitlementCache detaches an in-flight reconcile so the next call performs a new read', async () => {
    clearListenerGrants();
    clearEntitlementCache();
    let releaseOldRead;
    let releaseFreshRead;
    const oldReadGate = new Promise((resolve) => {
      releaseOldRead = resolve;
    });
    const freshReadGate = new Promise((resolve) => {
      releaseFreshRead = resolve;
    });
    let readCount = 0;
    const t = makeDeps({
      initialIsPro: false,
      readResult: async () => {
        readCount += 1;
        if (readCount === 1) {
          await oldReadGate;
          return okRow({ tier: 'pro', subscription_status: 'active' });
        }
        await freshReadGate;
        return okRow({ tier: 'free', subscription_status: 'none' });
      },
    });

    try {
      const stale = reconcileEntitlementFromDB('u1', () => true, t.deps);
      await Promise.resolve();
      assert.equal(readCount, 1, 'the first read must be executing before the clear');

      // Clear WHILE the first read is pending: the in-flight dedupe entry must
      // be detached, not only the already-settled verdicts.
      clearEntitlementCache();
      assert.equal(getFastPathVerdict('u1', NOW), null, 'no verdict may survive the clear');

      const fresh = reconcileEntitlementFromDB('u1', () => true, t.deps);
      await Promise.resolve();
      assert.equal(
        readCount,
        2,
        'the next reconcile must start a NEW read, not join the pending one',
      );

      releaseOldRead();
      assert.equal(await stale, true, 'the detached caller still gets its own read result');
      releaseFreshRead();
      assert.equal(await fresh, false, 'the new caller must get the new read result');

      assert.equal(readCount, 2, 'settling the reads must not spawn extra reads');
      assert.equal(t.store().isPro, false, 'the stale PRO result must not win after the clear');
      assert.equal(
        getFastPathVerdict('u1', NOW)?.isPro,
        false,
        'the fresh verdict must be the one the scan gate sees',
      );
    } finally {
      releaseOldRead();
      releaseFreshRead();
    }
  });

  console.log('\n[tests] B5. network-free verdict snapshot for the scan gate\n');

  await test('getFastPathVerdict is null with no cached verdict', async () => {
    clearListenerGrants();
    clearEntitlementCache();
    assert.equal(getFastPathVerdict('u1', NOW), null);
  });

  await test('getFastPathVerdict returns a fresh DB verdict without a read', async () => {
    clearListenerGrants();
    clearEntitlementCache();
    const t = makeDeps({
      now: NOW,
      readResult: okRow({ tier: 'pro', subscription_status: 'active' }),
    });
    await reconcileEntitlementFromDB('u1', () => true, t.deps);
    const fast = getFastPathVerdict('u1', NOW + 1_000);
    assert.ok(fast, 'a verified verdict must be reusable before its TTL');
    assert.equal(fast.isPro, true);
    assert.equal(fast.verifiedAt, NOW);
  });

  await test('getFastPathVerdict applies a fresh grant over a free DB verdict', async () => {
    clearListenerGrants();
    clearEntitlementCache();
    const t = makeDeps({ now: NOW, readResult: okRow() });
    await reconcileEntitlementFromDB('u1', () => true, t.deps);
    recordListenerGrant('u1', NOW + 1_000);
    const fast = getFastPathVerdict('u1', NOW + 1_000);
    assert.ok(fast);
    assert.equal(
      fast.isPro,
      true,
      'the fast path must keep the 60s grace, not revoke a fresh purchase',
    );
  });

  await test('getFastPathVerdict is null past the verdict TTL', async () => {
    clearListenerGrants();
    clearEntitlementCache();
    const t = makeDeps({
      now: NOW,
      readResult: okRow({ tier: 'pro', subscription_status: 'active' }),
    });
    await reconcileEntitlementFromDB('u1', () => true, t.deps);
    assert.equal(getFastPathVerdict('u1', NOW + DB_VERDICT_TTL_MS), null);
  });

  await test('getFastPathVerdict is null while a revoke signal is pending', async () => {
    clearListenerGrants();
    clearEntitlementCache();
    const t = makeDeps({
      now: NOW,
      readResult: okRow({ tier: 'pro', subscription_status: 'active' }),
    });
    await reconcileEntitlementFromDB('u1', () => true, t.deps);
    markRevoked('u1', NOW + 1_000);
    assert.equal(
      getFastPathVerdict('u1', NOW + 1_000),
      null,
      'a listener revoke forces a fresh DB check instead of the fast path',
    );
  });

  await test('a successful DB read clears the pending revoke signal', async () => {
    clearListenerGrants();
    clearEntitlementCache();
    const first = makeDeps({
      now: NOW,
      readResult: okRow({ tier: 'pro', subscription_status: 'active' }),
    });
    await reconcileEntitlementFromDB('u1', () => true, first.deps);
    markRevoked('u1', NOW + 1_000);
    assert.equal(getFastPathVerdict('u1', NOW + 1_000), null);

    const second = makeDeps({
      now: NOW + 2_000,
      readResult: okRow({ tier: 'free', subscription_status: 'none' }),
    });
    await reconcileEntitlementFromDB('u1', () => true, second.deps);
    const fast = getFastPathVerdict('u1', NOW + 3_000);
    assert.ok(fast, 'the DB verdict must re-enable the fast path');
    assert.equal(fast.isPro, false);
  });

  await test('fast-path verdicts are per-user', async () => {
    clearListenerGrants();
    clearEntitlementCache();
    const t = makeDeps({
      now: NOW,
      readResult: okRow({ tier: 'pro', subscription_status: 'active' }),
    });
    await reconcileEntitlementFromDB('u1', () => true, t.deps);
    assert.equal(getFastPathVerdict('u2', NOW), null);
  });

  await test('clearEntitlementCache drops a pending revoke signal', async () => {
    clearListenerGrants();
    clearEntitlementCache();
    const t = makeDeps({
      now: NOW,
      readResult: okRow({ tier: 'pro', subscription_status: 'active' }),
    });
    await reconcileEntitlementFromDB('u1', () => true, t.deps);
    markRevoked('u1', NOW + 1_000);
    clearEntitlementCache();
    assert.equal(
      getFastPathVerdict('u1', NOW + 1_000),
      null,
      'sign-out / user change must drop the verdict too, not just the signal',
    );
  });

  console.log('\n[tests] C. 60s listener-grant grace window\n');

  await test('fresh listener grant (<60s) on a free DB row keeps isPro=true', async () => {
    clearListenerGrants();
    clearEntitlementCache();
    recordListenerGrant('u1', NOW - 1_000);
    const t = makeDeps({ initialIsPro: true, readResult: okRow() });
    const verdict = await reconcileEntitlementFromDB('u1', () => true, t.deps);
    assert.equal(verdict, true, 'webhook lag must not revoke a fresh grant');
    assert.deepEqual(t.calls.setPro, [true]);
  });

  await test('stale grant (>60s) no longer protects the user', async () => {
    clearListenerGrants();
    clearEntitlementCache();
    recordListenerGrant('u1', NOW - 61_000);
    const t = makeDeps({ initialIsPro: true, readResult: okRow() });
    const verdict = await reconcileEntitlementFromDB('u1', () => true, t.deps);
    assert.equal(verdict, false);
    assert.deepEqual(t.calls.setPro, [false]);
  });

  await test('grants are per-user: u2 grant never protects u1', async () => {
    clearListenerGrants();
    clearEntitlementCache();
    recordListenerGrant('u2', NOW - 1_000);
    const t = makeDeps({ initialIsPro: true, readResult: okRow() });
    const verdict = await reconcileEntitlementFromDB('u1', () => true, t.deps);
    assert.equal(verdict, false);
  });

  await test('clearListenerGrants drops a pending grant (sign-out / user change)', async () => {
    clearListenerGrants();
    clearEntitlementCache();
    recordListenerGrant('u1', NOW - 1_000);
    clearListenerGrants();
    clearEntitlementCache();
    const t = makeDeps({ initialIsPro: true, readResult: okRow() });
    const verdict = await reconcileEntitlementFromDB('u1', () => true, t.deps);
    assert.equal(verdict, false);
  });

  await test('clearListenerGrant removes only the reporting user\'s stamp', async () => {
    clearListenerGrants();
    clearEntitlementCache();
    recordListenerGrant('u1', NOW - 1_000);
    recordListenerGrant('u2', NOW - 1_000);
    clearListenerGrant('u1');
    const u1 = makeDeps({ initialIsPro: true, readResult: okRow() });
    const u2 = makeDeps({ initialIsPro: true, readResult: okRow() });
    assert.equal(await reconcileEntitlementFromDB('u1', () => true, u1.deps), false);
    assert.equal(await reconcileEntitlementFromDB('u2', () => true, u2.deps), true);
  });

  await test('freshGrantFor is injected — no module-level map ordering needed', async () => {
    clearListenerGrants();
    clearEntitlementCache();
    const t = makeDeps({
      initialIsPro: true,
      readResult: okRow(),
      freshGrantFor: (userId, nowMs) => userId === 'u1' && nowMs === NOW,
    });
    const verdict = await reconcileEntitlementFromDB('u1', () => true, t.deps);
    assert.equal(verdict, true, 'injected grant seam must drive the decision');
    assert.deepEqual(t.calls.setPro, [true]);
  });

  console.log('\n[tests] D. monotonic ever_paid\n');

  await test('DB ever_paid=true seeds the store flag', async () => {
    clearListenerGrants();
    clearEntitlementCache();
    const t = makeDeps({
      initialEverPaid: false,
      readResult: okRow({ ever_paid: true }),
    });
    await reconcileEntitlementFromDB('u1', () => true, t.deps);
    assert.deepEqual(t.calls.setEverPaid, [true]);
    assert.equal(t.store().everPaid, true);
  });

  await test('DB ever_paid=false never clears an already-set flag', async () => {
    clearListenerGrants();
    clearEntitlementCache();
    const t = makeDeps({
      initialEverPaid: true,
      readResult: okRow({ ever_paid: false }),
    });
    await reconcileEntitlementFromDB('u1', () => true, t.deps);
    assert.deepEqual(t.calls.setEverPaid, []);
    assert.equal(t.store().everPaid, true);
  });

  console.log('\n[tests] E. overrides, race guard, purity\n');

  await test('isProOverrideEnabled → true with no profile read', async () => {
    clearListenerGrants();
    clearEntitlementCache();
    const t = makeDeps({
      readResult: okRow(),
      overrideFns: { isProOverrideEnabled: () => true },
    });
    const verdict = await reconcileEntitlementFromDB('u1', () => true, t.deps);
    assert.equal(verdict, true);
    assert.deepEqual(t.calls.reads, []);
    assert.deepEqual(t.calls.setPro, []);
  });

  await test('isProExpiredOverrideEnabled → false with no profile read', async () => {
    clearListenerGrants();
    clearEntitlementCache();
    const t = makeDeps({
      initialIsPro: true,
      readResult: okRow({ tier: 'pro', subscription_status: 'active' }),
      overrideFns: { isProExpiredOverrideEnabled: () => true },
    });
    const verdict = await reconcileEntitlementFromDB('u1', () => true, t.deps);
    assert.equal(verdict, false);
    assert.deepEqual(t.calls.reads, []);
    assert.deepEqual(t.calls.setPro, []);
  });

  await test('isCurrent=false after the read → no writes at all', async () => {
    clearListenerGrants();
    clearEntitlementCache();
    const t = makeDeps({
      initialIsPro: true,
      readResult: okRow({ tier: 'pro', subscription_status: 'active' }),
    });
    const verdict = await reconcileEntitlementFromDB('u1', () => false, t.deps);
    assert.equal(verdict, true, 'returns the untouched store value');
    assert.deepEqual(t.calls.setPro, []);
    assert.deepEqual(t.calls.invalidate, []);
  });

  await test('pure decision: DB revoke, ever_paid seed, and invalidation flags', () => {
    assert.deepEqual(
      decideReconciledEntitlement({
        readOk: true,
        dbIsPro: false,
        dbEverPaid: true,
        previousIsPro: true,
        previousEverPaid: false,
        freshGrant: false,
      }),
      {
        isPro: false,
        apply: true,
        setEverPaid: true,
        invalidate: true,
      },
    );
  });

  await test('pure decision: a fresh grant survives a free DB row', () => {
    assert.deepEqual(
      decideReconciledEntitlement({
        readOk: true,
        dbIsPro: false,
        dbEverPaid: false,
        previousIsPro: false,
        previousEverPaid: false,
        freshGrant: true,
      }),
      {
        isPro: true,
        apply: true,
        setEverPaid: false,
        invalidate: true,
      },
    );
  });

  console.log('\n[tests] F. reconciled flag drives the scan quota gate\n');

  await test('revoked verdict → cap applies at the free default (blocked at entry)', async () => {
    clearListenerGrants();
    clearEntitlementCache();
    clearEntitlementCache();
    const t = makeDeps({
      initialIsPro: true,
      readResult: okRow(),
    });
    const verdict = await reconcileEntitlementFromDB('u1', () => true, t.deps);
    const state = computeQuotaState(FREE_DEFAULT_LIMIT, FREE_DEFAULT_LIMIT, verdict);
    assert.equal(state.unlimited, false);
    assert.equal(state.exhausted, true);
    assert.equal(state.showUpgradeCta, true);
  });

  await test('grace-protected verdict → unlimited despite an exhausted free row', async () => {
    clearListenerGrants();
    clearEntitlementCache();
    clearEntitlementCache();
    recordListenerGrant('u1', NOW - 1_000);
    const t = makeDeps({ initialIsPro: true, readResult: okRow() });
    const verdict = await reconcileEntitlementFromDB('u1', () => true, t.deps);
    const state = computeQuotaState(FREE_DEFAULT_LIMIT, FREE_DEFAULT_LIMIT, verdict);
    assert.equal(state.unlimited, true);
    assert.equal(state.exhausted, false);
  });

  console.log('\n[tests] G. default deps / no cycles / no client-side tier writes\n');

  await test('defaultDeps writes the stubbed store and invalidates the profile key', async () => {
    const storeStub = await load('lib-stubs/use-pro-store.js');
    const queryStub = await load('lib-stubs/query-client.js');
    clearListenerGrants();
    clearEntitlementCache();
    clearEntitlementCache();
    storeStub.__store.isPro = true;
    storeStub.__store.everPaid = false;
    queryStub.__invalidations.length = 0;

    const verdict = await reconcileEntitlementFromDB('u-default');

    assert.equal(verdict, false, 'no deps override must still execute the real default path');
    assert.equal(storeStub.__store.isPro, false, 'the stubbed store must receive the DB verdict');
    assert.deepEqual(queryStub.__invalidations, [['profile', 'u-default']]);
  });

  await test('defaultDeps seeds ever_paid through the real store setter', async () => {
    const storeStub = await load('lib-stubs/use-pro-store.js');
    const featureStub = await load('lib-stubs/feature-access.js');
    clearListenerGrants();
    clearEntitlementCache();
    const previousEverPaid = featureStub.__profileRow.data.ever_paid;
    try {
      featureStub.__profileRow.data.ever_paid = true;
      storeStub.__store.isPro = false;
      storeStub.__store.everPaid = false;

      const verdict = await reconcileEntitlementFromDB('u-default-paid');

      assert.equal(verdict, false, 'an ever_paid row is still a free DB verdict');
      assert.equal(
        storeStub.__store.everPaid,
        true,
        'defaultDeps must call the store setter, not just write isPro',
      );
    } finally {
      featureStub.__profileRow.data.ever_paid = previousEverPaid;
    }
  });

  await test('reconcile module does not import the bootstrap or RPC tier writer', () => {
    assert.doesNotMatch(source, /identityBridgedRef/,
      'DB is authoritative without the RC bridge — no identity ref here');
    assert.doesNotMatch(source, /from ['"][^'"]*pro-bootstrap['"]/,
      'no import cycle: the reconciler must not import its caller');
    assert.doesNotMatch(source, /syncSubscriptionStatus/,
      'the client must never call the webhook-reserved RPC');
  });

  console.log('');
  if (failed > 0) {
    console.error(`[tests] ${failed} failed, ${passed} passed`);
    process.exitCode = 1;
  } else {
    console.log(`[tests] all ${passed} tests passed`);
  }
}

try {
  await run();
} catch (err) {
  console.error('[tests] harness crashed:', err);
  process.exitCode = 1;
} finally {
  rmSync(workdir, { recursive: true, force: true });
}
