# Delta — locale-catalog-hierarchy (ADDED capability)

> Delta merged into `openspec/specs/locale-catalog-hierarchy/spec.md` at
> archive time (2026-10-01). 7 requirements + payload NFR, 21 scenarios.

## ADDED Requirements

### REQ-1: Five-locale catalog with `es-419` as the Spanish root

The system SHALL ship exactly five locales — `en`, `es-419`, `es-AR`,
`es-ES`, `pt-BR` — under `src/i18n/locales/{tag}/`, one JSON file per
namespace. `es-419` SHALL be the source of truth for Spanish; regional
variants SHALL NOT introduce a key absent from the base. `en` and `pt-BR`
SHALL be full catalogs.

### REQ-2: Sparse override model

`es-AR` and `es-ES` SHALL carry only leaves that diverge from `es-419`; a
namespace with no divergence SHALL be `{}`. Two deliberate exceptions:
`es-ES/legal.json` (complete `returnObjects` deck) and
`es-ES/settingsLanguage.json` (byte-identical to the base).

### REQ-3: Per-locale fallback chains

`fallbackLng` SHALL be per-language: `en → ['en']`, `es-419 → ['en']`,
`es-AR → ['es-419','en']`, `es-ES → ['es-419','en']`, `pt-BR → ['en']`.
`detector.ts:FALLBACK_CHAIN` and `config.ts` SHALL be identical.

### REQ-4: Base completeness is enforced

Every key in `es-AR` and `es-ES` SHALL exist in `es-419` (zero orphans), and
the parity harness SHALL assert it.

### REQ-5: Namespace set is uniform across locales

All five locales SHALL ship **18** namespaces (including `categories`). The
parity harness SHALL pin the count.

### REQ-6: `returnObjects` containers are copied whole

Containers SHALL be present/absent as a unit and read with `returnObjects:
true`; no deep-merge from a fragment.

### REQ-7: The hierarchy is data, not code

Inheritance SHALL be declared as data (`FALLBACK_CHAIN`, `SPANISH_LOCALES`,
`SPANISH_BASE`) consumed by init, detector, and harness. No `Intl.*` /
`dayjs` / `date-fns`.

## ADDED Non-Functional Requirements

### NFR-1: Payload budget of the sparse hierarchy

The two extra Spanish catalogs SHALL add only their divergent leaves (≈42
Peninsular + 65 Rioplatense), not a second and third full catalog.

### NFR-2: No orphaned or dangling namespace files

A `.json` file SHALL correspond to a registered namespace and vice versa in
every locale.
