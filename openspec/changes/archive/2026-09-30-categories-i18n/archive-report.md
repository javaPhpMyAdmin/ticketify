# Archive report — categories i18n

## Change

Archived SDD change `categories-i18n`. Added the `categories` namespace (13
system category labels) across all locales and merged an `app-i18n` delta
(namespace parity; `NFR-8` by title).

## Merge results

- `openspec/specs/app-i18n/spec.md` extended with the `categories` namespace
  and the namespace-parity NFR (`NFR-8`, disambiguated by title).
- The `categories` namespace is the **18th** namespace, later re-affirmed by
  `i18n-spanish-regionalization` (AD-6).

## Gates

- `pnpm typecheck` EXIT=0; harness chain green.
- Key set matches `EXPENSE_CATEGORIES`; namespace present in every locale.

## Lessons

1. **A namespace added without a parity pin fails silently through the
   fallback chain.** Pin the namespace set, not just the values.
2. **Requirement-number collisions across independent changes are real.**
   `categories-i18n` and `i18n-spanish-regionalization` each produced an
   `app-i18n` `NFR-8`. Preserve both titles; number future NFRs forward;
   disambiguate by title.
3. **This change's neutral-Spanish bullet in `ux-charts-v2` was superseded**
   by the five-locale model — the same "preserve requirements, not false
   gates" class the later archive also hit.
