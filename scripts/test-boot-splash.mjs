#!/usr/bin/env node
/**
 * Node harness for the pure BootSplash state machine
 * (`src/components/molecules/BootSplash/boot-splash-state.ts`).
 *
 * Compiles the module with an isolated tsconfig (no project imports —
 * the reducer is framework-free, no stubs required) and asserts the
 * boot-timing contract:
 *
 *   - `visible` plus no booted event → stays `visible`.
 *   - `booted` without the min-display elapsed → stays `visible`
 *     (the pending 900ms timer is OUTSIDE the state machine; the
 *     caller keeps it running — dispatching `booted` again once it
 *     expires still transitions, proving there is no lockout/reset).
 *   - `booted` with the min-display elapsed → `fading`.
 *   - Fading requires booted: `fadeCompleted` from `visible` never
 *     transitions (the overlay can't fade before the session booted).
 *   - `fading` + `fadeCompleted(finished: false)` → stays `fading`
 *     (no onFinish — interrupted fade).
 *   - `fading` + `fadeCompleted(finished: true)` → `done`.
 *   - `done` is terminal: every further event is ignored, so
 *     `onFinish` can fire at most once.
 *   - No reset event exists: an unknown event (e.g. a hypothetical
 *     "reset" a parent re-render could dispatch) is ignored in every
 *     state — the reducer cannot be wound back to `visible`.
 *
 * Deterministic: no clock, no globals, fixed table inputs.
 *
 * Usage: pnpm test:boot-splash
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const tscBin = require.resolve('typescript/bin/tsc');
const harnessConfig = join(__dirname, 'tsconfig.boot-splash-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'boot-splash-test-'));
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

async function compile() {
  execFileSync(
    process.execPath,
    [tscBin, '-p', harnessConfig, '--outDir', outDir],
    { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] },
  );
}

let bootSplashState;

async function run() {
  console.log('\n[tests] compiling boot-splash state module…');
  await compile();
  console.log('[tests] loading compiled module…');
  ({ bootSplashState } = await import(
    pathToFileURL(
      join(outDir, 'src/components/molecules/BootSplash/boot-splash-state.js'),
    ).href
  ));

  console.log('\n[tests] state-machine transition table\n');

  // Table-driven rows: [name, from, event, expected]
  const TABLE = [
    // ── visible ────────────────────────────────────────────────────────
    [
      'visible, no booted → stays visible',
      'visible',
      {},
      'visible',
    ],
    [
      'booted but min-display not elapsed → stays visible',
      'visible',
      { type: 'booted', minDisplayElapsed: false },
      'visible',
    ],
    [
      'booted and min-display elapsed → fading',
      'visible',
      { type: 'booted', minDisplayElapsed: true },
      'fading',
    ],
    [
      'fadeCompleted(finished:true) from visible → stays visible (fading requires booted)',
      'visible',
      { type: 'fadeCompleted', finished: true },
      'visible',
    ],
    [
      'fadeCompleted(finished:false) from visible → stays visible',
      'visible',
      { type: 'fadeCompleted', finished: false },
      'visible',
    ],
    [
      'unknown event from visible → stays visible (no reset event)',
      'visible',
      { type: 'reset' },
      'visible',
    ],
    // ── fading ─────────────────────────────────────────────────────────
    [
      'fadeCompleted(finished:false) → stays fading (no onFinish)',
      'fading',
      { type: 'fadeCompleted', finished: false },
      'fading',
    ],
    [
      'fadeCompleted(finished:true) → done',
      'fading',
      { type: 'fadeCompleted', finished: true },
      'done',
    ],
    [
      'booted from fading → stays fading (already past visible)',
      'fading',
      { type: 'booted', minDisplayElapsed: true },
      'fading',
    ],
    [
      'unknown event from fading → stays fading',
      'fading',
      { type: 'reset' },
      'fading',
    ],
    // ── done (terminal) ────────────────────────────────────────────────
    [
      'done + booted → stays done (terminal)',
      'done',
      { type: 'booted', minDisplayElapsed: true },
      'done',
    ],
    [
      'done + fadeCompleted(finished:true) → stays done (terminal)',
      'done',
      { type: 'fadeCompleted', finished: true },
      'done',
    ],
  ];

  for (const [name, from, event, expected] of TABLE) {
    await test(name, () => {
      assert.equal(bootSplashState(from, event), expected);
    });
  }

  console.log('\n[tests] sequencing contracts\n');

  await test(
    'booted early (elapsed:false) then again after the timer expires → fading (timer lives OUTSIDE the machine)',
    () => {
      let state = 'visible';
      state = bootSplashState(state, { type: 'booted', minDisplayElapsed: false });
      assert.equal(state, 'visible', 'early booted must not transition');
      state = bootSplashState(state, { type: 'booted', minDisplayElapsed: true });
      assert.equal(state, 'fading', 'second dispatch after the 900ms timer must transition');
    },
  );

  await test('happy path: visible → fading → done', () => {
    let state = 'visible';
    state = bootSplashState(state, { type: 'booted', minDisplayElapsed: true });
    assert.equal(state, 'fading');
    state = bootSplashState(state, { type: 'fadeCompleted', finished: true });
    assert.equal(state, 'done');
  });

  await test('onFinish fires at most once: mixed event storm can reach done at most once', () => {
    // Deterministic long sequence of plausible events; count how many
    // times the machine ENTERS `done`. Because `done` is terminal and
    // only `fading + fadeCompleted(finished:true)` reaches it, the count
    // must be exactly 1 — matching the component calling `onFinish` only
    // on the transition to `done`.
    const events = [
      { type: 'booted', minDisplayElapsed: false },
      { type: 'fadeCompleted', finished: true },
      { type: 'fadeCompleted', finished: false },
      { type: 'booted', minDisplayElapsed: true },
      { type: 'fadeCompleted', finished: false },
      { type: 'fadeCompleted', finished: true },
      { type: 'booted', minDisplayElapsed: true },
      { type: 'fadeCompleted', finished: true },
      { type: 'fadeCompleted', finished: false },
      { type: 'booted', minDisplayElapsed: false },
    ];
    let state = 'visible';
    let doneTransitions = 0;
    for (const event of events) {
      const next = bootSplashState(state, event);
      if (next === 'done' && state !== 'done') doneTransitions += 1;
      state = next;
    }
    assert.equal(state, 'done', 'storm must settle on done');
    assert.equal(doneTransitions, 1, 'done is reachable exactly once');
  });

  await test('reducer is pure: same (state, event) always returns the same next state', () => {
    const pairs = [
      ['visible', { type: 'booted', minDisplayElapsed: true }],
      ['visible', { type: 'booted', minDisplayElapsed: false }],
      ['fading', { type: 'fadeCompleted', finished: true }],
      ['fading', { type: 'fadeCompleted', finished: false }],
      ['done', { type: 'booted', minDisplayElapsed: true }],
    ];
    for (const [from, event] of pairs) {
      assert.equal(bootSplashState(from, event), bootSplashState(from, event));
    }
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