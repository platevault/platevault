---

description: "Task list for Inbox Mixed-Folder Split (spec 005)"
---

# Tasks: Inbox Mixed-Folder Split

**Input**: Design documents from `/specs/005-inbox-mixed-folder-split/`
**Prerequisites**: spec.md, plan.md, research.md, data-model.md, contracts/

**Tests**: Tests are included for contract surfaces and classifier logic
because correctness here directly governs whether files can be silently
mis-promoted into Inventory.

**Organization**: Tasks are grouped by user story. The desktop mockup is
already present (see Implementation Status in spec.md); each US notes
which tasks the mockup already covers.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User story (US1, US2, US3, US4)
- **[MOCKUP-DONE]**: Already demonstrated in the desktop mockup; needs
  rewiring to real contracts, not new design

## Path Conventions

Monorepo paths per plan.md "Project Structure":

- Rust crates under `crates/...`
- Desktop UI under `apps/desktop/src/features/inbox/`
- TS contracts under `packages/contracts/inbox/`
- Contract & integration tests under `tests/`

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 Create crate skeletons referenced by plan.md: `crates/metadata/core`, `crates/metadata/fits`, `crates/metadata/xisf`, `crates/domain/core` (if not present), `crates/app/core` (if not present). Each as a workspace member.
- [ ] T002 [P] Add JSON Schema lint + codegen step in `packages/contracts/inbox/` to produce TS types from `specs/005-inbox-mixed-folder-split/contracts/*.json`.
- [ ] T003 [P] Add fixture corpus structure under `tests/fixtures/inbox/` with subfolders `single_light/`, `single_dark/`, `mixed_light_dark/`, `mixed_with_unreadable/`, `filename_only/` (no headers).

---

## Phase 2: Foundational (Blocking Prerequisites)

- [ ] T004 In `crates/metadata/core`: define `FrameType` enum, normalization table, and `EvidenceSource` enum per data-model.md.
- [ ] T005 [P] In `crates/metadata/fits`: implement minimal header reader for `IMAGETYP`, `FILTER`, `OBJECT`. Return raw values; do not normalize here.
- [ ] T006 [P] In `crates/metadata/xisf`: implement equivalent property reads, mapping to the same `FrameType` enum.
- [ ] T007 In `crates/domain/core`: define `InboxClassificationRule` with the confidence thresholds and consensus algorithm from research.md (defaults configurable per library).
- [ ] T008 In `crates/persistence/db`: add tables `inbox_items`, `inbox_classifications`, `inbox_classification_evidence`, `inbox_plan_links` per data-model.md. Add the partial unique index enforcing "at most one open plan per Inbox item".
- [ ] T009 [P] In `crates/contracts/core`: define Rust DTOs matching `inbox.classify.json` and `inbox.confirm.json`. Wire serde derives.
- [ ] T010 In `crates/app/core`: define use-case traits `InboxClassifyUseCase` and `InboxConfirmUseCase` with the input/output shapes from the contracts.

**Checkpoint**: classifier and contract types compile in isolation; no use-case bodies yet.

---

## Phase 3: User Story 1 - Detect Mixed vs Single-Type Folders (Priority: P1) MVP

**Goal**: A single contract call classifies an Inbox folder using header-first evidence with a confidence value.

**Independent Test**: Run `inbox.classify` against each fixture folder and assert the response matches the expected enum and confidence band.

**Mockup status**: The drawer already renders an `InboxItem` with a `mixedBreakdown`. Classification itself is hand-authored seed data. **Backend is greenfield.**

### Tests for User Story 1

- [ ] T011 [P] [US1] Contract test in `tests/contract/inbox/test_classify.rs`: validates request/response against `contracts/inbox.classify.json`.
- [ ] T012 [P] [US1] Integration test in `tests/integration/inbox/test_classify_fixtures.rs`: feeds each fixture corpus folder through the classifier and asserts the type, frame_type (where applicable), and confidence band.
- [ ] T013 [P] [US1] Unit test in `crates/domain/core/tests/classification_rule.rs`: consensus algorithm with synthetic per-file evidence (mixed boundary, single-type with rogue file, all-unclassified).

