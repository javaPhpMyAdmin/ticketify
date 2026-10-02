# Delta — legal-content (five-locale modification)

> Delta merged into `openspec/specs/legal-content/spec.md` at archive time
> (2026-10-01): 2 MODIFIED + 1 ADDED.

## MODIFIED Requirements

### Requirement: Localized Content Parity

Five catalogs; `es-419` source of truth; `es-AR`/`es-ES` sparse overrides
resolving inherited leaves through the base. A regional override MUST contain
every leaf it diverges on and MUST NOT add a leaf absent from `es-419`. (was:
three catalogs, `es-AR` source of truth.)

### Requirement: Hosted Markdown Mirror

Ten mirrors — both documents × five locales — emitted from the RESOLVED
catalog (`locale → es-419 → en`). (was: six mirrors, three locales.)

## ADDED Requirement

### Requirement: Sparse override resolution

`es-AR` carries only its divergent `legal` leaves and inherits the rest from
`es-419`; `es-ES` carries the complete 73-leaf deck because `legal` is a
`returnObjects` namespace.
