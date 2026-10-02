# Apply progress — categories i18n

## Summary

Added the `categories` namespace (13 system category labels) across all
locales and re-pointed the label call sites at `t('categories.<key>')`.

## Results

- `categories.json` ships in every locale.
- Key set matches the 13 `EXPENSE_CATEGORIES` keys.
- Category surfaces render locale-aware labels.
- `pnpm typecheck` EXIT=0; harness chain green.

## Learned

- **This change independently produced an `NFR-8` in `app-i18n`**, colliding by
  number with the later `i18n-spanish-regionalization` NFR-8. Renumbering the
  older one would invalidate references across two archived reports, so both
  titles are preserved and future NFRs are numbered FORWARD. Disambiguate by
  title, never by number.
- A namespace added to one locale and not the others fails silently through
  the fallback chain unless the harness pins the namespace set — which is why
  the parity harness pins the count.

## No git mutation

Docs and catalogs only; no commit in this phase.
