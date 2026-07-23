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

- [x] **T001** Add `processing_artifacts` and `classification_overrides`
      migrations under `crates/persistence/db/migrations/`.
      — `crates/persistence/db/migrations/0025_artifacts.sql`
- [x] **T002** Define `crates/workflow/artifacts/` crate skeleton with
      module stubs: `watcher.rs`, `classifier.rs`, `reconciler.rs`,
      `rules.rs`.
      — `crates/workflow/artifacts/src/{lib,rules,classifier,watcher,reconciler,attribution,default_rules}.rs`
- [x] **T003** Implement watcher extension pre-filter and stable-size
      debounce logic behind injected closure traits (no real fs or sleep
      in unit tests). Note: notify-rs OS watcher runtime deferred (needs
      GUI attach/detach lifecycle — T008 deferred).
      — `crates/workflow/artifacts/src/watcher.rs`; `extension_allowed`, `check_stability`, `DEFAULT_WATCH_EXTENSIONS`
- [x] **T004** Implement debounce + stable-size check (default 2s,
      injected clock via closure — fully unit-tested without sleep).
      — `watcher::check_stability` with injected `size_probe` and `Instant`
- [x] **T005** Implement `reconciler.rs` rescan-on-attach logic with
      injected `read_dir_fn` and `metadata_fn` (fully unit-tested).
      — `crates/workflow/artifacts/src/reconciler.rs`; 4 unit tests
- [x] **T006** Implement `artifacts_repo.rs` in `crates/persistence/db/`
      with insert, lookup-by-path, state-transition, classification
      update, tool-launch attribution, and override operations.
      — `crates/persistence/db/src/repositories/artifacts.rs`; 5 DB tests
- [x] **T007** Audit events `artifact.detected`, `artifact.updated`,
      `artifact.missing`, `artifact.recovered`, `artifact.user_resolved`,
      `artifact.classify.override`, `artifact.classify.override.cleared`,
      `workflow.run_completed` added to `crates/audit/src/event_bus.rs`.
- [x] **T007b** Add `watch_extensions` field to `WorkflowProfile`
      schema. `tools.<tool_id>.watch_extensions` Settings key, read/write via
      `app_core::tool_launch::read_watch_extensions` +
      `update_tool`/`list_profiles`, defaulting to `DEFAULT_WATCH_EXTENSIONS`;
      exposed on `ToolProfileSummary`/`UpdateProcessingTool` and applied by
      both the live watcher and the on-attach reconciliation pass (T008).
      — `crates/app/core/src/tool_launch.rs`; `crates/contracts/core/src/tools.rs`
- [x] **T008** Wire watcher attach/detach to project drawer lifecycle
      events in the desktop app. Replaced the always-on global watcher (which
      watched entire library roots and stamped the wrong `project_id`) with a
      per-project `ArtifactWatcherRegistry`, attached/detached via new
      `artifact.watcher.attach`/`artifact.watcher.detach` commands called from
      `useProjectArtifactWatcher` inside `ProjectDetailContent`'s mount
      lifecycle (attach on open, detach on close/project switch). Attach runs
      the T005 on-attach reconciliation pass first.
      — `apps/desktop/src-tauri/src/watcher.rs`; `apps/desktop/src-tauri/src/commands/artifacts.rs`;
        `apps/desktop/src/features/projects/artifacts.ts`; `apps/desktop/src/features/projects/ProjectDetail.tsx`
- [x] **T008b** (WP-012-A) Repair legacy mis-attributed artifact rows. The
      retired global watcher (pre-T008) stamped the *library-root* id into
      `processing_artifacts.project_id`, so those rows never surfaced in
      `artifact.list`, the Tool Launches accordion, or the spec 017
      cleanup/archive plan generators (#389/#401, which enumerate by
      `project_id`). Added a
      pure longest-prefix path→project resolver (case-insensitive
      component-wise fallback for Windows case drift) plus a one-time,
      idempotent startup fix-up that re-keys root-keyed rows to the real
      owning project and leaves unresolvable rows in place (flagged via
      `tracing::warn`, never deleted). No schema change needed.
      — `crates/workflow/artifacts/src/project_mapping.rs` (9 unit tests);
        `app_core::artifact::{resolve_project_id_for_path, reattribute_root_keyed_artifacts}`;
        `persistence_db::repositories::artifacts::{list_all_artifact_identities, set_project_id}`;
        startup spawn in `apps/desktop/src-tauri/src/lib.rs`;
        5 integration tests in `crates/app/core/tests/tools_artifacts_integration.rs`
