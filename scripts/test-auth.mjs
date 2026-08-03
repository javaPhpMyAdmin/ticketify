#!/usr/bin/env node
/**
 * Dependency-free node harness for the user-auth slice (reliability re-gate).
 *
 * The auth modules are TS-only and pull in native packages (expo-web-browser,
 * expo-linking, SecureStore) that cannot load in plain node. This harness:
 *
 *   1. Compiles the modules under test PLUS hand-written test doubles
 *      (scripts/test-stubs/) into a temp directory with an isolated tsconfig
 *      that remaps the native/backend imports to the doubles.
 *   2. Imports the compiled CommonJS output.
 *   3. Runs behavioral tests against the real store/helpers with the doubles'
 *      behavior swapped per test through `__set*` seams.
 *
 * The double modules are type-checked against the compiled production code
 * (they implement the exact client surface the app calls), so a signature
 * drift between the app and its tests fails the typecheck here.
 *
 * Usage: pnpm test:auth
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const tscBin = require.resolve('typescript/bin/tsc');
const harnessConfig = join(__dirname, 'tsconfig.auth-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'auth-test-'));
const outDir = join(workdir, 'out');

const MODE_KEY = 'ticketify.auth-mode';
const FAKE_SESSION = {
  access_token: 'at-fake',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: 4_999_999_999,
  refresh_token: 'rt-fake',
  user: {
    id: 'user-1',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'user@example.com',
  },
};

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

/**
 * Mirrors the harness tsconfig's `paths` at runtime: tsc type-checks against
 * the remapped files but emits the ORIGINAL specifier, so plain node cannot
 * resolve `@/…` (or the stubbed expo packages) in the compiled CommonJS
 * output. The hook rewrites exactly those specifiers to their compiled
 * locations and passes everything else (zustand, react, …) through untouched.
 */
function installRequireHook() {
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function rewrittenResolve(request, ...rest) {
    if (request === '@/lib/supabase') {
      request = join(outDir, 'scripts', 'test-stubs', 'supabase.js');
    } else if (request === '@/lib/supabase/storage-adapter') {
      request = join(outDir, 'scripts', 'test-stubs', 'storage-adapter.js');
    } else if (request === 'expo-web-browser') {
      request = join(outDir, 'scripts', 'test-stubs', 'web-browser.js');
    } else if (request === 'expo-linking') {
      request = join(outDir, 'scripts', 'test-stubs', 'linking.js');
    } else if (request.startsWith('@/')) {
      request = join(outDir, 'src', request.slice(2));
    }
    return originalResolve.call(this, request, ...rest);
  };
}

