#!/usr/bin/env node
/**
 * Drift guard for the SQL smoke tier — the lists that decide coverage.
 *
 * WHAT GAP THIS CLOSES
 * --------------------
 * The `db-smoke` job (`.github/workflows/ci.yml`) and the local harness
 * (`scripts/test-db-smoke.mjs`) each hardcode their own list of files from
 * `supabase/tests/`. Two hardcoded lists and nothing that compares them was the
 * exact gap this change exists to close: commit 43f5518 added `test:sql` to
 * the master chain because `delete-account.sql` was on disk and in the local
 * harness but missing from `db-smoke`, and the only reason that was ever
 * visible was a human reading two YAML/`run(...)` lists side by side. Drop a
 * new `supabase/tests/foo.sql` today and nothing else notices.
 *
 * This harness reads both runners plus the disk and asserts they agree. It is
 * the mechanical version of that human diff. Requires no Docker, no network,
 * and no Supabase CLI — it only reads files that are already in the repo, so
 * it belongs in the Docker-free master `pnpm test` chain (assertion 11 makes
 * that wiring an invariant rather than a convention).
 *
 * Assertions (12 numbered, plus one unnumbered input gate that runs first — 13
 * reported tests in total; the gate resolves ci.yml, the db-smoke job, the
 * harness source and package.json inside `test()` so a reindented workflow or a
 * deleted file degrades into one named failure instead of aborting the suite
 * with no per-test diagnostics):
 *   1.  every `supabase/tests/*.sql` on disk is EXECUTED by the `db-smoke` job
 *   2.  every `supabase/tests/*.sql` on disk is EXECUTED by the local harness
 *   3.  every `supabase/tests/*.sql` path ci.yml executes exists on disk
 *       (a rename or delete leaves a stale entry that points at nothing)
 *   4.  every `supabase/tests/*.sql` path the harness executes exists on disk
 *   5.  both runners agree on COUNT and the count equals the files on disk
 *   6.  `test:sql` is not a segment of the master `pnpm test` chain
 *   7.  `test:all` is exactly `pnpm test && pnpm test:sql`
 *   8.  the manual-only rollback SMOKE stays manual-only
 *   9.  the manual-only rollback MIGRATION stays manual-only, matched on
 *       content as well as on name (see assertion 9's comment)
 *   10. PARSER SELF-CHECK: every live `join('supabase','tests',…)` reference in
 *       the harness resolves to a live `run([...])` step. This is the one that
 *       defends against this guard's own parser silently shrinking — see
 *       "THE PARSER IS THE SEAM" below.
 *   11. this guard's own package.json script is a segment of the master chain
 *   12. no `db-smoke` step can swallow a smoke failure (`continue-on-error:`,
 *       `|| true`, `|| exit 0`, …)
 *
 * THE PARSER IS THE SEAM
 * ----------------------
 * Assertions 1-4 could be written as substring searches over the whole file.
 * That version is a lie in the safe direction: `scripts/test-db-smoke.mjs`
 * documents every file in its header comment, so a naive scan sees two hits per
 * file and cannot tell an executed file from a documented one. A
 * comment is not coverage. Worse, a comment about a deliberately EXCLUDED file
 * is exactly the thing that must never be counted — the harness carries a
 * `trial-rollback.sql` note, and ci.yml carries a `supabase/manual/` note, and
 * both describe files nobody executes.
 *
 * HOW "A COMMENT IS NOT COVERAGE" IS ACTUALLY EARNED
 *   Harness side — ENFORCED for `//` and block comments: `stripJsComments()`
 *   blanks both kinds out of the source before any regex runs, and the
 *   `run([...])` match is `^`-anchored, so
 *
 *       // run(['db','query',…,'currency-default.sql')]);   // disabled
 *
 *   registers as zero executions. Assertion 2 then names the file as uncovered.
 *   A step commented out with a BLOCK comment is caught too, which a bare `^`
 *   anchor would miss (the inner line would sit at column 0 looking live).
 *
 *   ci.yml side — ENFORCED for the ordinary way a step gets disabled: the
 *   `run:` match is `^`-anchored, so `# run: …`, `#   run: …` and outright
 *   deletion all resolve to zero executions and assertion 1 names the file.
 *
 *   Neither side is immune in the abstract. Two residual holes are LIMITS, not
 *   invariants, and are recorded here so nobody mistakes the parser for a
 *   proof:
 *     1. ci.yml: a line that literally starts with `run:` nested inside ANOTHER
 *        step's block scalar (`run: |`) is counted, though it never runs. That
 *        is what makes a block-scalar rewrite resolve to zero files — it fails
 *        CLOSED, and the messages now point at the accepted shapes instead of
 *        telling the author to add a step they already wrote in block form.
 *     2. Harness: a `run([...])` inside a string literal that begins its own
 *        line, or in dead code (`if (false) { … }`), is still counted. A comment
 *        stripper is not a control-flow analyser.
 *
 * Parsed shapes, for reference when this guard fails:
 *   ci.yml     run: supabase db query --local --file supabase/tests/<file>.sql
 *              (single-line scalar only — a `run: |` block scalar is NOT a
 *              recognised step, and assertion 1 fails naming the file)
 *   harness    run(['db', 'query', '--local', '--file', join('supabase','tests','<file>')])
 *              (column-anchored; a commented-out copy does not count)
 *
 * WHAT THIS DOES NOT PROTECT AGAINST
 * ----------------------------------
 *   * A COORDINATED DELETION. Removing a smoke from `supabase/tests/` AND from
 *     both runners in one commit leaves no trace, because nothing here maps
 *     smokes to the migrations they pin. That needs a migration↔smoke mapping
 *     and is deliberately out of scope. This guard covers runner/disk drift,
 *     not "the coverage was quietly deleted".
 *   * Its own wiring. Assertion 11 makes the guard fail the moment anyone runs
 *     it after unwiring it, but no assertion inside a guard can force that
 *     guard to keep running. Deleting the segment AND the package.json entry
 *     stays silent until something outside this file looks for it; this repo
 *     has no pre-commit hook to catch it. Stated, not papered over.
 *
 * Usage: pnpm test:sql-smoke-coverage  (or: node scripts/test-sql-smoke-coverage.mjs)
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const testsDir = join(root, 'supabase', 'tests');
const migrationsDir = join(root, 'supabase', 'migrations');
const manualDir = join(root, 'supabase', 'manual');
const ciPath = join(root, '.github', 'workflows', 'ci.yml');
const harnessPath = join(root, 'scripts', 'test-db-smoke.mjs');
const packagePath = join(root, 'package.json');

/** This file, as package.json spells it. Used by assertion 11 to find the
 *  script name that runs the guard, so the wiring check never hardcodes a
 *  second copy of the name that could drift. */
