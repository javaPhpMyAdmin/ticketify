# Tasks: Current-Month Run-Rate Card

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~700 total (PR 1 ~470 pure fn + harness; PR 2 ~230 hook + UI + mount) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 |
| Delivery strategy | auto-forecast |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

Both slices fit the 600-line review budget (PR 1 ~470 < 600, PR 2 ~230 < 600); the whole change exceeds it.

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Pure `aggregateRunRate` + 14-case harness (T1.1–T1.4) | PR 1 | base: main; standalone, `pnpm test:run-rate` green; no UI |
| 2 | Hook + card + mount (T2.1–T3.3) | PR 2 | base: PR 1 branch; `pnpm typecheck` + manual gates 2–6 |

## Phase 1: Pure Math Foundation (PR 1)

- [x] T1.1 Create `src/features/home/lib/runRate.ts` (new `lib/` dir — precedent `src/features/tickets/lib/picture-size.ts`): `RunRateResult` + pure `aggregateRunRate(rows, referenceDate)` with the 6-step gate chain — current row missing → null; spend-days ≥3 (REQ-5b); MTD = Σ `daily_totals` where `key.startsWith(currentKey) && key <= referenceDate` (REQ-1); MoM day-vs-day baseline via `previousMonthKey` (useHomeFeed.ts:170) (REQ-2); fallback mean of ≤3 prior rows × `day/daysInMonth` (AD-1, REQ-3); `deltaPct = Math.round(x*1000)/10` with `-0` → `0` (AD-5/AD-7); `projection = mtd/day × daysInMonth` (REQ-4)
- [x] T1.2 Create `scripts/tsconfig.run-rate-test.json` — mirror `tsconfig.monthly-overview-test.json` include list + `../src/features/home/lib/runRate.ts`
- [x] T1.3 Create `scripts/test-run-rate.mjs` — node harness (pattern `test-monthly-overview.mjs`, compile + require-hook + stubs), fixed `referenceDate` fixtures, 14 cases from design table: MoM happy/negative, future-day clamp, stray keys, fallback prorating (3-month + 1-month), no preceding rows, empty MoM window → fallback, 1–2 day gate, empty month, Feb-vs-31d, year rollover, rounding/−0, zero baseline
- [x] T1.4 `package.json` — add `"test:run-rate": "node scripts/test-run-rate.mjs"` + append `&& pnpm test:run-rate` to the `test` chain

## Phase 2: Data Hook (PR 2)

- [x] T2.1 Create `src/features/home/hooks/useRunRate.ts` — mirror `useMonthlyCache` pattern (analytics/hooks/useMonthlyCache.ts:88–122): early gate `monthKey === currentMonthKey() && !!userId` (REQ-5a); `useQuery` on `readMonthlyCacheRows(userId, [current, prev1..prev4])` (feature-access.ts:791), key `[...queryKeys.monthlyCachePrefix(userId), 'run-rate', monthKey]` (AD-4); cache-miss → one-shot `triggerMonthlyRecalc` mutation + refetch (REQ-6); `isError` → `{ data: null }`; memo `aggregateRunRate(rows, todayLocalISO())` (NFR-2)

## Phase 3: UI + Integration (PR 2)

- [x] T3.1 Create `src/features/home/components/RunRateCard.tsx` — presentational: kicker `RITMO DEL MES`, `formatCurrencyWhole(mtd, currency)`, signed delta badge (`+12,5% vs mes anterior` / `vs tu promedio`), `~` projection line «Al ritmo actual cerras en ~$Z»; `Pressable` → `router.push('/analytics')`; `accessibilityRole="button"` + label/hint; styling per `MonthlyOverviewCard` (analytics/components/MonthlyOverviewCard.tsx) (REQ-4, REQ-7, NFR-3/4)
- [x] T3.2 `src/features/home/index.ts` — barrel: export `aggregateRunRate`, `RunRateResult` (lib), `useRunRate` (hooks), `RunRateCard` (components)
- [x] T3.3 `src/app/(tabs)/index.tsx` — `const runRate = useRunRate(monthKey)`; render `{runRate.data ? <RunRateCard result={runRate.data} currency={currency} /> : null}` between monthSelector (~:209) and MonthlyBudgetCard (~:229) (REQ-8, AD-6)

## Phase 4: Verification (whole change)

- [ ] T4.1 Acceptance gates: `pnpm typecheck`; `pnpm test:run-rate` 15/15 green; `pnpm test:run-rate-hook` 8/8 green (R3 review — real hook mount, deterministic clock, recalc-once + last-good + mid-session navigation pins); manual — 5 hidden states (day 1–2, empty month, past month, no baseline, read failure), Feb check, cache-miss → recalc → render, tap → Analytics