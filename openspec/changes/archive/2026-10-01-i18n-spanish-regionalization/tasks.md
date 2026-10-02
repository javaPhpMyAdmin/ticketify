# Tasks — i18n Spanish regionalization

Legend: `[x]` shipped · `[ ]` open (manual / owner-gated).

## T-1: Introduce the `es-419` base

- [x] T-1.1 Create `src/i18n/locales/es-419/` by promoting the former `es-AR` full catalog.
- [x] T-1.2 Ship all **18** namespaces (the former 17 plus `categories`, which arrived with `category-display-i18n`).
- [x] T-1.3 `es-419` totals 787 leaves; `en` and `pt-BR` remain full catalogs.
- [x] T-1.4 Register the `categories` namespace across all five locales.

## T-2: Reduce `es-AR` to a sparse voseo override

- [x] T-2.1 Keep only the 65 leaves that diverge (voseo, Rioplatense lexicon).
- [x] T-2.2 `es-AR/settingsLanguage.json` → `{}` (zero-copy; resolves through `es-419`).
- [x] T-2.3 `es-AR` is `absent` for all 5 `returnObjects` containers.

## T-3: Add the `es-ES` sparse Peninsular override

- [x] T-3.1 Ship the 42 non-legal divergences across 9 namespaces (30 perfect compounds + 6 lexicon + 6 person compounds).
- [x] T-3.2 Ship the 7 Peninsular-empty namespaces as `{}` (`a11y`, `bootSplash`, `categories`, `common`, `currency`, `date`, `tabs`).
- [x] T-3.3 Ship the complete 73-leaf `es-ES/legal.json` deck (AD-2).
- [x] T-3.4 Ship `es-ES/settingsLanguage.json` byte-identical to `es-419`.

## T-4: Legal register fixes

- [x] T-4.1 Fix `terms.sections.5.body` pasted English fragment `faced interrupciones`.
- [x] T-4.2 Fix `privacy.sections.1.body` bare preterite `nos confirma la compra` → `nos ha confirmado la compra`.
- [x] T-4.3 Confirm the other 71 leaves were already Peninsular (no rewrite).

## T-5: Detection and fallback

- [x] T-5.1 Rewrite `detector.ts` for five locales; region-aware Spanish; English global fallback.
- [x] T-5.2 Export `SUPPORTED_LOCALES`, `SPANISH_LOCALES`, `SPANISH_BASE`, `PLURAL_SECOND_PERSON`, `FALLBACK_CHAIN`, `meetsRegionalViability`.
- [x] T-5.3 Apple underscore-tag + `regionCode` handling.

## T-6: Wire the catalogs and types

- [x] T-6.1 `config.ts` `RESOURCES` — **18** files mirroring the 18 in `en/` and `pt-BR/` per locale (5 locales × 18).
- [x] T-6.2 `RESOURCES` (18 imports each) + per-language `fallbackLng` map.
- [x] T-6.3 `types.ts` re-point: zero `typeof esAR`, 15 `typeof es419`.
- [x] T-6.4 Atomic-flip typecheck gate (`pnpm typecheck` EXIT=0).

## T-7: Language picker

- [x] T-7.1 Six options (auto + five locales) from `settingsLanguage` keys.
- [x] T-7.2 `LocaleOverride` union of six values; tampered values read back as `null`.
- [x] T-7a.6 Picker + store + storage tests green.

## T-8: Register content

- [x] T-8.1 Ship the 42 non-legal Peninsular divergences (9 namespaces).
- [x] T-8.2 Leaf-by-leaf audit of all 73 `es-ES/legal.json` leaves; 2 defects fixed.

## T-9: Verification harness

- [x] T-9.1 Create `scripts/test-i18n-catalog-parity.mjs` (49 tests).
- [x] T-9.2 Wire `test:i18n-catalog-parity` into the `pnpm test` chain.
- [x] T-9.3 Tier-3 pins: sparse shape, 42 value hashes, `vosotros` count, `es-AR` anti-leak, legal register + pasted-fragment scan.
- [x] T-9.4 Update `test-i18n-detector.mjs` for the five-locale map.

## T-10: Docs and persistence

- [x] T-10.1 Create canonical `locale-catalog-hierarchy` and `spanish-regional-detection` specs.
- [x] T-10.2 Extend `app-i18n`, `legal-content`, `legal-links` to five locales.
- [x] T-10.3 Fix `openspec/config.yaml` (valid YAML, `persistence: hybrid`, context update).
- [x] T-10.4 Archive this change with all artifacts + `archive-report.md`.

## T-11: Manual / owner gates (NON-BLOCKING)

- [ ] T-11.1 Device matrix — launch on es-AR / es-ES / es-419 / pt-BR / en simulators; live switch; cold-start override.
- [ ] T-11.2 Second Spain-native sign-off on `household.youSuffix` → `" (vosotros)"`.
- [ ] T-11.3 Project-wide governing-law legal decision (`legal.terms.sections.7.body` names Argentina in es-419/es-ES/en/pt-BR; es-AR inherits).

## Dependency order (historical note)

- T-6.1 (18 catalogs) — the original tracker said "17 catalogs"; corrected to 18 (AD-6).
- At the T-7.x apply outcome, 7 of the 18 `es-ES` files are `{}`.

## Acceptance (post-move, 2026-10-01)

- `pnpm typecheck` EXIT=0 · `pnpm test` EXIT=0 (55 harnesses) · `expo lint` EXIT=0 (0 errors / 55 warnings).
- catalog-parity 49/49 · detector 24/24 · onboarding-keys 7/7.
- Containment `28 requirements / 66 scenarios / MISSING=0` before and after the archive move.
- Git index 0 staged; branch `main` unchanged; 0 commits.