const GUARD_FILE = 'scripts/test-sql-smoke-coverage.mjs';

/** The master chain MUST NOT contain this — it needs Docker. Matched as a
 *  whole shell segment (`pnpm test:sql`, `pnpm run test:sql`) with a hard end
 *  anchor, so a sibling script merely NAMED like it (`test:sql-smoke-coverage`,
 *  which is in the chain on purpose) can never be mistaken for it. */
const SQL_TIER_SCRIPT = 'test:sql';

/** The manual-only rollback pair. Its migration lives in supabase/manual/ and is
 *  never auto-applied by `supabase db reset`, so its smoke is never in either
 *  runner either. Asserted here so nobody wires it up by accident — the
 *  <1h rollback runbook applies and verifies it by hand. */
const MANUAL_ROLLBACK_SMOKE = 'trial-rollback.sql';
const MANUAL_ROLLBACK_MIGRATION = '0040_rc_trial_rollback.sql';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  const started = Date.now();
  try {
    await fn();
    passed += 1;
    console.log(`  ok    ${name} (${Date.now() - started}ms)`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL  ${name}`);
    console.error(String((err && err.stack) || err));
  }
}

/** The `.sql` files that actually exist in supabase/tests/. */
function sqlFilesOnDisk() {
  return readdirSync(testsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/**
 * Blanks out every JS comment so a commented-out step cannot read as coverage.
 *
 * Handles `//`, `/* … *\/`, single/double-quoted strings and template literals
 * (consumed verbatim, so the `join('supabase', …)` calls inside a real step
 * survive) and skips regex literals via the usual previous-token heuristic.
 *
 * It is NOT a full JS parser. Two honest limits:
 *   - the regex-vs-division heuristic can misfire, but a bare `//` or `/*`
 *     cannot appear unescaped inside a real regex literal (JS would read it as
 *     a comment, i.e. a syntax error), so the only realistic way to fool it is
 *     a stray quote inside a character class;
 *   - it tracks no nesting and no control flow — see the header's residual
 *     holes.
 *
 * OUTPUT LENGTH ALWAYS EQUALS INPUT LENGTH, and offsets are preserved, so a
 * match index found in the raw source still points at the same character in the
 * stripped source. `commentedInvocationCount()` depends on that.
 */
function stripJsComments(source) {
  const out = [];
  let i = 0;
  let prev = '';
  const regexCanStartAfter = (c) => c === '' || /[({[,;:=!&|?+\-*%~^<>]/.test(c);

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') {
        out.push(' ');
        i += 1;
      }
      continue;
    }

    if (ch === '/' && next === '*') {
      out.push(' ', ' ');
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        out.push(source[i] === '\n' ? '\n' : ' ');
        i += 1;
      }
      if (i < source.length) {
        out.push(' ', ' ');
        i += 2;
      }
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      out.push(ch);
      i += 1;
      while (i < source.length) {
        const s = source[i];
        if (s === '\\') {
          out.push(s, source[i + 1] === undefined ? '' : source[i + 1]);
          i += 2;
          continue;
        }
        out.push(s);
        i += 1;
        if (s === quote) break;
      }
      prev = quote;
      continue;
    }

    if (ch === '/' && regexCanStartAfter(prev)) {
      out.push(ch);
      i += 1;
      let inClass = false;
      while (i < source.length) {
        const s = source[i];
        if (s === '\\') {
          out.push(s, source[i + 1] === undefined ? '' : source[i + 1]);
          i += 2;
          continue;
        }
        if (s === '[') inClass = true;
        if (s === ']') inClass = false;
        out.push(s);
        i += 1;
        if (s === '/' && !inClass) break;
      }
      while (i < source.length && /[a-z]/i.test(source[i])) {
        out.push(source[i]);
        i += 1;
      }
      prev = '/';
      continue;
    }

    out.push(ch);
    if (!/\s/.test(ch)) prev = ch;
    i += 1;
  }

  return out.join('');
}

/** One `run([...])` invocation that executes a file from supabase/tests/. */
const HARNESS_INVOCATION_BODY =
  /run\(\s*\[\s*['"]db['"]\s*,\s*['"]query['"]\s*,\s*['"]--local['"]\s*,\s*['"]--file['"]\s*,\s*join\(\s*['"]supabase['"]\s*,\s*['"]tests['"]\s*,\s*['"]([^'"]+)['"]\s*\)\s*,?\s*\]\s*\)/;

