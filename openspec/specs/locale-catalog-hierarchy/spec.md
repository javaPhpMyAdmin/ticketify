# Locale Catalog Hierarchy Specification

## Purpose

Ticketify mobile ships **five** locales. Rather than five full copies of the
catalog, the Spanish side is a **base + sparse overrides** hierarchy:
`es-419` (neutral Latin-American Spanish) is the single source of truth and
the root every regional Spanish variant inherits from; `es-AR` (Rioplatense
voseo) and `es-ES` (Peninsular, with `vosotros`) carry **only the leaves that
genuinely diverge** and defer everything else to the base through i18next's
per-language `fallbackLng` chain.

This capability owns the *shape* of that hierarchy — which locale is the
root, which locales are sparse, how a missing leaf resolves, and how the
catalog stays internally consistent as namespaces are added. Runtime
detection of which Spanish variant a device speaks belongs to
`spanish-regional-detection`; the register of the diverging leaves belongs to
`app-i18n` (REQ-9, voseo) and `spanish-regional-detection` (Peninsular).

## Requirements

### REQ-1: Five-locale catalog with `es-419` as the Spanish root

The system SHALL ship exactly five locales — `en`, `es-419`, `es-AR`,
`es-ES`, `pt-BR` — each as a directory under `src/i18n/locales/{tag}/`
containing one JSON file per namespace. `es-419` SHALL be the source of
truth for Spanish: every leaf that any Spanish variant is allowed to load
SHALL exist in `es-419`, and the regional variants SHALL NOT introduce a key
that is absent from the base. `en` and `pt-BR` SHALL each be full,
self-contained catalogs.

**Given/When/Then**:

1. Given the repository at rest, When `src/i18n/locales/` is listed, Then it contains exactly the five directories `en`, `es-419`, `es-AR`, `es-ES`, `pt-BR`.
2. Given any leaf key present in `es-AR` or `es-ES`, When `es-419` is inspected, Then the same key exists there (regional catalogs add no keys the base lacks).
3. Given `src/i18n/config.ts:SUPPORTED_LOCALE_TAGS`, When it is read, Then it equals `['en','es-419','es-AR','es-ES','pt-BR']` in that order.

### REQ-2: Sparse override model

`es-AR` and `es-ES` SHALL be **sparse**: a namespace MAY be an empty object
`{}` when none of its leaves diverge from `es-419`, and the file SHALL
contain only the leaves that differ. A regional file SHALL NOT be a full
copy of the base. A leaf whose value is byte-identical to `es-419` SHALL NOT
be duplicated into a regional file unless a later requirement explicitly
carries it (e.g. `es-ES/settingsLanguage.json`, which is byte-identical by
design so the language-picker row resolves without crossing a fallback
boundary).

**Given/When/Then**:

1. Given `es-AR`, When its leaf count is compared to `es-419`, Then it carries strictly fewer leaves (the voseo subset).
2. Given `es-ES`, When its leaf count is compared to `es-419`, Then it carries strictly fewer leaves (the Peninsular subset).
3. Given a regional namespace with zero divergent leaves, When the file is read, Then it parses to `{}` and contributes no bundle weight beyond the empty object.
4. Given `es-ES/common.json`, When its keys are counted, Then it is `{}` because no `common` leaf diverges between Peninsular and neutral Spanish.

### REQ-3: Per-locale fallback chains

The system SHALL configure a **per-language** `fallbackLng` map so that a
missing leaf resolves through the correct inherited catalog before reaching
English. The chains SHALL be exactly: `en → ['en']`,
`es-419 → ['en']`, `es-AR → ['es-419','en']`,
`es-ES → ['es-419','en']`, `pt-BR → ['en']`. The detector's exported
`FALLBACK_CHAIN` and `config.ts`'s `initI18n` map SHALL be identical.

**Given/When/Then**:

1. Given the active locale is `es-ES` and a leaf exists only in `es-419`, When `t(key)` runs, Then it returns the `es-419` value — not the `en` value.
2. Given the active locale is `es-AR` and a leaf exists only in `en`, When `t(key)` runs, Then it returns the `en` value.
3. Given `es-419` has a leaf that `en` lacks, When the active locale is `es-419`, Then no fallback is consulted.
4. Given `detectLocale`'s `FALLBACK_CHAIN`, When it is compared to the map passed to `initI18n`, Then the two objects are deeply equal.

### REQ-4: Base completeness is enforced, not assumed

