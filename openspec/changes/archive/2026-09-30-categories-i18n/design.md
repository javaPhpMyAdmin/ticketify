# Design — categories i18n

## Architecture Decisions

### AD-1: A dedicated namespace, not keys folded into `home`

The 13 labels are read from multiple screens (home category list, budget
screens, charts, drill-downs). A dedicated `categories` namespace keeps them
in one place and lets the parity harness pin it independently of the `home`
feature surface.

### AD-2: The namespace is uniform across locales

`categories.json` SHALL exist in every locale. Where a locale does not diverge
from the `es-419` base, it ships `{}` and resolves through the fallback chain;
where it diverges, it carries only the divergent labels. This is the same
sparse-override model the regional Spanish catalogs use.

### AD-3: The taxonomy stays in code

`EXPENSE_CATEGORIES` (keys, ordering, icons, colors) remains in
`src/features/home/categories.ts`; only the human-readable label moves to the
catalog. The catalog key set is derived from the taxonomy, not duplicated.

## Risks

1. A locale missing `categories.json` resolves every label through the
   fallback chain. Mitigated by the harness pinning the namespace in all
   locales.
2. Label-key drift if the taxonomy gains a category without a catalog key.
   Mitigated by the harness diffing the key set against the taxonomy.

## NFR

### NFR-8 (app-i18n): Namespace parity

The `categories` namespace SHALL be present in every locale and pinned by the
harness. (Title-collides by number with the later
`i18n-spanish-regionalization` NFR-8; disambiguate by title.)
