---
description: "Task list for Data Lifecycle State Model (Spec 002)"
---

# Tasks: Data Lifecycle State Model

**Input**: Design documents from `/specs/002-data-lifecycle-state-model/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/lifecycle.transition.json

**Tests**: Included — the constitution (§Reviewable Filesystem Mutation, §V Portable Contracts) requires audit-event and contract fidelity checks before any apply path lands.

**Organization**: Tasks are grouped by user story (US1 — Understand Data State; US2 — Trace Lifecycle Transitions). The UI mockup at `apps/desktop/src/data/` already realises a subset of US1 + US2 shape; those tasks are tagged `[mockup ✓, needs Rust port]` and call out the canonical destination crate.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies).
- **[Story]**: Maps task to a user story (US1, US2) or to Setup/Foundational/Polish.
- **[mockup ✓, needs Rust port]**: Behavior is shadowed in the desktop mockup; canonical implementation MUST land in the named Rust crate.
- File paths are absolute repo-relative.

## Path Conventions

- Rust crates: `crates/<area>/`.
- Tauri adapter: `apps/desktop/src-tauri/src/commands/`.
- Contracts source: `specs/002-data-lifecycle-state-model/contracts/`.
- Contracts published: `packages/contracts/`.
- UI adapter: `apps/desktop/src/data/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Wire the workspace skeleton for the lifecycle domain.

- [x] T001 Confirm workspace members for `crates/domain/core`, `crates/audit`, `crates/persistence/db`, `crates/contracts/core`, `crates/app/core` exist in `Cargo.toml`; add empty crates where missing.
- [x] T002 [P] Add `serde`, `thiserror`, `uuid`, `time` to `crates/domain/core/Cargo.toml` per plan.md Technical Context.
- [x] T003 [P] Add `sqlx` (sqlite, runtime-tokio-rustls, macros) to `crates/persistence/db/Cargo.toml`.
- [x] T004 [P] Add `schemars` to `crates/contracts/core/Cargo.toml` for JSON Schema GENERATION from Rust DTOs (Rust is canonical source of truth; JSON files are reproducible projections per research.md §9).
- [x] T005 [P] Wire `packages/contracts/` build script to copy `specs/002-data-lifecycle-state-model/contracts/lifecycle.transition.json` and `specs/002-data-lifecycle-state-model/contracts/provenance.read.json` into `packages/contracts/` at build time (plan.md §Project Structure).
- [x] T005b [P] Create `crates/contracts/core/src/bin/generate-contracts.rs` binary that walks all Rust DTOs in `crates/contracts/core/src/` and emits JSON Schemas to `specs/<NNN>/contracts/*.json` via `schemars::schema_for!()`. Output uses stable serialization (sorted keys). The binary reads existing contract files to copy the `$id` field. CI runs this + `git diff --exit-code specs/*/contracts/*.json` to gate Rust DTO changes (research.md §9.2–9.3).
- [x] T005c [P] Wire `specta` + `tauri-specta` Rust→TypeScript codegen: add `specta` and `tauri-specta` to workspace deps; create `cargo run --bin generate-bindings` (or equivalent `tauri-specta` hook) that regenerates `apps/desktop/src/bindings/*.ts` from Rust Tauri command signatures. CI asserts `git diff --exit-code apps/desktop/src/bindings/` after regeneration (research.md §9.5).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Establish the canonical types and persistence shape that every user story needs.

**⚠️ CRITICAL**: No US work begins until this phase is complete.

