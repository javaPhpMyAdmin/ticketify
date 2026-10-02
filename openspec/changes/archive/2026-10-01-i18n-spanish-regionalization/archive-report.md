# Archive report — i18n Spanish regionalization

> New topic (supersedes any prior archive narrative by citation). The change
> folder was moved to `openspec/changes/archive/2026-10-01-i18n-spanish-regionalization/`
> with all artifacts. The verify report is a separate record and was NOT
> rewritten by this archive.

## Change

Archived SDD change `i18n-spanish-regionalization`. Five delta specs merged
into the canonical spec set: TWO new capabilities created
(`locale-catalog-hierarchy` 7 reqs + payload NFR; `spanish-regional-detection`
5 reqs) and THREE existing extended (`app-i18n` REQ-1/2/3/9/13 MODIFIED +
NFR-1/4 and NFR-8/NFR-9 ADDED; `legal-content` 2 MODIFIED + 1 ADDED;
`legal-links` 4 MODIFIED). `openspec/config.yaml` made valid YAML and given
`persistence: hybrid`.

## Canonical merge results

- NEW `openspec/specs/locale-catalog-hierarchy/spec.md` — 7 requirements +
  payload NFR, 21 scenarios.
- NEW `openspec/specs/spanish-regional-detection/spec.md` — 6 requirements,
  23 scenarios; both proposal open questions resolved in spec text.
- `openspec/specs/app-i18n/spec.md` — extended to five-locale reality; gates
  2–5 amended.
- `openspec/specs/legal-content/spec.md` — five-locale parity; sparse-override
  resolution scenario; ten mirrors.
- `openspec/specs/legal-links/spec.md` — five-locale URL map; fallback
  `es-AR` → `es-419`.
- `openspec/config.yaml` — context line corrected, `persistence: hybrid`
  declared, `apply:` block made valid YAML.

## Gates (post-move)

- `pnpm typecheck` EXIT=0 · `pnpm test` EXIT=0 (55 harnesses) · `expo lint`
  EXIT=0 (0 errors / 55 warnings).
- catalog-parity 49/49 · detector 24/24 · onboarding-keys 7/7.
- Zero-drift containment `28 requirements / 66 scenarios / MISSING=0` before
  and after the move.
- Git index 0 staged (plain `mv`, not `git mv`); branch `main` unchanged;
  0 commits.

## Lessons

1. **A delta's interpretation note is the artifact most likely to be stale.**
   The `legal-content` delta claimed the `es-ES` legal deck reuses `es-419`;
   design AD-2 says the opposite and flagged the delta line for correction.
   Grep deltas for "supersedes"/"interpretation note" before merging.
2. **`openspec/config.yaml` was invalid YAML for six weeks.**
   `rules.apply` mixed a sequence item with sibling mapping keys, so the file
   had not parsed since 2026-08-04. Verify config parses before trusting
   anything read out of it.
3. **Delta prose disagrees with the tree in numbers.** Measured corrections:
   17 → 18 namespaces (`categories` is the 18th); 3 → 5 `returnObjects`
   containers; and the `es-ES` legal note above. Measure the tree.
4. **A verify verdict and its remediation are separate records.** The verify
   report reads FAIL (procedural) on blockers that are verifiably closed; the
   archive does not rewrite it.
5. **Two changes independently produced an `NFR-8` in `app-i18n`** (this one
   and `categories-i18n`, 2026-09-30). Both titles preserved; future NFRs
   numbered forward. Disambiguate by title, never by number.
6. **Do not preserve gates the delta made false.** `legal-content` gate 2 said
   "three catalogs" after the change made it five; amend the count.
7. **Scenario renames look like deletions in a set-difference audit.**
   Reconcile with an explicit containment script.
8. **The Argentine governing-law clause survived the register audit.**
   `legal.terms.sections.7.body` names Argentina in `es-419`/`es-ES`/`pt-BR`
   and `en`; `es-AR` inherits. Recorded as a canonical requirement so it isn't
   "fixed" by accident. A native speaker judges register, not jurisdiction.
9. **The `es-ES` legal deck is a COMPLETE 73-leaf override**, exempt from the
   sparse-shape rule because `legal` is `returnObjects` (AD-2).

## Open gates carried forward (non-blocking)

- T-11.1 device matrix — the only unchecked boxes, manual by construction.
- T-11.2 second Spain-native sign-off on `household.youSuffix`.
- T-11.3 governing-law legal decision, project-wide and owner-gated.

**OpenSpec folder closed; the SDD cycle is complete.**
