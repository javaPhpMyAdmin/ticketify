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
4. `supabase db query --local --file <file>` — runs each smoke test
   (`supabase/tests/pro-subscription.sql`, `household-totals.sql`,
   `user-categories.sql` — see `scripts/test-db-smoke.mjs` for the exact
   step list). Any raised assertion fails the query and the script exits
   non-zero.

> This script is deliberately **not** wired into `pnpm test`. The Node suite is
> Docker-free; pulling the entire Supabase stack into it would break `pnpm test`
> for anyone without Docker. Run `pnpm test:sql` separately when you have Docker.

> The first `supabase start` pulls container images and can take several minutes.

## Running it in CI

GitHub Actions runs the same steps in a dedicated `db-smoke` job
(`.github/workflows/ci.yml`): `supabase/setup-cli@v1` installs the CLI, then
`supabase start` (Postgres only) + `supabase db reset --local` build the
catalog, then one `supabase db query --local -f <file>` step PER smoke test
(`pro-subscription.sql`, `household-totals.sql`, `user-categories.sql`)
executes them and fails the build on any assertion failure.
