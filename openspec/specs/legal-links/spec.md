# Legal Links Specification

## Purpose

Google Play and App Store Connect require a hosted privacy-policy URL at submission, and both stores expect Terms accessible at account creation. Ticketify currently has zero legal content (no files, screens, i18n keys, or URLs), so this capability makes Privacy Policy and Terms & Conditions reachable from the app: an injectable external-link opener that never throws, a locale-aware legal URL map with es-AR fallback, a Legal group in Settings between the main list and the danger zone, legal links on the sign-up footer usable pre-auth, legal i18n keys across the three catalogs, and a parity + contract test harness wired into `pnpm test`. Legal text and hosting stay user-owned: URLs ship as `example.com` placeholders flagged `TODO(user)` until the user publishes real pages (REQ-7).

## Requirements

### REQ-1: External-link opener contract

The system SHALL expose an external-link opener `openExternalUrl(url, opener?)` returning `Promise<boolean>` that opens `url` in the platform browser. The opener SHALL return `true` when the underlying open resolves and `false` when it rejects; it MUST NOT throw and MUST NOT surface user-facing errors. The `opener` argument SHALL be injectable — defaulting to the platform `WebBrowser.openBrowserAsync` — so contract tests can substitute a stub without touching the SDK.

#### Scenario: Open succeeds

- GIVEN a valid https URL and a stub opener that resolves
- WHEN `openExternalUrl(url, stub)` runs
- THEN it returns `true`

#### Scenario: Open rejected / browser unavailable

- GIVEN a stub opener that rejects (browser closed, unavailable, or platform error)
- WHEN `openExternalUrl(url, stub)` runs
- THEN it returns `false` and no exception escapes

#### Scenario: Default opener used

- GIVEN no explicit opener argument
- WHEN `openExternalUrl(url)` runs
- THEN the platform browser opener (`WebBrowser.openBrowserAsync`) is invoked with `url`

### REQ-2: Locale-aware legal URL map

The system SHALL provide a legal URL map with exactly two documents — `privacy` and `terms` — each mapping the three `AppLocale` values `es-AR`, `en`, and `pt-BR` to one URL. The resolver `legalUrlFor(document, locale)` SHALL return the requested locale's URL and SHALL fall back to the `es-AR` URL for any missing or unsupported locale. Every URL value SHALL use the `https:` scheme.

#### Scenario: Known locale resolves

- GIVEN active locale `pt-BR`
- WHEN `legalUrlFor('privacy', 'pt-BR')` runs
- THEN it returns the pt-BR privacy policy URL

#### Scenario: Unsupported locale falls back to es-AR

- GIVEN a locale outside the supported set (e.g. `fr-FR`) or no locale at all
- WHEN `legalUrlFor('terms', locale)` runs
- THEN it returns the es-AR terms URL

### REQ-3: Settings Legal group

The system SHALL render a Legal section on the authenticated profile screen between the main settings list and the danger zone, built from a row set defined separately from the main `settings[]` array so the existing list/danger split is unaffected. The section SHALL show exactly two rows labelled with the `settings` keys `privacyPolicy` and `termsConditions`, under the section title `settings:legalSectionTitle`. Tapping a row SHALL invoke the opener (REQ-1) with `legalUrlFor(document, activeLocale)` and SHALL NOT navigate in-app.

#### Scenario: Legal group renders in place

- GIVEN an authenticated user on the profile tab
- WHEN the screen renders
- THEN the Legal section appears between the main settings list and the delete-account danger row
- AND it shows exactly two rows labelled via `settings:privacyPolicy` / `settings:termsConditions` in the active locale

#### Scenario: Row opens the active-locale URL

- GIVEN active locale `en`
- WHEN the user taps the Privacy Policy row
- THEN the opener is invoked with the `en` privacy URL
- AND no in-app navigation occurs

### REQ-4: Sign-up footer legal links

The system SHALL render Privacy Policy and Terms & Conditions links on the sign-up screen below the existing footer, combining the `auth` keys `signUpLegalPrefix` and `signUpLegalAnd` with the `settings` labels `privacyPolicy` and `termsConditions`. The links SHALL invoke the opener (REQ-1) with the active-locale URL and SHALL NOT depend on an authenticated session. Opener rejection SHALL be silent (REQ-1) — no error dialog or blocking state.

#### Scenario: Links visible pre-auth

