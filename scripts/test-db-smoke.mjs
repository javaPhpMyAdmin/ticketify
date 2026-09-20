/**
 * Local runner for the SQL smoke tests (supabase/tests/pro-subscription.sql,
 * supabase/tests/household-totals.sql, supabase/tests/user-categories.sql,
 * supabase/tests/recalculate-on-purchase-items-update.sql,
 * supabase/tests/household-gate-tier.sql,
 * supabase/tests/trial-cutover.sql,
 * supabase/tests/delete-account.sql and
 * supabase/tests/legal-acceptances.sql).
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
 *      the assertions see what the migrations declare, plus the platform's
 *      default table/sequence grants (see the overlay note below).
 *   4. Re-applies the platform table/sequence grants (regression guard: some
 *      CLI `db reset` versions boot with truncated default privileges, see
 *      the grant step below).
 *   5. `supabase db query --local --file <smoke-test>` — runs each READ-ONLY
 *      smoke test (plain DO/assert blocks, NOT pgTAP, so `supabase test db`
 *      is not used). Any raised assertion fails the query, which propagates
 *      as a non-zero exit and fails this script.
 *
 * Overlay note: the smoke tests assert RLS-level and function-ACL contracts,
 * never raw table grants — the platform grants this script restores are
 * exactly what the Supabase platform applies in production, and they are
 * REQUIRED for the RLS assertions to run under restricted roles (the anon
 * "denied" pins are policy-level, not table-grant-level). A future migration
 * that revokes table-level grants would be masked by this overlay; keep
 * asserting at the RLS/routine level, not on raw table grants.
 *
 * Requirements: Docker daemon running + the Supabase CLI (`supabase`) on PATH.
 *
 * Run: pnpm test:sql
 */

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

console.log('\n== Restoring platform table grants (CLI boot regression guard) ==\n');
// Some `supabase db reset` CLI versions (the v2.111-era init regression) boot
// with truncated default privileges for the `postgres` role in schema public:
// anon/authenticated/service_role end up with only TRUNCATE/REFERENCES/
// TRIGGER/MAINTAIN on postgres-created tables (no SELECT/INSERT/UPDATE/
// DELETE). Any smoke test that exercises RLS under a restricted role then
// dies — user-categories.sql §5 (`set local role authenticated` + the first
// write) fails with `permission denied for table categories`. CI's db-smoke
// job pins CLI v2.116.0, whose boot applies the full platform grants, so the
// same file passes there; this step makes the harness deterministic across
// CLI versions instead of depending on boot behavior.
//
// It re-applies exactly the platform's documented grants (live tables +
// sequences + default privileges for tables/sequences). Functions are
// deliberately NOT touched: the migrations explicitly revoke EXECUTE from
// anon/public on the security-sensitive RPCs and the smoke tests assert that
// least-privilege contract.
// Unique-per-process name + 0600 mode: two concurrent `pnpm test:sql` runs
// never share a path (a fixed shared name could let one run's cleanup remove
// the file while the other's CLI is still reading it). Write happens inside
// try/finally so a partial write can never leave a stale artifact behind.
const grantsFile = join(tmpdir(), `ticketify-platform-grants-${process.pid}.sql`);
try {
  writeFileSync(
    grantsFile,
    [
      'do $$',
      'begin',
      '  grant usage on schema public to anon, authenticated, service_role;',
      '  grant all on all tables in schema public to anon, authenticated, service_role;',
      '  grant all on all sequences in schema public to anon, authenticated, service_role;',
      '  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;',
      '  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;',
      'end $$;',
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
  run(['db', 'query', '--local', '--file', grantsFile]);
} finally {
  rmSync(grantsFile, { force: true });
}

console.log('\n== Running pro-subscription SQL smoke test ==\n');
run(['db', 'query', '--local', '--file', join('supabase', 'tests', 'pro-subscription.sql')]);

console.log('\n== Running household-totals SQL smoke test ==\n');
run(['db', 'query', '--local', '--file', join('supabase', 'tests', 'household-totals.sql')]);

console.log('\n== Running user-categories SQL smoke test ==\n');
run(['db', 'query', '--local', '--file', join('supabase', 'tests', 'user-categories.sql')]);

console.log('\n== Running household-gate-tier SQL smoke test ==\n');
run(['db', 'query', '--local', '--file', join('supabase', 'tests', 'household-gate-tier.sql')]);

console.log('\n== Running trial-cutover SQL smoke test ==\n');
run(['db', 'query', '--local', '--file', join('supabase', 'tests', 'trial-cutover.sql')]);

console.log('\n== Running delete-account SQL smoke test ==\n');
run(['db', 'query', '--local', '--file', join('supabase', 'tests', 'delete-account.sql')]);

console.log('\n== Running legal-acceptances SQL smoke test ==\n');
run(['db', 'query', '--local', '--file', join('supabase', 'tests', 'legal-acceptances.sql')]);

console.log('\n[ticketify test:sql] SQL smoke tests passed.\n');
