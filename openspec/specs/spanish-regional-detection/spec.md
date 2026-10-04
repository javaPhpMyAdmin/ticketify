# Spanish Regional Detection Specification

## Purpose

Given a device locale, the app must decide which of its three Spanish
catalogs to activate — the neutral `es-419` base, the Rioplatense `es-AR`
override, or the Peninsular `es-ES` override — without asking the user and
without shipping European Portuguese or a regional variant the reader does
not speak. Detection is a pure function over a language tag and an optional
region code, with a global English fallback for anything unsupported.

This capability owns turning tags into locales. The register the resulting
catalog carries is owned by `locale-catalog-hierarchy` (shape) and `app-i18n`
(REQ-9 voseo).

## Requirements

### REQ-1: Detect one of five supported locales from a device tag

The system SHALL expose a pure function `detectLocale(languageTag, regionCode?)`
returning exactly one of `'en' | 'es-419' | 'es-AR' | 'es-ES' | 'pt-BR'`.
It SHALL be exported from `src/i18n/detector.ts`, free of module-level state
and of `Intl.*`, and unit-testable without React or the native bridge.

**Given/When/Then**:

1. Given `languageTag = 'pt-BR'`, When `detectLocale` runs, Then it returns `'pt-BR'`.
2. Given `languageTag = 'en-US'`, When `detectLocale` runs, Then it returns `'en'`.
3. Given `languageTag = 'es-419'`, When `detectLocale` runs, Then it returns `'es-419'`.
4. Given `languageTag = 'es-AR'`, When `detectLocale` runs, Then it returns `'es-AR'`.
5. Given `languageTag = 'es-ES'`, When `detectLocale` runs, Then it returns `'es-ES'`.

### REQ-2: Portuguese and English collapse to their single shipped variant

The app ships one Portuguese (`pt-BR`) and one English (`en`). Every
Portuguese tag SHALL map to `pt-BR` and every English tag to `en`,
regardless of region — including `pt-PT` and `en-GB`, for which no
European variant is shipped.

**Given/When/Then**:

1. Given `languageTag = 'pt-PT'`, When `detectLocale` runs, Then it returns `'pt-BR'`.
2. Given `languageTag = 'pt'`, When `detectLocale` runs, Then it returns `'pt-BR'`.
3. Given `languageTag = 'en-GB'`, When `detectLocale` runs, Then it returns `'en'`.
4. Given `languageTag = 'en'`, When `detectLocale` runs, Then it returns `'en'`.

### REQ-3: Spanish resolves by region against the `es-419` base

For a Spanish tag, the system SHALL resolve `AR` to `es-AR`, `ES` to
`es-ES`, and **everything else** — `419`, any other Latin-American region,
an unknown region, or a bare `es` — to the `es-419` base. A device that
speaks Spanish but not an overridden region SHALL get the neutral base, not
a region it does not speak for.

**Given/When/Then**:

1. Given `languageTag = 'es-MX'`, When `detectLocale` runs, Then it returns `'es-419'`.
2. Given `languageTag = 'es-CO'`, When `detectLocale` runs, Then it returns `'es-419'`.
3. Given `languageTag = 'es-US'`, When `detectLocale` runs, Then it returns `'es-419'`.
4. Given `languageTag = 'es'`, When `detectLocale` runs, Then it returns `'es-419'`.
5. Given `languageTag = 'es-XX'` (unknown region), When `detectLocale` runs, Then it returns `'es-419'`.

### REQ-4: Apple underscore tags and a separate `regionCode` are honored

The detector SHALL normalize underscores to hyphens and compare the region
case-insensitively, so `es_ES` and `es-ES` behave identically and
`pt_BR` behaves like `pt-BR`. When `regionCode` is supplied (iOS surfaces it
separately from the tag), it SHALL win over an inline region, so
`detectLocale('es', 'ES')` resolves to `es-ES` rather than the bare-tag
default.

**Given/When/Then**:

1. Given `languageTag = 'es_ES'`, When `detectLocale` runs, Then it returns `'es-ES'`.
2. Given `languageTag = 'es_ar'`, When `detectLocale` runs, Then it returns `'es-AR'`.
3. Given `languageTag = 'pt_BR'`, When `detectLocale` runs, Then it returns `'pt-BR'`.
4. Given `languageTag = 'es'` and `regionCode = 'ES'`, When `detectLocale` runs, Then it returns `'es-ES'` (explicit region wins).
5. Given `languageTag = 'es-419'` and `regionCode = 'AR'`, When `detectLocale` runs, Then it returns `'es-AR'` (explicit region wins over the inline base tag).

### REQ-5: Unknown and empty tags fall back to English

A missing language tag, an empty string, a tag with no language segment, or
any language the app does not ship SHALL resolve to `en`. This is the hard
guarantee: an unclassifiable device paints English, never a regional variant
the reader does not speak.

**Given/When/Then**:

1. Given `languageTag = undefined`, When `detectLocale` runs, Then it returns `'en'`.
2. Given `languageTag = ''`, When `detectLocale` runs, Then it returns `'en'`.
3. Given `languageTag = 'fr-FR'`, When `detectLocale` runs, Then it returns `'en'`.
4. Given `languageTag = 'de-DE'`, When `detectLocale` runs, Then it returns `'en'`.
5. Given `languageTag = '-x-private'` (no language segment), When `detectLocale` runs, Then it returns `'en'`.

### REQ-6: Regional viability gates the picker row

