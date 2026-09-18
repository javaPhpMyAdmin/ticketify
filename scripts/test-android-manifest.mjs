#!/usr/bin/env node
/**
 * Post-prebuild Android manifest assertion — RECORD_AUDIO (Play compliance).
 *
 * The `legal-compliance` change removes the microphone permission from the
 * Android build even though expo-camera could re-add it on upgrades
 * (design AD-6 risk R-6: `blockedPermissions` belt-and-braces). This
 * harness proves the FINAL generated manifest obeys the contract:
 *
 *   - `android/app/src/main/AndroidManifest.xml` MUST NOT DECLARE
 *     RECORD_AUDIO as an active permission (removed from
 *     `expo.android.permissions`, `expo-camera` `recordAudioAndroid: false`,
 *     and `expo.android.blockedPermissions`).
 *   - it MUST carry the `blockedPermissions` merger-remove directive
 *     (`RECORD_AUDIO" tools:node="remove"`) — the manifest merger strips
 *     the permission from the final APK even if a library re-adds it on an
 *     expo-camera upgrade (design AD-6 risk R-6 belt-and-braces).
 *   - it MUST still declare android.permission.CAMERA (a positive control:
 *     the app still scans receipts with the camera; a manifest-less or
 *     empty result must NOT pass the suite).
 *
 * How it runs (sandboxed — never touches the repo's native dirs):
 *   1. Copies app.json + package.json into a scratch dir under
 *      node_modules/.tmp and symlinks `assets` + `node_modules` (plugins
 *      resolve from the real project; `--no-install` skips installs).
 *   2. Runs `expo prebuild --platform android --no-install --clean` in the
 *      scratch dir — regenerates android/ from the CURRENT app.json config
 *      (including every config plugin).
 *   3. Asserts on the generated AndroidManifest.xml, then deletes the
 *      scratch dir. The repo's own android/ (gitignored, possibly carrying
 *      local native tweaks) is never modified.
 *
 * Usage: pnpm test:android-manifest  (or: node scripts/test-android-manifest.mjs)
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const expoCli = join(root, 'node_modules', 'expo', 'bin', 'cli');

if (!existsSync(expoCli)) {
  console.error(
    '\n[test-android-manifest] expo CLI not found at node_modules/expo/bin/cli.\n' +
      '  Run `pnpm install` first, then re-run `pnpm test:android-manifest`.\n',
  );
  process.exit(1);
}

// Sandboxed prebuild: a scratch copy of the config + symlinked node_modules
// (so config plugins resolve) — the repo's native directories stay intact.
const scratch = mkdtempSync(join(root, 'node_modules', '.tmp', 'android-manifest-test-'));
const scratchManifest = join(scratch, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');

try {
  copyFileSync(join(root, 'app.json'), join(scratch, 'app.json'));
  copyFileSync(join(root, 'package.json'), join(scratch, 'package.json'));
  for (const entry of ['assets', 'node_modules']) {
    symlinkSync(join(root, entry), join(scratch, entry), 'dir');
  }

  console.log('\n[test-android-manifest] running expo prebuild in a scratch dir (--platform android --no-install --clean)…');
  // The scratch dir is passed as the project-dir positional argument so the
  // repo's own android/ (gitignored, possibly carrying local native tweaks)
  // is NEVER the prebuild target.
  execFileSync(
    process.execPath,
    [expoCli, 'prebuild', scratch, '--platform', 'android', '--no-install', '--clean'],
    {
      cwd: scratch,
      stdio: ['ignore', 'inherit', 'inherit'],
    },
  );

  // readFileSync throws if prebuild produced no manifest — a prebuild
  // failure must fail this suite, not pass it via a missing-file check.
  const manifest = readFileSync(scratchManifest, 'utf8');
  console.log('[test-android-manifest] asserting the generated AndroidManifest.xml…');

  // Positive control: the manifest is REAL (the app still declares the
  // camera permission it needs for receipt scanning) — proves the
  // prebuild genuinely ran instead of producing an empty stub.
  assert.ok(
    manifest.includes('android.permission.CAMERA'),
    'AndroidManifest.xml must still declare android.permission.CAMERA (receipt scanning)',
  );

  // RECORD_AUDIO must not be DECLARED as an active permission. The only
  // legal occurrence of the string is the blockedPermissions merger-remove
  // directive; a plain `<uses-permission ... RECORD_AUDIO/>` declaration
  // must fail.
  assert.ok(
    !/android\.permission\.RECORD_AUDIO"(?:\s*\/)?>/.test(manifest),
    'AndroidManifest.xml must not DECLARE RECORD_AUDIO as an active permission (removed from expo.android.permissions + expo-camera recordAudioAndroid: false)',
  );
  assert.ok(
    manifest.includes('android.permission.RECORD_AUDIO" tools:node="remove"'),
    'AndroidManifest.xml must carry the blockedPermissions merger-remove directive for RECORD_AUDIO (gradle strips it from the final merged manifest)',
  );

  console.log(`\n[test-android-manifest] PASSED — CAMERA declared, RECORD_AUDIO removed via blockedPermissions merger directive (${scratchManifest})`);
} catch (err) {
  console.error('\n[test-android-manifest] FAILED:', String((err && err.stack) || err));
  process.exitCode = 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}