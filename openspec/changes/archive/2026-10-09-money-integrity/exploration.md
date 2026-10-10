# Exploration — money-integrity

> **Phase:** EXPLORE (read-only) · **Change:** `money-integrity` · **Date:** 2026-10-07
> **Baseline:** branch `main` @ `33f356f`, working tree clean at phase start
> **Downstream:** proposal → spec → design → tasks → apply → verify → archive
> **Provenance:** all three defects are canonical Non-Goals of the archived
> `currency-universality` change (archived 2026-10-03) — "recorded, not fixed".

---

## 1. Executive summary

| # | Defect | Failure class | Reachable today? |
|---|--------|---------------|------------------|
| A | Household cross-currency sums | Arithmetically wrong number, silently labeled with viewer's currency | Latent — needs ≥2 members with different `profiles.currency` (nothing prevents it) |
| B | Receipts stored without their own currency | Unit never recorded → every consumer mislabels foreign-scan amounts | Yes for foreign receipts; invisible for domestic scans |
| C | Locale-unaware input parsing (`parseFloat`) | Comma-decimal input silently truncated/mis-scaled, passes validation | Yes — item unit-price field is `decimal-pad`, no filtering |

### Headline findings

1. **A recorded decision that was never implemented.** The household-sharing
   exploration (2026-09-01, `openspec/changes/archive/2026-09-01-household-sharing/exploration.md:417`)
   answered Open Question 4 *"Mixed currencies?"* with *"V1: no — household members
   must share the same currency."* No code enforces, checks, or even mentions
   currency anywhere in `src/features/household/` except the viewer's own label
   (`HouseholdCard.tsx:138`). The V1 constraint exists on paper only.
2. **B is not display-only.** `purchases` has no currency column
   (`supabase/migrations/0001_initial_schema.sql`), `ReceiptDraft` has no currency
   field (`src/types/index.ts:225`), `save_receipt` takes no currency parameter
   (`0023`, `p_total numeric` at :76). Stored magnitudes are unit-less; the profile
   currency labels them at render time. One wrong unit poisons totals, budget
   progress, category percentages and trend history for that month.
3. **A has a personal-mode twin with higher reachability.** Changing the profile
   currency mid-month (settings picker, `setProfileCurrency`) mixes units in
   `monthly_user_totals` permanently — no re-denomination, no month reset. This
   needs zero households.
4. **C is one input field, not a class — yet.** The only decimal money input in
   the app is the item unit price (`ItemEditorModal.tsx:115`, `decimal-pad`).
   Budget inputs are digit-filtered integer contracts and safe. Display→input
   round-trip does **not** occur today (all seeds use raw `String(number)`).
5. **`get_household_feed` is a dead read surface** — implemented in SQL,
   spec'd, wrapped at `feature-access.ts:827`, but no screen/hook calls it
   (`queryKeys.householdFeed` has zero consumers). Do not build on it.

---

## 2. Defect A — household cross-currency sums

### Mechanism

The three household aggregation RPCs are `SECURITY DEFINER` functions that
`sum()` unit-less `numeric(12,2)` amounts across every member's purchases and
return a single number. The client then labels that number with **the viewer's**
profile currency. Members' currencies are never consulted — they cannot be,
because `purchases` carries none.

### Evidence

