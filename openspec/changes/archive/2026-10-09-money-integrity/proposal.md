# Proposal: money-integrity

## Intent

Receipts store no unit, sums mix currencies under one label, comma-decimal input truncates through validation — all plausible, none pinned by a test. Order: **C → B → A** (C pure; B answered; A needs B).

## Scope

### In Scope

| Slice | Deliverable |
|---|---|
| **C** | Pure `parseMoney(input, currencyCode)` mirroring `app-i18n` REQ-4 at `ItemEditorModal.tsx:115`. Fixed rule: `.` = thousands, `,` = decimal. Display→input round-trip hypothesis disproved — closed. |
| **B** | `purchases.currency` end-to-end: prompt → `ParsedReceipt` → `ReceiptDraft` → `save_receipt`; migration, **no backfill**; renders use row currency; review correction relabels only. |
| **A** | Household and personal aggregation grouped by currency; entry-only single-currency check; rows keep recorded currency after mid-month switches. |

- Red test first per slice (TDD): comma input, `currency` shape, mixed fixture.
- `currency-universality` Non-Goal flips ship as spec deltas in this change.

### Out of Scope

- FX conversion; legacy backfill; budget-input parsing; `COP` zero-decimal.
- `get_household_feed`: **explicitly deferred** — dead surface, zero consumers; after B feed rows carry their unit; delete-vs-build awaits UI.

## Capabilities

### New

None.

### Modified

- `currency-universality`: write-side parsing REQ (C), receipt-denomination REQ (B); Non-Goals flipped
- `parse-ticket-list-mode`: optional `currency` in parsed shape, catalog-validated
- `data-access`: `save_receipt` carries the unit
- `household-sharing`: unit-correct aggregation; entry-time single-currency rule
- `monthly-totals-cache`: household recalc mixed-currency case

## Approach

- **C — C1:** single module; currency code is the parse authority (REQ-4); last separator wins; harness-testable.
- **B — B1:** unit on the row (root fix, not convert-on-save); Gemini ISO code catalog-validated.
- **A — A2 + entry check:** RPCs return per-currency subtotals; UI renders grouped breakdowns.

**Decision 1, honestly:** grouping (6, 8) is the correctness mechanism — sums are right even if mixed currency appears. Single-currency-at-entry (1) is product simplicity only: fewer breakdowns, honors the 2026-09-01 V1 answer; it prevents nothing.

**OPEN for `sdd-design`:** `percent_of_total` across two currencies — per-currency, or hidden.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/lib/` parser, `ItemEditorModal.tsx` | New/Modified | `parseMoney` |
| `supabase/migrations/`, `parse-ticket/` | New/Modified | column + prompt `currency` |
| `types/index.ts`, `tickets/api.ts`, `review/[id].tsx` | Modified | draft, save, correction |
| RPCs `0026`/`0015`, `HouseholdCard`, `history`, `useMonthlyCache` | Modified | group by currency |
| `scripts/test-*.mjs` | New | red tests |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Legacy rows unit-less | Med | fallback = today's behavior |
| Unsupported Gemini code | Low | catalog check → profile fallback |
| Size over 800-line budget | High | chained PRs per slice — **confirm before tasks** |

## Rollback Plan

Slices revert independently; B's column is additive — drop it to restore status quo. No data rewritten.

## Dependencies

- `exploration.md`; `pnpm test`; SQL tier at verify (Docker).

## Success Criteria

- [ ] Red-then-green test per defect; `pnpm test` / `typecheck` green
- [ ] Spec deltas include both Non-Goal flips; no spec contradicts code
- [ ] A foreign receipt in a household renders grouped subtotals, not one figure
