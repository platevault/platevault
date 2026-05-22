# Tasks: Processing Artifact Observation

**Feature**: `012-processing-artifact-observation`
**Date**: 2026-05-22
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

Tasks are grouped by user story. No code is shipped today; all
implementation tasks remain pending.

---

## US1 — Detect new files in a project's output folder (P1)

**Independent test**: launch the app with a project pointing at an
output folder. Drop a `.xisf` or `.fits` file into the folder.
Within the configured debounce window a `ProcessingArtifact` row
exists with `state = present`, `project_id`, `path`, `detected_at`,
and `size_bytes`.

- [ ] **T001** Add `processing_artifacts` and `classification_overrides`
      migrations under `crates/persistence/db/migrations/`.
- [ ] **T002** Define `crates/workflow/artifacts/` crate skeleton with
      module stubs: `watcher.rs`, `classifier.rs`, `reconciler.rs`,
      `rules.rs`.
- [ ] **T003** Implement `notify-rs`-based watcher in `watcher.rs` with
      a polling-fallback driver behind a common trait. Probe + self-test
      per research item R-3. Apply `watch_extensions` coarse pre-filter
      per `WorkflowProfile.watch_extensions` (R-ExtAllow, R-7).
- [ ] **T004** Implement debounce + stable-size check per research item
      R-4 (default 2000ms, configurable).
- [ ] **T005** Implement `reconciler.rs` rescan-on-attach to catch files
      written while the watcher was detached.
- [ ] **T006** Implement `artifacts_repo.rs` in `crates/persistence/db/`
      with insert, lookup-by-path, and state-transition operations.
- [ ] **T007** Audit events `artifact.detected`, `artifact.updated`,
      `artifact.missing`, `artifact.recovered` via `crates/audit/`.
      `artifact.updated` fires on in-place rerun overwrite (A8).
- [ ] **T007b** Add `watch_extensions` field to `WorkflowProfile`
      schema in `crates/workflow/profiles/`. Seed default extension
      list per R-ExtAllow. Expose per-profile override via settings
      (spec 018 ripple: `workflow_profile.<id>.watch_extensions`).
- [ ] **T008** Wire watcher attach/detach to project drawer lifecycle
      events in the desktop app.
- [ ] **T009** Integration test: drop a known-good file into a fixture
      output folder → expect a `present` row within 5s on the local
      filesystem.
- [ ] **T010** Integration test: delete the file → rescan → expect
      `missing` state, audit event recorded, row preserved.

---

## US2 — Classify artifacts as intermediate / master / final (P2)

**Independent test**: drop files matching the PixInsight default rules
(`MasterDark_*.xisf`, `integration_*.xisf`, `*_c.xisf`) into the
output folder. Each artifact appears with the expected `kind` and
`classification_confidence`. Override one via `artifact.classify`;
re-run the classifier and confirm the override survives.

- [ ] **T011** Define `ArtifactRule` shape in `rules.rs` and extend the
      workflow-profile schema in `crates/workflow/profiles/` to carry
      the rule list.
- [ ] **T012** Ship default PixInsight + Siril rule sets per research
      item R-2.
- [ ] **T013** Implement classifier in `classifier.rs`: highest-priority
      matching rule wins; unknown → fallback with confidence < 0.2.
- [ ] **T014** Implement `artifact.classify` contract handler writing
      a `classification_overrides` row and an `artifact.classify.override`
      audit event. When `kind: null` is passed, DELETE the override row,
      re-run rule classification, emit `artifact.classify.override.cleared`
      audit event (A6).
- [ ] **T015** Make classifier re-runs skip rows with
      `classification_source = manual_override`.
- [ ] **T016** Generate TypeScript types from
      `contracts/artifact.classify.json` into `packages/contracts/`.
- [ ] **T017** Contract tests for `artifact.classify`: valid override,
      invalid kind, unknown artifact id, read-only project rejection.
- [ ] **T018** Integration test: classify with rule → override → rescan
      → assert override preserved.
- [ ] **T019** Integration test: unknown filename → `kind =
      intermediate`, `classification_confidence < 0.2`, surfaced.

---

## US3 — Surface artifacts in the project drawer (P3)