| Location | What it shows |
|---|---|
| `supabase/migrations/0026_household_join_and_aggregation_definer.sql` | `monthly_purchases_total`, `monthly_category_totals`, `get_household_feed` — `sum()` across household members, no currency in signature or body |
| `supabase/migrations/0031_household_totals_consistency.sql` | `monthly_category_totals` now `status='confirmed'`-filtered; headline net (confirmed) vs category gross (Δ documented) — arithmetic curated, units ignored |
| `supabase/migrations/0015_monthly_totals_cache.sql` | `monthly_user_totals` personal cache; `recalculate_monthly_totals` also sums across household members when `p_household_id` set |
| `supabase/migrations/0019_monthly_impulse_total.sql` | `monthly_impulse_total`/`monthly_impulse_items` sum `purchase_items.total_price` (personal scope) |
| `supabase/migrations/0001_initial_schema.sql` | `purchases` has **no** currency column; `profiles.currency text default 'USD'` |
| `src/features/household/components/HouseholdCard.tsx:138,202` | `formatCurrency(householdTotal ?? 0, currency)` — `currency` is the viewer's store value |
| `src/features/home/hooks/useHomeFeed.ts:861-885` | `useHouseholdMonthTotal` → `readMonthlyPurchasesTotal(monthKey, householdId)` |
| `src/features/analytics/hooks/useMonthlyCache.ts:117-135` | Household mode: category rows via `fetchMonthlyTotals`, net headline via `readMonthlyPurchasesTotal(yearMonth, householdId)` |
| `src/app/(tabs)/history.tsx:483-503` | Household category cards render `t.total` with viewer `currency` (line 503) |
| `src/lib/supabase/feature-access.ts:185,827,849` | Wrappers: `readMonthlyPurchasesTotal`, `readHouseholdFeed` (no consumer), `readHouseholdCategoryItems` |
| `src/features/budget/hooks/useBudget.ts:79` | Personal-only (`readMonthlyPurchasesTotal(monthKey)`) — unaffected by household mixing, **affected by the mid-month switch twin** |
| `supabase/migrations/0026…:81` | `join_household` caps members at 5; no currency constraint anywhere in join/leave flow |
| `src/features/profile/api.ts` (`setProfileCurrency`) | Picker updates **only the caller's** row; household members unaffected |

### Reachability

- Household = invite-code, up to 5 members, each with an independent
  `profiles.currency` seeded by device region (14-country map,
  `src/i18n/detector.ts:234-251`, unmapped → `USD`) or changed by picker.
- Core region is LATAM: a Uruguay host (`UYU`) + Argentine member (`ARS`) is a
  normal cross-border household; a picker change by any member creates the mix.
- **No guard exists**: no DB constraint, no join validation, no UI warning.
  Reachability is product-dependent (cannot be quantified from code alone — no
  DB access in this phase), but structurally it is unguarded by design.
- **Personal-mode twin (reachable now):** user switches currency mid-month →
  pre-switch and post-switch receipts are summed together in
  `monthly_user_totals` (and every historical row is relabeled) with no
  re-denomination path. Same defect class, one user, zero households.

### Blast radius (surfaces that render mixed sums)

1. Home household card — `HouseholdCard.tsx:202`
2. History household mode — `history.tsx:497-503`
3. Analytics household mode — category rows + net headline + `percent_of_total`
   (percentage across mixed units is undefined), `useMonthlyCache.ts:117-135`
4. Category-detail drill-down (household) — `readHouseholdCategoryItems`
   (`feature-access.ts:849`) → client aggregation, viewer currency
5. `get_household_feed` — implemented + spec'd, **no UI consumer** (dead)
6. Personal twin: every monthly total / budget progress / run-rate card after a
   mid-month currency switch (`monthly-run-rate` reads personal cache only,
   `openspec/specs/monthly-run-rate/spec.md:60`)

### Test coverage

- `supabase/tests/household-totals.sql:139-143` — both fixture profiles `'USD'`.
  Arithmetic only; **no mixed-currency case, no assertion that currency is or
  isn't consulted.** (`pnpm test:sql` needs Docker — not runnable in this phase.)
- Harness tests (`test-household-invalidation.mjs`,
  `test-household-category-items.mjs`, `test-monthly-cache.mjs`) — single-currency
  by construction.
- **Gap:** nothing pins the wrongness; a fix must first add a red mixed-currency
  fixture.

---

## 3. Defect B — receipt currency absent at the row level

### Mechanism

Gemini is instructed to emit bare numbers (prompts strip symbols/separators),
the parse layer validates `number` only, the draft carries no unit, and
`save_receipt` persists magnitude alone. At render time the **profile** currency
labels the number. A CLP receipt scanned by a `UYU` user is stored as `5000`
and shown as `$U 5.000`.

