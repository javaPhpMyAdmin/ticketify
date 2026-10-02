# Delta — spanish-regional-detection (ADDED capability)

> Delta merged into `openspec/specs/spanish-regional-detection/spec.md` at
> archive time (2026-10-01). 6 requirements, 23 scenarios. Both proposal open
> questions resolved here.

## ADDED Requirements

### REQ-1: Detect one of five supported locales

`detectLocale(languageTag, regionCode?)` SHALL be pure and return one of
`'en' | 'es-419' | 'es-AR' | 'es-ES' | 'pt-BR'`.

### REQ-2: Portuguese and English collapse to their single variant

Every `pt-*` → `pt-BR`; every `en-*` → `en` (including `pt-PT`, `en-GB`).

### REQ-3: Spanish resolves by region against the `es-419` base

`AR` → `es-AR`; `ES` → `es-ES`; everything else Spanish (`419`, other LATAM
regions, bare `es`, unknown) → `es-419`.

### REQ-4: Apple underscore tags and separate `regionCode`

Underscores normalize to hyphens; region compares case-insensitively; an
explicit `regionCode` wins over an inline region.

### REQ-5: Unknown and empty tags fall back to English

`undefined`, `''`, no language segment, or any unsupported language → `en`.

### REQ-6: Regional viability gates the picker row

`meetsRegionalViability(...)` with
`REGIONAL_NAMESPACE_VIABILITY = 0.75` and `REGIONAL_LEAF_VIABILITY = 0.65`;
base `es-419` always viable; non-Spanish not viable; degenerate inputs false.

## ADDED Non-Functional Requirements

### NFR-1: Purity and zero `Intl`/date dependencies

Pure function; no module-level state; no `Intl.*` / `dayjs` / `date-fns`.

### NFR-2: Both BCP-47 and Apple tag dialects

One code path handles `es-AR` and `es_AR`; private-use singletons are skipped
when locating the region.

## Resolved open questions

1. Which Spanish regions ship? → `es-AR` and `es-ES` on the `es-419` base.
2. Global fallback? → `en`; un-overridden Spanish → `es-419`.
