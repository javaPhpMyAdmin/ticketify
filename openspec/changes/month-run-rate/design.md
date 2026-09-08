# Design: Current-Month Run-Rate Card

## Technical Approach

100% client-side, zero backend change. A pure aggregator (`aggregateRunRate`) computes MTD, same-calendar-days MoM baseline (with a historical-average fallback), signed delta % and end-of-month projection from already-fetched `monthly_user_totals` cache rows. A hook (`useRunRate`) reads the current + 4 previous month rows in one batch (`readMonthlyCacheRows`, feature-access.ts:791), triggers the existing auto-recalc on current-month cache-miss (mirroring `useMonthlyCache`), and returns `null` unless all spec gates pass. A `RunRateCard` renders only when the hook yields data, mounted in Home's `ListHeaderComponent` between the month selector and the budget section. All math follows `computeMonthOverview` (monthly-overview.ts) precedents: pure, deterministic on explicit dates, rounding inside the pure function.

## Architecture Decisions

| # | Decision | Options | Choice | Rationale |
|---|----------|---------|--------|-----------|
| AD-1 | Fallback prorating formula | (a) `mean × dayOfMonth ÷ daysInCurrentMonth`; (b) raw `mean` (full-month); (c) prorate by spend-days count | **(a)** | Spec REQ-3 scenario writes it verbatim (`(May+Jun+Jul) ÷ 3 × 8/30`, Sep has 30 days). Semantically correct: MTD (days 1..8) compared against the historical run-rate normalized to the same elapsed fraction. (b) always yields a deeply negative delta on any mid-month day (MTD ≪ full month) — misleading by construction. (c) spend-day counts aren't comparable across months. **Confirmed with example below.** |
| AD-2 | Pure-fn location | `src/features/home/lib/runRate.ts` vs flat `src/features/home/runRate.ts` | **`home/lib/`** | Proposal mandates `lib/`; in-repo precedent exists (`src/features/tickets/lib/picture-size.ts`). Analytics/charts use flat files (`monthly-overview.ts`, `aggregate.ts`) — noted, but proposal scope wins. |
| AD-3 | Hook data acquisition | (a) own `useQuery` on `readMonthlyCacheRows([current, prev1..prev4])` + own recalc mutation (mirror `useMonthlyCache`); (b) compose `useMonthlyCache`/`useMonthlyCacheData` + separate prev query | **(a)** | Single query key, single `data` source, recalc refetch updates the SAME query — no cross-feature analytics import, no key mismatches. (b) needs two keys for the current row (dedupe fragile) and the recalc refetch would not refresh the separate batch query. (a) is the exact pattern `useMonthlyCache` already uses (hooks/useMonthlyCache.ts:88-122). |
| AD-4 | Query key namespace | `[...queryKeys.monthlyCachePrefix(userId), 'run-rate', monthKey]` vs ad-hoc key | **Reuse prefix** | Stays under the shared `monthlyCachePrefix` invalidation (query-keys.ts:89) — receipt writes that invalidate cache rows refetch run-rate too. |
| AD-5 | Rounding location | Inside `aggregateRunRate` vs at display | **Inside** | Matches `computeMonthOverview` (monthly-overview.ts:38 `Math.round(x*1000)/10`) and `transformCacheToCategoryTotals` (:44). Pure fn is the single source of truth; UI stays dumb. |
| AD-6 | Loading/error UI | Skeleton / error text vs render-nothing | **Render nothing** | REQ-5/REQ-6: hidden state MUST NOT render a placeholder; REQ-8 keeps remaining elements' order/spacing. The header `gap: spacing.lg` (index.tsx:369) absorbs the slot cleanly. |
| AD-7 | Negative-zero delta | `-0` leaks from `Math.round` on ~0 deltas | **Normalize** | `Math.round(-0.5)` yields `-0` in JS → copy would read "−0%". `aggregateRunRate` returns `0` when the rounded value is `0` (including `-0`). |

### AD-1 numeric example (fallback prorating)

May $21.000, Jun $24.000, Jul $27.000 (completed months; August missing or MoM window empty). Today 2026-09-08:

