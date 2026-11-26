/**
 * Category label hooks — the UI-boundary bridge between a canonical slug
 * and the `categories` namespace.
 *
 * Both hooks read the active language from react-i18next (which already
 * follows the explicit locale store override or the automatic device locale
 * configured in `src/i18n/config.ts`). There is no second locale source.
 */
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import {
  localizedCategoryLabel,
  type CategoryTranslator,
} from '../localizedCategoryLabel';

export type CategoryLabeler = (
  slug: string | null | undefined,
  fallbackName: string | null | undefined,
) => string;

/** Injectable translator for pure data helpers that must not import i18next. */
export function useCategoryTranslator(): CategoryTranslator {
  const { t } = useTranslation('categories');
  return useCallback((key: string) => t(key as never), [t]);
}

/** Localize a category label using the active i18next language. */
export function useCategoryLabel(): CategoryLabeler {
  const translator = useCategoryTranslator();
  return useCallback(
    (slug, fallbackName) =>
      localizedCategoryLabel(slug, fallbackName, translator),
    [translator],
  );
}
