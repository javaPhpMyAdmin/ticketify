# Legal Content Specification

> **Archived 2026-09-19** from change `legal-compliance`. All 4 requirements (REQ-1..REQ-4: in-app screens, localized parity, hosted Markdown mirror, no runtime fetch) and the 3 acceptance gates are implemented and verified. See `openspec/changes/archive/2026-09-19-legal-compliance/archive-report.md` for the merge history (PR #118 U1 DB+config → PR #119 U2 in-app content → PR #121 U3 mirror → PR #122 U4 consent → PR #123 U5 gate → PR #120 U6 URLs) and the open follow-ups (legal copy still DRAFT pending legal review; live PostgREST client→definer check noted).

## Purpose

Bundled in-app Privacy Policy and Terms screens in all five locales (`es-419` Spanish source of truth; `en` and `pt-BR` full catalogs; `es-AR` and `es-ES` sparse regional overrides resolved through the `es-419` fallback chain), rendered as static, scrollable React Native text — no webview, no runtime fetch. The same text is mirrored to GitHub Pages Markdown so the store-required hosted URLs and the in-app document share one source of truth. Text updates ship with app releases.

## Requirements

### Requirement: In-App Legal Screens

The system MUST provide two in-app routes, `/legal/privacy` and `/legal/terms`, rendering the document for the active locale as scrollable text under a document-title header, with back navigation to the originating screen. The routes MUST be reachable without a session and without consent acceptance (pre-auth sign-up links, the consent gate, and profile rows all open them) and MUST be deep-linkable.

#### Scenario: Open from sign-up without a session

- GIVEN an unauthenticated user on the sign-up screen
- WHEN the user taps the Privacy Policy footer link
- THEN the app routes to `/legal/privacy` in the active locale
- AND no session or consent acceptance is required

#### Scenario: Open from the consent gate

- GIVEN a gated user with no current-version acceptance rows
- WHEN the user taps Terms on the gate
- THEN `/legal/terms` opens in the active locale
- AND back returns to the gate without recording acceptance

#### Scenario: Long document scrolls

- GIVEN a document longer than the viewport
- WHEN the user scrolls
- THEN the content scrolls and the header remains visible

### Requirement: Localized Content Parity

The i18n `legal` namespace MUST define the `privacy` and `terms` documents in all five catalogs (`es-419` source of truth; `en` and `pt-BR` full; `es-AR` and `es-ES` sparse regional overrides whose divergent leaves are present and whose inherited leaves resolve through the `es-419` chain). Screens render `legal.{doc}` for the active locale; the `es-AR` and `es-ES` overrides MUST contain every leaf they diverge on, and MUST NOT introduce a leaf absent from `es-419`.

#### Scenario: Parity holds across catalogs

- GIVEN the five locale catalogs
- WHEN the parity harness compares the `legal` key sets against the `es-419` base
- THEN every regionally-divergent leaf exists in the base and every value is non-empty

#### Scenario: Sparse regional override resolves through the base

- GIVEN `es-AR` carries only its divergent `legal` leaves (e.g. 6)
- WHEN the in-app screen renders `legal.terms` in `es-AR`
- THEN the inherited sections resolve from `es-419`, never from `en`

#### Scenario: Divergence is detected

- GIVEN a catalog missing a `legal` key or holding an empty value
- WHEN the parity harness runs
- THEN it reports a failure naming the locale and key

### Requirement: Hosted Markdown Mirror

The legal text MUST be published at `https://javaPhpMyAdmin.github.io/ticketify/legal/{locale}/{doc}/` for both documents in all five locales, generated from the same source as the in-app screens. A harness MUST assert that ten non-empty mirror files exist under `docs/legal/` for every locale/document pair. The generator MUST emit each locale from its RESOLVED catalog (`locale → es-419 → en`) so a sparse regional override produces a complete document rather than an empty one.

#### Scenario: Mirror generation is complete

- GIVEN legal text in all five locales
- WHEN the mirror generation runs
- THEN ten `docs/legal/{locale}/{doc}.md` files exist and are non-empty
- AND their content matches the in-app `legal` namespace text

#### Scenario: Sparse override mirrors are resolved, not raw

- GIVEN `es-AR/legal.json` carries only 6 divergent leaves
- WHEN its mirror is generated
- THEN the emitted `docs/legal/es-AR/{privacy,terms}.md` documents are complete, with inherited sections sourced from `es-419`

### Requirement: No Runtime Fetch

The app MUST bundle legal content and MUST NOT fetch or render legal documents from the network at runtime.

#### Scenario: Offline document access

- GIVEN the app is offline
- WHEN the user opens `/legal/terms`
- THEN the bundled text renders normally

## Acceptance Gates

1. `/legal/privacy` and `/legal/terms` render scrollable localized content pre-auth and while gated.
2. `legal` namespace parity passes for all five catalogs, with regional overrides subset to `es-419`.
3. Ten non-empty Markdown mirrors exist and each matches the resolved in-app text.
