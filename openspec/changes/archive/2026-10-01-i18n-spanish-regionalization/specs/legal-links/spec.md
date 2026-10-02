# Delta — legal-links (five-locale modification)

> Delta merged into `openspec/specs/legal-links/spec.md` at archive time
> (2026-10-01): 4 MODIFIED.

## MODIFIED Requirements

### REQ-2: Locale-aware legal URL map

Five `AppLocale` values (`en`, `es-419`, `es-AR`, `es-ES`, `pt-BR`); fallback
to the `es-419` URL for a missing/unsupported locale. (was: three locales,
`es-AR` fallback.)

### REQ-5: i18n catalog parity

Legal keys in all five catalogs (`es-419` source; `es-AR`/`es-ES` sparse).
(was: three catalogs.)

### REQ-6: Test harness

Five-catalog parity; `LEGAL_URLS` two documents × five locales. (was: three.)

### REQ-7: Real hosted URLs and release gate

Ten hosted Pages URLs. (was: six.)

## Note

> The `es-ES` legal deck is a complete Peninsular override, not a reuse of the
> `es-419` base (design AD-2 supersedes the interpretation note that once
> appeared here). The archive phase corrected the count and the fallback
> before merging.
