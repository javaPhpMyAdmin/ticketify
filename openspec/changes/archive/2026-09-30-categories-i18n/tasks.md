# Tasks — categories i18n

- [x] C-1 Add the `categories` namespace (13 system category labels) to `en`.
- [x] C-2 Translate the 13 labels for `es-419`, `es-AR`, `es-ES`, `pt-BR`.
- [x] C-3 Ship `{}` for any locale without a divergence; resolve via `es-419`.
- [x] C-4 Re-point category label call sites at `t('categories.<key>')`.
- [x] C-5 Harness: pin the namespace in all locales and diff the key set against `EXPENSE_CATEGORIES`.
- [x] C-6 Typecheck / lint / test green.

## Acceptance

- The 13 labels render locale-aware on every category surface.
- `categories.json` exists in all five locales; the key set matches the taxonomy.
- `pnpm typecheck` and the harness chain pass.
