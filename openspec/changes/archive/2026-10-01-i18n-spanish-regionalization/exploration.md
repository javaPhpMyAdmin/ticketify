# Exploration — i18n Spanish regionalization

## Problem

The three-locale model (`en` / `es-AR` / `pt-BR`) made Argentine Spanish the
Spanish source of truth and runtime fallback. Consequences observed:

- A device set to `es-MX`, `es-CO`, or any non-AR Spanish region rendered
  Rioplatense voseo (`vos`, `tenés`, `podés`) — a register those readers do
  not use.
- A device set to `es-ES` (Spain) likewise got Argentine vocabulary.
- There was no way to represent a Peninsular register (tuteo, `vosotros`,
  present-perfect compounds) at all.

## Options considered

1. **Add `es-ES` as a fourth full catalog, keep `es-AR` as default.**
   Rejected: keeps the "AR is the Spanish default" defect and triples the
   Spanish payload.
2. **Add `es-419` as a full base and keep `es-AR`/`es-ES` full copies.**
   Rejected: three full Spanish catalogs — large, and every English edit must
   be applied three times.
3. **Base + sparse overrides (chosen).** `es-419` full; `es-AR` and `es-ES`
   carry only divergent leaves, resolved through a per-language fallback
   chain. Minimal payload, one source of truth, regional register preserved.

## Findings that shaped the design

- The former `es-AR` full catalog could be promoted verbatim to `es-419`,
  then trimmed to the voseo subset — no retranslation needed.
- `legal` is a `returnObjects` namespace: a partial document tree truncates.
  `es-ES` therefore needs a complete legal deck even though it is sparse
  elsewhere (AD-2).
- The real namespace count is 18, not 17 — `categories` was added by
  `category-display-i18n` (AD-6).
- The Peninsular delta is small and mechanical: 42 non-legal leaves across 9
  namespaces (AD-5).

## Open questions (resolved in the specs)

1. Which regional Spanish locales ship? → `es-AR` and `es-ES` (the two
   registers with a real divergence set), on the `es-419` base.
2. What is the global fallback? → `en` for unsupported tags; `es-419` for
   any un-overridden Spanish tag.