- [x] **T009** Integration test: drop a known-good file into a fixture
      output folder. RECONCILED — the "requires GUI" premise was stale: T008
      shipped a live `notify`-based watcher (`fs_inventory::artifact_watcher`)
      that needs only a real directory, not a Tauri window. Already closed by
      spec 033 T025's `apps/desktop/src-tauri/tests/artifact_watcher_live_drop.rs::live_file_drop_after_attach_emits_detected_and_classified`
      (real SQLite + real EventBus + real OS watcher; asserts `artifact.detected`
      and `artifact.classified` fire with contract-valid payloads) — this task
      just wasn't ticked when that test landed.
- [x] **T010** Integration test: delete file → rescan → expect `missing`.
      GAP FILLED: no test previously exercised the real reconciliation pass
      end-to-end (only the pure decision logic in `reconciler.rs` and a
      direct `mark_missing` DB call were covered). Added
      `apps/desktop/src-tauri/tests/artifact_watcher_missing_reconciliation.rs::deleted_file_is_marked_missing_on_reattach_reconciliation`:
      attach (file present, detected) → detach → delete file → re-attach
      (only public entry point that re-runs the on-attach reconciliation
      pass) → asserts `artifact.missing` fires and the DB row is `state = missing`.

---

## US2 — Classify artifacts as intermediate / master / final (P2)

**Independent test**: drop files matching the PixInsight default rules
(`MasterDark_*.xisf`, `integration_*.xisf`, `*_c.xisf`) into the
output folder. Each artifact appears with the expected `kind` and
`classification_confidence`. Override one via `artifact.classify`;
re-run the classifier and confirm the override survives.

- [x] **T011** Define `ArtifactRule` shape in `rules.rs` with
      `MatchKind` enum (`Literal`, `Prefix`, `Suffix`, `Glob`).
      — `crates/workflow/artifacts/src/rules.rs`; 5 unit tests
- [x] **T012** Ship default PixInsight + Siril rule sets.
      — `crates/workflow/artifacts/src/default_rules.rs`; 14 rules
- [x] **T013** Implement classifier in `classifier.rs`: highest-priority
      matching rule wins; unknown → fallback with confidence 0.1.
      — 6 unit tests covering PI master/integration/combined, Siril, fallback, priority
- [x] **T014** Implement `artifact.classify` use case: upsert override
      row, emit `artifact.classify.override` audit event. `kind: null`
      clears override and emits `artifact.classify.override.cleared` (A6).
      — `crates/app/core/src/artifact.rs::classify_override`; app_core tests
- [x] **T015** Classifier re-runs skip `manual_override` rows.
      — implemented in `classify_override` (A6 clear path only re-classifies)
- [x] **T016** Generate TypeScript types from `contracts/artifact.classify.json`.
      — `packages/contracts/src/generated/artifact.classify.d.ts`; added to index.ts
- [x] **T017** Contract tests for `artifact.classify`. RECONCILED —
      the JSON-Schema conformance runner (`packages/contracts/tests/conformance-harness.mjs`,
      wired into `pnpm --filter @astro-plan/contracts test`) now covers the
      request and response shapes: success (T063-D, pre-existing), missing
      `status` drift (T063-D), `artifact.not_found` error, `kind: null`
      clear-override request, and an invalid-`kind` drift case (all labeled
      `T017 ...`). This supersedes the originally-scoped jsdom mock-invoke
      suite — schema-fixture validation is the pattern this repo's other
      contract tests use (T063), and error paths remain additionally covered
      by Rust unit tests in `artifact.rs`.
- [x] **T018** Integration test: classify → override → rescan → override
      preserved. GAP FILLED: the cited test only covered apply+clear, not a
      rescan in between. Added `classify_override_survives_rescan` in
      `crates/app/lifecycle/src/artifact.rs` — detect → override → `detect()`
      again on the same path (the A8 in-place-update rescan path) → asserts
      `kind`/`classification_source` are unchanged (that code path never
      touches classification fields, by construction).
- [x] **T019** Unknown filename → `kind = intermediate`, confidence < 0.2.
      — `app_core::artifact::tests::detect_unknown_file_falls_back_to_intermediate`

---

## US3 — Surface artifacts in the project drawer (P3)

**Independent test**: open a project drawer with launches and
artifacts. The Tool Launches accordion shows each launch followed by
its detected artifacts grouped by `kind` with a count badge.
Artifacts without a matching launch appear in an "Unattributed"
group. Missing artifacts visibly distinguish their state and offer a
"Mark resolved" affordance.

- [x] **T020** Implement `artifact.list` use case returning summaries
      ordered by attribution + detected_at.
      — `crates/app/core/src/artifact.rs::list`; Tauri command `artifact.list`
