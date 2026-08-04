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
