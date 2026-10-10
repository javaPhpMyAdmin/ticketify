/**
 * PDF export builder.
 *
 * `buildExportHtml` is PURE (no native imports, unit-tested in plain node):
 * a self-contained HTML document — inline CSS only, no external resources,
 * system font stack — that `expo-print` renders to a PDF file. `generatedAt`
 * defaults to `new Date()` but is injectable so tests stay deterministic
 * (no clock).
 *
 * `buildExportPdf` is the thin native wrapper over `expo-print`. The module
 * is imported DYNAMICALLY inside the function so the pure module graph never
 * loads the native binding: plain-node harnesses can import `pdf.ts` (for
 * `buildExportHtml`) without a native module registry.
 *
 * PR 3 (`app-i18n`): the static HTML labels (page title, "generated on"
 * prefix, table headers, empty-state message, summary footer) read from
 * the `settings` + `analytics` namespaces via `i18next.t()`. The
 * `settings:exportCurrencyCode` and date strings stay locale-agnostic.
 */
import i18next from 'i18next';

import {
  formatTwoDecimals,
  normalizeExportRows,
  pluralize,
  type ExportLine,
  type ExportReceiptRow,
} from './normalize';

/** HTML-escapes a dynamic value (`&` first, so it is never double-escaped). */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * LOCAL `YYYY-MM-DD` for the "generated on" line. Deliberately NOT
 * `toISOString().slice(0, 10)`: that is UTC, and near midnight a UTC-x zone
 * (e.g. America/Montevideo) would print YESTERDAY's date on a document
 * generated "today". The export screen's filename uses the same local
 * calendar day (`todayISO`), so both surfaces always agree.
 */
function formatGeneratedDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Renders one normalized line as a `<tr>` (cells HTML-escaped). */
function lineToTableRow(line: ExportLine): string {
  const cells = [
    line.date,
    line.store,
    line.total,
    line.paymentMethod,
    line.category,
    line.item,
    line.quantity,
    line.unitPrice,
    line.lineTotal,
    line.impulse,
  ];
  return `<tr>${cells.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`;
}

/**
 * Per-unit summary figures for the footer: ONE figure per currency, sorted
 * descending (same ordering contract as the grouped surfaces). A row with no
 * recorded unit falls back to the viewer unit (REQ-8 s4) — unit-less rows and
 * the viewer's own currency are equivalent. The footer must never sum across
 * currencies (Invariants). With no rows the group list is EMPTY — the caller
 * renders the viewer-zero instead of a blank line.
 */
