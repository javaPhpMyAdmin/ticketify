# Archive report — currency universality

> The change folder was moved to
> `openspec/changes/archive/2026-10-03-currency-universality/` with every
> artifact it was planned with. `spec-decision.md` is a non-standard artifact
> the `spec` phase produced and is preserved here untouched. No
> `apply-progress.md` and no `verify-report.md` were ever written for this
> change, and none was fabricated at archive time.

## Change

Archived SDD change `currency-universality`. Three delta specs merged into the
canonical spec set: ONE new capability created (`currency-universality`, 6
requirements + 3 NFRs + 6 gates, 33 scenarios) and TWO existing extended
(`app-i18n` REQ-4 / REQ-8 / NFR-7 MODIFIED, REQ-14 ADDED, gate 8 corrected,
gate 11 ADDED; `spanish-regional-detection` REQ-7 + NFR-3 + gate 6 ADDED, plus
an explicit `## Non-Goals` section).

Capability ownership moved at the `spec` phase and is recorded in the change's
`spec-decision.md`: the currency CODE — supported set, symbol table,
zero-decimal set, region → default mapping, USD default, no-backfill, and the
seed-at-creation invariant — belongs to `currency-universality`. `app-i18n`
keeps the LABELS and the hybrid format policy; `spanish-regional-detection`
keeps the region PARSING.

## Date convention

The archive prefix is `2026-10-03`, the **local** date. Evidence:

- No archive folder in this repo carries a date later than its archive commit's
  local date. `2026-09-14` → committed 2026-09-14, `2026-09-20` → committed
  2026-09-20, `2026-09-19` → committed 2026-09-19, `2026-09-17` → committed
  2026-09-18.
- The two most recent entries — `2026-09-30-categories-i18n` and
  `2026-10-01-i18n-spanish-regionalization` — were both archived by the single
  commit `b85c482`, dated **2026-10-02** local. Their prefixes therefore track
  the change's own completion date, not the archive commit's date.
