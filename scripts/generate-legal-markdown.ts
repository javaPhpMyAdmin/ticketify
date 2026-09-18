/**
 * Deterministic hosted-mirror generator for the legal catalogs (U3).
 *
 * ONE implementation, TWO entry points — so the harness (which loads the
 * COMPILED module through the per-AD-5 compile-and-load bridge) and the
 * SHIPPED CLI (`node scripts/generate-legal-markdown.mjs`) can never drift:
 *
 *   - `__emitLegalMirrors({ root, outRoot })` is the only source of truth.
 *     It reads the SHIPPED legal catalogs straight from disk
 *     (`src/i18n/locales/{locale}/legal.json`) and emits a Markdown mirror
 *     for every (locale × document) under `{outRoot}/{locale}/{doc}.md`.
 *     The function is deterministic: no timestamps, no ordering that isn't
 *     pinned by the shipped catalog, so generation is byte-stable (F7).
 *   - The harness tsc-compiles this file via `tsconfig.legal-content-test
 *     .json` into a temp outDir and `load()`s `scripts/generate-legal-
 *     markdown.js`, then calls `__emitLegalMirrors` with a FRESH outRoot.
 *     F7 then byte-compares the freshly generated mirrors against the
 *     COMMITTED mirrors under `docs/legal/` — served by GitHub Pages.
 *   - `scripts/generate-legal-markdown.mjs` is a thin CLI that compiles the
 *     SAME tsconfig and drives the SAME compiled module with the default
 *     committed outRoot, so `node scripts/generate-legal-markdown.mjs`
 *     regenerates the committed mirrors exactly (no drift).
 *
 * The mirror format carries every contract the harness asserts:
 *   - an H1 declaring document type + locale (F6);
 *   - the catalog leaf's VERBATIM draft notice (F9, R-3);
 *   - every section's title AND body verbatim (F9, R-3);
 * so a hosted consumer can assert on the same strings the in-app screen
 * ships, without a runtime renderer (U2-2.5 byte-mirror determinism).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIRROR_LOCALES = ['es-AR', 'en', 'pt-BR'];
const MIRROR_DOCS = ['privacy', 'terms'];
const DOC_LABELS = { privacy: 'Privacy', terms: 'Terms' } as const;

interface LegalSection {
  id: string;
  title: string;
  body: string;
}

interface LegalLeaf {
  title: string;
  draftNotice: string;
  sections: LegalSection[];
}

/** Exact mirror emitter. Deterministic by construction (byte-stable F7). */
export async function __emitLegalMirrors({
  root,
  outRoot,
}: {
  root: string;
  /** Defaults to the committed mirror root (`{root}/docs/legal`). */
  outRoot?: string;
}): Promise<string[]> {
  const targetRoot = outRoot ?? join(root, 'docs', 'legal');
  const outDirs: string[] = [];

  for (const locale of MIRROR_LOCALES) {
    const catalog = JSON.parse(
      readFileSync(
        join(root, 'src', 'i18n', 'locales', locale, 'legal.json'),
        'utf8',
      ),
    ) as Record<string, LegalLeaf>;

    const outDir = join(targetRoot, locale);
    mkdirSync(outDir, { recursive: true });

    for (const doc of MIRROR_DOCS) {
      const leaf = catalog[doc];
      const lines: string[] = [
        `# ${DOC_LABELS[doc]} — ${locale}`,
        '',
        `> ${leaf.draftNotice}`,
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

/**
 * CLI entry — runs only when executed directly (not when loaded through the
 * harness bridge). Regenerates the committed mirrors under docs/legal/.
 */
const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) ===
    join(process.cwd(), 'scripts', 'generate-legal-markdown.ts');

if (isMain) {
  const { root } = { root: join(dirname(fileURLToPath(import.meta.url)), '..') };
  await __emitLegalMirrors({ root });
  console.log(
    '[generate-legal-markdown] committed mirrors regenerated under docs/legal/',
  );
}
