/**
 * i18next module augmentation — gives every `t()` call site typed keys
 * derived from the on-disk catalog. PR 1 keeps it minimal: the catalog
 * declares the two shipped namespaces (`common`, `tabs`) with their
 * flattened key→string shape. PR 2 will widen the catalog with the rest
 * of the namespaces (auth, settings, tickets, etc.); the augmentation
 * file stays the source of truth.
 *
 * Uses the new `ResourceNamespaceMap` interface (i18next v26+) which
 * declares namespaces flat — without a locale wrapper — so:
 *
 *   1. `useTranslation(['common', 'tabs'])` accepts the namespace
 *      string list (the top-level keys of this type).
 *   2. `useTranslation('tabs')` is also valid.
 *   3. `t('tabs.home')` is typed as `string` (the dotted path resolves
 *      i18next at runtime, not in the type system — that's fine because
 *      the resource shape is enforced by the `tabs` namespace).
 *
 * The runtime `resources` shape on disk is still per-locale (i18next's
 * `InitOptions.resources` expects `{ [lng]: { [ns]: { ... } } }`),
 * declared separately in `config.ts`. This file is type-only.
 */
import 'i18next';

import type enCommon from './locales/en/common.json';
import enTabs from './locales/en/tabs.json';
import enSettingsLanguage from './locales/en/settingsLanguage.json';
import esARCommon from './locales/es-AR/common.json';
import esARTabs from './locales/es-AR/tabs.json';
import esARSettingsLanguage from './locales/es-AR/settingsLanguage.json';
import ptBRCommon from './locales/pt-BR/common.json';
import ptBRTabs from './locales/pt-BR/tabs.json';
import ptBRSettingsLanguage from './locales/pt-BR/settingsLanguage.json';

declare module 'i18next' {
  interface ResourceNamespaceMap {
    common: typeof enCommon;
    tabs: typeof enTabs;
    settingsLanguage: typeof enSettingsLanguage &
      typeof esARSettingsLanguage &
      typeof ptBRSettingsLanguage;
  }

  interface CustomTypeOptions {
    /** Default namespace for `t()` calls without a prefix. */
    defaultNS: 'common';
    /** Never return null — falls through to the namespace key as-is. */
    returnNull: false;
  }
}