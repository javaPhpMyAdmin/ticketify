# Tasks: parse-ticket list-mode fallback

## Phase 1: Edge function list mode

- [x] 1.1 Add `LIST_PROMPT` constant to `supabase/functions/parse-ticket/index.ts`.
- [x] 1.2 Add `callGeminiListMode` function and `parseListJson` helper.
- [x] 1.3 Modify the HTTP handler to fall back to list mode on `ParseError`.
- [x] 1.4 Build default `ParsedReceipt` from list-mode results.

## Phase 2: Client tolerance for missing metadata

- [x] 2.1 Update `toClientReceipt` in `src/features/tickets/api.ts` to default empty store and missing date.
- [x] 2.2 Ensure the review screen renders empty store/date without crashing.

## Phase 3: Verification and deployment

- [x] 3.1 Run `pnpm typecheck`.
- [x] 3.2 Run `pnpm test` and any parse-ticket harness.
- [x] 3.3 Deploy `parse-ticket` with import-map flag. ✅ Done — deployed ACTIVE v20 (2026-08-31) with `--import-map supabase/functions/deno.json`.
- [x] 3.4 Mark tasks complete and save apply-progress.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~250 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| PR strategy | single PR |
