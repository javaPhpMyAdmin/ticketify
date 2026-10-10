# Design: money-integrity

HOW to build slices **C → B → A**. Binding constraints: unit per row, no backfill, fixed separator rule (REQ-7), grouping is correctness, entry-only single-currency check, personal totals group by currency. Deltas belong to `sdd-spec` (parallel).

## Resolved from proposal: `percent_of_total` across currencies

**Compute per currency.** Denominator = same-currency sum (`partition by` effective currency in `monthly_category_totals`, same rule client-side); a EUR+USD category renders under each group. **Rejected — hide when mixed:** degrades the case this change serves, conflates `null`="mixed" with "no data", discards per-currency information; cross-currency share needs FX (out of scope). Single-currency months stay identical to today.

## Architecture Decisions

| Topic | Choice | Rejected → why |
|---|---|---|
| C home | `src/lib/parse-money.ts`: `parseMoney(input, currencyCode): number \| null` (trim; reject non-`^[0-9.,]+$`; empty side ok); catalog from `format.ts` | In-format.ts (display-only); inline filter (WET) |
| Ambiguity | Fixed, locale- and currencyCode-independent (REQ-7, decision 10 — symmetric rule). Both present → rightmost is decimal, others grouping. ONE separator type → thousands grouping exactly when three digits follow it, decimal otherwise — identical for `.` and `,` (`1.234`→1234, `1,234`→1234, `45.99`→45.99, `47.5`→47.5). `currencyCode` accepted only for zero-decimal rounding, never to select a convention. Non-numeric / no finite amount → `null`. | Old asymmetric rule (lone `,` always decimal, only `.` got the three-digit exception — `1,234` parsed as 1.234, a 1000× error); keyboard/locale guessing (device-dependent); using currencyCode to select convention (breaks seeded inputs) |
| Zero-decimal input | CLP/JPY/PEN/PYG round whole; COP stays 2-decimal (non-goal) | Reject decimals; store cents |
| Legacy NULL rows | `coalesce(row.currency, recorder profile)` everywhere — personal scope: recorder == viewer, unchanged; household: each legacy row labeled by the member who recorded it, never by the caller (pass-3 §4) | Unknown-group (breaks today's sums); observer-dependent labels (same household month grouped differently per caller) |
| `save_receipt` | 8-param overload `p_currency text` REQUIRED, placed BEFORE `p_is_manual boolean default false`; keep 6/7-param (0029 precedent) — omit currency → 7-arg → f7 → column default NULL; set → 8-arg → f8 re-checks catalog. Postgres 42P03: no tie-break among defaults; a defaulted `p_currency` after the 7-param arity breaks the live 7-key route (PGRST203). `p_currency` required before `p_is_manual boolean default false`. | In-place replace (kills rollback); `p_currency text default null` while keeping the 7-param (verified PGRST203 on the live 7-key call, PG 17.6.1.155 + PostgREST 14.15) |
| Gemini + catalog | Prompt emits ISO 4217 or null; parse upper-cases, catalog-checks against `format.ts` SUPPORTED_CURRENCIES (edge duplicate + parity test) → null, never scan failure; RPC re-checks | Strict ParseError (guess must not kill scans); src import from Deno edge |
| Entry check | `households.currency` seeded in `create_household`; `join_household` raises `currency_mismatch`; NULL household skips; never re-checked | Later checks (decision 1: entry-only) |
| Review correction | Switcher edits `draft.currency` only — relabel, magnitudes untouched; renders in BOTH scan-review and edit mode (orchestrator ruling: an edit may correct the unit). Scan persists via `save_receipt`, edit persists via `updateReceipt` | Convert-on-switch (FX, out of scope); gating the switcher to scan mode only (`!editingMode`) — rejected by the edit-path ruling |
| `updateReceipt` unit | Direct PostgREST PATCH (NO `update_receipt` RPC exists in any migration — verified across all `create or replace function` declarations, so the 42P03 arity constraint is N/A here). Payload carries `currency` conditionally: draft carries a code → normalized with the SAME rule as f8 (`upper(btrim)` + 14-code catalog) → out-of-catalog stores `null`, never raises; draft unit-less → key omitted (stored unit untouched, payload keeps its pre-existing shape). `restorePurchase` restores the ORIGINAL unit too, so a failed edit rolls the unit back with everything else | A new `update_receipt` RPC overload (nothing to overload — would rewrite a tested restore/photo flow); a BEFORE UPDATE trigger (4th copy of the catalog, NFR-1 spirit — the direct PATCH path already bypasses RPC validation by design, 0032 §note); writing `currency: null` for a unit-less draft (would clear a legit stored unit on every ordinary edit) |
| Cache reshape | PK → (user_id, year_month, currency); `currency text` (NOT NULL via PK); recalc upserts per effective currency, then prunes vanished groups (pass-3 §2); full canonical column set carries over unchanged — `total` (keeps its name), category_totals, store_totals, daily_totals, items_count, updated_at, user_id, year_month; existing derived rows get current profile label (derived data, not purchases backfill) | Flat `total` (cross-currency lie); `by_currency` jsonb (two truths); rename total → total_amount (churn, no value) |

## Pass-3 closure: five under-specified points

### §1 Empty month — keep a zero row keyed to the caller's profile currency

Zero purchases → exactly one row `(p_user_id, year_month, <p_user_id's profile currency>)`: `total = 0`, empty jsonb, `items_count = 0`. **Rejected — delete all rows:** absent is indistinguishable from "never computed", so the cache-miss fallback recalcs on EVERY read of that month (RPC + loading state per visit until a purchase lands). A stored zero row is the explicit "computed-empty" marker. After a profile-currency change the old zero row is just a stale group → §2 prunes it; the next miss-recalc recreates it in the new currency. `Empty month` (Recalculate RPC) now pins `(abc, 2025-01, UYU)` — wording fixed in the delta.

### §2 Vanishing groups — recalc ends by pruning orphans

Upsert-per-group never removes a row whose group disappeared (a UYU+CLP month losing its last CLP purchase leaves a stale CLP row). `recalculate_monthly_totals` is the only write path (trigger, month-change double-call, miss fallback), so cleanup lives there, same transaction:

1. Compute per-currency aggregate set S (effective currency per purchase).
2. S empty → S := {p_user_id's profile currency} with zero aggregates (§1).
3. Upsert one row per currency in S.
4. Final statement: `delete from monthly_user_totals where user_id = p_user_id and year_month = p_year_month and currency <> all (S)`.

Deleting the last CLP purchase: UYU upserted, CLP deleted. 0044-relabeled rows self-correct on the next recalc — no extra backfill.

### §3 `getTopCategory` — single-series, binds viewer-currency group

It is the fifth chart aggregation reading cache jsonb; the other four (trend, daily, daily-average, stores) are single-series (decision 9). It returns ONE `HomeCategory` — grouping forces a second slot and a layout change (chart redesign rejected). Bind the viewer-currency row, then argmax; the switch-month under-report is the accepted limitation (risk table).

### §4 `coalesce(row.currency, …)` — the recorder's profile, not the caller's

Household scope has no single viewer. Each legacy unit-less row is labeled with the profile currency of the member who recorded it; personal scope: recorder == viewer, today's rule unchanged. **Rejected — calling user's profile:** grouping becomes observer-dependent — the same household month groups differently per caller (two truths), and one member's legacy amount wears another member's label. Household recalc groups per purchase ("grouped by the recorded currency of each purchase"); per-recorder fallback keeps that observer-independent. `households.currency` is entry-only (decision 1) — a creation-time snapshot while members may switch post-join; using it as a label would contradict the recorder's current unit. For members who never switched, per-recorder equals `households.currency` anyway.

### §5 Cache columns — `total` keeps its name; `currency` is text

`total` stays `total` (canonical spec + delta already use it; renaming to `total_amount` is churn with zero value). `currency` is `text`, NOT NULL via PK membership. Full column set carries over unchanged: `user_id, year_month, currency, total, category_totals, store_totals, daily_totals, items_count, updated_at`.

## Data flow

```
B: Gemini ─currency?─▶ parse.ts catalog→null ─▶ ParsedReceipt ─▶ draft.currency
   ─▶ review switcher (relabel only) ─▶ p_currency ─▶ save_receipt ─▶ purchases.currency
   edit: draft.currency (seeded from row) ─▶ switcher (same, ungated) ─▶ updateReceipt PATCH
   ─▶ conditional currency (f8 rule client-side) ─▶ purchases.currency; failure → restore original unit
A: effective = coalesce(p.currency, recorder profile) ─▶ GROUP BY currency ─▶ {currency,total}[]
   ─▶ N lines (1 group ⇒ today's render); entry: create seeds ─▶ join validates ─▶ 'currency_mismatch'
```

## File Changes

| File | Slice |
|---|---|
| Create `src/lib/parse-money.ts`, `scripts/test-parse-money.mjs` + tsconfig; register in `package.json` | C |
| Modify `ItemEditorModal.tsx` :115 → `parseMoney(priceStr, currency)` (reads settings currency) | C |
| Create `supabase/migrations/0042_receipt_currency.sql` — nullable `purchases.currency`, no backfill, 8-param `save_receipt` | B |
| Modify `parse-ticket/index.ts` + `lib/parse.ts` (prompt/catalog), `types/index.ts`, `tickets/api.ts`, `review/[id].tsx` | B |
| Modify row-level renders (`receipts/[id]`, `ReceiptRow`, `history` rows, `stores/[name]`, `items/[name]`) → `row.currency ?? viewer`; tasks greps full list | B |
| Create `supabase/tests/receipt-currency.sql`; register in `test-db-smoke.mjs` + `ci.yml` | B |
| Create `0043_household_entry_currency.sql` (§entry: `households.currency` + entry checks — landed in the A-entry sub-split) + `0044_grouped_aggregation.sql` (0026 funcs return `currency`, percent partition, cache PK) | A |
| Modify grouped adapters (`feature-access.ts`, `analytics/api.ts`, `useMonthlyCache.ts`, `useHomeFeed.ts`), headline renders (`HouseholdCard`, `history`, `analytics`, `CategoryBreakdownList`, `MonthlyOverviewCard`), mixed fixture in `household-totals.sql` | A |

## Interfaces / Contracts

```ts
parseMoney(input: string, currencyCode: string): number | null
// monthly_purchases_total → (currency, total)[]; monthly_category_totals + currency,
// percent windowed per currency, budget_limit only on viewer-currency rows
// save_receipt(..., p_currency text, p_is_manual boolean default false);
// ReceiptDraft.currency? absent ⇒ 7-key call ⇒ f7 ⇒ column default NULL ⇒ viewer fallback
```

Headline surfaces render every group; single-series (budget, run-rate, trend, `getTopCategory`) bind the viewer-currency group (decision 9; pass-3 §3); `get_household_feed` untouched — deferred.

## Risks

| Risk | Mitigation |
|---|---|
| 0026 return-shape breaks `maybeSingle()`/`{total}[]` consumers | A ships SQL+client atomically |
| `formatCurrency` sites all take viewer currency | Tasks enumerate single-row vs aggregate vs deferred; missed site = wrong label |
| No backfill | Legacy NULL → viewer label forever (today's numbers incl. traveler wrongness); ships as spec Non-Goal delta |
| `test-sql-smoke-coverage` (master chain) pins disk↔runners↔CI | New SQL test registers in runner + `ci.yml` same PR or `pnpm test` breaks |
| Cache PK ripples to batch readers | Adapters return arrays; consumers pick group |
| Deep single-series (decision 9): mid-month currency switch under-reports on run-rate/6-month trend/daily-store charts and the top-category KPI | Accepted (viewer-currency group only). Chart redesign out of scope; hiding-when-mixed rejected to preserve information in mixed cases. |

## Testing Strategy (strict_tdd — red first)

| Slice | Red test | Pins | Unreachable in node harness |
|---|---|---|---|
| C | new `scripts/test-parse-money.mjs` | `'1234,56','ARS'`→1234.56; `'1.234,56'`→1234.56; `'1,234.56'`→1234.56; `'1.234'`→1234 (REQ-7 #4); `'1,234','USD'`→1234 AND `'1,234','ARS'`→1234 (symmetric rule — code doesn't override, #8); `'45.99'`→45.99 (boundary: two digits → decimal, round-trip #5, #9); `'47.5'`→47.5 (#9); locale-indep same for `ARS`/`USD` (#6); garbage/empty→null (#7); JPY whole-unit | Modal internals → source-pin `test-manual-screen.mjs` |
| B | `test-parse-ticket.mjs`, `test-manual-screen.mjs` | currency accepted; out-of-catalog→null not throw; prompt rule; `p_currency` in args; catalog parity | Switcher render (source-pin); **`receipt-currency.sql` Docker — `pnpm test:sql` REQUIRED at verify, never skipped** |
| A | `test-monthly-cache.mjs`, `test-household-category-items.mjs`, `test-analytics-headline.mjs` + `household-totals.sql` | grouped adapter shape; mixed fixture subtotals; percent per currency | RPC/RLS = Docker; renders = source pins; keyboard emission = manual check |

## Migration / Rollout

Additive columns + overloads; no source-row rewrite; slices revert independently. Size likely exceeds review budget → chained PRs per slice (confirm at tasks). `pnpm test:sql` only at verify (Docker).

## Open Questions

- [ ] Which migration retires the superseded `save_receipt` arities?
