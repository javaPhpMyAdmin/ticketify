#!/usr/bin/env node
/**
 * Node harness for the export builders (`src/features/export/csv.ts` and
 * `src/features/export/pdf.ts`).
 *
 * Both modules are pure (types-only imports; the `expo-print` binding in
 * `pdf.ts` is loaded lazily inside `buildExportPdf`), so this harness
 * compiles them with an isolated tsconfig (type-checking included, mirroring
 * the other harnesses) and asserts the export contract directly:
 *
 *   CSV — exact 10-column header (Spanish labels), one row per line item,
 *   RFC 4180 escaping (comma / double-quote / newline / CR fields get
 *   quoted and embedded quotes doubled), formula-prefix neutralization for
 *   CSV-injection payloads (`=`, `+`, `-`, `@` get a leading `'`), the
 *   blank-column fallback row for item-less receipts, BOM + header only for
 *   empty input, Spanish payment-label mapping (unknown → '—'), fixed
 *   2-decimal numbers, the 'sí'/'no' impulse flag, and the payment_method
 *   end-to-end propagation into the label.
 *
 *   HTML — self-contained table with the 10 Spanish column headers,
 *   HTML-escaped dynamic values (`&` → `&amp;`), the summary footer (receipt
 *   count + total sum), the empty-state message, and the injectable
 *   generation date.
 *
 * Deterministic: fixed fixture inputs, fixed generation date, no Intl.
 *
 * Usage: pnpm test:export
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
const harnessConfig = join(__dirname, 'tsconfig.export-test.json');

const tmpRoot = join(root, 'node_modules', '.tmp');
mkdirSync(tmpRoot, { recursive: true });
const workdir = mkdtempSync(join(tmpRoot, 'export-test-'));
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

function load(mod) {
  return import(pathToFileURL(join(outDir, mod)).href);
}

/** A `HomeFeedReceiptRow`-shaped fixture (payment_method optional). */
function receipt(overrides = {}) {
  return {
    id: 'p1',
    store_name: 'Coto',
    purchase_date: '2026-08-05',
    scanned_at: '2026-08-05T14:30:00.000Z',
    total: 20,
    image_url: null,
    status: 'confirmed',
    ...overrides,
  };
}

/** A `HomeFeedItemRow`-shaped fixture. */
function item(overrides = {}) {
  return {
    name: 'Leche',
    amount: 7,
    quantity: 2,
    unit_price: 3.5,
    category: 'lacteos',
    is_impulse: false,
    ...overrides,
  };
}

let csvMod;
let pdfMod;

/**
 * Mirrors the harness tsconfig's `paths` at runtime: tsc type-checks against
 * the remapped files but emits the ORIGINAL specifier, so plain node cannot
 * resolve `@/…` in the compiled CommonJS output. The export modules keep a
 * runtime value import (`PAYMENT_METHOD_LABELS` from `@/types`), so the
 * hook passes every `@/…` specifier through to its compiled location.
 */
function installRequireHook() {
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function rewrittenResolve(request, ...rest) {
    if (request.startsWith('@/')) {
      request = join(outDir, 'src', request.slice(2));
    }
    return originalResolve.call(this, request, ...rest);
  };
}

