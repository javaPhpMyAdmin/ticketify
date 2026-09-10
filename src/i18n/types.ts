/**
 * i18next module augmentation — gives every `t()` call site typed keys
 * derived from the on-disk catalog. PR 1 ships the three minimal
 * namespaces (`common`, `tabs`, `settingsLanguage`); PR 2 widens with
 * the rest (`auth`, `settings`, `tickets`, `receipts`, `household`,
 * `analytics`, `errors`, `a11y`, `currency`). The augmentation file is
 * the source of truth — the runtime `resources` shape on disk is still
 * per-locale (i18next's `InitOptions.resources` expects
 * `{ [lng]: { [ns]: { ... } } }`), declared separately in `config.ts`.
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
 * The PR 2 catalog types use a type-only mirror of the es-AR shape
 * (source of truth). PR 2 ships the `es-AR` files first; the en / pt-BR
 * catalogs are best-effort translations and use `Partial<...>` so a
 * missing key in those locales falls back to es-AR at runtime instead
 * of failing the typecheck. WU-2.6.
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
import type esARCommon from './locales/es-AR/common.json';
import type esARTabs from './locales/es-AR/tabs.json';
import type esARSettingsLanguage from './locales/es-AR/settingsLanguage.json';
import type esARAuth from './locales/es-AR/auth.json';
import type esARSettings from './locales/es-AR/settings.json';
import type esARTickets from './locales/es-AR/tickets.json';
import type esARReceipts from './locales/es-AR/receipts.json';
import type esARHousehold from './locales/es-AR/household.json';
import type esARAnalytics from './locales/es-AR/analytics.json';
import type esARErrors from './locales/es-AR/errors.json';
import type esARA11y from './locales/es-AR/a11y.json';
import type esARCurrency from './locales/es-AR/currency.json';

declare module 'i18next' {
  interface ResourceNamespaceMap {
    common: typeof enCommon;
    tabs: typeof enTabs;
    settingsLanguage: typeof enSettingsLanguage;
    /**
     * PR 2 namespaces. The es-AR catalog is the source of truth; the
     * en catalog is typed as `Partial<...>` of the same shape so a
     * missing translation key in en fails the typecheck in es-AR
     * (where the source string lives) but not in en/pt-BR (where
     * translations are best-effort per the spec's acceptance gate 3).
     */
    auth: typeof esARAuth & Partial<typeof enAuth>;
    settings: typeof esARSettings & Partial<typeof enSettings>;
    tickets: typeof esARTickets & Partial<typeof enTickets>;
    receipts: typeof esARReceipts & Partial<typeof enReceipts>;
    household: typeof esARHousehold & Partial<typeof enHousehold>;
    analytics: typeof esARAnalytics & Partial<typeof enAnalytics>;
    errors: typeof esARErrors & Partial<typeof enErrors>;
    a11y: typeof esARA11y & Partial<typeof enA11y>;
    currency: typeof esARCurrency & Partial<typeof enCurrency>;
  }

  interface CustomTypeOptions {
    /** Default namespace for `t()` calls without a prefix. */
    defaultNS: 'common';
    /** Never return null — falls through to the namespace key as-is. */
    returnNull: false;
  }
}