# Ticketify — SQL smoke tests

This directory holds the fail-closed smoke tests that make up the **SQL tier**:
the part of the test surface that needs a real Postgres catalog. None of them
applies a migration and none ever runs against production — the local harness
and CI both build a throwaway database from `supabase/migrations/` first.
`pro-subscription.sql` is pure catalog reads; the rest seed fixtures with fixed
UUIDs, because a column default or an RLS policy is only observable through a
real write. Each is idempotent (`on conflict do nothing`, plus files that
clean up their own fixtures), and it is safe that some of them leave rows
behind: both runners rebuild the catalog with `db reset` immediately before
the suite. Every file is a single `DO`/`assert` block — plain SQL, not pgTAP.

## `pro-subscription.sql`

A fail-closed smoke test covering:

1. `profiles` tier-lifecycle columns (`tier`, `subscription_status`,
   `ever_paid`). `trial_ends_at` is **not** among them: migration 0039 dropped
   the column and `trial-cutover.sql` asserts the drop, so trial eligibility
   belongs to the Play Console / App Store Connect native intro offers.
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

## `household-totals.sql`

A fail-closed smoke test for the household totals consistency change
(migration 0031) and the household-entry half of the grouped-aggregation
migration (`0043 §entry`). Covers:

1. **Catalog**: `monthly_category_totals(text, uuid)` exists, is
   `SECURITY DEFINER`, owned by `postgres`, and returns a fixed 8-column
   row (7 + `currency`, since 0044 groups per unit) — the count the
   42P13-safe `create or replace` contract depends on
   (`supabase/tests/household-totals.sql:176:42P13-safe`). EXECUTE is
   revoked from anon and public and granted to `authenticated`. The
   legacy single-argument `monthly_category_totals(text)` overload must
   never become a definer: the file asserts that, whenever it is present,
   it stays `security invoker` (its absence would also pass that assert),
   so it additionally asserts RLS is enabled on `purchases`: a definer
   overload would read past RLS, the 0029 §4 anon trap
   (`supabase/tests/household-totals.sql:144:anon-trap`). Which overload
   PostgREST resolves a personal-mode call to is asserted nowhere: the
   client test pins only the client half — a call carrying `p_year_month`
   and no other argument (`scripts/test-features.mjs:474:p_year_month`) —
   while the SQL file records that the one-argument call would be
   ambiguous in raw SQL
   (`supabase/tests/household-totals.sql:315:ambiguous`).
2. **Confirmed-only, net headline**: in a fixture month holding two
   confirmed receipts and a pending one, category rows and `item_count`
   exclude the pending receipt, `lacteos` sums to 240.00 of confirmed
   line items, `percent_of_total` is windowed over that confirmed-only
   set, and `monthly_purchases_total` returns 299.60 — the discounted
   receipt counted at what was actually paid (199.60), not its 200.00
   gross line-item sum (`supabase/tests/household-totals.sql:311:299.60`).
3. **Personal reconciles with Household**: the same definition called
   with a NULL household returns the identical headline for a
   single-contributor month, to the cent.
4. **Membership and privilege gates**: a non-member gets zero category
   rows and a NULL headline rather than an error, and anon is denied
   EXECUTE (insufficient_privilege).
5. **Household entry single-currency check** (money-integrity
   `0043 §entry`): `create_household` seeds `households.currency` from
   the creator's profile currency (normalized `upper`/`btrim`); `join_household`
   raises `currency_mismatch` / SQLSTATE `CU001` on a mismatched profile
   currency before any membership row exists; the rejected code stays usable
   once the caller fixes their currency; a NULL household currency skips the
   check so pre-0043 households keep working; and a profile-currency change
   after a successful join revokes nothing — enforcement is entry-only.
   Also pins `join_household`'s SECDEF/owner/grants.

It seeds fixed-UUID fixtures idempotently, leaves them for the harness's
`db reset`, and ends with a `raise notice` on success. Like the others it
is a single `DO`/`assert` block and runs via `pnpm test:sql` (its step is
registered in `scripts/test-db-smoke.mjs`) and via the CI `db-smoke`
job; it is a smoke test rather than a unit test because the contract is a
function signature, a grant posture and RPC results computed under a
simulated JWT identity — none of which the Docker-free Node tier can observe.

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

## `recalculate-on-purchase-items-update.sql`