### Implementation for User Story 1

- [ ] T014 [US1] Implement `InboxClassifyUseCase` in `crates/app/core/src/inbox/classify.rs`. Reads cached evidence when `content_signature` matches, falls back to metadata adapters otherwise. Returns the response shape from the contract.
- [ ] T015 [US1] Implement filename heuristic fallback in `crates/metadata/core/src/filename_heuristic.rs` covering NINA, SGP, ASIAIR, KStars, PI WBPP output patterns from research.md.
- [ ] T016 [US1] Persist `InboxClassification` and `InboxClassificationEvidence` rows. Invalidate on `force_rescan` or `content_signature` drift.
- [ ] T017 [US1] Wire `inbox.classify` into the Tauri command surface in `apps/desktop/src-tauri/`. Replace the seed `mixedBreakdown` consumer in `apps/desktop/src/data/store.ts` with a real classify call. **MOCKUP-DONE for UI presentation.**

**Checkpoint**: A real folder on disk produces a real classification.

---

## Phase 4: User Story 2 - Surface File-Level Breakdown (Priority: P2)

**Goal**: Detail drawer renders one row per detected frame type with counts, sample files, destination previews, and a "Needs review" group when applicable.

**Independent Test**: Open the desktop UI against a mixed fixture; visually verify rows match the contract response and that "Needs review" appears for files whose evidence is missing.

**Mockup status**: `InboxPage.tsx` already renders the breakdown rows with sample files. Wire-up to contract data and the Needs Review group is new.

### Tests for User Story 2

- [ ] T018 [P] [US2] Component test in `apps/desktop/src/features/inbox/__tests__/InboxPage.breakdown.test.tsx`: given a contract-shaped classification, the drawer renders the expected rows.
- [ ] T019 [P] [US2] Snapshot test for the destination-preview formatter — verify it consumes the spec 015 token pattern correctly.

### Implementation for User Story 2

- [ ] T020 [US2] Add destination-preview resolution in `crates/app/core/src/inbox/classify.rs` using the active Naming & Structure pattern (spec 015). Preview-only; not the canonical destination.
- [ ] T021 [US2] Render the "Needs review" sub-list in `InboxPage.tsx` from `unclassified_files`. **MOCKUP-EXTENDED**: the existing drawer must learn this new section.
- [ ] T022 [US2] Surface per-row confidence and evidence source in the drawer (collapsed by default; expand on click).

**Checkpoint**: Users can audit the classifier's reasoning before any plan exists.

---

## Phase 5: User Story 3 - Generate Split Plan From Mixed Folder (Priority: P3)

**Goal**: "Generate split plan" produces a Plan in `ready_for_review` with one PlanItem per scanned file, grouped by frame type, destinations resolved through spec 015.

**Independent Test**: Run `inbox.confirm { action: "split" }` against a mixed fixture; assert plan exists in DB with `items_total == file_count` and that re-running classify shows the Inbox item linked to a plan.

**Mockup status**: `createPlanFromInbox` already builds per-file items and runs a fake `simulateApply` progression. **The plan generation logic, pattern resolution, and persistence are all new.**

### Tests for User Story 3

- [ ] T023 [P] [US3] Contract test in `tests/contract/inbox/test_confirm_split.rs`: validates request/response and error codes against `contracts/inbox.confirm.json`.
- [ ] T024 [P] [US3] Integration test: split a 100-file mixed fixture and verify the resulting Plan has 100 items grouped by frame type.
- [ ] T025 [P] [US3] Negative test: with the active Naming & Structure pattern unset, `inbox.confirm { action: "split" }` returns `pattern.unset` and no plan is persisted.
- [ ] T026 [P] [US3] Negative test: `inbox.confirm { action: "confirm" }` on a mixed item returns `classification.ambiguous`.

