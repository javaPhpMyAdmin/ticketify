#!/usr/bin/env node
/**
 * Node harness for the universal press-feedback contract
 * (`src/theme/motion.ts` + `src/components/atoms/Pressable/Pressable.tsx`).
 *
 * ── The rule this file exists to pin ─────────────────────────────────────
 * Every tappable surface sinks AND dims on press BY DEFAULT, driven by ONE
 * token set, with exactly three documented opt-outs. A press-feedback
 * contract is a contract precisely because it is invisible when it holds —
 * nothing crashes, nothing logs, the screen just "feels flat". So the pins
 * have to cover both halves:
 *
 *   BEHAVIORAL — compile the atom and read the RESOLVED style it hands
 *   react-native for `pressed: false` and `pressed: true` (see
 *   scripts/test-stubs/pressable-rn.ts). A dim/scale that is merely
 *   documented but not applied is caught here.
 *
 *   SOURCE — the consumers that MUST opt out, and the bypasses that would
 *   silently defeat the contract.
 *
 * ── Why the source pins strip comments ───────────────────────────────────
 * The atom, the theme barrel and both invisible-target files NAME the token
 * and the alias in their own docblocks. A comment-blind regex therefore
 * matches the DOCUMENTATION while the code regresses, which is worse than no
 * pin: it reports green on a broken implementation. Every regex below runs
 * against a comment-stripped copy of the file.
 *
 * ── Why the bypass pins exist ────────────────────────────────────────────
 * Four one-token edits would each turn the contract off without touching a
 * single assertion that only looks at the atom:
 *   - `pressScale="false"` (a STRING) is truthy, so the scale stays ON
 *     forever while the source reads like the Fab's opt-out.
 *   - `TouchableOpacity` / `TouchableHighlight` / … sidesteps the atom
 *     entirely and gets react-native's stock, un-themed press feedback.
 *   - `require('@/theme/motion')` splits the token module into a second
 *     instance and bypasses the `@/theme` barrel contract.
 *   - aliasing `Pressable as RNPressable` elsewhere forks the atom into a
 *     second, unthemed implementation.
 *
 * ── Deliberate scope ─────────────────────────────────────────────────────
 * This harness pins the FIVE files that own the contract (the token module,
 * the barrel, the atom, and the three opt-out consumers it ships with). It
 * does NOT assert that every file in `src/` imports the themed atom — that
 * inventory is owned by the i18n/regionalization harnesses, and a
 * re-point-one-file-at-a-time migration would otherwise pin a migration
 * nobody has started.
 *
 * Usage: pnpm test:pressable-pins
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import React from 'react';
import { act } from 'react';
import TestRenderer from 'react-test-renderer';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const tscBin = require.resolve('typescript/bin/tsc');
const harnessConfig = join(__dirname, 'tsconfig.pressable-pins-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'pressable-pins-test-'));
const outDir = join(workdir, 'out');

/** Suite cardinality. A pin added without bumping this fails the suite —
 *  otherwise a future harness that drops an assertion ships silently green. */
const EXPECTED_TEST_COUNT = 21;

let passed = 0;
let failed = 0;
const testNames = [];

async function test(name, fn) {
  testNames.push(name);
  try {
    await fn();
    passed += 1;
    console.log(`  ok    ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL  ${name}`);
    console.error(String((err && err.stack) || err));
  }
}

// ── Source helpers ────────────────────────────────────────────────────────

const readSrc = (rel) => readFileSync(join(root, rel), 'utf8');

/**
 * Strip comments so a regex can only match CODE. Handles block comments and
 * both line-comment forms; string literals are not protected, which is
 * deliberate — every pattern below is specific enough that no docblock
 * survivor would match, and a false negative here fails loudly rather than
 * silently.
 */
const stripComments = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const codeOf = (rel) => stripComments(readSrc(rel));

/** Every `.ts` / `.tsx` file under `src/`. */
function srcFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
  };
  walk(join(root, 'src'));
  return out;
}

// ── Behavior helpers ──────────────────────────────────────────────────────

