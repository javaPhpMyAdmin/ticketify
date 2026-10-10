# Tasks: Money Integrity

Three slices, fixed order **C → B → A** (C pure parser; B receipt-denomination write
path; A grouped aggregation + cache reshape, depends on B's column). strict_tdd:
every behaviour task opens RED (harness pin / SQL assertion / source pin) and closes
GREEN in the same commit. `pnpm test` is a hand-rolled node chain (`scripts/test-*.mjs`)
— new harnesses need a `package.json` script AND a link in the master chain, or the
chain never runs them. `pnpm test:sql` requires Docker; SQL-smoke tasks MUST NOT be
skipped silently at verify.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines — Slice C | ~280–340 |
| Estimated changed lines — Slice B | ~560–720 |
| Estimated changed lines — Slice A | ~780–980 |
| Estimated changed lines — total | ~1620–2040 |
| 400-line budget risk | **High** |
| Chained PRs recommended | **Yes** |
| Suggested split | PR 1 (C) → PR 2 (B) → PR 3 (A) |
| Delivery strategy | ask-always |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

Honest breakdown — the 800 figure is this session's real budget:
- **C fits 800 and 400** (~300). Smallest slice, fully independent.
- **B fits 800 (~640) but not 400.** Migration 0042 alone ≈ 240 lines (0029 precedent:
  one save_receipt overload re-declared a 221-line function).
- **A is at/over the 800 edge (~880).** The A SQL splits across `0043_household_entry_currency.sql`
  (landed: entry checks ≈ 70) and `0044_grouped_aggregation.sql` (two RPC
  re-declarations ≈ 250 lines, 0015 recalc reshape ≈ 150) plus client adapters +
  renders + harness pins. **A may exceed 800 by itself.** Its only viable sub-split is
  A-entry (households.currency + join check, additive, non-breaking) ahead of A-main
  — A-main's SQL+client pair is ATOMIC (`monthly_user_totals` PK reshape +
  `maybeSingle()` consumers break the moment SQL lands without the client).
- B and A each ~1.5–2.5× the 400 guard → chained/stacked PRs required unless the user
  grants `size:exception`.

### Suggested Work Units

| Unit | Tasks | Likely PR | Est. lines | Notes |
|------|-------|-----------|-----------|-------|
| 1 | C* (1.1–1.3) | PR 1 — parse-money | ~300 | Independent; base main |
| 2 | B* (2.1–2.7) | PR 2 — receipt currency end-to-end | ~640 | 2.7 needs Docker; SQL file + runner + ci.yml in the SAME PR |
| 3 | A* (3.1–3.8) | PR 3 — grouped aggregation + cache | ~880 | Atomic SQL+client; likely `size:exception`; optional A-entry sub-split first (~150) |

## `formatCurrency(` / `formatCurrencyWhole(` site classification (before apply, re-grep `formatCurrency\(|formatCurrencyWhole\(` and confirm the list below is still exhaustive)

