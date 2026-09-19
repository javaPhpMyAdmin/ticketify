#!/usr/bin/env node
/**
 * Deterministic hosted-mirror generator for the legal catalogs (U3).
 *
 * ONE implementation, ONE shipped file: this module is both the library the
 * harness drives and the CLI `node scripts/generate-legal-markdown.mjs` that
 * regenerates the committed mirrors — no compile step, no drift between what
 * is tested and what ships.
 *
 * `__emitLegalMirrors({ root, outRoot })` reads the SHIPPED legal catalogs
 * straight from disk (`src/i18n/locales/{locale}/legal.json`) and emits a
 * Markdown mirror for every (locale × document) under
 * `{outRoot}/{locale}/{doc}.md`. The function is deterministic by
 * construction: no timestamps, no reading order that isn't pinned by the
 * shipped catalog, no platform-dependent line endings (explicit `\n` joins,
 * `trimEnd()` + a single trailing newline) — so generation is byte-stable
 * (F7) and the committed mirrors under `docs/legal/` are exactly what a
 * fresh `node scripts/generate-legal-markdown.mjs` produces.
 *
 * The mirror format carries every contract the harness asserts:
 *   - an H1 declaring document type + locale (F6);
 *   - the catalog leaf's VERBATIM draft notice (F9, R-3);
 *   - a generated header with the ISO version (AD-4, 2026-09-18), DRAFT
 *     status, source path and the regeneration command;
 *   - every section's title AND body verbatim (F9, R-3);
 * so a hosted consumer can assert on the same strings the in-app screen
 * ships, without a runtime renderer (U2-2.5 byte-mirror determinism).
 *
 * GitHub Pages (repo Settings → Pages → Deploy from `main` `/docs`) serves
 * the rendered Markdown at
 * `https://javaPhpMyAdmin.github.io/ticketify/legal/{locale}/{doc}/` — the
 * pages themselves are OUTSIDE this repo (owner-gated enablement, design
 * R-1); this generator only keeps the SOURCE mirrors byte-fresh.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MIRROR_LOCALES = ['es-AR', 'en', 'pt-BR'];
const MIRROR_DOCS = ['privacy', 'terms'];
const DOC_LABELS = { privacy: 'Privacy', terms: 'Terms' };

/**
 * ISO version shared by both documents (design AD-4). MUST stay in sync with
 * `LATEST_LEGAL_VERSIONS` in `src/features/legal/legal-versions.ts` (U4):
 * a version bump changes BOTH the client gate constant and the mirror header.
 */
export const LEGAL_VERSION = '2026-09-18';

/** Exact mirror emitter. Deterministic by construction (byte-stable F7). */
export async function __emitLegalMirrors({ root, outRoot }) {
  const targetRoot = outRoot ?? join(root, 'docs', 'legal');
  const outDirs = [];

  for (const locale of MIRROR_LOCALES) {
    const catalog = JSON.parse(
      readFileSync(
        join(root, 'src', 'i18n', 'locales', locale, 'legal.json'),
        'utf8',
      ),
    );

    const outDir = join(targetRoot, locale);
    mkdirSync(outDir, { recursive: true });

    for (const doc of MIRROR_DOCS) {
      const leaf = catalog[doc];
      const lines = [
        `# ${DOC_LABELS[doc]} — ${locale}`,
        '',
        `> ${leaf.draftNotice}`,
        '',
        `_ISO version ${LEGAL_VERSION} · DRAFT status · source: src/i18n/locales/${locale}/legal.json · regenerate: \`node scripts/generate-legal-markdown.mjs\`_`,
        '',
      ];
      for (const section of leaf.sections) {
        lines.push(`## ${section.title}`, '', section.body, '');
      }
      // trimEnd() then a single trailing newline → deterministic bytes on
      // every platform (no CRLF, no trailing blank lines).
      const mirror = lines.join('\n').trimEnd() + '\n';
      writeFileSync(join(outDir, `${doc}.md`), mirror, 'utf8');
    }
    outDirs.push(outDir);
  }

  return outDirs;
}

/** CLI entry — regenerates the committed mirrors under docs/legal/. */
const isMain =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  await __emitLegalMirrors({ root });
  console.log(
    '[generate-legal-markdown] committed mirrors regenerated under docs/legal/',
  );
}