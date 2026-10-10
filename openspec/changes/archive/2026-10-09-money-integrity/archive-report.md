# Archive Report — money-integrity

**Change**: money-integrity (3 slices C→B→A, 4 stacked PRs #157/#159/#161/#163, merged to main @ d5957b2)
**Archived**: 2026-10-09
**Verdict at verify**: PASS WITH WARNINGS (Engram #1705) — both warnings reconciled in this archive.
**Persistence**: hybrid — canonical specs under `openspec/specs/`, change folder moved here, working record in Engram.

## Artifact traceability (Engram, project `coronatracker`)

| Artifact | Obs ID | Topic key |
|---|---|---|
| exploration | #1679 | sdd/money-integrity/explore |
| proposal | #1681 | sdd/money-integrity/proposal |
| spec | #1682 (+ #1683, #1686, #1690 phase findings) | sdd/money-integrity/spec |
| design | #1684 | sdd/money-integrity/design |
| tasks | #1688 | sdd/money-integrity/tasks |
| apply-progress | #1691 | sdd/money-integrity/apply-progress |
| verify-report | #1705 | sdd/money-integrity/verify-report |
| archive-report | this file | sdd/money-integrity/archive-report |

Note: `openspec/changes/money-integrity/verify-report.md` was never persisted by sdd-verify
(hybrid record: Engram #1705 only). Recorded here for the audit trail; no file was fabricated.

## Deltas applied to canonical specs (`openspec/specs/`)

| Domain | Action | Details |
|---|---|---|
| currency-universality | Updated | +2 requirements (REQ-7 write-side parseMoney fixed separator rule; REQ-8 receipt denomination per row); **Non-Goals section SWAPPED** per delta archive instruction |
| parse-ticket-list-mode | Updated | 3 modified requirements (REQ-LIST-2/3/4 gain optional catalog-validated `currency`) |
| data-access | Updated | 1 modified requirement (Purchase Writes Persist Real Rows — unit carried end-to-end incl. edit path; +1 scenario) |
| household-sharing | Updated | +1 requirement (Household Entry Single-Currency Check — placed after Invite Code Lifecycle, join-flow adjacency); 2 modified (Household-Scoped Aggregation RPCs grouped per unit; Client-Side Household State grouped card) |
| monthly-totals-cache | Updated | 3 modified requirements (Cache Table Schema re-keyed per unit; Recalculate RPC grouped per unit; Client-Side Read Contract surface-class rendering) |

## Warning 1 reconciliation — Cache Schema s5 wording (verify #1705, spec delta)

The delta/canonical `monthly-totals-cache` Cache Table Schema scenario previously read
"pre-reshape row exists relabeled with values unchanged". Merged 0044 reality is:
relabel under the profile currency only long enough to satisfy the NOT NULL key swap,
**then TRUNCATE** (stale-data guard — pre-reshape totals may have summed across units),
then lazy recompute one row per recorded unit on the next read (client cache-miss
one-shot recalc or the purchases trigger). The no-rewrite invariant — no `purchases`
row gains a currency from the migration — remains pinned by the household-totals smoke
fixture (k) and is preserved in the reconciled prose and s5 scenario
("Pre-reshape rows are relabeled, then truncated, never rewritten").
Both the change-local delta and the canonical were corrected; rationale recorded in
0044 comments (L24-31, L215, L240-247) and apply-progress #1691.

## Warning 2 reconciliation — stale tasks.md checkboxes

`tasks.md` left A-main tasks 3.1/3.3–3.8 and 4.1/4.2 unchecked although apply-progress
#1691, merged code (d5957b2) and the green verify gates substantiate completion.
Archive-time checkbox reconciliation performed per skill (exceptional mechanical repair
explicitly sanctioned by the orchestrator and backed by apply-progress + verify-report).
All 22/22 tasks now `[x]`. Reason recorded: sdd-apply refreshed checkboxes through
slice B and A-entry only; the A-main refresh was documentation drift, not incomplete work.

## Non-Goals swap (currency-universality)

Per delta instruction ("swap this section in", tasks 4.1): the pre-change
`## Non-Goals (recorded, not fixed in this change)` section was REPLACED in the
canonical spec by `## Non-Goals (replaced)` — FX conversion, `COP` zero-decimal, and
CHECK hardening remain Non-Goals; per-receipt currency, locale-aware parsing, and
household cross-currency sums were flipped into requirements (REQ-8 / REQ-7 /
household-sharing aggregation). This is the destructive merge the config rules warn
about; it was pre-approved by the orchestrator at archive launch. The archived delta
keeps the immutable record.

## Declined / follow-up

- Declined at apply (orchestrator ruling): openspec staging, `set_receipt_currency`
  RPC/trigger, F8 hard enforcement, R2 refactor items. See apply-progress #1691.
- **Follow-up: issue #164** — remaining cross-unit sums on latent surfaces
  (wantsSnacksTotal, 0019 monthly_impulse_items + SnacksBreakdownModal, export/pdf.ts:80
  footer, sumCategoryTotals dead code, computeMonthOverview latent). Not blocking archive.

## SDD Cycle Complete

money-integrity was fully planned, implemented (C→B→A, strict_tdd), verified
(PASS WITH WARNINGS, all gates green @ d5957b2), and archived. Ready for the next change.