function groupSummaryByUnit(
  rows: ExportReceiptRow[],
  viewer: string | null,
): { currency: string | null; total: number }[] {
  const totals = new Map<string | null, number>();
  for (const row of rows) {
    const currency = row.currency ?? viewer;
    totals.set(currency, (totals.get(currency) ?? 0) + row.total);
  }
  return [...totals.entries()]
    .map(([currency, total]) => ({ currency, total }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Builds the self-contained HTML document for the receipt export: title,
 * generation date, one table row per line item (same normalization as the
 * CSV — including the blank-column row for item-less receipts), and a
 * summary footer with the receipt count and ONE total PER currency (rows
 * unit-less fall back to `viewerCurrency`; never summed across units).
 * An empty `rows` list renders the empty-state message instead of the table
 * and a viewer-only zero in the footer.
 */
export function buildExportHtml(
  rows: ExportReceiptRow[],
  generatedAt: Date = new Date(),
  viewerCurrency: string | null = null,
): string {
  const lines = normalizeExportRows(rows);
  // The export PDF labels read from i18next — same module-level t()
  // pattern the other non-React helpers use (AD-2 / REQ-10). When
  // i18next is not yet initialized the helper falls through to the
  // es-AR literal so a test-time render still produces a sane doc.
  // PR 3 (`app-i18n`): the export PDF labels read from i18next — same
  // module-level t() pattern the other non-React helpers use
  // (AD-2 / REQ-10). The dynamic `key` is intentionally a runtime string
  // (one per template slot); the `as never` cast bypasses the typed
  // ResourceNamespaceMap check that only fires for literal keys.
  const t = (key: string, fallback: string): string =>
    i18next.isInitialized
      ? (i18next.t as (k: string) => string)(key)
      : fallback;

  const emptyMsg = t(
    'analytics:exportEmpty',
    'No hay tickets para exportar.',
  );
  const title = t('settings:exportPdfTitle', 'Exportación de tickets');
  const generatedPrefix = t(
    'settings:exportGeneratedPrefix',
    'Generado el',
  );
  const headerDate = t('analytics:exportHeaderDate', 'Fecha');
  const headerStore = t('analytics:exportHeaderStore', 'Tienda');
  const headerTotal = t('analytics:exportHeaderTotal', 'Total');
  const headerPayment = t('analytics:exportHeaderPayment', 'Pago');
  const headerCategory = t('analytics:exportHeaderCategory', 'Categoría');
  const headerItem = t('analytics:exportHeaderItem', 'Artículo');
  const headerQty = t('analytics:exportHeaderQty', 'Cant.');
  const headerUnitPrice = t('analytics:exportHeaderUnitPrice', 'Precio unit.');
  const headerLineTotal = t(
    'analytics:exportHeaderLineTotal',
    'Total línea',
  );
  const headerImpulse = t('analytics:exportHeaderImpulse', 'Impulsivo');
  const summaryTotalLabel = t(
    'analytics:exportSummaryTotalLabel',
    'Total',
  );

  const summaryGroups = groupSummaryByUnit(rows, viewerCurrency);
  const summaryLine =
    summaryGroups.length === 0
      ? `${summaryTotalLabel} ${formatTwoDecimals(0)}${viewerCurrency ? ` ${viewerCurrency}` : ''}`
      : `${summaryTotalLabel} ${summaryGroups
          .map((g) => `${formatTwoDecimals(g.total)}${g.currency ? ` ${g.currency}` : ''}`)
          .join(' · ')}`;

  const tableRows =
    lines.length === 0
      ? `<tr><td colspan="10" class="empty">${emptyMsg}</td></tr>`
      : lines.map(lineToTableRow).join('\n');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111827; margin: 24px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .meta { color: #6b7280; font-size: 12px; margin: 0 0 16px; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td { border: 1px solid #e5e7eb; padding: 6px 8px; text-align: left; }
  th { background: #f3f4f6; }
  td.num, th.num { text-align: right; }
  .empty { text-align: center; color: #6b7280; padding: 24px; }
  .summary { margin-top: 16px; font-size: 13px; font-weight: 600; }
</style>
</head>
<body>
<h1>${title}</h1>
<p class="meta">${generatedPrefix} ${formatGeneratedDate(generatedAt)}</p>
<table>
<thead>
<tr>
  <th>${headerDate}</th>
  <th>${headerStore}</th>
  <th class="num">${headerTotal}</th>
  <th>${headerPayment}</th>
  <th>${headerCategory}</th>
  <th>${headerItem}</th>
  <th class="num">${headerQty}</th>
  <th class="num">${headerUnitPrice}</th>
  <th class="num">${headerLineTotal}</th>
  <th>${headerImpulse}</th>
</tr>
</thead>
<tbody>
${tableRows}
</tbody>
</table>
<p class="summary">${rows.length} ${pluralize(rows.length, 'ticket', 'tickets')} · ${summaryLine}</p>
</body>
</html>`;
}

/**
 * Renders `html` to a PDF file and resolves with its `file://` URI
 * (`expo-print` writes it to the app cache directory). Native-only — not
 * unit-tested; the pure HTML builder is.
 */
export async function buildExportPdf(html: string): Promise<string> {
  // Dynamic import keeps `expo-print` out of the pure module graph (see the
  // module docstring). The dev client rebuild is handled by the native
  // config plugins, outside this change.
  const Print = await import('expo-print');
  const { uri } = await Print.printToFileAsync({ html });
  return uri;
}
