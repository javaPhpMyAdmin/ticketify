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
4. `supabase db query --local --file supabase/tests/pro-subscription.sql` — runs
   the smoke test. Any raised assertion fails the query and the script exits
   non-zero.

> This script is deliberately **not** wired into `pnpm test`. The Node suite is
> Docker-free; pulling the entire Supabase stack into it would break `pnpm test`
> for anyone without Docker. Run `pnpm test:sql` separately when you have Docker.

> The first `supabase start` pulls container images and can take several minutes.

## Running it in CI

GitHub Actions runs the same steps in a dedicated `db-smoke` job
(`.github/workflows/ci.yml`): `supabase/setup-cli@v1` installs the CLI, then
`supabase start` (Postgres only) + `supabase db reset --local` build the
catalog, then `supabase db query --local -f supabase/tests/pro-subscription.sql`
executes the smoke test and fails the build on any assertion failure.