The system SHALL export `meetsRegionalViability(candidate, namespaces,
divergentNamespaces, leaves, divergentLeaves)` and the thresholds
`REGIONAL_NAMESPACE_VIABILITY = 0.75` and `REGIONAL_LEAF_VIABILITY = 0.65`.
A candidate SHALL be viable only when it clears **both** bars; the base
`es-419` SHALL always be viable; a non-Spanish candidate SHALL not be viable;
and degenerate inputs (zero namespaces or zero leaves) SHALL return false.

**Given/When/Then**:

1. Given at least 75% of namespaces and at least 65% of leaves diverge, When `meetsRegionalViability` runs for `es-ES`, Then it returns true.
2. Given fewer than 75% of namespaces diverge, When `meetsRegionalViability` runs, Then it returns false even if the leaf bar is met.
3. Given fewer than 65% of leaves diverge, When `meetsRegionalViability` runs, Then it returns false even if the namespace bar is met.
4. Given `candidate = 'es-419'`, When `meetsRegionalViability` runs with any counts, Then it returns true.
5. Given `candidate = 'pt-BR'`, When `meetsRegionalViability` runs, Then it returns false (not a Spanish regional).
6. Given `namespaces = 0` or `leaves = 0`, When `meetsRegionalViability` runs, Then it returns false (no divide-by-zero).

### REQ-7: Region-code resolution is one shared, pure contract

The system SHALL expose the region-resolution step used by both `detectLocale` and `detectDefaultCurrency`: it normalizes a BCP-47 or Apple tag (underscores to hyphens, case-insensitive), locates a region that is either two alpha characters or a three-digit UN M.49 code, skips private-use singletons, and lets an explicitly supplied `regionCode` win over any region inline in the tag. A tag carrying no region SHALL resolve to no region. The step SHALL be pure and free of `Intl.*`. It SHALL NOT be re-implemented per consumer.

(Previously: normalization existed only as private helpers (`splitTag`, `resolveRegion`) inside `detectLocale`, so a second consumer would have had to duplicate the parsing rules. This delta promotes the step to a named, assertable contract without changing any `detectLocale` behavior.)

> Source: change `currency-universality` (archived 2026-10-03). Merged from delta `openspec/changes/archive/2026-10-03-currency-universality/specs/spanish-regional-detection/spec.md`.

**Given/When/Then**:

1. Given `es_ES`, When the region resolver runs, Then it yields `ES` (case is normalized away).
2. Given `es`, When the region resolver runs, Then it yields no region.
3. Given `es-419`, When the region resolver runs, Then it yields `419` (a three-digit UN M.49 code is a region, not a variant).
4. Given `es-Ar-x-private`, When the region resolver runs, Then it yields `ar` (the private-use singleton is skipped).
5. Given `es-MX` with an explicit `regionCode` of `AR`, When the resolver runs, Then it yields `AR` (explicit region wins).
6. Given `undefined` or an empty tag, When the resolver runs, Then it yields no region.
7. Given `detectDefaultCurrency` consumes this resolver, When it is handed the tag `es_MX` with no explicit region, Then it derives `MX` from the tag and returns `MXN` — the same normalization, the same answer, no second parser.

## Non-Functional Requirements

### NFR-1: Purity and zero `Intl`/date dependencies

`detectLocale` and the viability helper SHALL be pure: no module-level
mutable state, no `Intl.*`, no `dayjs`, no `date-fns`, no native bridge.
The same inputs SHALL always yield the same output in Node and on device.

### NFR-2: Both BCP-47 and Apple tag dialects

Normalization SHALL accept BCP-47 (`es-AR`, `es-419`) and Apple
(`es_AR`, `es_ES`) separators in one code path; the region segment SHALL be
matched case-insensitively. A subtags-looking segment that is neither a
two-letter region nor a three-digit UN M.49 code (e.g. a private-use
singleton) SHALL be skipped when locating the region.

### NFR-3: One region resolver, two consumers

The region-resolution step SHALL have exactly one implementation. `detectLocale`
and `detectDefaultCurrency` MUST NOT each normalize regions independently, and
any change to normalization semantics SHALL be pinned by both harnesses.

> Source: change `currency-universality` (archived 2026-10-03). Merged from delta `openspec/changes/archive/2026-10-03-currency-universality/specs/spanish-regional-detection/spec.md`.

## Non-Goals

- This capability does NOT own the region → currency mapping table, the supported currency set, the symbol table, or the default-currency seed. Those live in `currency-universality`.
- `detectLocale` does NOT become region-driven. English and Portuguese stay un-regionalized by design (harness pin: `en-US` + region `AR` → `en`).

## Acceptance Gates

1. `scripts/test-i18n-detector.mjs` passes all mapping cases: `pt-BR`/`pt-PT` → `pt-BR`; `en-US`/`en-GB` → `en`; `es-AR` → `es-AR`; `es-ES` → `es-ES`; `es-MX`/`es-US`/bare `es` → `es-419`; `fr-FR`/empty/undefined → `en`.
2. The Apple-tag and explicit-`regionCode` cases pass.
3. `meetsRegionalViability` boundary cases pass at 75%/65%.
4. `grep -rn 'Intl\.' src/i18n/detector.ts` returns zero matches.
5. `pnpm typecheck` passes with the five-member `SupportedLocale` union.
6. The shared region resolver's cases pass for both consumers, and the `detectLocale` mapping table is byte-identical before and after `detectDefaultCurrency` ships (`en-GB` + region `GB` still resolves to `en`).

> Gate 6: change `currency-universality` (archived 2026-10-03). Added; no existing gate was renumbered.