A fail-closed smoke test for the trigger that keeps the materialized
`monthly_user_totals` cache fresh (migration 0033). Covers:

1. **Catalog**: `trigger_recalculate_monthly_totals_on_item()` exists, and
   `trg_monthly_totals_recalculate_on_item` is bound to `purchase_items`
   as an `AFTER UPDATE ... FOR EACH ROW` trigger — read back through
   `pg_get_triggerdef`, the server's own canonical DDL string, rather than
   the `tgtype` bitmask
   (`supabase/tests/recalculate-on-purchase-items-update.sql:76:pg_get_triggerdef`).
2. **The reassign seam refreshes the cache server-side**: the fixture
   month is materialized explicitly first (direct SQL inserts bypass the
   app's own recalculation call, so the 0015 purchases trigger would
   otherwise leave the row stale), then one line item's `category_id` is
   re-pointed exactly as the reassign/delete picker does — `purchases`
   untouched and no recalculation RPC after the write. The moved slug is
   gone from `category_totals`, and the target slug absorbs the move at
   100.00 (`supabase/tests/recalculate-on-purchase-items-update.sql:159:panaderia`),
   while the month headline, `items_count` and `daily_totals` are unchanged,
   because the purchase row itself did not change.

It scopes every identity and assertion to its own user and month, seeds
fixtures idempotently, leaves them for the harness's `db reset`, and ends
with a `raise notice` on success. Like the others it is a single
`DO`/`assert` block and runs via `pnpm test:sql` (its step is registered
in `scripts/test-db-smoke.mjs`) and via the CI `db-smoke` job; what it
pins is a trigger's presence and a jsonb cache that trigger rebuilds —
catalog and data state the Docker-free Node tier cannot see.

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
3. **The tier-only gate still admits Pro**: a Pro user (`tier='pro'`) creates a
   household successfully, with owner membership and `profiles.household_id`
   set. There is no trialing case left to test — 0039 dropped
   `start_free_trial` and narrowed `subscription_status` to
   `('none','active')`, so the file's trialing fixture was removed along with
   the assertion it existed for.
4. **`sync_client_subscription` rejections**: `'active'` is rejected for free
   AND Pro users (exact error message asserted, no mutation) — paid status is
   the RevenueCat webhook's alone. `'none'` is the one value a client can still
   claim: it is accepted, and it never changes `tier`, so it cannot grant Pro
   capability. This file asserts neither `'trial'` nor `'expired'`: those
   RPC rejections are `trial-cutover.sql`'s §4e/§4f
   (`supabase/tests/trial-cutover.sql:318:sync_client_subscription`), and
   their unrepresentability is 0039 §6's narrowed CHECK rather than §9d's
   allow-list
   (`supabase/migrations/0039_rc_trial_cutover.sql:166:subscription_status`).

It ends with a `raise notice` on success. Like the others it is a single
`DO`/`assert` block, idempotent, and runs via `pnpm test:sql` (its step is
registered in `scripts/test-db-smoke.mjs`) and via the CI `db-smoke` job.

## `delete-account.sql`

A fail-closed smoke test for the account-deletion primitive (migrations
0036 and 0037). Covers:

1. **Catalog**: `delete_user_account(uuid)` exists, is
   `SECURITY DEFINER`, owned by `postgres`, returns `text`, and is
   EXECUTE-granted to `service_role` with anon, authenticated and public
   revoked (`supabase/tests/delete-account.sql:129:service_role`) — no anon
   or authenticated client session can invoke the destructive RPC.
2. **Cascade**: one call wipes a fixture user seeded across `profiles`,
   `stores`, `purchases`, `purchase_items`, `scan_usage`,
   `monthly_user_totals`, `category_budgets` and their own `categories`
   rows, each table asserted empty afterwards. `webhook_events` is the
   deliberate exception: 0037 dropped its FK to `profiles`, so the row
   survives as the audit signal and the file asserts that it does
   (`supabase/tests/delete-account.sql:287:webhook_events`).
3. **Storage sweep**: the seeded `storage.objects` row under the user's
   folder in the `receipts` bucket is removed — that bucket has no
   cascade from `auth.users`, so without the sweep the photo would
   outlive the account.
4. **`parse_attempts` scrub**: the counter row is removed too; the table
   has no FK to `profiles`, so nothing else would delete it.