A key SHALL be considered *shippable in Spanish* only if it exists in
`es-419`. Adding a leaf to `en` SHALL NOT be treated as adding it to Spanish;
the base MUST be updated in the same change. The parity harness SHALL assert
that every key in `es-AR` and `es-ES` exists in `es-419` (zero orphans).

**Given/When/Then**:

1. Given `es-AR` and `es-ES`, When every key is looked up in `es-419`, Then zero keys are missing from the base.
2. Given a new English leaf added with no `es-419` counterpart, When the parity harness runs, Then it reports the orphan rather than silently resolving to English for Spanish readers.
3. Given `en` and `pt-BR`, When their key sets are compared, Then neither is modeled as an override — each is a complete catalog.

### REQ-5: Namespace set is uniform across locales

All five locales SHALL ship the same namespace set. The system SHALL ship
**eighteen** namespaces: `common`, `tabs`, `settingsLanguage`, `auth`,
`settings`, `tickets`, `receipts`, `household`, `analytics`, `errors`,
`a11y`, `currency`, `date`, `pro`, `legal`, `onboarding`, `bootSplash`, and
`categories`. A namespace added to one locale SHALL be added to all five (an
empty `{}` where it does not diverge), and the parity harness SHALL pin the
count so drift fails loudly.

**Given/When/Then**:

1. Given the repository, When each locale directory is listed, Then each contains exactly 18 `.json` namespace files.
2. Given the namespace list, When `src/i18n/config.ts` is read, Then the registered namespace names match the on-disk filenames for all five locales.
3. Given `categories` (the 13 system category labels), When it was added, Then all five locales received a `categories.json` — four full, and any sparse override as `{}` where non-divergent.

### REQ-6: `returnObjects` containers are copied whole, never deep-merged

Some namespaces contain **container** nodes whose children are objects and
arrays rather than scalar leaves (the `legal` document tree is the canonical
case). i18next's fallback SHALL be treated as resolving at the leaf level
only for scalar keys; container nodes SHALL be present in every locale that
needs them, and a regional override SHALL NOT rely on merging a container
fragment onto the base. Consumers SHALL read these containers with
`returnObjects: true`.

**Given/When/Then**:

1. Given `legal.terms.sections`, When read in any of the five locales, Then `returnObjects: true` yields the full section array — never a partially merged one.
2. Given a regional `legal` file, When it diverges, Then it carries the complete document tree it needs, not a fragment intended to be spread onto `es-419`.
3. Given the parity harness, When it compares container keys, Then it treats a container as present/absent as a unit rather than leaf-by-leaf.

### REQ-7: The hierarchy is data, not code

Which locale inherits from which SHALL be declared as data (the
`FALLBACK_CHAIN` map and `SUPPORTED_LOCALES`/`SPANISH_LOCALES` arrays) and
consumed by `initI18n`, the detector, and the parity harness. Adding a
sixth locale SHALL require editing that data plus adding its directory — not
touching rendering code. No `Intl.*`, `dayjs`, or `date-fns` SHALL be
introduced to manage the hierarchy.

**Given/When/Then**:

1. Given `SPANISH_LOCALES`, When it is read, Then it is `['es-419','es-AR','es-ES']` with the base first.
2. Given `SPANISH_BASE`, When it is read, Then it is `'es-419'`.
3. Given `grep -rn 'Intl\.' src/i18n`, When it runs, Then zero matches exist.

## Non-Functional Requirements

### NFR-1: Payload budget of the sparse hierarchy

The three Spanish catalogs together SHALL stay well under the budget a
naive three-full-copies scheme would consume. Because `es-AR` and `es-ES`
are sparse, the added Spanish weight over the base SHALL be at most the
divergent leaf count (roughly 42 Peninsular + 65 Rioplatense leaves), not a
second and third full catalog. The total i18n JSON payload SHALL remain
within the bundle budget asserted by `app-i18n` NFR-1.

### NFR-2: No orphaned or dangling namespace files

A `.json` file in a locale directory SHALL correspond to a registered
namespace, and a registered namespace SHALL correspond to a file in every
locale. The parity harness SHALL fail on either an orphaned file or a
missing file.

## Acceptance Gates

1. `scripts/test-i18n-catalog-parity.mjs` passes: five-locale file set, 18 namespaces each, zero orphans, fallback-chain equality, and the `es-ES`/`es-AR` sparse invariants.
2. Every key in `es-AR` and `es-ES` resolves in `es-419` (R-4 subset, zero missing).
3. `pnpm typecheck` passes with the `SupportedLocale` union of five members.
4. A leaf present only in `es-419` resolves in both `es-AR` and `es-ES` without falling through to English.
5. The `categories` namespace exists in all five locales.
