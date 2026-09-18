# Verify Report: Privacy Policy + T&C (`privacy-terms`)

**Change**: `privacy-terms` (capability `legal-links`)
**Version**: spec `openspec/specs/legal-links/spec.md` (REQ-1..REQ-7 + NFRs + 5 gates)
**Mode**: Strict TDD (runner: `pnpm test`, harness `scripts/test-legal-links.mjs`)
**Verdict**: PASS WITH WARNINGS — status `partial`

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 11 (all `[x]`) |
| Tasks complete | 11 — confirmed by source + runtime evidence |
| Implementation files | 14 (10 modified + 4 new; ≈491 lines) |

## Build & Tests Execution

- `pnpm typecheck` → exit 0 (no diagnostics)
- `pnpm lint` → exit 0 (0 errors, 55 pre-existing warnings — none in changed lines)
- `node scripts/test-legal-links.mjs` → 13/13 passed, exit 0
- `pnpm test:legal-links` → 13/13, exit 0
- `pnpm test:auth` → 57/57, exit 0 (stub regression gate)
- `pnpm test:sql` → exit 1 (PRE-EXISTING RLS: `permission denied for table categories`)
- `pnpm test` (master chain) → exit 1, only failure = `test:sql`; `test:legal-links` green at position 37 between `test:i18n-init` and `test:sql`

Coverage: not available (dependency-free node harness pattern; not a failure).

## Spec Compliance Matrix

| Requirement | Scenario | Result |
|-------------|----------|--------|
| REQ-1 | Open succeeds | ✅ COMPLIANT |
| REQ-1 | Open rejected / browser unavailable | ✅ COMPLIANT (+ adversary probes) |
| REQ-1 | Default opener used | ✅ COMPLIANT |
| REQ-2 | Known locale resolves | ✅ COMPLIANT |
| REQ-2 | Unsupported locale falls back to es-AR | ✅ COMPLIANT (⚠️ inherited-key edge, Finding 2) |
| REQ-3 | Legal group renders in place | ⚠️ PARTIAL (MANUAL-NEEDED) |
| REQ-3 | Row opens the active-locale URL | ⚠️ PARTIAL (MANUAL-NEEDED) |
| REQ-4 | Links visible pre-auth | ⚠️ PARTIAL (MANUAL-NEEDED) |
| REQ-4 | Tap opens the legal document in-browser | ⚠️ PARTIAL (MANUAL-NEEDED) |
| REQ-5 | Full parity across catalogs | ✅ COMPLIANT |
| REQ-5 | Divergence is detected | ✅ COMPLIANT |
| REQ-6 | Suite runs green | ✅ COMPLIANT |
| REQ-6 | Rejecting stub verified | ✅ COMPLIANT |
| REQ-7 | Placeholders work during development | ✅ COMPLIANT |
| REQ-7 | Release blocks on example.com | ⚠️ MANUAL-NEEDED |

15/17 scenarios compliant at runtime; 2 MANUAL-NEEDED by spec design.

## Coherence (Design AD-1..AD-7)

