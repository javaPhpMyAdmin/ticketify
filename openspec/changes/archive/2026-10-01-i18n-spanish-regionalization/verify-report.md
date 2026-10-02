# Verify report — i18n Spanish regionalization

## Verdict

**FAIL (procedural) — revision 2.** The SUBSTANCE was verified sound; the
failure was tracker state and two stale code comments, not rework. Remediation
brought the change to PASS-after-remediation (see below).

## What was verified sound

- Five locale directories present; each ships exactly 18 `.json` namespaces.
- `es-419` totals 787 leaves; `es-AR` 65; `es-ES` 122 (42 non-legal + 73 legal
  + 7 `settingsLanguage`).
- `config.ts` imports all five locales; per-language `fallbackLng` map matches
  `detector.ts:FALLBACK_CHAIN`.
- Zero `typeof esAR`; 15 `typeof es419` derivations in `types.ts`.
- `pnpm typecheck` EXIT=0.
- `es-ES` has ZERO voseo across all 122 leaves.

## Blockers (revision 2)

### CRITICAL

1. Four CORE tasks left unticked in `tasks.md` — T-6.1, T-6.2, T-6.3, T-6.4
   (`[ ]` → `[x]`), with the namespace count corrected 17 → 18.
2. Two stale/false comments in `src/i18n/config.ts`:
   - `:146` labelled the `es-ES` legal deck "a full tuteo / override".
   - `:190` claimed both regional locales ship the full 7-row
     `settingsLanguage` picker labels, but `es-AR/settingsLanguage.json` is
     `{}` (zero-copy), pinned by `test-i18n-settings-language.mjs:183`.

### WARNING

3. `tasks.md` still carried a 17-namespace world in its dependency-order line.
4. `openspec/config.yaml` declared no persistence mode and still said
   "es-AR source of truth".

## Remediation

- Ticked T-6.1–T-6.4 and corrected all count claims on those lines to 18.
- Rewrote both `config.ts` comments to match the artifact: the legal deck is a
  "Peninsular-register override" with no `vosotros`, and `settingsLanguage`
  has a single exception (`es-ES`), byte-identical to the base.
- Declared `persistence: hybrid` in `openspec/config.yaml` and made the file
  valid YAML (the `rules.apply` block had mixed a sequence item with mapping
  keys since 2026-08-04, so the file had not parsed for six weeks).
- Fixed the app-i18n specs to the five-locale reality and archived the change.

## Post-remediation gate results (run 2026-10-01)

- `pnpm typecheck` EXIT=0 · `pnpm test` EXIT=0 (55 harnesses) · `expo lint`
  EXIT=0 (0 errors / 55 warnings).
- catalog-parity 49/49 · detector 24/24 · onboarding-keys 7/7.
- Containment `28 requirements / 66 scenarios / MISSING=0`.

## Carried forward (non-blocking)

- T-11.1 device matrix — manual by construction.
- T-11.2 second Spain-native sign-off on `household.youSuffix` →
  `" (vosotros)"`.
- T-11.3 project-wide governing-law decision.
