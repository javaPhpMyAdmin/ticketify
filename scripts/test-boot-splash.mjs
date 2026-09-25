#!/usr/bin/env node
/**
 * Node harness for the pure BootSplash state machine and the status
 * cycle helper
 * (`src/components/molecules/BootSplash/{boot-splash-state,status-cycle}.ts`).
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
 * Plus the `status-cycle.ts` table-driven assertions for the pure
 * `pickStatusIndex(startedAtMs, nowMs, slotMs, totalMessages)`
 * helper used by BootSplash.tsx to walk the 3-message status text
 * cycle deterministically (the component feeds `Date.now()` but the
 * helper itself is clock-free — pure elapsed math).
 *
 * Plus cycle-integration regression tests (statusIndex dep-bug source
 * pins + an 8-second time-walk) — the structural checks are the bug
 * class regression guard.
 *
 * Usage: pnpm test:boot-splash
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// Source-pin helpers — read the component file directly off disk. The
// harness compiles the REDUCER (a pure module) with tsc; the
// COMPONENT (BootSplash.tsx) imports the full RN runtime, so we pin
// its source instead of compiling.
function readComponent(filePath) {
  return readFileSync(join(root, filePath), 'utf8');
}
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
let pickStatusIndex;

async function run() {
  console.log('\n[tests] compiling boot-splash state module…');
  await compile();
  console.log('[tests] loading compiled module…');
  ({ bootSplashState, pickStatusIndex } = await import(
    pathToFileURL(
      join(
        outDir,
        'src/components/molecules/BootSplash/boot-splash-state.js',
      ),
    ).href
  ));
  // The status-cycle helper lives in a sibling file compiled by the same
  // tsconfig include list (tsconfig.boot-splash-test.json). The compiled
  // `.js` path mirrors the source tree under `outDir`.
  const cycleMod = await import(
    pathToFileURL(
      join(
        outDir,
        'src/components/molecules/BootSplash/status-cycle.js',
      ),
    ).href
  );
  pickStatusIndex = cycleMod.pickStatusIndex;

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

  console.log('\n[tests] status cycle helper (pickStatusIndex)\n');

  // Table-driven assertions for `pickStatusIndex(startedAtMs, nowMs, slotMs, totalMessages)`.
  // The helper is clock-free — it computes `elapsed = max(0, nowMs - startedAtMs)`
  // and maps onto `Math.floor(elapsed / slotMs) % totalMessages`. The harness
  // exercises the boundary math the component relies on (off-by-one at slot
  // boundaries, defensive guards for `total=0` and negative `nowMs`).
  const CYCLE_TABLE = [
    ['elapsed=0 → 0',           { startedAtMs: 0, nowMs: 0,        slotMs: 2400, totalMessages: 3 }, 0],
    ['elapsed=2399 → 0',        { startedAtMs: 0, nowMs: 2399,     slotMs: 2400, totalMessages: 3 }, 0],
    ['elapsed=2400 → 1',        { startedAtMs: 0, nowMs: 2400,     slotMs: 2400, totalMessages: 3 }, 1],
    ['elapsed=4800 → 2',        { startedAtMs: 0, nowMs: 4800,     slotMs: 2400, totalMessages: 3 }, 2],
    ['elapsed=7199 → 2',        { startedAtMs: 0, nowMs: 7199,     slotMs: 2400, totalMessages: 3 }, 2],
    ['elapsed=7200 → 0',        { startedAtMs: 0, nowMs: 7200,     slotMs: 2400, totalMessages: 3 }, 0],
    ['total=0 → 0 (defensive)',{ startedAtMs: 1000, nowMs: 1500, slotMs: 2400, totalMessages: 0 }, 0],
    ['negative nowMs → 0 (clamp)', { startedAtMs: 5000, nowMs: -200, slotMs: 2400, totalMessages: 3 }, 0],
  ];

  for (const [name, args, expected] of CYCLE_TABLE) {
    await test(`pickStatusIndex: ${name}`, () => {
      assert.equal(pickStatusIndex(args.startedAtMs, args.nowMs, args.slotMs, args.totalMessages), expected);
    });
  }

  await test('pickStatusIndex: idempotent (same inputs → same output)', () => {
    // Defensive — the helper must be pure so the component can call it on
    // every render without the cycle state drifting due to microtask
    // interleaving.
    const args = { startedAtMs: 100, nowMs: 2500, slotMs: 2400, totalMessages: 3 };
    const a = pickStatusIndex(args.startedAtMs, args.nowMs, args.slotMs, args.totalMessages);
    const b = pickStatusIndex(args.startedAtMs, args.nowMs, args.slotMs, args.totalMessages);
    const c = pickStatusIndex(args.startedAtMs, args.nowMs, args.slotMs, args.totalMessages);
    assert.equal(a, b);
    assert.equal(b, c);
  });

  await test('pickStatusIndex: large elapsed wraps cleanly across many cycles', () => {
    // 10 minutes worth of cycle at 2.4s each = 250 slots; modulo 3 = 1.
    const slotMs = 2400;
    const totalMessages = 3;
    const tenMinutes = 10 * 60 * 1000;
    const started = 0;
    const index = pickStatusIndex(started, tenMinutes, slotMs, totalMessages);
    assert.equal(index, Math.floor(tenMinutes / slotMs) % totalMessages);
  });

  console.log('\n[tests] cycle integration regression (statusIndex dep-bug)\n');

  // Load the component source for the structural source-pins below.
  const bootSplash = readComponent(
    'src/components/molecules/BootSplash/BootSplash.tsx',
  );

  // The dep-bug class: when `statusIndex` is in the cycle `useEffect`'s
  // deps array, every `setStatusIndex(...)` call re-creates the interval
  // AND resets `statusCycleStartRef.current = Date.now()` → `pickStatusIndex`
  // always sees elapsed ≈ 0 → the screen never advances past
  // statusMessages[0]. Three reviewers caught this. The structural
  // source-pins below are the regression guard: any future re-introduction
  // of the dep-array pattern turns these tests red.

  await test('cycle useEffect does NOT include statusIndex in its deps array (dep-bug regression)', () => {
    // Locate the cycle effect by anchoring on the `const interval = setInterval(...)`
    // line — that wording is unique to the cycle effect (the sweeper / scan
    // / bob loops don't bind their `Animated.loop(...)` result to a `const interval`).
    const cycleStart = bootSplash.indexOf('const interval = setInterval(');
    assert.ok(
      cycleStart > -1,
      'cycle useEffect must contain `const interval = setInterval(...)`',
    );
    // Walk forward to the deps-array literal that follows the cleanup
    // close (`return () => clearInterval(interval);`). The first `}, [`
    // after the setInterval call is the deps array opener; the matching
    // `]);` closes it.
    const cleanupClose = bootSplash.indexOf(
      'return () => clearInterval(interval);',
      cycleStart,
    );
    const depsStart = bootSplash.indexOf('}, [', cleanupClose);
    const depsEnd = bootSplash.indexOf(']);', depsStart);
    assert.ok(
      cleanupClose > -1 && depsStart > -1 && depsEnd > depsStart,
      'cycle useEffect must terminate in `}, [<deps>]);`',
    );
    const deps = bootSplash.slice(depsStart, depsEnd + 1);
    assert.ok(
      !deps.includes('statusIndex'),
      `cycle deps array must NOT include statusIndex — re-creating the interval from a ` +
        '`statusIndex` change resets the cycle start and the helper would always return 0.\n' +
        `      deps: ${deps}`,
    );
  });

  await test('cycle uses a statusIndexRef to read the current index inside the interval closure', () => {
    assert.ok(
      /const\s+statusIndexRef\s*=\s*useRef\(0\)/.test(bootSplash),
      'BootSplash must declare `const statusIndexRef = useRef(0);` so the interval closure does not capture a stale value',
    );
    // The ref must be mirrored from `statusIndex` via a small useEffect so
    // the closure sees the latest committed value.
    assert.ok(
      /useEffect\(\s*\(\)\s*=>\s*\{\s*statusIndexRef\.current\s*=\s*statusIndex/.test(
        bootSplash,
      ),
      'BootSplash must mirror `statusIndex → statusIndexRef.current` via `useEffect(() => { statusIndexRef.current = statusIndex; }, [statusIndex])` so the interval callback reads the latest index',
    );
    // The interval closure must read the ref, NOT the local state variable.
    const cycleStart = bootSplash.indexOf('const interval = setInterval(');
    const cleanupStart = bootSplash.indexOf(
      'return () => clearInterval(interval);',
      cycleStart,
    );
    assert.ok(
      cycleStart > -1,
      'cycle useEffect must declare `const interval = setInterval(...)`',
    );
    assert.ok(
      cleanupStart > -1 && cleanupStart > cycleStart,
      'cycle useEffect must have a `return () => clearInterval(interval);` cleanup',
    );
    const cycleBody = bootSplash.slice(cycleStart, cleanupStart);
    assert.ok(
      /statusIndexRef\.current/.test(cycleBody),
      'interval body must reference statusIndexRef.current (NOT statusIndex) to avoid the closure going stale',
    );
    assert.ok(
      !/statusIndex\s*[!=]==?\s*next/.test(cycleBody),
      'interval body must NOT compare `statusIndex === next` directly (that is the stale-closure bug class)',
    );
  });

  await test('time-walk: 8 s over pickStatusIndex(0, t, 2400, 3) reaches indices 0, 1, AND 2', () => {
    // Pure-helper coverage already exists at the table level — this is the
    // integration replay: a synthetic 8 s window over the full slot must
    // surface every message exactly. The dep-bug surfaced as a stuck-0
    // symptom; the math behind the cycle helper is fine on its own, but
    // pairing this with the structural pin above closes the loop.
    const slotMs = 2400;
    const totalMessages = 3;
    const seen = new Set();
    for (let t = 0; t <= 8000; t += 100) {
      const idx = pickStatusIndex(0, t, slotMs, totalMessages);
      seen.add(idx);
      if (seen.size === totalMessages) break;
    }
    assert.ok(seen.has(0), '8 s window must reach index 0 (loading)');
    assert.ok(seen.has(1), '8 s window must reach index 1 (syncing)');
    assert.ok(seen.has(2), '8 s window must reach index 2 (ready)');
    assert.equal(seen.size, totalMessages, 'must reach exactly 3 distinct indices (no skipped slots)');
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