### Evidence

| Location | What it shows |
|---|---|
| `supabase/functions/parse-ticket/index.ts:182` and `:211` | PROMPT + LIST_PROMPT: *"All money values must be plain numbers without currency symbols or thousands separators."* — currency is never asked for |
| `supabase/functions/parse-ticket/lib/parse.ts:16-32` | `ParsedReceipt` / `ParsedItem` — no currency field |
| `supabase/functions/parse-ticket/lib/parse.ts:128-133` | `requireFiniteNumber` — accepts JS `number` only |
| `supabase/migrations/0023_save_receipt_transactional.sql:73-76` | `save_receipt(..., p_total numeric, ...)` — no currency parameter |
| `src/types/index.ts:225-246` | `ReceiptDraft` — no currency field |
| `src/features/tickets/api.ts:540-545, 744` | `saveReceipt` → `buildSaveReceiptArgs` → `rpc('save_receipt', { ...args })` — no unit |
| `src/app/ticket/review/[id].tsx:100-102` | Comment states the assumption outright: *"The receipt is denominated in the user's currency setting (default UYU)"*; `currency = useSettingsStore(...)` |
| `src/app/ticket/review/[id].tsx:655,688,693` | All money rendered via viewer `formatCurrency` |
| `src/lib/auth/profile-sync.ts:105-132` | `ensureProfileCurrency` — region seed at profile-row **creation** only |
| `src/features/profile/api.ts` (`setProfileCurrency`) | Picker is the only other writer; upper-cases + validates against 14-code catalog |
| `src/i18n/detector.ts:234-251` | 14-country region map (`AR/AU/BR/CA/CL/CO/ES/GB/JP/MX/PE/PY/US/UY`) |

### Correctness classification: **not display-only**

- Mislabeling is visible immediately on the review screen (and in History detail).
- Worse: the *ambiguity is persisted*. Any future aggregation that mixes this row
  with a correctly-denominated row is arithmetically wrong regardless of what the
  UI shows. Budget progress, `percent_of_total`, trends and household sums all
  consume unit-less numbers.
- Failure modes: (a) foreign receipt → plausible-looking wrong value (JPY 5000 →
  "UY$ 5.000"); (b) locale-format amount the model can't normalize → `ParseError`
  → list-mode fallback → possible 422 (scan fails outright). The declared-total
  vs items-total mismatch **is** surfaced (`review/[id].tsx:688-693`); the
  currency mismatch is not.

### Reachability

