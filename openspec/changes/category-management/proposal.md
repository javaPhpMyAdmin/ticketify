# Proposal: Category management — picker inside item editor + user-scoped custom categories

## Intent

Category assignment is two-step — users must add an item, then tap its chip — and the taxonomy is a fixed 13-slug registry (`EXPENSE_CATEGORIES`): no custom categories, and any unknown slug silently buckets into 'otros' across the save seam and every server aggregation. This change puts category assignment inside the item editor (manual + camera review) and lets users create need/want categories that behave like standard ones end-to-end.

## Scope

### In Scope
- Stacked `CategoryPickerModal` inside the item editor (manual + camera review); editor round-trips `category_id`
- User-scoped custom categories: `categories.user_id` (null = global), partial unique indexes, RLS insert/update/delete on own rows
- Creation flow in the picker: name → slugify (collision handling vs canonical 13 + user rows), palette pick, need/want choice
- Display catalog merge: chips, home strip, history, analytics, receipts detail, pro charts, donut
- Custom categories in monthly budgets + rollover (settings screen + `validKeys` filter)
- Block-delete: category with associated purchases cannot be deleted while in use; UX explains, offers reassignment

### Out of Scope
- DB-driven parser vocabulary (parser stays on the 13 canonical slugs; custom = post-parse assignment)
- Behavior changes to the 13 canonical slugs
- Backfilling/reclassifying existing 'otros' purchases
- Soft-delete history or merge tooling

## Capabilities

### New Capabilities
- `user-categories`: user-scoped storage, creation flow, picker integration, display merge

### Modified Capabilities
- `category-budgets`: dynamic catalog for settings + rollover (custom slugs included)

## Approach

(a) Stack `CategoryPickerModal` over `ItemEditorModal` (existing modal is already a standalone overlay; RN sheet-on-sheet is safe) — parent round-trips `category_id`. (b) DB user-scoped categories (B2): migration adds `user_id`, replaces UNIQUE(slug) with partial unique indexes `(slug) where user_id is null` + `(user_id, slug) where user_id is not null`, adds RLS insert/update/delete, creation UI in the picker. Save seam and aggregation stay unchanged — a custom slug without a DB row misbuckets into 'otros', so the row is mandatory before the slug is used.

**Rationale**: (a1) reuses the tested picker surface and gives the create affordance one home; inline chips can't host it. B2 over B1 (client-only slugs corrupt: save seam + every aggregation → 'otros') and over B3 (global inserts pollute the shared taxonomy — wrong data model).

**Product tradeoffs**: slug collision with canonical 13 → blocked at creation with feedback; deletion → blocked while in use, no silent 'otros' fallback, reassign first; 'otros' stays the deterministic fallback for unknown/legacy data only; existing data unaffected (additive nullable migration, no backfill); aggregation stays correct because custom slugs always resolve to a row before save.

**Delivery**: chained PRs (UI slice first, then DB+creation slice) — exact split fixed at task planning.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/features/tickets/components/ItemEditorModal.tsx` | Modified | `category_id` round-trip + picker row |
| `src/features/tickets/components/CategoryPickerModal.tsx` | Modified | User rows section + create flow |
| `src/features/tickets/manual-form.ts` / `manual-receipt.ts` | Modified | Editor category (manual + scan review) |
| `src/features/home/categories.ts` | Modified | Catalog merge helpers (pure fallbacks unchanged) |
| `src/features/analytics/hooks/useCategoryBudgets.ts` | Modified | Rollover `validKeys` → dynamic catalog |
| `supabase/migrations/0032_user_categories.sql` | Added | `user_id`, partial unique indexes, RLS, kind default |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Custom slug without DB row → 'otros' | Med | Row mandatory; creation writes row before use |
| RLS gaps leak cross-user rows | Med | Partial indexes + policies; SQL smoke tests |
| Rollover `validKeys` drops custom slugs | Med | Filter by dynamic catalog; budget tests |
| `fetchCategoryIdsBySlug` 200-row cap | Low | Raise limit/sort; existing `?? null` guard |
| kind CHECK blocks creation | Low | UI requires need/want at creation |
| Nested-modal UX confusion | Low | Reuse tested picker; standard sheet stacking |

## Rollback Plan

UI PR reverts independently of the DB PR. Migration is additive (nullable `user_id`, no backfill, no data rewrite) — reverting leaves the column harmless; re-ship is safe. Deletion is block-only, no cascade.

## Dependencies

- Existing `CategoryPickerModal` / `ItemEditorModal` components
- Supabase CLI migrations + RLS patterns (0001/0002)
- `EXPENSE_CATEGORIES` remains the pure fallback source

## Success Criteria

- [ ] Category assignable at add AND edit time in manual + camera flows
- [ ] Custom category created, saved, round-trips edits, aggregates under its own slug/label/color
- [ ] Custom budgets set + roll over like standard ones
- [ ] Delete blocked while referenced; no silent 'otros'
- [ ] Parser output unchanged (unknown → SIN CATEGORÍA/null)
- [ ] `pnpm typecheck` and `pnpm test` pass