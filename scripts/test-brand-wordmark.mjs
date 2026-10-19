#!/usr/bin/env node
/**
 * Render harness for `BrandWordmark` — the shared cold-boot brand text rendered
 * by both `<BootSplash>` (headline) and `<BootSplashErrorBoundary>` (fallback).
 *
 * Regression guard for #202 (the final "y" of "Ticketify" was clipped on
 * Android cold start). The prior guard was a SOURCE pin (`grep "Ticketify{' '}"`
 * in the component file). That is tautological — it proves the token is in the
 * file, not that the RENDERED tree carries it, which is how the bug once
 * survived a green CI. This harness renders the atom with the real
 * react-test-renderer and asserts the FLATTENED TEXT LEAVES instead.
 *
 * What it proves (and what it does NOT):
 *   - Proves the trailing-space slack reaches the rendered output — the atom
 *     must emit exactly "Ticketify " (with the space), and must not silently
 *     trim it back to "Ticketify" (the #202 regression).
 *   - Proves `accessibilityLabel` is "Ticketify" — the layout-only slack must
 *     not leak into what a screen reader announces.
 *   - Proves the call-site `style` is forwarded (headline vs fallback type).
 *   - Does NOT prove the Android 15+ glyph clip is gone. No JS test can; that
 *     needs a physical Android 15+ device with the system font size enlarged.
 *     The trailing space is the mitigation; the device is the only real proof.
 *
 * Usage: pnpm test:brand-wordmark
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require_ = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const tscBin = require_.resolve('typescript/bin/tsc');
const harnessConfig = join(__dirname, 'tsconfig.brand-wordmark-test.json');

// React and react-test-renderer are native CJS packages: load them through
// createRequire (NOT bare require — that trips node's ESM/CJS ambiguity
// detector next to top-level await).
const React = require_('react');
const TestRenderer = require_('react-test-renderer');
const { act, create } = TestRenderer;

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'brand-wordmark-test-'));
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

// ---------------------------------------------------------------------------
// Require-hook: the real `react-native` cannot load in plain node (flow
// syntax + native bindings) — redirect it to the stub the harness compiles.
// ---------------------------------------------------------------------------
function installRequireHook() {
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function rewrittenResolve(request, ...rest) {
    if (request === 'react-native') {
      request = join(outDir, 'scripts', 'test-stubs', 'react-native.js');
    } else if (request.startsWith('@/')) {
      request = join(outDir, 'src', request.slice(2));
    }
    return originalResolve.call(this, request, ...rest);
  };
}

function compile() {
  execFileSync(process.execPath, [tscBin, '-p', harnessConfig, '--outDir', outDir], {
    cwd: root,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
}

/** Every string leaf of a react-test-renderer JSON tree, flattened. */
function flattenStrings(node) {
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(flattenStrings);
  if (node && typeof node === 'object') return flattenStrings(node.children);
  return [];
}

/**
 * THE invariant under test: the flattened render tree must end with the
 * trailing-space slack. Shared by the positive assertion and the negative
 * control so both exercise the SAME predicate (else the control would prove
 * nothing about the assertion it is meant to protect).
 */
function textEndsWithSlack(json) {
  return flattenStrings(json).join('').endsWith(' ');
}

function render(element) {
  let renderer;
  act(() => {
    renderer = create(element);
  });
  return renderer;
}

async function run() {
  installRequireHook();
  compile();

  const { BrandWordmark } = await import(
    pathToFileURL(
      join(outDir, 'src', 'components', 'atoms', 'BrandWordmark', 'BrandWordmark.js'),
    ).href
  );

  console.log('\n[tests] BrandWordmark — the Android clip slack reaches the rendered tree\n');

  await test('renders exactly "Ticketify " (trailing space = clip slack, not trimmed)', () => {
    const json = render(React.createElement(BrandWordmark, {})).toJSON();
    assert.equal(json.type, 'Text', 'the atom must render a single <Text> host element');
    assert.equal(
      flattenStrings(json).join(''),
      'Ticketify ',
      'the rendered text must be "Ticketify " (trailing space = Android clip slack); "Ticketify" means the fix regressed',
    );
    assert.ok(
      textEndsWithSlack(json),
      'the flattened render tree must end with the slack space — a trimmed "Ticketify" re-introduces #202',
    );
  });

  await test('negative control: the predicate rejects the trimmed "Ticketify" (#202 form)', () => {
    // Render the broken shape through the SAME stub (`<Text>Ticketify</Text>`,
    // no slack — what the code did when #202 resurfaced) and confirm the shared
    // predicate `textEndsWithSlack` goes false for it. Without this control the
    // predicate could be trivially true and guard nothing.
    const { Text } = require_(
      join(outDir, 'scripts', 'test-stubs', 'react-native.js'),
    );
    const json = render(React.createElement(Text, null, 'Ticketify')).toJSON();
    assert.equal(
      flattenStrings(json).join(''),
      'Ticketify',
      'the control must render the untrimmed-mock "Ticketify"',
    );
    assert.ok(
      !textEndsWithSlack(json),
      'the trimmed form must NOT satisfy textEndsWithSlack — otherwise the guard is vacuous',
    );
  });

  await test('exposes accessibilityLabel "Ticketify" so screen readers skip the layout slack', () => {
    const json = render(React.createElement(BrandWordmark, {})).toJSON();
    assert.equal(
      json.props.accessibilityLabel,
      'Ticketify',
      'the atom must set accessibilityLabel="Ticketify" (no trailing space)',
    );
  });

  await test('forwards the call-site style (headline vs fallback typography differ)', () => {
    const style = { fontSize: 24, fontWeight: '700' };
    const json = render(React.createElement(BrandWordmark, { style })).toJSON();
    assert.deepEqual(
      json.props.style,
      style,
      'the style prop must reach the rendered <Text> so each call site keeps its own typography',
    );
  });

  console.log(
    `\n[brand-wordmark] ${passed} passed, ${failed} failed (${passed + failed} total)\n`,
  );
}

try {
  await run();
} finally {
  // Match the sibling harnesses: never leave the compiled temp dir behind.
  rmSync(workdir, { recursive: true, force: true });
}

if (failed > 0) process.exitCode = 1;
