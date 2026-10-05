# Ticketify — SQL smoke tests

This directory holds SQL-level smoke tests that assert the **schema catalog**
of the pro/quotas workstream. They are intentionally READ-ONLY: they never
apply migrations and never mutate data — every check runs against Postgres
system catalogs using `DO`/`assert` blocks.

## `pro-subscription.sql`

A fail-closed smoke test covering:

1. `profiles` tier-lifecycle columns (`tier`, `subscription_status`,
   `trial_ends_at`, `ever_paid`).
2. `set_profile_tier(uuid, text)` exists, is `SECURITY DEFINER`, owned by
   `postgres`, with least-privilege grants (REVOKEd from anon/authenticated).
3. `webhook_events` ledger: primary key, RLS enabled, `uid()`-scoped SELECT.
4. The `profiles_protect_tier` trigger still guards `tier`.
5. Quota objects: `try_consume_scan`, `recalculate_monthly_totals`,
   `monthly_user_totals`, and `scan_usage.scans_limit`.

It ends with a `raise notice` on success. Because it is a plain `DO`/`assert`
script (NOT pgTAP), it is run with `supabase db query` against a scratch
database where the migrations have been applied — **not** with
`supabase test db` (which expects pgTAP `.test.sql` files).

## `user-categories.sql`

A fail-closed smoke test for the user-scoped custom categories change
(migration 0032). Covers:

1. **Catalog**: `categories.user_id` (uuid, nullable, FK `profiles` ON DELETE
   CASCADE), the old `categories_slug_key` dropped, the partial unique
   indexes `categories_global_slug_idx` (slug where `user_id is null`) and
   `categories_user_slug_idx` (user_id, slug where `user_id is not null`)
   plus `categories_user_sort_idx`, the `kind` CHECK intact, the
   `categories_user_sort_order_floor` CHECK (user_id null or sort_order >=
   100), RLS on with exactly the 4 category policies
   (`select_auth` + `insert/update/delete_own`), and
   `purchase_items_category_id_fkey` switched to ON DELETE RESTRICT.
2. **Per-scope uniqueness + coexistence**: same slug under different users
   allowed; duplicate slug for the same user raises 23505; duplicate global
   slug raises 23505; a GLOBAL row and the caller's OWN row may share a slug
   (user-first by construction — the floor + `order(sort_order, slug)` make
   the own row the deterministic map winner); custom rows below the floor
   are rejected; canonical rows stay at 13 with `user_id = null` (no
   backfill).
3. **RLS write policies** (as `authenticated` with a JWT `sub` claim):
   own-row insert/update/delete succeed; cross-user and global-row writes
   are blocked; select-all behavior preserved; **`purchase_items` INSERT and
   UPDATE reject a line whose `category_id` is another user's custom row**
   (42501) while allowing global/own rows.
4. **FK RESTRICT**: deleting an in-use category raises
   `foreign_key_violation` and never re-buckets items; the empty category
   deletes cleanly after its referencing purchase is removed.