- This change completed on **2026-10-03** local: all three merged slices
  (`740feb4` #128, `a6c0747` #130, `2b97961` #133) and this branch's own
  artifact commit `26db7ee` are dated 2026-10-03 local.

A UTC date of `2026-10-04` was available (the local clock is at 22:46 -03, so
UTC has already rolled over) and was **rejected**: it would be the first folder
in this repo whose date runs ahead of every commit date, and every date in this
repository's history is a local date (`git log --date=iso-local`).

## Canonical merge results

### `openspec/specs/currency-universality/spec.md` — verified, not rewritten

Already written before the final two review fixes; verified line by line
against the delta and against `main` @ `2b97961`. Three surgical corrections,
no renumbering, no restructuring, nothing removed:

1. **REQ-2 prose vs. the shipped zero-decimal set.** The spec said
   `ZERO_DECIMAL_CURRENCIES` "SHALL contain `JPY` and `PYG`". It shipped as
   `new Set(['CLP', 'JPY', 'PEN', 'PYG'])`. The requirement's OWN scenarios
   1, 2, 3, 4 and 5 pin whole-amount output for all four (`$ 1.235`, `S/ 1.235`,
   `₲ 1.235`, `₲ 100`, `¥ 1,235`), so a two-code prose reading contradicted its
   own scenarios. The prose now names all four and points at the `COP`
   exclusion already recorded under Non-Goals.
2. **REQ-3 declared the wrong arity.** The spec wrote
   `detectDefaultCurrency(regionCode?)`; `src/i18n/detector.ts` ships
   `detectDefaultCurrency(languageTag?, regionCode?)` — which is also what
   `tasks.md` T-3 specified. Corrected to the shipped two-argument form.
3. **NFR-3 omitted a harness the change shipped.**
   `scripts/test-currency-catalog.mjs` (16 tests, added in #133) is now named,
   with its non-duplication rule stated — it deliberately does NOT restate the
   797 leaf count, which belongs to the parity harness alone.

### `openspec/specs/app-i18n/spec.md` — extended in place

Existing requirements REQ-1 … REQ-13 and NFR-1 … NFR-9 were left in place and
in order. **No renumbering, no deduplication, no restructuring.** What changed:

- **Purpose**, out-of-scope recap: the clause `changing the default currency
  code (`UYU` stays default regardless of UI language)` was factually false
  after this change. It now states that the default is `USD`, stays
  independent of UI language, and that the seed / region default / no-backfill
  rules are owned by `currency-universality` REQ-3 / REQ-4 / REQ-5.
- **REQ-4 scenario 9** corrected: `ARS 1.234,56` → `$ 1.234,56`. The shipped
  formatter has always produced the latter (`CURRENCY_SYMBOL.ARS = '$'`) and
  `scripts/test-format-currency.mjs:117` pins it. REQ-4's body and scenarios
  1–8, 10, 11 were already byte-identical to the delta and were NOT touched.
- **REQ-8** MODIFIED: the four-code floor replaced by the fourteen-code
  supported set; the `es-AR`/`es-ES` stay-`{}` decision stated in prose rather
  than left implicit in the harness; the catalog key type declared as derived
  from the shipped `currency.json` keys. Scenarios 4 and 5 added; 1–3 preserved
  with scenario 1's `es-419`-resolution clause added, matching the delta.
- **REQ-14 ADDED** — `Currency catalog acceptance gate`. This requirement
  arrived from the delta with the unnumbered heading
  `### Requirement: Currency catalog acceptance gate`, which does not match
  this file's `### REQ-N:` style. It was renumbered **forward** to REQ-14 (the
  next free number, after REQ-13) rather than renumbering anything else, per
  the convention the previous archive recorded: "future NFRs numbered forward.
  Disambiguate by title, never by number."
- **NFR-7** MODIFIED: `UYU` → `USD`, plus the ownership pointer.
- **Gate 8** corrected (`ARS 1.234,56` → `$ 1.234,56`) and **gate 11** added.
  Existing gates 1–10 (including the `5b`) were NOT renumbered.

`## Non-Goals` was deliberately **not** added to this file: it never had one,
and adding it would be a structural change beyond this merge. The delta carried
no non-goals section either.

### `openspec/specs/spanish-regional-detection/spec.md` — extended in place

REQ-1 … REQ-6 and NFR-1 … NFR-2 left in place and in order. **No existing
requirement was modified** — the `detectLocale` mapping table is unchanged by
this change, which is precisely what the added NFR-3 pins. Additions only:

- **REQ-7** ADDED (the next free number, already the delta's own label).
- **NFR-3** ADDED, next free number.
- **`## Non-Goals`** section added, placed between `## Non-Functional
  Requirements` and `## Acceptance Gates`. The delta's shape was
  `## Non-goals` AFTER the gates; `home-month-navigation/spec.md` — the only
  canonical spec in this repo with a Non-Goals section — places it BEFORE the
  gates, and that is the shape adopted here.
- **Gate 6** ADDED. Gates 1–5 NOT renumbered.

## Contradictions found between spec text and shipped code

### 1. REQ-2 scenario 7 — the `₲` fallback has no runtime mechanism (UNRESOLVED, reported not rewritten)

`currency-universality` REQ-2 states: "Where the `₲` glyph is not covered by
the platform font, the PYG symbol MUST degrade to the code as symbol (`PYG`),
never to a missing-glyph box", and scenario 7 pins the outcome.

**Shipped code has no such degradation.** `CURRENCY_SYMBOL.PYG` is the literal
`'₲'` (U+20B2) unconditionally; the only code-as-symbol fallback in
`formatCurrency` is `table[upperCode] ?? rawCode`, which fires for a code
MISSING from the table — and `PYG` is present, so it never fires. On a device
whose font lacks U+20B2 the shipped build renders a missing-glyph box. The
remediation is a manual one-line table edit, exactly as `tasks.md` T-11 and
`design.md` describe.

**Resolution: the spec text was left standing.** It is the acceptance criterion
that gates T-11, and rewriting it to match a defect would launder the defect
into the contract. It is recorded here and in the archived `tasks.md` as an
unverified requirement, and it is the same requirement as the hardware-gated
item below — the contradiction and the open item are one finding, not two.

### 2. Zero-decimal set — resolved in the spec's favour (see merge results)

The spec's prose understated the shipped set; the shipped set matches the
spec's own scenarios. Corrected in the canonical spec.

### 3. `detectDefaultCurrency` arity — resolved in code's favour (see merge results)

### 4. Cross-reference in #133's commit message is wrong (NOT FIXED — outside this branch's write scope)

`2b97961`'s message says "No region-default badge, per AD-5 and REQ-6.6".
Neither reference resolves: AD-5 in `design.md` is *Zero-decimal rendering
inside `formatCurrency`*, and `currency-universality` REQ-6 has four scenarios,
not six. The correct references are AD-7 ("Selector UI: single-source rows, no
provenance copy") and proposal open question 3. The intent shipped correctly
(no badge); only the citation is wrong. A commit message is immutable history
and this branch is docs-only, so it is recorded here rather than corrected.

## Open gates carried forward

| Item | State | Issue / owner |
|---|---|---|
| **T-11 / REQ-2.7** — the `₲` (U+20B2) glyph renders as a glyph, not tofu, on a real iOS **and** Android device | **OPEN — blocked on physical hardware** | Change author; needs device access. Not waived and not inferred from the passing `'₲ 1.235'` string pin. If it is tofu: set `CURRENCY_SYMBOL.PYG = 'PYG'`, update the pin to `'PYG 1.235'` in the SAME commit, re-run `pnpm test:format-currency`. |
| Settings picker renders no selected row when the stored currency is outside the 14-code catalog (e.g. a legacy `CHF` row) | Deliberately pinned by `scripts/test-currency-catalog.mjs` §3b | **#134** — needs a product decision (fallback row, "unavailable" row, or neither). |
| `supabase/tests/recalculate-on-purchase-items-update.sql` is named in the `scripts/test-db-smoke.mjs` header comment but has no `run([...])` call, so it never runs | Pre-existing, unrelated to this change | **#135**. It means T-11's `pnpm test:sql` gate asserts less than its header claims. |

Deferred-and-not-designed items (per-receipt currency / FX, household
cross-currency sums, locale-aware input parsing, `COP` as zero-decimal,
`CHECK (currency IN (...))`, `es-ES`/`es-AR` `GBP` label divergence, selector
provenance copy) are each recorded with an owner or a reason in the archived
`tasks.md` § *Archive reconciliation*. The first five are also carried as
Non-Goals in `openspec/specs/currency-universality/spec.md`.

## Gates

**This repo has no OpenSpec validator.** Verified absent, not assumed:
`openspec` is not a `package.json` dependency and no `package.json` script
invokes it; there is no `openspec` binary on `PATH` and none in
`node_modules/.bin`; there is no `openspec/README*`, no `openspec/*.json`, and
no CLI config beyond `openspec/config.yaml`, which carries only
`schema: spec-driven`, `persistence: hybrid`, and phase `rules` — it declares
no validator command. The archive therefore ran NO validator, and no output is
claimed.

Code gates were **not re-run** at archive time, and that is stated rather than
hidden: this branch's tree is at `a6c0747`, one commit behind `main`, so
`pnpm test` would have exercised a tree that is missing #133's code. #130
recorded `typecheck` clean, `lint` clean, `pnpm test` green, and `test:sql`
8/8 against real Docker; #133 recorded `typecheck` and `lint` clean.

Zero-drift containment, measured (archive-phase self-check, NOT a repo
validator): `currency-universality` delta 6 reqs / 3 NFRs / 33 scenarios →
canonical 6 / 3 / 33. `app-i18n` REQ-1…REQ-13 and NFR-1…NFR-9 all present and
in original order after the merge; REQ-14 and gates 11 added. No requirement
was dropped or renumbered.

## Lessons

1. **A spec's own scenarios can outrank its own prose, and the prose is what
   goes stale.** `ZERO_DECIMAL_CURRENCIES` shipped four codes against a
   two-code sentence — while five of the same requirement's scenarios pinned
   all four. Read the scenarios before trusting the summary line above them.
2. **`as` between two unions is not a guard.** An `as` assertion needs only ONE
   direction of assignability, so `as \`currency:${CurrencyKey}\`` narrowed a
   15-member union to 14 and typechecked clean. `satisfies` raised TS1360 on the
   same probe. A type-level comment is not a type check.
3. **A requirement can prescribe an outcome the code has no mechanism for.**
   REQ-2's `₲` fallback reads like an implemented degradation and is not one.
   "MUST degrade to the code as symbol" here means a human edits a table. Spec
   prose that describes a mechanism must be checked for the mechanism.
4. **A function's real arity lives in the code and the tasks, not always in the
   spec.** REQ-3 said `detectDefaultCurrency(regionCode?)`; both `detector.ts`
   and T-3 said `(languageTag?, regionCode?)`. Two artifacts agreeing against a
   third is a signal, not noise.
5. **Unnumbered ADDED requirements need a forward number at merge time.**
   The `app-i18n` delta added `### Requirement: Currency catalog acceptance
   gate`; the canonical file is `### REQ-N:`-numbered. REQ-14 assigned forward;
   nothing else moved.
6. **A header comment listing a smoke test is not a coverage claim.** The
   `test-db-smoke.mjs` header has named `recalculate-on-purchase-items-update.sql`
   while no `run([...])` call for it exists (#135). "The gate passed" and "the
   gate covered what its header says" are different statements.
7. **An out-of-catalog stored value is a product question, not a rendering
   bug.** No selected row (#134) is defensible; a synthetic row asserting a
   currency the catalog does not support is not. Pinned rather than papered
   over.

**OpenSpec folder closed. The SDD cycle is complete, with one hardware-gated
scenario (T-11 / REQ-2.7) and two tracked issues (#134, #135) carried forward.**