- [x] T006 [P] Define `LifecycleState` family enums in `crates/domain/core/src/lifecycle/{project,plan,session,inventory,data_source,prepared_source,projection}.rs` matching data-model.md state families.
- [x] T007 [P] Define `ProvenanceTag` enum and `ProvenancedValue<T>` in `crates/domain/core/src/lifecycle/provenance.rs` per research.md §4 and data-model.md §ProvenancedValue.
- [x] T008 Define the canonical `DataAsset` trait + lifecycle-bearing entity structs in `crates/domain/core/src/lifecycle/mod.rs` (depends on T006, T007). Anchors FR-007.
- [x] T009 [P] Define `AuditLogEntry`, `Outcome`, `Severity` in `crates/audit/src/event.rs` per data-model.md §AuditLogEntry.
- [x] T010 SQLite schema migration `crates/persistence/db/migrations/0002_lifecycle.sql` covering `library_root`, `file_record`, `acquisition_session`, `calibration_session`, `calibration_master`, `target`, `project`, `processing_artifact`, `filesystem_plan`, `audit_log_entry`, and `provenance_history_archive` (depends on T008, T009). Ledger columns MUST omit `confidence/evidence/provenance` (FR-006). `provenance_history_archive` schema per data-model.md §ProvenanceHistoryArchive.
- [x] T010b [P] Add durable event-bus SQLite `events` table to the migration in T010 (or a separate `0002_events.sql`). Schema: `(event_id INTEGER PRIMARY KEY AUTOINCREMENT, topic TEXT NOT NULL, source TEXT NOT NULL CHECK(source IN ('user','restore','system')), emitted_at TEXT NOT NULL, payload JSON NOT NULL)`. Subscribers read with a `since: event_id` cursor for replay. Part of the hybrid event-bus design (research.md §6.1, plan.md Technical Context). Depends on T003.
- [x] T011 [P] Repository trait `LifecycleRepository` in `crates/persistence/db/src/repositories/lifecycle.rs` with read + transactional-mutate signatures (depends on T010).
- [x] T012 Rust DTO mirror of `lifecycle.transition.json` in `crates/contracts/core/src/lifecycle.rs`, deriving serde + Display for codes (depends on T006).

**Checkpoint**: Foundation ready — user-story tasks can begin in parallel.

---

## Phase 3: User Story 1 — Understand Data State (Priority: P1) 🎯 MVP

**Goal**: Field-level provenance and asset-level state are queryable, distinguishable in detail views, and absent from ledger rows.

**Independent Test**: Load a `FileRecord` with overlapping `observed`, `inferred`, and `reviewed` entries; detail view returns the priority-resolved value plus full history; ledger query returns no provenance columns.

### Tests for User Story 1

> Write tests FIRST; ensure they FAIL before implementation.

- [x] T013 [P] [US1] Unit test in `crates/domain/core/tests/provenance.rs` verifying priority `reviewed > inferred > observed` and append-only history.
- [x] T014 [P] [US1] Unit test in `crates/domain/core/tests/asset_state.rs` verifying that ledger projections exclude provenance columns (FR-006).
- [x] T015 [P] [US1] Integration test in `crates/persistence/db/tests/lifecycle_read.rs` confirming ledger queries omit `confidence/evidence/provenance` and detail queries surface `ProvenancedValue.history`.
- [x] T016 [P] [US1] JSON-Schema fixture test in `packages/contracts/tests/lifecycle.transition.fixtures.test.ts` (Vitest) validating sample request/response shapes against `lifecycle.transition.json` Draft 2020-12.

### Implementation for User Story 1

