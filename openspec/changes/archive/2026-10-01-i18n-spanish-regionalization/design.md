# Design — i18n Spanish regionalization

## Architecture Decisions

### AD-1: `es-419` is the Spanish base and runtime default; `es-AR` is an override

The former model treated `es-AR` as the Spanish source of truth and the
runtime fallback. That forces Rioplatense voseo onto every non-Argentine
Spanish reader. We promote `es-419` (the UN M.49 "Latin America, Spanish"
code) to the base: it is the catalog every Spanish device can read without
being mis-addressed. `es-AR` becomes a sparse override on top of it. The
runtime default active locale (with `override: 'auto'`) is `es-419`, and the
global fallback for unsupported tags is `en`.

### AD-2: The `es-ES` legal deck is a COMPLETE 73-leaf Peninsular override, not a reuse

`legal` is a `returnObjects` namespace: its document tree is read with
`returnObjects: true`, and a partial `sections` array silently truncates the
document rather than falling back per-section. So `es-ES` MUST carry the full
73-leaf `legal` deck. `es-AR`, which has no `terms`/`privacy` override, is
`absent` for all five `returnObjects` containers and inherits the base. This
supersedes the interpretation note in the change delta's `legal-content`
spec that claimed the `es-ES` deck reuses the `es-419` base. The two
hash-pinned `es-ES` divergences — `legal.privacy.sections.1.body` and
`legal.terms.sections.5.body` — are exactly the leaves this AD's audit
flagged and fixed.

### AD-3: Per-language `fallbackLng`, not a single fallback

i18next supports a per-language fallback map. We use it so `es-AR` and
`es-ES` inherit the BASE (`es-419`) before `en`; a key a region legitimately
omits reads as neutral Spanish, never English. The map is mirrored verbatim
in `detector.ts:FALLBACK_CHAIN` and `config.ts:initI18n`, and pinned equal by
the parity harness.

```
en      → ['en']
es-419  → ['en']
es-AR   → ['es-419', 'en']
es-ES   → ['es-419', 'en']
pt-BR   → ['en']
```

### AD-4: Sparse overrides, with named exceptions

A regional namespace with zero divergent leaves ships `{}`. The 7
Peninsular-empty namespaces (`a11y`, `bootSplash`, `categories`, `common`,
`currency`, `date`, `tabs`) have no genuine Peninsular divergence and are
pinned BY NAME. Two deliberate non-`{}` exceptions exist:
`es-ES/legal.json` (complete `returnObjects` deck, AD-2) and
`es-ES/settingsLanguage.json` (the 7 picker endonyms, byte-identical to
`es-419`). `es-AR/settingsLanguage.json` is `{}` and resolves all seven
labels through the base.

### AD-5: Register is regionalized, not the whole catalog

Venue: the app's five locales differ by **register**, not by content. The
divergences are (a) voseo/tuteo second person, (b) present-perfect vs bare
preterite compounds, (c) a small Peninsular lexicon. The `es-ES` non-legal
delta is exactly 42 leaves across 9 namespaces: 30 perfect compounds
(`no se pudo` → `no se ha podido`), 6 lexicon swaps (`agregar`→`añadir`,
`Pedile`→`Pídele`, `es inválido`→`no es válido`, `expiró`→`ha expirado`,
`montos`→`importes`, `reportes`→`informes`), and 6 first/second-person
compounds (`no pudimos`→`no hemos podido`, `uniste`/`ocultaste`→`has`/`ha`
compound). The one genuine `vosotros` slot is `household.youSuffix`
(`" (vosotros)"`); Spanish legal register is `usted`/impersonal and has no
plural-addressee slot, so zero `vosotros` in `legal.json` is a finding, not a
gap.

### AD-6: The catalog has EIGHTEEN namespaces, not seventeen

`categories` arrived with the `category-display-i18n` work (the 13 system
category labels) and is the 18th namespace. All five locales ship exactly 18
`.json` files; the parity harness pins the count so a namespace added to one
locale and not the others fails loudly instead of silently resolving through
the fallback chain.

### AD-7: `returnObjects` containers

There are 5 `returnObjects` containers (`legal.privacy.sections`,
`legal.terms.sections`). A container is present/absent as a unit; it is never
deep-merged from a fragment onto the base.

## Sequence — boot and resolution

```
boot
 └─ I18nProvider mounts
     ├─ useLocaleStore hydrates: read SecureStore override
     │    ├─ override ∈ {en,es-419,es-AR,es-ES,pt-BR} → activeLocale = override
     │    └─ override = 'auto' | null | tampered → detectLocale(device tag)
     ├─ config.ts initI18n({ fallbackLng: FALLBACK_LNG, supportedLngs: 5 })
     └─ i18n.isInitialized === true → BootSplash fades
```

`detectLocale(tag, regionCode?)`:

```
pt-*            → pt-BR
en-*            → en
es-*  region AR → es-AR
es-*  region ES → es-ES
es-*  otherwise → es-419   (base)
anything else   → en       (global fallback)
```

## Risks

1. **Truncated legal deck** if `es-ES/legal.json` were made sparse (AD-2).
   Mitigated: complete deck + hash-pinned divergences.
2. **Register leak** — Rioplatense forms in `es-419`/`es-ES`, or Peninsular
   forms in `es-419`/`es-AR`/`en`. Mitigated by the anti-leak pins.
3. **Bundle growth** from a naive three-full-copies scheme. Mitigated by the
   sparse model (AD-4).
4. **Stale prose** — code comments and tracker counts asserting a
   17-namespace or three-locale world. Mitigated by the parity harness pinning
   the real counts; prose remains a residual audit risk.
