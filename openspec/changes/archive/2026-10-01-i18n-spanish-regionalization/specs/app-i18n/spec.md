# Delta — app-i18n (five-locale modification)

> Delta merged into `openspec/specs/app-i18n/spec.md` at archive time
> (2026-10-01): REQ-1/2/3/9/13 MODIFIED; NFR-1/4 MODIFIED; NFR-8/NFR-9 ADDED.

## MODIFIED Requirements

### REQ-1: Locale catalog and namespace structure

Five locales `en`, `es-419`, `es-AR`, `es-ES`, `pt-BR`; `es-419` is the
Spanish base and runtime default; 18 namespaces per locale; sparse regional
overrides. (was: three locales, `es-AR` default/fallback.)

### REQ-2: Device locale detection and fallback mapping

`pt-*` → `pt-BR`; `en-*` → `en`; `es-*` region `AR` → `es-AR`, region `ES` →
`es-ES`, otherwise → `es-419`; unsupported → `en`. Full contract in
`spanish-regional-detection`. (was: unsupported → `es-AR`.)

### REQ-3: Manual override, persistence, and active language resolution

Six options (auto + five locales); override union
`'auto' | 'en' | 'es-419' | 'es-AR' | 'es-ES' | 'pt-BR'`; tampered values
read back as no override. (was: four options, three concrete locales.)

### REQ-9: Regional second-person register (voseo / vosotros / tuteo)

`PLURAL_SECOND_PERSON`: `es-AR` → `" (vos)"`, `es-ES` → `" (vosotros)"`;
`household.youSuffix` carries the same. (was: voseo only.)

### REQ-13: Long-tail coverage and consolidations (PR 3)

Five-locale parity (was: three locales).

## MODIFIED Non-Functional Requirements

### NFR-1: Bundle size

Budget holds across five locales because the regional catalogs are sparse.

### NFR-4: Typecheck and harness tests

Detector cases cover `es-ES → es-ES`, `es-MX → es-419`, bare `es → es-419`,
`fr-FR → en`; plus the catalog-parity harness.

## ADDED Non-Functional Requirements

### NFR-8: Five-locale catalog integrity

All locales ship the same 18 namespaces; the parity harness pins it.

### NFR-9: Regional register isolation

Rioplatense register only in `es-AR`; Peninsular register only in `es-ES`;
neither leaks into `es-419`/`en`/`pt-BR`.