function compile() {
  console.log('  [compile] tsc -p scripts/tsconfig.pressable-pins-test.json --outDir ' + outDir);
  try {
    execFileSync(process.execPath, [tscBin, '-p', harnessConfig, '--outDir', outDir], {
      stdio: 'inherit',
    });
  } catch {
    // A type error here is a FAILURE of the contract, not a harness bug: the
    // atom must typecheck against the token module and the RN double. Report
    // it as a failing pin so the suite's output stays comparable and a
    // regression reads as "which pin broke", not as a stack trace.
    failed += 1;
    console.error('  FAIL  the atom, the theme barrel and the RN double typecheck together');
    console.error('        see the tsc diagnostics above — a type error here is a press-');
    console.error('        contract regression (e.g. the barrel stopped exporting `motion`,');
    console.error('        or the atom stopped importing it)');
    console.error(`[tests] ${failed} failed, ${passed} passed`);
    process.exit(1);
  }
}

const originalResolveFilename = Module._resolveFilename;

function installRequireHook() {
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request === 'react-native') {
      request = join(outDir, 'scripts/test-stubs/pressable-rn.js');
    } else if (request.startsWith('@/')) {
      request = join(outDir, 'src', request.slice(2));
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
}

/**
 * Flatten a react-native style array into one object, LAST entry winning —
 * the same resolution order the runtime uses. `null` / `false` entries are
 * skipped, exactly as RN skips them.
 */
function flatten(style) {
  const entries = Array.isArray(style) ? style.flat(Infinity) : [style];
  const out = {};
  for (const entry of entries) {
    if (entry && typeof entry === 'object') Object.assign(out, entry);
  }
  return out;
}

async function renderPressable(props) {
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(Pressable, props));
  });
  const node = renderer.root.findByType('Pressable');
  return { node, unmount: () => act(async () => renderer.unmount()) };
}

let Pressable;

