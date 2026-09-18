# Legal Content Specification

## Purpose

Bundled in-app Privacy Policy and Terms screens in all three locales (es-AR source of truth, en, pt-BR), rendered as static, scrollable React Native text — no webview, no runtime fetch. The same text is mirrored to GitHub Pages Markdown so the store-required hosted URLs and the in-app document share one source of truth. Text updates ship with app releases.

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

The i18n `legal` namespace MUST define the `privacy` and `terms` documents in all three catalogs (es-AR source of truth, en, pt-BR). The key sets MUST be identical and every value MUST be non-empty across catalogs; screens render `legal.{doc}` for the active locale with the app-i18n es-AR fallback.

#### Scenario: Parity holds across catalogs

- GIVEN the three locale catalogs
- WHEN the parity harness compares the `legal` key sets
- THEN the sets are identical and every value is non-empty

#### Scenario: Divergence is detected

- GIVEN a catalog missing a `legal` key or holding an empty value
- WHEN the parity harness runs
- THEN it reports a failure naming the locale and key

### Requirement: Hosted Markdown Mirror

The legal text MUST be published at `https://javaPhpMyAdmin.github.io/ticketify/legal/{locale}/{doc}/` for both documents in all three locales, generated from the same source as the in-app screens. A harness MUST assert that six non-empty mirror files exist under `docs/legal/` for every locale/document pair.

#### Scenario: Mirror generation is complete

- GIVEN legal text in all three locales
- WHEN the mirror generation runs
- THEN six `docs/legal/{locale}/{doc}.md` files exist and are non-empty
- AND their content matches the in-app `legal` namespace text

### Requirement: No Runtime Fetch

The app MUST bundle legal content and MUST NOT fetch or render legal documents from the network at runtime.

#### Scenario: Offline document access

- GIVEN the app is offline
- WHEN the user opens `/legal/terms`
- THEN the bundled text renders normally

## Acceptance Gates

1. `/legal/privacy` and `/legal/terms` render scrollable localized content pre-auth and while gated.
2. `legal` namespace parity passes for all three catalogs.
3. Six non-empty Markdown mirrors exist and each matches the in-app text.