All 7 decisions followed verbatim (verified against source, not the executor's summary).

## Findings

### CRITICAL

**1. Apply-progress lacks the TDD Cycle Evidence table (process/documentation)**
- Where: Engram #1389 (`sdd/privacy-terms/apply-progress`) + #1388
- Required: under Strict TDD, `strict-tdd-verify.md` Step 5a mandates a per-task RED/GREEN/TRIANGULATE/SAFETY NET table; its absence is a CRITICAL protocol flag.
- Actual: prose narration of WU statuses, no literal table.
- Counter-evidence: the TDD claims ARE substantiated at runtime (harness green = GREEN; `test:auth` 57/57 after stub mod = SAFETY NET; RED observable via load-time `ERR_MODULE_NOT_FOUND`).
- Fix: backfill the per-task table into apply-progress before archive.

### WARNING

**2. `legalUrlFor` returns inherited-prototype garbage for prototype-key locales**
- Where: `src/lib/legal-urls.ts:33` — `LEGAL_URLS[document][locale as SupportedLocale] ?? LEGAL_URLS[document][DEFAULT_LOCALE]` over plain object literals (:19-30)
- Required: REQ-2 "SHALL fall back to the es-AR URL for **any** missing or unsupported locale."
- Actual: for `'constructor' | '__proto__' | 'toString'`, `??` does not trigger (inherited props are non-null) → returns `[Function: Object]`, `Object.prototype`, `[Function: toString]` instead of es-AR.
- Practical exposure: **none today** — `activeLocale` is typed `SupportedLocale` and call sites pass literals; `fr-FR`/`''`/`undefined` all fall back correctly.
- Fix (1 line): `Object.hasOwn(LEGAL_URLS[document], locale) ? LEGAL_URLS[document][locale as SupportedLocale] : LEGAL_URLS[document][DEFAULT_LOCALE]` (or `Object.create(null)` maps).

### SUGGESTION

**3.** `legalUrlFor('bogus' as any, 'en')` throws `TypeError` — same file, same fix as Finding 2.
**4.** Acceptance gate 1 cannot be green until the pre-existing `test:sql` RLS failure is fixed — separate infra issue.
**5.** REQ-3/REQ-4 interactive scenarios have no automated covering test — repo has no component-render harness; manual by design.

## REQ-by-REQ Verdict

| Requirement | Verdict | Evidence |
|-------------|---------|----------|
| REQ-1 opener contract | ✅ PASS | 3/3 harness + 5 adversary probes (sync-throw → false, `123`/`null` opener → false, non-promise → true, string-reject → false) |
| REQ-2 URL map + resolver | ✅ PASS (⚠️ note) | 7/7; prototype-key gap = WARNING 2 |
| REQ-3 Settings Legal group | ✅ PASS (code) / 🔶 MANUAL | profile.tsx:382-401, diff-verified slice split untouched, rows 178/185 |
| REQ-4 Sign-up footer | ✅ PASS (code) / 🔶 MANUAL | sign-up.tsx:168-185, pre-auth clean, silent rejection |
| REQ-5 i18n parity | ✅ PASS | 3/3; 108/108/108 settings, 47/47/47 auth; values verbatim from design; trailing spaces intact |
| REQ-6 Harness | ✅ PASS | 13/13 standalone + in-chain at position 37 |
| REQ-7 Placeholders + release gate | ✅ PASS (dev) / 🔶 MANUAL | 6 `example.com` + `// TODO(user): real URL`; zero example.com assertions in harness |
| NFR Pre-auth safety | ✅ PASS | lib imports only `expo-web-browser`, `@/i18n/detector` |
| NFR Accessibility | ✅ PASS | `AccountSettingsList.tsx:66` + sign-up explicit `t()` labels + `link` role |
| NFR Typecheck | ✅ PASS | exit 0 |
| Gate 1 `pnpm test` | 🔶 PARTIAL | legal-links green + in position; master exits 1 on pre-existing `test:sql` only |
| Gate 2 typecheck | ✅ PASS | exit 0 |
| Gate 3 Manual: Legal group | 🔶 MANUAL | device smoke |
| Gate 4 Manual: sign-up footer | 🔶 MANUAL | fresh install, no session |
| Gate 5 Release: no example.com | 🔶 MANUAL | user-owned domain swap |

## TDD Compliance

| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | ❌ | apply-progress has no per-task RED/GREEN/TRIANGULATE/SAFETY-NET table (Finding 1) |
| All tasks have tests | ✅ | 11/11 |
| RED confirmed | ✅ | 13 tests exist; RED observable via load-time `ERR_MODULE_NOT_FOUND` |
| GREEN confirmed | ✅ | 13/13 direct + in-chain |
| Triangulation adequate | ✅ | 13 cases across 4 behaviors |
| Safety net for modified files | ✅ | `test:auth` 57/57 after additive stub change; catalogs covered by parity section |

**5/6** (evidence substance fully substantiated; table formatting missing).

## Assertion Quality

✅ All assertions verify real behavior — no tautologies, no ghost loops, no type-only assertions, no implementation-detail coupling, no `example.com` assertion. The rejecting-stub test enforces "no exception escapes" via the `test()` wrapper.

## Pre-existing vs Caused-by-This-Change

| Failure | Classification | Evidence |
|---------|---------------|----------|
| Master `pnpm test` exit 1 (`test:sql`) | **PRE-EXISTING** | (a) fails identically standalone; (b) zero SQL/RLS files touched; (c) Postgres RLS permission denial at query time; (d) apply summary #1388 records the same pre-existing observation |
| `test:legal-links` in master chain | Caused-by-this-change — PASSES | green at position 37, after all 37 prior suites exited 0 |
| Anything else | None | every other suite green; typecheck 0; lint 0 |

## Pre-deploy Checklist

| Item | Status |
|------|--------|
| `pnpm typecheck` exits 0 | ✅ VERIFIED |
| `pnpm lint` exits 0 | ✅ VERIFIED |
| `pnpm test:legal-links` exits 0 standalone | ✅ VERIFIED |
| `pnpm test:auth` exits 0 (stub regression) | ✅ VERIFIED |
| `pnpm test` master chain exits 0 | ❌ NOT GREEN — blocked by PRE-EXISTING `test:sql`; legal-links position + greenness verified in chain |
| Manual: Settings Legal group | 🔶 MANUAL-NEEDED (placement verified statically) |
| Manual: sign-up footer pre-auth | 🔶 MANUAL-NEEDED (verified statically) |
| Release gate: no `example.com` | 🔶 MANUAL-NEEDED (user-owned) |

## What CANNOT Be Verified Automatically

- Gates 3 & 4 (device smoke): no component/e2e harness in repo — manual by design.
- Gate 5 (release): real-domain swap is user-owned.
- Gate 1's green outcome: blocked by the environmental `test:sql` RLS failure.

## Verdict

**PASS WITH WARNINGS.** Correctly implemented, spec-compliant at runtime (harness 13/13, auth 57/57, typecheck 0, lint 0), fully additive, zero new failures. Not archive-clean yet: one WARNING code hardening (Finding 2), one CRITICAL process gap (Finding 1), plus open manual/release gates. The only failing command (`pnpm test`) fails on a verified pre-existing `test:sql` RLS issue.

**Next recommended**: ~~`apply`~~ → superseded by the re-verify below.

---

# Re-verify (post-remediation) — SCOPED

**Status**: `success` · **Verdict**: CLEAN — all findings closed, zero regression.

## Finding verdicts

| Finding | Verdict | Evidence |
|---------|---------|----------|
| #1 CRITICAL — missing TDD Cycle Evidence table | ✅ CLOSED | Engram #1389 rev.2 now carries a 12-row per-task table (T-1.1..T-3.2 + T-FIX-1) with RED/GREEN/TRIANGULATE/SAFETY NET columns. Honesty check passed: T-2.4/T-3.1 self-report `RED inferred` (no component-render harness) instead of claiming captured RED. Cross-validation: the T-1.3 RED explanation references obs #1387, created 20:50:43 — *before* the remediation, so it cannot be retrofitted. |
| #2 WARNING — prototype-key inherited garbage | ✅ CLOSED | `src/lib/legal-urls.ts:42-50` guards BOTH lookups with `Object.prototype.hasOwnProperty.call`. `'constructor'`/`'__proto__'`/`'toString'` → es-AR URL. Harness lines 214-233 assert it. Valid typed inputs unchanged (own-property check passes → same value as the original AD-7 contract). |
| #3 SUGGESTION — bogus document TypeError | ✅ CLOSED | Same guard branch: `legalUrlFor('bogus' as never, 'en')` → es-AR privacy URL, no throw (harness 237-240). |

## Claim verdicts

- **Claim A (Finding 2 closed)** → CONFIRMED. The `es2020` typing rationale is real and was verified **empirically**: a probe compiled with the harness lib settings fails `Object.hasOwn` with `TS2550: Property 'hasOwn' does not exist on type 'ObjectConstructor'` (exit 2). The original suggestion in this report (`Object.hasOwn`) would have broken the harness compile step — the executor's `hasOwnProperty.call` is the correct choice, typed under both the harness (es2020) and root (ESNext) configs.
- **Claim B (Finding 1 closed)** → CONFIRMED. Table present, per-task, honest. Structural tasks (T-1.1 additive stub, T-1.2 tsconfig, T-3.2 wiring) record regression baselines instead of a RED, which is defensible for behavior-free changes.
- **Claim C (no regression)** → CONFIRMED. `git diff --stat` byte-identical to the original apply footprint (116 insertions / 8 deletions / 10 tracked files). **mtimes prove the remediation scope**: only `legal-urls.ts` (21:07:50) and `test-legal-links.mjs` (21:08:32) fall in the remediation window; the other 12 files are stamped 20:36–20:43. Harness 13 → 17 with the original 13 still green.
- **Claim D (RED was real)** → CONFIRMED, re-derivation not needed. The pre-fix expression was rebuilt in a throwaway script and the 4 failing assertions reproduced **byte-for-byte** (`+ [Function: Object]`, `+ [Object: null prototype] {}`, `+ [Function: toString]`, `TypeError: Cannot read properties of undefined (reading 'en')`), matching the captured RED exactly.

## Command evidence (raw, re-run)

| # | Command | Result |
|---|---------|--------|
| 1 | `node scripts/test-legal-links.mjs` | all 17 passed, **exit 0** |
| 2 | `pnpm test:legal-links` | 17/17, **exit 0** |
| 3 | `pnpm test:auth` | 57/57, **exit 0** |
| 4 | `pnpm typecheck` | no diagnostics, **exit 0** |
| 5 | `pnpm lint` | 0 errors / 55 pre-existing warnings, **exit 0** |
| 6 | `pnpm test` (master chain) | **exit 1** — only failure: pre-existing `test:sql` RLS (`permission denied for table categories`); `test:legal-links` green at chain position between `test:i18n-init` and `test:sql`; no NEW failure |
| 7 | `git status --short` + `git diff --stat` | scope confirmed |

## New findings

None CRITICAL / WARNING / SUGGESTION.

- Cosmetic nit (non-blocking): "position 37" phrasing across artifacts is a 0-based chain index (legal-links is the 38th of 39 scripts); all artifacts agree with each other and with live execution.
- Observation (non-finding): the harness writes temp dirs under `node_modules/.tmp` and cleans them in `finally`; a crashed run can leave stale dirs (gitignored, cosmetic).

## Remaining MANUAL-NEEDED gates (user-owned, not archive blockers)

- **Gate 1**: master `pnpm test` cannot exit 0 until the pre-existing `test:sql` RLS failure is fixed (separate infra issue; zero SQL files touched by this change).
- **Gate 3**: device smoke — Settings Legal group renders between main list and danger zone; rows open active-locale URLs.
- **Gate 4**: device smoke — sign-up footer links visible pre-auth (fresh install, no session); taps open browser and stay on sign-up.
- **Gate 5**: release — swap the 6 `https://example.com/...` placeholders (`// TODO(user): real URL`) for real hosted pages.

**Next recommended**: `archive`.
