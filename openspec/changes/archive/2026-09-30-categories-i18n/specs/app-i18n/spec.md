# Delta — app-i18n (categories namespace)

> Delta merged into `openspec/specs/app-i18n/spec.md` at archive time
> (2026-09-30).

## ADDED Requirements

### REQ-14: `categories` namespace (13 system category labels)

The catalog SHALL ship a `categories` namespace holding the 13
`EXPENSE_CATEGORIES` labels, present in every locale (full or sparse `{}`),
with the key set matching the taxonomy.

## ADDED Non-Functional Requirements

### NFR-8: Namespace parity for `categories`

The `categories` namespace SHALL be present in every locale and pinned by the
harness so a namespace added to one locale and not the others fails loudly.

> Title collides by number with `i18n-spanish-regionalization`'s NFR-8;
> disambiguate by title.
