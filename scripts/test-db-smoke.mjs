/**
 * Local runner for the pro-subscription SQL smoke test (supabase/tests/pro-subscription.sql).
 *
 * This is intentionally NOT part of the `pnpm test` chain. The Node test suite
 * (test:*) is 100% dependency-free of Docker and runs anywhere. This script
 * boots the local Supabase stack (Docker required), which would break the
 * default test suite for anyone without Docker — so it lives behind its own
 * `pnpm test:sql` entry point.
 *
 * What it does:
 *   1. Verifies the Docker daemon is reachable (fails fast with a clear message).
 *   2. `supabase start` — boots Postgres and applies every migration in
 *      supabase/migrations/ from scratch (fresh scratch DB, never prod).
 *   3. `supabase db reset --local` — deterministically rebuilds the catalog so
 *      the assertions see exactly what the migrations declare.
 *   4. `supabase db query --local --file supabase/tests/pro-subscription.sql` —
 *      runs the READ-ONLY smoke test (plain DO/assert blocks, NOT pgTAP, so
 *      `supabase test db` is not used). Any raised assertion fails the query,
 *      which propagates as a non-zero exit and fails this script.
 *
 * Requirements: Docker daemon running + the Supabase CLI (`supabase`) on PATH.
 *
 * Run: pnpm test:sql
 */

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

function run(args, opts = {}) {
  console.log(`> supabase ${args.join(' ')}`);
  return execFileSync('supabase', args, { cwd: root, stdio: 'inherit', ...opts });
}

// 1. Docker availability — fail fast instead of a confusing 40-line CLI dump.
function assertDocker() {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore' });
  } catch {
    console.error(
      '\n[ticketify test:sql] Docker daemon is not reachable.\n' +
        '  The SQL smoke test needs the local Supabase stack (Postgres) to build\n' +
        '  the catalog from migrations. Start Docker Desktop, then re-run `pnpm test:sql`.\n',
    );
    process.exit(1);
  }
}

const EXCLUDE = [
  'gotrue',
  'realtime',
  'storage-api',
  'imgproxy',
  'kong',
  'mailpit',
  'postgrest',
  'postgres-meta',
  'studio',
  'edge-runtime',
  'logflare',
  'vector',
  'supavisor',
];

assertDocker();

console.log('\n== Building the local catalog from migrations ==\n');
run(['start', ...EXCLUDE.flatMap((s) => ['-x', s])]);

console.log('\n== Deterministic reset (fresh DB + all migrations) ==\n');
run(['db', 'reset', '--local']);

console.log('\n== Running pro-subscription SQL smoke test ==\n');
run(['db', 'query', '--local', '--file', join('supabase', 'tests', 'pro-subscription.sql')]);

console.log('\n[ticketify test:sql] pro-subscription smoke test passed.\n');
