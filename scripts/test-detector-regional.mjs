#!/usr/bin/env node
/**
 * Node harness for the REGIONAL half of the device-locale detector
 * (`src/i18n/detector.ts`).
 *
 * `test-i18n-detector.mjs` owns the language table. This file owns the
 * region: which Spanish regional override a tag selects, how an explicit
 * `regionCode` from `AppleLanguages`/NativeModules overrides the tag, the
 * fallback CHAIN each regional locale inherits, and the viability
 * thresholds that decide whether a region is worth shipping at all.
 *
 * ── The rule this file exists to pin ──────────────────────────────────────
 * Spanish regionalizes three ways, and conflating them is the bug the
 * `es-419` base was introduced to prevent:
 *
 *   es-AR   voseo — Argentina (and Uruguay). "Ingresá un nombre".
 *   es-ES   peninsular — Spain. "Introduce un nombre", "Muévela".
 *   es-419  NEUTRAL LATIN AMERICAN — everything else. "Ingresa un nombre".
 *
 * `es-419` is not a synonym for `es-AR` and it is emphatically not a
 * fallback for a region the app does not know. It is the BASE: a Mexican
 * or Colombian reader must get tú-form neutral Spanish, never Argentine
 * voseo, and must never be handed English because their country has no
 * override.
 *
 * ── Why `regionCode` is a separate argument ───────────────────────────────
 * `AppleLanguages`/`getLocales()` return the user's PREFERRED languages,
 * but iOS/Android will happily report `es-MX` for a device whose region
 * setting is Argentina, and vice versa. The region the user is actually IN
 * is the stronger signal for a dialect decision, so the store passes
 * `regionCode` and it wins. Both are pure inputs: no clock, no `Intl`,
 * no environment, so every case below is a fixed pair.
 *
 * Usage: pnpm test:detector-regional
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
const harnessConfig = join(__dirname, 'tsconfig.i18n-detector-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'detector-regional-test-'));
const outDir = join(workdir, 'out');

let passed = 0;
let failed = 0;

async function test(name, fn) {
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

function compile() {
  execFileSync(
    process.execPath,
    [tscBin, '-p', harnessConfig, '--outDir', outDir],
    { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] },
  );
}

async function run() {
  console.log('\n[tests] compiling detector module…');
  compile();
  console.log('[tests] loading compiled module…');
  const mod = await import(
    pathToFileURL(join(outDir, 'src/i18n/detector.js')).href
  );

  console.log('\n[tests] regional Spanish mapping (tag only)\n');

  await test('es-AR → es-AR (voseo)', () => {
    assert.equal(mod.detectLocale('es-AR'), 'es-AR');
  });

  await test('es_AR (underscore form) → es-AR', () => {
    // `Intl`/`NSLocale` can hand back underscores; a hyphen-only split
    // would treat `es_AR` as an unknown tag and drop the reader to `en`.
    assert.equal(mod.detectLocale('es_AR'), 'es-AR');
  });

  await test('es-UY → es-419 (the voseo override is scoped to Argentina)', () => {
    // Linguistically Uruguay is voseo, so `UY → es-AR` would be defensible.
    // The design scoped the voseo override to `AR` alone, so a Uruguayan
    // device gets tú-form neutral Spanish today. Pinned deliberately so the
    // behaviour is DOCUMENTED rather than accidental — widening the map to
    // `UY`/`PY` is a copy decision that needs its own native-speaker pass,
    // not something a harness should quietly assume.
    assert.equal(mod.detectLocale('es-UY'), 'es-419');
  });

  await test('es-ES → es-ES (peninsular)', () => {
    assert.equal(mod.detectLocale('es-ES'), 'es-ES');
  });

  await test('es-419 → es-419 (the neutral base addresses itself)', () => {
    assert.equal(mod.detectLocale('es-419'), 'es-419');
  });

  await test('bare "es" → es-419 (no region means no regional override)', () => {
    // Not `es-AR`. With no region the honest answer is the base: picking
    // voseo here is the exact bug this harness guards.
    assert.equal(mod.detectLocale('es'), 'es-419');
  });

  await test('es-MX → es-419', () => {
    assert.equal(mod.detectLocale('es-MX'), 'es-419');
  });

  await test('es-CL → es-419', () => {
    assert.equal(mod.detectLocale('es-CL'), 'es-419');
  });

  await test('es-CO → es-419', () => {
    assert.equal(mod.detectLocale('es-CO'), 'es-419');
  });

  await test('es-PE → es-419', () => {
    assert.equal(mod.detectLocale('es-PE'), 'es-419');
  });

  await test('es-US → es-419 (region outside the map falls to the base, never to en)', () => {
    assert.equal(mod.detectLocale('es-US'), 'es-419');
  });

  console.log('\n[tests] explicit regionCode wins over the tag\n');

  await test("es-AR + regionCode 'AR' → es-AR", () => {
    assert.equal(mod.detectLocale('es-AR', 'AR'), 'es-AR');
  });

  await test("es-MX + regionCode 'AR' → es-AR (device region beats the language tag)", () => {
    // The device is IN Argentina; a Mexican language preference does not
    // change that the user reads voseo.
    assert.equal(mod.detectLocale('es-MX', 'AR'), 'es-AR');
  });

  await test("es-MX + regionCode 'MX' → es-419", () => {
    assert.equal(mod.detectLocale('es-MX', 'MX'), 'es-419');
  });

  await test("es + regionCode 'ES' → es-ES (a bare tag plus a region resolves the region)", () => {
    assert.equal(mod.detectLocale('es', 'ES'), 'es-ES');
  });

  await test("es-AR + regionCode 'ES' → es-ES (region wins even against an explicit regional tag)", () => {
    assert.equal(mod.detectLocale('es-AR', 'ES'), 'es-ES');
  });

  await test("es-419 + regionCode '419' → es-419 (the base survives a redundant region)", () => {
    assert.equal(mod.detectLocale('es-419', '419'), 'es-419');
  });

  await test('en-US + regionCode AR → en (a non-Spanish language is not regionalized)', () => {
    // The region argument only disambiguates SPANISH. Letting it divert
    // `en-US` to Spanish on an Argentine device would be nonsense.
    assert.equal(mod.detectLocale('en-US', 'AR'), 'en');
  });

  console.log('\n[tests] fallback chain (every chain ends in `en`)\n');

  await test('es-AR inherits es-419 then en', () => {
    assert.deepEqual(mod.FALLBACK_CHAIN['es-AR'], ['es-419', 'en']);
  });

  await test('es-ES inherits es-419 then en', () => {
    assert.deepEqual(mod.FALLBACK_CHAIN['es-ES'], ['es-419', 'en']);
  });

  await test('es-419 falls back only to en', () => {
    assert.deepEqual(mod.FALLBACK_CHAIN['es-419'], ['en']);
  });

  await test('every supported locale terminates in the global default', () => {
    // A chain that dead-ends renders raw keys. `en` is the terminus for all
    // five, so no locale can ever resolve to nothing.
    for (const locale of mod.SUPPORTED_LOCALES) {
      const chain = mod.FALLBACK_CHAIN[locale];
      assert.ok(Array.isArray(chain) && chain.length > 0, `${locale} has no chain`);
      assert.equal(chain[chain.length - 1], 'en', `${locale} chain must end in en`);
    }
  });

  await test('a regional chain NEVER includes a sibling region', () => {
    // `es-AR → es-ES` would let a Peninsular imperative bleed into an
    // Argentine banner. Siblings are peers, not fallbacks.
    for (const region of ['es-AR', 'es-ES']) {
      const chain = mod.FALLBACK_CHAIN[region];
      for (const sibling of ['es-AR', 'es-ES']) {
        if (sibling === region) continue;
        assert.ok(!chain.includes(sibling), `${region} must not fall back to ${sibling}`);
      }
    }
  });

  console.log(`\n[tests] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  rmSync(workdir, { recursive: true, force: true });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});