#!/usr/bin/env node
/**
 * Subprocess driver for the UTC-vs-local month-key regression harness
 * (`test-budget-month-local.mjs`).
 *
 * Loads the COMPILED real `useHomeFeed.js` — the REAL `currentMonthKey`,
 * NOT the pinned test stub — with the same require-hook pattern the other
 * harnesses use, pins the clock to a fixed instant (env
 * `BUDGET_FIXED_INSTANT`, absolute ISO), and prints `currentMonthKey()` to
 * stdout. The parent harness spawns this with a controlled `TZ` env so the
 * local-vs-UTC month divergence is observable (Montevideo is UTC-3, no DST:
 *   - 2026-09-01T00:30:00Z → UTC '2026-09', Montevideo local '2026-08'
 *   - 2026-09-30T23:30:00Z → UTC '2026-09', Montevideo local '2026-09'
 * ).
 *
 * Usage: node scripts/test-budget-month-local-driver.mjs   (env-driven)
 */
import Module from 'node:module';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require_ = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.BUDGET_MONTH_OUT_DIR;
const fixedIso = process.env.BUDGET_FIXED_INSTANT;

if (!outDir || !fixedIso) {
  console.error('driver requires BUDGET_MONTH_OUT_DIR + BUDGET_FIXED_INSTANT env');
  process.exit(2);
}

// Pin the clock to the fixed instant BEFORE the module graph loads, so every
// `new Date()` / `Date.now()` inside currentMonthKey sees the same moment.
const RealDate = Date;
const fixed = new RealDate(fixedIso);
class FixedDate extends RealDate {
  constructor(...args) {
    super(...(args.length ? args : [fixedIso]));
  }
  static now() {
    return fixed.getTime();
  }
}
globalThis.Date = FixedDate;

// Require-hook: redirect the heavy/RN modules to their compiled stubs. The
// real compiled feature-access / query-adapters / format / query-keys run
// as-is; only the app-runtime surfaces (auth, supabase, RN) are stubbed.
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function rewrittenResolve(request, ...rest) {
  if (request === '@/features/auth') {
    request = join(outDir, 'scripts', 'test-stubs', 'auth.js');
  } else if (request === '@/lib/supabase') {
    request = join(outDir, 'scripts', 'test-stubs', 'supabase.js');
  } else if (request === '@/lib/supabase/storage-adapter') {
    request = join(outDir, 'scripts', 'test-stubs', 'storage-adapter.js');
  } else if (request === 'react-native') {
    request = join(outDir, 'scripts', 'test-stubs', 'react-native.js');
  } else if (request.startsWith('@/')) {
    request = join(outDir, 'src', request.slice(2));
  }
  return originalResolve.call(this, request, ...rest);
};

const mod = await import(
  pathToFileURL(join(outDir, 'src/features/home/hooks/useHomeFeed.js')).href
);
process.stdout.write(String(mod.currentMonthKey()));