### Implementation for User Story 3

- [ ] T027 [US3] Implement `InboxConfirmUseCase` (split branch) in `crates/app/core/src/inbox/confirm.rs`. Resolves the active Naming & Structure pattern, validates all required tokens resolve for every file, and atomically creates a Plan + PlanItems via `crates/fs/planner`.
- [ ] T028 [US3] Implement `InboxConfirmUseCase` (confirm branch) for single-type items: same machinery, one logical group instead of N.
- [ ] T029 [US3] Group key on PlanItems: include `frame_type` in plan-item metadata so the planner stays frame-type-agnostic while the UI can group by it.
- [ ] T030 [US3] Subscribe to the plans publisher: on `applied`, update `InboxItem.state` to `resolved`; on `discarded`/`failed`, delete the `inbox_plan_links` row. Implement in `crates/app/core/src/inbox/plan_listener.rs`.
- [ ] T031 [US3] Replace the mockup's `createPlanFromInbox` with a Tauri command calling `inbox.confirm`. **MOCKUP-REPLACED.**

**Checkpoint**: A mixed folder can be split into Inventory via the real plan pipeline.

---

## Phase 6: User Story 4 - Dedupe Open Plan For Same Inbox Item (Priority: P4)

**Goal**: A second attempt to confirm/split an Inbox item with an open plan returns `inbox.has.open.plan { existing_plan_id }` and the UI routes to that plan.

**Independent Test**: After generating a split plan, re-call `inbox.confirm`; assert the error code and `existing_plan_id`. In the UI, the CTA reads "Open existing plan".

**Mockup status**: `InboxPage.tsx` already filters `usePlans()` to dedupe CTAs. **The contract enforcement is new.**

### Tests for User Story 4

- [ ] T032 [P] [US4] Contract test: second `inbox.confirm` returns `inbox.has.open.plan` with `existing_plan_id` populated.
- [ ] T033 [P] [US4] Integration test for the partial unique index in `crates/persistence/db`: attempting to insert a second open `inbox_plan_links` row fails.
- [ ] T034 [P] [US4] UI test: with an open plan present, the CTA renders "Open existing plan" and clicking it navigates to the plan detail.

### Implementation for User Story 4

- [ ] T035 [US4] Enforce the invariant in `InboxConfirmUseCase` (pre-flight check on `inbox_plan_links` before plan creation). Treat the partial unique index as a defense-in-depth backstop.
- [ ] T036 [US4] On plan close (`applied`/`discarded`/`failed`), confirm the listener from T030 releases the link so a new split is permitted.
- [ ] T037 [US4] Rewire the existing mockup dedupe logic in `apps/desktop/src/features/inbox/InboxPage.tsx` to consume the contract error rather than client-side `useMemo` filtering. **MOCKUP-REPLACED.**

**Checkpoint**: All four user stories functional. Invariant holds across UI, use case, and DB layers.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T038 [P] Validate confidence thresholds (research.md §Confidence Thresholds) against the full fixture corpus. Adjust defaults or mark thresholds as library-configurable in `crates/domain/core`.
- [ ] T039 [P] Add quickstart.md walking through the four user stories against the fixture corpus.
- [ ] T040 Performance bench: classify a 500-file folder; assert under 2 s on the reference workstation (SC adjacent to SC-004).
- [ ] T041 [P] Audit log: ensure classifier and plan-creation operations emit audit events through `crates/audit` per constitution principle II.
- [ ] T042 Resolve `[NEEDS DECISION]` items in spec.md or escalate to follow-up specs.

---

## Dependencies & Execution Order

### Task Dependencies