async function run() {
  console.log('\n[tests] compiling export modules…');
  await compile();
  console.log('[tests] loading compiled modules…');
  installRequireHook();
  csvMod = await load('src/features/export/csv.js');
  pdfMod = await load('src/features/export/pdf.js');
  const { buildExportCsv, EXPORT_CSV_HEADERS } = csvMod;
  const { buildExportHtml } = pdfMod;

  console.log('\n[tests] CSV structure\n');

  await test('headers are exactly the 10-column contract (Spanish)', () => {
    assert.equal(
      EXPORT_CSV_HEADERS,
      'fecha,tienda,total,metodo_pago,categoria,articulo,cantidad,precio_unitario,total_linea,impulsivo',
    );
  });

  await test('empty rows → BOM + header only', () => {
    const csv = buildExportCsv([]);
    assert.equal(
      csv,
      '\uFEFFfecha,tienda,total,metodo_pago,categoria,articulo,cantidad,precio_unitario,total_linea,impulsivo',
    );
  });

  await test('BOM present as the very first character', () => {
    const csv = buildExportCsv([]);
    assert.equal(csv.charCodeAt(0), 0xfeff);
  });

  await test('one row per item (2 items → header + 2 data rows)', () => {
    const csv = buildExportCsv([
      receipt({
        items: [
          item(),
          item({ name: 'Queso', amount: 5, quantity: 1, unit_price: 5 }),
        ],
      }),
    ]);
    const lines = csv.slice(1).split('\n');
    assert.equal(lines.length, 3);
    assert.equal(lines[0], EXPORT_CSV_HEADERS);
    assert.equal(lines[1], '2026-08-05,Coto,20.00,—,lacteos,Leche,2,3.50,7.00,no');
    assert.equal(lines[2], '2026-08-05,Coto,20.00,—,lacteos,Queso,1,5.00,5.00,no');
  });

  console.log('\n[tests] CSV escaping (RFC 4180)\n');

  await test('field with comma is quoted', () => {
    const csv = buildExportCsv([
      receipt({ total: 5, items: [item({ name: 'A, B', amount: 5, quantity: 1, unit_price: 5 })] }),
    ]);
    const dataLine = csv.slice(1).split('\n')[1];
    assert.equal(dataLine, '2026-08-05,Coto,5.00,—,lacteos,"A, B",1,5.00,5.00,no');
  });

  await test('field with double-quote is quoted and the quote doubled', () => {
    const csv = buildExportCsv([
      receipt({ total: 5, items: [item({ name: 'Coca "Light"', amount: 5, quantity: 1, unit_price: 5 })] }),
    ]);
    const dataLine = csv.slice(1).split('\n')[1];
    assert.equal(dataLine, '2026-08-05,Coto,5.00,—,lacteos,"Coca ""Light""",1,5.00,5.00,no');
  });

  await test('field with newline is quoted (literal newline inside)', () => {
    const csv = buildExportCsv([
      receipt({ total: 5, items: [item({ name: 'Pan\nBlanco', amount: 5, quantity: 1, unit_price: 5 })] }),
    ]);
    // Assert against the FULL document (a `\n` split would break inside the
    // quoted field): the field is quoted and the newline survives verbatim.
    assert.ok(csv.includes('2026-08-05,Coto,5.00,—,lacteos,"Pan\nBlanco",1,5.00,5.00,no'));
    // The value before the embedded newline is quoted...
    assert.ok(csv.includes(',lacteos,"Pan\n'));
    // ...and the field continues after it, still inside the same record.
    assert.ok(csv.includes('Blanco",1,5.00,5.00,no'));
  });

  await test('field with CRLF is quoted (literal \\r\\n inside)', () => {
    const csv = buildExportCsv([
      receipt({ total: 5, items: [item({ name: 'Pan\r\nBlanco', amount: 5, quantity: 1, unit_price: 5 })] }),
    ]);
    // Full-document assertion: the CRLF survives verbatim inside the quotes.
    assert.ok(csv.includes('2026-08-05,Coto,5.00,—,lacteos,"Pan\r\nBlanco",1,5.00,5.00,no'));
    assert.ok(csv.includes(',lacteos,"Pan\r\n'));
  });

  await test('plain fields stay unquoted', () => {
    const csv = buildExportCsv([
      receipt({ total: 5, items: [item({ amount: 5, quantity: 1, unit_price: 5 })] }),
    ]);
    assert.ok(csv.slice(1).split('\n')[1].startsWith('2026-08-05,Coto,5.00,'));
  });

  console.log('\n[tests] CSV injection neutralization (OWASP)\n');

  await test('store name starting with = (HYPERLINK payload) is neutralized with a leading quote', () => {
    const csv = buildExportCsv([
      receipt({ store_name: '=HYPERLINK("https://evil","x")', total: 5, items: [item({ amount: 5, quantity: 1, unit_price: 5 })] }),
    ]);
    // The field is both neutralized (`'` prefix) AND quoted (it contains
    // double-quotes): the payload can never be evaluated as a formula.
    assert.ok(csv.includes("'=HYPERLINK("));
    assert.ok(csv.includes('2026-08-05,"\'=HYPERLINK(""https://evil"",""x"")",5.00,—,lacteos,Leche,1,5.00,5.00,no'));
  });

  await test('fields starting with + or @ are neutralized with a leading quote', () => {
    const csv = buildExportCsv([
      receipt({ store_name: '+1+1', total: 5, items: [item({ amount: 5, quantity: 1, unit_price: 5 })] }),
      receipt({ id: 'p2', store_name: '@cmd', total: 5, items: [item({ name: 'Pan', amount: 5, quantity: 1, unit_price: 5 })] }),
    ]);
    const lines = csv.slice(1).split('\n');
    assert.ok(lines[1].includes(",'+1+1,"));
    assert.ok(lines[2].includes(",'@cmd,"));
  });

  await test('neutralized formula fields still quote RFC 4180 specials', () => {
    const csv = buildExportCsv([
      receipt({ store_name: '=A,1', total: 5, items: [item({ amount: 5, quantity: 1, unit_price: 5 })] }),
    ]);
    // `=` prefix neutralized AND comma forces quoting — both rules apply.
    assert.ok(csv.includes('2026-08-05,"\'=A,1",5.00,—,lacteos,Leche,1,5.00,5.00,no'));
  });

  console.log('\n[tests] CSV normalization rules\n');

  await test('item-less receipt emits a fallback row with blank item columns', () => {
    const csv = buildExportCsv([receipt({ total: 99, payment_method: 'cash', items: [] })]);
    const dataLine = csv.slice(1).split('\n')[1];
    assert.equal(dataLine, '2026-08-05,Coto,99.00,Efectivo,,,,,,');
    // 10 columns total: 4 populated + 6 blank.
    assert.equal(dataLine.split(',').length, 10);
  });

  await test('payment labels map to Spanish copy (cash → Efectivo, card → Tarjeta, …)', () => {
    const cases = {
      cash: 'Efectivo',
      card: 'Tarjeta',
      apple_pay: 'Apple Pay',
      google_pay: 'Google Pay',
      transfer: 'Transferencia',
      other: 'Otro',
    };
    for (const [method, label] of Object.entries(cases)) {
      const csv = buildExportCsv([
        receipt({ total: 5, payment_method: method, items: [item({ amount: 5, quantity: 1, unit_price: 5 })] }),
      ]);
      const dataLine = csv.slice(1).split('\n')[1];
      assert.ok(dataLine.includes(`,${label},lacteos,`), `${method} → ${label}`);
    }
  });

  await test('payment_method propagates end-to-end from HomeFeedReceiptRow into the CSV', () => {
    const row = receipt({
      total: 5,
      payment_method: 'card',
      items: [item({ amount: 5, quantity: 1, unit_price: 5 })],
    });
    const dataLine = buildExportCsv([row]).slice(1).split('\n')[1];
    assert.equal(dataLine, '2026-08-05,Coto,5.00,Tarjeta,lacteos,Leche,1,5.00,5.00,no');
  });

  await test('unknown payment method falls back to —', () => {
    const csv = buildExportCsv([
      receipt({ total: 5, payment_method: 'bitcoin', items: [item({ amount: 5, quantity: 1, unit_price: 5 })] }),
      receipt({ id: 'p2', total: 5, items: [item({ amount: 5, quantity: 1, unit_price: 5 })] }),
    ]);
    const lines = csv.slice(1).split('\n');
    assert.ok(lines[1].includes(',—,lacteos,'));
    assert.ok(lines[2].includes(',—,lacteos,'));
  });

  await test('2-decimal formatting (5 → 5.00, 3.5 → 3.50)', () => {
    const csv = buildExportCsv([
      receipt({ total: 5, payment_method: 'card', items: [item({ amount: 7, quantity: 1, unit_price: 5 })] }),
    ]);
    const dataLine = csv.slice(1).split('\n')[1];
    assert.equal(dataLine, '2026-08-05,Coto,5.00,Tarjeta,lacteos,Leche,1,5.00,7.00,no');
  });

  await test('impulse maps to sí/no (undefined → no)', () => {
    const csv = buildExportCsv([
      receipt({ total: 5, items: [item({ is_impulse: true }), item({ name: 'Sin flag', is_impulse: undefined })] }),
    ]);
    const lines = csv.slice(1).split('\n');
    assert.ok(lines[1].endsWith(',sí'));
    assert.ok(lines[2].endsWith(',no'));
  });

  await test('null category falls back to "sin categoría"', () => {
    const csv = buildExportCsv([
      receipt({ total: 5, items: [item({ category: null })] }),
    ]);
    const dataLine = csv.slice(1).split('\n')[1];
    assert.ok(dataLine.includes(',sin categoría,Leche,'));
  });

  await test('missing unit_price falls back to amount; missing quantity defaults to 1', () => {
    const csv = buildExportCsv([
      receipt({
        total: 5,
        items: [item({ amount: 7, quantity: undefined, unit_price: undefined })],
      }),
    ]);
    const dataLine = csv.slice(1).split('\n')[1];
    assert.equal(dataLine, '2026-08-05,Coto,5.00,—,lacteos,Leche,1,7.00,7.00,no');
  });

  console.log('\n[tests] HTML (buildExportHtml)\n');

  await test('renders a self-contained table with the 10 Spanish column headers', () => {
    const html = buildExportHtml([receipt({ items: [item()] })], new Date('2026-08-11T00:00:00Z'));
    assert.ok(html.includes('<!DOCTYPE html>'));
    assert.ok(html.includes('<meta charset="utf-8" />'));
    assert.ok(html.includes('<table>'));
    assert.ok(html.includes('</table>'));
    assert.ok(html.includes('<th>Fecha</th>'));
    assert.ok(html.includes('<th>Tienda</th>'));
    assert.ok(html.includes('<th class="num">Total</th>'));
    assert.ok(html.includes('<th>Pago</th>'));
    assert.ok(html.includes('<th>Categoría</th>'));
    assert.ok(html.includes('<th>Artículo</th>'));
    assert.ok(html.includes('<th class="num">Cant.</th>'));
    assert.ok(html.includes('<th class="num">Precio unit.</th>'));
    assert.ok(html.includes('<th class="num">Total línea</th>'));
    assert.ok(html.includes('<th>Impulsivo</th>'));
  });

  await test('row cells carry the normalized values (payment label, 2 decimals)', () => {
    const html = buildExportHtml(
      [receipt({ payment_method: 'transfer', items: [item({ amount: 7, quantity: 2, unit_price: 3.5 })] })],
      new Date('2026-08-11T00:00:00Z'),
    );
    assert.ok(html.includes('<td>2026-08-05</td><td>Coto</td><td>20.00</td><td>Transferencia</td><td>lacteos</td><td>Leche</td><td>2</td><td>3.50</td><td>7.00</td><td>no</td>'));
  });

  await test('escapes dynamic values (& → &amp;, < → &lt;)', () => {
    const html = buildExportHtml(
      [receipt({ store_name: 'P&G <Market>', items: [item({ name: 'R&J Soda' })] })],
      new Date('2026-08-11T00:00:00Z'),
    );
    assert.ok(html.includes('P&amp;G &lt;Market&gt;'));
    assert.ok(html.includes('R&amp;J Soda'));
    assert.ok(!html.includes('P&G <Market>'));
  });

  await test('escapes double-quotes and apostrophes in dynamic values', () => {
    const html = buildExportHtml(
      [receipt({ store_name: 'Joe\'s "Deli"', items: [item()] })],
      new Date(2026, 7, 11),
    );
    assert.ok(html.includes('Joe&#39;s &quot;Deli&quot;'));
    assert.ok(!html.includes('Joe\'s "Deli"'));
    // And the item column is safe too.
    assert.ok(html.includes('<td>Leche</td>'));
  });

  await test('item-less receipt renders a blank-cell row', () => {
    const html = buildExportHtml(
      [receipt({ total: 99, payment_method: 'cash', items: [] })],
      new Date('2026-08-11T00:00:00Z'),
    );
    assert.ok(html.includes('<td>2026-08-05</td><td>Coto</td><td>99.00</td><td>Efectivo</td><td></td><td></td><td></td><td></td><td></td><td></td>'));
  });

  await test('summary shows the receipt count and the total sum', () => {
    const html = buildExportHtml(
      [
        receipt({ total: 20, items: [item()] }),
        receipt({ id: 'p2', total: 25, items: [item({ name: 'Queso', amount: 25, quantity: 1, unit_price: 25 })] }),
      ],
      new Date('2026-08-11T00:00:00Z'),
    );
    assert.ok(html.includes('2 tickets · Total 45.00'));
  });

  await test('empty rows render the empty-state message', () => {
    const html = buildExportHtml([], new Date('2026-08-11T00:00:00Z'));
    assert.ok(html.includes('No hay tickets para exportar.'));
    assert.ok(html.includes('0 tickets · Total 0.00'));
  });

  await test('generation date is injectable and deterministic', () => {
    // LOCAL-time construction (year/month/day args): `formatGeneratedDate`
    // reads local calendar fields, so this fixture renders the same string
    // in every timezone. A UTC-midnight literal would drift a day in
    // UTC-x zones (e.g. America/Montevideo), which is exactly the bug the
    // local formatter fixes.
    const html = buildExportHtml([], new Date(2026, 7, 11));
    assert.ok(html.includes('Generado el 2026-08-11'));
    // `generatedAt` is a defaulted parameter, so JS `.length` counts only
    // the required params before it (1). A single-arg call still renders a
    // date-shaped line — the default applies at runtime.
    assert.equal(buildExportHtml.length, 1);
    assert.match(buildExportHtml([]), /Generado el \d{4}-\d{2}-\d{2}/);
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