/** A LIVE `run([...])` step: `^`-anchored like the ci.yml parser, so the call
 *  must START its line. A trailing `// disabled` on a real call is still a real
 *  call (it executes); a call buried behind prose on the same line is not. */
const HARNESS_INVOCATION = new RegExp(`^[^\\S\\n]*${HARNESS_INVOCATION_BODY.source}`, 'gm');

/** The same shape with no anchor, used to find invocations that exist in the raw
 *  source but are NOT live code. */
const HARNESS_INVOCATION_LOOSE = new RegExp(HARNESS_INVOCATION_BODY.source, 'g');

/** Basenames of the `supabase/tests/*.sql` files the local harness EXECUTES. */
function harnessExecutedFiles(strippedSource) {
  return [...strippedSource.matchAll(HARNESS_INVOCATION)].map((m) => m[1]);
}

/** Every `join('supabase','tests', …)` reference in LIVE harness code — the
 *  denominator of the parser self-check (assertion 10). Comments are excluded
 *  for the same reason executions are: a commented-out step is no longer a step,
 *  and keeping it in the denominator would fire assertion 10 for a problem
 *  assertion 2 already names precisely. */
function harnessJoinReferences(strippedSource) {
  return [...strippedSource.matchAll(/join\(\s*['"]supabase['"]\s*,\s*['"]tests['"]\s*,/g)].length;
}

/** The files whose `run([...])` step exists in the raw source but is switched
 *  off — commented out with `//`, a block comment, or anything else the
 *  stripper blanks. Only a diagnosis (reported inside assertion 2's failure
 *  message); it is deliberately NOT a separate gate, so it cannot miscount and
 *  turn a green build red. `stripJsComments()` preserves offsets and length, so
 *  a raw match is live exactly when its own text survives at its own offset. */
function disabledHarnessInvocations(rawSource, strippedSource) {
  const out = [];
  for (const m of rawSource.matchAll(HARNESS_INVOCATION_LOOSE)) {
    if (strippedSource.slice(m.index, m.index + m[0].length) !== m[0]) out.push(m[1]);
  }
  return out;
}

/**
 * The `db-smoke` job block, sliced out of ci.yml so no other job's `run:`
 * step can contribute a path. ci.yml indents jobs by exactly two spaces, so
 * the next line matching /^ {2}\S/ ends this job.
 */
function readDbSmokeJob(ciSource) {
  const lines = ciSource.split('\n');
  const start = lines.findIndex((l) => /^ {2}db-smoke:\s*$/.test(l));
  assert.notEqual(
    start,
    -1,
    'ci.yml must declare a `db-smoke` job indented by exactly two spaces',
  );
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^ {2}\S/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

/**
 * Repo-relative `supabase/tests/*.sql` paths that the `db-smoke` job EXECUTES.
 * Matches only single-line `run:` steps that invoke `supabase db query` with a
 * `--file` (or `-f`) argument, so step comments and prose never register.
 */
function ciExecutedPaths(job) {
  const step =
    /^[^\S\n]*run:[^\S\n]+supabase[^\S\n]+db[^\S\n]+query\b[^\n]*?(?:--file|-f)[^\S\n]+(\S+)/gm;
  const paths = [];
  for (const match of job.matchAll(step)) {
    const p = match[1];
    if (p.startsWith('supabase/tests/')) paths.push(p);
  }
  return paths;
}

/**
 * The `db-smoke` job's steps, as `{ line, body }` records. A step body stops at
 * the next `- ` sequence entry at or above the `run:` indent, so a
 * `continue-on-error:` belonging to a LATER step is never charged to an earlier
 * one. Block scalars (`run: |`) are absorbed whole so their shell lines cannot
 * be mistaken for steps of their own.
 */
function dbSmokeSteps(job) {
  const lines = job.split('\n');
  const steps = [];
  let current = null;
  let blockScalarIndent = null;

  for (const line of lines) {
    const indent = /^[^\S\n]*/.exec(line)[0].length;

    if (blockScalarIndent !== null) {
      if (line.trim() === '' || indent > blockScalarIndent) {
        current.body.push(line);
        continue;
      }
      blockScalarIndent = null;
    }

    if (/^[^\S\n]*-[^\S\n]/.test(line)) {
      if (current) steps.push(current);
      current = { line: line.trim(), body: [] };
      continue;
    }

    if (!current) continue;
    if (/^[^\S\n]*run\s*:\s*\|\s*$/.test(line)) blockScalarIndent = indent;
    current.body.push(line);
  }

  if (current) steps.push(current);
  return steps;
}

/** A step's `run:` text with block scalars kept intact, plus its sequence line
 *  (for the `- name:` label). */
function stepRunText(step) {
  return [step.line, ...step.body].join('\n');
}

function stepName(step) {
  const m = /-\s*name:\s*(.+?)\s*$/.exec(step.line);
  return m ? m[1] : '(unnamed step)';
}

/** Shell constructs that turn a failing command into a passing step: a trailing
 *  `|| true` / `|| exit 0` / `|| :`, a `; true` tail, or a bare `exit 0`. */
const SWALLOW_PATTERN = /(?:\|\||;|&&)\s*(?:true\b|:|exit\s+0\b)|\bexit\s+0\b/;

/** Ordering prefix + extension are conventions, not identity. */
function normalizedMigrationStem(filename) {
  return filename
    .replace(/\.sql$/i, '')
    .replace(/^\d+[-_]/, '')
    .trim()
    .toLowerCase();
}

/** Comments, string literals and whitespace are presentation; what decides
 *  whether two migrations are "the same migration" is the DDL they run. */
function normalizedSqlBody(source) {
  return source
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Splits a shell command chain into its individual commands. `&&` short-circuits
 *  on failure, so it may never hide a command; `;`, `||` and newlines do not. */
function chainCommands(command) {
  return command
    .split(/\s*(?:&&|;|\|\||\n)\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Is `pnpm test:sql` this command? Tolerates `pnpm run test:sql` and the
 *  `run: true`-prefixed form pnpm prints, and hard-anchors the end so
 *  `pnpm test:sql-smoke-coverage` is a DIFFERENT script, not a match. */
function isPnpmScript(command, name) {
  return new RegExp(`^pnpm(?:\\s+run)?\\s+${name}$`).test(command);
}

async function run() {
  console.log('\n[sql-smoke-coverage] SQL smoke tier — runner/drift guard\n');

  const onDisk = sqlFilesOnDisk();
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));

  // Every input the per-test assertions depend on is resolved here, inside a
  // reported test, so a reindented ci.yml or a deleted file degrades into ONE
  // named failure instead of aborting the suite with no diagnostics at all.
  // Each of these fails closed: without its input the assertions below cannot
  // be trusted, so the guard must not report "0 files, all covered".
  const inputs = {};
  await test('inputs resolve: ci.yml, the db-smoke job, the harness and package.json', () => {
    assert.ok(
      existsSync(ciPath),
      `${ciPath} is missing — this guard reads .github/workflows/ci.yml to find the db-smoke job`,
    );
    const ciSource = readFileSync(ciPath, 'utf8');
    inputs.job = readDbSmokeJob(ciSource);
    inputs.steps = dbSmokeSteps(inputs.job);

    assert.ok(
      existsSync(harnessPath),
      `${harnessPath} is missing — this guard reads scripts/test-db-smoke.mjs to find its smoke steps`,
    );
    inputs.harnessRaw = readFileSync(harnessPath, 'utf8');
    inputs.harnessLive = stripJsComments(inputs.harnessRaw);

    assert.ok(
      typeof pkg.scripts === 'object' && pkg.scripts !== null,
      'package.json must declare a scripts object',
    );
    assert.ok(
      typeof pkg.scripts.test,
      'string',
      'package.json scripts["test"] must be a string so this guard can read the master chain',
    );

    // Only set once every input above resolved. The assertions below refuse to
    // report success on empty lists, so an unresolved input fails them loudly
    // instead of quietly looking like "0 files, nothing uncovered".
    inputs.ready = true;
  });

  // Derived from what the inputs test resolved. Anything that fails to resolve
  // leaves these empty, which makes the assertions below fail with their own
  // messages instead of passing on a silently empty list.
  const ciPaths = 'job' in inputs ? ciExecutedPaths(inputs.job) : [];
  const ciFiles = ciPaths.map((p) => p.slice(p.lastIndexOf('/') + 1));
  const harnessFiles = 'harnessLive' in inputs ? harnessExecutedFiles(inputs.harnessLive) : [];
  const disabledInvocations =
    'harnessRaw' in inputs
      ? disabledHarnessInvocations(inputs.harnessRaw, inputs.harnessLive)
      : [];

  console.log(
    `[sql-smoke-coverage] coverage counts — ci.yml: ${ciPaths.length}, ` +
      `harness: ${harnessFiles.length}, on disk: ${onDisk.length}\n`,
  );

  const SHAPES =
    'Accepted shapes (see the "Parsed shapes" section of the header of ' +
    'scripts/test-sql-smoke-coverage.mjs): a ci.yml step must be the single-line ' +
    '`run: supabase db query --local --file supabase/tests/<file>.sql` — a `run: |` ' +
    'block scalar is NOT recognised and resolves to zero files; a harness step must be ' +
    "the column-anchored `run(['db','query','--local','--file',join('supabase','tests','<file>')])` " +
    'and must not be commented out.';

  // ── 1. Disk → CI: nothing on disk is silently uncovered ────────────────
  await test('every supabase/tests/*.sql on disk is executed by the db-smoke job', () => {
    const uncovered = onDisk.filter((f) => !ciFiles.includes(f));
    assert.deepEqual(
      uncovered,
      [],
      `on disk but never executed by ci.yml db-smoke: ${uncovered.join(', ') || '(none)'}\n` +
        SHAPES,
    );
  });

  // ── 2. Disk → harness: the local equivalent is actually equivalent ─────
  await test('every supabase/tests/*.sql on disk is executed by the local harness', () => {
    const uncovered = onDisk.filter((f) => !harnessFiles.includes(f));
    const diagnosis =
      disabledInvocations.length > 0
        ? `\nNOTE: these run([...]) step(s) in scripts/test-db-smoke.mjs are commented out and ` +
          `therefore execute nothing: ${disabledInvocations.join(', ')}. A commented ` +
          'invocation is not coverage.'
        : '';
    assert.deepEqual(
      uncovered,
      [],
      `on disk but never executed by scripts/test-db-smoke.mjs: ${uncovered.join(', ') || '(none)'}\n` +
        SHAPES +
        diagnosis,
    );
  });

  // ── 3. CI → disk: a stale entry after a rename/delete ──────────────────
  await test('every supabase/tests path ci.yml executes exists on disk', () => {
    const stale = ciPaths.filter((p) => !existsSync(join(root, p)));
    assert.deepEqual(
      stale,
      [],
      `ci.yml db-smoke executes paths that do not exist: ${stale.join(', ') || '(none)'}\n` +
        SHAPES,
    );
  });

  // ── 4. Harness → disk: same, for the local runner ──────────────────────
  await test('every supabase/tests path the harness executes exists on disk', () => {
    const stale = harnessFiles.filter((f) => !existsSync(join(testsDir, f)));
    assert.deepEqual(
      stale,
      [],
      `scripts/test-db-smoke.mjs executes paths that do not exist: ${stale.join(', ') || '(none)'}\n` +
        SHAPES,
    );
  });

  // ── 5. Counts agree in both directions ────────────────────────────────
  await test('ci.yml, the harness and the disk agree on the smoke test COUNT', () => {
    assert.equal(
      ciPaths.length,
      harnessFiles.length,
      `runner count mismatch — ci.yml executes ${ciPaths.length}, the harness executes ${harnessFiles.length}`,
    );
    assert.equal(
      ciPaths.length,
      onDisk.length,
      `coverage count mismatch — ${onDisk.length} .sql file(s) on disk but ci.yml executes ${ciPaths.length}`,
    );
    assert.ok(onDisk.length > 0, 'supabase/tests/ must contain at least one .sql smoke test');
  });

  // ── 6. The master chain stays Docker-free ─────────────────────────────
  await test(`\`pnpm ${SQL_TIER_SCRIPT}\` is NOT a segment of the master \`test\` chain`, () => {
    const offenders = chainCommands(pkg.scripts.test).filter((cmd) =>
      isPnpmScript(cmd, SQL_TIER_SCRIPT),
    );
    assert.deepEqual(
      offenders,
      [],
      `the master chain must stay Docker-free, but it contains: ${offenders.join(' | ') || '(none)'}\n` +
        'db-smoke owns the SQL tier, so `' +
        SQL_TIER_SCRIPT +
        '` belongs in `test:all` only (see the header of scripts/test-db-smoke.mjs)',
    );
  });

  // ── 7. The escape hatch back to the SQL tier still exists ─────────────
  await test('`test:all` is exactly `pnpm test && pnpm test:sql`', () => {
    assert.equal(
      pkg.scripts['test:all'],
      'pnpm test && pnpm test:sql',
      'package.json scripts["test:all"] must stay `pnpm test && pnpm test:sql` — it is the ' +
        'only documented way to run both tiers locally',
    );
    assert.equal(
      pkg.scripts[SQL_TIER_SCRIPT],
      'node scripts/test-db-smoke.mjs',
      `package.json scripts["${SQL_TIER_SCRIPT}"] must keep pointing at the local SQL harness`,
    );
  });

  // ── 8. The manual-only rollback SMOKE stays manual-only ───────────────
  await test(`\`${MANUAL_ROLLBACK_SMOKE}\` stays out of both runners (manual-only tier)`, () => {
    assert.ok(
      existsSync(join(manualDir, MANUAL_ROLLBACK_SMOKE)),
      `supabase/manual/${MANUAL_ROLLBACK_SMOKE} must exist — it is the paired smoke for the manual rollback migration`,
    );
    assert.ok(
      existsSync(join(manualDir, MANUAL_ROLLBACK_MIGRATION)),
      `supabase/manual/${MANUAL_ROLLBACK_MIGRATION} must exist`,
    );
    assert.ok(
      !ciFiles.includes(MANUAL_ROLLBACK_SMOKE),
      `ci.yml db-smoke must NOT execute ${MANUAL_ROLLBACK_SMOKE} — its migration is manual-only, ` +
        'so `db reset` never applies the state the smoke asserts',
    );
    assert.ok(
      !harnessFiles.includes(MANUAL_ROLLBACK_SMOKE),
      `scripts/test-db-smoke.mjs must NOT execute ${MANUAL_ROLLBACK_SMOKE} — same reason`,
    );
    const inTestsDir = existsSync(join(testsDir, MANUAL_ROLLBACK_SMOKE));
    assert.ok(
      !inTestsDir,
      `${MANUAL_ROLLBACK_SMOKE} must not move to supabase/tests/ — that directory is the ` +
        'auto-applied set, and this smoke belongs to the manual <1h rollback runbook',
    );
  });

  // ── 9. The manual-only rollback MIGRATION stays manual-only ───────────
  //
  // The `f.includes('rc_trial_rollback')` this replaces hardcoded a literal
  // that the constant three lines above already owns, so renaming the migration
  // silently disarmed the check. Comparing on a normalized stem (ordering
  // prefix and .sql stripped) is better but still name-based: copying the file
  // into supabase/migrations/ as `0040_rc_trial_cutover_revert.sql` matches
  // nothing while `supabase db reset` happily applies the rollback on every
  // reset. So identity is decided on CONTENT as well — the canonical file in
  // supabase/manual/ is the reference, and its DDL is compared against every
  // migration with comments and whitespace normalized away. That catches a
  // renamed copy, a differently-named copy, and a copy with an edited comment
  // block, and it needs no maintenance when the rollback itself is edited,
  // because the reference is read from disk each run rather than hardcoded.
  await test(`\`${MANUAL_ROLLBACK_MIGRATION}\` stays out of supabase/migrations/`, () => {
    const manualPath = join(manualDir, MANUAL_ROLLBACK_MIGRATION);
    const manualBody = normalizedSqlBody(readFileSync(manualPath, 'utf8'));
    const manualStem = normalizedMigrationStem(MANUAL_ROLLBACK_MIGRATION);
    const byStem = [];
    const byContent = [];

    for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'))) {
      const source = readFileSync(join(migrationsDir, file), 'utf8');
      if (normalizedMigrationStem(file) === manualStem) byStem.push(file);
      if (normalizedSqlBody(source) === manualBody) byContent.push(file);
    }

    assert.deepEqual(
      [...new Set([...byStem, ...byContent])].sort(),
      [],
      'the rollback migration must never be auto-applied by `supabase db reset`. ' +
        'Matched by normalized stem against the constant ' +
        `${MANUAL_ROLLBACK_MIGRATION}` +
        ' and by normalized DDL content against ' +
        `supabase/manual/${MANUAL_ROLLBACK_MIGRATION}` +
        ' — a rename or a differently-named copy is caught either way, because ' +
        'a name-only check silently stops matching.',
    );
  });

  // ── 10. PARSER SELF-CHECK: the parser must not quietly shrink ─────────
  //
  // Assertions 1-4 trust a regex. If someone rewrites a live step into a shape
  // the regex cannot see, both the coverage list AND this denominator lose the
  // same step, so the drift is silent — which is exactly the false-green class
  // this guard exists to prevent. Comparing the two keeps the parser honest,
  // and the reported ratio says whether the loss was on the coverage side or on
  // the "steps you never asked about" side.
  await test("harness parser resolves every live join('supabase','tests',…) reference", () => {
    assert.ok(inputs.ready, 'inputs did not resolve — see the "inputs resolve" failure above');
    const refs = harnessJoinReferences(inputs.harnessLive);
    assert.equal(
      refs,
      harnessFiles.length,
      `the harness has ${refs} live join('supabase','tests',…) reference(s) but the parser ` +
        `resolved ${harnessFiles.length} executed step(s) — ` +
        `ratio ${refs}:${harnessFiles.length}` +
        (refs > harnessFiles.length
          ? '. There are more references than steps: a real step was rewritten into a shape ' +
            'this parser does not recognise. Uncommenting or reshaping it is not the fix — ' +
            'bring it back to the documented shape, then re-run this guard. ' +
            'Accepted harness shape: ' +
            "run(['db','query','--local','--file',join('supabase','tests','<file>')]), " +
            'column-anchored and not commented out.'
          : '. There are fewer references than steps: a live reference was not matched. ' +
            'If the step is real, it must be the documented shape; if it is a comment, ' +
            'assertion 2 is the check that should name the file.'),
    );
  });

  // ── 11. The guard cannot be unwired without saying so ─────────────────
  //
  // `pnpm test` is the master chain and the `verify` CI job runs nothing else,
  // so without this the guard is one `&& pnpm test:sql-smoke-coverage` token
  // away from being silently unhooked, and it would keep reporting success
  // every time somebody ran it by hand. There is no pre-commit hook in this repo
  // to catch that, so the check lives here. Honest limit, also in the header:
  // this assertion fires when the guard RUNS, so it cannot force the chain to
  // keep running it — it makes the removal loud on the next manual or CI
  // invocation, not impossible.
  await test('this guard\'s own script IS a segment of the master `test` chain', () => {
    assert.ok(inputs.ready, 'inputs did not resolve — see the "inputs resolve" failure above');
    const owners = Object.keys(pkg.scripts).filter((name) =>
      String(pkg.scripts[name]).includes(GUARD_FILE),
    );
    assert.equal(
      owners.length,
      1,
      `package.json must declare exactly one script whose command runs ${GUARD_FILE}, ` +
        `found ${owners.length}: ${owners.join(', ') || '(none)'} — without that entry the ` +
        'guard cannot even be invoked by name',
    );
    const guardScript = owners[0];
    const segments = chainCommands(pkg.scripts.test);
    const wired = segments.filter((cmd) => isPnpmScript(cmd, guardScript));
    assert.ok(
      wired.length > 0,
      `this guard is NOT in the master \`pnpm test\` chain — package.json scripts["${guardScript}"] ` +
        `runs it, but scripts["test"] never calls \`pnpm ${guardScript}\`. Master chain segments:\n  ` +
        `${segments.join('\n  ')}\n` +
        `append \`&& pnpm ${guardScript}\` to scripts["test"], or the SQL smoke tier's drift ` +
        'guard stops protecting anything while still reporting success when run by hand.',
    );
  });

  // ── 12. A step that cannot fail is not coverage ───────────────────────
  //
  // Every other assertion in this file is about PRESENCE: the step exists, it
  // names a real file, both runners have it. None of them can see a step that
  // executes and then throws its exit status away. `continue-on-error: true` or
  // a trailing `|| true` on a smoke step means the smoke asserted nothing while
  // the job stayed green — and the guard, which counts that step as coverage,
  // would report full coverage. This is scoped to the steps that actually run a
  // file from supabase/tests/ on purpose: the `supabase start` step's own block
  // scalar legitimately uses `supabase stop … || true` as cleanup on the retry
  // path, and charging that to the smoke steps would be a false positive that
  // trains people to ignore this assertion.
  await test('no db-smoke step can swallow a smoke failure', () => {
    assert.ok(inputs.ready, 'inputs did not resolve — see the "inputs resolve" failure above');
    const smokeSteps = inputs.steps.filter(
      (step) => /supabase[^\S\n]+db[^\S\n]+query\b/.test(stepRunText(step)),
    );
    const swallowed = [];
    for (const step of smokeSteps) {
      const text = stepRunText(step);
      if (/continue-on-error\s*:/.test(text)) {
        swallowed.push(`${stepName(step)} (${ciPath}): carries \`continue-on-error:\``);
      }
      for (const line of text.split('\n')) {
        const m = /^[^\S\n]*run\s*:\s*(.*)$/.exec(line);
        if (!m) continue;
        const hit = SWALLOW_PATTERN.exec(m[1]);
        if (hit) {
          swallowed.push(
            `${stepName(step)} (${ciPath}): run line swallows failures via \`${hit[0].trim()}\`\n` +
              `      ${line.trim()}`,
          );
        }
      }
    }
    assert.deepEqual(
      swallowed,
      [],
      'a smoke step that cannot fail is not coverage, and this guard counts steps as ' +
        'coverage:\n  - ' +
        `${swallowed.join('\n  - ')}\n` +
        'remove the suppression. A flaky SQL smoke is a bug to fix, not a step to silence — ' +
        'a green build here must mean the smoke actually asserted something.',
    );
  });

  console.log(`\n[sql-smoke-coverage] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('[sql-smoke-coverage] harness crashed:', err);
  process.exit(1);
});