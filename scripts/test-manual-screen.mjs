#!/usr/bin/env node
/**
 * Node harness for the PR3 pure screen logic (manual-purchase-entry):
 *
 *   - Date-picker calendar  (src/components/molecules/DatePickerField/calendar.ts)
 *       monthGrid, daysInMonth, isoFromParts, partsFromISO, isFutureISO,
 *       fullMonthES, pad2, weekdayLabels
 *   - Manual-form helpers   (src/features/tickets/manual-form.ts)
 *       autoTotal, formatManualErrors, buildEditorReviewItem,
 *       parseQuantity, emptyManualDraft
 *
 * PR 3 (`app-i18n`): `calendar.ts` now reads the locale-aware month and
 * weekday names through `i18next.t('date:monthFull.<n>')` /
 * `i18next.t('date:weekdayMonFirst', { returnObjects: true })`. The
 * harness ships an `i18next` stub in `lib-stubs/i18next.ts` that mirrors
 * the `date` namespace so `fullMonthES` and `weekdayLabels` resolve to
 * the expected es-AR strings without booting a real i18next runtime.
 *
 * `formatDateES` was REMOVED in PR 3 (the legacy wrapper around
 * `formatDate('es-AR', ...)`) — the canonical API is now exercised
 * directly via the `format` stub (which already implements the es-AR
 * contract).
 *
 * PR 7 (`category-management`, slice 3/7): the category PICKER create
 * path. Pure logic from `src/features/tickets/category-picker-form.ts`
 * (list rows from the merged catalog, canonical fallback rows, create
 * validation with the 40-char guardrail + palette + kind, collision
 * pre-block, error-key bridge) plus the i18n parity contract: the three
 * `tickets.json` catalogs must carry IDENTICAL key sets and every
 * category-create error key must resolve in all three locales, with the
 * es-AR collision copy converging on the API seam message
 * (`CATEGORY_ALREADY_EXISTS_MESSAGE`).
 *
 * The taxonomy + catalog modules are pure (catalog.ts has no imports;
 * home/categories.ts only imports a TYPE), so the harness compiles the
 * REAL sources into the workdir — no hand-rolled fixtures for the row
 * shape, the palette, or the canonical slug list.
 *
 * Usage: pnpm test:manual-screen
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
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
// PR 3: calendar.ts reads month/weekday names via `i18next.t()`. The
// harness ships a tiny i18next stub in lib-stubs/ that mirrors the `date`
// namespace; rewrite the bare-specifier import to the local stub so the
// compiled module resolves it inside the workdir.
const I18NEXT_REWRITE = [
  /from ['"]i18next['"]/g,
  "from '../lib-stubs/i18next'",
];
const CALENDAR_REWRITES = [FORMAT_REWRITE, I18NEXT_REWRITE];
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
// PR 7 (`category-management`, slice 3/7): catalog + taxonomy compile as
// compiled REAL sources — catalog.ts is import-free, home/categories.ts
// only imports a TYPE (`IconName`), so the rewrites are one-liners.
const CATALOG_REWRITES = [
  [/from ['"]@\/types['"]/g, "from '../lib-stubs/types'"],
];
const HOME_CATEGORIES_REWRITES = [
  [/from ['"]@\/components['"]/g, "from '../lib-stubs/types'"],
];
const PICKER_FORM_REWRITES = [
  [/from ['"]@\/types['"]/g, "from '../lib-stubs/types'"],
  [/from ['"]@\/components['"]/g, "from '../lib-stubs/types'"],
  [
    /from ['"]@\/features\/categories\/catalog['"]/g,
    "from './catalog'",
  ],
  [
    /from ['"]@\/features\/home\/categories['"]/g,
    "from './categories'",
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
    CALENDAR_REWRITES,
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

  // --- catalog.ts — pure (change `category-management`); only @/types ---
  const catalogSource = patchImports(
    readFileSync(join(root, 'src/features/categories/catalog.ts'), 'utf8'),
    CATALOG_REWRITES,
  );
  writeFileSync(join(srcDir, 'catalog.ts'), catalogSource);

  // --- home taxonomy — the canonical 13 (type-only @/components import) ---
  const homeCategoriesSource = patchImports(
    readFileSync(join(root, 'src/features/home/categories.ts'), 'utf8'),
    HOME_CATEGORIES_REWRITES,
  );
  writeFileSync(join(srcDir, 'categories.ts'), homeCategoriesSource);

  // --- category-picker-form.ts — NEW in slice 3/7; guarded so the RED
  // phase runs cleanly before the module lands (ERR_MODULE_NOT_FOUND is
  // the expected RED signal, not a compile failure).
  const pickerFormPath = join(
    root,
    'src/features/tickets/category-picker-form.ts',
  );
  if (existsSync(pickerFormPath)) {
    const pickerFormSource = patchImports(
      readFileSync(pickerFormPath, 'utf8'),
      PICKER_FORM_REWRITES,
    );
    writeFileSync(join(srcDir, 'category-picker-form.ts'), pickerFormSource);
  }

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
    const MONTHS_FULL_ES_AR = [
      'enero','febrero','marzo','abril','mayo','junio','julio','agosto',
      'septiembre','octubre','noviembre','diciembre',
    ];
    // Mirrors fullMonthForLocale in src/lib/format.ts: 1-BASED month
    // argument (September = 9). The date-picker component state and
    // monthGrid are 0-based (September = 8) — the two conventions coexist
    // and are pinned together by the convention test below.
    export function fullMonthForLocale(locale: string, month: number): string {
      return MONTHS_FULL_ES_AR[month - 1] ?? '';
    }
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
    // PR 7 (category-management): the compiled catalog.ts +
    // category-picker-form.ts need the app-wide Category shape; the
    // home taxonomy needs an IconName stand-in (string, since the real
    // union is a component-type import the harness cannot resolve).
    export type IconName = string;
    export type CategoryKind = 'need' | 'want';
    export interface Category {
      id: string;
      slug: string;
      name: string;
      kind: CategoryKind;
      icon: string;
      color: string;
      sort_order: number;
    }
  `,
  );
  // PR 3 (`app-i18n`): `calendar.ts` now reads month / weekday names
  // through `i18next.t('date:monthFull.<n>')` /
  // `i18next.t('date:weekdayMonFirst', { returnObjects: true })`. The
  // harness ships a stub so the compiled module resolves the `date`
  // namespace without booting a real i18next runtime.
  writeFileSync(
    join(workdir, 'lib-stubs/i18next.ts'),
    `
    // PR 3: minimal i18next stub mirrors the date namespace keys the
    // calendar reads via i18next.t(). returnObjects=true returns the
    // whole leaf (used for the weekday headers).
    const dateNs: Record<string, any> = {
      'monthFull': {
        '0': 'enero','1': 'febrero','2': 'marzo','3': 'abril','4': 'mayo','5': 'junio',
        '6': 'julio','7': 'agosto','8': 'septiembre','9': 'octubre','10': 'noviembre','11': 'diciembre',
      },
      'monthAbbr': {
        '0': 'ene','1': 'feb','2': 'mar','3': 'abr','4': 'may','5': 'jun',
        '6': 'jul','7': 'ago','8': 'sep','9': 'oct','10': 'nov','11': 'dic',
      },
      'weekdayMonFirst': {
        '0': 'L','1': 'M','2': 'M','3': 'J','4': 'V','5': 'S','6': 'D',
      },
      'weekdaySunFirst': {
        '0': 'D','1': 'L','2': 'M','3': 'M','4': 'J','5': 'V','6': 'S',
      },
    };
    const i18next = {
      isInitialized: true,
      t(key: string, opts?: { returnObjects?: boolean }): any {
        const colon = key.indexOf(':');
        if (colon < 0) return key;
        const sub = key.slice(colon + 1);
        const top = sub.split('.')[0];
        const obj = (dateNs as any)[top];
        if (!obj) return key;
        if (opts && opts.returnObjects) return obj;
        const rest = sub.slice(top.length + 1);
        if (!rest) return obj;
        const parts = rest.split('.');
        let cur: any = obj;
        for (const p of parts) {
          cur = cur == null ? undefined : cur[p];
        }
        return cur == null ? key : cur;
      },
    };
    export default i18next;
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
    fullMonthES,
    seedMonthFromISO,
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

  await test('fullMonthES: full Spanish month names (via date:monthFull.<n>)', () => {
    // PR 3: fullMonthES is a thin wrapper around
    // `i18next.t('date:monthFull.<n>')` — the `date` namespace stub ships
    // the same lowercase strings the JSON catalog carries.
    assert.equal(fullMonthES(0), 'enero');
    assert.equal(fullMonthES(8), 'septiembre');
    assert.equal(fullMonthES(11), 'diciembre');
    // Index 12 is out of range: the i18next stub returns the key as-is
    // (no leaf for "12"); the production behavior mirrors this — the
    // calendar never passes an out-of-range index.
    assert.equal(fullMonthES(12), 'date:monthFull.12');
  });

  await test('seedMonthFromISO: 1-based ISO month → 0-based component month', () => {
    // Component state is 0-based (matches monthGrid / Date#getMonth); the
    // seed parses the 1-based ISO month and subtracts 1. Pins the exact
    // regression that previously read `initial.month - 1` inline.
    assert.equal(seedMonthFromISO('2026-09-07', '2026-09-07'), 8);
    assert.equal(seedMonthFromISO('2026-12-31', '2026-09-07'), 11);
    assert.equal(seedMonthFromISO('2026-01-15', '2026-09-07'), 0);
  });

  await test('seedMonthFromISO: null/malformed iso falls back to fallbackISO', () => {
    // Fallback is TODAY (2026-09-07) → 1-based month 9 → 0-based 8.
    assert.equal(seedMonthFromISO(null, '2026-09-07'), 8);
    assert.equal(seedMonthFromISO(undefined, '2026-09-07'), 8);
    assert.equal(seedMonthFromISO('not-a-date', '2026-09-07'), 8);
  });

  await test('seedMonthFromISO: no parseable input falls back to now', () => {
    assert.equal(seedMonthFromISO(null, null), new Date().getMonth());
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

async function formatTests(format, calendar) {
  const { formatDate, fullMonthForLocale } = format;
  const { monthGrid, daysInMonth } = calendar;
  // PR 3: the legacy `formatDateES` wrapper is GONE — `formatDate` is the
  // canonical es-AR formatter. The manual-screen harness verifies the
  // same trigger output the screen relies on (today / yesterday / older).
  await test('formatDate (es-AR): today renders "Hoy"', () => {
    assert.equal(formatDate('es-AR', '2026-09-07', { todayISO: TODAY }), 'Hoy');
  });
  await test('formatDate (es-AR): yesterday renders "Ayer"', () => {
    assert.equal(formatDate('es-AR', '2026-09-06', { todayISO: TODAY }), 'Ayer');
  });
  await test('formatDate (es-AR): older day renders "DD mon YYYY"', () => {
    assert.equal(
      formatDate('es-AR', '2026-08-15', { todayISO: TODAY }),
      '15 ago 2026',
    );
  });
  await test('convention pin: fullMonthForLocale 1-based vs monthGrid 0-based', () => {
    // Freezes the two coexisting month conventions: fullMonthForLocale
    // takes a 1-based month (September = 9) while monthGrid / daysInMonth
    // take 0-based (September = 8). Both must describe the same real
    // month: a 30-day September starting Tuesday (lead 1 Monday-first).
    assert.equal(fullMonthForLocale('es-AR', 9), 'septiembre');
    assert.equal(fullMonthForLocale('es-AR', 1), 'enero');
    assert.equal(fullMonthForLocale('es-AR', 12), 'diciembre');
    assert.equal(daysInMonth(2026, 8), 30);
    const grid = monthGrid(2026, 8, true);
    assert.equal(grid.length, 31); // lead 1 + 30 days
    assert.equal(grid[0], null);
    assert.equal(grid[1], 1);
    assert.equal(grid[30], 30);
  });
}

// ---------------------------------------------------------------------------
// Category-picker create logic (PR 7, slice 3/7 — category-picker-form.ts)
// ---------------------------------------------------------------------------

async function categoryPickerFormTests(picker, catalog) {
  const {
    MAX_CATEGORY_NAME_LENGTH,
    CATEGORY_CREATE_DEFAULT_ICON,
    CATEGORY_PALETTE_COLORS,
    validateCategoryCreateInput,
    categoryCollisionSlugs,
    pickerRowsFromCatalog,
    canonicalFallbackRows,
    CATEGORY_CREATE_ERROR_KEYS,
    seamCreateErrorKey,
    categoryCreateFormError,
    categoryCreateNameFieldError,
    canDismissCategoryPicker,
    isCurrentCategoryCreateSession,
  } = picker;
  const { mergeCategoryCatalog } = catalog;

  const paletteColor = CATEGORY_PALETTE_COLORS[0];

  await test('picker: 40-char name guardrail pinned', () => {
    assert.equal(MAX_CATEGORY_NAME_LENGTH, 40);
  });

  await test('picker: create icon is the canonical sparkles (custom rows)', () => {
    assert.equal(CATEGORY_CREATE_DEFAULT_ICON, 'sparkles');
  });

  await test('picker: palette is the 13 canonical colors, all distinct', () => {
    assert.equal(CATEGORY_PALETTE_COLORS.length, 13);
    assert.ok(CATEGORY_PALETTE_COLORS.includes('#2563EB')); // bebidas
    assert.ok(CATEGORY_PALETTE_COLORS.includes('#4B5563')); // otros
    assert.equal(new Set(CATEGORY_PALETTE_COLORS).size, 13);
  });

  await test('create: valid input ok with the derived slug', () => {
    assert.deepEqual(
      validateCategoryCreateInput(
        'Delivery',
        'want',
        paletteColor,
        ['bebidas', 'lacteos'],
      ),
      { ok: true, reason: null, slug: 'delivery' },
    );
  });

  await test('create: 40 chars ok, 41 chars blocked (name_too_long)', () => {
    const ok = validateCategoryCreateInput(
      'a'.repeat(40),
      'need',
      paletteColor,
      [],
    );
    assert.equal(ok.ok, true);
    const long = validateCategoryCreateInput(
      'a'.repeat(41),
      'need',
      paletteColor,
      [],
    );
    assert.deepEqual(long, {
      ok: false,
      reason: 'name_too_long',
      slug: '',
    });
  });

  await test('create: empty/whitespace name blocked (name_required)', () => {
    assert.deepEqual(
      validateCategoryCreateInput('   ', 'need', paletteColor, []),
      { ok: false, reason: 'name_required', slug: '' },
    );
  });

  await test('create: emoji-only name blocked (slug_empty)', () => {
    assert.deepEqual(
      validateCategoryCreateInput('😀', 'need', paletteColor, []),
      { ok: false, reason: 'slug_empty', slug: '' },
    );
  });

  await test('create: canonical collision blocked (Lácteos → lacteos)', () => {
    // Real canonical slug — NOT the spec's illustrative 'Supermercado',
    // which is not in the actual 13-key taxonomy.
    assert.deepEqual(
      validateCategoryCreateInput('Lácteos', 'want', paletteColor, [
        'bebidas',
        'lacteos',
      ]),
      { ok: false, reason: 'slug_collides', slug: 'lacteos' },
    );
  });

  await test('create: own custom collision blocked (Delivery twice)', () => {
    assert.deepEqual(
      validateCategoryCreateInput('Delivery', 'want', paletteColor, [
        'bebidas',
        'delivery',
      ]),
      { ok: false, reason: 'slug_collides', slug: 'delivery' },
    );
  });

  await test('create: spec scenario — Supermercado vs own supermercado blocked', () => {
    assert.deepEqual(
      validateCategoryCreateInput('Supermercado', 'want', paletteColor, [
        'bebidas',
        'supermercado',
      ]),
      { ok: false, reason: 'slug_collides', slug: 'supermercado' },
    );
  });

  await test('create: collision reported before missing kind (precedence)', () => {
    // A colliding name is name-blocked even when the kind is still unset —
    // the category exists, kind is moot.
    const result = validateCategoryCreateInput(
      'Lácteos',
      undefined,
      paletteColor,
      ['lacteos'],
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'slug_collides');
  });

  await test('create: missing kind blocked (kind_required)', () => {
    assert.deepEqual(
      validateCategoryCreateInput('Delivery', undefined, paletteColor, []),
      { ok: false, reason: 'kind_required', slug: 'delivery' },
    );
    assert.equal(
      validateCategoryCreateInput('Delivery', null, paletteColor, []).reason,
      'kind_required',
    );
  });

  await test('create: invalid kind value blocked (kind_required)', () => {
    const result = validateCategoryCreateInput(
      'Delivery',
      'other',
      paletteColor,
      [],
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'kind_required');
  });

  await test('create: color outside palette blocked (color_required)', () => {
    assert.deepEqual(
      validateCategoryCreateInput('Delivery', 'want', '#FFFFFF', []),
      { ok: false, reason: 'color_required', slug: 'delivery' },
    );
    assert.equal(
      validateCategoryCreateInput('Delivery', 'want', '', []).reason,
      'color_required',
    );
    assert.equal(
      validateCategoryCreateInput('Delivery', 'want', null, []).reason,
      'color_required',
    );
  });

  await test('collisionSlugs: canonical 13 ∪ own catalog slugs', () => {
    const ownCatalog = mergeCategoryCatalog(
      [],
      [
        {
          id: 'c1',
          slug: 'delivery',
          name: 'Delivery',
          kind: 'want',
          icon: 'sparkles',
          color: '#2563EB',
          sort_order: 100,
          user_id: 'u1',
        },
      ],
    );
    const slugs = categoryCollisionSlugs(ownCatalog);
    assert.equal(slugs.size, 13 + 1);
    assert.equal(slugs.has('bebidas'), true); // canonical
    assert.equal(slugs.has('lacteos'), true); // canonical
    assert.equal(slugs.has('otros'), true); // throwaway fallback
    assert.equal(slugs.has('delivery'), true); // own custom
  });

  await test('pickerRows: merged catalog rows in catalog order, real shape', () => {
    const merged = mergeCategoryCatalog(
      [
        {
          id: 'g1',
          slug: 'bebidas',
          name: 'Bebidas',
          kind: 'need',
          icon: 'waterbottle.fill',
          color: '#2563EB',
          sort_order: 0,
          user_id: null,
        },
        {
          id: 'g2',
          slug: 'lacteos',
          name: 'Lácteos',
          kind: 'need',
          icon: 'drop.fill',
          color: '#0284C7',
          sort_order: 1,
          user_id: null,
        },
      ],
      [
        {
          id: 'c1',
          slug: 'delivery',
          name: 'Delivery',
          kind: 'want',
          icon: 'sparkles',
          color: '#4F46E5',
          sort_order: 100,
          user_id: 'u1',
        },
      ],
    );
    const rows = pickerRowsFromCatalog(merged);
    assert.deepEqual(rows, [
      { slug: 'bebidas', label: 'Bebidas', icon: 'waterbottle.fill', color: '#2563EB' },
      { slug: 'lacteos', label: 'Lácteos', icon: 'drop.fill', color: '#0284C7' },
      { slug: 'delivery', label: 'Delivery', icon: 'sparkles', color: '#4F46E5' },
    ]);
  });

  await test('pickerRows: empty catalog → empty rows', () => {
    assert.deepEqual(pickerRowsFromCatalog(mergeCategoryCatalog([], [])), []);
  });

  await test('pickerRows: canonical fallback keeps the grid alive pre-load', () => {
    const rows = canonicalFallbackRows();
    assert.equal(rows.length, 13);
    assert.deepEqual(rows[0], {
      slug: 'bebidas',
      label: 'Bebidas',
      icon: 'waterbottle.fill',
      color: '#2563EB',
    });
    const lacteos = rows.find((row) => row.slug === 'lacteos');
    assert.deepEqual(lacteos, {
      slug: 'lacteos',
      label: 'Lácteos',
      icon: 'drop.fill',
      color: '#0284C7',
    });
  });

  await test('error keys: each failure reason bridges to a tickets key', () => {
    assert.equal(
      CATEGORY_CREATE_ERROR_KEYS.slug_collides,
      'tickets:categoryCreateExists',
    );
    assert.equal(
      CATEGORY_CREATE_ERROR_KEYS.name_too_long,
      'tickets:categoryCreateNameTooLong',
    );
    assert.equal(
      CATEGORY_CREATE_ERROR_KEYS.name_required,
      'tickets:categoryCreateNameRequired',
    );
    assert.equal(
      CATEGORY_CREATE_ERROR_KEYS.slug_empty,
      'tickets:categoryCreateNameInvalid',
    );
    assert.equal(
      CATEGORY_CREATE_ERROR_KEYS.kind_required,
      'tickets:categoryCreateKindRequired',
    );
    assert.equal(
      CATEGORY_CREATE_ERROR_KEYS.color_required,
      'tickets:categoryCreateColorRequired',
    );
  });

  // ---------------------------------------------------------------------------
  // Gate fixes (reliability/risk REQUIRED): localized seam display, cancel
  // must cancel, stale createError gating, list-mode title restore.
  // ---------------------------------------------------------------------------
  const COLLISION_LITERAL = 'Esa categoría ya existe.';
  const GENERIC_LITERAL = 'No se pudo crear la categoría. Inténtalo de nuevo.';
  const okValidation = validateCategoryCreateInput(
    'Delivery',
    'want',
    paletteColor,
    [],
  );
  const kindValidation = validateCategoryCreateInput(
    'Delivery',
    undefined,
    paletteColor,
    [],
  );
  const colorValidation = validateCategoryCreateInput(
    'Delivery',
    'want',
    '#FFFFFF',
    [],
  );
  const nameRequiredValidation = validateCategoryCreateInput(
    '   ',
    'want',
    paletteColor,
    [],
  );
  const tooLongValidation = validateCategoryCreateInput(
    'a'.repeat(41),
    'want',
    paletteColor,
    [],
  );
  const slugEmptyValidation = validateCategoryCreateInput(
    '😀',
    'want',
    paletteColor,
    [],
  );
  const collisionValidation = validateCategoryCreateInput(
    'Delivery',
    'want',
    paletteColor,
    ['delivery'],
  );

  await test('seam: createError resolves to localized keys, never raw seam text', () => {
    assert.equal(seamCreateErrorKey(null, COLLISION_LITERAL), null);
    assert.equal(seamCreateErrorKey(undefined, COLLISION_LITERAL), null);
    assert.equal(seamCreateErrorKey('', COLLISION_LITERAL), null);
    // 23505 duplicate → the SAME friendly copy as the client pre-block.
    assert.equal(
      seamCreateErrorKey(COLLISION_LITERAL, COLLISION_LITERAL),
      'tickets:categoryCreateExists',
    );
    // Any other seam failure (network/timeout/fail-closed) → generic key.
    assert.equal(
      seamCreateErrorKey(GENERIC_LITERAL, COLLISION_LITERAL),
      'tickets:categoryCreateError',
    );
    assert.equal(
      seamCreateErrorKey('network error', COLLISION_LITERAL),
      'tickets:categoryCreateError',
    );
    // The derivation NEVER returns a raw Spanish constant — always a key.
    for (const out of [
      seamCreateErrorKey(COLLISION_LITERAL, COLLISION_LITERAL),
      seamCreateErrorKey(GENERIC_LITERAL, COLLISION_LITERAL),
      seamCreateErrorKey('anything else', COLLISION_LITERAL),
    ]) {
      assert.ok(out.startsWith('tickets:'), out + ' must be a key, not copy');
      assert.notEqual(out, COLLISION_LITERAL, out + ' is raw seam copy');
      assert.notEqual(out, GENERIC_LITERAL, out + ' is raw seam copy');
    }
  });

  await test('form error: pristine/reopened form shows NO error (stale createError gated)', () => {
    // (a) Even with a seam error pending, an un-attempted form stays clean.
    assert.equal(
      categoryCreateFormError(okValidation, false, 'tickets:categoryCreateError'),
      null,
    );
    assert.equal(categoryCreateFormError(okValidation, false, null), null);
    assert.equal(
      categoryCreateFormError(collisionValidation, false, 'tickets:categoryCreateExists'),
      null,
    );
  });

  await test('form error: attempted gates kind/color, then falls through to the seam key', () => {
    assert.equal(
      categoryCreateFormError(okValidation, true, 'tickets:categoryCreateError'),
      'tickets:categoryCreateError',
    );
    assert.equal(
      categoryCreateFormError(kindValidation, true, 'tickets:categoryCreateError'),
      'tickets:categoryCreateKindRequired',
    );
    assert.equal(
      categoryCreateFormError(colorValidation, true, 'tickets:categoryCreateError'),
      'tickets:categoryCreateColorRequired',
    );
    // Name-family reasons live in the field; the form area falls through
    // to the seam key, matching the original IIFE on submit.
    assert.equal(
      categoryCreateFormError(nameRequiredValidation, true, 'tickets:categoryCreateError'),
      'tickets:categoryCreateError',
    );
  });

  await test('name error: live collision shows regardless of attempted (copy exactly once)', () => {
    // (c) After a failed create + name edit, the collision copy surfaces
    // ONLY in the field (live) — the form-level gate stays silent while
    // un-attempted, so the seam copy is never shown twice.
    assert.equal(
      categoryCreateNameFieldError(collisionValidation, false),
      'tickets:categoryCreateExists',
    );
    assert.equal(
      categoryCreateNameFieldError(collisionValidation, true),
      'tickets:categoryCreateExists',
    );
    assert.equal(
      categoryCreateFormError(collisionValidation, false, 'tickets:categoryCreateExists'),
      null,
    );
  });

  await test('name error: required/too-long/unusable surface only when attempted', () => {
    assert.equal(categoryCreateNameFieldError(nameRequiredValidation, false), null);
    assert.equal(
      categoryCreateNameFieldError(nameRequiredValidation, true),
      'tickets:categoryCreateNameRequired',
    );
    assert.equal(
      categoryCreateNameFieldError(tooLongValidation, true),
      'tickets:categoryCreateNameTooLong',
    );
    assert.equal(
      categoryCreateNameFieldError(slugEmptyValidation, true),
      'tickets:categoryCreateNameInvalid',
    );
    assert.equal(categoryCreateNameFieldError(okValidation, true), null);
  });

  await test('dismissal: sheet cannot close while a create is in flight', () => {
    assert.equal(canDismissCategoryPicker(false), true);
    assert.equal(canDismissCategoryPicker(true), false);
  });

  await test('session: success selects only when the submit session is still current', () => {
    assert.equal(isCurrentCategoryCreateSession(3, 3), true);
    // Sheet dismissed (or dismissed + reopened) mid-flight → drop.
    assert.equal(isCurrentCategoryCreateSession(3, 4), false);
    assert.equal(isCurrentCategoryCreateSession(7, 0), false);
  });
}

// ---------------------------------------------------------------------------
// i18n parity (PR 7, slice 3/7 — task 3.3 acceptance)
// ---------------------------------------------------------------------------

const LOCALES_ROOT = join(__dirname, '..', 'src', 'i18n', 'locales');

async function i18nParityTests(picker) {
  const { CATEGORY_CREATE_ERROR_KEYS } = picker;
  const readTickets = (locale) =>
    JSON.parse(
      readFileSync(join(LOCALES_ROOT, locale, 'tickets.json'), 'utf8'),
    );
  const esAr = readTickets('es-AR');
  const en = readTickets('en');
  const ptBr = readTickets('pt-BR');
  const keySet = (ns) => Object.keys(ns).sort().join(',');

  await test('i18n: the three tickets namespaces keep identical key sets', () => {
    assert.equal(keySet(en), keySet(esAr));
    assert.equal(keySet(ptBr), keySet(esAr));
  });

  await test('i18n: every category-create error key resolves in all locales', () => {
    // The seam's generic failure copy is NOT part of CATEGORY_CREATE_ERROR_KEYS
    // (it is a display-path key, not a validation-reason key) — pinned here so
    // it can never silently drop out of any locale.
    const errorKeys = [
      ...Object.values(CATEGORY_CREATE_ERROR_KEYS),
      'tickets:categoryCreateError',
    ];
    for (const fullKey of errorKeys) {
      const key = fullKey.replace(/^tickets:/, '');
      assert.ok(key in esAr, `es-AR missing ${fullKey}`);
      assert.ok(key in en, `en missing ${fullKey}`);
      assert.ok(key in ptBr, `pt-BR missing ${fullKey}`);
    }
  });

  await test('i18n: all picker create labels exist across locales', () => {
    const labels = [
      'categoryPickerTitle',
      'categoryCreateTitle',
      'categoryCreateNameLabel',
      'categoryCreateNamePlaceholder',
      'categoryCreateColorLabel',
      'categoryCreateKindLabel',
      'categoryCreateKindNeed',
      'categoryCreateKindWant',
      'categoryCreateAction',
    ];
    for (const key of labels) {
      assert.ok(key in esAr, `es-AR missing ${key}`);
      assert.ok(key in en, `en missing ${key}`);
      assert.ok(key in ptBr, `pt-BR missing ${key}`);
    }
  });

  await test('i18n: es-AR collision copy converges with the API seam message', () => {
    // D4: the picker's pre-block and the 23505 backstop share one copy.
    assert.equal(esAr.categoryCreateExists, 'Esa categoría ya existe.');
    assert.equal(
      esAr.categoryCreateNameRequired,
      'Ingresá un nombre',
      'es-AR validation copy must stay rioplatense voseo',
    );
  });

  await test('i18n: generic create-failure key is localized in all three locales', () => {
    // Fix 1: the display path looks up tickets:categoryCreateError — the
    // es-AR value mirrors the seam constant byte-for-byte, while en/pt-BR
    // MUST NOT show the es-AR seam copy (that is the gate that failed).
    const GENERIC_LITERAL = 'No se pudo crear la categoría. Inténtalo de nuevo.';
    assert.ok('categoryCreateError' in esAr, 'es-AR missing categoryCreateError');
    assert.ok('categoryCreateError' in en, 'en missing categoryCreateError');
    assert.ok('categoryCreateError' in ptBr, 'pt-BR missing categoryCreateError');
    assert.equal(esAr.categoryCreateError, GENERIC_LITERAL);
    assert.notEqual(en.categoryCreateError, GENERIC_LITERAL);
    assert.notEqual(ptBr.categoryCreateError, GENERIC_LITERAL);
  });

  await test('i18n: api.ts seam constants stay byte-identical (display path converges)', () => {
    // The modal compares createError against CATEGORY_ALREADY_EXISTS_MESSAGE;
    // if the constant text drifts, the 23505 path silently stops converging.
    const apiSource = readFileSync(
      join(root, 'src/features/categories/api.ts'),
      'utf8',
    );
    assert.ok(
      apiSource.includes("CATEGORY_ALREADY_EXISTS_MESSAGE = 'Esa categoría ya existe.'"),
      'collision literal drifted from the pinned copy',
    );
    assert.ok(
      apiSource.includes(
        "CREATE_CATEGORY_ERROR_MESSAGE =\n  'No se pudo crear la categoría. Inténtalo de nuevo.'",
      ),
      'generic literal drifted from the pinned copy',
    );
  });

  await test('modal: list-mode title restored to categoryPickerTitle (create label kept)', () => {
    // Fix 4: the list-mode sheet title must be categoryPickerTitle — NOT
    // the create title, which stays on the create screen AND the "+ Nueva
    // categoría" affordance. This pins categoryPickerTitle as USED (a
    // key-set parity test alone lets dead keys pass).
    const modalSource = readFileSync(
      join(root, 'src/features/tickets/components/CategoryPickerModal.tsx'),
      'utf8',
    );
    assert.ok(
      modalSource.includes("t('categoryPickerTitle')"),
      'list-mode title must use categoryPickerTitle',
    );
    assert.ok(
      modalSource.includes("createLabel={t('categoryCreateTitle')}"),
      'create affordance label must stay categoryCreateTitle',
    );
    assert.ok(
      modalSource.includes("t('categoryCreateTitle')"),
      'create screen title must stay categoryCreateTitle',
    );
  });

  await test('modal: dismissal gated on isCreating + session guard wired (cancel must cancel)', () => {
    // Fix 2: BottomSheet.dismissable=false suppresses system back, backdrop
    // tap and the close button mid-create; handleCreate must session-guard
    // onSelect so a dismissed create never categorizes the item.
    const modalSource = readFileSync(
      join(root, 'src/features/tickets/components/CategoryPickerModal.tsx'),
      'utf8',
    );
    assert.ok(
      modalSource.includes('dismissable={canDismissCategoryPicker(isCreating)}') ||
        modalSource.includes('dismissable={!isCreating}'),
      'sheet must not dismiss while a create is in flight',
    );
    assert.ok(
      modalSource.includes('isCurrentCategoryCreateSession('),
      'handleCreate must session-guard onSelect',
    );
  });
}
  // ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

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
  const format = await importOut('../lib-stubs/format.js');
  await formatTests(format, calendar);

  // PR 7 (slice 3/7): the picker form module is compiled only once it
  // exists — RED manifests as a clean ERR_MODULE_NOT_FOUND FAIL, GREEN
  // runs the section.
  const picker = await importOut('category-picker-form.js').catch(() => null);
  if (picker) {
    const catalog = await importOut('catalog.js');
    await categoryPickerFormTests(picker, catalog);
    await i18nParityTests(picker);
  } else {
    await test(
      'RED: category-picker-form.ts module not compiled yet (slice 3/7)',
      () => {
        throw new Error('ERR_MODULE_NOT_FOUND — create the module for GREEN');
      },
    );
  }

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