5. **`save_receipt` server-side validation** (SECURITY DEFINER — RLS never
   fires for its writes): a receipt line referencing another user's custom
   category uuid or an unknown uuid raises and rolls back completely; a
   mixed receipt (NULL + global canonical + the caller's own row) succeeds.

Like the others it is a single `DO`/`assert` block, idempotent, and runs via
`pnpm test:sql` (its step is registered in `scripts/test-db-smoke.mjs`) and
via the CI `db-smoke` job.

## `household-gate-tier.sql`

A fail-closed smoke test for the household-subscription security fix
(migration 0034). Covers:

1. **Catalog**: `create_household(text)` and `sync_client_subscription(text)`
   exist, are `SECURITY DEFINER`, owned by `postgres`, with least-privilege
   grants (no EXECUTE for anon/public, EXECUTE for `authenticated` only —
   the 0029 §4 create-or-replace-resets-EXECUTE trap).
2. **create_household gate (the integrity hole)**: a free user whose
   `subscription_status` was spoofed to `'active'` (the old
   `sync_client_subscription('active')` exploit path) is REJECTED with
   `Pro subscription required to create a household`, and nothing is
   written (no household row, no `household_id`).
3. **No trial regression**: a Pro user and a trialing user
   (`tier='pro'`, `subscription_status='trial'` — the state
   `start_free_trial` produces) both create households successfully, with
   owner membership and `profiles.household_id` set.
4. **`sync_client_subscription` rejections**: `'active'` is rejected for
   free AND Pro users (exact error message asserted, no mutation); the
   remaining claims (`'none'`/`'trial'`/`'expired'`) are accepted but never
   change `tier` and never write `trial_ends_at` — they cannot grant Pro
   capability or freeze the expiry materialization.

It ends with a `raise notice` on success. Like the others it is a single
`DO`/`assert` block, idempotent, and runs via `pnpm test:sql` (its step is
registered in `scripts/test-db-smoke.mjs`) and via the CI `db-smoke` job.



## `currency-default.sql`

A fail-closed smoke test for the i18n workstream's currency-default alignment
(migration 0041). Covers:

1. **The column default**: `public.profiles.currency` declares `'USD'` — the
   canonical **UPPERCASE** ISO 4217 form. The test asserts case-sensitively
   against the rendered `pg_get_expr` output (so `'USD'::text` passes) and
   rejects any lowercase `'usd'` literal in the default expression. Case is
   load-bearing, not cosmetic.
2. **The default actually fires**: a profile inserted without a currency is
   born `'USD'`, while a profile inserted WITH `'UYU'` keeps `'UYU'`. That
   second half is what proves no CHECK, normalizing rule, or trigger is
   overriding a real user choice.
3. **Nothing else moved**: the column is still `text NOT NULL`.

It seeds fixed-UUID fixtures (disjoint from every other smoke test's range),
asserts, and deletes them inside the same `DO` block, so it is idempotent and
leaves the scratch DB untouched.

> **Known limitation, stated rather than papered over.** A post-migration smoke
> test structurally cannot detect a one-time backfill; that property is pinned
> by the migration header and review, **not** by this file.

Like the others it ends with a `raise notice` on success, is a single
`DO`/`assert` block, and runs via `pnpm test:sql` (its step is registered in
`scripts/test-db-smoke.mjs`) and via the CI `db-smoke` job.

> **Runner coverage.** Both runners execute **every** `.sql` file in this
> directory; there is no partial runner left to reconcile. No count is written
> here on purpose — a tenth file would falsify any numeral below without
> falsifying the build. `scripts/test-sql-smoke-coverage.mjs` (wired into the
> master `pnpm test` chain) reads the disk and both runners and fails if any
> file here is missing from either, if either names a file that does not exist,
> or if the two runners disagree with each other.

> | Runner | SQL files run | Entry point |
> |--------|---------------|-------------|
> | Local harness | all of them | `pnpm test:sql` (`scripts/test-db-smoke.mjs`) |
> | CI `db-smoke` job | all of them | `.github/workflows/ci.yml` (own `supabase start` + `db reset`, one `db query` step per file) |
> | CI `verify` job | none | runs `pnpm test`, which no longer includes `test:sql` |

> The `verify` job executing none of these files is intentional, not a gap: the
> SQL tier is owned solely by `db-smoke`, so no runner is left that omits a smoke
> test. The two
> runners are not interchangeable — the local harness additionally applies a
> platform-grant overlay for older CLI versions whose `db reset` boots with
> truncated privileges, so it asserts the same contracts against a different
> privilege baseline than CI does.

## Running it locally

Requires **Docker** (daemon running) and the **Supabase CLI** on `PATH`.

```bash
pnpm test:sql
```

This runs `scripts/test-db-smoke.mjs`, which:

1. Checks Docker is reachable (fails fast with a clear message otherwise).
2. `supabase start` — boots the local stack and applies every migration in
   `supabase/migrations/` to a scratch DB.
3. `supabase db reset --local` — deterministically rebuilds the catalog from
   scratch so the smoke test sees exactly what the migrations declare.
4. Re-applies the platform's table/sequence grants — a regression guard for CLI
   versions whose `db reset` boots with truncated default privileges. CI pins
   CLI 2.116.0 and does not need this step; see the overlay note in
   `scripts/test-db-smoke.mjs`.
5. `supabase db query --local --file <file>` — runs each smoke test,
   `currency-default.sql` last. See `scripts/test-db-smoke.mjs` for the exact
   step list. Any raised assertion fails the query and the script exits
   non-zero.

> **Three entry points, three tiers.** `pnpm test` runs the Node suite only and
> is Docker-free in CI — it never boots Supabase. `pnpm test:sql` runs the SQL
> tier alone and is the only local command that needs Docker. `pnpm test:all`
> runs both, in that order. In CI the SQL tier is owned solely by the
> `db-smoke` job; `verify` runs `pnpm test` and covers none of these files.
> Do not re-add `test:sql` to the master chain: that was a temporary
> workaround (commit 43f5518) to get `delete-account.sql` into CI while it was
> missing from `db-smoke`, and that gap is now closed — `scripts/test-sql-smoke-coverage.mjs`
> fails the build if a file on disk is missing from either runner.
>
> **The one networked Node step.** "Docker-free" is absolute for CI, not for a
> developer with a local stack running: `scripts/test-legal-consent.mjs` §7
> performs a live PostgREST fetch, gated behind `TEST_LIVE_SUPABASE_URL` and
> `TEST_LIVE_SUPABASE_ANON_KEY` (export them from `supabase status -o env`).
> Unset — as CI leaves them — that step prints a skip line and the suite is
> fully offline.

> The first `supabase start` pulls container images and can take several minutes.

## Running it in CI

The `db-smoke` job (`.github/workflows/ci.yml`) is the sole owner of the SQL
tier in CI — the `verify` job does not run any of these files. It is
self-sufficient rather than a wrapper around the local harness:
`supabase/setup-cli@v1` installs CLI 2.116.0, then `supabase start` (Postgres
only) + `supabase db reset --local` build the catalog, then one
`supabase db query --local --file <file>` step PER smoke test executes them and
fails the build on any assertion failure. It does NOT invoke
`scripts/test-db-smoke.mjs` and does NOT apply the local harness's
platform-grant overlay — the pinned CLI's boot already grants the platform
defaults.