- [x] T017 [US1] Implement `ProvenancedValue<T>` serde + priority resolution in `crates/domain/core/src/lifecycle/provenance.rs` (depends on T007, T013).
- [x] T018 [P] [US1] Implement `DataAsset` enum dispatch (`FileRecord`, `AcquisitionSession`, `CalibrationSession`, `Project`, `PreparedSource`, `ProcessingArtifact`, `FilesystemPlan`) in `crates/domain/core/src/lifecycle/mod.rs` (depends on T008, T014). `[mockup ✓, needs Rust port]` from `apps/desktop/src/data/mock.ts`.
- [x] T019 [US1] Read-side repository methods (`load_asset_detail`, `list_assets_ledger`) in `crates/persistence/db/src/repositories/lifecycle.rs` (depends on T011, T015).
- [x] T020 [US1] Use case `read_asset_detail` in `crates/app/core/src/usecases/lifecycle.rs` returning provenance-rich detail (depends on T019).
- [x] T021 [US1] Tauri command `lifecycle.read_asset_detail` in `apps/desktop/src-tauri/src/commands/lifecycle.rs` (depends on T020).
- [x] T021a [US1] Use case `provenance.read` in `crates/app/core/src/usecases/lifecycle.rs` returning the contract shape defined in `contracts/provenance.read.json` (inline history per origin tag + `history_truncated` flag; archive lookup via `provenance_history_archive` table from T010) (depends on T019). Tauri command `provenance.read` in `apps/desktop/src-tauri/src/commands/lifecycle.rs`.
- [x] T022 [US1] Contract codegen: generate TypeScript surface from `packages/contracts/lifecycle.transition.json` and `packages/contracts/provenance.read.json` into `packages/contracts/generated/` (depends on T005, T016).
- [ ] T023 [US1] Replace `apps/desktop/src/data/store.ts` provenance-shape code with a thin adapter calling the Tauri command; preserve existing hook signatures so `ProjectsPage.tsx`, `PlanDetailPage.tsx`, `InventoryPage.tsx` stay untouched (depends on T021, T022). `[mockup ✓, needs Rust port]`.
- [ ] T024 [P] [US1] Vitest test in `apps/desktop/src/data/store.test.ts` verifying the adapter exposes the same hook signatures the components consume.
- [ ] T025 [US1] Playwright MCP smoke in `tests/e2e/lifecycle_detail.spec.ts` verifying detail view shows observed/inferred/reviewed columns and ledger row hides them (depends on T023).

**Checkpoint**: US1 functional and independently testable.

---

## Phase 4: User Story 2 — Trace Lifecycle Transitions (Priority: P2)

**Goal**: Lifecycle transitions are gated by the published transition graph, audit-logged transactionally, and idempotent on same-state writes; refused transitions log without mutating.

**Independent Test**: Drive a `Project` through `setup_incomplete → ready → prepared → processing → completed → archived → processing`; verify each step writes a workflow audit entry, that `processing → ready` is refused with `transition.refused`, and that a same-state write returns `state.unchanged` with no audit entry.

### Tests for User Story 2

> Write tests FIRST; ensure they FAIL before implementation.

- [x] T026 [P] [US2] Unit test in `crates/domain/core/tests/project_transitions.rs` asserting the full edge list from research.md §2.1 / data-model.md §Project §Lifecycle.
- [x] T027 [P] [US2] Unit test in `crates/domain/core/tests/plan_transitions.rs` asserting the edge list from research.md §2.2.
- [x] T028 [P] [US2] Unit test in `crates/domain/core/tests/session_transitions.rs` asserting the edge list from research.md §2.3.
- [ ] T029 [P] [US2] Integration test in `crates/app/core/tests/transition_apply.rs` covering: success path, refused-no-mutation path, same-state no-op path, plan-required path (depends on T012, T010).
- [x] T030 [P] [US2] JSON-Schema fixture test in `packages/contracts/tests/lifecycle.transition.errors.test.ts` covering each error code: `transition.refused`, `entity.not_found`, `actor.not_authorised`, `plan.required`, `plan.not_approved`, `provenance.unreviewed` (with the `blocking_fields` detail shape). Plus a fixture for the `status: "noop"` success-of-sorts response (no `audit_id`, no `error`).
- [ ] T031 [P] [US2] Audit-event integration test in `crates/audit/tests/transactional.rs` verifying audit row + state mutation share a transaction (no half-writes).

### Implementation for User Story 2

