# Archive Report — Legal Compliance — COMPLETE ARCHIVE

> **Change**: `legal-compliance`
> **Capabilities**: `legal-content`, `legal-consent` (NEW), `legal-links` (MODIFIED)
> **Archive date**: 2026-09-19
> **Archive location**: `mobile/openspec/changes/archive/2026-09-19-legal-compliance/`
> **Artifact store**: hybrid (this file + Engram `sdd/legal-compliance/archive-report` — persisted by the orchestrator)
> **Archive type**: ✅ **COMPLETE ARCHIVE** — 6/6 chained PRs merged (#118 U1 → #119 U2 → #121 U3 → #122 U4 → #123 U5 → #120 U6), main @ `a7c11b8`, working tree clean.
> **SDD cycle status**: ✅ Fully complete. Change implemented, merged, verified. Ready for the next SDD cycle.

---

## 1. Executive Summary

The `legal-compliance` SDD change shipped three Play-Store-blocking capabilities in **6 chained stacked-to-main PRs** under the auto-chain delivery strategy (`400-line budget risk: High`, `Decision needed before apply: Yes`, preflight answered `auto-chain`): (1) **`legal-content`** — bundled static in-app Privacy/Terms screens ×3 locales + Markdown mirror for Pages hosting, no webview/no runtime fetch; (2) **`legal-consent`** — versioned, append-only `legal_acceptances` table + SECURITY DEFINER RPC + sign-up checkbox + blocking gate overlay + deferred flush for email-confirmation sign-ups; (3) **`legal-links`** — in-app navigation helper (`openLegalDocument`) replacing the external opener for Settings rows and sign-up footer, plus the 6 `example.com` placeholders swapped for the real `javaPhpMyAdmin.github.io/ticketify/legal/...` URLs. Bonus: Play-compliant `RECORD_AUDIO` manifest 3-part removal. Every PR merged clean, GitHub Pages is live with all 6 URLs returning 200, working tree clean on main at `a7c11b8`. The change is **fully archived** with the three delta specs merged into the canonical spec set under `openspec/specs/`. Remaining follow-ups are documented (DRAFT legal copy pending legal review; live PostgREST client→definer check noted from the U4 apply phase).

---

## 2. Merge / Sync outcome — 3 specs into the canonical spec set

| Source delta spec | Target canonical | Action | Result |
|-------------------|------------------|--------|--------|
| `openspec/changes/legal-compliance/specs/legal-content/spec.md` | `openspec/specs/legal-content/spec.md` | **NEW full spec** (no prior canonical) | Copied verbatim + top-level archive header; 4 REQs + 3 acceptance gates |
| `openspec/changes/legal-compliance/specs/legal-consent/spec.md` | `openspec/specs/legal-consent/spec.md` | **NEW full spec** (no prior canonical) | Copied verbatim + top-level archive header; 5 REQs + 4 acceptance gates |
| `openspec/changes/legal-compliance/specs/legal-links/spec.md` | `openspec/specs/legal-links/spec.md` | **MODIFIED + RENAMED** | REQ-3 MODIFIED (in-app nav); REQ-4 MODIFIED (in-app nav, pre-check tappable); REQ-7 RENAMED "Placeholder lifecycle…" → "Real hosted URLs…" AND MODIFIED (real-domain assertion, placeholders retired). No duplicate REQ-7. |

### REQ-7 RENAME + MODIFIED resolution (CRITICAL — flagged by spec agent at write time)

The delta spec carried both a `## RENAMED Requirements` block (old → new name with Reason/Migration) AND a `## MODIFIED Requirements` block for the renamed REQ-7. The OpenSpec convention says **apply the RENAME first, then the MODIFIED**, preserving all other REQs unchanged. The canonical merge produced:

- **Single** REQ-7 with the new name `Real hosted URLs and release gate` (no duplicate REQ-7 with the old name).
- New body asserting the hosted Pages URLs and retiring the `TODO(user)` lifecycle.
- New scenarios: "All URLs resolve to the real domain" + "Release blocks on example.com".
- `(Previously: …)` + `(Renamed from …; reason …; migration …)` annotations on the body to preserve the audit trail.
- `> Source: change \`legal-compliance\` (archived 2026-09-19). Merged from delta …` annotation, matching the `delete-account` precedent.

Source-annotation pattern applied to REQ-3, REQ-4, REQ-7 (per repo convention seen at `openspec/specs/user-auth/spec.md:191,210,232` and `openspec/specs/household-sharing/spec.md:223,260`).

REQ-1, REQ-2, REQ-5, REQ-6 in `legal-links` were NOT touched (the delta did not MODIFY them; they remain authoritative as authored in the prior `privacy-terms` archive at 2026-09-17).

---

## 3. PR merge evidence — 6/6 chained stacked-to-main

| PR | Branch | Commit | Title | Status |
|----|--------|--------|-------|--------|
| **#118** | `feat/legal-compliance-u1-db` | `a021c30` | DB + config (0038, smoke, registries, RECORD_AUDIO 3-part, manifest assertion) | ✅ MERGED |
| **#119** | `feat/legal-compliance-u2-content` | `cd912fc` | In-app content (legal ns ×3 + LegalScreen + routes + parity harness) | ✅ MERGED |
| **#121** | `feat/legal-compliance-u3-mirror` | `addc402` | Hosting mirror (generator + 6 md mirrors + mirror harness) | ✅ MERGED |
| **#122** | `feat/legal-compliance-u4-consent` | `88e37e2` | Consent logic + storage (versions, pure fns, flag, RPC client, hook, harness) | ✅ MERGED |
| **#123** | `feat/legal-compliance-u5-gate` | `ab7ce26` | Gate UI + wiring (ConsentGate, _layout, SIGNED_IN flush, sign-up checkbox) | ✅ MERGED |
| **#120** | `feat/legal-compliance-u6-urls` | `0b68b97` | URLs + navigation (URL swap, openLegalDocument, link sites, goldens) — Pages-gated | ✅ MERGED |
| final | `main` | `a7c11b8` | chore(pages): add Jekyll config with pretty permalinks for /legal mirrors | ✅ HEAD |

**Final main HEAD**: `a7c11b8` (chore-pages Jekyll config landed last). Working tree clean on main; all 6 feature branches pruned (verified `git branch -a` shows only `main`, plus unrelated long-lived branches); remote feature branches pruned too.

**GitHub Pages live**: all 6 `https://javaPhpMyAdmin.github.io/ticketify/legal/{es-AR,en,pt-BR}/{privacy,terms}/` URLs return 200 (per orchestrator launch prompt; curl-200 verification gate passed before U6 URL swap shipped).

---

## 4. REQ implementation status — REQ-1..REQ-7 + NFRs (legal-links), 4 REQs (legal-content), 5 REQs (legal-consent)

### legal-links (canonical `openspec/specs/legal-links/spec.md`)

| REQ | Title | Status | Evidence |
|-----|-------|--------|----------|
| **REQ-1** | External-link opener contract | ✅ **PASS** | Unchanged from prior archive; opener is still exported and contract-tested, even though the in-app nav path is preferred now (REQ-3/REQ-4) |
| **REQ-2** | Locale-aware legal URL map | ✅ **PASS** | Unchanged from prior archive; `legalUrlFor` still exports, all 6 URLs `https:` |
| **REQ-3** | Settings Legal group | ✅ **PASS** (code) / 🔶 MANUAL (device smoke) | `profile.tsx` `legalRows` now navigate in-app via `openLegalDocument(document)` instead of the opener; new scenario "Row opens the in-app document" lands in canonical spec |
| **REQ-4** | Sign-up footer legal links | ✅ **PASS** (code) / 🔶 MANUAL (device smoke) | `sign-up.tsx` footer links → `openLegalDocument`; new scenario "Tap opens the document in-app" preserves form state on back; links remain tappable pre-checkbox (legal-consent cross-ref) |
| **REQ-5** | i18n catalog parity | ✅ **PASS** | Unchanged from prior archive |
| **REQ-6** | Test harness | ✅ **PASS** | `scripts/test-legal-links.mjs` updated for Pages-domain goldens + REQ-7 real-domain assertion; harness still in `pnpm test` chain at the locked position |
| **REQ-7** | Real hosted URLs and release gate | ✅ **PASS** | Renamed + Modified: all 6 URLs are the real Pages domain; harness now fails on `example.com`; `TODO(user)` markers retired; release gate is the real-domain assertion, not a `TODO` grep |

### legal-content (NEW canonical `openspec/specs/legal-content/spec.md`)

| REQ | Title | Status |
|-----|-------|--------|
| REQ-1 | In-App Legal Screens | ✅ PASS — `/legal/{privacy,terms}` routes render pre-auth + while gated |
| REQ-2 | Localized Content Parity | ✅ PASS — `test:legal-content` ns parity harness green |
| REQ-3 | Hosted Markdown Mirror | ✅ PASS — 6 mirrors at `docs/legal/{locale}/{doc}.md`; Pages live |
| REQ-4 | No Runtime Fetch | ✅ PASS — bundled `<Text>` rendering, no WebView |

### legal-consent (NEW canonical `openspec/specs/legal-consent/spec.md`)

| REQ | Title | Status |
|-----|-------|--------|
| REQ-1 | Acceptance Record | ✅ PASS — SQL smoke `legal-acceptances.sql` covers catalog / idempotency / CHECK / RLS / anon denied |
| REQ-2 | Current-Version Gate | ✅ PASS — `LATEST_LEGAL_VERSIONS` constant + `isConsentComplete`; version bump re-gates per scenario |
| REQ-3 | Sign-Up Consent Checkbox | ✅ PASS — submit blocked + validation + links tappable pre-check |
| REQ-4 | Deferred Acceptance Flush | ✅ PASS — SecureStore flag + `flushPendingAcceptance` on first `SIGNED_IN`; email-match safety; flush fail ≠ sign-in fail |
| REQ-5 | Blocking Consent Gate | ✅ PASS — root overlay via `shouldShowConsentGate`; release on RPC ×2 success; legal docs + sign-out accessible while gated |

### NFRs / cross-cutting

| Item | Status | Evidence |
|------|--------|----------|
| Pre-auth safety (legal-links) | ✅ PASS | Unchanged |
| Accessibility (legal-links) | ✅ PASS | Unchanged |
| Typecheck | ✅ PASS | Main CI green at each PR merge (orchestrator-confirmed) |
| RECORD_AUDIO manifest removal | ✅ PASS | Post-prebuild `AndroidManifest.xml` contains no `RECORD_AUDIO` (CI + `test:android-manifest`) |

---

## 5. Findings — none outstanding at archive

No CRITICAL, WARNING, or SUGGESTION surfaced at archive time. The change moved through 6 PRs without blocking review findings. The 2 items in §6 are follow-ups, not defects.

---

## 6. Outstanding follow-ups (NOT archive blockers, tracked for future changes)

| # | Item | Owner | Status |
|---|------|-------|--------|
| A | **Legal copy → final review**. The text shipped in PR #119 is clearly-marked **DRAFT** (proposal open question #1). When the legal team approves final copy, bump `LATEST_LEGAL_VERSIONS` (`src/features/legal/legal-versions.ts`) — that will re-gate every existing user and re-record `legal_acceptances` rows at the new ISO date. The version-string mechanism was built for this exact case (legal-consent REQ-2 "Version bump re-gates existing users" scenario). | User / legal review | 🔶 MANUAL-NEEDED — tracked outside SDD until copy lands |
| B | **Live PostgREST client→definer check**. The `legal-acceptances.sql` smoke exercises the RPC via direct SQL `perform` only; CI db-smoke does not exercise the PostgREST REST path. The client → PostgREST → SECURITY DEFINER contract (named-args `p_document` + `p_version`, JWT-role request as `authenticated`) was pinned as an open gap in the U4 apply-progress and committed via the smoke header note. A future U- or follow-up change should add a `curl`-style assertion against a live stack. | Future change / separate slice | 🔶 OPEN-GAP — noted, not a defect |

The proposal's open questions #1 (legal copy approval) and #2 (Pages enablement timing) are now both resolved (Pages is live with 200s; legal copy is in flight as DRAFT).

---

## 7. Task completion state — 25/25 implementation + verification tasks

All 25 tasks in `openspec/changes/legal-compliance/tasks.md` were reconciled from `- [ ]` to `- [x]` at archive time. The orchestrator's launch prompt explicitly confirmed all 6 PRs merged to main with PR numbers, SHAs, and the final main HEAD `a7c11b8` — that constitutes the "explicit instruction to reconcile stale checkboxes" + "apply-progress/verify-report prove every unchecked task is complete" exception from `sdd-archive` SKILL §Task Completion Gate. The reconciliation reason is recorded here.

| Phase | Tasks | State |
|-------|-------|-------|
| Phase 1 — Foundation / U1 (DB + config) | T-1.1 .. T-1.4 | ✅ 4/4 `[x]` (already `[x]` from apply) |
| Phase 2 — In-app content / U2 + U3 | T-2.1 .. T-2.5 | ✅ 5/5 `[x]` (reconciled) |
| Phase 3 — URLs + navigation / U6 | T-3.1 .. T-3.4 | ✅ 4/4 `[x]` (reconciled) |
| Phase 4 — Consent / U4 + U5 | T-4.1 .. T-4.9 | ✅ 9/9 `[x]` (reconciled) |
| Phase 5 — Verification (all units) | T-5.1 .. T-5.3 | ✅ 3/3 `[x]` (reconciled; orchestrator confirmed CI green + Pages 200s + main clean) |
| **Total** | **25 tasks** | ✅ **25/25 `[x]`** — task-completion gate passed before sync/move |

Pre-archive reconcile evidence: `git log --first-parent main` shows the 6 merge commits `a021c30 → cd912fc → addc402 → 88e37e2 → ab7ce26 → 0b68b97 → a7c11b8` plus 4 supplementary commits (Pages Jekyll config + U2-2/+U3 follow-ups). Orchestrator-confirmed working tree clean and GitHub Pages live with 6 URLs returning 200.

---

## 8. Verify report status — no separate verify-report.md authored

The prior change `privacy-terms` (legal-links capability, archived 2026-09-17) carried a `verify-report.md`. This change (`legal-compliance`) shipped incrementally across 6 PRs and never produced a unified `verify-report.md` — verification was per-PR CI gates. The orchestrator's launch prompt (6 PRs merged + Pages 200s + working tree clean) stands in for a unified verify report. The REQ-level evidence table in §4 is the authoritative verification record.

---

## 9. How to verify the full chain locally (post-archive)

```bash
# 1. Typecheck (full client surface + new harness modules)
pnpm typecheck          # exit 0

# 2. The 3 legal harnesses (post-archive: specs are at canonical paths, harnesses don't read them, but they DO exercise the runtime contract)
pnpm test:legal-links   # PASS — Pages-domain goldens + REQ-7 real-domain assertion
pnpm test:legal-content # PASS — ns parity ×3 + 6 mirror files exist/non-empty/equal to fresh generation
pnpm test:legal-consent # PASS — completeness partial/bump, gate hidden on /legal/*, flushDecision match/stale/fail-survives

# 3. RECORD_AUDIO verification
pnpm test:android-manifest  # PASS — generated AndroidManifest declares no RECORD_AUDIO

# 4. SQL smoke (legal_acceptances contract)
pnpm test:sql          # PASS for the legal smoke portion (other smokes unchanged)

# 5. Lint
pnpm lint              # 0 errors expected

# 6. Spec sync sanity — REQ-7 renamed-and-modified, NOT duplicated
grep -nE "^### REQ-[0-9]+:" openspec/specs/legal-links/spec.md
# expect: REQ-1, REQ-2, REQ-3, REQ-4, REQ-5, REQ-6, REQ-7 (exactly 7, REQ-7 named "Real hosted URLs and release gate")
grep -nE "Placeholder lifecycle" openspec/specs/legal-links/spec.md
# expect: NO matches (old name is gone)
grep -nE "Real hosted URLs and release gate" openspec/specs/legal-links/spec.md
# expect: 1 match (the new REQ-7 heading)
```

The pre-existing `test:sql` `permission denied for table categories` failure (recurring across archives per `delete-account` §5 and `privacy-terms` §5) is not a legal-compliance regression — no SQL/RLS/migration outside `0038_legal_acceptances.sql` was touched, and `0038` is registered in both smoke registries per T-1.3.

---

## 10. Git state — ARCHIVED

| Item | State |
|------|-------|
| Branch | `main` (no feature branch open) |
| Final HEAD | `a7c11b8` |
| Commits in this archive batch | 1 — `docs(openspec): archive legal-compliance (2026-09-19) + sync 3 specs to canonical` |
| Files staged for the commit | `git mv openspec/changes/legal-compliance → openspec/changes/archive/2026-09-19-legal-compliance` (7 files renamed: proposal, exploration, design, tasks, 3 specs); new files `openspec/specs/legal-content/spec.md`, `openspec/specs/legal-consent/spec.md`; modified `openspec/specs/legal-links/spec.md` (REQ-3, REQ-4, REQ-7 RENAME+MODIFIED + 3 source annotations) and `openspec/changes/archive/2026-09-19-legal-compliance/tasks.md` (25 boxes reconciled) |
| Implementation files | Unchanged by archive (already on main via the 6 PRs) |
| Push | ❌ NOT pushed — orchestrator confirms push per launch prompt |
| Who decides push | **Orchestrator** — this executor does NOT push |

---

## 11. Resume instructions

**Empty — the change is archived, not paused.**

The SDD cycle is complete. Future work (legal copy final review + version bump, live PostgREST client→definer assertion, `test:sql` RLS infra fix) should be tracked as **new SDD changes** with their own explore/proposal/spec/design/tasks/apply/verify/archive cycle. Do not resume this archive.

---

## 12. What / Why / Where / Learned

**What**: Complete archive of the `legal-compliance` SDD change covering 3 capabilities (`legal-content` NEW, `legal-consent` NEW, `legal-links` MODIFIED with a REQ-7 RENAME+MODIFIED) across 6 chained stacked-to-main PRs (#118..#123 + #120 final), main HEAD `a7c11b8`, working tree clean, GitHub Pages live with 6 URLs returning 200. The 3 delta specs were merged into the canonical spec set; the change folder was moved to `openspec/changes/archive/2026-09-19-legal-compliance/`; the archive report was persisted to Engram topic `sdd/legal-compliance/archive-report` (project `coronatracker`, `capture_prompt: false`).

**Why**: The orchestrator confirmed the change was COMPLETE and READY to archive. The user request was "dale archivamos" (after "ya le di main /docs y save" — meaning Pages is enabled and live). The archive closes the SDD cycle and preserves the audit trail (RENAME+MODIFIED for REQ-7, source annotations, follow-up notes for legal review and live PostgREST check).

**Where**:
- `mobile/openspec/specs/legal-content/spec.md` — NEW canonical spec, 4 REQs + 3 gates, top-level archive header
- `mobile/openspec/specs/legal-consent/spec.md` — NEW canonical spec, 5 REQs + 4 gates, top-level archive header
- `mobile/openspec/specs/legal-links/spec.md` — MODIFIED canonical spec: REQ-3 in-app nav, REQ-4 in-app nav + pre-check tappable, REQ-7 renamed "Placeholder lifecycle and release gate" → "Real hosted URLs and release gate" AND modified to assert the real Pages domain; 3 source annotations added; REQ-1/REQ-2/REQ-5/REQ-6 untouched
- `mobile/openspec/changes/archive/2026-09-19-legal-compliance/` — 7 artifacts preserved (proposal, exploration, design, tasks, 3 specs under specs/) + this archive-report.md
- Engram `sdd/legal-compliance/archive-report` (project `coronatracker`, `capture_prompt: false`, `topic_key` upsert) — persisted by the orchestrator from this file; cross-refs to the change's prior observations: explore #1404, propose #1405, spec #1406, design #1407, tasks #1408, U4 apply-progress #1410, U2-3 apply #1416, chained PRs #1417, U2 readability review #1414, U2 reliability review #1413
- Implementation (unchanged by archive, already on main): `supabase/migrations/0038_legal_acceptances.sql`, `supabase/tests/legal-acceptances.sql`, `src/app/legal/{privacy,terms}.tsx`, `src/features/legal/**`, `src/lib/legal-navigation.ts`, `src/lib/legal-urls.ts`, `src/i18n/locales/*/legal.json`, `src/i18n/{config,types}.ts`, `src/lib/query-keys.ts`, `app.json`, `scripts/generate-legal-markdown.mjs`, `scripts/test-{legal-links,legal-content,legal-consent,android-manifest}.mjs`, `scripts/tsconfig.legal-*-test.json`, `scripts/test-stubs/**`, `package.json`, `.github/workflows/ci.yml`, `docs/{_config.yml,legal/**}`, Jekyll config

**Learned**:
1. **REQ-7 RENAME + MODIFIED in a single change is safe when the spec agent flags it at write time.** The OpenSpec convention "RENAME applied BEFORE MODIFIED" is exactly what the canonical merge produced: one REQ-7 with the new name and new body, with `(Previously: …)` + `(Renamed from …; reason …; migration …)` annotations preserving the audit trail. No duplicate REQ-7, no orphan REQ-7 with the old name. The `delete-account` precedent showed source-annotation placement (after body, before scenarios); applying that here is the correct mechanical choice.
2. **Tasks.md was authored with all `[ ]` boxes** even after the apply phase shipped 6 PRs — the `sdd-apply` executor in this change did not update the persisted tasks artifact (likely because the work was split across 6 stacked sub-agents, each focused on its own PR rather than the umbrella change). The archive's task-completion gate caught this; the orchestrator's explicit launch prompt + git log + Pages 200 verification constituted the "explicit instruction to reconcile stale checkboxes" exception. Lesson for future chained multi-PR changes: `sdd-apply` should append a final reconciliation commit at the end of the chain that ticks the umbrella `tasks.md` even if each slice branch is its own PR.
3. **`test:sql` `permission denied for table categories` is a recurring archive-report fixture** (third archive to mention it: `delete-account` §5, `privacy-terms` §5, this one). Track as a separate infra change; do not block any SDD change on it. Zero SQL files outside `0038_legal_acceptances.sql` were touched by `legal-compliance`.
4. **GitHub Pages enablement + 6 URL swap is a clean handoff pattern.** Land DB / content / consent FIRST (U1..U5, all green, no Pages dependency), then in U6 swap the 6 URLs AND update the harness REQ-7 to assert the real domain. The 6 × `curl -sfI` = 200 verification gate between U5 merge and U6 URL swap is the release barrier; once it passes, the swap is one-shot and the harness enforces no further drift.
5. **Manifest line-count drift vs forecast**: tasks.md forecast ~2,700 changed lines (high review-budget risk) → actuals landed via 6 chained PRs well below the 400-line per-PR budget because the original forecast assumed a single-PR scope. The 6-PR auto-chain strategy resolved the high risk without any `size:exception`. Confirms the orchestrator's `auto-chain` choice over `single-pr` was correct for this workload.

---

**Change archived.** SDD cycle complete. Next real step: orchestrator pushes the single docs commit (`docs(openspec): archive legal-compliance (2026-09-19) + sync 3 specs to canonical`) and the user/orchestrator kicks off the next SDD change via `/sdd-new`.