async function run() {
  console.log('\n[tests] compiling the Pressable atom against the harness RN double…');
  globalThis.__DEV__ = false;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  compile();
  installRequireHook();
  const atom = await import(pathToFileURL(join(outDir, 'src/components/atoms/Pressable/Pressable.js')).href);
  const theme = await import(pathToFileURL(join(outDir, 'src/theme/index.js')).href);
  Pressable = atom.Pressable;

  console.log('\n[tests] tokens (src/theme/motion.ts)\n');

  await test('motion.pressScale is the 0.98 default sink factor', () => {
    assert.equal(theme.motion.pressScale, 0.98, 'motion.pressScale must be 0.98');
  });

  await test('motion.pressDim is the 0.7 pressed-opacity style', () => {
    assert.deepEqual(theme.motion.pressDim, { opacity: 0.7 }, 'pressDim must be { opacity: 0.7 }');
  });

  await test('motion.disabledDim is the 0.5 disabled-opacity style', () => {
    assert.deepEqual(theme.motion.disabledDim, { opacity: 0.5 }, 'disabledDim must be { opacity: 0.5 }');
  });

  await test('motion.pressScaleStrong is the 0.97 strong-scale style', () => {
    assert.deepEqual(
      theme.motion.pressScaleStrong,
      { transform: [{ scale: 0.97 }] },
      'pressScaleStrong must be { transform: [{ scale: 0.97 }] }',
    );
  });

  await test('the @/theme barrel re-exports motion (no deep import is needed)', () => {
    assert.equal(theme.motion, theme.theme.motion, 'theme.motion === theme.theme.motion');
    assert.match(codeOf('src/theme/index.ts'), /export \{[^}]*\bmotion\b[^}]*\}/s, 'barrel must export motion');
  });

  console.log('\n[tests] the atom contract (Pressable.tsx)\n');

  await test('Pressable declares pressScale?: number | false with the motion default', () => {
    const code = codeOf('src/components/atoms/Pressable/Pressable.tsx');
    assert.match(code, /pressScale\?:\s*number\s*\|\s*false/, 'pressScale prop must be number | false');
    assert.match(code, /pressScale\s*=\s*motion\.pressScale/, 'pressScale must default to motion.pressScale');
  });

  await test('Pressable wires motion.pressDim on press and motion.disabledDim on disable', () => {
    const code = codeOf('src/components/atoms/Pressable/Pressable.tsx');
    assert.match(code, /state\.pressed\s*&&\s*pressedDim\s*\?\s*motion\.pressDim/, 'pressed branch must apply motion.pressDim');
    assert.match(code, /disabled\s*\?\s*motion\.disabledDim/, 'disabled branch must apply motion.disabledDim');
    // The tokens are the single source of truth: re-declaring the literals
    // here would fork the design system with a pin that never reads them.
    assert.doesNotMatch(code, /opacity:\s*0\.7\b/, 'no local press-dim literal in the atom');
    assert.doesNotMatch(code, /opacity:\s*0\.5\b/, 'no local disabled-dim literal in the atom');
  });

  console.log('\n[tests] consumer opt-outs\n');

  await test('Fab opts out of the press scale exactly once (tonal shift instead)', () => {
    const code = codeOf('src/components/molecules/Fab/Fab.tsx');
    const hits = code.match(/pressScale=\{false\}/g) ?? [];
    assert.equal(hits.length, 1, `Fab.tsx must carry exactly 1 pressScale={false}, found ${hits.length}`);
  });

  await test('the receipts photo backdrop opts out (an invisible layer must not scale)', () => {
    const code = codeOf('src/app/receipts/[id].tsx');
    assert.match(code, /onPress=\{handlePhotoBackdropPress\}\s*\n\s*pressScale=\{false\}/, 'backdrop Pressable must set pressScale={false}');
  });

  await test('CategoryPickerModal confirm buttons use the strong press scale', () => {
    const code = codeOf('src/features/tickets/components/CategoryPickerModal.tsx');
    assert.match(code, /import \{[^}]*\bmotion\b[^}]*\} from '@\/theme'/, 'the modal must import motion from the barrel');
    const strong = code.match(/pressedStyle=\{motion\.pressScaleStrong\}/g) ?? [];
    assert.equal(strong.length, 4, `all 4 confirm buttons must use motion.pressScaleStrong, found ${strong.length}`);
    const optedOut = code.match(/pressScale=\{false\}/g) ?? [];
    assert.equal(optedOut.length, 4, 'every strong-scale button must opt out of the default scale');
  });

  console.log('\n[tests] behavior — the resolved style the atom hands react-native\n');

  await test('pressed state applies motion.pressDim', async () => {
    const { node, unmount } = await renderPressable({ children: null });
    try {
      assert.equal(
        flatten(node.props.stylePressed).opacity,
        0.7,
        'the pressed style must resolve to motion.pressDim (0.7)',
      );
      assert.equal(
        flatten(node.props.styleRest).opacity,
        undefined,
        'the resting style must not be dimmed',
      );
    } finally {
      await unmount();
    }
  });

  await test('the default press state applies the motion.pressScale sink', async () => {
    const { node, unmount } = await renderPressable({ children: null });
    try {
      assert.deepEqual(
        flatten(node.props.stylePressed).transform,
        [{ scale: 0.98 }],
        'the pressed style must carry the 0.98 sink',
      );
      assert.equal(flatten(node.props.styleRest).transform, undefined, 'the resting style carries no transform');
    } finally {
      await unmount();
    }
  });

  await test('pressScale={false} produces NO scale transform, and pressedStyle still applies', async () => {
    const { node, unmount } = await renderPressable({
      children: null,
      pressScale: false,
      pressedStyle: theme.motion.pressScaleStrong,
    });
    try {
      const pressed = flatten(node.props.stylePressed);
      assert.deepEqual(
        pressed.transform,
        [{ scale: 0.97 }],
        'pressedStyle must be the ONLY transform on the pressed style',
      );
      assert.equal(flatten(node.props.styleRest).transform, undefined, 'resting style has no transform');
    } finally {
      await unmount();
    }
  });

  await test('pressedDim={false} suppresses the dim while keeping the scale', async () => {
    // The opt-out half of the contract. A surface that signals press with a
    // COLOR shift instead (the Fab) needs this; without the escape hatch it
    // would get the tonal dim as well and double up its feedback.
    const { node, unmount } = await renderPressable({ children: null, pressedDim: false });
    try {
      const pressed = flatten(node.props.stylePressed);
      assert.equal(pressed.opacity, undefined, 'the dim must be fully suppressed');
      assert.deepEqual(pressed.transform, [{ scale: 0.98 }], 'the scale sink still applies');
    } finally {
      await unmount();
    }
  });

  await test('a disabled pressable applies motion.disabledDim over its pressed state', async () => {
    const { node, unmount } = await renderPressable({ children: null, disabled: true });
    try {
      assert.equal(
        flatten(node.props.stylePressed).opacity,
        0.5,
        'the disabled dim must win over the pressed dim',
      );
      assert.equal(flatten(node.props.styleRest).opacity, 0.5, 'the resting (disabled) style is dimmed too');
    } finally {
      await unmount();
    }
  });

  console.log('\n[tests] bypass detection\n');

  await test('bypass: no string-valued pressScale prop anywhere in src/', () => {
    const offenders = srcFiles().filter((file) =>
      /pressScale\s*=\s*"/.test(stripComments(readFileSync(file, 'utf8'))),
    );
    assert.deepEqual(
      offenders.map((f) => relative(root, f)),
      [],
      'pressScale="false" is a truthy STRING and silently keeps the scale ON',
    );
  });

  await test('bypass: no Touchable family anywhere in src/ (the atom cannot be sidestepped)', () => {
    const family = /from 'react-native'/;
    const offenders = srcFiles().filter((file) => {
      const code = stripComments(readFileSync(file, 'utf8'));
      if (!/Touchable(Opacity|Highlight|WithoutFeedback|NativeFeedback)/.test(code)) return false;
      // The atom itself aliases react-native's Pressable; nothing else may.
      return !file.endsWith(join('src', 'components', 'atoms', 'Pressable', 'Pressable.tsx'));
    });
    assert.deepEqual(
      offenders.map((f) => relative(root, f)),
      [],
      'a Touchable* bypass gets stock react-native press feedback, not the token contract',
    );
    assert.ok(family, 'sanity: the react-native import specifier is the one being checked');
  });

  await test('bypass: motion is consumed through the @/theme barrel, never require()d or deep-imported', () => {
    const offenders = srcFiles().filter((file) => {
      const code = stripComments(readFileSync(file, 'utf8'));
      return (
        /require\(\s*['"][^'"]*theme\/motion/.test(code) ||
        /from '@\/theme\/motion/.test(code) ||
        /from '\.\.?\/[^']*theme\/motion/.test(code)
      );
    });
    assert.deepEqual(
      offenders.map((f) => relative(root, f)),
      [],
      'a deep/require import bypasses the barrel and forks the token module',
    );
  });

  await test('a caller\'s own transform WINS over the default press sink (array order)', async () => {
    // The single most fragile line in the atom. The default scale goes FIRST in
    // the style array so an explicit caller transform is not shadowed; the
    // reverse order renders every screen's intentional scale as a silent no-op.
    const { node, unmount } = await renderPressable({
      children: null,
      style: { transform: [{ scale: 0.5 }] },
    });
    try {
      assert.deepEqual(
        flatten(node.props.stylePressed).transform,
        [{ scale: 0.5 }],
        'the caller transform must win over the 0.98 default sink',
      );
      assert.deepEqual(
        flatten(node.props.styleRest).transform,
        [{ scale: 0.5 }],
        'the caller transform applies on rest too — it is the caller\'s own style',
      );
    } finally {
      await unmount();
    }
  });

  await test('bypass: the atom is the only file that aliases react-native Pressable', () => {
    const offenders = srcFiles().filter((file) =>
      /Pressable as RNPressable/.test(stripComments(readFileSync(file, 'utf8'))),
    );
    assert.deepEqual(
      offenders.map((f) => relative(root, f)),
      [join('src', 'components', 'atoms', 'Pressable', 'Pressable.tsx')],
      'only the atom may alias the raw pressable',
    );
  });

  console.log('\n[tests] suite cardinality\n');

  await test(`EXPECTED_TEST_COUNT guard: ${EXPECTED_TEST_COUNT} pins`, () => {
    assert.equal(
      testNames.length,
      EXPECTED_TEST_COUNT,
      `the harness declares ${EXPECTED_TEST_COUNT} pins but registered ${testNames.length} — update EXPECTED_TEST_COUNT when adding or removing a pin`,
    );
  });

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
process.exit(process.exitCode || 0);