- [x] T032 [US2] Encode project transition table in `crates/domain/core/src/lifecycle/project.rs` (depends on T026). `[mockup ✓, needs Rust port]` from `apps/desktop/src/data/store.ts:376` `PROJECT_TRANSITIONS`.
- [x] T033 [P] [US2] Encode plan transition table in `crates/domain/core/src/lifecycle/plan.rs` (depends on T027). `[mockup ✓, needs Rust port]` from `apps/desktop/src/data/store.ts` `simulateApply`.
- [ ] T033a [P] [US2] Implement session-key derivation `session_key(target_id, filter, binning, gain, observing_night)` and the `observing_night` local-solar-noon algorithm in `crates/sessions/src/key.rs` per research.md §2.5 and spec.md FR-011 (depends on T006). Sits before T034 in dependency order. Refuses to derive when `observer_location` (spec 018) is unset and surfaces `provenance.unreviewed` against that field.
- [x] T034 [P] [US2] Encode session transition table in `crates/domain/core/src/lifecycle/session.rs` (depends on T028, T033a). `[mockup ✓, needs Rust port]` from `apps/desktop/src/data/store.ts` `setSessionReviewState`.
- [x] T035 [P] [US2] Encode data-source, prepared-source, projection transition tables in their respective `crates/domain/core/src/lifecycle/*.rs` files.
- [x] T035a [P] [US2] Encode FileRecord transition table in `crates/domain/core/src/lifecycle/file_record.rs` per research.md §2.4 and data-model.md §FileRecord. Includes an exhaustive edge-list unit test in `crates/domain/core/tests/file_record_transitions.rs` mirroring the format of T026/T027/T028 (split out from T035 because FileRecord is first-class — GRILL 2026-05-21).
- [x] T036 [US2] No-op guard + refused-edge logger in `crates/domain/core/src/lifecycle/mod.rs` returning `Outcome::Noop` (no audit row; contract `status: "noop"`) / `Outcome::Refused` (audit row, contract `status: "error"` with `error.code = "transition.refused"`) per research.md §5 (depends on T032, T033, T034, T035, T035a). `[mockup ✓, needs Rust port]` from `store.ts:457` and `store.ts:406-413`.
- [x] T037 [US2] Transactional `apply_transition` in `crates/persistence/db/src/repositories/lifecycle.rs` writing entity update + audit row in one tx, or audit-only for refused, or nothing for suppressed-unchanged (depends on T010, T036).
- [x] T038 [US2] Use case `transition_apply` in `crates/app/core/src/usecases/lifecycle.rs` validating actor, dispatching by family, returning the contract response shape (depends on T037, T012, T029). MUST enforce the `actor=system` edge policy (GRILL spec 009 ratification): `actor == system` is permitted ONLY on edges entering or leaving `blocked`; any other edge with `actor == system` MUST be rejected with `transition.refused` and audit-logged. MUST also enforce action-bound review (FR-009/FR-010): when action-critical fields are not `reviewed`, refuse with `provenance.unreviewed` and populate `error.details.blocking_fields` per `contracts/lifecycle.transition.json`. On success, publish `lifecycle.transition.applied` on the in-process event bus (research.md §6.1).
- [ ] T039 [US2] Use case `transition_preview` in `crates/app/core/src/usecases/lifecycle.rs` (read-only "would this be allowed?") for UI dry-run.
- [x] T040 [US2] Tauri commands `lifecycle.transition.apply` and `lifecycle.transition.preview` in `apps/desktop/src-tauri/src/commands/lifecycle.rs` (depends on T038, T039).
- [ ] T041 [US2] Swap `apps/desktop/src/data/store.ts` `setProjectLifecycle`, `setSessionReviewState`, `simulateApply` to call the Tauri commands; preserve hook signatures so `ProjectsPage.tsx`, `PlanDetailPage.tsx`, `InventoryPage.tsx` need no edits (depends on T040). `[mockup ✓, needs Rust port]`.
- [ ] T042 [P] [US2] Vitest in `apps/desktop/src/data/store.transitions.test.ts` covering refused-edge UI projection and `usePendingPlansCount` partition into `needsAction` / `needsAttention`. `[mockup ✓, needs Rust port]`.
- [ ] T043 [US2] Playwright MCP smoke in `tests/e2e/lifecycle_transitions.spec.ts` driving a project through the full transition path and asserting the timeline renders only workflow-significant events (FR-008) (depends on T041).
- [x] T044 [US2] FilesystemPlan gate in `crates/app/core/src/usecases/lifecycle.rs`: the canonical `(entity_type, from, to) → requires_plan` edge table lives in `crates/domain/core/src/lifecycle/plan_requirement.rs` (authored from data-model.md §Plan-Requirement Edge Table). Callers MUST NOT pass `requires_plan` on the request; the server derives it. Any transition whose edge yields `requires_plan = true` MUST refuse with `plan.required` (creating a draft `FilesystemPlan` and returning its `plan_id`) or `plan.not_approved` until the plan reaches `approved` (depends on T038). Includes the actor=system edge-policy enforcement note shared with T038.

