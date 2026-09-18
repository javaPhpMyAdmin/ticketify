# Archive Report — Privacy Policy + Terms & Conditions (Legal Links) — COMPLETE ARCHIVE

> **Change**: `privacy-terms`
> **Capability**: `legal-links`
> **Archive date**: 2026-09-17
> **Archive location**: `mobile/openspec/changes/archive/2026-09-17-privacy-terms/`
> **Artifact store**: hybrid (this file + Engram `sdd/privacy-terms/archive-report` — persisted by the orchestrator)
> **Archive type**: ✅ **COMPLETE ARCHIVE** — 11/11 tasks implemented + 1 remediation (T-FIX-1); re-verify verdict CLEAN.
> **SDD cycle status**: ✅ Fully complete. Change implemented, verified clean, ready for user git/PR decision. Working tree only — NOT committed, NOT pushed, no branch created.

---

## 1. Executive Summary

The `privacy-terms` SDD change shipped the `legal-links` capability end-to-end: an injectable, never-throwing external-link opener (`openExternalUrl`), a locale-aware legal URL map (`LEGAL_URLS` + `legalUrlFor` with es-AR fallback), a Legal group in Settings (between the main list and the danger zone), legal links on the sign-up footer (pre-auth safe), legal i18n keys across all three catalogs (`es-AR`/`en`/`pt-BR`), and a `test-legal-links` harness wired into the `pnpm test` chain. All 7 requirements (REQ-1..REQ-7) and the 3 NFRs are implemented. The initial verify (PASS WITH WARNINGS) surfaced two remediable findings; the remediation run (**T-FIX-1**, recorded in Engram #1389 rev.2) closed both plus the SUGGESTION, and the scoped re-verify returned **CLEAN** — all findings closed, zero regression, RED reproduced byte-for-byte. Final evidence: harness **17/17**, `test:auth` **57/57**, typecheck **0**, lint **0** (55 pre-existing warnings). The master `pnpm test` chain exits 1 **only** on the pre-existing `test:sql` RLS failure (unrelated infra issue; zero SQL files touched). Remaining gates are user-owned (manual device smoke for REQ-3/REQ-4, the `example.com` → real-domain release swap). All changes are **uncommitted** in the working tree; the git lifecycle (commit/PR) is the user's decision, owned by the orchestrator.

---

## 2. Delta-sync outcome — spec authored at final path, NO merge performed

**Result: no spec sync was required.** This change deviates from the OpenSpec delta convention, and the deviation is recorded explicitly rather than papered over:

- **Repo convention (per `_shared/openspec-convention.md` + the `delete-account` precedent)**: `sdd-spec` writes a **delta** spec (`## ADDED/MODIFIED Requirements` blocks) under `openspec/changes/{change}/specs/{domain}/spec.md`; `sdd-archive` merges it into the main spec at `openspec/specs/{domain}/spec.md`, appending a `> Source: change \`{change}\` (archived {date}). Merged from delta ...` annotation (see `openspec/specs/user-auth/spec.md:191,210,232` and `openspec/specs/household-sharing/spec.md:223,260`).
- **What happened here**: the `legal-links` spec was authored **directly at its final path** (`openspec/specs/legal-links/spec.md`) during the spec phase. The active change directory `openspec/changes/privacy-terms/` contains **no `specs/` subdirectory** and no delta blocks (verified: only `design.md`, `exploration.md`, `proposal.md`, `tasks.md`, `verify-report.md` moved to the archive).
- **Structural mismatch flagged**: the change dir shape does not match the convention (missing `specs/{domain}/spec.md` delta). The outcome is functionally equivalent — the spec **is already the final source of truth**, with REQ-1..REQ-7 + 3 NFRs + 5 acceptance gates, and the harness/screens reference it consistently. Re-running a delta "merge" here would duplicate content, which the archive instructions explicitly forbid. No annotation was added and no content was modified; the spec was **not touched by archive** (verified unchanged before/after).
- **Recommendation for future changes**: prefer the delta-under-change-dir convention so the archive merge step is mechanical; if a spec is authored at the final path again, the archive report must record the same explicit no-merge outcome.

---

## 3. REQ implementation status — REQ-1..REQ-7 + NFRs

Every requirement is implemented and verified. Source of truth: `openspec/specs/legal-links/spec.md`.

| REQ | Title | Status | Evidence |
|-----|-------|--------|----------|
| **REQ-1** | External-link opener contract | ✅ **PASS** | Harness section 1 — 3/3 + 5 adversary probes (sync-throw → `false`, `123`/`null` opener → `false`, non-promise → `true`, string-reject → `false`). `src/lib/open-external-url.ts` — try/catch, never throws, default opener = `WebBrowser.openBrowserAsync` |
| **REQ-2** | Locale-aware legal URL map | ✅ **PASS** | Harness sections 2–3 — 7 original cases + 4 T-FIX-1 cases (3 prototype-key locales + unknown document) → 11/11. `legalUrlFor` falls back to es-AR via own-property guard; all 6 URLs `https:`. Prototype-key gap (verify WARNING #2) CLOSED |
| **REQ-3** | Settings Legal group | ✅ **PASS** (code) / 🔶 MANUAL (device smoke) | `profile.tsx` — `legalRows` defined separately from `settings[]` (slice/danger split untouched, diff-verified); second `AccountSettingsList` between `:361` and `:363`; rows 178/185 open active-locale URLs, no in-app navigation |
| **REQ-4** | Sign-up footer legal links | ✅ **PASS** (code) / 🔶 MANUAL (device smoke) | `sign-up.tsx:168-185` — prefix + `and` connectors with `settings:` labels, `accessibilityRole="link"`, pre-auth clean (no session/auth imports in libs), silent rejection via REQ-1 contract |
| **REQ-5** | i18n catalog parity | ✅ **PASS** | Harness section 4 — 3/3; `settings` 108/108/108 keys, `auth` 47/47/47; 5 new legal keys, values verbatim from design, trailing spaces intact |
| **REQ-6** | Test harness | ✅ **PASS** | 17/17 standalone (`node scripts/test-legal-links.mjs` + `pnpm test:legal-links`) and in-chain at position 37 (0-based; 38th of 39 scripts) between `test:i18n-init` and `test:sql` |
| **REQ-7** | Placeholder lifecycle + release gate | ✅ **PASS** (dev) / 🔶 MANUAL (release) | 6 `https://example.com/...` placeholders each flagged `// TODO(user): real URL`; harness asserts `https:` only, never `example.com` (gate, not contract) |
| NFR Pre-auth safety | — | ✅ **PASS** | libs import only `expo-web-browser` + `@/i18n/detector` |
| NFR Accessibility | — | ✅ **PASS** | `AccountSettingsList.tsx:66` + sign-up explicit `t()` labels + `link` role; no hardcoded literals |
| NFR Typecheck | — | ✅ **PASS** | `pnpm typecheck` exit 0 |
| Gate 1 `pnpm test` | — | 🔶 PARTIAL | `test:legal-links` green and in position; master exits 1 on pre-existing `test:sql` only (see §5) |
| Gate 2 `pnpm typecheck` | — | ✅ **PASS** | exit 0 |
| Gate 3 Manual: Legal group | — | 🔶 MANUAL | device smoke (user-owned) |
| Gate 4 Manual: sign-up footer | — | 🔶 MANUAL | fresh install, no session (user-owned) |
| Gate 5 Release: no example.com | — | 🔶 MANUAL | real-domain swap (user-owned) |

**Coverage**: 15/17 scenarios compliant at runtime; 2 MANUAL-NEEDED by spec design (REQ-3/REQ-4 interactive scenarios — repo has no component-render harness, manual by design).

---

## 4. Findings — ALL CLOSED by remediation T-FIX-1

The initial verify returned PASS WITH WARNINGS (`partial`) with 1 CRITICAL + 1 WARNING + 3 SUGGESTIONs. The remediation run closed all of them; the scoped re-verify returned **CLEAN**.

| Finding | Severity | Verdict | Evidence |
|---------|----------|---------|----------|
| F1 — apply-progress lacks TDD Cycle Evidence table | CRITICAL (process) | ✅ CLOSED | Engram #1389 rev.2 backfilled a 12-row per-task table (T-1.1..T-3.2 + T-FIX-1) with RED/GREEN/TRIANGULATE/SAFETY NET columns. Honesty check passed: T-2.4/T-3.1 self-report `RED inferred` (no render harness); T-1.3 RED references obs #1387 (created 20:50:43, before remediation) — cannot be retrofitted |
| F2 — `legalUrlFor` prototype-key inherited garbage | WARNING (code) | ✅ CLOSED | `src/lib/legal-urls.ts:42-50` guards BOTH lookups with `Object.prototype.hasOwnProperty.call`; `'constructor'`/`'__proto__'`/`'toString'` → es-AR URL; harness lines 214-233 assert. Valid typed inputs unchanged |
| F3 — `legalUrlFor('bogus', 'en')` TypeError | SUGGESTION | ✅ CLOSED | Same guard branch: unknown document → es-AR privacy URL, no throw (harness 237-240) |
| F4 — Gate 1 not green (pre-existing `test:sql`) | SUGGESTION | ⏸ NOT A FINDING | Pre-existing infra issue, zero SQL files touched — tracked in §5, not a change defect |
| F5 — no automated test for REQ-3/REQ-4 interactivity | SUGGESTION | ⏸ BY DESIGN | Repo has no component-render harness; manual smoke by design (Gates 3/4) |

**Re-verify claim confirmation** (all four claims in `verify-report.md` re-verify section confirmed):
- Claim A (Finding 2 closed) — CONFIRMED empirically: `Object.hasOwn` fails typecheck under the harness `es2020` lib settings (`TS2550`), proving `hasOwnProperty.call` was the correct choice.
- Claim B (Finding 1 closed) — CONFIRMED: table present, per-task, honest about inferred REDs.
- Claim C (no regression) — CONFIRMED: `git diff --stat` byte-identical to the original apply footprint (116 insertions / 8 deletions / 10 tracked files); mtimes prove remediation scope limited to `legal-urls.ts` + `test-legal-links.mjs`; harness 13 → 17 with the original 13 still green.
- Claim D (RED was real) — CONFIRMED: pre-fix expression rebuilt in a throwaway script reproduced the 4 failures byte-for-byte (`+ [Function: Object]`, `+ [Object: null prototype] {}`, `+ [Function: toString]`, `TypeError: Cannot read properties of undefined (reading 'en')`).

New findings after remediation: **none** (CRITICAL / WARNING / SUGGESTION). Two cosmetic notes recorded (non-blocking): "position 37" is 0-based across artifacts and consistent with live execution; harness temp dirs under `node_modules/.tmp` are gitignored and cleaned in `finally`.

---

## 5. Pre-existing gate failure (NOT a privacy-terms regression)

The master `pnpm test` chain exits 1 **only** on `pnpm test:sql` — `permission denied for table categories` (RLS) against the local Supabase DB. This is **not** caused by this change:

- Fails identically standalone; zero SQL/RLS/migration files touched by `privacy-terms`.
- Postgres RLS permission denial occurs at query time in the SQL test harness.
- The same pre-existing observation is recorded in apply session summary #1388 and matched the `delete-account` precedent archive (§5 of its archive-report).

**Recommendation**: track and fix `user-categories.sql` test isolation as a separate change. Do not block `privacy-terms` shipping on this.

---

## 6. Outstanding user-owned gates (NOT archive blockers)

None of these block the archive; all are user decisions or external dependencies surfaced for the release:

| # | Gate | Owner | Status |
|---|------|-------|--------|
| A | **Manual device smoke — REQ-3**: Settings Legal group renders between main list and danger zone; both rows open the active-locale URL in the external browser | User (device) | 🔶 MANUAL-NEEDED (placement + wiring verified statically) |
| B | **Manual device smoke — REQ-4**: sign-up footer link visible pre-auth (fresh install, no session); taps open browser and stay on sign-up | User (device) | 🔶 MANUAL-NEEDED (verified statically) |
| C | **Release swap — REQ-7**: replace the 6 `https://example.com/...` placeholders (`// TODO(user): real URL`) in `src/lib/legal-urls.ts` with real hosted pages on the user-owned domain; record the hosted-privacy URL in Play Console / App Store Connect | User (hosting + store consoles) | 🔶 MANUAL-NEEDED — grep-able via `TODO(user)` |
| D | **Master chain green — Gate 1**: pre-existing `test:sql` RLS failure must be fixed for `pnpm test` to exit 0 (separate infra change) | User/separate change | ⏳ PRE-EXISTING |

---

## 7. How to verify the full chain locally

```bash
# 1. TypeScript typecheck (client surface + harness modules)
pnpm typecheck          # exit 0

# 2. The legal-links harness (contract + map + resolver + parity)
pnpm test:legal-links   # 17/17, exit 0

# 3. Stub regression gate (additive web-browser stub change)
pnpm test:auth          # 57/57, exit 0

# 4. Lint
pnpm lint               # 0 errors, 55 pre-existing warnings, exit 0

# 5. Master chain — NOTE pnpm test:sql fails (pre-existing RLS, see §5); test:legal-links runs green at position 37:
# pnpm test
```

---

## 8. Task completion state

| Set | Tasks | State |
|-----|-------|-------|
| WU-1 (libs + contracts) | T-1.1 .. T-1.5 | ✅ 5/5 `[x]` |
| WU-2 (i18n + Settings Legal group) | T-2.1 .. T-2.4 | ✅ 4/4 `[x]` |
| WU-3 (sign-up footer + chain wiring) | T-3.1 .. T-3.2 | ✅ 2/2 `[x]` |
| Remediation (verify findings) | T-FIX-1 | ✅ 1/1 (recorded in Engram #1389 rev.2, not a tasks.md row) |

**11/11 tasks complete + 1 remediation.** Implementation footprint: **14 files (4 new + 10 modified), ≈491 lines** (367 new; 116 insertions / 8 deletions on tracked files) — over the ~370 forecast, within the 800-line session budget. Archived `tasks.md` contains **zero unchecked implementation tasks** (all 11 T-* rows `[x]`; task-completion gate passed before sync/move). The 8 remaining `- [ ]` rows are the **Pre-deploy checklist** (lines 117-124 — release gates tracked by verify, not implementation tasks), matching the `delete-account` precedent whose archived tasks.md also retains unchecked pre-deploy checklist items. The proposal's 5 success-criteria checkboxes remain as authored (intent-level criteria, not implementation tasks).

---

## 9. Git state — UNCOMMITTED, working tree only

| Item | State |
|------|-------|
| Branch | `main` (no feature branch created) |
| Commits | **NONE** — nothing committed, nothing pushed |
| Implementation changes | 10 modified tracked files (116+/8-) + 4 new untracked source files (`src/lib/open-external-url.ts`, `src/lib/legal-urls.ts`, `scripts/test-legal-links.mjs`, `scripts/tsconfig.legal-links-test.json`) |
| OpenSpec changes | `openspec/specs/legal-links/` (new final spec) + `openspec/changes/archive/2026-09-17-privacy-terms/` (archived change) |
| Who decides git lifecycle | **User** — orchestrator owns commit/PR execution after this report |

The planned delivery was a single small PR (`feat/legal-links`, ~370-491 lines, under the 400-line review budget forecast as Low risk — actuals ~491 lines, a modest overshoot on the forecast, still a single-PR-sized diff). Commit strategy per tasks.md: 3 WU commits (or `feat(auth)` + `chore(test)` split for WU-3) — at the user's discretion.

---

## 10. Resume instructions

**Empty — the change is archived, not paused.**

The SDD cycle is complete pending the user's git decision. Future work (real legal pages + domain, `test:sql` RLS fix, device smoke findings, store console entries) should be tracked as **new SDD changes** with their own explore/proposal/spec/design/tasks/apply/verify/archive cycle. Do not resume this archive.

---

## 11. What / Why / Where / Learned

**What**: Complete archive of the `privacy-terms` SDD change (capability `legal-links`) after 11/11 tasks + remediation T-FIX-1 and a CLEAN scoped re-verify. No delta merge was required — the spec was authored directly at its final path `openspec/specs/legal-links/spec.md` and left untouched. Moved the entire change folder to `openspec/changes/archive/2026-09-17-privacy-terms/` (5 artifacts preserved).

**Why**: The user requested the archive phase after implementation + verification completed clean. This closes the SDD cycle and records the outstanding user-owned gates (manual device smoke, real-domain swap, pre-existing `test:sql` RLS failure) for the release decision.

**Where**:
- `mobile/openspec/specs/legal-links/spec.md` — final spec (REQ-1..REQ-7 + 3 NFRs + 5 gates), authored at final path, **not modified by archive**
- `mobile/openspec/changes/archive/2026-09-17-privacy-terms/` — exploration.md, proposal.md, design.md, tasks.md, verify-report.md, this archive-report.md
- Engram `sdd/privacy-terms/archive-report` (project `coronatracker`, topic_key upsert) — persisted by the orchestrator from this file; reference IDs: apply-progress #1389 (rev.2, TDD Cycle Evidence table), apply session summary #1388, T-1.3 RED reference #1387, verify finding #1391
- Implementation (unchanged by archive, working tree): `src/lib/open-external-url.ts`, `src/lib/legal-urls.ts`, `src/app/(tabs)/profile.tsx`, `src/app/(auth)/sign-up.tsx`, 6 catalog JSONs, `scripts/test-legal-links.mjs`, `scripts/tsconfig.legal-links-test.json`, `scripts/test-stubs/web-browser.ts`, `package.json`

**Learned**:
1. **When a spec is authored directly at its final path, the archive merge step is a no-op — but the deviation must be recorded, not silently skipped.** The delta-under-change-dir convention exists to make the merge mechanical and the audit trail complete; this change's outcome is equivalent (final spec IS the source of truth), yet the change dir lacked the `specs/{domain}/spec.md` delta the convention expects. Future spec phases should prefer the delta path; future archives should check for this shape.
2. **The `Object.hasOwn` suggestion would have broken the strict harness compile** (`es2020` lib → `TS2550`); `Object.prototype.hasOwnProperty.call` has identical own-property semantics and typechecks under both harness (es2020) and root (ESNext) configs. Verified empirically, not assumed.
3. **RED honesty in the TDD table**: tasks with no render harness (T-2.4, T-3.1) self-report `RED inferred` instead of claiming a captured RED — the re-verify's honesty check confirms this is the correct pattern for behavior-gated-by-manual tasks.
4. **The pre-existing `test:sql` RLS failure is a recurring archive-report fixture** (same failure documented in the `delete-account` archive §5) — it will keep master `pnpm test` red until fixed as a separate infra change; zero SQL files were touched by `privacy-terms`.
5. **Manifest line-count drift**: forecast ~370 → actual ≈491 lines (14 files). Still single-PR-sized and under the 800-line session budget; the overshoot came from the 4 T-FIX-1 harness cases + guard code. Future forecasts for harness-heavy changes should budget for remediation cases.

---

**Change archived.** SDD cycle complete. Next real step: user's git/PR decision (commit the working tree as the planned single `feat/legal-links` PR), then the pending user-owned gates (§6).