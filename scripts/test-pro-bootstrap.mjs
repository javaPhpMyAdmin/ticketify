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
 *      (`activeUserIdRef.current !== null`), a successfully-bridged
 *      identity (`identityBridgedRef.current === true` — which also
 *      implies the SDK is available AND configured, since the bridge only
 *      succeeds after `logInRevenueCat`, which requires the native module
 *      + API key + configure) and NO dev override, the handler must
 *      re-read `getCustomerInfo()` bounded by
 *      `withTimeout(..., REVENUECAT_CALL_TIMEOUT_MS, null)`, re-check the
 *      per-user race guard AFTER the await, write the store through the
 *      atomic `setProEntitlement` snapshot setter (isPro + trialEndsAt in
 *      one set) plus `isLoading: false`, and invalidate the profile query
 *      (ref-guarded) so the header tier settles. The effect must clean up
 *      its subscription and be keyed on `[userId, setProEntitlement]` so
 *      the per-user race guard stays in scope.
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
 *      attachment (`attachCustomerInfoListener` + `setProEntitlement(snapshot)`)
 *      and `resolveProSession`'s identity bridge + DB-first resolution
 *      stay intact; the fix only ADDS the foreground path.
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
  // subscription to its effect close (keyed on [userId, setProEntitlement]).
  // Effect 1 of the file ends with `}, [userId, setProEntitlement, setEverPaid]);`
  // and does NOT use AppState, so the first AppState.addEventListener is
  // unambiguously the foreground effect. Empty string when absent — the
  // per-contract tests below fail individually on it.
  const foregroundBlock =
    bootstrapSource.match(
      /AppState\.addEventListener\(\s*'change'\s*,([\s\S]*?)\}, \[userId, setProEntitlement\]\);/
    )?.[0] ?? '';

  await test('the foreground effect subscribes to AppState "change" and is keyed on [userId, setProEntitlement]', () => {
    assert.ok(
      foregroundBlock.length > 0,
      'the foreground effect must subscribe to AppState "change" and be keyed on [userId, setProEntitlement]',
    );
  });

  await test('reacts to the transition to "active" (and only "active")', () => {
    assert.match(foregroundBlock, /status\s*!==\s*'active'/, 'the handler must skip non-active transitions');
  });

  await test('fires only for a current, bridged user with no dev override', () => {
    // The four guards ALL have to pass before the SDK read runs. The
    // identityBridgedRef guard also implies "SDK available/configured":
    // the bridge only succeeds after logInRevenueCat, which requires the
    // native module + API key + configure (see revenuecat.ts).
    assert.match(foregroundBlock, /activeUserIdRef\.current === null/, 'no read while signed out');
    assert.match(foregroundBlock, /!identityBridgedRef\.current/, 'only a bridged identity may read');
    // Match the two overrides CONJOINED, which only the pre-read guard is.
    // The post-await re-check (`if (isProOverrideEnabled()) return;`) carries
    // no `||`, so a bare /isProOverrideEnabled\(\)/ is satisfied by it too and
    // pins neither this test's name nor the guard it describes.
    assert.match(
      foregroundBlock,
      /isProOverrideEnabled\(\)\s*\|\|\s*isProExpiredOverrideEnabled\(\)/,
      'both dev overrides must block the read BEFORE it starts',
    );
    assert.match(foregroundBlock, /isProExpiredOverrideEnabled\(\)/, 'the expired dev override also blocks the read');
  });

  await test('re-reads CustomerInfo with the same bounded pattern as resolveProSession', () => {
    assert.match(
      foregroundBlock,
      /withTimeout\(\s*getCustomerInfo\(\),\s*REVENUECAT_CALL_TIMEOUT_MS,\s*null,?\s*\)/,
      'the foreground read must be bounded by withTimeout(..., REVENUECAT_CALL_TIMEOUT_MS, null)',
    );
  });

  await test('re-checks the per-user race guard AFTER the await', () => {
    assert.match(
      foregroundBlock,
      /activeUserIdRef\.current !== userId/,
      "a foreground refresh for user A must never write user B's store state",
    );
  });

  await test('writes the store through the atomic setProEntitlement snapshot setter and clears isLoading', () => {
    // Slice C: the snapshot setter writes isPro + trialEndsAt in ONE set so
    // the gate and the profile pill never disagree mid-update.
    assert.match(
      foregroundBlock,
      /setProEntitlement\(\s*\{\s*isPro:\s*info\?\.isPro \?\? false/,
      'isPro must derive from the re-read snapshot (null → free default)',
    );
    assert.match(
      foregroundBlock,
      /trialEndsAt:\s*info\?\.trialEndsAt \?\? null/,
      'trialEndsAt must be written atomically with isPro',
    );
    assert.match(
      foregroundBlock,
      /useProStore\.setState\(\{\s*isLoading: false\s*\}\)/,
      'isLoading must clear so the gate settles (locked on expiry, unlocked on renewal)',
    );
  });

  await test('invalidates the profile query (ref-guarded) so the header tier settles', () => {
    assert.match(
      foregroundBlock,
      /queryClient\.invalidateQueries\(\s*\{\s*queryKey:\s*queryKeys\.profile\(userId\),?\s*\}\s*\)/,
      'the profile query must be invalidated so the header reflects the new tier',
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

  await test('the per-user effect mirrors the expired branch right after the ref sync (expired wins when both are set)', () => {
    assert.match(
      bootstrapSource,
      /activeUserIdRef\.current = userId;\s*if \(isProExpiredOverrideEnabled\(\)\)\s*\{/,
      "the per-user effect must check the expired override immediately after syncing the ref",
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
      /syncSubscriptionFromDB\(userId, isCurrent\)/,
      'the DB-first subscription sync must stay',
    );
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