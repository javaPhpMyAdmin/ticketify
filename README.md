# Ticketify

A receipt-scanning expense tracker for personal and household budgets. The user photographs a paper receipt (camera or gallery), a Supabase edge function (`parse-ticket`) extracts the fields with Gemini, the user corrects them on a review form, and the receipt persists to Postgres and rolls up into monthly totals, per-category budgets, run-rate projections, price alerts and analytics.

Stack and architecture summary: [`openspec/config.yaml`](#specs-and-process).

Also in scope: manual entry with no photo, a monthly receipt list with a month stepper, CSV/PDF export through the OS share sheet, household sharing by invite code with owner-pays settlement, account deletion, and a Pro tier via RevenueCat.

Before you read code:

- 4 bottom tabs — Home, Analytics, History, Profile (`src/app/(tabs)/_layout.tsx`).
- 13 canonical spending categories, plus per-user custom categories added by migration `0032_user_categories.sql` (`src/features/home/categories.ts:17-30`).
- 14 ISO-4217 currencies: 8 LATAM (`ARS BRL CLP COP MXN PEN PYG UYU`) + 6 international (`AUD CAD EUR GBP JPY USD`), `src/lib/format.ts:45-71`. `CLP`, `JPY`, `PEN` and `PYG` are zero-decimal.
- 5 UI locales × 18 namespaces (`en`, `es-419`, `es-AR`, `es-ES`, `pt-BR`). `es-419` is the Spanish base; `es-AR` and `es-ES` are sparse overrides with many empty `{}` namespace files. Fallback chain: `es-AR`/`es-ES` → `es-419` → `en`, `pt-BR` → `en` (`src/i18n/config.ts:194-201`).
- Free tier capped at 15 scans (`FREE_DEFAULT_LIMIT = 15`, `src/features/home/quota.ts:60`).

## Commands

The test surface has two tiers. They have different prerequisites and different CI owners. Neither covers the other.

### Node tier — no Docker

| Command | Runs |
|---|---|
| `pnpm test` | The whole Node tier: every chained Node ESM harness |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | `expo lint` |
| `pnpm generate:legal-docs` | Regenerates `docs/legal/` |

`pnpm test` is a `&&` chain that stops at the first failure. There is no test framework behind it, and no config file for one: no test-runner config, no `*.test.*` or `*.spec.*` file anywhere, and no `node:test` import. Each harness is `node:assert/strict` plus its own hand-rolled `test(name, fn)` runner.

Mechanically, a harness compiles TypeScript with the project-local `tsc` and dynamically imports the result. Render harnesses use `react-test-renderer`, DOM harnesses use `jsdom`, and module stubs live in `scripts/test-stubs/`, aliased through per-harness `scripts/tsconfig.*-test.json`.

What it covers, at area level:

- Currency and date formatting, and the 14-code catalog.
- Auth: session, navigation, validation.
- The SecureStore chunked session adapter.
- The receipt parse pipeline, and the scan and quota contract.
- Receipt persistence and mapping; the Home feed and its monthly aggregation cache.
- Run-rate projection; per-category budgets and rollover.
- Pro gating, paywall, RevenueCat offerings, webhook idempotency.
- Locale detection and catalog parity; legal links and consent.
- The onboarding wizard.

`openspec/specs/` is the authority on what each of those areas must do.

### SQL tier — requires a running Docker daemon

**`pnpm test:sql`** runs 9 SQL smoke tests against a local Supabase Postgres.

`test:sql` is deliberately **not** a segment of `pnpm test`. A drift guard (`scripts/test-sql-smoke-coverage.mjs`) fails the build if it ever returns to the master chain. Running `pnpm test` does not exercise the schema.

The Supabase CLI is a project-local devDependency at `node_modules/.bin/supabase` and is **not** on your shell `PATH`. It resolves only because `pnpm run` prepends `node_modules/.bin`, so `pnpm test:sql` works while invoking `node scripts/test-db-smoke.mjs` directly does not.

`supabase/tests/README.md` is the reference for this tier.

## Prerequisites

```bash
pnpm install
```

Then:

- **Node 22.** Nothing in the repo pins a minor or patch: `package.json` has no `engines` field, and there is no `.nvmrc`, `.node-version` or `.tool-versions`. The only authority is CI's `node-version: 22`.
- **pnpm 9.15.9**, pinned via the `packageManager` field in `package.json`. `pnpm-lock.yaml` (lockfileVersion 9.0) is the only lockfile. `.npmrc` sets `node-linker=hoisted`. Corepack is available to enforce the pin.
- **Docker**, and only if you intend to run the SQL tier.
- **A `.env` holding two Supabase values**, before the app will boot: `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`. Copy `.env.example` to `.env` and fill them in; `.env` is git-ignored. See [Environment variables](#environment-variables) for why editing `app.json` will not do it.

Installing with the `npm` CLI instead of pnpm is not merely wrong here: it silently skips `patches/react-native.patch`, which is the iOS XCFRAMEWORK fix. That patch is applied through pnpm's `patchedDependencies`, not through the `patch-package` devDependency that is also present.

## Running the app

> ### Expo Go cannot run this app.
>
> It is not a limitation of your setup, and no amount of configuration will fix it. Two native modules gate the real feature set:
>
> - `expo-camera` ships native code, so the dev client must be rebuilt to pick it up (`src/app/ticket/camera.tsx:15-16`).
> - `react-native-purchases` is loaded through a guarded runtime `require` that returns `null` outside a linked dev client, so the Pro gate stays `locked` and every RevenueCat wrapper takes its safe free-tier path (`src/lib/revenuecat.ts:4-11,26-45`).
>
> Use `pnpm ios` or `pnpm android`. `pnpm start` alone gives you a Metro bundler, not a runtime that can exercise the app.

| Command | Runs |
|---|---|
| `pnpm start` | `expo start` — Metro bundler only |
| `pnpm ios` | `expo run:ios` — native development build |
| `pnpm android` | `expo run:android` — native development build |
| `pnpm web` | `expo start --web` |

The first native run does a full prebuild and compile. After any change that adds or upgrades a package with native code, rerun `pnpm ios` / `pnpm android` to rebuild the dev client.

The dev server port is not pinned; `expo start` picks one at runtime.

OAuth redirect URLs differ by runtime — `ticketify://oauth` in a dev or standalone build, `exp://<host>/--/oauth` under Expo Go (`src/lib/auth/oauth.ts:19-22`). **Both** forms must be whitelisted in the Supabase dashboard under Authentication → URL Configuration → Redirect URLs.

`eas.json` defines `preview` and `production`, and both are Android-only (`buildType: app-bundle`). There is no iOS build profile.

## Environment variables

### Required to boot the app

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon (public) key |

`app.json` does carry `extra.supabaseUrl` / `extra.supabaseAnonKey` keys, but they hold placeholders that a guard explicitly rejects — any value containing `placeholder`, `YOUR-PROJECT` or `YOUR-ANON-KEY` disqualifies the configuration (`src/lib/supabase/config-status.ts:14`). Editing `app.json` will not configure the app; only `.env` will.

Resolution order: `process.env.EXPO_PUBLIC_*`, then `Constants.expoConfig.extra.*`, then `''`.

The Supabase client deliberately does **not** throw on import when these are missing. It renders a generic read error instead, which reads like a backend outage rather than a missing variable.

### Optional development overrides

| Variable | Effect |
|---|---|
| `EXPO_PUBLIC_REVENUECAT_API_KEY` | Blank in development leaves the Pro gate locked |
| `EXPO_PUBLIC_PRO_OVERRIDE` | Forces `isPro` without touching RevenueCat |
| `EXPO_PUBLIC_PRO_EXPIRED_OVERRIDE` | Simulates an expired entitlement. Not present in `.env.example`. |
| `EXPO_PUBLIC_ONBOARDING_PREVIEW` | Forces the onboarding wizard on every launch |

`EXPO_PUBLIC_GEMINI_MODEL` appears in `.env.example` and is read nowhere in the codebase. The edge function reads the unprefixed `GEMINI_MODEL`. Setting it does nothing.

### Edge-function secrets

Server-side only. These are **not** `EXPO_PUBLIC_`-prefixed, are not read by the app bundle, and are set with `supabase secrets set`.

| Variable | Default | Consequence when unset |
|---|---|---|
| `GEMINI_API_KEY` | — | Receipt scanning throws |
| `GEMINI_MODEL` | `gemini-3.1-flash-lite` | Falls back to the default |
| `REVENUECAT_SECRET_API_KEY` | — | Account deletion fails closed: HTTP 502 `revenuecat_revoke_failed` |
| `REVENUECAT_WEBHOOK_SECRET` | — | The webhook rejects every request |
| `REVENUECAT_ENVIRONMENT` | `production` | Sandbox events are not filtered out |

Gateway auth per function (`supabase/config.toml`): `parse-ticket` and `delete-account` run with `verify_jwt = true`; `revenuecat-webhook` runs with `verify_jwt = false` and authenticates with the shared secret instead, constant-time compared inside the handler.

### Test-harness only

`TEST_LIVE_SUPABASE_URL` and `TEST_LIVE_SUPABASE_ANON_KEY`, when both are exported, make `scripts/test-legal-consent.mjs` perform a live PostgREST fetch. Unset, it prints a skip line and the whole Node tier is offline. CI exports neither.

This is the one place `pnpm test` is not hermetic, so export nothing unless you have a local stack running and you want the network call.

## Structure

```
src/app/          expo-router route tree. There is no top-level app/.
src/components/   atomic design: atoms/ molecules/ organisms/, each with a barrel index.ts
src/features/     14 modules: analytics auth budget categories charts export home
                  household items legal onboarding pro profile tickets
src/i18n/         i18next config, custom locale detector, locale adapters
src/lib/          Supabase client + config-status, auth (oauth, session-nav, validation,
                  profile-sync), format.ts, revenuecat.ts, query-client, query-keys
src/stores/       6 cross-cutting Zustand stores
src/theme/        colors spacing radii typography motion
src/types/        domain types mirroring the Postgres schema
scripts/          Node harnesses + per-harness tsconfig.*-test.json + test-stubs/ +
                  test-mocks/ + lib/i18n-chain.mjs
supabase/         migrations/ (41) - manual/ (2, NOT auto-applied) - tests/ (SQL smokes)
                  - functions/ (3 Deno edge functions + _shared)
openspec/         specs/ - changes/ (1 active change, plus archive/)
docs/legal/       legal documents mirrored for GitHub Pages, 5 locales x 2 documents
patches/          react-native.patch, applied through pnpm patchedDependencies
```

Things that will trip you up:

- The git repo root is the `mobile/` directory itself, not its parent.
- `ios/` and `android/` are git-ignored as generated output, yet `android/` still has 2 tracked files.
  - The rule does match them: `git check-ignore -v --no-index <path>` reports `.gitignore:52:/android` for both XML files.
  - Tracked files are exempt from ignore rules. They were committed before the rule existed and stay tracked; `git add` on a *new* file under `android/` is silently dropped, so the trap is invisible until you go looking for the file.
- `supabase/manual/` is deliberately outside the migration chain.
  - `db reset` applies `supabase/migrations/` atomically, so a rollback living there would immediately undo the forward cutover it belongs to.
  - Its two files are the `0040` trial rollback and a paired smoke test.
  - The two smokes assert opposite catalog states, so they cannot both run against one database. A drift guard enforces all of this.
- `0040_currency_usd_default.sql` set `profiles.currency` to lowercase `'usd'`; `0041` supersedes it with uppercase `'USD'`.
  - `0040` stays in the chain, and neither backfills existing rows.
- The SQL smokes are plain `DO` / `assert` blocks, deliberately not pgTAP, so `supabase test db` is not used. They run through `supabase db query`.
- `capturas/` holds design screenshots under Spanish directory names, some containing spaces and one containing a typo.
- `expo-device`, `expo-font` and `patch-package` are installed but have no direct import in the app code.
  - `expo-font` is registered only as an `app.json` config plugin, and the patch is applied by pnpm. Do not read either as active tooling.

## Specs and process

- `openspec/specs/` — 26 current capability specs. This is the canonical store of what the app is supposed to do.
- `openspec/changes/` — in-flight work, with 23 completed changes under `changes/archive/`.
- `openspec/config.yaml` — declares `schema: spec-driven` and `persistence: hybrid`, carries the stack and architecture summary, and pins the phase rules:
  - `rules.apply.tdd: true`
  - `apply.test_command: "pnpm test"`
  - `verify.test_command: "pnpm test"`
  - `verify.build_command: "pnpm typecheck"`
  - `verify.coverage_threshold: 0`
  - It is the closest thing this repo has to an AGENTS.md.
- There is no `AGENTS.md`, `CLAUDE.md`, `.cursorrules` or `CONTRIBUTING.md` anywhere in the tree.
- `.agents/skills/` holds two vendored Supabase agent skills, with `skills-lock.json` pinning their source.

## CI

One workflow, `.github/workflows/ci.yml`, two jobs. Triggers on push and pull request to `main`. No manual dispatch, no schedule, no path filter.

### Job `verify` — "Typecheck, lint & tests"

Node 22 → pnpm 9.15.9 → `pnpm install --frozen-lockfile` → `pnpm typecheck` → `pnpm lint` → `pnpm test`. It runs zero SQL smoke tests, by design.

### Job `db-smoke` — "DB schema smoke test"

Installs no Node dependencies at all. Pins Supabase CLI 2.116.0, because setup-cli's lockfile detection does not parse pnpm and fell back to a version that lacks `db query --local`.

Authenticates to GHCR and overrides the image registry to `docker.io`, to stay clear of anonymous pull rate limits. Starts Postgres only, with a 5-attempt retry that fails fast on any error that is not a registry rate limit.

Then `db reset --local`, followed by one `supabase db query` step per smoke test.

### What a pull request must pass

A frozen-lockfile install, `tsc --noEmit` clean, `expo lint` with zero errors, every Node harness segment green, and every SQL smoke test green against a freshly migrated Postgres.

### What CI does not do

- No formatting check. No Prettier config exists and Prettier is not a dependency.
- No coverage gate. `verify.coverage_threshold` is 0 and there is no coverage tooling.
- No husky, no pre-commit hook.
- No dependency audit.
- No EAS build check.

One asymmetry worth knowing: the local SQL harness applies a platform-grant overlay, so it asserts the same contracts as CI against a different privilege baseline. That asymmetry is why `test:sql` stays out of the master chain. See the *Do not re-add `test:sql` to the master chain* note in `supabase/tests/README.md`.