Archived proposal records the status quo honestly (`archive/2026-10-03-currency-universality/proposal.md:21`):
*"all scanned tickets are UYU … Known limitation → follow-up change."* Invisible
while scanning domestic receipts; guaranteed wrong the moment a user travels or
lives near a border (the app's entire region).

### Test coverage

- `scripts/test-parse-ticket.mjs:162` — "parseItem rejects a non-numeric price"
  (string input only). `:174` — unit-price re-derivation.
- `scripts/test-manual-screen.mjs` — save-arg shape pins; **no currency key**
  expected anywhere (absence is unpinned too).
- `supabase/tests/currency-default.sql` (0041) — profile default only.
- **Gap:** no test states "receipt rows carry (or deliberately omit) a unit".

---

## 4. Defect C — locale-unaware input parsing

### Mechanism

Money typed by the user is parsed with bare `parseFloat`/`parseInt`. On keyboards
that emit `,` as the decimal separator (es-AR, es-ES, pt-BR, de…), the parser
stops at the comma — and validation (`Number.isFinite`) happily accepts the
truncated value.

### Evidence — every numeric parse site in app code

| Site | Code | Keyboard | Safe? |
|---|---|---|---|
| `src/features/tickets/components/ItemEditorModal.tsx:115` | `parseFloat(priceStr)`; `canSave` = `Number.isFinite(unit_price) && unit_price >= 0` (:116-120) | `decimal-pad` (:206), placeholder `"0.00"`, **no filtering** | **NO** — the one real defect |
| `src/app/settings/budget.tsx:69,124-126` | `Number.parseInt(draft,10)`; input stripped `v.replace(/[^0-9]/g,'')` | `number-pad`, `maxLength 9` | Yes — integer contract; comma keystrokes are stripped (typing `12,50` → `1250`, out-of-contract by design) |
| `src/features/analytics/category-budget-form.ts:36-41` (`parseBudgetAmount`) | `Number.parseInt` | digit-filtered screen (`category-budgets.tsx:218,221`) | Yes — same integer contract |

Concrete failures in `ItemEditorModal`:

- `parseFloat("1234,56")` → `1234` — 0,56 lost, **passes validation silently**.
- `parseFloat("1.234,56")` → `1.234` — 1000× error (typical LATAM
  thousands+decimal entry), passes validation.

### Hypotheses checked

- **Display→input round-trip: NOT confirmed.** Every input seed uses raw
  `String(number)` (`ItemEditorModal.tsx:81,109`; `budget.tsx:67`;
  category budgets likewise) — never `formatCurrency` output. The app cannot feed
  its own grouped string back into a parser today. The real defect is *foreign
  keyboard* input, not round-trip.
- Seeds + placeholder (`"0.00"`) teach point-decimal; the field is internally
  consistent — the risk is exactly what the OS keyboard emits
  (platform/locale-dependent; Android `decimal-pad` follows system locale,
  iOS follows keyboard layout → **verify on device during spec/design**).

### Test coverage

- `scripts/test-format-currency.mjs` — display grouping pinned (LATAM
  `1.234,56`, INTL) — display side is solved (`app-i18n` REQ-4).
- `scripts/test-parse-ticket.mjs:162` — Gemini input rejected if non-numeric.
- `scripts/test-category-budget-progress.mjs:338` — pins
  `parseBudgetAmount('5.9') === 5` (*"parseInt truncation — same as the screen
  today"*) — deliberate; do not change budget parsing silently.
- `scripts/test-manual-screen.mjs:646-659` — `parseQuantity` rejects `2.5`,
  `1.2.3` (integer contract pinned).
- **Gap:** `parseFloat` appears in **zero** test files; `ItemEditorModal` price
  parsing is untested (component is only source-pinned by
  `test-manual-screen.mjs` — RN components aren't importable in the Node
  harness, so a shared **pure helper** is the testable seam).

---

## 5. Approaches (options only — no decision taken in this phase)

### Defect A — household (and personal) cross-currency sums

| # | Approach | How | Tradeoffs | Effort |
|---|---|---|---|---|
| A1 | **Enforce household single currency** (honor the recorded V1 decision) | `households.currency` (owner-set at creation), validate on `join_household`, picker warns/blocks while in a household; RPCs unchanged | Cheapest honest fix; honors 2026-09-01 decision; no SQL rework. But: product-restrictive for cross-border members; needs migration + enforcement at 2-3 call sites; **does not fix B** (a foreign scan still lands unit-less) | M |
| A2 | **Group-by-currency aggregation** | Depends on B: `purchases.currency` → RPCs return per-currency subtotals → UI renders breakdown / dominant-currency + badge | Truthful, no FX, no new dependencies. But: largest surface (Home, History, Analytics, drill-down, `percent_of_total` semantics undefined across units), SQL + client contract churn; needs B first | H |
| A3 | **FX conversion at read (or write)** | Rate source → single converted number | Keeps current UX. But: offline-first app needs rate cache/staleness policy/new table or network dependency; archived spec deferred it pending "explicit product answer for budgets that span currencies"; audit trail vs receipt photo diverges | H |
| A4 | **Flag / degrade honestly (stopgap)** | Detect ≥2 distinct units (needs B's column) → "mixed currencies" badge or hide the household total | Smallest diff, stops silent wrongness fast. But: gives no usable number — defers the real answer; half-fix risk | S-M |

*Dependency note:* A2/A4 require B's unit to exist. A1 and A3 are independent
of B. The personal-mode twin (mid-month switch) is solved by A1/A3-style
re-denomination or by a switch-time warning — none of the above addresses it
today.

### Defect B — per-receipt currency

| # | Approach | How | Tradeoffs | Effort |
|---|---|---|---|---|
| B1 | **Store the unit: `purchases.currency` + Gemini-detected ISO code** | Prompt emits `currency` (validated against the 14-code catalog), `save_receipt(p_currency)`, review screen shows detected unit w/ switcher, render sites pass row currency | Root fix; unlocks A2/A4. But: schema + RPC signature + `ReceiptDraft` + every render site; backfill ambiguous (existing rows inherit current profile currency — wrong for past travelers); aggregates still wrong until A is decided | H |
| B2 | **Normalize at save (convert to profile currency)** | Rates at confirm → store single unit | Zero downstream change, all sums valid. But: needs rate source (offline/staleness), destroys original amounts, directly contradicts the archived "explicit product answer" deferral, trust issue vs receipt photo | H |
| B3 | **Detect-and-warn guardrail only** | Prompt detects unit; mismatch vs profile → review warning with one-tap action | No schema change; prevents silent mislabeling. But: without a column the unit still can't persist — warning must either block saving foreign receipts or force a profile switch (both hostile to travelers) | M |
| B4 | **Record-only slice** | B1's column + display unit in detail/history rows; aggregates untouched | Incremental, decouples from A. But: sums stay wrong — half-fix, invites "done" impression | M |

### Defect C — locale-aware input parsing

| # | Approach | How | Tradeoffs | Effort |
|---|---|---|---|---|
| C1 | **Shared `parseMoney(input, currencyCode)` pure helper** | Mirrors `app-i18n` REQ-4 ("currency code is the formatting authority" → also the *parse* authority): strips grouping per LATAM/INTL convention, both-separator heuristic (last separator = decimal), one owner module, used by `ItemEditorModal` (and future inputs) | Symmetric with the solved display side; pure module → importable by the Node harness (real tests, not source pins); single call site today = tiny blast radius. But: heuristic ambiguity for bare `1.234` needs a written rule; budget inputs stay integer (unchanged contract) | S-M |
| C2 | **Input-side normalization at the field** | Filter/replace at `onChangeText` (`,`→`.`, strip grouping) before the existing `parseFloat` | Minimal diff, no new module. But: duplicates the parsing problem per screen (`1.234,56` still needs grouping-strip logic), no shared owner, the *next* money input repeats the bug — textbook WET | S |
| C3 | **Constrained input UI** (masked/formatted field or stepper) | App controls the emitted format entirely | Eliminates the bug class. But: RN implementation cost, slower entry, doesn't help paste — overkill for one field | M |

---

## 6. Capability mapping (planned deltas — none applied in this phase)

| Defect | Owning capability(ies) | Planned delta (for spec phase) |
|---|---|---|
| A | **`household-sharing`** — REQ *Household-Scoped Aggregation RPCs* (:152), REQ *Household Feed* (:175), REQ *Client-Side Household State* (:192) | New requirement for unit-correct aggregation (or enforced shared currency, per open question Q1); household feed requirement must not be built upon until its dead-surface status is resolved |
| A | **`monthly-totals-cache`** — REQ *Recalculate RPC* → *Household recalculation* scenario (:71) | Scenario assumes homogeneous units; add mixed-currency scenario (or single-currency invariant) |
| A (twin) | **`currency-universality`** (mid-month switch re-denomination) + `monthly-run-rate` (consumer, read-only — likely no delta) | New requirement: what happens to existing rows on currency change |
| B | **`currency-universality`** — flips its own recorded Non-Goal (:237-242) | New REQ: receipt-level denomination (column, catalog validation, backfill semantics) |
| B | **`parse-ticket-list-mode`** — REQ-LIST-2/3/4 (response shape + shared numeric validation) | Optional `currency` in parsed shape; validation rule against the 14-code catalog |
| B | **`data-access`** — REQ *Purchase Writes Persist Real Rows* (:124) | `save_receipt` args carry the unit; failure-path scenario unchanged |
| B | **`app-i18n`** REQ-4 (display authority) | Likely no delta — `formatCurrency(value, code)` already takes the code; render-site churn is app code, spec stays valid |
| C | **`currency-universality`** — flips Non-Goal :244-247 ("write side still uses bare `parseFloat`") | New REQ: write-side parsing rules, mirroring `app-i18n` REQ-4's currency-code authority; rule for ambiguous inputs |
| C | `category-budgets` / budget inputs | **No delta** — integer digit-filtered contract is spec-consistent (`category-budgets` settings scenarios) and pinned by `test-category-budget-progress.mjs:338` |

**Duplicate-capability check:** none needed. The 25 existing capabilities contain
no home for receipt denomination or money-input parsing; both were explicitly
recorded as Non-Goals *inside* `currency-universality`, which already owns the
currency domain (`profiles.currency`, catalog, grouping, symbol table). Extending
it keeps one authority instead of inventing a `money-input` or `receipt-currency`
capability.

---

## 7. Open questions (product + technical)

1. **Q1 (A — blocks everything):** Honor the 2026-09-01 V1 answer
   ("household members must share the same currency", never enforced) or move
   straight to multi-currency breakdown (A2)? The core user base is LATAM
   cross-border — V1 enforcement may reject legitimate households.
2. **Q2 (B/A):** Record-and-group (B1+A2), convert-on-save (B2), or annotate
   (A4)? The archived spec deferred this pending "an explicit product answer for
   budgets that span currencies" — that answer is still owed.
3. **Q3 (B):** Backfill semantics for `purchases.currency` on existing rows:
   inherit the user's *current* profile currency (imprecise for travelers) or
   `NULL` = unknown (forces viewer-currency fallback and keeps old rows honest
   about their ignorance)?
4. **Q4 (A):** With per-currency subtotals, what do `percent_of_total` and
   household-mode budget comparisons mean? (Budgets are personal, single-currency
   — household mode already returns `budget_limit` NULL.)
5. **Q5 (A twin):** On a profile-currency change, re-denominate history (rewrite
   rows — needs rates), freeze old rows as-is (mixed sums forever), or warn the
   user? Currently: nothing happens silently.
6. **Q6 (B):** Should the review screen let the user correct Gemini's detected
   unit, and does switching it re-derive totals (relabel only — magnitudes stay)?
7. **Q7 (C):** Exact rule for ambiguous inputs (`1.234` = 1234 vs 1.234) —
   decided by the active currency code, consistent with REQ-4? And zero-decimal
   handling on input (JPY)? (`COP`-as-zero-decimal is a recorded non-goal.)
8. **Q8 (household feed):** Is `get_household_feed` (spec'd REQ *Household
   Feed*) dead scope to delete/ignore, or a UI surface planned later? Its
   `sum()` has the same defect — decide before touching it.

---

## 8. Recommended next phase

**Next: `propose`** — with this sequencing rationale (a recommendation, not a
decision):

1. **C first.** Pure helper, one call site, no product question, no migration,
   fully testable in the existing Node harness (strict TDD red test is trivial to
   write: `parseMoney('1.234,56','ARS') === 1234.56`). Ships value while Q1-Q3
   are being answered.
2. **B second**, contingent on Q2/Q3 — schema + prompt + review UI; the enabling
   prerequisite for A2/A4.
3. **A last**, contingent on Q1/Q4/Q5 **and** B — aggregation semantics cannot
   be finalized before the unit exists on the row.

Each slice should land its own red test first (mixed-currency SQL fixture for A,
`currency` shape for B, comma input for C) — today none of the three failure
modes is pinned by any test.

---

## 9. Phase verification

- `git status --short` — clean at baseline; expected after this phase: only
  `openspec/changes/money-integrity/exploration.md` (untracked).
- `pnpm test` — **all 58 tests pass** (Docker-free harness tier).
- `pnpm test:sql` — **not run** (Docker required; noted for `verify` phase).
- No code, migrations, branches, or spec files were created/modified outside
  `openspec/changes/money-integrity/`.
