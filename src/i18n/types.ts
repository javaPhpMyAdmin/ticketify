/**
 * i18next module augmentation — gives every `t()` call site typed keys
 * derived from the on-disk catalog. PR 1 ships the three minimal
 * namespaces (`common`, `tabs`, `settingsLanguage`); PR 2 widens with
 * the rest (`auth`, `settings`, `tickets`, `receipts`, `household`,
 * `analytics`, `errors`, `a11y`, `currency`). PR 3 adds `date` so the
 * calendar / weekday / month arrays are a single locale-aware source
 * (per AD-12 in the design doc). The augmentation file is the source
 * of truth — the runtime `resources` shape on disk is still per-locale
 * (i18next's `InitOptions.resources` expects `{ [lng]: { [ns]: { ... } } }`),
 * declared separately in `config.ts`.
 *
 * Uses the `ResourceNamespaceMap` interface (i18next v26+) which
 * declares namespaces flat — without a locale wrapper — so:
 *
 *   1. `useTranslation(['common', 'tabs'])` accepts the namespace
 *      string list (the top-level keys of this type).
 *   2. `useTranslation('tabs')` is also valid.
 *   3. `t('tabs.home')` is typed as `string` (the dotted path resolves
 *      i18next at runtime, not in the type system — that's fine because
 *      the resource shape is enforced by the `tabs` namespace).
 *
 *  * The SPANISH BASE is `es-419`. Every Spanish namespace type is derived
 * from `typeof es419<Ns>` — the neutral Latin-American catalog — and
 * merged with `Partial<typeof en<Ns>>` so a missing translation in en /
 * pt-BR falls back at runtime instead of failing the typecheck.
 * `es-AR` and `es-ES` are deliberately NOT in this file: they are SPARSE
 * overrides, so deriving from either would demand a key set the override
 * is designed not to carry.
 */
import 'i18next';

import type enCommon from './locales/en/common.json';
import type enTabs from './locales/en/tabs.json';
import type enSettingsLanguage from './locales/en/settingsLanguage.json';
import type enAuth from './locales/en/auth.json';
import type enSettings from './locales/en/settings.json';
import type enTickets from './locales/en/tickets.json';
import type enReceipts from './locales/en/receipts.json';
import type enHousehold from './locales/en/household.json';
import type enAnalytics from './locales/en/analytics.json';
import type enErrors from './locales/en/errors.json';
import type enA11y from './locales/en/a11y.json';
import type enCurrency from './locales/en/currency.json';
import type enDate from './locales/en/date.json';
import type enPro from './locales/en/pro.json';
import type enLegal from './locales/en/legal.json';
import type enOnboarding from './locales/en/onboarding.json';
import type enBootSplash from './locales/en/bootSplash.json';
import type es419Common from './locales/es-419/common.json';
import type es419Tabs from './locales/es-419/tabs.json';
import type es419SettingsLanguage from './locales/es-419/settingsLanguage.json';
import type es419Auth from './locales/es-419/auth.json';
import type es419Settings from './locales/es-419/settings.json';
import type es419Tickets from './locales/es-419/tickets.json';
import type es419Receipts from './locales/es-419/receipts.json';
import type es419Household from './locales/es-419/household.json';
import type es419Analytics from './locales/es-419/analytics.json';
import type es419Errors from './locales/es-419/errors.json';
import type es419A11y from './locales/es-419/a11y.json';
import type es419Currency from './locales/es-419/currency.json';
import type es419Date from './locales/es-419/date.json';
import type es419Pro from './locales/es-419/pro.json';
import type es419Legal from './locales/es-419/legal.json';
import type es419Onboarding from './locales/es-419/onboarding.json';
import type es419BootSplash from './locales/es-419/bootSplash.json';
import type es419Categories from './locales/es-419/categories.json';
import type enCategories from './locales/en/categories.json';