- [x] **T021** Generate TypeScript types from `contracts/artifact.list.json`.
      — `packages/contracts/src/generated/artifact.list.d.ts`; added to index.ts
- [x] **T022** Implement tool-launch attribution in the detection path
      (nearest preceding launch within 6h window, same tool, app-clock).
      — `workflow_artifacts::attribution::attribute`; `app_core::artifact::detect`; 6 attribution unit tests
- [x] **T022b** Implement re-attribution on `tool.launch` event (A7).
      — `workflow_artifacts::attribution::reattribute_candidates`; `app_core::artifact::reattribute`; 4 unit tests
- [x] **T022c** Implement `workflow.run_completed` emission (FR-010).
      — `app_core::artifact::complete_run`; emits to event bus; `complete_run_emits_workflow_run_completed` test
- [x] **T023** ToolLaunchesAccordion component: attributed groups +
      Unattributed group, grouping logic unit-tested.
      — `apps/desktop/src/features/projects/ToolLaunchesAccordion.tsx`; `artifacts.ts`; `artifacts.test.ts`
- [x] **T024** "Mark resolved" affordance wired to `artifact.mark_resolved`
      command via `useArtifactMarkResolved` hook.
      — `ArtifactRow` in `ToolLaunchesAccordion.tsx`
- [x] **T025** Visual distinction for `missing` rows (strikethrough +
      "Missing" badge) and `manual_override` rows ("(manual)" indicator).
      — `ArtifactRow` in `ToolLaunchesAccordion.tsx`
- [ ] **T026** Playwright MCP scenario. RE-ADJUDICATED (prior rationale was
      stale/wrong): headless mock-mode Playwright does NOT need a display —
      16 other `tests/e2e/*.spec.ts` specs already run headless against the
      mock UI in this repo's normal test flow. The real blocker is that no
      artifact/tool-launch-accordion mock fixture or spec exists yet at all
      (`grep -rl missing|manual_override tests/e2e` = no hits) and this
      sandbox has no provisioned Playwright browser binaries — authoring a
      new spec + mock fixture from scratch is net-new scope, not a
      reconciliation of existing coverage. Genuinely deferred; the underlying
      behavior (grouping, visual distinction, mark-resolved) is covered by
      `artifacts.test.ts` vitest unit tests (T023/T025).
- [x] **T027** Grouping test: artifact with tool_launch_id grouped under
      that launch. — `artifacts.test.ts::single attributed group with no unattributed`
- [x] **T028** Grouping test: artifact with null tool_launch_id goes to
      Unattributed group. — `artifacts.test.ts::all unattributed artifacts go to a single null bucket`

---

## Cross-cutting tasks

- [x] **TX01** Wire `artifact.list`, `artifact.classify`, and
      `artifact.mark_resolved` into the Tauri command boundary.
      — `apps/desktop/src-tauri/src/commands/artifacts.rs`; registered in `lib.rs`
- [ ] **TX02** Documentation: `docs/research/artifact-observation.md`. DEFERRED.
- [x] **TX03** Constitution recheck. PASS — see plan.md §Constitution Check.
- [x] **TX04** Cross-spec dependency check with spec 011 + 024. RE-ADJUDICATED
      (spec 024 has since shipped): `workflow.run_completed` now has a real
      subscriber — `app_core_projects::project_manifests::spawn_workflow_run_subscriber`
      (`crates/app/projects/src/project_manifests.rs:412`; *(reconciliation
      note, 2026-07-19, issue #764: fn name/line corrected — was cited as
      `spawn_workflow_run_completed_subscriber` at `:275`)*) persists a
      `WorkflowRunManifest` row on every event. Proven end-to-end (real tool
      launch → real `workflow.run_completed` publish → real manifest row) by
      `crates/app/core/tests/workflow_run_manifest_e2e.rs::real_tool_launch_completion_persists_a_workflow_run_manifest`
      (spec 011's tool-launch completion is what triggers `complete_run`).
      All three specs' handshake is exercised by a passing test, not just
      "event defined."
- [x] **TX05** Cross-spec dependency check with spec 017. RE-ADJUDICATED:
      `crates/app/core/src/cleanup_generator.rs` (spec 017's cleanup-plan
      generator) documents `processing_artifacts` as "the ONLY per-project
      file store" it reads from and classifies every candidate via
      `DataType::from_artifact_kind` against spec 012's `kind` vocabulary
      (`intermediate | master | final`) — 14 passing tests in that module
      exercise the dependency directly (e.g. `scan_actioned_type_becomes_candidate_and_sums_bytes`,
      `scan_excludes_unclassified`). This has been true for a while; just
      never ticked here.

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