5. **Household pre-flight, both ways**: a solo owner (the only member of
   the household they created) is NOT blocked, gets `'ok'`, and their
   household and membership rows cascade away; an owner with another
   active member is rejected with SQLSTATE `P0001` and the exact message
   `owner_must_disband_first`
   (`supabase/tests/delete-account.sql:425:owner_must_disband_first`),
   nothing is mutated, and a repeat call on that still-present owner
   raises again instead of degrading into a silent no-op.
6. **Idempotency**: a second call after a successful delete returns
   `'already_deleted'` and exits without an exception
   (`supabase/tests/delete-account.sql:371:already_deleted`).
7. **Re-signup**: after the delete, a fresh `auth.users` row can be
   inserted with the same email.

It seeds fixed-UUID fixtures idempotently and ends with a
`raise notice` on success. Like the others it is a single `DO`/`assert`
block and runs via `pnpm test:sql` (its step is registered in
`scripts/test-db-smoke.mjs`) and via the CI `db-smoke` job; it belongs to
the SQL tier because both halves of its contract — an `auth.users`
cascade with a storage sweep, and a `service_role`-only grant posture —
exist in the catalog and are invisible to the Docker-free Node tier.

## `legal-acceptances.sql`

A fail-closed smoke test for the versioned legal-acceptance record
(migration 0038). Covers:

1. **Catalog**: `legal_acceptances` with exactly the four designed
   columns (`user_id`, `document`, `version`, `accepted_at` — all
   `NOT NULL`, `accepted_at` defaulting to `now()`), the composite
   primary key `(user_id, document, version)`
   (`supabase/tests/legal-acceptances.sql:155:PRIMARY`), the `document`
   CHECK (`privacy` | `terms`) and the ISO-date `version` CHECK, an
   `ON DELETE CASCADE` FK to `auth.users`, RLS enabled with exactly two
   policies (`select_own` + `insert_own`, both scoped on `auth.uid()`) and
   no update or delete policy
   (`supabase/tests/legal-acceptances.sql:229:append-only`), and
   `record_legal_acceptance(text, text)` as `SECURITY DEFINER` owned by
   `postgres` with EXECUTE granted to `authenticated` only — anon, public
   and `service_role` are revoked.
2. **Writes as `authenticated`**: a direct own-row insert passes; the RPC
   derives `user_id` from `auth.uid()`; repeating a `(document, version)`
   pair is a no-op; an unknown document raises 23514 and leaves no row;
   `UPDATE` and `DELETE` on own rows affect zero rows; and another user's
   rows are invisible to `SELECT` while an insert carrying their `user_id`
   is blocked (42501).
3. **Version contract**: malformed, non-date and empty version strings
   each raise 23514 and leave no row; accepting a new version appends a
   row while the old one survives; `accepted_at` lands inside the `now()`
   window; and a call with no JWT `sub` raises 23502 rather than writing a
   NULL-owner row (`supabase/tests/legal-acceptances.sql:488:23502`).
4. **Cascade and anon**: deleting the `auth.users` row deletes the
   acceptance rows with it; as anon, the table reads empty and the RPC
   is denied with 42501.

> **Scope, stated rather than papered over.** The file calls the RPC as
> direct SQL and CI runs it through `supabase db query`, so the PostgREST
> path — `supabase.rpc(...)` named arguments and the JWT role — is not
> exercised here; the file's own header records the same boundary.

It seeds fixed-UUID fixtures, and its cascade check deletes the fixture
user — taking their acceptance rows with it — then re-inserts that user
with `on conflict (id) do nothing`
(`supabase/tests/legal-acceptances.sql:512-515:Restore`) so the fixture
stays consistent for a re-run, before ending with a `raise notice` on
success. Like the others it is a single `DO`/`assert`
block and runs via `pnpm test:sql` (its step is registered in
`scripts/test-db-smoke.mjs`) and via the CI `db-smoke` job; its
assertions are constraints, policies and grants plus role-switched
writes, none of which the Docker-free Node tier can observe.

## `trial-cutover.sql`

A fail-closed smoke test for the RevenueCat trial cutover (migration
0039). Covers:

1. **Catalog — the removals**: `profiles.trial_ends_at`
   (`supabase/tests/trial-cutover.sql:88:DROPPED`), `start_free_trial()`,
   `expire_overdue_trials()` and the 3-argument
   `sync_subscription_status(uuid, text, timestamptz)` overload are all
   gone — a surviving overload would make 2-argument calls ambiguous — and
   `protect_profile_tier()` is not executable by public, anon or
   `authenticated`. The `cron.job` row named `trial-expiry` must be
   unscheduled too, but that assertion is skipped, not failed, when
   pg_cron is absent: the extension is platform-optional and the RPC drops
   are the authoritative contract.
2. **The narrowed CHECK**: writing `'trial'`, `'frozen'` or `'expired'`
   into `profiles.subscription_status` raises 23514, while `'none'` and
   `'active'` still apply — the allow-list the cutover declares
   (`supabase/migrations/0039_rc_trial_cutover.sql:166:subscription_status`).
3. **The narrowed RPC allow-lists**: `sync_subscription_status` applies
   `'active'` and `'none'` but raises `P0001` for `'trial'` and
   `'expired'` — pinned to `P0001` on purpose, so a 23514 leaking through
   the allow-list reads as a failure rather than a pass;
   `sync_client_subscription` likewise raises `P0001` for both, its
   post-cutover allow-list being `('none')`.
4. **Backfill idempotency**: the post-cutover equivalent of the cutover's
   step-1 backfill (`subscription_status = 'trial'` → `'active'`) matches
   zero rows, because the CHECK can no longer represent the value
   (`supabase/tests/trial-cutover.sql:364:ZERO`).

It seeds fixed-UUID fixture profiles idempotently (the
`protect_profile_tier` trigger has no say over the `postgres` session, so
the CHECK is what these writes exercise) and ends with a `raise notice`
on success. Like the others it is a single `DO`/`assert` block and runs
via `pnpm test:sql` (its step is registered in `scripts/test-db-smoke.mjs`)
and via the CI `db-smoke` job; its assertions are dropped objects, a
CHECK and two allow-lists — catalog and RPC state the Docker-free Node
tier cannot see.

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
4. **A rejected write changes nothing**: re-inserting an existing `profiles.id`
   raises `unique_violation` (23505) and leaves the stored currency untouched —
   a duplicate INSERT cannot overwrite the row another path already set.

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
>
> | Runner | SQL files run | Entry point |
> |--------|---------------|-------------|
> | Local harness | all of them | `pnpm test:sql` (`scripts/test-db-smoke.mjs`) |
> | CI `db-smoke` job | all of them | `.github/workflows/ci.yml` (own `supabase start` + `db reset`, one `db query` step per file) |
> | CI `verify` job | none | runs `pnpm test`, which no longer includes `test:sql` |
>
> The `verify` job executing none of these files is intentional, not a gap: the
> SQL tier is owned solely by `db-smoke`, so no runner is left that omits a
> smoke test. The two runners are not interchangeable — the local harness
> additionally applies a platform-grant overlay for older CLI versions whose
> `db reset` boots with truncated privileges, so it asserts the same contracts
> against a different privilege baseline than CI does.

## Running it locally

Requires a running **Docker** daemon. The Supabase CLI is a project-local
devDependency at `node_modules/.bin/supabase` and is **not** on your shell
`PATH`. `scripts/test-db-smoke.mjs` shells out to a bare `supabase` command,
which resolves only because `pnpm run` prepends `node_modules/.bin` to `PATH`.
Use `pnpm test:sql`, not `node scripts/test-db-smoke.mjs` — invoked directly the
harness fails with `ENOENT`.

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
> tier alone and is the only one of the two that needs Docker; `pnpm test:all`
> runs both, in that order, and needs Docker for the same reason. In CI the SQL
> tier is owned solely by the `db-smoke` job; `verify` runs `pnpm test` and
> covers none of these files.
>
> **Do not re-add `test:sql` to the master chain.** Commit `43f5518` added it
> as a temporary workaround: `delete-account.sql` was on disk and in the local
> harness but missing from `db-smoke`, so wiring the SQL tier into the chain was
> the only way to get that file into CI. That gap is closed, and
> `scripts/test-sql-smoke-coverage.mjs` fails the build if a file on disk is
> missing from either runner — but that guard closes the *coverage* gap only.
> The chain entry also ran the same smoke files in two jobs against two
> different privilege baselines: `verify` reached them through this harness,
> platform-grant overlay included, while `db-smoke` ran them without it. The
> overlay is the weaker of the two by design, so CI keeps the stronger baseline
> and the tier stays single-owner.
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
