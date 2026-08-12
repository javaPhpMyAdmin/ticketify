import {
  currentMonthKey,
  getMonthKey,
  normalizeItemName,
  previousMonthKey,
  type ReceiptSpendRecord,
} from '@/features/home/hooks/useHomeFeed';

/**
 * Best source receipt for an (identity, month) tuple under the S2
 * deterministic rule: latest `purchase_date` wins, ties broken by `id`
 * ascending. Tracking both fields on a single object lets a single
 * comparison settle the candidate in one step.
 */
interface SourceReceipt {
  receiptId: string;
  purchaseDate: string;
  id: string;
}

/**
 * Returns the candidate that wins under the deterministic rule, or the
 * existing one when neither field beats it. Both sides always set every
 * field, so the comparison is purely numeric / lexicographic — no
 * special-casing.
 */
function betterSource(a: SourceReceipt, b: SourceReceipt): SourceReceipt {
  if (a.purchaseDate !== b.purchaseDate) {
    return a.purchaseDate > b.purchaseDate ? a : b;
  }
  return a.id < b.id ? a : b;
}

export interface PriceAlert {
  /** Display name from the current-month receipt (original casing). */
  name: string;
  category: string;
  /** Unit price this month. */
  currentPrice: number;
  /** Unit price last month. */
  previousPrice: number;
  /** Signed percentage change, e.g. 9.1 for +9.1%, -3.2 for -3.2%. */
  changePct: number;
  /**
   * Source receipt id in the **current month** that hosts the changed
   * item (feature-gating spec — REQ-GATE-2). Picked by the S2
   * deterministic rule: latest `purchase_date`; tie-break `id`
   * ascending. Two runs on the same data produce the same id, so the
   * analytics banner can navigate reliably to `/receipts/:receiptId`.
   */
  receiptId: string;
}

const THRESHOLD = 0.05; // 5% — the demo shows one alert, one miss.
/**
 * Pure price-alert computation (data-access spec). Groups receipts' line
 * items by normalized identity, averages the unit price per month, and
 * compares the "current" month against the one before it. Only items with
 * an explicit `unit_price` participate — without it there is no comparable
 * price. A change counts as an alert only when it is strictly ABOVE the
 * threshold (a change of exactly the threshold is not an alert). Returns
 * alerts sorted by absolute change, descending.
 *
 * While aggregating, the function also tracks the source receipt per
 * `(identity, month)` tuple under the S2 deterministic rule (latest
 * `purchase_date`; tie-break `id` ascending) so each emitted alert
 * carries the receipt id the analytics banner will navigate to. Receipts
 * without an `id` contribute an empty-string candidate — the deterministic
 * comparison still resolves (id is `''`), and the analytics tap becomes
 * a no-op navigation rather than crashing.
 *
 * `nowMonth` is an explicit `YYYY-MM` so the computation is deterministic
 * and testable with fixed fixtures; callers that want "right now" (the
 * analytics tab) can omit it and it falls back to the real current month.
 * Passing a past month lets the upcoming month selector compare any two
 * consecutive months (e.g. July vs June).
 */
export function computePriceAlerts(
  records: ReceiptSpendRecord[],
  threshold = THRESHOLD,
  nowMonth = currentMonthKey(),
): PriceAlert[] {
  // identity -> { month -> { total, count } }
  const byIdentity = new Map<string, Map<string, { total: number; count: number }>>();
  // identity -> display name + category (first occurrence in records order
  // wins — display metadata only, the math uses `id` throughout)
  const meta = new Map<string, { name: string; category: string }>();
  // identity -> { month -> SourceReceipt } — S2 deterministic capture.
  const sourceByIdentityMonth = new Map<string, Map<string, SourceReceipt>>();

  for (const receipt of records) {
    const month = getMonthKey(receipt.purchase_date);
    const receiptId = receipt.id ?? '';
    for (const item of receipt.items ?? []) {
      if (item.unit_price === undefined) continue;
      const id = normalizeItemName(item.name);
      const perMonth = byIdentity.get(id) ?? new Map();
      const acc = perMonth.get(month) ?? { total: 0, count: 0 };
      acc.total += item.unit_price;
      acc.count += 1;
      perMonth.set(month, acc);
      byIdentity.set(id, perMonth);
      if (!meta.has(id)) meta.set(id, { name: item.name, category: item.category });

      // Capture (or replace) the source receipt for this tuple. `betterSource`
      // implements the deterministic ordering (latest purchase_date, then id
      // ascending) so the loop visits records in any order and still
      // converges on the same pick — two runs on the same input are stable.
      const perSource = sourceByIdentityMonth.get(id) ?? new Map();
      const candidate: SourceReceipt = {
        receiptId,
        purchaseDate: receipt.purchase_date,
        id: receiptId,
      };
      const existing = perSource.get(month);
      perSource.set(month, existing ? betterSource(existing, candidate) : candidate);
      sourceByIdentityMonth.set(id, perSource);
    }
  }

  const previous = previousMonthKey(nowMonth);
  const nowSources = sourceByIdentityMonth;

  const alerts: PriceAlert[] = [];
  for (const [id, perMonth] of byIdentity) {
    const now = perMonth.get(nowMonth);
    const then = perMonth.get(previous);
    // No pair in one of the months → nothing to compare. A zero base in the
    // previous month would make `change` infinite, so guard it too.
    if (!now || !then || then.count === 0 || then.total === 0) continue;
    const currentPrice = now.total / now.count;
    const previousPrice = then.total / then.count;
    const change = (currentPrice - previousPrice) / previousPrice;
    // Strictly ABOVE the threshold — a change of exactly 5% is not an alert.
    if (Math.abs(change) <= threshold) continue;
    alerts.push({
      name: meta.get(id)?.name ?? id,
      category: meta.get(id)?.category ?? '',
      currentPrice,
      previousPrice,
      changePct: Math.round(change * 1000) / 10,
      receiptId: nowSources.get(id)?.get(nowMonth)?.receiptId ?? '',
    });
  }

  return alerts.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
}
