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
    } else if (request === 'expo-localization') {
      // The sign-in graph reaches the device-currency adapter, the sole
      // getLocales() reader on the currency path (precedent:
      // test-i18n-init.mjs). Without this branch node tries to load the
      // real native module.
      request = join(outDir, 'scripts', 'test-stubs', 'expo-localization.js');
    } else if (request === 'react-native') {
      // query-client.ts (imported by the session store for the SIGNED_OUT
      // cache clear) touches AppState/Platform; the real package cannot load
      // in plain node.
      request = join(outDir, 'scripts', 'test-stubs', 'react-native.js');
    } else if (request === 'expo-router') {
      // The session store's signOut() dynamically imports expo-router to
      // navigate to /sign-in after a successful sign-out (session-nav
      // slice). The real package needs the native navigation container and
      // cannot load in plain node — remap to the shared router double so
      // the sign-out tests exercise the navigation call, not a node crash
      // on JSX.
      request = join(outDir, 'scripts', 'test-stubs', 'expo-router.js');
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
let queryClientMod;
let sessionNavMod;
let authOverlayMod;
let handoffLatchMod;

async function run() {
  console.log('\n[tests] compiling modules with isolated tsconfig…');
  await compile();
  // The app reads React Native's `__DEV__` global for dev-only behavior
  // (e.g. the home-feed dev error log); plain node has none. Declared for
  // tsc via test-stubs/globals.d.ts; defined here so the compiled modules
  // behave like a Release build.
  globalThis.__DEV__ = false;
  installRequireHook();
  console.log('[tests] loading compiled modules…');

  storeMod = await load('src/features/auth/use-session-store.js');
  oauthMod = await load('src/lib/auth/oauth.js');
  resetMod = await load('src/lib/auth/reset-exchange.js');
  registryMod = await load('src/lib/auth/auth-listener-registry.js');
  supabaseMod = await load('scripts/test-stubs/supabase.js');
  storageMod = await load('scripts/test-stubs/storage-adapter.js');
  browserMod = await load('scripts/test-stubs/web-browser.js');
  queryClientMod = await load('src/lib/query-client.js');
  sessionNavMod = await load('src/lib/auth/session-nav.js');
  authOverlayMod = await load('src/lib/auth/auth-overlay.js');
  handoffLatchMod = await load('src/lib/auth/handoff-latch.js');

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
    assert.equal(result.error, 'No se pudo crear la cuenta. Inténtalo de nuevo.');
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
    assert.equal(error, 'Correo o contraseña inválidos.');
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
    assert.equal(error, 'Correo o contraseña inválidos.');
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
    assert.equal(error, 'Correo o contraseña inválidos.');
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
    assert.equal(error, 'Correo o contraseña inválidos.');
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
    assert.match(result.error, /interrump/i);
  });

  await test('callback without a code: readable error', async () => {
    resetAll();
    browserMod.__setNextBrowserResult({
      type: 'success',
      url: 'ticketify://oauth?error=access_denied',
    });
    const result = await oauthMod.signInWithProvider('apple');
    assert.equal(result.cancelled, false);
    assert.match(result.error, /código/i);
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
    assert.equal(result.error, 'El inicio de sesión se interrumpió. Inténtalo de nuevo.');
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
    assert.equal(result.error, 'No se pudo iniciar sesión. Inténtalo de nuevo.');
  });

  await test('missing authorize url: readable error', async () => {
    resetAll();
    supabaseMod.__setSupabaseBehavior({
      signInWithOAuth: async () => ({ data: { url: null }, error: null }),
    });
    const result = await oauthMod.signInWithProvider('google');
    assert.equal(result.cancelled, false);
    assert.match(result.error, /no se pudo iniciar/i);
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
    assert.equal(result.error, 'El inicio de sesión se interrumpió. Inténtalo de nuevo.');
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
      error: 'El inicio de sesión se interrumpió. Inténtalo de nuevo.',
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
      oauthMod.decideOAuthCallbackWait(false, false, false, 'El inicio de sesión se interrumpió. Inténtalo de nuevo.'),
      { action: 'go-signin', error: 'El inicio de sesión se interrumpió. Inténtalo de nuevo.' },
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

  await test('last flow error: recorded on failure, cleared on success and cancel', async () => {
    resetAll();
    assert.equal(oauthMod.getLastOAuthError(), null);
    // Failure (provider start): the generic copy is recorded.
    supabaseMod.__setSupabaseBehavior({
      signInWithOAuth: async () => ({
        data: { url: null },
        error: { message: 'Unsupported provider' },
      }),
    });
    await oauthMod.signInWithProvider('google');
    assert.equal(oauthMod.getLastOAuthError(), 'No se pudo iniciar sesión. Inténtalo de nuevo.');
    // Success: cleared.
    resetAll();
    supabaseMod.__setSupabaseBehavior({
      exchangeCodeForSession: async () => ({ data: { session: FAKE_SESSION }, error: null }),
    });
    browserMod.__setNextBrowserResult({
      type: 'success',
      url: 'ticketify://oauth?code=abc123',
    });
    await oauthMod.signInWithProvider('google');
    assert.equal(oauthMod.getLastOAuthError(), null);
    // Cancel: cleared.
    resetAll();
    browserMod.__setNextBrowserResult({ type: 'cancel' });
    await oauthMod.signInWithProvider('google');
    assert.equal(oauthMod.getLastOAuthError(), null);
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
    // session and a session-bearing event applies it, exactly once each,
    // through the single subscription created at module load.
    storeMod.useSessionStore.setState({ session: FAKE_SESSION });
    const cb = supabaseMod.__getLastAuthStateListener();
    assert.ok(cb, 'a listener subscription was registered at module load');
    cb('SIGNED_OUT', null);
    assert.equal(storeMod.useSessionStore.getState().session, null);
    cb('SIGNED_IN', FAKE_SESSION);
    assert.equal(storeMod.useSessionStore.getState().session, FAKE_SESSION);
  });

  console.log('\n[tests] passive events apply the session\n');

  await test('TOKEN_REFRESHED updates the session object', async () => {
    resetAll();
    const cb = supabaseMod.__getLastAuthStateListener();
    assert.ok(cb, 'listener is registered at module load');
    cb('TOKEN_REFRESHED', FAKE_SESSION);
    assert.equal(storeMod.useSessionStore.getState().session, FAKE_SESSION);
  });

  await test('USER_UPDATED applies the newer session', async () => {
    resetAll();
    const cb = supabaseMod.__getLastAuthStateListener();
    assert.ok(cb, 'listener is registered at module load');
    cb('USER_UPDATED', FAKE_SESSION);
    assert.equal(storeMod.useSessionStore.getState().session, FAKE_SESSION);
  });

  await test('PASSWORD_RECOVERY applies the session', async () => {
    resetAll();
    const cb = supabaseMod.__getLastAuthStateListener();
    assert.ok(cb, 'listener is registered at module load');
    cb('PASSWORD_RECOVERY', FAKE_SESSION);
    assert.equal(storeMod.useSessionStore.getState().session, FAKE_SESSION);
  });

  await test('SIGNED_IN applies the session', async () => {
    resetAll();
    const cb = supabaseMod.__getLastAuthStateListener();
    assert.ok(cb, 'listener is registered at module load');
    cb('SIGNED_IN', FAKE_SESSION);
    assert.equal(storeMod.useSessionStore.getState().session, FAKE_SESSION);
  });

  await test('registry re-registration replaces the listener, never stacks', async () => {
    resetAll();
    // Module load registered the app's listener (active === 1). Re-registering
    // — exactly what Fast Refresh does when Metro re-executes the store
    // module — must unsubscribe the previous handle, so the active count stays
    // at one instead of stacking duplicate callbacks (S-1). The re-registered
    // callback is the app's own listener (the same one a re-executed store
    // module would hand the registry), so the live seam keeps returning it
    // for the sign-out tests that follow.
    const appListener = supabaseMod.__getLastAuthStateListener();
    assert.ok(appListener, 'the app listener is registered at module load');
    const before = supabaseMod.__listenerStats();
    assert.equal(before.active, 1, 'exactly one subscription after module load');
    registryMod.registerAuthStateListener(
      supabaseMod.supabase.auth.onAuthStateChange.bind(supabaseMod.supabase.auth),
      appListener,
    );
    const after = supabaseMod.__listenerStats();
    assert.equal(after.active, 1, 're-registration must not stack listeners');
    assert.equal(
      after.unsubscribed,
      before.unsubscribed + 1,
      'the previous handle must have been unsubscribed',
    );
    assert.equal(
      supabaseMod.__getLastAuthStateListener(),
      appListener,
      'the live seam still returns the app listener after the swap',
    );
  });

  console.log('\n[tests] sign-out\n');

  await test('success: session cleared (gate → sign-in)', async () => {
    resetAll();
    storeMod.useSessionStore.setState({ session: FAKE_SESSION, isBootstrapping: false });
    // Seed the in-memory server-state cache, then verify SIGNED_OUT wipes it
    // (server-state-caching spec: no previous user's rows survive to the next
    // session).
    queryClientMod.queryClient.setQueryData(['profile', 'user-1'], { id: 'user-1' });
    assert.equal(queryClientMod.queryClient.getQueryCache().findAll().length, 1);
    let signOutCalls = 0;
    supabaseMod.__setSupabaseBehavior({
      signOut: async () => {
        signOutCalls += 1;
        return { error: null };
      },
    });
    await assert.doesNotReject(() => storeMod.useSessionStore.getState().signOut());
    // auth-js fires SIGNED_OUT on success; the listener clears the session.
    const cb = supabaseMod.__getLastAuthStateListener();
    assert.ok(cb, 'listener is registered for SIGNED_OUT');
    cb('SIGNED_OUT', null);
    const s = storeMod.useSessionStore.getState();
    assert.equal(s.session, null);
    assert.equal(
      queryClientMod.queryClient.getQueryCache().findAll().length,
      0,
      'SIGNED_OUT must clear the in-memory query cache',
    );
    // The root gate (authenticated && !session) now routes to sign-in.
    assert.equal(signOutCalls, 1);
  });

  await test('offline revoke failure: local session still cleared, no misleading throw', async () => {
    resetAll();
    storeMod.useSessionStore.setState({ session: FAKE_SESSION, isBootstrapping: false });
    supabaseMod.__setSupabaseBehavior({
      signOut: async () => {
        // auth-js clears the local session and fires SIGNED_OUT BEFORE
        // returning the revoke error (verified in GoTrueClient._signOut).
        const cb = supabaseMod.__getLastAuthStateListener();
        cb('SIGNED_OUT', null);
        return { error: { message: 'Network request failed' } };
      },
    });
    await assert.doesNotReject(() => storeMod.useSessionStore.getState().signOut());
    assert.equal(storeMod.useSessionStore.getState().session, null);
  });

  await test('genuine failure (session intact): the only surfaced error', async () => {
    resetAll();
    storeMod.useSessionStore.setState({ session: FAKE_SESSION, isBootstrapping: false });
    supabaseMod.__setSupabaseBehavior({
      signOut: async () => ({ error: { message: 'storage backend unavailable' } }),
    });
    await assert.rejects(
      () => storeMod.useSessionStore.getState().signOut(),
      /storage backend unavailable/,
    );
    // No SIGNED_OUT fired: the local session was NOT cleared, so the sign-out
    // genuinely failed and the error is worth surfacing.
    assert.equal(storeMod.useSessionStore.getState().session, FAKE_SESSION);
  });

  console.log('\n[tests] root-gate session navigation decision\n');

  const nav = (prevSession, session, pathname) =>
    sessionNavMod.decideSessionNavigation({ prevSession, session, pathname });

  await test('flip null→session on /sign-in (email sign-in) → navigate /', async () => {
    assert.deepEqual(nav(null, FAKE_SESSION, '/sign-in'), {
      shouldNavigate: true,
      target: '/',
    });
  });

  await test('flip null→session on /oauth (cold-start exchange) → navigate /', async () => {
    assert.deepEqual(nav(null, FAKE_SESSION, '/oauth'), {
      shouldNavigate: true,
      target: '/',
    });
  });

  await test('session present on /oauth, prev already truthy (parked: warm race / stored-session cold start) → navigate /', async () => {
    assert.deepEqual(nav(FAKE_SESSION, FAKE_SESSION, '/oauth'), {
      shouldNavigate: true,
      target: '/',
    });
  });

  await test('session present on /sign-in with no flip → NO navigation', async () => {
    assert.deepEqual(nav(FAKE_SESSION, FAKE_SESSION, '/sign-in'), {
      shouldNavigate: false,
      target: '/',
    });
  });

  await test('/reset-password suppresses BOTH the flip and the parked clause', async () => {
    assert.deepEqual(nav(null, FAKE_SESSION, '/reset-password'), {
      shouldNavigate: false,
      target: '/',
    });
    assert.deepEqual(nav(FAKE_SESSION, FAKE_SESSION, '/reset-password'), {
      shouldNavigate: false,
      target: '/',
    });
  });

  await test('session null → NO navigation on any pathname', async () => {
    assert.deepEqual(nav(null, null, '/sign-in'), { shouldNavigate: false, target: '/' });
    assert.deepEqual(nav(null, null, '/oauth'), { shouldNavigate: false, target: '/' });
    assert.deepEqual(nav(FAKE_SESSION, null, '/oauth'), { shouldNavigate: false, target: '/' });
  });

  await test('prev === session (no change) → NO navigation', async () => {
    assert.deepEqual(nav(null, null, '/'), { shouldNavigate: false, target: '/' });
    assert.deepEqual(nav(FAKE_SESSION, FAKE_SESSION, '/'), {
      shouldNavigate: false,
      target: '/',
    });
  });

  console.log('\n[tests] sign-in handoff overlay decision\n');

  const overlay = (input) => authOverlayMod.shouldShowAuthOverlay(input);
  // A signed-in render with NO session transition: this is the navigated-in /
  // deep-linked case (no null→session flip, no armed handoff latch).
  const NO_TRANSITION = { flipDetectedThisRender: false, handoffLatched: false };

  await test('issue #215: session FLIPS null→session while on /sign-in → overlay SHOWN', () => {
    // The regression: OAuth completes, `session` lands while the current
    // route is still /sign-in (the post-paint replace to `/` has not run
    // yet). The flip arms the handoff, so the overlay must stay UP.
    assert.equal(
      overlay({
        hasSession: true,
        pathname: '/sign-in',
        authFlowInFlight: false,
        isBootstrapping: false,
        flipDetectedThisRender: true,
        handoffLatched: false,
      }),
      true,
      'a session FLIP on the auth surface must keep the overlay up',
    );
  });

  await test('session FLIPS on /sign-up or /forgot-password → overlay SHOWN (whole auth group)', () => {
    for (const pathname of ['/sign-up', '/forgot-password']) {
      assert.equal(
        overlay({
          hasSession: true,
          pathname,
          authFlowInFlight: false,
          isBootstrapping: false,
          flipDetectedThisRender: true,
          handoffLatched: false,
        }),
        true,
        `${pathname} flip must keep the overlay up`,
      );
    }
  });

  await test('handoff latch: flip already consumed, route has not left the auth surface → overlay SHOWN', () => {
    // The frame(s) between the session landing and `router.replace('/')`
    // committing (e.g. `authFlowInFlight` clears in a separate render):
    // flipDetectedThisRender is already false, but the latch holds the cover.
    assert.equal(
      overlay({
        hasSession: true,
        pathname: '/sign-in',
        authFlowInFlight: false,
        isBootstrapping: false,
        flipDetectedThisRender: false,
        handoffLatched: true,
      }),
      true,
    );
  });

  await test('REGRESSION: signed-in user NAVIGATES to /sign-in with no flip → overlay HIDDEN (soft, never a dead-end)', () => {
    // Reachable via the /legal/* footer (`LegalScreen` router.replace('/sign-in'))
    // from the signed-in profile, or a `ticketify://sign-in` deep link.
    // `decideSessionNavigation` never navigates (no flip, not /oauth), so an
    // overlay here would be a permanent, affordance-less cover — the defect
    // this case pins. With no transition the pre-existing soft behaviour
    // (sign-in form visible) must win.
    assert.equal(
      overlay({
        hasSession: true,
        pathname: '/sign-in',
        authFlowInFlight: false,
        isBootstrapping: false,
        ...NO_TRANSITION,
      }),
      false,
      'no transition → the sign-in screen must stay visible (soft route)',
    );
  });

  await test('REGRESSION: deep-linked /sign-up and /forgot-password while signed in, no flip → overlay HIDDEN', () => {
    for (const pathname of ['/sign-up', '/forgot-password']) {
      assert.equal(
        overlay({
          hasSession: true,
          pathname,
          authFlowInFlight: false,
          isBootstrapping: false,
          ...NO_TRANSITION,
        }),
        false,
        `${pathname} with no transition must stay visible`,
      );
    }
  });

  await test('FORK: identical hasSession + pathname, result decided ONLY by the transition state', () => {
    const base = {
      hasSession: true,
      pathname: '/sign-in',
      authFlowInFlight: false,
      isBootstrapping: false,
    };
    const navigated = overlay({ ...base, ...NO_TRANSITION });
    const flipped = overlay({ ...base, flipDetectedThisRender: true, handoffLatched: false });
    const latched = overlay({ ...base, flipDetectedThisRender: false, handoffLatched: true });
    assert.deepEqual(
      { navigated, flipped, latched },
      { navigated: false, flipped: true, latched: true },
      'the transition state alone must fork the decision',
    );
  });

  await test('signed in, route off the auth surface (tabs) → overlay HIDDEN', () => {
    assert.equal(
      overlay({
        hasSession: true,
        pathname: '/',
        authFlowInFlight: false,
        isBootstrapping: false,
        ...NO_TRANSITION,
      }),
      false,
    );
  });

  await test('/reset-password owns its exit: a recovery session must NOT be covered', () => {
    // The recovery exchange signs in with a session while the user still
    // needs the new-password form; `decideSessionNavigation` deliberately
    // does not navigate away. The overlay must stay hidden or the form is
    // unreachable — even though this IS a null→session flip.
    assert.equal(
      overlay({
        hasSession: true,
        pathname: '/reset-password',
        authFlowInFlight: false,
        isBootstrapping: false,
        flipDetectedThisRender: true,
        handoffLatched: false,
      }),
      false,
    );
  });

  await test('no session + OAuth in flight + bootstrap done → overlay SHOWN (#206 window)', () => {
    assert.equal(
      overlay({
        hasSession: false,
        pathname: '/sign-in',
        authFlowInFlight: true,
        isBootstrapping: false,
        ...NO_TRANSITION,
      }),
      true,
    );
  });

  await test('no session + OAuth in flight + STILL bootstrapping → overlay HIDDEN (BootSplash owns it)', () => {
    assert.equal(
      overlay({
        hasSession: false,
        pathname: '/sign-in',
        authFlowInFlight: true,
        isBootstrapping: true,
        ...NO_TRANSITION,
      }),
      false,
    );
  });

  await test('no session + no flow → overlay HIDDEN (sign-in visible)', () => {
    assert.equal(
      overlay({
        hasSession: false,
        pathname: '/sign-in',
        authFlowInFlight: false,
        isBootstrapping: false,
        ...NO_TRANSITION,
      }),
      false,
    );
  });

  await test('cold start while already signed in → overlay HIDDEN during bootstrap (BootSplash owns boot)', () => {
    // restore() sets the session while isBootstrapping is still true; the
    // branded splash covers that window and its condition is untouched.
    assert.equal(
      overlay({
        hasSession: true,
        pathname: '/sign-in',
        authFlowInFlight: false,
        isBootstrapping: true,
        flipDetectedThisRender: true,
        handoffLatched: false,
      }),
      false,
    );
  });

  await test('auth surface helper: sign-in group covered, reset-password excluded', () => {
    assert.equal(authOverlayMod.isAuthSurfacePathname('/sign-in'), true);
    assert.equal(authOverlayMod.isAuthSurfacePathname('/sign-up'), true);
    assert.equal(authOverlayMod.isAuthSurfacePathname('/forgot-password'), true);
    assert.equal(authOverlayMod.isAuthSurfacePathname('/reset-password'), false);
    assert.equal(authOverlayMod.isAuthSurfacePathname('/'), false);
    assert.equal(authOverlayMod.isAuthSurfacePathname('/oauth'), false);
  });

  console.log('\n[tests] handoff latch reducer (render sequences)\n');

  // The transition tracker was extracted into a pure reducer so the #215
  // latch is tested as a SEQUENCE of renders, not by pinning source text.
  // `_layout.tsx` feeds each render's inputs through this reducer and applies
  // the returned `latched` via a render-phase setState.
  const reduceHandoff = handoffLatchMod.reduceHandoff;
  const INITIAL_LATCH = handoffLatchMod.INITIAL_HANDOFF_STATE;
  // A signed-in render on the auth surface by default; each test overrides the
  // fields that matter. `onAuthSurface` is derived from isAuthSurfacePathname
  // so the /sign-up and /forgot-password sequences exercise the same helper
  // the layout uses (not just /sign-in).
  const step = (over = {}) => ({
    prevSessionWasNull: false,
    hasSession: true,
    onAuthSurface: isAuthSurfacePathnameForTest('/sign-in'),
    isBootstrapping: false,
    ...over,
  });
  function isAuthSurfacePathnameForTest(pathname) {
    return authOverlayMod.isAuthSurfacePathname(pathname);
  }
  const latchedOf = (state) => state.latched;

  await test('cold start / idle: latch never arms (no session, no auth surface)', () => {
    // Fresh mount: no session yet, still bootstrapping → stays unlatched.
    assert.equal(latchedOf(reduceHandoff(INITIAL_LATCH, step({ hasSession: false }))), false);
    // Signed-in on the tabs, no transition → stays unlatched.
    assert.equal(latchedOf(reduceHandoff(INITIAL_LATCH, step({ onAuthSurface: false }))), false);
    // The initial state constant itself is unlatched.
    assert.equal(INITIAL_LATCH.latched, false);
  });

  await test('SEQUENCE flip lands on the auth surface → latch ARMS (#215 fix)', () => {
    const next = reduceHandoff(INITIAL_LATCH, step({ prevSessionWasNull: true }));
    assert.equal(latchedOf(next), true, 'a null→session flip on the auth surface must arm');
  });

  await test('SEQUENCE flip already consumed, route still on the auth surface → latch HOLDS (no flash)', () => {
    const armed = reduceHandoff(INITIAL_LATCH, step({ prevSessionWasNull: true }));
    // Next render: session is no longer "new", route has not left yet
    // (e.g. authFlowInFlight cleared first). Must stay latched.
    const held = reduceHandoff(armed, step({ prevSessionWasNull: false }));
    assert.equal(latchedOf(held), true, 'the cover must outlive the pre-commit frames');
  });

  await test('SEQUENCE route leaves the auth surface → latch DISARMS', () => {
    const armed = reduceHandoff(INITIAL_LATCH, step({ prevSessionWasNull: true }));
    const left = reduceHandoff(armed, step({ onAuthSurface: false })); // router.replace('/') committed
    assert.equal(latchedOf(left), false, 'the cover must drop once the tabs route commits');
  });

  await test('SEQUENCE signed-in NAVIGATES in with no flip → latch stays UNLATCHED (CRITICAL guard)', () => {
    // Reachable via the /legal/* footer router.replace('/sign-in') from the
    // signed-in profile, or a `ticketify://sign-in` deep link. No flip → the
    // reducer must NOT arm, or the overlay is a permanent dead-end.
    let state = INITIAL_LATCH;
    state = reduceHandoff(state, step({ prevSessionWasNull: false }));
    state = reduceHandoff(state, step({ prevSessionWasNull: false }));
    assert.equal(latchedOf(state), false, 'a navigation with no transition must never arm the latch');
  });

  await test('SEQUENCE the same three transitions hold on /sign-up and /forgot-password', () => {
    for (const pathname of ['/sign-up', '/forgot-password']) {
      const onSurface = isAuthSurfacePathnameForTest(pathname);
      assert.equal(onSurface, true, `${pathname} must be on the auth surface`);
      // flip → arms
      const armed = reduceHandoff(INITIAL_LATCH, step({ onAuthSurface: onSurface, prevSessionWasNull: true }));
      assert.equal(latchedOf(armed), true, `${pathname} flip must arm`);
      // hold → stays
      const held = reduceHandoff(armed, step({ onAuthSurface: onSurface, prevSessionWasNull: false }));
      assert.equal(latchedOf(held), true, `${pathname} must hold across the pre-commit frame`);
      // navigated in, no flip → stays unlatched
      const nav = reduceHandoff(INITIAL_LATCH, step({ onAuthSurface: onSurface, prevSessionWasNull: false }));
      assert.equal(latchedOf(nav), false, `${pathname} navigation with no flip must not arm`);
      // leave → disarms
      const left = reduceHandoff(armed, step({ onAuthSurface: false, prevSessionWasNull: false }));
      assert.equal(latchedOf(left), false, `${pathname} must disarm on leaving`);
    }
  });

  await test('SEQUENCE session clears while on the auth surface → latch DISARMS', () => {
    const armed = reduceHandoff(INITIAL_LATCH, step({ prevSessionWasNull: true }));
    const cleared = reduceHandoff(armed, step({ hasSession: false, prevSessionWasNull: false }));
    assert.equal(latchedOf(cleared), false, 'no session → nothing to cover');
  });

  await test('SEQUENCE cold start (F2): restore flip during bootstrap NEVER arms, post-bootstrap stays unlatched', () => {
    // restore() sets the session while isBootstrapping is still true; the
    // branded splash owns that window. The `!isBootstrapping` arm guard must
    // keep the opaque overlay off — even though this IS a null→session flip.
    const duringBoot = reduceHandoff(
      INITIAL_LATCH,
      step({ prevSessionWasNull: true, isBootstrapping: true }),
    );
    assert.equal(latchedOf(duringBoot), false, 'the restore flip must not arm during bootstrap');
    // The post-bootstrap render: prevSession has been updated, so no flip.
    const afterBoot = reduceHandoff(
      duringBoot,
      step({ prevSessionWasNull: false, isBootstrapping: false }),
    );
    assert.equal(latchedOf(afterBoot), false, 'cold start must stay byte-for-byte unlatched');
  });

  await test('SEQUENCE /reset-password: recovery flip must NOT arm the handoff', () => {
    // The recovery exchange signs in with a session while the form must stay
    // visible; /reset-password is excluded from the auth surface.
    const onSurface = isAuthSurfacePathnameForTest('/reset-password');
    assert.equal(onSurface, false);
    const state = reduceHandoff(INITIAL_LATCH, step({ onAuthSurface: onSurface, prevSessionWasNull: true }));
    assert.equal(latchedOf(state), false);
  });

  await test('FORK (sequence): identical inputs, only the flip field differs → arm vs stay', () => {
    // The two cases that MUST differ, driven through the reducer end-to-end.
    const flipped = reduceHandoff(INITIAL_LATCH, step({ prevSessionWasNull: true }));
    const navigated = reduceHandoff(INITIAL_LATCH, step({ prevSessionWasNull: false }));
    assert.deepEqual(
      { flipped: latchedOf(flipped), navigated: latchedOf(navigated) },
      { flipped: true, navigated: false },
      'the transition alone must fork the latch',
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
