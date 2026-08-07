import {
  currentMonthKey,
  getMonthKey,
  normalizeItemName,
  previousMonthKey,
  type ReceiptSpendRecord,
} from '@/features/home/hooks/useHomeFeed';

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

  for (const receipt of records) {
    const month = getMonthKey(receipt.purchase_date);
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
    }
  }

  const previous = previousMonthKey(nowMonth);

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
    });
  }

  return alerts.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
}