- GIVEN an unauthenticated user on the sign-up screen with no session
- WHEN the footer renders
- THEN both links are visible, built from the `auth` connectors and the `settings` labels in the active locale

#### Scenario: Tap opens the legal document in-browser

- GIVEN active locale `es-AR`
- WHEN the user taps Terms & Conditions
- THEN the opener receives the es-AR terms URL
- AND the user remains on the sign-up screen

### REQ-5: i18n catalog parity

The system SHALL add to the `settings` namespace the keys `legalSectionTitle`, `privacyPolicy`, `termsConditions` and to the `auth` namespace the keys `signUpLegalPrefix`, `signUpLegalAnd`, in all three catalogs (`es-AR` source of truth, `en`, `pt-BR`). Every legal key SHALL exist in all three catalogs and SHALL hold a non-empty string value; the legal key sets SHALL NOT diverge across catalogs.

#### Scenario: Full parity across catalogs

- GIVEN the three locale catalogs
- WHEN the legal key sets are compared
- THEN the sets are identical across `es-AR`, `en`, and `pt-BR`
- AND every value is non-empty

#### Scenario: Divergence is detected

- GIVEN a catalog missing a legal key or holding an empty value
- WHEN the parity assertion runs
- THEN the harness reports a failure naming the locale and key

### REQ-6: Test harness

The system SHALL ship `scripts/test-legal-links.mjs` asserting: (a) three-catalog parity and non-empty legal values (REQ-5); (b) `LEGAL_URLS` holds exactly two documents × three locales with every URL `https:` (REQ-2); (c) the opener returns `true` on a resolving stub and `false` on a rejecting stub without throwing (REQ-1). The harness SHALL be wired as `test:legal-links` in the `pnpm test` chain.

#### Scenario: Suite runs green

- GIVEN all REQ-1 / REQ-2 / REQ-5 invariants hold
- WHEN `pnpm test` runs
- THEN `test:legal-links` executes and passes within the chain

#### Scenario: Rejecting stub verified

- GIVEN a stub opener that rejects
- WHEN the harness invokes `openExternalUrl(url, rejectingStub)`
- THEN the harness asserts the result is `false` and no exception escapes

### REQ-7: Placeholder lifecycle and release gate

URLs SHALL ship as `https://example.com/...` placeholders flagged with a visible `TODO(user)` marker so the real-domain swap is grep-able. The implementation SHALL replace every placeholder with the user's real hosted URLs before release, and release verification SHALL assert that no `example.com` value remains in the URL map. Placeholders SHALL render and open normally during development; the automated harness SHALL NOT fail on `example.com` placeholders — the real-domain check is a release gate, not a runtime contract.

#### Scenario: Placeholders work during development

- GIVEN legal pages are not yet published
- WHEN a Legal row or footer link is tapped
- THEN the placeholder URL opens in the external browser without crashing
- AND each placeholder retains its `TODO(user)` marker

#### Scenario: Release blocks on example.com

- GIVEN the user has published legal pages on the real domain
- WHEN release verification runs
- THEN no `https://example.com` value remains in the URL map
- AND the hosted-privacy-URL entry for Play Console / App Store Connect is recorded as a user-owned release dependency

## Non-Functional Requirements

### Pre-auth safety

The opener and the URL map SHALL NOT import session, auth, or store modules; both MUST remain usable from pre-auth screens (sign-up) and authenticated screens (profile) alike.

### Accessibility

Every legal row and footer link SHALL expose an accessibility label resolved from the i18n keys of the active locale; labels MUST NOT be hardcoded literals.

### Typecheck

`pnpm typecheck` MUST pass with the new modules and the test harness in place.

## Acceptance Gates

1. `pnpm test` passes, including the wired `test:legal-links` harness.
2. `pnpm typecheck` passes.
3. Manual: Settings shows the Legal group between the main list and the danger zone; both rows open the active-locale URL in the external browser.
4. Manual: sign-up footer shows both links pre-auth (fresh install, no session); taps open the external browser and return to the sign-up screen.
5. Release: no `example.com` URL remains in the URL map once real URLs are provided (verify gate; user-owned hosting dependency surfaced).

## Cross-References

- REQ-2's es-AR fallback policy aligns with `app-i18n` REQ-2 (unsupported locales fall back to `es-AR`).
- REQ-5 extends the catalog structure defined in `app-i18n` REQ-1 (three locales, `es-AR` source of truth, namespace-per-file).