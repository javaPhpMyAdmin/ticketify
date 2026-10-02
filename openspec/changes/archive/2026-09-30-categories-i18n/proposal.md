# Proposal — categories i18n (13 system category labels)

> **Archived 2026-09-30.** Change `categories-i18n` shipped the `categories`
> namespace and was archived. See `archive-report.md`.

## Intent

The 13 system expense categories (`EXPENSE_CATEGORIES` in
`src/features/home/categories.ts`) rendered their labels from hardcoded
Spanish/English strings rather than the i18n catalog. This change adds a
dedicated `categories` namespace so the labels are locale-aware across every
shipped locale, and pins the namespace's presence so it cannot silently fall
out of one locale.

## Scope

In scope:

- New `categories` namespace with the 13 system category labels.
- The namespace shipped in **every** locale: full in `en`/`es-419`/`pt-BR`,
  and as a sparse `{}` override where a locale does not diverge.
- Category label call sites re-pointed at `t('categories.<key>')`.

Out of scope: user-created category names (free-form data, not catalog copy);
the `EXPENSE_CATEGORIES` taxonomy itself; category icons/colors.

## Approach

1. Define the 13-label `categories` namespace in the full catalogs.
2. Translate the 13 labels for each locale; where a locale has no divergence,
   ship `{}` and resolve through `es-419`.
3. Re-point the label call sites; add a harness pinning the namespace in all
   locales.

## Rollback

Revert the namespace files and the call-site re-points; no schema, no
migration. The hardcoded fallbacks remain in history.

## Note

This change independently produced an `NFR-8` in `app-i18n`, colliding by
number (not by title) with the `i18n-spanish-regionalization` NFR-8. Both
titles are preserved; disambiguate by title, never by number.
