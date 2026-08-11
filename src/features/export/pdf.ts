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
 */
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
 * Builds the self-contained HTML document for the receipt export: title,
 * generation date, one table row per line item (same normalization as the
 * CSV — including the blank-column row for item-less receipts), and a
 * summary footer with the receipt count and the sum of all receipt totals.
 * An empty `rows` list renders the empty-state message instead of the table.
 */
export function buildExportHtml(
  rows: ExportReceiptRow[],
  generatedAt: Date = new Date(),
): string {
  const lines = normalizeExportRows(rows);
  const totalSum = rows.reduce((sum, row) => sum + row.total, 0);

  const tableRows =
    lines.length === 0
      ? `<tr><td colspan="10" class="empty">No hay recibos para exportar.</td></tr>`
      : lines.map(lineToTableRow).join('\n');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Exportación de recibos</title>
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
<h1>Exportación de recibos</h1>
<p class="meta">Generado el ${formatGeneratedDate(generatedAt)}</p>
<table>
<thead>
<tr>
  <th>Fecha</th>
  <th>Tienda</th>
  <th class="num">Total</th>
  <th>Pago</th>
  <th>Categoría</th>
  <th>Artículo</th>
  <th class="num">Cant.</th>
  <th class="num">Precio unit.</th>
  <th class="num">Total línea</th>
  <th>Impulsivo</th>
</tr>
</thead>
<tbody>
${tableRows}
</tbody>
</table>
<p class="summary">${rows.length} ${pluralize(rows.length, 'recibo', 'recibos')} · Total ${formatTwoDecimals(totalSum)}</p>
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
