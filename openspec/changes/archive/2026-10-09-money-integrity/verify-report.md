# Verify Report — money-integrity

**Change**: money-integrity (3 slices C→B→A, 4 stacked PRs #157/#159/#161/#163, main @ d5957b2)
**Version**: deltas 5 (currency-universality, parse-ticket-list-mode, data-access, household-sharing, monthly-totals-cache)
**Mode**: Standard (full gates + runtime evidence)
**Verdict**: PASS WITH WARNINGS

## Gates (all executed on main @ d5957b2, working tree clean except untracked openspec)

| Gate | Result | Evidence |
|---|---|---|
| pnpm typecheck | PASS EXIT 0 | tsc --noEmit, no errors |
| pnpm lint | PASS EXIT 0 | expo lint: 0 errors, 59 warnings (pre-existing, matches apply baseline) |
| pnpm test | PASS EXIT 0 | ~1745 assertions green across 59 chain segments; key segments: features 142, manual-screen 126, charts 116, home 48, manual-receipt 48, household-category-items 42, parse-ticket 36, parse-money 20, monthly-cache 19, run-rate-hook 9, analytics-headline 9, sql-smoke-coverage 13, doc-citations 9 |
| pnpm test:sql (Docker) | PASS EXIT 0 | supabase db reset applied 0001→0044 cleanly; all 10 smoke fixtures ran and passed (pro-subscription, household-totals, user-categories, recalculate-on-purchase-items-update, household-gate-tier, trial-cutover, legal-acceptances, delete-account, currency-default, receipt-currency) |

## Tasks completeness

OpenSpec tasks.md at verify time: 1.1–1.3, 2.1–2.9, 3.2 checked; 3.1, 3.3–3.8, 4.1, 4.2 UNCHECKED in the file.
Apply-progress (Engram #1691) marked ALL tasks done incl. A-main; merged code + passing gates substantiate completion.
Classification: implementation complete; the canonical tasks.md checkboxes were not refreshed after A-main (documentation drift → WARNING, reconciled at archive to 22/22).

## Spec compliance matrix (scenario → test → result)

### currency-universality

- REQ-7 #1–#9 (parseMoney fixed separator rule, symmetric, code/locale independent, no-finite → null, zero-decimal) → scripts/test-parse-money.mjs (20 pins: truth table, ARS/USD symmetry, empty/garbage→null, JPY rounds whole, COP stays 2-dec) + test-manual-screen source pin (ItemEditorModal uses parseMoney(priceStr, settings currency), no bare parseFloat) → COMPLIANT
- REQ-8 #1 (CLP row persists+renders CLP) → supabase/tests/receipt-currency.sql §3 + test-manual-screen pins → COMPLIANT
- REQ-8 #2 (out-of-catalog not persisted, viewer fallback) → receipt-currency.sql §4 + edge normalizeCurrency (lib/parse.ts:174, out-of-catalog → undefined → omitted) + f8 catalog re-check in 0042 → COMPLIANT
- REQ-8 #3 (no backfill) → receipt-currency.sql §1/§6 (nullable, no default, no CHECK) → COMPLIANT
- REQ-8 #4 (profile switch rewrites no row) → row-level renders bind row.currency ?? viewer (test-manual-screen pins) → COMPLIANT
- REQ-8 #5 (review correction relabels only) → test-manual-screen "switcher is relabel-only — the patch carries currency and no other key" → COMPLIANT
- REQ-8 #6 (edit-mode switcher; out-of-catalog stores no unit, edit never fails; unit-less draft untouched) → test-manual-screen "unit switcher renders in BOTH scan and edit mode" + test-features (updateReceipt: conditional key, normalizeCurrency→null no-throw, restorePurchase restores original unit) → COMPLIANT

### parse-ticket-list-mode

- REQ-LIST-2 s1/s2 (currency accepted; absent still succeeds) → test-parse-ticket.mjs → COMPLIANT
- REQ-LIST-3 s1 (out-of-catalog dropped, no throw) → test-parse-ticket.mjs → COMPLIANT
- REQ-LIST-4 s1/s2 (shape carries validated unit; valid without unit) → test-parse-ticket.mjs → COMPLIANT
- Catalog parity (edge vs SUPPORTED_CURRENCIES) → test-parse-ticket parity pin → COMPLIANT

### data-access

- Purchase Writes s1 (row persists unit + resolved category ids) → receipt-currency.sql §3 + test-manual-receipt D2.5 p_currency end-to-end → COMPLIANT
- Purchase Writes s2 (failure detectable, no false success) → test-scan-contract unchanged contract → COMPLIANT
- Purchase Writes s3 (edit persists unit correction, catalog fallback, unit-less untouched) → test-features pins → COMPLIANT

### household-sharing

- Entry s1 (creator seeds) / s2 (match joins) / s3 (mismatch raises CU001, no membership, household_id stays NULL) / s4 (entry-only) → household-totals.sql §4b (352-562) → COMPLIANT
- Aggregation RPCs s1 (personal unchanged) / s2 (household aggregates members, budget_limit NULL) / s3 (mixed UYU+CLP subtotals per unit) / s4 (personal grouped after switch) / s5 (non-member zero rows) → household-totals.sql §4c (a)–(e) + line 345-353 → COMPLIANT
- Client-Side Household State s1–s3 (card single figure, grouped mixed card, analytics toggle) → test-home 48 + test-household-category-items 42 + analytics-headline 9 → COMPLIANT (s4 pre-existing verify-only)

### monthly-totals-cache

- Cache Schema s1–s4 (new month row keyed per unit, switch month one row per unit, upsert on update, delete recalcs) → household-totals.sql §4c (g/h/i/j/l: empty-month, mixed personal, household scope, prune, trigger path) → COMPLIANT
- Cache Schema s5 (pre-reshape rows relabeled with values unchanged) → PARTIAL/DEVIATION — pinned half (purchases NEVER backfilled, fixture (k)) PASSES; the literal "row exists relabeled with values unchanged" is contradicted by 0044 (relabel then TRUNCATE, stale-data guard). Deliberate documented deviation; delta text reconciled at archive.
- Recalculate RPC s1–s5 (personal, mid-month switch, household, mixed household, empty month single zero row) → household-totals.sql §4c (g)=2025-01 UYU zero row, (h)=mixed personal per-unit, (i)=household mixed 270, (j)=orphan prune, (k)=no rewrite → COMPLIANT
- Client-Side Read Contract s1 (50 receipts all pages) → test-charts (cache jsonb reads) → COMPLIANT
- s2 (mixed renders grouped per unit) → test-monthly-cache 5.2.10/5.2.11 + analytics-headline grouped headlines → COMPLIANT
- s3 (single-series binds viewer-currency row) → test-charts bindViewerRows (100 USD/5000 CLP → 5000 CLP) → COMPLIANT
- s4 (under-report accepted, comment at binding site) → src/app/pro/charts.tsx:238 comment "ACCEPTED under-report (Read Contract s4)" → COMPLIANT
- s5 (cache-miss fallback one-shot recalc) → test-monthly-cache + useMonthlyCache isMutating guard + lastRecalcAttemptFor → COMPLIANT

Compliance summary: 39/40 scenario groups compliant; 1 (Cache Schema s5) documented deviation.

## Correctness (static)

- parse-money.ts: symmetric rule, rightmost-wins, three-digit boundary, currencyCode only for ZERO_DECIMAL_CURRENCIES — matches decision 10 truth table exactly.
- 0042: nullable purchases.currency, NO backfill (no default, no UPDATE); save_receipt 8-param shape-A (p_currency REQUIRED before defaulted p_is_manual, 42P03 rationale documented); 6/7-param arities kept; out-of-catalog → NULL never raises; grants pin authenticated.
- 0043: households.currency seeded upper/btrim from creator profile; join_household raises currency_mismatch/CU001 AFTER capacity BEFORE code consumption; NULL household skips; entry-only never re-checked; grants + owner pins.
- 0044: aggregation groups per coalesce(p.currency, RECORDER profile, 'USD') — recorder = pr.id = p.user_id, NEVER the caller, NEVER households.currency (explicit comment L14); percent_of_total windowed partition by unit; budget_limit personal-only; monthly_purchases_total returns (currency,total)[]; cache PK (user_id, year_month, currency), currency text NOT NULL, total name kept; recalc upserts per unit + orphan prune + empty-month single zero row in caller profile currency; identity gate auth.uid() = p_user_id (P0001); EXECUTE authenticated-only; owner postgres.
- get_household_feed / get_household_category_items bodies untouched (0 hits in 0043/0044).
- parseFloat remains ONLY inside parse-money internals (src/lib/parse-money.ts:40) — all other price sites via parseMoney.

## Coherence (10 binding decisions + pass-3)

1 C home src/lib/parse-money.ts | 2 Ambiguity symmetric rule | 3 Zero-decimal CLP/JPY/PEN/PYG whole, COP 2-dec | 4 Legacy NULL → recorder profile | 5 save_receipt shape-A | 6 Gemini+catalog → null never scan-failure, RPC re-checks | 7 Entry check | 8 Review correction relabel-only, ungated edit mode | 9 updateReceipt conditional currency + restore original unit | 10 Cache reshape per-unit PK, total keeps name | pass-3 §1 empty-month row §2 prune §3 getTopCategory single-series viewer-bound §4 recorder fallback §5 total name/currency text.

## Issues

**CRITICAL**: None.
**WARNING**:

1. Spec delta monthly-totals-cache "Cache Table Schema" s5 literal ("pre-reshape row exists as (abc, 2026-07, UYU) with values unchanged") is contradicted by merged 0044 (relabel then TRUNCATE — stale cross-unit sums dropped, lazy recalc repopulates). Documented in 0044 comments (L24-31, L215, L240-247) and apply-progress. The no-rewrite invariant IS pinned (household-totals fixture (k)). Reconcile the delta scenario wording at archive.
2. Canonical openspec tasks.md (and Engram #1688 tasks artifact) left A-main tasks 3.1/3.3–3.8/4.1/4.2 unchecked; apply-progress #1691 + merged code + green gates substantiate completion. Refresh checkboxes at archive (reconciled to 22/22).

**SUGGESTION**: 0044's truncate is untestable in the smoke harness (db reset applies all migrations before fixtures); consider a comment-only or doc-citation pin if this deserves perpetual pinning. getTopCategory has no production call site (barrel-only) — worth a dead-code check during #164 triage.

## Verdict

PASS WITH WARNINGS — all four gates green on main @ d5957b2, 39/40 scenario groups compliant with runtime evidence, 10 binding decisions honored; archive reconciled the s5 delta wording + tasks.md checkboxes.
