# Verify Report: auth-supabase-connection

> **Reconstruction note**: sdd-verify completed verification (gates green) but did not persist a verify-report artifact in either store. sdd-archive reconstructed this report at archive time (2026-08-04) from apply-progress (#542), the orchestrator's verification assertion, and fresh first-hand evidence (gates re-run + Supabase MCP DB queries). Recorded in the archive report.

## Status

**PASS** — no CRITICAL, no FAIL, no blocking findings. Archive-ready.

## Quality Gates (re-run fresh at archive time, 2026-08-04)

| Gate | Command | Result |
|------|---------|--------|
| Typecheck | `pnpm typecheck` | 0 errors |
| Lint | `pnpm lint` | 0 errors, 2 pre-existing warnings (`src/stores/use-receipts-store.ts:10`, `src/types/index.ts:106` — `@typescript-eslint/array-type`) |
| Tests (adapter) | `pnpm test:adapter` | 14/14 passed |
| Tests (auth) | `pnpm test:auth` | 50/50 passed |
| Tests (features) | `pnpm test:features` | 11/11 passed |
| **Total** | `pnpm test` | **75/75 passed** |

## Remote Database Verification (Supabase project `lfbyifbccfjposuzgccl`, via MCP)

| Check | Evidence | Result |
|-------|----------|--------|
| Migrations applied | `list_migrations` | `0001_initial_schema`, `0002_auth_fixes` present |
| RLS enabled | `pg_class.relrowsecurity` for `public` | All 6 tables: categories, profiles, purchase_items, purchases, scan_usage, stores |
| Composite PK | `pg_constraint` | `scan_usage` PRIMARY KEY `(user_id, year_month)` |
| Analytics RPC | `pg_proc` | `monthly_category_totals(p_year_month text)` — security invoker (prosecdef=false), stable (provolatile='s') |
| Tier protection | `pg_trigger` | `profiles_protect_tier` — `BEFORE INSERT OR UPDATE ON public.profiles` |

## Delivery State

- 20 chained PRs #7–#26 open on `origin` (branches `chain/slice-1`..`chain/slice-20`), every PR ≤ 400 changed lines.
- Old oversized PRs #1–#6 (6-PR chain) closed.
- Final chain state == `feat/auth-supabase-connection` tip (empty diff) per decision observation #558.

## Acceptance Mapping (spec → implementation)

| Spec capability | Verification | Result |
|-----------------|--------------|--------|
| user-auth | auth harness 50/50 + manual review of flows (PKCE, cold-start, warm-race, reset anti-enumeration, bounded restore, mandatory gate `guard={session != null}`) | PASS |
| supabase-connection | storage adapter 14/14 (chunk/unchunk round-trip >2048 B, failure-safe writes); `isSupabaseConfigured` cases | PASS |
| profile-sync | profile auto-creation upsert + RLS own/other-row semantics verified against remote policies | PASS |
| data-access | features harness 11/11 (authenticated reads, missing-profile state, RPC failure-safe, saveReceipt no-op) | PASS |
| demo removal | `grep -ri demo` over src/scripts/package.json/.github/app.json/tsconfig.json = ZERO hits (apply-progress #542) | PASS |

## Known Residual Debt (accepted, non-blocking — carried to archive report)

1. OAuth cold-start timeout branch (`src/app/oauth.tsx`, `OAUTH_EXCHANGE_TIMEOUT_MS`) untested at route level (helpers covered; route component manual-review only).
2. `restore()` vs concurrent cold-start OAuth: window between `stale()` check and `await signOut()` can destroy a fresh session (fix = re-check `stale()` after `signOut`).
3. Migration 0002 hardcodes the `'free'` default reference in the `protect_profile_tier` trigger (assumes 0001's default).
4. `oauth.tsx` `waitForFlow` poll has no automated test.
5. Settings store keeps dead surface (`monthly_budget`/`tier` setters) noted by readability review — not wired to UI.
6. Demo-era hook rename: `useAuthMode` → `useSessionUser` — `openspec/` design.md/tasks.md still reference the old name (orchestrator-owned artifacts; updated at archive time where applicable).
7. 1.4 optional: client not parameterized with generated `Database` types (no `supabase link`); untyped + `src/types` fallback shipped.
8. Dashboard manual config (email + Google/Apple providers, redirect whitelist incl. `?sb_flow_id` wildcard) still a manual step.
