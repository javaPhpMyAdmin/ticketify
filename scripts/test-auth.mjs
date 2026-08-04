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

/** Resets every double and the store to their initial state. */
function resetAll() {
  supabaseMod.__resetSupabaseBehavior();
  storageMod.__resetStorage();
  browserMod.__setNextBrowserResult({ type: 'cancel' });
  storeMod.__setAuthRestoreTimeout(10_000);
  storeMod.useSessionStore.setState({ session: null, isBootstrapping: true });
}

let storeMod;
let oauthMod;
let resetMod;
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
  oauthMod = await load('src/lib/auth/oauth.js');
  resetMod = await load('src/lib/auth/reset-exchange.js');
  registryMod = await load('src/lib/auth/auth-listener-registry.js');
  supabaseMod = await load('scripts/test-stubs/supabase.js');
  storageMod = await load('scripts/test-stubs/storage-adapter.js');
  browserMod = await load('scripts/test-stubs/web-browser.js');

  console.log('\n[tests] session restore\n');

  await test('fresh install: no stored session → sign-in gate, bootstrap finishes', async () => {
    resetAll();
    await storeMod.useSessionStore.getState().restore();
    const s = storeMod.useSessionStore.getState();
    assert.equal(s.session, null);
    assert.equal(s.isBootstrapping, false);
  });

  await test('signed-out user relaunch: no stored session → sign-in gate', async () => {
    resetAll();
    await storeMod.useSessionStore.getState().restore();
    const s = storeMod.useSessionStore.getState();
    assert.equal(s.session, null);
    assert.equal(s.isBootstrapping, false);
  });

  await test('valid stored session: restored, bootstrap finishes', async () => {
    resetAll();
    supabaseMod.__setSupabaseBehavior({
      getSession: async () => ({ data: { session: FAKE_SESSION }, error: null }),
    });
    await storeMod.useSessionStore.getState().restore();
    const s = storeMod.useSessionStore.getState();
    assert.equal(s.session, FAKE_SESSION);
    assert.equal(s.isBootstrapping, false);
  });

  await test('expired stored session: cleared, sign-in gate kept', async () => {
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
    assert.equal(signedOut, 1);
  });

  await test('storage/network failure: resolves to a safe no-session state', async () => {
    resetAll();
    supabaseMod.__setSupabaseBehavior({
      getSession: async () => {
        throw new Error('SecureStore backend exploded');
      },
    });
    await storeMod.useSessionStore.getState().restore();
    const s = storeMod.useSessionStore.getState();
    assert.equal(s.session, null);
    assert.equal(s.isBootstrapping, false);
  });

  await test('hung storage backend: timeout settles bootstrap with safe state', async () => {
    resetAll();
    storageMod.__setStorageHang(true);
    storeMod.__setAuthRestoreTimeout(25);
    await storeMod.useSessionStore.getState().restore();
    const s = storeMod.useSessionStore.getState();
    assert.equal(s.isBootstrapping, false);
    assert.equal(s.session, null);
  });

  await test('late restore read: never signs out over a newer session', async () => {
    resetAll();
    let resolveLate;
    let signedOut = 0;
    supabaseMod.__setSupabaseBehavior({
      getSession: () => new Promise((resolve) => { resolveLate = resolve; }),
      signOut: async () => {
        signedOut += 1;
        return { error: null };
      },
    });
    storeMod.__setAuthRestoreTimeout(25);
    await storeMod.useSessionStore.getState().restore();
    // restore settled on the bound; bootstrapping finished with no session.
    assert.equal(storeMod.useSessionStore.getState().isBootstrapping, false);
    assert.equal(storeMod.useSessionStore.getState().session, null);
    // Meanwhile the user signed in (e.g. an OAuth cold-start exchange set a
    // fresh session through the callback route).
    storeMod.useSessionStore.setState({ session: FAKE_SESSION });
    // The hung read finally resolves with an ERROR (expired stored token).
    // Without the guard this branch calls signOut() and destroys the fresh
    // session; the late continuation must be a no-op instead.
    resolveLate({ data: { session: null }, error: { message: 'invalid refresh token' } });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(signedOut, 0, 'late error must not sign out over a newer session');
    assert.equal(storeMod.useSessionStore.getState().session, FAKE_SESSION);
  });

  await test('late restore read: stale session never clobbers a newer one', async () => {
    resetAll();
    let resolveLate;
    const STALE_SESSION = { ...FAKE_SESSION, access_token: 'at-stale' };
    supabaseMod.__setSupabaseBehavior({
      getSession: () => new Promise((resolve) => { resolveLate = resolve; }),
    });
    storeMod.__setAuthRestoreTimeout(25);
    await storeMod.useSessionStore.getState().restore();
    storeMod.useSessionStore.setState({ session: FAKE_SESSION });
    // The hung read resolves with a STALE session read from storage; the
    // guard must refuse to overwrite the fresh session with it.
    resolveLate({ data: { session: STALE_SESSION }, error: null });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(storeMod.useSessionStore.getState().session, FAKE_SESSION);
    assert.equal(storeMod.useSessionStore.getState().isBootstrapping, false);
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

  console.log('\n[tests] sign-in anti-enumeration\n');

  await test('invalid credentials: generic message, raw GoTrue never surfaced', async () => {
    resetAll();
    supabaseMod.__setSupabaseBehavior({
      signInWithPassword: async () => ({
        error: { message: 'Invalid login credentials', code: 'invalid_credentials' },
      }),
    });
    const error = await storeMod.useSessionStore.getState().signInWithEmail(
      'user@example.com',
      'wrong-password',
    );
    assert.equal(error, 'Invalid email or password.');
  });

  await test('unconfirmed email: indistinguishable from invalid credentials', async () => {
    resetAll();
    supabaseMod.__setSupabaseBehavior({
      signInWithPassword: async () => ({
        error: { message: 'Email not confirmed', code: 'email_not_confirmed' },
      }),
    });
    const error = await storeMod.useSessionStore.getState().signInWithEmail(
      'user@example.com',
      'right-password',
    );
    assert.equal(error, 'Invalid email or password.');
  });

  await test('nonexistent account: same generic message, no existence signal', async () => {
    resetAll();
    supabaseMod.__setSupabaseBehavior({
      signInWithPassword: async () => ({
        error: { message: 'Invalid login credentials' },
      }),
    });
    const error = await storeMod.useSessionStore.getState().signInWithEmail(
      'nobody@example.com',
      'whatever',
    );
    assert.equal(error, 'Invalid email or password.');
  });

  await test('thrown network failure: also maps to generic copy, never rejects', async () => {
    resetAll();
    supabaseMod.__setSupabaseBehavior({
      signInWithPassword: async () => {
        throw new Error('Network request failed');
      },
    });
    const error = await storeMod.useSessionStore.getState().signInWithEmail(
      'user@example.com',
      'right-password',
    );
    assert.equal(error, 'Invalid email or password.');
  });

  await test('sign-in success: null error, no throw', async () => {
    resetAll();
    const error = await storeMod.useSessionStore.getState().signInWithEmail(
      'user@example.com',
      'right-password',
    );
    assert.equal(error, null);
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

  await test('exchange error: generic copy, raw GoTrue message never surfaced', async () => {
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
    assert.equal(result.error, 'Sign-in was interrupted. Please try again.');
  });

  await test('provider start failure: generic copy, raw GoTrue message never surfaced', async () => {
    resetAll();
    supabaseMod.__setSupabaseBehavior({
      signInWithOAuth: async () => ({
        data: { url: null },
        error: { message: 'Unsupported provider' },
      }),
    });
    const result = await oauthMod.signInWithProvider('google');
    assert.equal(result.cancelled, false);
    assert.equal(result.error, 'Sign-in could not be started. Please try again.');
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

  await test('thrown network error: generic copy, raw message never surfaced', async () => {
    resetAll();
    supabaseMod.__setSupabaseBehavior({
      signInWithOAuth: async () => {
        throw new Error('Network request failed');
      },
    });
    const result = await oauthMod.signInWithProvider('google');
    assert.equal(result.cancelled, false);
    assert.equal(result.error, 'Sign-in was interrupted. Please try again.');
  });

  await test('cold-start exchange: deep-link code + sb_flow_id reach the exchange', async () => {
    resetAll();
    const exchanges = [];
    supabaseMod.__setSupabaseBehavior({
      exchangeCodeForSession: async (code, options) => {
        exchanges.push({ code, options });
        return { data: { session: FAKE_SESSION }, error: null };
      },
    });
    // The oauth.tsx route calls this directly with params parsed from the
    // deep link (ticketify://oauth?code=…&sb_flow_id=…).
    const result = await oauthMod.exchangeOAuthCode('deep-link-code', 'flow-deep');
    assert.deepEqual(result, { ok: true, error: null });
    assert.deepEqual(exchanges[0], {
      code: 'deep-link-code',
      options: { flowId: 'flow-deep' },
    });
  });

  await test('cold-start exchange: no flow id → exchange without options', async () => {
    resetAll();
    const exchanges = [];
    supabaseMod.__setSupabaseBehavior({
      exchangeCodeForSession: async (code, options) => {
        exchanges.push({ code, options });
        return { data: { session: FAKE_SESSION }, error: null };
      },
    });
    const result = await oauthMod.exchangeOAuthCode('bare-code', null);
    assert.deepEqual(result, { ok: true, error: null });
    assert.equal(exchanges[0].options, undefined);
  });

  await test('cold-start exchange failure: generic copy, no session', async () => {
    resetAll();
    supabaseMod.__setSupabaseBehavior({
      exchangeCodeForSession: async () => ({
        data: { session: null },
        error: { message: 'code has expired or already been used' },
      }),
    });
    const result = await oauthMod.exchangeOAuthCode('stale-code', null);
    assert.deepEqual(result, {
      ok: false,
      error: 'Sign-in was interrupted. Please try again.',
    });
  });

  await test('in-flight flag: true while the provider flow is pending, false after', async () => {
    resetAll();
    let resolveOAuth;
    supabaseMod.__setSupabaseBehavior({
      signInWithOAuth: () => new Promise((resolve) => { resolveOAuth = resolve; }),
    });
    browserMod.__setNextBrowserResult({ type: 'cancel' });
    assert.equal(oauthMod.isOAuthFlowInFlight(), false, 'idle flow is not in flight');
    const promise = oauthMod.signInWithProvider('google');
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(oauthMod.isOAuthFlowInFlight(), true, 'pending provider flow is in flight');
    resolveOAuth({ data: { url: 'https://auth.example/authorize' }, error: null });
    const result = await promise;
    assert.deepEqual(result, { cancelled: true, error: null });
    assert.equal(oauthMod.isOAuthFlowInFlight(), false, 'settled flow is no longer in flight');
  });

  await test('warm-race wait decision: session wins over everything', async () => {
    resetAll();
    assert.deepEqual(
      oauthMod.decideOAuthCallbackWait(true, true, false, null),
      { action: 'go-app' },
    );
    assert.deepEqual(
      oauthMod.decideOAuthCallbackWait(true, false, true, 'x'),
      { action: 'go-app' },
    );
  });

  await test('warm-race wait decision: settled flow surfaces its error copy', async () => {
    resetAll();
    assert.deepEqual(
      oauthMod.decideOAuthCallbackWait(false, false, false, 'Sign-in was interrupted. Please try again.'),
      { action: 'go-signin', error: 'Sign-in was interrupted. Please try again.' },
    );
    // Cancelled flow: no error copy, plain sign-in.
    assert.deepEqual(oauthMod.decideOAuthCallbackWait(false, false, false, null), {
      action: 'go-signin',
      error: null,
    });
  });

  await test('warm-race wait decision: stalled flow falls back after the bound', async () => {
    resetAll();
    assert.deepEqual(
      oauthMod.decideOAuthCallbackWait(false, true, true, null),
      { action: 'go-signin', error: null },
    );
    assert.deepEqual(
      oauthMod.decideOAuthCallbackWait(false, true, false, null),
      { action: 'keep-waiting' },
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
