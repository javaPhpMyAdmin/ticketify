/**
 * Shared resolution primitive for the i18n node harnesses.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * Before the Spanish regionalization there were three locales and every
 * catalog was COMPLETE, so a harness could `JSON.parse` a locale directory
 * and read any key directly. That made "read the file" and "what the app
 * renders" the same operation — which was true, and which is no longer
 * true.
 *
 * The catalog hierarchy splits each language into a base and optional
 * regional overrides:
 *
 *     en                       complete
 *     es-419  (neutral base)   complete
 *     es-AR   (voseo)          SPARSE — only the leaves that diverge
 *     es-ES   (peninsular)     SPARSE — only the leaves that diverge
 *     pt-BR                   complete
 *
 * `es-AR` deliberately does NOT carry `tickets.categoryCreateError`: that
 * string has no voseo form, so writing it would be a pointless pin that
 * only creates a merge conflict. It resolves through `es-419` instead.
 * A harness that reads `es-AR/tickets.json` directly therefore sees
 * `undefined` for a key the app renders perfectly well — it measures the
 * FILE SHAPE, not the RESOLVED CATALOG. Every parity assertion in this
 * suite is about what a user sees, so every one of them has to resolve.
 *
 * ── The order ─────────────────────────────────────────────────────────────
 * Mirrors `FALLBACK_CHAIN` in `src/i18n/detector.ts` and the
 * `fallbackLng` map in `src/i18n/config.ts`. Regional Spanish inherits the
 * NEUTRAL SPANISH BASE before English — that is the whole point of the
 * `es-419` level. A Mexican reader must never be handed English because a
 * key was spelled in Peninsular Spanish and omitted from the regional file.
 *
 * Precedence: the requested locale wins over its base, which wins over
 * `en`. Implemented by merging base-first so later writes overwrite.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// `scripts/lib/i18n-chain.mjs` → up to `scripts/` → up to the project root.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Locale codes in the order the harnesses report them. */
export const LOCALES = ['en', 'es-419', 'es-AR', 'es-ES', 'pt-BR'];

/** Per-language fallback chain. Must match `src/i18n/detector.ts`. */
export const FALLBACK_CHAIN = {
  en: ['en'],
  'es-419': ['en'],
  'es-AR': ['es-419', 'en'],
  'es-ES': ['es-419', 'en'],
  'pt-BR': ['en'],
};

/** Locales whose catalog is allowed to be sparse. */
export const SPARSE_LOCALES = ['es-AR', 'es-ES'];

export const LOCALES_ROOT = join(ROOT, 'src', 'i18n', 'locales');

/** Read one namespace file verbatim, with NO fallback applied. */
export function readCatalog(locale, namespace) {
  return JSON.parse(
    readFileSync(join(LOCALES_ROOT, locale, `${namespace}.json`), 'utf8'),
  );
}

/**
 * The RESOLVED namespace for `locale` — the base merged under the region's
 * own leaves, exactly as i18next would hand the leaves to a component.
 *
 * Merge is SHALLOW per key, which is safe here because no catalog mixes a
 * string and an object under the same key. It is also the behaviour
 * i18next has for a resource bundle, so a partial override object would
 * merge field-by-field in the app and shallowly in this helper — the
 * documented assumption, not an accident.
 */
export function resolveNamespace(locale, namespace) {
  // The chain is the requested locale FOLLOWED BY its fallbacks, not the
  // fallbacks alone. Merging only the fallbacks would let `es-419` (the last
  // entry merged) overwrite the region — the exact inversion this helper
  // exists to avoid, and one that quietly returns tú-form copy for a
  // voseo reader while still looking green.
  const chain = [locale, ...(FALLBACK_CHAIN[locale] ?? ['en'])];
  const merged = {};
  // Chain order, and an already-present leaf is NEVER overwritten. That is
  // the precedence i18next actually applies: `t()` walks the language list
  // and returns the first locale that has the full path, so the requested
  // locale beats its base which beats `en`.
  //
  // It has to be a DEEP merge. A shallow one would replace a whole nested
  // object when a region overrides a single leaf inside it — an `es-AR`
  // override of `errors.itemA11y.name` would silently erase the other 40
  // keys beside it. Observed on the first run of this helper: `es-AR`
  // resolved to 674 leaves instead of 720, because a partial nested
  // override swallowed its siblings. That is not a nit, it is a
  // data-loss bug that would read as a copy regression.
  for (const entry of chain) {
    mergeMissing(merged, readCatalog(entry, namespace));
  }
  return merged;
}

/** Deep-merge `src` into `dst` WITHOUT overwriting a leaf `dst` already has. */
function mergeMissing(dst, src) {
  for (const key of Object.keys(src)) {
    const next = src[key];
    if (next === null || typeof next !== 'object' || Array.isArray(next)) {
      if (!(key in dst)) dst[key] = next;
      continue;
    }
    if (dst[key] === null || typeof dst[key] !== 'object' || Array.isArray(dst[key])) {
      dst[key] = {};
    }
    mergeMissing(dst[key], next);
  }
  return dst;
}

/** One resolved leaf, or `undefined` when no locale in the chain has it. */
export function resolveLeaf(locale, namespace, key) {
  return resolveNamespace(locale, namespace)[key];
}

/**
 * Leaf paths of a namespace, counting an ARRAY as a single leaf.
 *
 * Array-as-one is the counting convention the catalog parity pins use
 * (`legal.privacy.sections` is one translatable unit, not 12), and it is
 * the only count stable across a regional thinning: a sparse region simply
 * omits the whole container.
 */
export function leafPaths(node, prefix = '') {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    return prefix ? [prefix] : [];
  }
  return Object.keys(node).flatMap((key) =>
    leafPaths(node[key], prefix ? `${prefix}.${key}` : key),
  );
}

/** Every namespace directory present under a locale. */
export function namespacesOf(locale) {
  return readdirSync(join(LOCALES_ROOT, locale))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .sort();
}

/**
 * Every leaf path of a locale, RESOLVED through its chain. This is the set a
 * parity assertion must compare: a sparse region legitimately has a smaller
 * RAW file and must still have the same RESOLVED surface as the base.
 */
export function resolvedLeafPaths(locale) {
  return namespacesOf(locale)
    .flatMap((ns) => leafPaths(resolveNamespace(locale, ns)).map((p) => `${ns}.${p}`))
    .sort();
}