- `mean = (21000 + 24000 + 27000) / 3 = 24.000`
- `baseline = 24.000 × 8 ÷ 30 = 6.400`  ← `mean × dayOfMonth ÷ daysInCurrentMonth`
- MTD (Sep 1..8) = $7.200 → `deltaPct = (7200 − 6400) / 6400 × 100 = +12.5`
- `projection = 7200 ÷ 8 × 30 = 27.000` → renders `~$27.000`

## Data Flow

```
HomeScreen (index.tsx ListHeaderComponent)
   │ monthKey (useState :59)
   ▼
useRunRate(monthKey)                        [features/home/hooks/useRunRate.ts]
   │ gate: monthKey !== currentMonthKey() → { data: null } (no reads)
   │ useQuery([...monthlyCachePrefix(userId), 'run-rate', monthKey],
   │         readMonthlyCacheRows(userId, [current, prev1..prev4]))
   │   ├─ current row missing → triggerMonthlyRecalc(current) → refetch (REQ-6)
   │   └─ any read error → { data: null }
   ▼
aggregateRunRate(rows, todayLocalISO())     [features/home/lib/runRate.ts — pure]
   │ mtd = Σ daily_totals (day ≤ today, current month, > 0)
   │ spendDays = count of those (≥ 3 or null)
   │ baseline = MoM same-days window  ──unavailable──▶ mean(≤3 prev rows) × day/daysInMonth
   │ deltaPct = round1((mtd − baseline)/baseline × 100)
   │ projection = mtd / day × daysInMonth
   ▼
{ data: RunRateResult | null }
   │ data ? <RunRateCard result={data} currency={currency} /> : null
   ▼
RunRateCard  [features/home/components/RunRateCard.tsx]
   │ Pressable → router.push('/analytics')   (typed route, REQ-7)
   └─ Card: kicker "RITMO DEL MES" · $MTD · ±deltaPct% badge · "Al ritmo actual cerras en ~$Z"
```

## Interfaces / Contracts

### `aggregateRunRate` — `src/features/home/lib/runRate.ts`

```ts
import { previousMonthKey } from '@/features/home/hooks/useHomeFeed';
import type { MonthlyTotalsCacheRow } from '@/types';

export interface RunRateResult {
  mtd: number;            // raw sum of current-month daily_totals day ≤ referenceDate
  baseline: number;       // raw baseline (MoM window or prorated historical mean), > 0
  deltaPct: number;       // signed %, rounded to 1 decimal (Math.round(x*1000)/10), -0 normalized
  projection: number;     // raw mtd / day × daysInMonth; formatted at display
  source: 'mom' | 'fallback';
}

/** Pure, deterministic — no clock. referenceDate = device-local ISO (todayLocalISO()). */
export function aggregateRunRate(
  rows: MonthlyTotalsCacheRow[],
  referenceDate: string, // 'YYYY-MM-DD', local calendar (format.ts:177)
): RunRateResult | null
```

**Execution order (gates short-circuit to `null`):**

1. `currentKey = referenceDate.slice(0, 7)`; `dayOfMonth = parseInt(referenceDate.slice(8, 10))`. Current row (`rows.find(r => r.year_month === currentKey)`) missing → `null` (REQ-6: nothing renders until the row resolves).
2. **Spend-days gate (REQ-5b):** `spendDays` = entries in `daily_totals` where `key.startsWith(currentKey)`, `key <= referenceDate` (ISO lexicographic) and `value > 0`. `< 3` → `null`.
3. **MTD (REQ-1):** sum of exactly those entries — future-dated entries clamped, stray foreign-month keys excluded by the prefix check. Empty `daily_totals` → 0 (valid), but gate 2 already hides.
4. **MoM baseline (REQ-2):** `prevKey = previousMonthKey(currentKey)` (useHomeFeed.ts:170, December-safe); sum of prev row's `daily_totals` entries with `key.startsWith(prevKey)` and `parseInt(key.slice(8, 10)) <= dayOfMonth` (day-vs-day; Feb vs 31-day months handled). If the prev row is missing **or** the window sum is `<= 0` — the result contract requires `baseline > 0`, so a zero (no spend days 1..N) *or negative* window falls through — → baseline unavailable; step 5. (Implementation uses `momWindow > 0`; a `=== 0` check would reintroduce meaningless signed deltas on a negative window.)
5. **Fallback baseline (REQ-3, AD-1):** scan `rows` for `year_month < currentKey`, sort descending, take the **up to 3 most recent**; none → `null`. `mean = Σ row.total / n` (0-total months count — real data); `daysInMonth = new Date(refYear, refMonth /* 1-based, day 0 */, 0).getDate()`; `baseline = mean × dayOfMonth / daysInMonth`. `baseline <= 0` → `null`.
6. `deltaPct = Math.round(((mtd - baseline) / baseline) * 1000) / 10`; if `deltaPct === 0` normalize to `0` (kills `-0`, AD-7). `projection = mtd / dayOfMonth × daysInMonth`.

