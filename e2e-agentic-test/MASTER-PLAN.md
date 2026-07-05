# Master E2E validation plan

This is the journey-level execution plan across all `e2e-agentic-test/`
scenarios contributed by the five `verify-plans-*` branches (PRs #416–#420)
plus the two scenarios already on `redesign-ui-platevault`
(`003-first-run-source-setup/restart-first-run`,
`019-bottom-log-viewer/event-source-class`). It exists so that whoever runs
the full sweep — human or agent — runs things in an order that reuses state
instead of re-establishing it 35 times, and knows up front which scenarios
are blocked on which open PRs.

Product-level narrative for each journey lives in
`docs/product/user-journeys.md`. Shared runner mechanics (Windows deploy,
bridge connect, window sizing, reset procedure, recompile trap) live in
`AGENT-RUNNER.md` — this file does not repeat them.

Every scenario in this tree is two-stage (Stage 1: agent via the Tauri MCP
bridge against the real backend; Stage 2: a Claude Desktop human pass). Run
the full sweep only Stage-1-complete; Stage 2 for a given scenario should
never start against a build that failed that scenario's Stage 1.

## 1. Convoy PR gating matrix

As of 2026-07-04, these PRs target `redesign-ui-platevault` and gate the
scenarios below. Re-check `gh pr view <n>` before a sweep — this table goes
stale the moment the CI shepherd merges one.

| PR | Title | Status (2026-07-04) | Scenarios/tests gated |
|---|---|---|---|
| #404 | feat(settings): wire Data Sources Disable + Delete (P6b) | **OPEN** | `003-first-run-source-setup/data-sources-disable-delete` (whole scenario) |
| #408 | feat: prevent two plans applying to the same files at once | **OPEN** | `025-filesystem-plan-application/plan-overlap-guard` (whole scenario); `journeys/grand-inbox-journey` steps 12–13 (optional enrichment only — journey runs without it) |
| #413 | feat: review and safely apply project cleanup plans with live progress | **OPEN** | `017-cleanup-archive-review-plans/cleanup-scan-review-apply` (whole scenario); `journeys/full-project-lifecycle` Phase E |
| #414 | fix: project folders are always created inside your registered project library | **OPEN** | `008-project-create-onboard-edit/project-path-root-anchoring` (whole scenario); changes the expected folder location in `project-mkdir-auto-apply` (pre-#414 vs post-#414 branches, both documented in that scenario) |
| #415 | feat: single-column Archive page, richer Sessions list, and screen-reader sort announcements | **OPEN** | `017-cleanup-archive-review-plans/archive-lifecycle` tests 1.5–1.7 only (1.1–1.4 run without it); `024-project-manifests-and-notes/manifests-notes-reveal-labels` test 1.5 only; `035-targets-catalog/list-search-aliases-sort` test 5 only; `043-sessions-parity/sessions-inbox-parity` (whole scenario); `043-ui-redesign-platevault/a11y-keyboard-and-aria-sort` test 1.2 only; `journeys/calibration-journey-ingest-to-match` Phase 3 sessions-parity assertions only (rest of the journey runs without it); `journeys/full-project-lifecycle` Phase F polish |

Already-merged PRs referenced as preconditions inside scenario files (verify
these are actually present on the deployed tip before trusting a run — some
scenarios were authored while the PR was still open):

`#391`, `#392`, `#394`, `#395`, `#396`, `#400`, `#405`, `#409`, `#410`,
`#411` — all merged into `redesign-ui-platevault` as of 2026-07-04. Several
scenarios (`match-suggest-assign-tolerances`,
`masters-detection-individual-items`,
`per-channel-integration-time`, `no-raw-keys-and-translated-errors` test 1.4,
`journeys/calibration-journey-ingest-to-match`) still phrase these as "verify
the deployed branch tip includes them" — treat that as a live check, not a
formality, since the recompile trap (stale binary after `git reset --hard`)
silently reintroduces pre-merge behavior.

**Rule of thumb:** if a scenario's precondition says "requires PR #NNN
merged" and `gh pr view NNN` shows it still open, mark the *whole scenario*
`BLOCKED — PR #NNN not merged`, not `FAIL`. If a scenario says a PR gates
only specific numbered tests, run the rest and mark only those tests
`BLOCKED`.

## 2. Recommended execution order

The rationale: establish shell/i18n/layout foundations first (everything
else is judged against them), then build up state in dependency order so
later groups can reuse earlier groups' populated library instead of each
resetting to a fresh DB, then close with the three canonical journeys as
release gates.

### Group 0 — Shell & cross-cutting foundations (no fresh DB needed beyond "setup completed")

Run early: if these fail, defects here will be misread as symptoms
throughout every other group.

1. `043-ui-redesign-platevault/shell-left-nav`
2. `043-ui-redesign-platevault/layout-convention-1100x720`
3. `043-ui-redesign-platevault/global-search-command-palette`
4. `043-ui-redesign-platevault/a11y-keyboard-and-aria-sort` *(test 1.2 blocked on #415)*
5. `046-i18n-error-codes/no-raw-keys-and-translated-errors` *(test 1.4 needs #410 — already merged, so runs clean)*
6. `018-settings-configuration-model/appearance-themes`
7. `018-settings-configuration-model/panes-and-persistence`
8. `019-bottom-log-viewer/event-source-class` *(already on redesign-ui-platevault)*
9. `019-bottom-log-viewer/severity-filter-and-sources`

Note: `a11y-keyboard-and-aria-sort` and `layout-convention-1100x720` are more
informative with a populated library (non-empty tables, overflowing lists) —
if run before any ingest, record affected assertions as "PASS-with-note,
vacuous" per those scenarios' own instructions, and re-run once Group 2 has
populated the library.

### Group 1 — First-run setup & data sources (establishes the base library)

Run as a **chain** — each scenario after the first reuses the previous
scenario's end state (documented explicitly in the scenario files):

1. `003-first-run-source-setup/wizard-fresh-db-journey` — **fresh DB required.**
   Establishes the canonical registered-roots end state everything else in
   this group reuses.
2. `004-native-filesystem-controls/picker-reveal-controls` — reuses (1)'s end state.
3. `003-first-run-source-setup/data-sources-remap-rescan` — reuses (1)'s end state.
4. `003-first-run-source-setup/data-sources-disable-delete` — reuses (3)'s
   rescanned root. **BLOCKED on PR #404.**
5. `016-source-protection-defaults/protection-defaults-take-effect` — reuses (1)'s end state.
6. `003-first-run-source-setup/restart-first-run` — needs its own **fresh
   reset, then a completed setup**, since it specifically tests reopening
   the wizard after completion; run it standalone, not chained off (1)–(5).
7. `008-project-create-onboard-edit/project-mkdir-auto-apply` — needs setup
   completed with a registered project root; can reuse (1)'s end state if it
   registered one, otherwise complete setup once more.
8. `008-project-create-onboard-edit/project-path-root-anchoring` — builds
   directly on (7); needs a relaunch afterward (not a DB wipe) so migration
   `0060_project_path_anchor.sql` runs. **BLOCKED on PR #414**; (7)'s
   folder-location assertion has documented pre-#414/post-#414 branches, so
   run (7) once now and again after #414 merges if you want both readings.

### Group 2 — Inbox & plans (produces the confirmed-inventory state that Groups 3–4 consume)

Each of these needs its **own fresh DB reset** (they each define a specific
fixture recipe and assert on a clean starting point) — except where noted:

1. `041-inbox-plan-surface/mixed-folder-single-type-subitems`
2. `041-inbox-plan-surface/missing-mandatory-gate`
3. `041-inbox-plan-surface/reclassify-field-agnostic`
4. `041-inbox-plan-surface/confirm-move-vs-catalogue`
5. `041-inbox-plan-surface/plan-overlay-apply-audit`
6. `041-inbox-plan-surface/sessions-derived-inventory`
7. `025-filesystem-plan-application/plan-overlap-guard` — **BLOCKED on PR #408.**
8. `audit-log/detail-i18n` — needs #410 (merged) present on the deployed tip.
9. `journeys/grand-inbox-journey` — **run last in this group, on its own
   fresh DB.** This is the canonical release-gate version of Journeys 2–4;
   it deliberately re-covers 1–6 as one continuous chain rather than reusing
   their end states. Treat a journey FAIL as blocking sign-off even if every
   focused scenario above passed.

### Group 3 — Catalog & calibration (consumes an ingested/confirmed library)

1. `035-targets-catalog/list-search-aliases-sort` — fresh DB + setup +
   bundled seed catalog (no ingest fixtures needed). *(test 5 blocked on #415)*
2. `035-targets-catalog/simbad-resolve-on-demand` — fresh DB + setup; needs
   network for the online-resolve test (SKIP that one test if offline).
3. `023-target-identity/detail-identity-aliases-notes` — fresh DB + setup;
   add M 42 before starting.
4. `044-planner-stubs/planner-columns-visibly-stubs` — fresh DB + setup +
   seed catalog. Read this one BEFORE any other Targets-area work — it's the
   authority on what's real vs. stub in the planner columns.
5. `040-calibration-masters/masters-detection-individual-items` — fresh DB +
   setup; needs #391/#395 present on the deployed tip.
6. `journeys/calibration-journey-ingest-to-match` — **fresh DB.** Canonical
   Journey 8 narrative; produces the matched-set state that (7) and Group 4's
   sessions-parity check consume.
7. `007-calibration-matching/match-suggest-assign-tolerances` — reuses (6)'s
   Phases 1–2 end state; do not run standalone without it.
8. `043-sessions-parity/sessions-inbox-parity` — reuses (6)'s Phase 1 end
   state. **BLOCKED on PR #415.**

### Group 4 — Projects (consumes an ingested/confirmed library)

1. `008-project-create-onboard-edit/create-wizard-field-errors` — fresh DB;
   needs one existing project first (create it, then attempt the duplicate).
2. `008-project-create-onboard-edit/edit-project-sources` — fresh DB; needs
   a project with ≥2 linked confirmed sessions (ingest two filter groups
   first).
3. `008-project-create-onboard-edit/per-channel-integration-time` —
   **BLOCKED on PR #396 pre-merge; #396 is now merged**, so this runs clean;
   fresh DB with known frame×exposure counts across ≥2 filters.
4. `011-processing-tool-launch/tool-launch-containment` — fresh DB; one
   configured tool + one deliberately unconfigured tool.
5. `012-processing-artifact-observation/artifact-attribution` — fresh DB;
   two sibling projects.
6. `017-cleanup-archive-review-plans/cleanup-scan-review-apply` —
   **BLOCKED on PR #413.** Fresh DB; project with mixed-kind outputs.
7. `017-cleanup-archive-review-plans/archive-lifecycle` — fresh DB; project
   with outputs including one master (protected) item. Tests 1.1–1.4 run
   clean; **tests 1.5–1.7 BLOCKED on PR #415.**
8. `024-project-manifests-and-notes/manifests-notes-reveal-labels` — fresh
   DB. Tests 1.1–1.4 run clean; **test 1.5 BLOCKED on PR #415.**
9. `journeys/full-project-lifecycle` — **run last, on its own fresh DB.**
   Canonical release-gate Journey 5–7 narrative (create → attach → manifests
   → launch → artifacts → cleanup → archive), a single continuous pass.
   **Convoy precondition: requires #392, #394, #400, #409, #401, #396, #413,
   #415 all merged** — with #413/#415 still open, run only the per-feature
   scenarios (1–8 above) and report this journey `BLOCKED` on #413/#415 until
   they land.

## 3. Data continuity summary

| Continuity class | Scenarios | Reset needed |
|---|---|---|
| Fresh DB, standalone | Every scenario not listed below | `Remove-Item wizard-test.db*` then complete/re-run first-run setup as the scenario's own preconditions specify |
| Fresh DB, chain head | `003/wizard-fresh-db-journey`, each Group-2 scenario individually, each Group-3/4 fresh-DB entries above | same, but the scenario is also a state source for the next row |
| Reuses a named prior scenario's end state | `004/picker-reveal-controls`, `003/data-sources-remap-rescan`, `003/data-sources-disable-delete`, `008/project-path-root-anchoring`, `016/protection-defaults-take-effect`, `007/match-suggest-assign-tolerances`, `043-sessions-parity/sessions-inbox-parity` | no reset — run immediately after the named scenario in the same session |
| No reset at all (setup-completed is enough) | All of Group 0, plus `018/*`, `019/*` | none — safe to run against whatever state currently exists, as long as ≥1 source is registered; some assertions are more informative with a populated library (see Group 0 note) |

The single hard rule everywhere: **the database is the first-run source of
truth.** Clearing `localStorage` alone is not a reset and causes a `/` ↔
`/setup` redirect loop — always delete `wizard-test.db*` for a real reset
(see `AGENT-RUNNER.md`).

## 4. Results-recording template

Record one block per scenario run. Copy this template per entry:

```
### <spec-dir>/<test-dir>  (e.g. 041-inbox-plan-surface/confirm-move-vs-catalogue)

- Run date / deployed commit:
- PR gating status: <none | BLOCKED — PR #NNN not merged | tests X,Y BLOCKED — PR #NNN not merged>
- Stage 1 verdict: PASS | FAIL | BLOCKED
  - If FAIL: step number, IPC payload / DOM snapshot excerpt, screenshot ref, on-disk diff (if applicable)
- Stage 2 verdict: PASS | FAIL | NOT RUN (Stage 1 did not pass)
  - If FAIL: which numbered judgment point, screenshots (both themes where required)
- Blockers / follow-up tasks opened:
- Notes (vacuous assertions, SKIPPED tests, DEFERRED steps, and why):
```

Roll per-group results into a one-line summary table for the overall sweep:

```
| Group | Scenario | Stage 1 | Stage 2 | Blockers |
|---|---|---|---|---|
| 0 | shell-left-nav | PASS | PASS | — |
| ... | ... | ... | ... | ... |
```

An overall sweep is release-ready only when: every non-BLOCKED scenario is
Stage-1 PASS and Stage-2 PASS, every BLOCKED scenario's gating PR has either
merged (re-run it) or been explicitly accepted as out of scope for this
release, and all three canonical journeys
(`grand-inbox-journey`, `full-project-lifecycle`,
`calibration-journey-ingest-to-match`) are green — a journey FAIL blocks
sign-off even if every focused scenario feeding into it passed individually.
