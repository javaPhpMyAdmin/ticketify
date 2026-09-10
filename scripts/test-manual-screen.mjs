#!/usr/bin/env node
/**
 * Node harness for the PR3 pure screen logic (manual-purchase-entry):
 *
 *   - Date-picker calendar  (src/components/molecules/DatePickerField/calendar.ts)
 *       monthGrid, daysInMonth, isoFromParts, partsFromISO, isFutureISO,
 *       formatDateES, fullMonthES, pad2, weekdayLabels
 *   - Manual-form helpers   (src/features/tickets/manual-form.ts)
 *       autoTotal, formatManualErrors, buildEditorReviewItem,
 *       parseQuantity, emptyManualDraft
 *
 * calendar.ts is 100% pure (no imports). manual-form.ts imports tempId from
 * @/lib/format (stubbed) and MANUAL_FORM_ERROR from manual-receipt.ts
 * (compiled from source into the same workdir, same rewrites as
 * test-manual-receipt.mjs).
 *
 * Usage: pnpm test:manual-screen
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const tscBin = require.resolve('typescript/bin/tsc');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'manual-screen-test-'));
const srcDir = join(workdir, 'src');
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
// Compilation — self-contained workdir (mirrors test-manual-receipt.mjs)
// ---------------------------------------------------------------------------

/** Applies the @/ import rewrites a module needs to resolve in the workdir. */
function patchImports(source, rewrites) {
  let out = source;
  for (const [pattern, replacement] of rewrites) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

const FORMAT_REWRITE = [/from ['"]@\/lib\/format['"]/g, "from '../lib-stubs/format'"];
const MANUAL_REWRITES = [
  FORMAT_REWRITE,
  [/from ['"]@\/types['"]/g, "from '../lib-stubs/types'"],
];
const FORM_REWRITES = [
  FORMAT_REWRITE,
  [/from ['"]@\/types['"]/g, "from '../lib-stubs/types'"],
  [
    /from ['"]@\/features\/tickets\/manual-receipt['"]/g,
    "from './manual-receipt'",
  ],
];

function compile() {
  mkdirSync(srcDir, { recursive: true });
  mkdirSync(join(workdir, 'lib-stubs'), { recursive: true });

  // --- calendar.ts — PR 2 wraps formatDate from @/lib/format; rewrite to the
// local stub (same pattern as the manual-form rewrites below).
  const calendarSource = patchImports(
    readFileSync(
      join(root, 'src/components/molecules/DatePickerField/calendar.ts'),
      'utf8',
    ),
    [FORMAT_REWRITE],
  );
  writeFileSync(join(srcDir, 'calendar.ts'), calendarSource);

  // --- manual-receipt.ts — same rewrites as the existing harness ---
  const manualSource = patchImports(
    readFileSync(join(root, 'src/features/tickets/manual-receipt.ts'), 'utf8'),
    MANUAL_REWRITES,
  );
  writeFileSync(join(srcDir, 'manual-receipt.ts'), manualSource);

  // --- manual-form.ts — imports tempId (format stub) + MANUAL_FORM_ERROR ---
  const formSource = patchImports(
    readFileSync(join(root, 'src/features/tickets/manual-form.ts'), 'utf8'),
    FORM_REWRITES,
  );
  writeFileSync(join(srcDir, 'manual-form.ts'), formSource);

  // --- Stub modules ---
  writeFileSync(
    join(workdir, 'lib-stubs/format.ts'),
    `
    let _c = 0;
    export const tempId = () => 'test-' + (++_c);
    export const todayLocalISO = () => '2026-09-07';
    export const formatCurrency = (v: number, c = 'UYU') => c + ' ' + v;
    // PR 2 canonical API (calendar.ts imports formatDate from @/lib/format).
    // The manual-screen harness cares about the es-AR trigger output, so we
    // mirror the es-AR short-month contract in the stub.
    const MONTHS_ABBR_ES_AR = [
      'ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic',
    ];
    function pad2(n: number) { return String(n).padStart(2, '0'); }
    export function formatDate(
      locale: 'en' | 'es-AR' | 'pt-BR',
      iso: string,
      opts: { todayISO?: string } = {},
    ): string {
      const todayISO = opts.todayISO ?? todayLocalISO();
      if (iso === todayISO) return 'Hoy';
      const m = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(todayISO);
      if (m) {
        const [, ty, tm, td] = m.map(Number) as unknown as [string, number, number, number];
        const d = new Date(ty, tm - 1, td - 1);
        const yestISO = \`\${d.getFullYear()}-\${pad2(d.getMonth() + 1)}-\${pad2(d.getDate())}\`;
        if (iso === yestISO) return 'Ayer';
      }
      const parts = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(iso);
      if (!parts) return iso;
      const month = Number(parts[2]);
      return \`\${parts[3]} \${MONTHS_ABBR_ES_AR[month - 1]} \${parts[1]}\`;
    }
  `,
  );
  writeFileSync(
    join(workdir, 'lib-stubs/types.ts'),
    `
    export type PaymentMethod =
      | 'cash' | 'card' | 'apple_pay' | 'google_pay' | 'transfer' | 'other';
    export type CardType = 'debit' | 'credit';
    export interface ReviewItem {
      temp_id: string;
      name: string;
      quantity: number;
      unit_price: number;
      total_price: number;
      category_id: string | null;
      is_impulse: boolean;
      ai_suggested_category_id: string | null;
    }
    export interface ReceiptDraft {
      store_name: string;
      purchase_date: string;
      total: number;
      payment_method: PaymentMethod;
      is_manual?: boolean;
      image_url: string;
      card_brand?: string | null;
      card_type?: CardType | null;
      items: ReviewItem[];
    }
  `,
  );

  // Type-check + emit the workdir sources (mirrors the existing harness)
  const tsconfig = join(workdir, 'tsconfig.json');
  writeFileSync(
    tsconfig,
    JSON.stringify({
      compilerOptions: {
        module: 'commonjs',
        target: 'es2020',
        lib: ['es2020', 'dom'],
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        rootDir: '.',
        outDir: './out',
      },
      include: ['./src/*.ts', './lib-stubs/*.ts'],
    }),
  );
  try {
    execFileSync(process.execPath, [tscBin, '-p', tsconfig], {
      cwd: workdir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    // Re-throw with the tsc output attached so a compile failure shows the
    // actual diagnostics instead of a bare command-failed error.
    const output = String(err.stdout || '') + String(err.stderr || '');
    err.message = `${err.message}\n${output}`;
    throw err;
  }
}

const OUT_DIR = join(workdir, 'out', 'src');

function importOut(name) {
  return import(pathToFileURL(join(OUT_DIR, name)).href);
}

// ---------------------------------------------------------------------------
// Calendar tests
// ---------------------------------------------------------------------------

const TODAY = '2026-09-07';

async function calendarTests(calendar) {
  const {
    monthGrid,
    daysInMonth,
    isoFromParts,
    partsFromISO,
    isFutureISO,
    isFutureSelection,
    weekdayLabels,
    formatDateES,
    fullMonthES,
    pad2,
  } = calendar;

  await test('daysInMonth: feb 2026 = 28, feb 2024 (leap) = 29', () => {
    assert.equal(daysInMonth(2026, 1), 28);
    assert.equal(daysInMonth(2024, 1), 29);
    assert.equal(daysInMonth(2026, 8), 30); // septiembre
    assert.equal(daysInMonth(2026, 11), 31); // diciembre
  });

  await test('pad2 pads single digits', () => {
    assert.equal(pad2(5), '05');
    assert.equal(pad2(12), '12');
  });

  await test('isoFromParts: full selection builds YYYY-MM-DD', () => {
    assert.equal(isoFromParts({ year: 2026, month: 9, day: 7 }), '2026-09-07');
    assert.equal(isoFromParts({ year: 2026, month: 12, day: 31 }), '2026-12-31');
  });

  await test('isoFromParts: null part → null (incomplete selection)', () => {
    assert.equal(isoFromParts({ year: 2026, month: 9, day: null }), null);
    assert.equal(isoFromParts({ year: null, month: 9, day: 7 }), null);
  });

  await test('partsFromISO: round-trips a valid ISO date', () => {
    assert.deepEqual(partsFromISO('2026-09-07'), {
      year: 2026,
      month: 9,
      day: 7,
    });
  });

  await test('partsFromISO: rejects invalid dates and garbage', () => {
    assert.equal(partsFromISO('2026-02-30'), null); // calendar impossible
    assert.equal(partsFromISO('2026-13-01'), null); // month out of range
    assert.equal(partsFromISO('2026-09'), null); // not a full date
    assert.equal(partsFromISO('foo'), null);
    assert.equal(partsFromISO(null), null);
    assert.equal(partsFromISO(undefined), null);
  });

  await test('monthGrid: Jan 2026 starts Thu (Monday-first → lead 3)', () => {
    // 2026-01-01 is a Thursday (getDay() === 4 → monday-first lead = (4+6)%7 = 3)
    const grid = monthGrid(2026, 0, true);
    assert.equal(grid.length, 3 + 31);
    assert.deepEqual(grid.slice(0, 3), [null, null, null]);
    assert.equal(grid[3], 1);
    assert.equal(grid[grid.length - 1], 31);
  });

  await test('monthGrid: Sunday-first alignment differs from Monday-first', () => {
    // Sunday-first: Jan 1 (Thu, day 4) → lead 4; Monday-first → lead 3.
    assert.equal(monthGrid(2026, 0, false).length, 4 + 31);
    assert.equal(monthGrid(2026, 0, true).length, 3 + 31);
  });

  await test('weekdayLabels: Monday-first header is es-AR L M M J V S D', () => {
    assert.deepEqual(weekdayLabels(true), ['L', 'M', 'M', 'J', 'V', 'S', 'D']);
    assert.deepEqual(weekdayLabels(false), ['D', 'L', 'M', 'M', 'J', 'V', 'S']);
  });

  await test('isFutureISO: compares chronologically via ISO strings', () => {
    assert.equal(isFutureISO('2026-09-08', TODAY), true);
    assert.equal(isFutureISO('2026-09-07', TODAY), false); // today is allowed
    assert.equal(isFutureISO('2026-09-06', TODAY), false);
    assert.equal(isFutureISO('2025-01-01', TODAY), false);
  });

  await test('isFutureSelection: incomplete selection is never future', () => {
    assert.equal(
      isFutureSelection({ year: 2026, month: 10, day: null }, TODAY),
      false,
    );
    assert.equal(
      isFutureSelection({ year: 2026, month: 10, day: 1 }, TODAY),
      true,
    );
    assert.equal(
      isFutureSelection({ year: 2026, month: 9, day: 7 }, TODAY),
      false,
    );
  });

  await test('formatDateES: es-AR short format d mon yyyy', () => {
    assert.equal(formatDateES('2026-09-07', TODAY), 'Hoy');
    assert.equal(formatDateES('2026-09-06', TODAY), 'Ayer');
    assert.equal(formatDateES('2026-08-15', TODAY), '15 ago 2026');
    assert.equal(formatDateES(null, TODAY), 'Elegir fecha');
    assert.equal(formatDateES('garbage', TODAY), 'Elegir fecha');
  });

  await test('fullMonthES: full Spanish month names', () => {
    assert.equal(fullMonthES(0), 'enero');
    assert.equal(fullMonthES(8), 'septiembre');
    assert.equal(fullMonthES(11), 'diciembre');
    assert.equal(fullMonthES(12), '');
  });
}

// ---------------------------------------------------------------------------
// Manual-form tests
// ---------------------------------------------------------------------------

function item(overrides = {}) {
  return {
    temp_id: 'item-1',
    name: 'Café',
    quantity: 2,
    unit_price: 250,
    total_price: 500,
    category_id: null,
    is_impulse: false,
    ai_suggested_category_id: null,
    ...overrides,
  };
}

async function manualFormTests(form) {
  const {
    autoTotal,
    formatManualErrors,
    buildEditorReviewItem,
    parseQuantity,
    emptyManualDraft,
  } = form;

  await test('autoTotal: 0 for empty list', () => {
    assert.equal(autoTotal([]), 0);
  });

  await test('autoTotal: sums quantity × unit_price', () => {
    const items = [
      item({ quantity: 2, unit_price: 250, total_price: 500 }),
      item({ temp_id: 'item-2', quantity: 1, unit_price: 100, total_price: 100 }),
      item({ temp_id: 'item-3', quantity: 3, unit_price: 50, total_price: 150 }),
    ];
    assert.equal(autoTotal(items), 750);
  });

  await test('autoTotal: uses qty×price, not the stored total_price', () => {
    // Even if total_price is stale/wrong, auto-total recomputes from qty×price.
    const items = [item({ quantity: 3, unit_price: 100, total_price: 999 })];
    assert.equal(autoTotal(items), 300);
  });

  await test('formatManualErrors: maps stable codes to es-AR messages', () => {
    const messages = formatManualErrors([
      'store_required',
      'items_required',
      'quantity_invalid',
    ]);
    assert.deepEqual(messages, [
      'Ingresá el nombre de la tienda',
      'Agregá al menos un artículo',
      'La cantidad debe ser un número entero mayor a cero',
    ]);
  });

  await test('formatManualErrors: total/price/date codes map too', () => {
    const messages = formatManualErrors([
      'total_invalid',
      'price_invalid',
      'date_required',
    ]);
    assert.deepEqual(messages, [
      'El total no puede ser negativo',
      'El precio unitario no puede ser negativo',
      'Elegí una fecha válida',
    ]);
  });

  await test('formatManualErrors: drops unknown codes and dedupes', () => {
    assert.deepEqual(
      formatManualErrors(['unknown_code', 'store_required', 'store_required']),
      ['Ingresá el nombre de la tienda'],
    );
    assert.deepEqual(formatManualErrors([]), []);
  });

  await test('buildEditorReviewItem: computes total_price and trims name', () => {
    const built = buildEditorReviewItem({
      name: '  Café con leche  ',
      quantity: 2,
      unit_price: 150,
    });
    assert.equal(built.name, 'Café con leche');
    assert.equal(built.total_price, 300);
    assert.equal(built.is_impulse, false);
    assert.equal(built.ai_suggested_category_id, null);
    assert.equal(built.category_id, null);
    assert.ok(built.temp_id.length > 0, 'has a temp_id');
  });

  await test('buildEditorReviewItem: empty name falls back to Sin nombre', () => {
    const built = buildEditorReviewItem({
      name: '   ',
      quantity: 1,
      unit_price: 0,
    });
    assert.equal(built.name, 'Sin nombre');
  });

  await test('parseQuantity: rejects non-integers, empty and garbage', () => {
    // parseInt('2.5') would silently coerce → 2; the helper must reject it.
    assert.equal(parseQuantity('2.5'), null);
    assert.equal(parseQuantity('1.2.3'), null);
    assert.equal(parseQuantity(''), null);
    assert.equal(parseQuantity('abc'), null);
    assert.equal(parseQuantity('0'), null); // "entero mayor a cero"
  });

  await test('parseQuantity: accepts integers with trim', () => {
    assert.equal(parseQuantity('2'), 2);
    assert.equal(parseQuantity('10'), 10);
    assert.equal(parseQuantity(' 3 '), 3);
    assert.equal(parseQuantity('007'), 7);
  });

  await test('emptyManualDraft: REQ-002 default payment is other, no card type', () => {
    assert.deepEqual(emptyManualDraft(), {
      payment_method: 'other',
      card_type: null,
    });
  });
}

async function run() {
  try {
    compile();
  } catch (err) {
    console.error('[tests] FATAL: compilation failed');
    console.error(String((err && err.stack) || err));
    process.exitCode = 1;
    return;
  }

  const calendar = await importOut('calendar.js');
  await calendarTests(calendar);
  const form = await importOut('manual-form.js');
  await manualFormTests(form);

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