async function compile() {
  execFileSync(process.execPath, [tscBin, '-p', harnessConfig, '--outDir', outDir], {
    cwd: root,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
}

function load(mod) {
  return import(pathToFileURL(join(outDir, mod)).href);
}

/** Resets every double and both stores to their initial state. */
function resetAll() {
  supabaseMod.__resetSupabaseBehavior();
  storageMod.__resetStorage();
  browserMod.__setNextBrowserResult({ type: 'cancel' });
  storeMod.__setAuthRestoreTimeout(10_000);
  storeMod.useSessionStore.setState({ session: null, isBootstrapping: true });
  settingsMod.useSettingsStore.setState({ mode: 'demo' });
}

let storeMod;
let settingsMod;
let oauthMod;
let resetMod;
let modeMod;
let registryMod;
let supabaseMod;
let storageMod;
let browserMod;

async function run() {
  console.log('\n[tests] compiling modules with isolated tsconfig…');
  await compile();
  installRequireHook();
  console.log('[tests] loading compiled modules…');

  storeMod = await load('src/features/auth/use-session-store.js');
  settingsMod = await load('src/stores/use-settings-store.js');
  oauthMod = await load('src/lib/auth/oauth.js');
  resetMod = await load('src/lib/auth/reset-exchange.js');
  modeMod = await load('src/lib/auth/auth-mode-storage.js');
  registryMod = await load('src/lib/auth/auth-listener-registry.js');
  supabaseMod = await load('scripts/test-stubs/supabase.js');
  storageMod = await load('scripts/test-stubs/storage-adapter.js');
  browserMod = await load('scripts/test-stubs/web-browser.js');

  console.log('\n[tests] auth-mode persistence\n');

  await test('load: nothing persisted → null (demo default)', async () => {
    resetAll();
    assert.equal(await modeMod.loadPersistedAuthMode(), null);
  });

  await test('load: seeded "authenticated" round-trips', async () => {
    resetAll();
    storageMod.__seedStoredValue(MODE_KEY, 'authenticated');
    assert.equal(await modeMod.loadPersistedAuthMode(), 'authenticated');
  });

  await test('load: corrupt value → null, never leaks into mode', async () => {
    resetAll();
    storageMod.__seedStoredValue(MODE_KEY, '{"role":"admin"}');
    assert.equal(await modeMod.loadPersistedAuthMode(), null);
  });

  await test('save writes through the same adapter load reads', async () => {
    resetAll();
    await modeMod.savePersistedAuthMode('authenticated');
    assert.equal(storageMod.__readStoredValue(MODE_KEY), 'authenticated');
    assert.equal(await modeMod.loadPersistedAuthMode(), 'authenticated');
  });

  console.log('\n[tests] session restore\n');

  await test('fresh install: no session, nothing persisted → demo, gate opens', async () => {
    resetAll();
    await storeMod.useSessionStore.getState().restore();
    const s = storeMod.useSessionStore.getState();
    assert.equal(s.session, null);
    assert.equal(s.isBootstrapping, false);
    assert.equal(settingsMod.useSettingsStore.getState().mode, 'demo');
  });

  await test('signed-out user relaunch: persisted mode keeps sign-in gate', async () => {
    resetAll();
    storageMod.__seedStoredValue(MODE_KEY, 'authenticated');
    await storeMod.useSessionStore.getState().restore();
    const s = storeMod.useSessionStore.getState();
    assert.equal(s.session, null);
    assert.equal(s.isBootstrapping, false);
    // The gate shows sign-in instead of silently dropping into demo fixtures.
    assert.equal(settingsMod.useSettingsStore.getState().mode, 'authenticated');
  });

  await test('valid stored session: session set, mode promoted and persisted', async () => {
    resetAll();
    supabaseMod.__setSupabaseBehavior({
      getSession: async () => ({ data: { session: FAKE_SESSION }, error: null }),
    });
    await storeMod.useSessionStore.getState().restore();
    const s = storeMod.useSessionStore.getState();
    assert.equal(s.session, FAKE_SESSION);
    assert.equal(s.isBootstrapping, false);
    assert.equal(settingsMod.useSettingsStore.getState().mode, 'authenticated');
    assert.equal(storageMod.__readStoredValue(MODE_KEY), 'authenticated');
  });

  await test('expired stored session: cleared, sign-in gate kept, storage best-effort', async () => {
    resetAll();
    let signedOut = 0;
    supabaseMod.__setSupabaseBehavior({
      getSession: async () => ({
        data: { session: null },
        error: { message: 'invalid refresh token' },
      }),
      signOut: async () => {
        signedOut += 1;
        return { error: null };
      },
    });
    await storeMod.useSessionStore.getState().restore();
    const s = storeMod.useSessionStore.getState();
    assert.equal(s.session, null);
    assert.equal(s.isBootstrapping, false);
    assert.equal(settingsMod.useSettingsStore.getState().mode, 'authenticated');
    assert.equal(signedOut, 1);
  });

  await test('storage/network failure: resolves safely, never forces demo', async () => {
    resetAll();
    storageMod.__seedStoredValue(MODE_KEY, 'authenticated');
    supabaseMod.__setSupabaseBehavior({
      getSession: async () => {
        throw new Error('SecureStore backend exploded');
      },
    });
    await storeMod.useSessionStore.getState().restore();
    const s = storeMod.useSessionStore.getState();
    assert.equal(s.session, null);
    assert.equal(s.isBootstrapping, false);
    // Previously authenticated user is NOT dropped into demo fixtures.
    assert.equal(settingsMod.useSettingsStore.getState().mode, 'authenticated');
  });

  await test('hung storage backend: timeout settles bootstrap with safe state', async () => {
    resetAll();
    storageMod.__seedStoredValue(MODE_KEY, 'authenticated');
    storageMod.__setStorageHang(true);
    storeMod.__setAuthRestoreTimeout(25);
    await storeMod.useSessionStore.getState().restore();
    const s = storeMod.useSessionStore.getState();
    assert.equal(s.isBootstrapping, false);
    // Mode was reconciled BEFORE the hang: sign-in gate survives the timeout.
    assert.equal(settingsMod.useSettingsStore.getState().mode, 'authenticated');
  });

  await test('hung mode read: settle keeps the sign-in gate, never forces demo', async () => {
    resetAll();
    storageMod.__setStorageReadHang(true);
    storeMod.__setAuthRestoreTimeout(25);
    await storeMod.useSessionStore.getState().restore();
    const s = storeMod.useSessionStore.getState();
    assert.equal(s.session, null);
    assert.equal(s.isBootstrapping, false);
    // The mode is unknowable, so the only safe gate is 'authenticated':
    // an existing user must NEVER land in demo fixtures because a storage
    // read hung (W-2). No demo path, no 'guest' path.
    assert.equal(settingsMod.useSettingsStore.getState().mode, 'authenticated');
    assert.equal(storeMod.__lastModeReadOutcome(), 'timed-out');
  });

  console.log('\n[tests] sign-up enumeration guard\n');

  await test('duplicate account: same confirmation state as a fresh sign-up', async () => {
    resetAll();
    supabaseMod.__setSupabaseBehavior({
      signUp: async () => ({
        data: { session: null },
        error: { message: 'User already registered', code: 'user_already_exists' },
      }),
    });
    const result = await storeMod.useSessionStore.getState().signUpWithEmail(
      'user@example.com',
      'password-123',
    );
    assert.deepEqual(result, { error: null, needsEmailConfirmation: true });
  });

  await test('duplicate account detected by bare code (no message)', async () => {
    resetAll();
    supabaseMod.__setSupabaseBehavior({
      signUp: async () => ({
        data: { session: null },
        error: { code: 'email_exists' },
      }),
    });
    const result = await storeMod.useSessionStore.getState().signUpWithEmail(
      'user@example.com',
      'password-123',
    );
    assert.deepEqual(result, { error: null, needsEmailConfirmation: true });
  });

  await test('other failure: generic copy, raw GoTrue message never surfaced', async () => {
    resetAll();
    supabaseMod.__setSupabaseBehavior({
      signUp: async () => ({
        data: { session: null },
        error: { message: 'Password should be at least 8 characters' },
      }),
    });
    const result = await storeMod.useSessionStore.getState().signUpWithEmail(
      'user@example.com',
      'short',
    );
    assert.equal(result.needsEmailConfirmation, false);
    assert.equal(result.error, 'Sign-up failed. Please try again.');
  });

  await test('account created, confirmation enabled: no session → confirmation state', async () => {
    resetAll();
    const result = await storeMod.useSessionStore.getState().signUpWithEmail(
      'new@example.com',
      'password-123',
    );
    assert.deepEqual(result, { error: null, needsEmailConfirmation: true });
  });

  await test('account created, confirmation disabled: session issued', async () => {
    resetAll();
    supabaseMod.__setSupabaseBehavior({
      signUp: async () => ({ data: { session: FAKE_SESSION }, error: null }),
    });
    const result = await storeMod.useSessionStore.getState().signUpWithEmail(
      'new@example.com',
      'password-123',
    );
    assert.deepEqual(result, { error: null, needsEmailConfirmation: false });
  });

  console.log('\n[tests] OAuth PKCE helper\n');

  await test('success: exchanges code without flow id when callback has none', async () => {
    resetAll();
    const exchanges = [];
    supabaseMod.__setSupabaseBehavior({
      exchangeCodeForSession: async (code, options) => {
        exchanges.push({ code, options });
        return { data: { session: FAKE_SESSION }, error: null };
      },
    });
    browserMod.__setNextBrowserResult({
      type: 'success',
      url: 'ticketify://oauth?code=abc123',
    });
    const result = await oauthMod.signInWithProvider('google');
    assert.deepEqual(result, { cancelled: false, error: null });
    assert.equal(exchanges.length, 1);
    assert.equal(exchanges[0].code, 'abc123');
    assert.equal(exchanges[0].options, undefined);
  });

  await test('success: passes sb_flow_id through to the exchange', async () => {
    resetAll();
    const exchanges = [];
    supabaseMod.__setSupabaseBehavior({
      exchangeCodeForSession: async (code, options) => {
        exchanges.push({ code, options });
        return { data: { session: FAKE_SESSION }, error: null };
      },
    });
    browserMod.__setNextBrowserResult({
      type: 'success',
      url: 'ticketify://oauth?code=abc123&sb_flow_id=flow-42',
    });
    const result = await oauthMod.signInWithProvider('google');
    assert.deepEqual(result, { cancelled: false, error: null });
    assert.deepEqual(exchanges[0], { code: 'abc123', options: { flowId: 'flow-42' } });
  });

  await test('flowId from the signInWithOAuth result reaches the exchange', async () => {
    resetAll();
    const exchanges = [];
    supabaseMod.__setSupabaseBehavior({
      signInWithOAuth: async () => ({
        data: { url: 'https://auth.example/authorize', flowId: 'flow-returned' },
        error: null,
      }),
      exchangeCodeForSession: async (code, options) => {
        exchanges.push({ code, options });
        return { data: { session: FAKE_SESSION }, error: null };
      },
    });
    browserMod.__setNextBrowserResult({
      type: 'success',
      url: 'ticketify://oauth?code=abc123',
    });
    const result = await oauthMod.signInWithProvider('google');
    assert.deepEqual(result, { cancelled: false, error: null });
    assert.deepEqual(exchanges[0], {
      code: 'abc123',
      options: { flowId: 'flow-returned' },
    });
  });

  await test('returned flowId wins over the callback URL param', async () => {
    resetAll();
    const exchanges = [];
    supabaseMod.__setSupabaseBehavior({
      signInWithOAuth: async () => ({
        data: { url: 'https://auth.example/authorize', flowId: 'flow-returned' },
        error: null,
      }),
      exchangeCodeForSession: async (code, options) => {
        exchanges.push({ code, options });
        return { data: { session: FAKE_SESSION }, error: null };
      },
    });
    browserMod.__setNextBrowserResult({
      type: 'success',
      url: 'ticketify://oauth?code=abc123&sb_flow_id=flow-from-url',
    });
    const result = await oauthMod.signInWithProvider('google');
    assert.deepEqual(result, { cancelled: false, error: null });
    assert.deepEqual(exchanges[0], {
      code: 'abc123',
      options: { flowId: 'flow-returned' },
    });
  });

  await test('cancel: reported as cancelled, no exchange, no error', async () => {
    resetAll();
    let exchanged = false;
    supabaseMod.__setSupabaseBehavior({
      exchangeCodeForSession: async () => {
        exchanged = true;
        return { data: { session: null }, error: null };
      },
    });
    browserMod.__setNextBrowserResult({ type: 'cancel' });
    const result = await oauthMod.signInWithProvider('google');
    assert.deepEqual(result, { cancelled: true, error: null });
    assert.equal(exchanged, false);
  });

  await test('dismiss/locked/opened: real error, never a silent cancellation', async () => {
    resetAll();
    browserMod.__setNextBrowserResult({ type: 'dismiss' });
    const result = await oauthMod.signInWithProvider('google');
    assert.equal(result.cancelled, false);
    assert.match(result.error, /interrupted/i);
  });

  await test('callback without a code: readable error', async () => {
    resetAll();
    browserMod.__setNextBrowserResult({
      type: 'success',
      url: 'ticketify://oauth?error=access_denied',
    });
    const result = await oauthMod.signInWithProvider('apple');
    assert.equal(result.cancelled, false);
    assert.match(result.error, /missing its code/i);
  });

  await test('exchange error: surfaced message, no session', async () => {
    resetAll();
    browserMod.__setNextBrowserResult({
      type: 'success',
      url: 'ticketify://oauth?code=bad',
    });
    supabaseMod.__setSupabaseBehavior({
      exchangeCodeForSession: async () => ({
        data: { session: null },
        error: { message: 'Invalid state: PKCE flow id not found' },
      }),
    });
    const result = await oauthMod.signInWithProvider('google');
    assert.equal(result.cancelled, false);
    assert.equal(result.error, 'Invalid state: PKCE flow id not found');
  });

  await test('provider start failure: error surfaced', async () => {
    resetAll();
    supabaseMod.__setSupabaseBehavior({
      signInWithOAuth: async () => ({
        data: { url: null },
        error: { message: 'Unsupported provider' },
      }),
    });
    const result = await oauthMod.signInWithProvider('google');
    assert.equal(result.cancelled, false);
    assert.equal(result.error, 'Unsupported provider');
  });

  await test('missing authorize url: readable error', async () => {
    resetAll();
    supabaseMod.__setSupabaseBehavior({
      signInWithOAuth: async () => ({ data: { url: null }, error: null }),
    });
    const result = await oauthMod.signInWithProvider('google');
    assert.equal(result.cancelled, false);
    assert.match(result.error, /could not be started/i);
  });

  await test('thrown network error: readable message, stays on sign-in', async () => {
    resetAll();
    supabaseMod.__setSupabaseBehavior({
      signInWithOAuth: async () => {
        throw new Error('Network request failed');
      },
    });
    const result = await oauthMod.signInWithProvider('google');
    assert.equal(result.cancelled, false);
    assert.equal(result.error, 'Network request failed');
  });

  console.log('\n[tests] password-recovery exchange\n');

  await test('resolved without a session: invalid link (never rejects)', async () => {
    resetAll();
    // Default double behavior: { data: { session: null }, error: null }.
    const result = await resetMod.exchangeRecoveryCode('stale-code');
    assert.deepEqual(result, { ok: false });
  });

  await test('resolved with an error: invalid link', async () => {
    resetAll();
    supabaseMod.__setSupabaseBehavior({
      exchangeCodeForSession: async () => ({
        data: { session: null },
        error: { message: 'Invalid code' },
      }),
    });
    const result = await resetMod.exchangeRecoveryCode('bad-code');
    assert.deepEqual(result, { ok: false });
  });

  await test('valid code: ok, and the flow id reaches the exchange', async () => {
    resetAll();
    const exchanges = [];
    supabaseMod.__setSupabaseBehavior({
      exchangeCodeForSession: async (code, options) => {
        exchanges.push({ code, options });
        return { data: { session: FAKE_SESSION }, error: null };
      },
    });
    const result = await resetMod.exchangeRecoveryCode('good-code', 'flow-7');
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(exchanges[0], { code: 'good-code', options: { flowId: 'flow-7' } });
  });

  await test('thrown exception propagates for the screen to catch', async () => {
    resetAll();
    supabaseMod.__setSupabaseBehavior({
      exchangeCodeForSession: async () => {
        throw new Error('storage unavailable');
      },
    });
    await assert.rejects(
      () => resetMod.exchangeRecoveryCode('code'),
      /storage unavailable/,
    );
  });

  console.log('\n[tests] auth state listener guard\n');

  await test('init is idempotent: second call does not stack subscriptions', async () => {
    resetAll();
    // The compiled module already ran initAuthStateListener() once at import.
    // Re-running the (non-exported) guard is not reachable from outside, so
    // this asserts the observable contract instead: SIGNED_OUT clears the
    // session and a session-bearing event promotes the mode, exactly once
    // each, through the single subscription created at module load.
    storeMod.useSessionStore.setState({ session: FAKE_SESSION });
    const cb = supabaseMod.__lastAuthStateListener;
    assert.ok(cb, 'a listener subscription was registered at module load');
    cb('SIGNED_OUT', null);
    assert.equal(storeMod.useSessionStore.getState().session, null);
    cb('SIGNED_IN', FAKE_SESSION);
    assert.equal(storeMod.useSessionStore.getState().session, FAKE_SESSION);
    assert.equal(settingsMod.useSettingsStore.getState().mode, 'authenticated');
  });

  await test('registry re-registration replaces the listener, never stacks', async () => {
    resetAll();
    // Module load registered one listener (active === 1). Re-registering —
    // exactly what Fast Refresh does when Metro re-executes the store module —
    // must unsubscribe the previous handle, so the active count stays at one
    // instead of stacking duplicate callbacks (S-1).
    const before = supabaseMod.__listenerStats();
    assert.equal(before.active, 1, 'exactly one subscription after module load');
    registryMod.registerAuthStateListener(
      supabaseMod.supabase.auth.onAuthStateChange.bind(supabaseMod.supabase.auth),
      () => {},
    );
    const after = supabaseMod.__listenerStats();
    assert.equal(after.active, 1, 're-registration must not stack listeners');
    assert.equal(
      after.unsubscribed,
      before.unsubscribed + 1,
      'the previous handle must have been unsubscribed',
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
} finally {
  rmSync(workdir, { recursive: true, force: true });
}
