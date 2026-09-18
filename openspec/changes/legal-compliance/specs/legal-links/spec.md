# Delta for Legal Links

Delta for `openspec/specs/legal-links/spec.md`: REQ-3/REQ-4 navigate in-app to the legal-content screens; REQ-7 swaps placeholders for real Pages URLs. REQ-1/REQ-2/REQ-5/REQ-6 unchanged. Acceptance criteria: rows/links open `/legal/{privacy,terms}` in-app without the opener; all six URLs use the Pages domain, no `example.com` (release gate).

## MODIFIED Requirements

### REQ-3: Settings Legal group

The system SHALL render a Legal section on the authenticated profile screen between the main settings list and the danger zone, built from a row set defined separately from the main `settings[]` array so the existing list/danger split is unaffected. The section SHALL show exactly two rows labelled with the `settings` keys `privacyPolicy` and `termsConditions`, under the section title `settings:legalSectionTitle`. Tapping a row SHALL navigate in-app to the matching legal-content route (`/legal/privacy` for Privacy, `/legal/terms` for Terms) for the active locale and SHALL NOT invoke the external opener (REQ-1).
(Previously: tapping a row invoked the external opener with `legalUrlFor(document, activeLocale)` and did not navigate in-app.)

#### Scenario: Legal group renders in place

- GIVEN an authenticated user on the profile tab
- WHEN the screen renders
- THEN the Legal section appears between the main settings list and the delete-account danger row
- AND it shows exactly two rows labelled via `settings:privacyPolicy` / `settings:termsConditions` in the active locale

#### Scenario: Row opens the in-app document

- GIVEN locale `en` on the profile tab
- WHEN the user taps the Privacy Policy row
- THEN the app routes to `/legal/privacy`
- AND the external opener is not invoked

### REQ-4: Sign-up footer legal links

The system SHALL render Privacy Policy and Terms & Conditions links on the sign-up screen below the existing footer, combining the `auth` keys `signUpLegalPrefix` and `signUpLegalAnd` with the `settings` labels `privacyPolicy` and `termsConditions`. The links SHALL navigate in-app to the legal-content routes (`/legal/privacy`, `/legal/terms`) for the active locale, SHALL NOT depend on an authenticated session, and SHALL be tappable before the consent checkbox is accepted (legal-consent).
(Previously: links invoked the external opener with the active-locale URL and required no session.)

#### Scenario: Links visible pre-auth

- GIVEN an unauthenticated user on the sign-up screen with no session
- WHEN the footer renders
- THEN both links are visible, built from the `auth` connectors and the `settings` labels in the active locale

#### Scenario: Tap opens the document in-app

- GIVEN active locale `es-AR` with the consent checkbox unchecked
- WHEN the user taps Terms & Conditions
- THEN the app routes to `/legal/terms`
- AND back returns to the sign-up screen with the form state preserved

## RENAMED Requirements

### REQ-7: Placeholder lifecycle and release gate → REQ-7: Real hosted URLs and release gate

(Reason: the six `example.com` placeholders are replaced by real GitHub Pages URLs; the requirement now enforces the real domain instead of tolerating placeholders.)
(Migration: apply the RENAME before the MODIFIED block; update `scripts/test-legal-links.mjs` goldens; remove `TODO(user)` markers.)

## MODIFIED Requirements

### REQ-7: Real hosted URLs and release gate

The URL map (REQ-2) SHALL contain exactly the hosted Pages URLs `https://javaPhpMyAdmin.github.io/ticketify/legal/{locale}/{doc}/` for both documents in three locales. The automated harness SHALL assert every URL uses that domain and SHALL fail the suite if any non-Pages value remains. Release verification SHALL NOT proceed until the assertion passes; the `TODO(user)` marker lifecycle is retired.
(Previously: URLs shipped as `example.com` placeholders with `TODO(user)` markers, and the harness was required NOT to fail on them.)

#### Scenario: All URLs resolve to the real domain

- GIVEN the legal-links harness runs
- WHEN it asserts the URL map (REQ-2)
- THEN all six values use the Pages domain
- AND no value contains `example.com`

#### Scenario: Release blocks on example.com

- GIVEN a placeholder or stale domain value remains in the URL map
- WHEN release verification runs
- THEN the harness fails and the release cannot proceed
- AND the Play/App-Store hosted-privacy-URL entry is recorded as satisfied by the Pages URLs