**Independent test**: open a project drawer with launches and
artifacts. The Tool Launches accordion shows each launch followed by
its detected artifacts grouped by `kind` with a count badge.
Artifacts without a matching launch appear in an "Unattributed"
group. Missing artifacts visibly distinguish their state and offer a
"Mark resolved" affordance.

- [ ] **T020** Implement `artifact.list` contract handler returning
      summaries ordered by attribution + detected_at.
- [ ] **T021** Generate TypeScript types from
      `contracts/artifact.list.json` into `packages/contracts/`.
- [ ] **T022** Implement tool-launch attribution in the detection path
      per data-model "Tool Launch Attribution" (nearest preceding
      launch within configurable window, same tool). Use app-clock for
      timestamps, NOT `metadata.modified()` (R-AppClock, R-8).
- [ ] **T022b** Implement re-attribution subscriber on `tool.launch`
      event (A7): back-fill `tool_launch_id` for `processing_artifacts`
      rows where `detected_at` is within `launch_attribution_window` of
      the new launch's `launched_at` AND `tool_launch_id` is null OR
      points to an earlier launch. Integration test: artifact detected
      before launch row written → assert re-attribution fires after
      `tool.launch` event.
- [ ] **T022c** Implement `workflow.run_completed` event emission
      (R-Event-Light, FR-010): when attribution pass sets
      `ToolLaunch.completed_at`, emit `workflow.run_completed` to the
      spec 002 event bus with payload from `contracts/
      workflow.run_completed.json`. Integration test: launch completes
      → `workflow.run_completed` fires with correct `artifactIds`.
      Note: spec 024 subscribes to this event for `workflow_run`
      manifests (R-Workflow-1 from spec 024 amendment).
- [ ] **T023** Extend `apps/desktop/src/features/projects/` drawer:
      Tool Launches accordion rendering attributed groups + an
      "Unattributed" group.
- [ ] **T024** Add per-row affordance "Mark resolved" wired to a
      `state` transition handler (separate from the classify contract;
      reuses existing audit pipeline).
- [ ] **T025** Add visual distinction for `missing` rows (strikethrough
      + state badge) and `manual_override` rows (override indicator).
- [ ] **T026** Playwright MCP scenario: open a project drawer with the
      mocked data set; verify the accordion structure and counts.
- [ ] **T027** Integration test: artifact detected after a tool launch
      → assert `tool_launch_id` set to the matching launch.
- [ ] **T028** Integration test: artifact detected without a matching
      launch → assert `tool_launch_id` is null and the row surfaces
      under "Unattributed".

---

## Cross-cutting tasks

- [ ] **TX01** Wire `artifact.list` and `artifact.classify` operations
      into the Tauri command boundary in `apps/desktop/`.
- [ ] **TX02** Documentation: add `docs/research/artifact-observation.md`
      summarising R-1 through R-6 for future reference.
- [ ] **TX03** Constitution recheck after design (pre-implementation).
- [ ] **TX04** Cross-spec dependency check with feature 011 (launch ids)
      and feature 024 (manifest snapshot of `final` artifacts).
- [ ] **TX05** Cross-spec dependency check with feature 017
      (cleanup/archive must protect `final` artifacts by default).

---

## Dependencies

```
T001 ──► T002 ──► T003 ──► T004 ──► T005
T001 ──► T006 ──► T007 ──► T007b ──► T008 ──► T009 ──► T010

T002 ──► T011 ──► T012 ──► T013 ──► T014 ──► T015
T014 ──► T016 ──► T017
T015 ──► T018
T013 ──► T019

T006 ──► T020 ──► T021 ──► T022 ──► T022b ──► T022c ──► T023
T023 ──► T024 ──► T025
T023 ──► T026
T022 ──► T027 ──► T028
T022b ──► T027
T022c ──► TX04

T020, T014 ──► TX01
TX01 ──► TX03
TX03 ──► TX04, TX05
```

US1 unblocks US2 and US3. US2 and US3 are independent of each other
at the handler level but share the desktop drawer wiring.

---

## Out of scope (this feature)

- XISF/FITS header peeking for classification (deferred per research
  item M-3).
- Auto-deletion or auto-archive of intermediates.
- Cross-project artifact discovery.
- Remote/cloud output folders.
- Real-time partial-write streaming detection (we wait for stable size).
- Bulk reclassification UI; v1 supports one override at a time.
