#!/usr/bin/env node
/**
 * Node harness for the pro-bootstrap lifecycle wiring (pro-subscription
 * lifecycle fix — foreground entitlement refresh + expired-entitlement
 * dev override).
 *
 * The bootstrap (`ProBootstrap` in src/features/pro/pro-bootstrap.tsx) is
 * a pure side-effect carrier that renders null — it cannot EXECUTE in
 * plain node (React tree + the real react-native `AppState` native
 * module). Following the repo's F4 pattern (test-delete-account.mjs pins
 * _layout.tsx / delete-account.tsx by source), the contracts below pin
 * the MEANINGFUL TOKENS of the source with whitespace-flexible regexes,
 * and a cosmetic reformat does not disturb them. What they establish is
 * that those tokens are PRESENT and in the right ORDER — nothing more.
 * They do not follow control flow, so a token left in place behind a
 * statement that short-circuits first is invisible to them: an early
 * `return` ahead of the guards leaves this suite green even though the
 * feature never runs. Section 0 pins the mount for exactly that reason,
 * but any short-circuit after it is still undetectable. Read a pass here
 * as "written as specified", not "executes as specified".
 *
 * Sections:
 *
 *   0. MOUNTED — `_layout.tsx` imports `ProBootstrap` and renders it.
 *      Every contract below is inert if it never mounts.
 *
 *   1. FOREGROUND entitlement refresh (fix 1 — the real bug). The file
 *      must import `AppState` from react-native and subscribe to its
 *      'change' event. On transition to 'active' with a current user
 *      (`activeUserIdRef.current !== null`) and NO dev override, the
 *      handler must FIRST await the bounded DB reconciliation (the only
 *      gate for `isLoading`), then — only when the identity bridge
 *      succeeded (`identityBridgedRef.current === true`) — invalidate the
 *      SDK cache and read `getCustomerInfo()` bounded by
 *      `withTimeout(..., REVENUECAT_CALL_TIMEOUT_MS, ...)`, writing only
 *      `trialEndsAt` from that cached snapshot. The RC work must never sit
 *      in front of the DB verdict: a degraded SDK cannot delay a revocation.
 *      Every await re-checks the per-user race guard. The effect must clean
 *      up its subscription and be keyed on `[userId]` so the per-user race
 *      guard stays in scope.
 *
 *   2. EXPIRED-entitlement dev override (fix 2 — downgrade QA).
 *      pro-bootstrap.tsx must import `isProExpiredOverrideEnabled` from
 *      ./gate and:
 *        (a) short-circuit `resolveProSession` to
 *            `{ isPro: false, isLoading: false }` BEFORE any RevenueCat
 *            read, and
 *        (b) mirror the `isProOverrideEnabled` branch in the per-user
 *            effect (forcing the EXPIRED state) — with the expired branch
 *            ORDERED FIRST so that when BOTH overrides are set, the
 *            EXPIRED one wins (the conservative/locked default).
 *
 *   3. DON'T-TOUCH approvals — the existing `customerInfoUpdate` listener
 *      attachment (`attachCustomerInfoListener` + `setProEntitlement(snapshot)`),
 *      its false → true grant stamping, and the identity bridge's per-user
 *      scoping stay intact; only the ORDER of the gate work changed so the
 *      DB authority starts first and the RC trial-pill work is detached.
 *
 * The pure gate-function truth lives in test-pro-gating.mjs (compiled
 * execution); this harness is the source-wiring complement.
 *
 * Usage: node scripts/test-pro-bootstrap.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

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

async function run() {
  const bootstrapSource = readFileSync(
    join(root, 'src', 'features', 'pro', 'pro-bootstrap.tsx'),
    'utf8',
  );
  const layoutSource = readFileSync(
    join(root, 'src', 'app', '_layout.tsx'),
    'utf8',
  );

  // ---------------------------------------------------------------------
  // 0. The bootstrap is MOUNTED — everything below is inert if it isn't.
  // ---------------------------------------------------------------------
  console.log('\n[tests] pro-bootstrap — mounted in the app shell\n');

  await test('ProBootstrap is imported by _layout.tsx and rendered in the app shell', () => {
    assert.match(
      layoutSource,
      /import \{\s*ProBootstrap\s*\}\s*from '@\/features\/pro';/,
      '_layout.tsx must import ProBootstrap from the feature barrel',
    );
    assert.match(
      layoutSource,
      /<ProBootstrap\s*\/>/,
      '_layout.tsx must render <ProBootstrap />, or the wiring below never runs',
    );
  });

  // ---------------------------------------------------------------------
  // 1. Foreground entitlement refresh (fix 1).
  // ---------------------------------------------------------------------
  console.log('\n[tests] pro-bootstrap — foreground entitlement refresh (fix 1)\n');

  await test('AppState is imported from react-native', () => {
    assert.match(
      bootstrapSource,
      /import \{\s*AppState,\s*type AppStateStatus\s*\}\s*from 'react-native';/,
      'the bootstrap must import AppState + AppStateStatus from react-native',
    );
  });

  // Extract the foreground effect block: from the AppState 'change'
  // subscription to its effect close. It no longer needs the snapshot setter
  // (RC may only write trialEndsAt), so the dependency list is [userId].
  // Effect 1 of the file does NOT use AppState, so the first
  // AppState.addEventListener is unambiguously the foreground effect.
  const foregroundBlock =
    bootstrapSource.match(
      /AppState\.addEventListener\(\s*'change'\s*,([\s\S]*?)\}, \[userId\]\);/
    )?.[0] ?? '';

  await test('the foreground effect subscribes to AppState "change" and is keyed on [userId]', () => {
    assert.ok(
      foregroundBlock.length > 0,
      'the foreground effect must subscribe to AppState "change" and be keyed on [userId]',
    );
  });

  await test('reacts to the transition to "active" (and only "active")', () => {
    assert.match(foregroundBlock, /status\s*!==\s*'active'/, 'the handler must skip non-active transitions');
  });

  await test('fires only for a current user with no dev override; bridge gates RC work only', () => {
    assert.match(foregroundBlock, /activeUserIdRef\.current === null/, 'no work while signed out');
    // Match the two overrides CONJOINED in the top guard. The bridge ref is
    // deliberately absent here: DB reconciliation must still run when the RC
    // bridge degraded.
    assert.match(
      foregroundBlock,
      /isProOverrideEnabled\(\)\s*\|\|\s*isProExpiredOverrideEnabled\(\)/,
      'both dev overrides must block the whole refresh BEFORE it starts',
    );
    assert.match(
      foregroundBlock,
      /if \(identityBridgedRef\.current\) \{/,
      'the bridge ref may gate only the RC read/invalidation block',
    );
  });

  await test('re-reads CustomerInfo with the same bounded pattern as resolveProSession', () => {
    assert.match(
      foregroundBlock,
      /withTimeout\(\s*getCustomerInfo\(\),\s*REVENUECAT_CALL_TIMEOUT_MS,\s*null,?\s*\)/,
      'the foreground read must be bounded by withTimeout(..., REVENUECAT_CALL_TIMEOUT_MS, null)',
    );
  });

  await test('the foreground DB verdict runs before the bounded SDK cache invalidation', () => {
    assert.match(
      foregroundBlock,
      /withTimeout\(\s*invalidateCustomerInfoCache\(\),\s*REVENUECAT_CALL_TIMEOUT_MS,\s*undefined,?\s*\)/,
      'the optional trial-pill invalidation must stay bounded so a hung SDK call cannot leak',
    );
    const invalidatePos = foregroundBlock.indexOf('invalidateCustomerInfoCache()');
    const dbPos = foregroundBlock.indexOf('reconcileEntitlementFromDB(');
    assert.ok(
      invalidatePos >= 0 && dbPos >= 0 && dbPos < invalidatePos,
      'the authoritative DB read must not wait on the optional RC cache invalidation',
    );
  });

  await test('re-checks the per-user race guard AFTER the await', () => {
    assert.match(
      foregroundBlock,
      /activeUserIdRef\.current !== userId/,
      "a foreground refresh for user A must never write user B's store state",
    );
  });

  await test('writes ONLY trialEndsAt from the RC cache and clears isLoading', () => {
    assert.match(
      foregroundBlock,
      /useProStore\.setState\(\{\s*trialEndsAt:\s*info\?\.trialEndsAt \?\? null\s*\}\)/,
      'the cached RC snapshot may settle the trial pill but must not write isPro',
    );
    assert.match(
      foregroundBlock,
      /useProStore\.setState\(\{\s*isLoading: false\s*\}\)/,
      'isLoading must clear so the gate settles (locked on expiry, unlocked on renewal)',
    );
  });

  await test('cleans up the subscription on unmount', () => {
    assert.match(foregroundBlock, /return \(\) => subscription\.remove\(\)/, 'the effect must remove its AppState subscription');
  });

  // ---------------------------------------------------------------------
  // 2. Expired-entitlement dev override (fix 2).
  // ---------------------------------------------------------------------
  console.log('\n[tests] pro-bootstrap — expired-entitlement dev override (fix 2)\n');

  await test('pro-bootstrap imports the expired override from gate', () => {
    assert.match(
      bootstrapSource,
      /import \{\s*isProExpiredOverrideEnabled,\s*isProOverrideEnabled\s*\}\s*from '\.\/gate';/,
      'the bootstrap must import both override functions from ./gate',
    );
  });

  // Extract resolveProSession (from its declaration to the FIRST newline +
  // column-0 brace — every inner block closes indented, so this is
  // unambiguously the function end). Empty string when absent — the
  // per-contract tests below fail individually on it.
  const resolveBlock =
    bootstrapSource.match(/async function resolveProSession[\s\S]*?\n\}/)?.[0] ?? '';

  await test('resolveProSession exists', () => {
    assert.ok(
      resolveBlock.length > 0,
      'resolveProSession must exist (the per-user resolution entry point)',
    );
  });

  await test('resolveProSession short-circuits to the locked state BEFORE any RevenueCat work', () => {
    assert.ok(
      resolveBlock.includes('if (isProExpiredOverrideEnabled())'),
      'resolveProSession must check the expired override',
    );
    assert.match(
      resolveBlock,
      /useProStore\.setState\(\{\s*isPro: false,\s*isLoading: false\s*\}\)/,
      'the expired override must force { isPro: false, isLoading: false } so the gate locks',
    );
    assert.ok(
      resolveBlock.indexOf('isProExpiredOverrideEnabled()') <
        resolveBlock.indexOf('logInRevenueCat('),
      'the expired override must return BEFORE the RevenueCat identity bridge / customerInfo read',
    );
  });

  await test('the per-user effect mirrors the expired branch immediately after the ref sync and grant cleanup', () => {
    assert.match(
      bootstrapSource,
      /activeUserIdRef\.current = userId;\s*clearListenerGrants\(\);\s*if \(isProExpiredOverrideEnabled\(\)\)\s*\{/,
      'expected adjacency: ref sync → clearListenerGrants() → expired-override branch',
    );
  });

  await test('within the per-user effect the EXPIRED branch runs before the TRUE branch', () => {
    // Slice Effect 2 from the ref sync to its close (`}, [userId]);` appears
    // exactly once in the file — Effect 1 closes with [userId, setProEntitlement,
    // setEverPaid], the foreground effect with [userId, setProEntitlement]).
    const refSync = 'activeUserIdRef.current = userId;';
    const effectTail = '}, [userId]);';
    const refSyncPos = bootstrapSource.indexOf(refSync);
    const effectEndPos = bootstrapSource.indexOf(effectTail, refSyncPos);
    const effectBody =
      refSyncPos >= 0 && effectEndPos >= 0
        ? bootstrapSource.slice(refSyncPos, effectEndPos + effectTail.length)
        : '';
    assert.ok(
      effectBody.includes('if (isProExpiredOverrideEnabled())'),
      'the per-user effect must carry the expired-override branch',
    );
    assert.ok(
      effectBody.includes('if (isProOverrideEnabled())'),
      'the per-user effect must keep the true-override branch',
    );
    assert.ok(
      effectBody.indexOf('isProExpiredOverrideEnabled()') <
        effectBody.indexOf('isProOverrideEnabled()'),
      'when both overrides are set the EXPIRED one must win (it is the conservative/locked default)',
    );
  });

  // ---------------------------------------------------------------------
  // 3. Don't-touch approvals — the pre-existing paths stay intact.
  // ---------------------------------------------------------------------
  console.log('\n[tests] pro-bootstrap — pre-existing paths intact (approvals)\n');

  await test('the customerInfoUpdate listener is still attached and still writes the atomic snapshot', () => {
    assert.match(
      bootstrapSource,
      /attachCustomerInfoListener\(\(snapshot\) => \{/,
      'the SDK listener registration must survive the fix',
    );
    assert.match(
      bootstrapSource,
      /setProEntitlement\(snapshot\)/,
      'the listener must keep writing the full snapshot atomically',
    );
  });

  await test('resolveProSession keeps the identity bridge + DB-first resolution', () => {
    assert.match(resolveBlock, /logInRevenueCat\(userId\)/, 'the identity bridge must stay');
    assert.match(
      resolveBlock,
      /reconcileEntitlementFromDB\(userId, isCurrent\)/,
      'the DB-authoritative reconciliation must run on every per-user resolution',
    );
    assert.doesNotMatch(
      resolveBlock,
      /syncSubscriptionFromDB/,
      'the old ever_paid-only DB read must not survive — it never wrote isPro',
    );
  });

  // ---------------------------------------------------------------------
  // 3b. DB-authoritative revocation (sandbox-expiry fix).
  // ---------------------------------------------------------------------
  console.log('\n[tests] pro-bootstrap — DB-authoritative revocation wiring\n');

  const revenueCatSource = readFileSync(
    join(root, 'src', 'lib', 'revenuecat.ts'),
    'utf8',
  );
  const gateHookSource = readFileSync(
    join(root, 'src', 'features', 'home', 'hooks', 'useScanQuotaGate.ts'),
    'utf8',
  );

  await test('revenuecat.ts wraps the SDK invalidateCustomerInfoCache method', () => {
    // Verified against node_modules/react-native-purchases/dist/purchases.d.ts
    // (static invalidateCustomerInfoCache(): Promise<void> at line 524).
    assert.match(
      revenueCatSource,
      /export async function invalidateCustomerInfoCache\(\): Promise<void>/,
      'a safe wrapper must exist so the bootstrap can force a fresh RC read',
    );
    assert.match(
      revenueCatSource,
      /Purchases\.invalidateCustomerInfoCache\(\)/,
      'the wrapper must call the SDK method (not a no-op)',
    );
  });

  await test('foreground: DB verdict → bounded invalidate → RC read → trial-only write', () => {
    const invalidatePos = foregroundBlock.indexOf('invalidateCustomerInfoCache()');
    const readPos = foregroundBlock.indexOf('getCustomerInfo()');
    const trialWritePos = foregroundBlock.indexOf(
      'useProStore.setState({ trialEndsAt:',
    );
    const dbPos = foregroundBlock.indexOf('reconcileEntitlementFromDB(');
    assert.ok(dbPos >= 0, 'the foreground path must reconcile from DB');
    assert.ok(invalidatePos >= 0, 'the foreground path must still invalidate the RC cache');
    assert.ok(readPos >= 0, 'the foreground path must read CustomerInfo when bridged');
    assert.ok(trialWritePos >= 0, 'the RC snapshot must still settle the trial pill');
    assert.ok(
      dbPos < invalidatePos && invalidatePos < readPos && readPos < trialWritePos,
      `order must be DB verdict → invalidate → read → trial-only write (got ${dbPos}/${invalidatePos}/${readPos}/${trialWritePos})`,
    );
    assert.doesNotMatch(
      foregroundBlock,
      /setProEntitlement\s*\(/,
      'the cached RC read must never write isPro — a failed DB read would leave stale true in the store',
    );
    assert.doesNotMatch(
      foregroundBlock,
      /isPro:\s*info\?\.isPro/,
      'no RC-derived isPro may reach the store on the foreground path',
    );
  });

  await test('foreground: degraded bridge skips RC work but NEVER skips DB reconciliation', () => {
    const guard = foregroundBlock.slice(0, foregroundBlock.indexOf('void (async () =>'));
    assert.match(
      guard,
      /activeUserIdRef\.current === null\s*\|\|\s*isProOverrideEnabled\(\)\s*\|\|\s*isProExpiredOverrideEnabled\(\)/,
      'signed-out and both dev overrides must block the whole foreground refresh',
    );
    assert.doesNotMatch(
      guard,
      /identityBridgedRef\.current/,
      'the top guard must NOT block DB reconciliation when the RC bridge degraded',
    );
    assert.match(
      foregroundBlock,
      /if \(identityBridgedRef\.current\) \{/,
      'the bridge ref may only gate the RC read/invalidation block',
    );
    assert.equal(
      foregroundBlock.indexOf('reconcileEntitlementFromDB(') <
        foregroundBlock.indexOf('if (identityBridgedRef.current) {'),
      true,
      'DB reconciliation must run before — and outside — the bridged RC block',
    );
  });

  await test('foreground: no second profile invalidation after reconciliation', () => {
    assert.doesNotMatch(
      foregroundBlock,
      /invalidateQueries\s*\(\s*\{\s*queryKey:\s*queryKeys\.profile\(/,
      'the reconciler already invalidates on a successful read; a second unconditional call is redundant',
    );
  });

  await test('resolveProSession starts the DB verdict before any RC read and settles the gate on it', () => {
    const dbStartPos = resolveBlock.indexOf(
      'reconcileEntitlementFromDB(userId, isCurrent)',
    );
    const loginPos = resolveBlock.indexOf('logInRevenueCat(');
    const readPos = resolveBlock.indexOf('getCustomerInfo()');
    const awaitedPos = resolveBlock.indexOf('await reconciliation;');
    const loadingPos = resolveBlock.indexOf(
      'useProStore.setState({ isLoading: false })',
    );
    assert.ok(dbStartPos >= 0, 'the per-user path must start DB reconciliation');
    assert.ok(
      dbStartPos < loginPos && dbStartPos < readPos,
      'the DB authority must start before the optional RC identity bridge / cache read',
    );
    assert.ok(awaitedPos >= 0 && loadingPos > awaitedPos, 'isLoading must clear only after the bounded DB verdict lands');
    assert.match(
      resolveBlock,
      /const bridgedRcWork = \(async \(\) => \{[\s\S]*?logInRevenueCat\(userId\)[\s\S]*?getCustomerInfo\(\)[\s\S]*?\}\)\(\)/,
      'the trial-pill-only RC work must run in a detached async block, not in the gate path',
    );
    assert.match(
      resolveBlock,
      /void bridgedRcWork;/,
      'the RC trial-pill work must be explicitly detached after the verdict settles',
    );
    assert.doesNotMatch(
      resolveBlock,
      /isPro:\s*info\?\.isPro/,
      'a generic cached RC read must not grant Pro ahead of the DB verdict',
    );
  });

  await test('the customerInfoUpdate listener timestamps only real isPro grants for the active user', () => {
    const listenerBlock =
      bootstrapSource.match(
        /attachCustomerInfoListener\(\(snapshot\) => \{([\s\S]*?)\n\s*\}\);/,
      )?.[0] ?? '';
    assert.ok(listenerBlock.length > 0, 'the listener callback body must be present');
    assert.match(
      listenerBlock,
      /recordListenerGrant\(/,
      'a listener-driven isPro=true grant must be timestamped for the grace rule',
    );
    assert.match(
      listenerBlock,
      /if \(!snapshot\.isPro\)/,
      'a revoke callback must clear any pending grant',
    );
    assert.match(
      listenerBlock,
      /if \(!previous\) recordListenerGrant\(currentUserId\)/,
      'only a real false → true grant may be timestamped (never repeated true echoes)',
    );
    assert.doesNotMatch(
      resolveBlock,
      /recordListenerGrant/,
      'resolveProSession reads the SDK cache — it must NOT stamp a grant',
    );
  });

  await test('the listener stamps only false → true transitions and clears the stamp on false', () => {
    const listenerBlock =
      bootstrapSource.match(
        /attachCustomerInfoListener\(\(snapshot\) => \{([\s\S]*?)\n\s*\}\);/,
      )?.[0] ?? '';
    assert.match(
      listenerBlock,
      /lastListenerIsProRef\.current/,
      'the listener must track the previous isPro value per mounted session',
    );
    assert.match(
      listenerBlock,
      /if \(!snapshot\.isPro\)[\s\S]*?clearListenerGrant\(currentUserId\)/,
      'a false callback must clear the grant stamp before it can be revoked by the DB',
    );
    assert.match(
      listenerBlock,
      /if \(!previous\)[\s\S]*?recordListenerGrant\(currentUserId\)/,
      'only a real false → true transition may stamp a 60s grant',
    );
  });

  await test('grant timestamps are cleared on sign-out and on user change', () => {
    const refSync = 'activeUserIdRef.current = userId;';
    const effectTail = '}, [userId]);';
    const refSyncPos = bootstrapSource.indexOf(refSync);
    const effectEndPos = bootstrapSource.indexOf(effectTail, refSyncPos);
    const effectBody =
      refSyncPos >= 0 && effectEndPos >= 0
        ? bootstrapSource.slice(refSyncPos, effectEndPos + effectTail.length)
        : '';
    assert.ok(effectBody.length > 0, 'the per-user effect must be present');
    assert.match(
      effectBody,
      /clearListenerGrants\(\)/,
      'every userId change (including null/sign-out) must drop stale grant timestamps',
    );
  });

  await test('no client-side syncSubscriptionStatus write anywhere in the fixed paths', () => {
    for (const [name, source] of [
      ['pro-bootstrap.tsx', bootstrapSource],
      ['revenuecat.ts', revenueCatSource],
      ['useScanQuotaGate.ts', gateHookSource],
    ]) {
      assert.doesNotMatch(
        source,
        /syncSubscriptionStatus/,
        `${name} must not call the webhook-reserved RPC`,
      );
    }
  });

  // ---------------------------------------------------------------------
  // 4. Profile header chip and subscription row agree on ONE entitlement.
  // ---------------------------------------------------------------------
  // The reported bug: the chip and the subscription row are two halves of a
  // single screen, and they contradicted each other. The row reads
  // `useProEntitlement().isPro`; the chip read `user.tier` — the
  // webhook-painted DB column. A server tier that lags the live entitlement
  // (granted but never revoked: the webhook painted 'pro', the SDK says free)
  // let the chip say "Suscripción active" above a row that said "free". The
  // chip now tiers from the SAME entitlement, so the halves cannot disagree,
  // and it is OMITTED while the entitlement resolves (the store seeds
  // `isLoading: true`) so a Pro user never flashes "free".
  console.log('\n[tests] profile — header chip and subscription row agree\n');

  const profileSource = readFileSync(
    join(root, 'src', 'app', '(tabs)', 'profile.tsx'),
    'utf8',
  );
  const profileHeaderSource = readFileSync(
    join(root, 'src', 'components', 'organisms', 'ProfileHeader', 'ProfileHeader.tsx'),
    'utf8',
  );

  await test('the header chip tiers from the entitlement, never from the DB user.tier', () => {
    // Negative: the DB-tier source — including the optional-chained form a
    // future fixer might reach for — must never come back. The DB tier lags
    // the live entitlement and is what let the two halves contradict.
    assert.doesNotMatch(
      profileSource,
      /tier=\{\s*user\??\.tier\s*\}/,
      'the chip must not read the DB tier — it can lag the entitlement and contradict the row',
    );
    // Positive: the prop that drives the chip references the SAME `isPro` the
    // row branches on. Token match (not the whole expression) so a benign
    // reformat does not break the pin while a source change does.
    assert.match(
      profileSource,
      /tier=\{[^}]*isPro[^}]*\}/,
      'the chip tier must derive from isPro — the same entitlement the status row reads',
    );
    assert.match(
      profileSource,
      /tier=\{[^}]*proLoading[^}]*\}/,
      'the chip must be omitted while the entitlement resolves, so a Pro user never flashes "free"',
    );
    assert.match(
      profileSource,
      /useProEntitlement\(\)/,
      'both halves must resolve the plan through the one entitlement hook',
    );
  });

  await test('ProfileHeader omits the chip entirely when tier is not provided', () => {
    assert.match(
      profileHeaderSource,
      /tier\?:\s*'free'\s*\|\s*'pro'/,
      'tier must be optional so the chip can be hidden while the entitlement resolves',
    );
    assert.match(
      profileHeaderSource,
      /\{\s*tier\s*\?/,
      'the chip must render only when tier is provided (no "free" chip while loading)',
    );
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
}