**Single-row → `row.currency ?? viewer` / `draft.currency ?? viewer` (Slice B):**
`receipts/[id].tsx` 517, 551, 580 · `ReceiptRow.tsx` 168, 191 (home feed row, `(tabs)/index.tsx:175`) · `stores/[name].tsx` 102, 118 · `items/[name].tsx` 160 · `categories/[key].tsx` 160 · `ReceiptCategoryItemsModal.tsx` 63, 80 (one receipt) · `ticket/manual.tsx` 359, 363, 421 · `ticket/review/[id].tsx` 655, 688, 693 · `ReviewItemRow.tsx` 105. (Receipt rows carry a unit after B; the draft surfaces the draft's unit.)

**Aggregate → grouped breakdown (Slice A):**
`HouseholdCard.tsx` 202 · `MonthlyOverviewCard.tsx` 47 · `CategoryBreakdownList.tsx` 46 (plus 51 percent) · `InsightHeroCard.tsx` 184 (hero headline) · `history.tsx` 412, 441 (household item-search sums) · `stores/[name].tsx` 82, `items/[name].tsx` 122, `categories/[key].tsx` 133 (client-side sums over row lists) · `TopItemsBreakdown.tsx` 57 (not named in design's file list — confirm scope at apply) · `CategoryBudgetCard.tsx` 101, 147 (amount fields; category-row usage in `history.tsx` 503, 542 and home) · `CategoryBudgetRow.tsx` 105, 118 (+112 a11y, analytics rows).

**Single-series → bind viewer-currency row only, one figure, never split/hidden (Slice A, decision 9):**
`RunRateCard.tsx` 65, 66 (`formatCurrencyWhole`) · `CapsuleBarChart.tsx` 80 · `DayDetailModal.tsx` 89, 108 · `pro/charts.tsx` 763 (getTopCategory — pass-3 §3), 770 · `CategoryDonut.tsx` 176, 222 · `ChartLegend.tsx` 118 · `StoreBars.tsx` 83, 92 · `InsightHeroCard.tsx` 223.

**Deferred (budget family / integer contract / zero placeholder / dead):**
`BudgetCard.tsx` 65 · `MonthlyBudgetCard.tsx` 69 · `SnacksBreakdownModal.tsx` 67, 84 · `CategoryBudgetRow.tsx` 106, 112 (limit fields) · `CategoryBudgetCard.tsx` 131, 132, 140 (limit fields) · `AmountDisplay.tsx` 37 (BudgetCard-only consumer) · `history.tsx` 369 (all-hidden zero) · `CategoryCard.tsx` 66 (barrel-exported, **no JSX consumer found** — confirm dead, leave untouched). Budget amounts stay viewer-labeled: `budget_limit` only exists on viewer-currency rows (design Interfaces).

## Phase 1 — Slice C: `parseMoney` (pure; REQ-7)

- [x] 1.1 **RED** — Create `scripts/test-parse-money.mjs` + `scripts/tsconfig.parse-money-test.json` (copy the `format-currency-test` compile pattern); add `test:parse-money` to `package.json` AND link it in the master `test` chain. Pin REQ-7 #1–#9 exactly as written in the delta — the decision-10 truth table: `1.234`→1234; `1,234`→1234; `45.99`→45.99; `47.5`→47.5; `1234,56`→1234.56; `1234.56`→1234.56; `1.234,56`→1234.56; `1,234.56`→1234.56; `'1,234','USD'`→1234; `'1.234','USD'`→1234; `'1.234','ARS'`→1234; `'1,234','ARS'`→1234 (code- and locale-independence, #6/#8/#9); empty/`abc` → null + design's zero-decimal row (CLP/JPY/PEN/PYG round whole, COP stays 2-dec). Module absent → red.
- [x] 1.2 **GREEN** — Create `src/lib/parse-money.ts`: `parseMoney(input, currencyCode): number | null`; trim; reject anything not `^[0-9.,]+$` and no-digit input → null; both separators → rightmost is decimal (others grouping); ONE separator type → grouping iff exactly three digits follow it, decimal otherwise — symmetric, identical for `.` and `,` (`1.234`→1234, `1,234`→1234, `45.99`→45.99); separator rule never varies with locale/code (`currencyCode` only drives zero-decimal rounding); zero-decimal catalog from `src/lib/format.ts`.
- [x] 1.3 **RED→GREEN** — `src/features/tickets/components/ItemEditorModal.tsx:115`: replace `parseFloat(priceStr)` with `parseMoney(priceStr, settingsCurrency)` under the symmetric separator rule (raw numeric seeds like `45.99`/`1234.56` round-trip untouched); `canSave` requires non-null result; RED source-pin first in `scripts/test-manual-screen.mjs` (modal calls `parseMoney` on price, no bare `parseFloat`).

## Phase 2 — Slice B: receipt denomination end-to-end (REQ-8, REQ-LIST-2/3/4, Purchase Writes)

- [x] 2.1 **RED** — Extend `scripts/test-parse-ticket.mjs`: list-mode `currency` accepted into `ParsedReceipt` (REQ-LIST-2 s1); absent currency still succeeds (REQ-LIST-2 s2); out-of-catalog dropped, no throw (REQ-LIST-3 s1); shape carries validated unit, other members unchanged (REQ-LIST-4 s1/s2); prompt pins (both prompts ask ISO 4217; plain-numbers rule kept); catalog parity pin (edge's own catalog vs `SUPPORTED_CURRENCIES` — edge cannot import from `src/`).
- [x] 2.2 **GREEN (edge)** — `supabase/functions/parse-ticket/index.ts` (receipt + list prompts, list-mode builder) and `lib/parse.ts`: extract/validate `currency` (uppercase + catalog check) → `currency?: SupportedCurrency` on the parsed shape; out-of-catalog / absent → omitted (client falls back to viewer).
- [x] 2.3 **Migration 0042** — Create `supabase/migrations/0042_receipt_currency.sql`: nullable `purchases.currency`, **no backfill** (REQ-8 s3); 8-param `save_receipt(..., p_currency text, p_is_manual boolean default false)` — `p_currency` REQUIRED and placed BEFORE the defaulted `p_is_manual`, per 0029 overload precedent, keep 6/7-param arities (Postgres 42P03: no tie-break among defaults; a defaulted `p_currency` after the 7-param arity breaks the live 7-key route with PGRST203 — verified PG 17.6.1.155 + PostgREST 14.15). Omit currency → 7-arg → f7 → column default NULL; set → 8-arg → f8 re-checks the catalog. Grants for the new signature. Client and migration land in the SAME unit (SQL alone changes nothing harmful, but REQ-8 end-to-end is one story).
- [x] 2.4 **RED** — Extend `scripts/test-manual-screen.mjs` (and `test-features.mjs` / `test-scan-contract.mjs` / `test-manual-receipt.mjs` if any exact-args pin goes red): `buildSaveReceiptArgs` emits `p_currency` when `draft.currency` is set and omits it otherwise; RPC name and failure-path contract unchanged (data-access s2 regression).
- [x] 2.5 **GREEN (client write path)** — `src/types/index.ts` `ReceiptDraft.currency?`; `src/features/tickets/api.ts` `ParsedReceipt.currency`, `EdgeParsedReceipt.currency`, `buildSaveReceiptArgs` → `p_currency`; `src/app/ticket/review/[id].tsx` unit switcher editing `draft.currency` ONLY — relabel, magnitudes untouched (REQ-8 s5); `p_currency` reaches `save_receipt` (data-access s1: row persists `CLP`).
- [x] 2.6 **Row renders** — Apply `row.currency ?? viewer` / `draft.currency ?? viewer` at the single-row sites in the table above (`receipts/[id]`, `ReceiptRow`, `stores/[name]`, `items/[name]`, `categories/[key]:160`, `ReceiptCategoryItemsModal`, `manual`, `review/[id]`, `ReviewItemRow`); personal scope row.currency ?? viewer == today (REQ-8 s4: profile switch rewrites no row). Aggregates untouched this slice.
- [x] 2.7 **SQL smoke (Docker)** — Create `supabase/tests/receipt-currency.sql` (row stored with `CLP` persists + renders CLP; legacy row stays NULL; out-of-catalog code not persisted; no backfill) and register in `scripts/test-db-smoke.mjs` runner + `.github/workflows/ci.yml` db-smoke step IN THE SAME PR — `test-sql-smoke-coverage` (a `pnpm test` segment) turns red otherwise. **`pnpm test:sql` REQUIRED at verify — never skipped.**
- [x] 2.8 **Edit-path unit persistence (orchestrator ruling)** — Remove the `!editingMode` gate: the review unit switcher renders in edit mode too (edits always route through `review/[id]`; `manual.tsx` is new-entry only — no second switcher surface). `updateReceipt` PATCH gains conditional `currency`: draft carries a code → f8-parity re-check CLIENT-SIDE (`normalizeCurrency`: upper/btrim + 14-code catalog; out-of-catalog → `null`, never raises); draft unit-less → key omitted (stored unit untouched, payload keeps its pre-existing shape). `restorePurchase` restores the ORIGINAL unit, so a failed edit rolls the unit back with the other fields. RED pins first: `test-features.mjs` (payload carries catalog code / omits key when unit-less / out-of-catalog → `null` no-throw + restore restores original unit) and `test-manual-screen.mjs` (switcher present AND ungated). **Discovery:** there is NO `update_receipt` RPC in any migration — `updateReceipt` is a direct PostgREST PATCH, so the ruling's 42P03 arity constraint is N/A and 0042 stays as written (recorded in design's `updateReceipt` row).
- [x] 2.9 **Manual-draft unit seeding (4R fix-pass ruling W3)** — `buildManualDraft` gains a trailing optional `currency` param and spreads `...(currency ? { currency } : {})` (falsy → key ABSENT, preserving the 7-key payload contract); `manual.tsx` `handleSubmit` passes the settings-profile `currency`, so a NEW manual draft is never born unit-less (the store draft is reseeded empty on mount and never holds a unit; display `draft?.currency ?? currency` yields the same value either way). RED pins first: `test-manual-receipt.mjs` (builder seeds / builder omits key / D2.5 builder → `saveManualReceipt` → `p_currency` end-to-end) + `test-manual-screen.mjs` source pin (handleSubmit passes the profile unit; bite-verified by removing the arg).

## Phase 3 — Slice A: grouped aggregation + cache reshape (entry check, RPCs, cache, client)

- [x] 3.1 **RED (SQL, Docker)** — Extend `supabase/tests/household-totals.sql`: mixed-currency fixture (UYU+CLP household), per-unit subtotals on `monthly_category_totals` + `monthly_purchases_total`, `budget_limit` NULL in household mode, non-member zero rows, personal grouped-after-switch (5 Aggregation RPC scenarios); entry-check scenarios (creator seeds currency / match joins / mismatch raises / enforced only at entry); recalc scenarios (mid-month switch, household mixed, **empty month → exactly one row `(abc, 2025-01, UYU)`** §1, orphan prune §2, relabel-not-rewrite s5); percent computed per currency. Red until 0043 §entry / 0044 land.
  - Partially landed in A-entry: the entry-check scenarios (s1-s4 + NULL-household skip) live in `household-totals.sql` §4b (RED 13fc7c4, GREEN with 0043 §entry 3885b31). Aggregation RPC, recalc and percent scenarios remain for A-main.
- [x] 3.2 **0043 §entry** — In `supabase/migrations/0043_household_entry_currency.sql`: `households.currency` seeded from creator's profile in `create_household`; `join_household` raises `currency_mismatch` on mismatch creating no membership row; NULL household skips; never re-validated later (4 Entry scenarios). Landed in A-entry (3885b31; renamed from 0043_grouped_aggregation.sql in the 4R fix pass): §entry only — the file carries §1-§4 (column, both RPC re-declarations, owner/grants pins); §aggregation/§cache move to the A-main follow-up migration `0044_grouped_aggregation.sql`, since a merged migration file is immutable.
- [x] 3.3 **0044 §aggregation** — In `supabase/migrations/0044_grouped_aggregation.sql`: re-declare `monthly_category_totals` + `monthly_purchases_total` (0026) grouping by `coalesce(p.currency, recorder's profile currency)` — **recorder profile, never the caller** (§4), returning `currency` per row; `percent_of_total` windowed per currency; `budget_limit` only in personal mode; household scope via `p_household_id` + `is_household_member`; non-member → zero rows.
- [x] 3.4 **0044 §cache** — In `supabase/migrations/0044_grouped_aggregation.sql`: re-key `monthly_user_totals` PK → `(user_id, year_month, currency)`, `currency` text NOT NULL via PK, `total` keeps its name (§5); relabel existing cache rows under current profile currency (derived data — no `purchases` row rewritten); rewrite `recalculate_monthly_totals(p_user_id, p_year_month, p_household_id DEFAULT NULL)` (0015): grouped upsert per effective unit, missing groups pruned (§2), empty month → single zero row in caller profile currency (§1) (5 Recalculate scenarios, 5 Cache Schema scenarios).
- [x] 3.5 **RED (node)** — Extend `scripts/test-monthly-cache.mjs`, `scripts/test-household-category-items.mjs`, `scripts/test-analytics-headline.mjs` (+ `test-monthly-overview` / `test-home` / `test-run-rate` if shape pins go red): grouped adapter shape (`{currency,total}[]`), household-drilldown grouped rows, headline renders one figure per unit, single-series binds viewer row. Red until adapters land.
- [x] 3.6 **GREEN (adapters)** — `src/lib/supabase/feature-access.ts`: `readMonthlyCacheRow(s)` drop `.maybeSingle()` and return row-per-group for the month (PK no longer unique per month), `MonthlyTotalsCacheRow.currency`, `readCategoryTotals` / `readMonthlyPurchasesTotal` → `{currency,total}[]`, `readHouseholdCategoryItems` grouped; `analytics/api.ts`, `useMonthlyCache.ts` (+`transformCacheToCategoryTotals`), `useMonthlyTotals.ts`, `useHomeFeed.ts` (`useHouseholdMonthTotal` grouped, `aggregateHouseholdCategoryItems`), `analytics-headline.ts` (headline groups; placeholder never a false single figure).
- [x] 3.7 **GREEN (headline + aggregate renders)** — Render every group, one labeled figure per unit: `HouseholdCard` (mixed month → per-currency subtotals, client-state s2), `MonthlyOverviewCard`, `CategoryBreakdownList` (+ percent per currency), `InsightHeroCard:184`, `history` 412/441 + category-card amounts (CategoryBudgetCard 101/147), detail-screen totals `stores/[name]:82`, `items/[name]:122`, `categories/[key]:133`, `TopItemsBreakdown` (scope confirm); single-currency months render today's single figure (client-state s1; analytics toggle s3 passes `p_household_id` — verify unchanged).
- [x] 3.8 **GREEN (single-series binding — decision 9, pass-3 §3)** — Bind the viewer-currency cache row only, render exactly one figure, never split into per-currency series, never hide when mixed: `aggregate.ts` consumers + `RunRateCard` (run-rate), 6-month trend, daily/store charts (`CapsuleBarChart`, `StoreBars`, `ChartLegend`, `CategoryDonut`, `DayDetailModal`), `getTopCategory` (single-series — returns ONE `HomeCategory`), `pro/charts.tsx` 763/770, `InsightHeroCard:223`; record the accepted switch-month under-report (Read Contract s4) in a code comment at the binding site.

## Phase 4 — Closure

- [x] 4.1 **Non-Goals replacement** — Verify `specs/currency-universality/spec.md` carries the `## Non-Goals (replaced)` section (FX, COP zero-decimal, CHECK hardening) and that archive is instructed to SWAP it into the main spec (not merge requirement blocks only). Must ship with this change — a main-spec Non-Goals list denying REQ-7/REQ-8 post-archive is the drift this delta exists to prevent.
- [x] 4.2 **Gates** — `pnpm test` (full chain, new segments green) · `pnpm typecheck` · `pnpm lint` · `pnpm test:sql` (Docker — never skipped) · re-grep `parseFloat` price sites (only budget integer paths may remain) · re-grep `formatCurrency\(|formatCurrencyWhole\(` vs the classification table · grep confirms `get_household_feed` and `get_household_category_items` RPC bodies untouched · scenario→task audit below.

## Scenario → task ownership (every REQ and scenario mapped)

| REQ / scenario | Tasks |
|---|---|
| currency-universality REQ-7 #1–#9 | 1.1, 1.2, 1.3 |
| currency-universality REQ-8 #1 (CLP row renders CLP) | 2.3, 2.5, 2.6, 2.7, 2.9 |
| REQ-8 #2 (out-of-catalog → not persisted, viewer fallback) | 2.1, 2.2, 2.3, 2.5 |
| REQ-8 #3 (no backfill) | 2.3, 2.7 |
| REQ-8 #4 (profile switch rewrites no row) | 2.3, 2.6, 2.7 |
| REQ-8 #5 (review correction relabels only) | 2.4, 2.5 |
| REQ-8 #6 + data-access "Purchase edit persists a unit correction" (edit relabel persists; catalog fallback; unit-less untouched) | 2.8 |
| currency-universality Non-Goals (replaced) | 4.1 |
| data-access Purchase Writes Persist Real Rows s1 (row persists unit) | 2.3, 2.4, 2.5, 2.7, 2.9 |
| data-access s2 (failure detectable; no false success) | 2.4 (unchanged contract regression) |
| REQ-LIST-2 s1/s2 | 2.1, 2.2 |
| REQ-LIST-3 s1 | 2.1, 2.2 |
| REQ-LIST-4 s1/s2 | 2.1, 2.2 |
| Household Entry Single-Currency Check s1–s4 | 3.1, 3.2 |
| Household-Scoped Aggregation RPCs s1–s5 | 3.1, 3.3, 3.6 |
| Client-Side Household State s1 (single-currency card) | 3.6, 3.7 |
| Client-Side Household State s2 (mixed grouped card) | 3.5, 3.7 |
| Client-Side Household State s3 (analytics toggle) | 3.6 (toggle pre-exists — verify) |
| Client-Side Household State s4 (settings mgmt) | pre-existing — verify-only in 4.2 |
| Cache Table Schema s1–s5 | 3.1, 3.4 (s5 relabel-not-rewrite) |
| Recalculate RPC s1–s5 | 3.1, 3.4 (s5 empty month §1, §2 prune) |
| Client-Side Read Contract s1 (50 receipts, all pages) | 3.5, 3.6 (cache path unchanged behavior) |
| Client-Side Read Contract s2 (mixed renders grouped) | 3.5, 3.7 |
| Client-Side Read Contract s3 (single-series viewer binding) | 3.8 |
| Client-Side Read Contract s4 (under-report accepted) | 3.8 (comment + pin) |
| Client-Side Read Contract s5 (cache-miss fallback) | 3.5, 3.6 (existing trigger, multi-row) |
| Design pass-3 §1 / §2 / §3 / §4 / §5 | 3.4 / 3.4 / 3.8 / 3.3 / 3.4 |

Nothing unmapped. Verify-only items (data-access s2, client-state s3/s4) are deliberate — the delta modifies their neighbourhood, not their behaviour.

## Dependency-forced order

1. **C before B?** No — C is independent; proposal order C→B→A stands.
2. **B before A** — 0044's `coalesce(p.currency, …)` requires 0042's column; A's client adapters consume B's row currency.
3. **A SQL + A client atomic** — 0044 makes `monthly_user_totals` multi-row per month; `.maybeSingle()` (feature-access) and single-`{total}[]` consumers break the moment SQL lands first. One unit.
4. **B SQL smoke registration atomic with its file** — `test-sql-smoke-coverage` runs inside `pnpm test` and pins disk ↔ runner ↔ ci.yml; any new `supabase/tests/*.sql` must be registered in all three in the same commit, or the master chain goes red.
5. **`test:parse-money` registration atomic with its harness** — an unregistered harness silently never runs.
6. **`household-totals.sql` extension is safe** — it is already registered on disk, in the runner, and in ci.yml; no re-registration needed.

## Risks for apply

| Risk | Sev | Mitigation / owner |
|---|---|---|
| **Design/delta separator conflict — CLOSED by decision 10 (symmetric rule):** spec and design now agree that `'1,234','USD'`→1234 and `'1.234'`→1234 (three digits follow → grouping), while `45.99` stays decimal. No conflict to surface; pin the full truth table in 1.1. | LOW | 1.1 — truth-table pins |
| A alone may exceed the 800 budget (~880, migration-heavy) | HIGH | User decides: `size:exception` or A-entry sub-split |
| B merges before A → intermediate main state: row labels correct, aggregate totals still viewer-labeled until A lands | MED | Chain-strategy consideration (stacked vs branch-chain is the user's call) |
| `maybeSingle()` / single-`{total}[]` consumers missed in A | HIGH | 3.6 grep: `.maybeSingle()`, `{ total: number }[]` |
| Renders do not re-grep → a new `formatCurrency` site carries viewer label | MED | 4.2 re-grep vs classification table |
| Edge catalog drifts from `SUPPORTED_CURRENCIES` | MED | 2.1 parity pin; 2.2 |
| `pnpm test:sql` needs Docker — skipped at verify | MED | 2.7 / 3.1 / 4.2: REQUIRED, never silent |
| `get_household_feed` / `get_household_category_items` accidentally touched | MED | 4.2 grep guard |