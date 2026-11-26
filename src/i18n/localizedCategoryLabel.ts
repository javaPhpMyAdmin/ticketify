/**
 * Canonical-slug → localized category label mapping.
 *
 * Pure by design: no React, no i18next import, no supabase. The caller
 * injects a translator so this module runs unchanged in the Node harness
 * and in plain data helpers. Only canonical slugs are ever translated;
 * user-authored category names pass through verbatim.
 */
import { isCanonicalCategoryKey } from '@/features/home/categories';

/** Structural translator contract — compatible with i18next's `t()`. */
export type CategoryTranslator = (key: string) => string;

/**
 * Resolve the label for ONE category at the UI boundary.
 *
 * - canonical slug + usable translation → the `categories:` catalog value;
 * - custom slug, missing/empty translation, absent translator → `fallbackName`
 *   (the DB row name or the static Spanish taxonomy mirror);
 * - an untranslated key counts as missing: i18next may echo either the full
 *   `categories:<slug>` key or the bare slug.
 */
export function localizedCategoryLabel(
  slug: string | null | undefined,
  fallbackName: string | null | undefined,
  translator: CategoryTranslator | null | undefined,
): string {
  const fallback = typeof fallbackName === 'string' ? fallbackName : '';
  if (!slug || !isCanonicalCategoryKey(slug) || !translator) return fallback;

  const key = `categories:${slug}`;
  let translated: unknown;
  try {
    translated = translator(key);
  } catch {
    return fallback;
  }
  return typeof translated === 'string' &&
    translated.trim().length > 0 &&
    translated !== key &&
    translated !== slug
    ? translated
    : fallback;
}
