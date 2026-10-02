# Apply progress — i18n Spanish regionalization

## Summary

Five locales in a base + sparse-override hierarchy. `es-419` (18 namespaces /
787 leaves) is the Spanish base and runtime default; `es-AR` is a 65-leaf
voseo override; `es-ES` is a sparse Peninsular override (42 non-legal
divergences + a complete 73-leaf `legal` deck); `en` and `pt-BR` are
unchanged full catalogs.

## Key results

- **T-8.1** — 42 non-legal Peninsular divergences across 9 namespaces
  (`analytics`, `auth`, `errors`, `household`, `onboarding`, `pro`,
  `receipts`, `settings`, `tickets`): 30 perfect compounds
  (`no se pudo` → `no se ha podido`), 6 lexicon swaps (`agregar`→`añadir`,
  `Pedile`→`Pídele`, `es inválido`→`no es válido`, `expiró`→`ha expirado`,
  `montos`→`importes`, `reportes`→`informes`), 6 person compounds
  (`no pudimos`→`no hemos podido`, `uniste`/`ocultaste`→`has`/`ha`).
- **T-8.2** — leaf-by-leaf audit of all 73 `es-ES/legal.json` leaves found the
  deck already Peninsular; 2 real defects fixed: (1) a pasted English
  fragment `faced interrupciones` in `terms.sections.5.body`; (2)
  `privacy.sections.1.body` used LATAM bare preterite `nos confirma la
  compra` instead of `nos ha confirmado la compra`.
- **7 Peninsular-empty namespaces** pinned by name: `a11y`, `bootSplash`,
  `categories`, `common`, `currency`, `date`, `tabs`.
- **Tier-3 pins** added to `test-i18n-catalog-parity.mjs` (44 → 49 tests):
  sparse shape + empty-namespace list, 42 value hashes, the `vosotros` count,
  the `es-AR` anti-leak direction, and the legal register pins + pasted
  fragment scan.

## Verification (real exit codes)

| Command | Result | Exit |
|---|---|---|
| `pnpm test` (full chain) | all harnesses pass | 0 |
| `pnpm typecheck` | 0 errors | 0 |
| `pnpm lint` | 0 errors, 55 pre-existing warnings | 0 |
| `test:i18n-catalog-parity` | 49 passed, 0 failed | 0 |
| `test:i18n-detector` | 24 passed, 0 failed | 0 |
| `test:legal-content` | 42 passed, 0 failed | 0 |
| `test:legal-links` | 35 passed, 0 failed | 0 |
| `test:legal-consent` | 40 passed, 0 failed | 0 |

Legal mirrors byte-identical across two consecutive generator runs. Zero
voseo hits across all 122 `es-ES` leaves. No git mutation.

## Deviations

- The brief asked to describe the `es-ES` legal deck as "vosotros + perfect
  compounds". `legal.json` has zero `vosotros` by design (Spanish legal
  register is `usted`/impersonal). The comment now names where the one
  genuine `vosotros` slot actually lives (`household.youSuffix`) instead of
  repeating a false claim.
- The brief's suggested `auth.signUpLegalAnd` → `y` rather than `e` was
  rejected: it already is `y` and `test-legal-links.mjs:301` pins it.

## Residual / open (non-blocking)

- `tasks.md` dependency-order line and this archive carry the corrected
  18-namespace count; any remaining "17" prose is stale.
- Device matrix (T-11.1), second Spain-native sign-off (T-11.2), and the
  project-wide governing-law decision (T-11.3) remain open.
