/**
 * CSV export builder — pure, no native imports, unit-tested in plain node.
 *
 * Format contract (RFC 4180 flavor):
 *   - one line per line item (a receipt with no items emits one line with
 *     blank item columns so no receipt is lost),
 *   - fields starting with a formula prefix (`=`, `+`, `-`, `@`, tab, CR)
 *     are neutralized with a leading `'` so Excel/Numbers never evaluate
 *     them as formulas (OWASP CSV injection),
 *   - fields containing a comma, double-quote, newline, or CR are quoted
 *     and embedded double-quotes are doubled,
 *   - `\n` line endings, first line prefixed with a UTF-8 BOM so
 *     Excel/Numbers render accented characters correctly.
 */
import { normalizeExportRows, type ExportLine, type ExportReceiptRow } from './normalize';

/** Exact header row of the CSV (10 columns, in this order, Spanish labels). */
export const EXPORT_CSV_HEADERS =
  'fecha,tienda,total,metodo_pago,categoria,articulo,cantidad,precio_unitario,total_linea,impulsivo';

/** UTF-8 byte-order mark: Excel/Numbers read the sheet as UTF-8. */
const UTF8_BOM = '\uFEFF';

/**
 * Neutralizes and quotes a field (RFC 4180). A value starting with a
 * spreadsheet formula prefix (`=`, `+`, `-`, `@`, tab, CR) gets a leading
 * `'` FIRST — quoting alone does NOT stop Excel from evaluating it — then
 * the existing quoting rules apply to the neutralized value.
 */
function escapeCsvField(value: string): string {
  const neutralized = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (/[",\r\n]/.test(neutralized)) {
    return `"${neutralized.replace(/"/g, '""')}"`;
  }
  return neutralized;
}

/** Maps one normalized line to its CSV row (columns in header order). */
function lineToCsv(line: ExportLine): string {
  return [
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
  ]
    .map(escapeCsvField)
    .join(',');
}

/**
 * Builds the full CSV document: BOM + header row + one row per line item.
 * `rows` may be empty — the result is then BOM + header only.
 */
export function buildExportCsv(rows: ExportReceiptRow[]): string {
  const body = normalizeExportRows(rows).map(lineToCsv);
  return `${UTF8_BOM}${[EXPORT_CSV_HEADERS, ...body].join('\n')}`;
}
