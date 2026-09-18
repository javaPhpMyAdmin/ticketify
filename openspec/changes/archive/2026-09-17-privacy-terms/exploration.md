# Exploration: Privacy Policy + Terms & Conditions (privacy-terms)

> Status: success. Research + mapping only — no code written, no source files edited.
> Artifact store: hybrid (this file + engram `sdd/privacy-terms/explore`).
> Change: `privacy-terms`.

## Intent

Ship Privacy Policy and Terms & Conditions for ticketify. The repo has zero legal
content today: no privacy/terms files, no Legal screens, no legal i18n keys, and no
hosted URLs. The driver is store submission: Google Play (and App Store Connect) require
a hosted privacy policy URL — in-app static screens alone cannot satisfy that constraint.

## Current State

### Settings screen structure
- `src/app/(tabs)/profile.tsx` builds a declarative `settings: AccountSettingRow[]`
  array (lines 91–163). Each row: `id`, `label` (via `t('settings:xxx')`), `icon`,
  `trailing { type: 'chevron' }`, `onPress: () => router.push('/settings/<screen>')`.
- Rendering split (lines 358–372): main list renders `settings.slice(0, len-1)`; the
  last row (`delete-account`, `tone: 'danger'`) renders in a separate danger section.
- `src/features/profile/components/AccountSettingsList.tsx` — `AccountSettingRow` type
  (lines 27–42) rendered as a Card of Pressable rows (56–78). A "Legal" group fits as a
  new section reusing this component.

### i18n structure
- Namespace-per-file under `src/i18n/locales/{es-AR,en,pt-BR}/` (14 namespaces).
  `settings.json` is 105 keys per locale — parity currently perfect (105/105/105).
- Convention: es-AR source of truth; flat camelCase keys; screen-prefixed groups.
- `test:i18n-detector` and `test:i18n-init` do NOT check key parity; parity is enforced
  by convention + feature test scripts (see `scripts/test-manual-screen.mjs:1567–1583`).
- Adding a new namespace costs 3 JSON files + config.ts/types.ts plumbing. Extending
  the existing `settings` namespace costs only 3 JSON files — cheaper.

### Navigation to new screens
- `src/app/settings/` holds 8 screens; expo-router auto-registration (no `_layout.tsx`).
  Only `settings/currency` and `settings/budget` are explicitly in `Stack.Protected`;
  the rest auto-register behind the auth gate and work. A new `src/app/settings/legal.tsx`
  needs no layout registration; typed routes typecheck `router.push('/settings/legal')`.
- Screen shell pattern: SafeAreaView + custom header + ScrollView (delete-account.tsx:133–150).
- Legal screens auto-register behind the session gate — pre-auth reachability is a
  design decision.

### Existing web/privacy URLs or config
- No app-owned domain anywhere; `app.json` has no privacy-policy field (that data lives
  in Play Console / App Store Connect, not app.json).
- Delete-account archive cites "Google Play Data Deletion policy + GDPR Art. 17" but the
  privacy-policy-URL requirement is NOT captured anywhere — new for this change.

### External navigation pattern
- `expo-web-browser` ~15.0.11 is installed and used only for OAuth
  (`src/lib/auth/oauth.ts:31–32, 47, 229`). No general-purpose "open external URL"
  helper exists — a tiny `WebBrowser.openBrowserAsync(url)` wrapper is needed.

## Gap Analysis

Missing to ship Privacy Policy + T&C:
1. **Hosted legal pages + a URL** (user-owned hosting; no domain exists in repo) — the
   store URL requirement.
2. App-side "Legal" settings group (2 rows: Privacy Policy, Terms & Conditions) +
   i18n row labels in 3 `settings.json` catalogs.
3. Optional in-app screens (`src/app/settings/legal.tsx`) or direct link per row.
4. External-link opener utility (`WebBrowser.openBrowserAsync` wrapper) — does not exist.
5. Optional: legal links on auth screens (ToS consent — Play/Apple expect ToS accessible
   at account creation; sign-up footer exists but has no legal links).
6. i18n parity assertions in a feature test script if new keys ship.

## Options

### Option B — Hosted legal pages + in-app links (RECOMMENDED)
Host Privacy Policy + T&C as static pages on a user-owned domain; add a "Legal" group
in Settings whose rows open the URLs via a new `WebBrowser.openBrowserAsync` helper;
i18n only the row labels (3 files, `settings` namespace).
- Pros: satisfies the Play/App Store URL requirement; single source of truth; text
  updates never require an app release; matches existing settings-row UX; smallest
  app-side diff.
- Cons: requires hosting + domain from the user; user must author/publish the two
  pages; no offline access to legal text.
- Effort: Low (app side) + external hosting dependency.

### Option A — In-app static screens only (i18n'd)
New `legal` namespace (or extend `settings`) with full legal text in 3 locales +
2 sub-screens.
- Pros: no hosting; offline; fully localized.
- Cons: does NOT satisfy the store privacy-policy URL requirement (hard constraint);
  legal text changes require a release; 3-way translation of legalese error-prone.
- Effort: Medium-High.

### Option C — Hybrid: hosted source of truth + in-app summary screen
Hosted pages + one in-app "Legal" screen showing a short localized summary per
document with a "Read full policy" link to the hosted URL.
- Pros: satisfies URL requirement; in-app feel.
- Cons: two copies of legal content increase maintenance/parity risk; more work than B.
- Effort: Medium.

**Ranking: B > C > A.**

## Risks

- **Legal text ownership (blocking for full scope)**: user must author/provide actual
  policy text and own hosting. App-side work can proceed, but store submission stays
  blocked until pages are live.
- **Play Console deadline**: the privacy policy URL is entered in the console
  independently of the app binary — hosting is the critical path, not the app change.
- **i18n parity tests**: new `settings` keys must land in all 3 locales (currently
  105/105/105) + a parity assertion in a feature test.
- **Third-party processor disclosures**: policy must name Supabase, RevenueCat,
  Google Play/App Store, camera/photo storage — content risk the user's business must cover.
- **Auth-screen ToS consent**: Play/Apple policy expects ToS accessible at account
  creation — scope decision for the spec phase.
- **New-screen session gating**: legal links may need pre-auth reachability — design decision.

## Next Recommended

`propose` — the change has a clear shape (hosted pages + settings links + opener utility)
but two decisions need user confirmation before spec: (1) does hosting/domain exist?
(2) scope of pre-auth ToS consent? If hosting exists and minimal B-scope is confirmed,
`spec` can follow directly.

## Skill Resolution

- `sdd-explore/SKILL.md` (executor override) loaded via skill tool.
- `_shared/sdd-phase-common.md` read directly.
- `mobile/.agents/skills/supabase/SKILL.md` intentionally skipped (no DB surface).