**Checkpoint**: US1 + US2 both functional independently.

---

## Phase 5: Polish & Cross-Cutting

**Purpose**: Tighten cross-story behavior before declaring the spec implementation-ready.

- [x] T045 [P] Audit severity filter (`workflow` vs `diagnostic`) in `crates/audit/src/event.rs` and timeline read API (FR-008). Default UI timelines and the spec 019 log panel filter `severity = workflow` (GRILL 2026-05-21 resolved); diagnostic events stay queryable behind the toggle.
- [x] T046 [P] Event-bus driven stale-propagation pass: subscribe to `lifecycle.transition.applied` (research.md §6.1) and recompute dependent `ProcessingArtifact.staleness` and `PreparedSource.state` rows on source transition (FR-003). Replaces the earlier "lazy with `dependents_dirty_at` timestamp" approach. Subscribers MUST be idempotent on `(audit_id, subscriber_id)`.
- [ ] T047 [P] Immutable session snapshot writer (FR-005) in `crates/persistence/db/src/repositories/lifecycle.rs` on each transition into/out of `confirmed`/`rejected`/`needs_review`.
- [ ] T048 [P] Documentation pass in `docs/research/lifecycle-state-model.md` cross-linking the resolved questions from research.md §8.
- [x] T049 Run `just lint` + `just test` + `just typecheck` from repo root and resolve any drift before declaring ready-for-impl.

---

## Dependencies & Execution Order

### Task Dependencies

```toml
[graph]
T001 = { blocked_by = [] }
T002 = { blocked_by = ["T001"] }
T003 = { blocked_by = ["T001"] }
T004 = { blocked_by = ["T001"] }
T005 = { blocked_by = ["T001"] }
T005b = { blocked_by = ["T004"] }
T005c = { blocked_by = ["T001"] }

T006 = { blocked_by = ["T002"] }
T007 = { blocked_by = ["T002"] }
T008 = { blocked_by = ["T006", "T007"] }
T009 = { blocked_by = ["T002"] }
T010 = { blocked_by = ["T003", "T008", "T009"] }
T010b = { blocked_by = ["T003"] }
T011 = { blocked_by = ["T010", "T010b"] }
T012 = { blocked_by = ["T004", "T006"] }

T013 = { blocked_by = ["T007"] }
T014 = { blocked_by = ["T008"] }
T015 = { blocked_by = ["T011"] }
T016 = { blocked_by = ["T005"] }
T017 = { blocked_by = ["T007", "T013"] }
T018 = { blocked_by = ["T008", "T014"] }
T019 = { blocked_by = ["T011", "T015"] }
T020 = { blocked_by = ["T019"] }
T021 = { blocked_by = ["T020"] }
T021a = { blocked_by = ["T019"] }
T022 = { blocked_by = ["T005", "T016"] }
T023 = { blocked_by = ["T021", "T022"] }
T024 = { blocked_by = ["T023"] }
T025 = { blocked_by = ["T023"] }

T026 = { blocked_by = ["T006"] }
T027 = { blocked_by = ["T006"] }
T028 = { blocked_by = ["T006"] }
T029 = { blocked_by = ["T010", "T012"] }
T030 = { blocked_by = ["T016"] }
T031 = { blocked_by = ["T009", "T010"] }
T032 = { blocked_by = ["T026"] }
T033 = { blocked_by = ["T027"] }
T033a = { blocked_by = ["T006"] }
T034 = { blocked_by = ["T028", "T033a"] }
T035 = { blocked_by = ["T006"] }
T035a = { blocked_by = ["T006"] }
T036 = { blocked_by = ["T032", "T033", "T034", "T035", "T035a"] }
T037 = { blocked_by = ["T010", "T036"] }
T038 = { blocked_by = ["T012", "T029", "T037"] }
T039 = { blocked_by = ["T037"] }
T040 = { blocked_by = ["T038", "T039"] }
T041 = { blocked_by = ["T023", "T040"] }
T042 = { blocked_by = ["T041"] }
T043 = { blocked_by = ["T041"] }
T044 = { blocked_by = ["T038"] }

T045 = { blocked_by = ["T038"] }
T046 = { blocked_by = ["T038"] }
T047 = { blocked_by = ["T037"] }
T048 = { blocked_by = ["T044"] }
T049 = { blocked_by = ["T043", "T044", "T045", "T046", "T047"] }
```