`daysInMonth` note: `new Date(2026, 9, 0).getDate()` = 30 (Sep), `new Date(2026, 2, 0).getDate()` = 28 (Feb), December rolls to `new Date(2026, 12, 0)` = 31 — passing the 1-based month number as the JS month index with day 0 yields the correct length.

### `useRunRate` — `src/features/home/hooks/useRunRate.ts`

```ts
export function useRunRate(monthKey: string): { data: RunRateResult | null }
```

- `useSessionUser()` first (hooks-order safe), then **gate**: `monthKey !== currentMonthKey() || !userId` → `{ data: null }` — no queries fire for past months (REQ-5a).
- `useQuery` on `readMonthlyCacheRows(userId, [currentKey, prev1, prev2, prev3, prev4])` (feature-access.ts:791 — one indexed batch read, NFR-1), key `[...queryKeys.monthlyCachePrefix(userId), 'run-rate', monthKey]` (AD-4), `enabled: isCurrent && !!userId`, `.then(toQueryData)`.
- **Cache-miss effect (REQ-6):** when the query resolves and no row has `year_month === currentKey`, fire `triggerMonthlyRecalc(userId, currentKey)` once (`mutationFn`), refetch on success — verbatim pattern of `useMonthlyCache` (useMonthlyCache.ts:104-122).
- **Error → `{ data: null }`** (query `isError`; `toQueryData` rejects on `{status:'error'}` — never fabricate numbers, REQ-6).
- Result: `useMemo(() => aggregateRunRate(rows, todayLocalISO()), [rows, todayLocalISO()])` — the day token re-derives on the local-day flip so a month boundary mid-session doesn't serve yesterday's math; recompute cost is trivial.

### `RunRateCard` — `src/features/home/components/RunRateCard.tsx` (presentational)

```ts
export interface RunRateCardProps {
  result: RunRateResult; // data !== null, guaranteed by parent
  currency: string;      // passed from useSettingsStore (index.tsx:60)
}
```

## UI Structure and Copy

Structure (English description — copy below is the product-facing artifact, rioplatense Spanish):

```
Pressable  (accessibilityRole="button",
            accessibilityLabel="Ritmo de gasto de {mes}: {mtd} este mes, {±delta}% vs {base}; al ritmo actual cerras en ~{proj}",
            accessibilityHint="Abrir Analytics",
            pressed-style like PriceAlertBanner analytics.tsx:656)
└─ Card (from @/components, default padding)
   ├─ Text kicker  — MonthlyOverviewCard pattern (:43, 17pt weight 900, textSecondary)
   ├─ Text total   — formatCurrencyWhole(mtd, currency), headline scale (MonthlyOverviewCard :92 pattern)
   ├─ Badge (absolute top-right, MonthlyOverviewCard :50-72 pattern, Icon arrow.up/down.right)
   └─ Text body    — one line, typography.bodyMd, colors.textPrimary
```

Copy (proposal wording, spec REQ-7):