declare module 'i18next' {
  interface ResourceNamespaceMap {
    common: typeof enCommon;
    tabs: typeof enTabs;
    settingsLanguage: typeof enSettingsLanguage;
    /**
     * PR 2 namespaces. The es-419 catalog is the source of truth; the
     * en catalog is typed as `Partial<...>` of the same shape so a
     * missing translation key in en fails the typecheck against the base
     * (where the source string lives) but not in en / pt-BR (where
     * translations are best-effort per the spec's acceptance gate 3).
     */
    auth: typeof es419Auth & Partial<typeof enAuth>;
    settings: typeof es419Settings & Partial<typeof enSettings>;
    tickets: typeof es419Tickets & Partial<typeof enTickets>;
    receipts: typeof es419Receipts & Partial<typeof enReceipts>;
    household: typeof es419Household & Partial<typeof enHousehold>;
    analytics: typeof es419Analytics & Partial<typeof enAnalytics>;
    errors: typeof es419Errors & Partial<typeof enErrors>;
    a11y: typeof es419A11y & Partial<typeof enA11y>;
    currency: typeof es419Currency & Partial<typeof enCurrency>;
    /**
     * PR 3 (`app-i18n`): `date` namespace — single locale-aware source for
     * the calendar / weekday / month arrays. Numeric string keys (e.g.
     * `"0"`, `"1"`) are used inside `monthFull` / `monthAbbr` so call
     * sites can read `t('date.monthFull.0')` without dynamic-key
     * interpolation (which i18next-icu would handle but is explicitly
     * out of scope). Weekday headers use the same shape with
     * `weekdayMonFirst` / `weekdaySunFirst`.
     */
    date: typeof es419Date & Partial<typeof enDate>;
    /**
     * PR 3 (`app-i18n`): `pro` namespace — Pro subscription + Pro charts
     * screen copy. The charts screen (`src/app/pro/charts.tsx`) is the
     * largest remaining hardcoded surface from the explore phase; the
     * `chartsTitle` key drives the per-screen Stack header via
     * `useScreenTitle` (REQ-7 / AD-11). The remaining keys cover the
     * trend card, view toggle, period selector, summary cards, and a
     * couple of section headings.
     */
    pro: typeof es419Pro & Partial<typeof enPro>;
    /**
     * legal-compliance U2: `legal` namespace — the bundled Privacy Policy
     * and Terms documents (`privacy`/`terms` section arrays, AD-1 static
     * RN text) plus the consent-gate copy for U4/U5. es-419 is the legal
     * source of truth, typed exactly; en/pt-BR are best-effort parsed
     * translations (Partial) whose KEY SETS are pinned identical by the
     * test:legal-content parity harness.
     */
    legal: typeof es419Legal & Partial<typeof enLegal>;
    /**
     * Onboarding flow (`src/app/onboarding/`): the 3-step welcome wizard
     * surfaced only on the first app launch and persisted via
     * `onboarding-storage.ts`. Mirrors the `pro` namespace pattern —
     * es-419 is the source of truth, en / pt-BR are best-effort
     * translations whose KEY SETS are pinned identical by the
     * test-i18n-onboarding-keys harness. Per-step copy lives under
     * `step1` / `step2` / `step3` keys so the screens can pull
     * `t('step1.headline')` without flat-key collisions across
     * the three flows.
     */
    onboarding: typeof es419Onboarding & Partial<typeof enOnboarding>;
    /**
     * Boot splash redesign (splash-screen-example reference, kinetic
     * finance capture): splash column copy + status cycle labels.
     * Mirrors the `pro` / `onboarding` namespace pattern — es-419 is
     * the source of truth, en / pt-BR are best-effort translations
     * whose KEY SETS stay identical via the
     * test:i18n-boot-splash-keys harness.
     */
    bootSplash: typeof es419BootSplash & Partial<typeof enBootSplash>;
    /**
     * `category-display-i18n`: `categories` namespace — the 13 SYSTEM
     * category labels, keyed by the registry slug. `es-419` is transcribed
     * 1:1 from the registry and is the source of truth; en / pt-BR carry
     * the translated labels. `es-AR` and `es-ES` ship `{}` — no
     * canonical category label diverges between Rioplatense, Peninsular
     * and neutral Spanish, so carrying a regional copy would be a
     * duplicated-translation bug, not a localization win.
     *
     * This namespace is the EIGHTEENTH. The change documents that
     * repeatedly said "17 namespaces" were counting before this one
     * existed; the parity harness pins 18 and the leaf totals.
     */
    categories: typeof es419Categories & Partial<typeof enCategories>;
  }

  interface CustomTypeOptions {
    /** Default namespace for `t()` calls without a prefix. */
    defaultNS: 'common';
    /** Never return null — falls through to the namespace key as-is. */
    returnNull: false;
  }
}