```toml
[graph]

[graph.T001]
blocked_by = []
[graph.T002]
blocked_by = []
[graph.T003]
blocked_by = []

[graph.T004]
blocked_by = ["T001"]
[graph.T005]
blocked_by = ["T001", "T004"]
[graph.T006]
blocked_by = ["T001", "T004"]
[graph.T007]
blocked_by = ["T004"]
[graph.T008]
blocked_by = ["T001"]
[graph.T009]
blocked_by = ["T001", "T002"]
[graph.T010]
blocked_by = ["T007", "T008", "T009"]

[graph.T011]
blocked_by = ["T009"]
[graph.T012]
blocked_by = ["T003", "T010"]
[graph.T013]
blocked_by = ["T007"]
[graph.T014]
blocked_by = ["T010", "T005", "T006"]
[graph.T015]
blocked_by = ["T004"]
[graph.T016]
blocked_by = ["T014", "T008"]
[graph.T017]
blocked_by = ["T014", "T016"]

[graph.T018]
blocked_by = ["T017"]
[graph.T019]
blocked_by = ["T020"]
[graph.T020]
blocked_by = ["T014"]
[graph.T021]
blocked_by = ["T017"]
[graph.T022]
blocked_by = ["T017"]

[graph.T023]
blocked_by = ["T009"]
[graph.T024]
blocked_by = ["T027"]
[graph.T025]
blocked_by = ["T027"]
[graph.T026]
blocked_by = ["T027"]
[graph.T027]
blocked_by = ["T014", "T016", "T020"]
[graph.T028]
blocked_by = ["T027"]
[graph.T029]
blocked_by = ["T027"]
[graph.T030]
blocked_by = ["T027", "T008"]
[graph.T031]
blocked_by = ["T027", "T028"]

[graph.T032]
blocked_by = ["T035"]
[graph.T033]
blocked_by = ["T008"]
[graph.T034]
blocked_by = ["T037"]
[graph.T035]
blocked_by = ["T027", "T030"]
[graph.T036]
blocked_by = ["T030"]
[graph.T037]
blocked_by = ["T035"]

[graph.T038]
blocked_by = ["T013", "T012"]
[graph.T039]
blocked_by = ["T031", "T037"]
[graph.T040]
blocked_by = ["T014"]
[graph.T041]
blocked_by = ["T027"]
[graph.T042]
blocked_by = ["T017", "T021", "T031", "T037"]
```

### Phase Dependencies

- **Setup (Phase 1)**: independent
- **Foundational (Phase 2)**: depends on Setup; blocks all user stories
- **US1 (Phase 3)**: depends on Foundational; MVP
- **US2 (Phase 4)**: depends on US1 (consumes its breakdown shape)
- **US3 (Phase 5)**: depends on US1; independent of US2 in principle, but UI rewire (T031) benefits from T021
- **US4 (Phase 6)**: depends on US3 (needs a real plan to dedupe)
- **Polish (Phase 7)**: depends on the user stories it touches

### Parallel Opportunities

- T002, T003 can run alongside T001.
- T005, T006 are different crates and run in parallel after T004.
- All `[P]` test tasks within a user story can run in parallel before their implementation tasks (TDD-friendly).

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phases 1–2 (Setup + Foundational).
2. Phase 3 (US1): classify works end-to-end against fixtures.
3. **STOP**: validate confidence thresholds against the corpus before
   layering UI polish or plan generation on top. This is the single
   highest-value gate in the feature.

### Incremental Delivery

US1 → US2 → US3 → US4. Each story tightens the loop; US4 is the
safety-net invariant and should not be skipped.

---

## Notes

- The desktop mockup is intentionally retained during US1–US2 to keep the
  UI testable while the Rust core is built. From US3 onward the mockup's
  fake plan creation is replaced; do not extend the mockup further.
- All `[NEEDS DECISION]` items in spec.md must be resolved before T042
  closes the feature. They are real product gates, not editorial markers.
- Hashing of image files is explicitly avoided in this feature per
  constitution; `content_signature` is filename+size+mtime only.