| Element | MoM source | Fallback source |
|---|---|---|
| Kicker | `RITMO DEL MES` | `RITMO DEL MES` |
| Total | `$7.200` (`formatCurrencyWhole`) | `$7.200` |
| Badge | `+12,5% vs mes anterior` (or `−x%`, signed; `0%` flat) | `+12,5% vs tu promedio` |
| Projection line | `Al ritmo actual cerras en ~$27.000` | `Al ritmo actual cerras en ~$27.000` |

- Delta prefix: `deltaPct > 0 ? '+' : ''` (MonthlyOverviewCard :69). Badge color semantics: spend above baseline = warning tint, below = `primaryContainer` (MonthlyOverviewCard :54 precedent).
- Projection always carries `~` + «al ritmo actual» framing → never reads as a guarantee (NFR-4).
- Decimal separator follows repo convention (dot in the number, `12.5`) — `changePct` renders as a number (MonthlyOverviewCard :69), no es-AR comma conversion anywhere in existing copy. Spanish "cerras" is deliberate voseo per spec.
- States: `data` → render; `null` (loading / not-current / cache-miss pending / error / gates) → **render nothing** (AD-6). No skeleton, no placeholder, no focusable stub (NFR-3).

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/features/home/lib/runRate.ts` | Create | Pure `aggregateRunRate` + `RunRateResult` (contract above) |
| `src/features/home/hooks/useRunRate.ts` | Create | Cache-consumer hook: batch read, recalc on cache-miss, gating |
| `src/features/home/components/RunRateCard.tsx` | Create | Presentational card + tap → `/analytics` |
| `src/features/home/index.ts` | Modify | Barrel: export `aggregateRunRate` & `RunRateResult` (lib), `useRunRate` (hooks), `RunRateCard` (components) |
| `src/app/(tabs)/index.tsx` | Modify | Mount `{runRate.data ? <RunRateCard …/> : null}` between `monthSelector` (:224) and the budget section (:226-252) |
| `scripts/test-run-rate.mjs` | Create | Node harness (pattern: scripts/test-monthly-overview.mjs) |
| `scripts/tsconfig.run-rate-test.json` | Create | Test tsconfig (mirror `tsconfig.monthly-overview-test.json` include list + `../src/features/home/lib/runRate.ts`) |
| `package.json` | Modify | Add `"test:run-rate": "node scripts/test-run-rate.mjs"` + append to the `test` chain |

No migration, no SQL, no new dependencies (NFR-1).

## Testing Strategy

**Runner:** repo pattern — `scripts/test-*.mjs` node harness (compile via `tsc -p tsconfig.<name>-test.json` into a temp dir, require-hook `@/` → outDir, native modules → `scripts/test-stubs/*`, fixed fixtures). `test:run-rate` joins the `pnpm test` chain.

**File:** `scripts/test-run-rate.mjs` — deterministic, no clock (explicit `referenceDate` strings); `aggregateRunRate`'s graph compiles under the same stubs as the monthly-overview test (`useHomeFeed.ts`, `format.ts`, `query-keys.ts`, `types/index.ts`, `test-stubs/*`).

| # | Case | Fixture / assertion |
|---|------|---------------------|
| 1 | MoM happy path | referenceDate `2026-09-08`; Sep days 1..8 = $7.200, Aug days 1..8 = $6.000 → `mtd 7200`, `baseline 6000`, `deltaPct 20`, `projection 27000`, `source 'mom'` |
| 2 | MoM delta negative | MTD < baseline → signed negative `deltaPct` |
| 3 | Future-day clamp | Sep `daily_totals` includes day 12, today 8 → excluded from `mtd` AND from spend-days count |
| 4 | Stray month keys | `daily_totals` with `2026-08-05` inside the Sep row → ignored (prefix check) |
| 5 | Fallback prorating (AD-1) | May/Jun/Jul rows present, Aug missing; referenceDate `2026-09-08` → `baseline = 24000 × 8/30 = 6400`; MTD 7200 → `deltaPct 12.5`, `source 'fallback'`, `projection 27000` |
| 6 | Fallback, 1 available month | Only Jul exists → mean = Jul alone; baseline = `Jul × 8/30` |
| 7 | Fallback, none available | No preceding rows (or all 4 prev missing) → `null` |
| 8 | MoM window empty → fallback | Aug row exists but 0 spend in days 1..8 → REQ-2 scenario 2 → fallback path |
| 9 | Day 1-2 gate | referenceDate `2026-09-02` with 2 spend days → `null`; 3rd day added → non-null (threshold = 3) |
| 10 | Empty month | Current row with `{}` `daily_totals` → `null` (REQ-1 MTD 0 is valid, REQ-5b hides) |
| 11 | Feb vs 31-day | referenceDate `2026-02-10`; Jan days 1..10 baseline; `projection` denominator 28; `2027-02-10`-style 31-day prev handled day-vs-day |
| 12 | Year rollover | referenceDate `2026-01-05`; baseline from `2025-12` window (via `previousMonthKey`) |
| 13 | Rounding + −0 | `(mtd−baseline)/baseline×100 = 0.04` → `deltaPct 0` (not `-0`); 12.34 → 12.3 |
| 14 | Zero-ish baseline | Fallback mean or MoM window `0` → `null` (no div-by-zero) |

**Verification (acceptance gates):** `pnpm typecheck`; hand-computed mid-month check from cache rows; five hidden-state checks (day 1-2, empty month, past month, no baseline, read failure); Feb check; cache-miss → recalc → render; tap → Analytics.

## Edge Cases and Mitigations

| Edge case | Behavior | Mitigation |
|---|---|---|
| Day 1-2 of the month | Hidden | `< 3` spend days gate (REQ-5b) |
| Future-dated `daily_totals` entries | Clamped | `key <= referenceDate` on MTD + spend-days |
| Stray foreign-month keys in `daily_totals` | Ignored | `key.startsWith(currentKey)` prefix check |
| Prev month missing / empty window | Fallback path | REQ-2 scenario 2 → REQ-3 |
| < 1 preceding completed month | Hidden | fallback scan returns nothing → `null` |
| Fallback mean or window sums to 0 | Hidden | `baseline <= 0` → `null` (delta undefined) |
| Feb vs 31-day months | Day-vs-day baseline; current-month denominator | `dayOfMonth` cap on prev window; `daysInMonth` from referenceDate's own month |
| January (year rollover) | Dec of prior year | `previousMonthKey` (useHomeFeed.ts:170) |
| Current-month cache-miss | Hidden until recalc resolves | `triggerMonthlyRecalc` effect + refetch (REQ-6) |
| Read failure (network/DB) | Hidden | query `isError` → `{ data: null }`; never fabricate (REQ-6) |
| `deltaPct` ≈ 0 | Renders `0%` | `-0` normalization (AD-7) |
| Month boundary while app open | Math re-derives on day flip | `todayLocalISO()` in memo deps |
| Past-month selected | No reads, hidden | Hook early gate in `currentMonthKey()` |
| Household exists | Personal-only by construction | `readMonthlyCacheRows` is `userId`-scoped; no householdId path in this hook (REQ-6c) |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Fallback misleads new/noisy users | Med | ≤3-month mean, prorated; hide when no baseline; «vs tu promedio» copy distinguishes source |
| Layout jump when card appears/disappears | Low | Uniform `listHeader` gap; card slot collapses cleanly (REQ-8b) |
| Stale "today" across midnight | Low | Day token in `useMemo`; Home refetches on focus (useFocusEffect :90) |
| Copy reads as a guarantee | Low | `~` + «al ritmo actual» framing (NFR-4) |
| Double-fetch current row | None by design | Single batch query owns all rows (AD-3) |
| `readMonthlyCacheRows` row count grows | Negligible | Fixed 5-month window, single indexed read (NFR-1) |

## Migration / Rollout

No migration, no feature flag, no backend change. Rollback = revert PR (unmount card, delete 3 new files, restore barrel) — pure client code, no data risk.

## Open Questions

- [x] AD-1 prorating formula confirmed (`mean × dayOfMonth ÷ daysInCurrentMonth`, numeric example above).
- None blocking.