### Phase Dependencies

- **Setup (Phase 1)**: T001 → fans out to T002–T005.
- **Foundational (Phase 2)**: blocks all US work; T006/T007 → T008 → T010 → T011 → T012.
- **US1 (Phase 3)** and **US2 (Phase 4)**: independent after Foundational; can proceed in parallel.
- **Polish (Phase 5)**: depends on US1 + US2.

### User Story Dependencies

- US1 (P1): blocked only by Foundational. Can ship as MVP.
- US2 (P2): blocked only by Foundational. Reuses US1 read paths but not its writes.

### Within Each User Story

- Tests (T013–T016, T026–T031) MUST be written and FAIL before their implementation counterparts.
- Domain code before persistence; persistence before use cases; use cases before Tauri commands; commands before UI adapter swap.
- UI components are NOT edited — only `apps/desktop/src/data/store.ts` is swapped.

### Parallel Opportunities

- T002–T005 (Setup) in parallel.
- T006/T007/T009 (Foundational pure-domain) in parallel.
- T013–T016 and T026–T031 (test scaffolding) all parallelisable.
- T018, T033, T034, T035 once their domain modules exist.
- US1 and US2 implementation streams in parallel after Foundational.

---

## Parallel Example: User Story 2

```bash
# Launch all transition-table tests for US2 together:
Task: "Unit test crates/domain/core/tests/project_transitions.rs"
Task: "Unit test crates/domain/core/tests/plan_transitions.rs"
Task: "Unit test crates/domain/core/tests/session_transitions.rs"

# Then implement the transition tables in parallel:
Task: "Encode project transitions in crates/domain/core/src/lifecycle/project.rs"
Task: "Encode plan transitions in crates/domain/core/src/lifecycle/plan.rs"
Task: "Encode session transitions in crates/domain/core/src/lifecycle/session.rs"
```

---

## Implementation Strategy

### MVP First (US1 Only)

1. Complete Phase 1 + Phase 2.
2. Complete Phase 3 (US1).
3. **STOP and VALIDATE**: detail views show provenance; ledger rows omit it.
4. Demo against the mockup parity baseline.

### Incremental Delivery

1. Foundational → US1 → US2 → Polish.
2. UI components stay frozen across the whole sequence; only `store.ts` flips from mockup to Tauri adapter.

### Parallel Team Strategy

- Dev A: US1 (read paths + provenance).
- Dev B: US2 (transition graphs + audit transactional writes).
- Dev C: Contract codegen + UI adapter (T005, T022, T023, T041).

---

## Notes

- `[mockup ✓, needs Rust port]` tags point at canonical Rust destinations; the mockup at `apps/desktop/src/data/` is a reference, not a fallback.
- Ledger rows MUST omit `confidence/evidence/provenance` columns at every layer (FR-006).
- Refused transitions MUST audit-log without mutating; same-state writes MUST be no-ops (research.md §5).
- No application implementation may begin until this `tasks.md` plus `spec.md`, `plan.md`, `research.md`, `data-model.md`, and `contracts/` have passed review (constitution §SpecKit Workflow).
- Tasks STOP at implementation point — they do not author Rust bodies, only the work breakdown.
