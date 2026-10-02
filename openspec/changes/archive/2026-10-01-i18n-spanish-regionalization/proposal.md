# Proposal — i18n Spanish regionalization (five locales)

> **Archived 2026-10-01.** Change `i18n-spanish-regionalization` shipped and was
> archived. Canonical specs live under `openspec/specs/`; see
> `archive-report.md` for the merge history and open manual gates.

## Intent

CoronaTracker currently ships three locales — `en`, `es-AR` (Rioplatense,
default and fallback), `pt-BR` — with `es-AR` acting as the Spanish source of
truth. That is wrong for every Spanish-speaking reader who is not Argentine:
a device set to `es-MX` or `es-CO` currently receives Rioplatense voseo, and a
device set to `es-ES` (Spain) receives Argentine vocabulary. Meanwhile a real
Peninsular register (tuteo, `vosotros`, present-perfect compounds, `añadir` /
`importes` / `informes` lexicon) has no home in the catalog at all.

This change replaces the three-locale model with a **base + sparse-override
hierarchy of five locales**:

- `es-419` — neutral Latin-American Spanish. THE Spanish base, source of
  truth, and runtime default.
- `es-AR` — Rioplatense voseo, as a **sparse override** carrying only the
  leaves that diverge from `es-419`.
- `es-ES` — Peninsular Spanish, as a **sparse override** on the same base.
- `en` and `pt-BR` — full catalogs, unchanged in shape.

## Scope

In scope:

- New `es-419` base catalog (18 namespaces / 787 leaves), promoted from the
  former `es-AR` full catalog.
- `es-AR` reduced to its 65-leaf voseo override; `es-ES` introduced as a
  sparse Peninsular override (42 non-legal divergences + a complete 73-leaf
  `legal` deck).
- Per-language `fallbackLng` chains (`es-AR → es-419 → en`,
  `es-ES → es-419 → en`).
- Device-locale detection for the two regional Spanish variants, with Apple
  underscore-tag and `regionCode` support.
- A Settings language picker with six options (auto + five locales).
- A catalog-parity harness pinning the five-locale shape, the sparse
  invariants, and the regional leaf values.

Out of scope (recap): grammatical-gender selectors; backend strings;
right-to-left languages; `Intl.*` / `dayjs` / `date-fns`; a first-run
onboarding language picker; the `format.ts` MONTHS mapping (documented
design, not a bug); changing the default currency code.

## Approach

1. Introduce `es-419` by promoting the former `es-AR` full catalog.
2. Reduce `es-AR` to the divergent voseo leaves; add `es-ES` as a sparse
   Peninsular override; keep `legal` a complete `returnObjects` deck in
   `es-ES` (a partial section array silently truncates).
3. Rewrite `detector.ts` for five locales with region-aware Spanish
   resolution and an English global fallback; export `FALLBACK_CHAIN`.
4. Configure `config.ts` `RESOURCES` for 18 namespaces × five locales and the
   per-language `fallbackLng` map; re-point the typed derivations off `es-AR`
   onto the base.
5. Add the parity harness and wire it into `pnpm test`.

## Rollback plan

The change is data + a small pure-function surface. Rollback = revert the
locale directories and `detector.ts`/`config.ts` to the three-locale state and
drop the parity script; no schema, no migration, no remote state. Device
override values are a closed union, so a stale `'es-ES'` override reads back
as "no override" and the device locale wins.
