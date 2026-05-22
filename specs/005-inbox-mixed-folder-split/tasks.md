---

description: "Task list for Inbox Mixed-Folder Split (spec 005)"
---

# Tasks: Inbox Mixed-Folder Split

**Input**: Design documents from `/specs/005-inbox-mixed-folder-split/`
**Prerequisites**: spec.md, plan.md, research.md, data-model.md, contracts/
**Updated**: 2026-05-22 (IMAGETYP-only model, video lane, reclassify, content signature,
recursive scan, plan-open repair, R-Split-1 direct-to-Inventory, R-CratePatterns)

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

---

## Phase 0: IMAGETYP Research (blocks normalization table)

- [ ] T0-IMAGETYP-Research [P] Research task: survey IMAGETYP values emitted by NINA, SGP, APT, Voyager, Ekos/KStars, MaximDL, ACP, ASIAIR, SharpCap, ZWO ASI software, and FireCapture. Collect real FITS files or authoritative documentation per software. Output: validated mapping table in `docs/research/imagetyp-normalization.md`. (Ref: R-IMAGETYP-Norm)

---

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 Create crate skeletons referenced by plan.md: `crates/metadata/core`, `crates/metadata/fits`, `crates/metadata/xisf`, `crates/metadata/video`, `crates/patterns/` (spec 015 resolver, R-CratePatterns), `crates/domain/core` (if not present), `crates/app/core` (if not present). Each as a workspace member.
- [ ] T002 [P] Add JSON Schema lint + codegen step in `packages/contracts/inbox/` to produce TS types from `specs/005-inbox-mixed-folder-split/contracts/*.json` (classify, confirm, reclassify).
- [ ] T003 [P] Add fixture corpus structure under `tests/fixtures/inbox/` with subfolders: `single_light/`, `single_dark/`, `mixed_light_dark/`, `mixed_with_unclassified/` (IMAGETYP absent on some files), `video_mixed/` (FITS + SER), `recursive/` (nested FITS-bearing leaf folders).

---

## Phase 2: Foundational (Blocking Prerequisites)

- [ ] T004 In `crates/metadata/core`: define `FrameType` enum (`Light, Dark, Bias, Flat, DarkFlat`), `ImageTypNormalizationTable` data artifact (case-insensitive mapping from raw IMAGETYP string → FrameType), and `EvidenceSource` enum (`imagetyp_header`, `xisf_property`, `manual_override`, `none`). Normalization table is data, not hardcoded logic. (Ref: R-IMAGETYP-Norm, T0-IMAGETYP-Research)
- [ ] T-NormTable [P] Ship `ImageTypNormalizationTable` as a versioned data file (e.g. TOML or JSON) in `crates/metadata/core/data/`. Loader deserializes at startup. Validates all known entries are present. (Ref: R-IMAGETYP-Norm)
- [ ] T005 [P] In `crates/metadata/fits`: implement minimal header reader for `IMAGETYP`, `FILTER`, `OBJECT`. Return raw values; normalization happens in `crates/metadata/core`.
- [ ] T006 [P] In `crates/metadata/xisf`: implement equivalent property reads mapping to the same raw `IMAGETYP` string output.
- [ ] T007 In `crates/domain/core`: define `InboxClassificationRule` with the deterministic IMAGETYP-only consensus algorithm (single_type / mixed / unclassified per data-model.md). No confidence fields. (Ref: R-IMAGETYP, A5)
- [ ] T-VideoDetect [P] In `crates/metadata/video`: implement video file extension detection (`.ser`, `.avi`, `.mp4`, `.mov`). Returns `VideoFileRecord` with path; no FITS classification. This feeds the `lane: "video"` routing. (Ref: R-Video-1)
- [ ] T008 In `crates/persistence/db`: add tables `inbox_items` (with `lane` field), `inbox_classifications`, `inbox_classification_evidence` (with `unclassified: bool`, `manual_override: FrameType?`), `inbox_plan_links` per data-model.md. Add the partial unique index enforcing "at most one open plan per Inbox item" (open = draft | ready_for_review | approved | applying | paused). (Ref: E1)
- [ ] T009 [P] In `crates/contracts/core`: define Rust DTOs matching `inbox.classify.json`, `inbox.confirm.json`, and `inbox.reclassify.json`. Wire serde derives.
- [ ] T010 In `crates/app/core`: define use-case traits `InboxClassifyUseCase`, `InboxConfirmUseCase`, and `InboxReclassifyUseCase` with the input/output shapes from the contracts.

**Checkpoint**: classifier and contract types compile in isolation; no use-case bodies yet.

---

## Phase 3: User Story 1 - Detect Mixed vs Single-Type Folders (Priority: P1) MVP

**Goal**: A single contract call classifies an Inbox folder using IMAGETYP-only evidence. No confidence scores.

**Independent Test**: Run `inbox.classify` against each fixture folder and assert the response matches the expected enum (single_type/mixed/unclassified) and the correct frame_type where applicable.

**Mockup status**: The drawer already renders an `InboxItem` with a `mixedBreakdown`. Classification itself is hand-authored seed data. **Backend is greenfield.**

### Tests for User Story 1

- [ ] T011 [P] [US1] Contract test in `tests/contract/inbox/test_classify.rs`: validates request/response against `contracts/inbox.classify.json`. Asserts `content_signature` is present in all success responses.
- [ ] T012 [P] [US1] Integration test in `tests/integration/inbox/test_classify_fixtures.rs`: feeds each fixture corpus folder through the classifier and asserts the type and frame_type (where applicable). Asserts no unclassified files in clean fixtures; asserts per-file markers in the `mixed_with_unclassified` fixture.
- [ ] T013 [P] [US1] Unit test in `crates/domain/core/tests/classification_rule.rs`: consensus algorithm with synthetic per-file evidence (mixed, single-type with unclassified files, all-unclassified).
- [ ] T-RecursiveScan [P] [US1] Integration test: point scanner at `tests/fixtures/inbox/recursive/`; assert each FITS-bearing leaf folder becomes its own Inbox item; intermediate folders are not items. (Ref: R-Granularity-1)

### Implementation for User Story 1

- [ ] T-RecursiveScanImpl [US1] Implement recursive scan walk in `crates/app/core/src/inbox/scan.rs`. Each leaf folder containing FITS files becomes one InboxItem. Detect video files and set `lane = "video"`. (Ref: R-Granularity-1, R-Video-1)
- [ ] T-SigCompute [US1] Implement `content_signature` computation in `crates/app/core/src/inbox/signature.rs`: per-file `sha256(filename || size_bytes || mtime_unix_ns || sha256(first 65536 bytes))`; folder signature = `sha256(sorted(per_file_signatures))`. (Ref: R-Sig-1)
- [ ] T014 [US1] Implement `InboxClassifyUseCase` in `crates/app/core/src/inbox/classify.rs`. Reads cached evidence when `content_signature` matches, falls back to metadata adapters otherwise. Normalizes IMAGETYP via `ImageTypNormalizationTable`. Marks files with `unclassified = true` when IMAGETYP is absent or unmapped. Returns the response shape from the contract including `content_signature`. (Ref: R-IMAGETYP, A5, A8)
- [ ] T016 [US1] Persist `InboxClassification` and `InboxClassificationEvidence` rows (with `unclassified` and `manual_override` fields). Invalidate on `force_rescan` or `content_signature` drift.
- [ ] T017 [US1] Wire `inbox.classify` into the Tauri command surface in `apps/desktop/src-tauri/`. Replace the seed `mixedBreakdown` consumer in `apps/desktop/src/data/store.ts` with a real classify call. **MOCKUP-DONE for UI presentation.**

**Checkpoint**: A real folder on disk produces a real classification using IMAGETYP only.

---

## Phase 4: User Story 2 - Surface File-Level Breakdown (Priority: P2)

**Goal**: Detail drawer renders one row per detected frame type with counts, sample files, destination previews, and a "Needs review" group with inline reclassification affordance.

**Independent Test**: Open the desktop UI against a mixed fixture; visually verify rows match the contract response; verify "Needs review" appears for files with `unclassified = true`; verify inline picker and multiselect bulk-assign work.

**Mockup status**: `InboxPage.tsx` already renders the breakdown rows with sample files. Reclassify picker and multiselect are new.

### Tests for User Story 2

- [ ] T018 [P] [US2] Component test in `apps/desktop/src/features/inbox/__tests__/InboxPage.breakdown.test.tsx`: given a contract-shaped classification, the drawer renders the expected rows.
- [ ] T019 [P] [US2] Snapshot test for the destination-preview formatter — verify it consumes the spec 015 token pattern correctly.
- [ ] T-ReclassifyContract [P] [US2] Contract test: `inbox.reclassify` request/response validates against `contracts/inbox.reclassify.json`. (Ref: R-Unclass-1, R-Unclass-2)

### Implementation for User Story 2

- [ ] T020 [US2] Add destination-preview resolution in `crates/app/core/src/inbox/classify.rs` using `crates/patterns/` (spec 015 resolver). Preview-only; not the canonical destination.
- [ ] T021 [US2] Render the "Needs review" sub-list in `InboxPage.tsx` from `unclassified_files`. Add multiselect support (Shift+Click, Ctrl+Click, Select All) and a "Set type for selected" bulk action. **MOCKUP-EXTENDED**. (Ref: R-Unclass-2)
- [ ] T-ReclassifyImpl [US2] Implement `InboxReclassifyUseCase` in `crates/app/core/src/inbox/reclassify.rs`. Writes `manual_override` to `InboxClassificationEvidence` rows, re-runs aggregation, returns updated `updatedType` and `remainingUnclassified`. (Ref: R-Unclass-1)

**Checkpoint**: Users can audit the classifier's reasoning and reclassify unclassified files before any plan exists.

---

## Phase 5: User Story 3 - Generate Split Plan From Mixed Folder (Priority: P3)

**Goal**: "Generate split plan" produces a Plan in `ready_for_review` with one PlanItem per scanned file (enumerated from evidence rows), destinations targeting Inventory directly (not sibling staging), resolved through spec 015 resolver.

**Independent Test**: Run `inbox.confirm { action: "split", content_signature: "..." }` against a mixed fixture; assert plan exists in DB with `items_total == evidence_row_count`; assert destination paths are Inventory paths; assert re-running classify shows the Inbox item linked to a plan.

**Mockup status**: `createPlanFromInbox` already builds per-file items. **The plan generation logic, pattern resolution, content-signature check, and persistence are all new.**

### Tests for User Story 3

- [ ] T023 [P] [US3] Contract test in `tests/contract/inbox/test_confirm_split.rs`: validates request/response and error codes against `contracts/inbox.confirm.json`. Asserts `content_signature` is required.
- [ ] T024 [P] [US3] Integration test: split a 100-file mixed fixture and verify the resulting Plan has 100 items (enumerated from evidence rows), grouped by frame type, with Inventory destinations. (Ref: A9)
- [ ] T025 [P] [US3] Negative test: with the active Naming & Structure pattern unset, `inbox.confirm { action: "split" }` returns `pattern.unset` and no plan is persisted.
- [ ] T026 [P] [US3] Negative test: `inbox.confirm { action: "confirm" }` on a mixed item returns `classification.ambiguous`.
- [ ] T-StaleSig [P] [US3] Negative test: `inbox.confirm` with a stale `content_signature` returns `classification.stale`. (Ref: A8, R-Sig-1)
- [ ] T027a [P] [US3] Invariant test: assert that `InboxConfirmUseCase` enumerates plan item source paths from `InboxClassificationEvidence.relativeFilePath` rows, NOT from `InboxItem.fileCount`. A test that deletes evidence rows and asserts the plan item count follows evidence, not fileCount. (Ref: A9)

### Implementation for User Story 3

- [ ] T027 [US3] Implement `InboxConfirmUseCase` (split branch) in `crates/app/core/src/inbox/confirm.rs`. Verifies `content_signature` match; enumerates files from evidence rows; resolves the active Naming & Structure pattern via `crates/patterns/`; validates all required tokens resolve for every file; atomically creates a Plan + PlanItems via `crates/fs/planner` with Inventory destination paths; records `destructive_destination` on the plan. (Ref: R-Split-1, A8, A9, R-DestChoice)
- [ ] T028 [US3] Implement `InboxConfirmUseCase` (confirm branch) for single-type items: same machinery, one logical group.
- [ ] T029 [US3] Group key on PlanItems: include `frame_type` in plan-item metadata so the planner stays frame-type-agnostic while the UI can group by it.
- [ ] T030 [US3] Subscribe to the plans event bus: on `plan.applying.completed` (applied), update `InboxItem.state` to `resolved`; on `plan.discarded`, delete the `inbox_plan_links` row and transition to `classified`. Implement in `crates/app/core/src/inbox/plan_listener.rs`. (Ref: E4)
- [ ] T-PlanRepair [US3] Implement background repair query in `crates/app/core/src/inbox/repair.rs`: every 5 minutes, scan inbox items where `state = plan_open` AND the linked plan is in a terminal state (`applied | partially_applied | failed | cancelled | discarded`); transition the inbox item to the appropriate post-plan state. This is the self-healing safety net; the event bus (T030) is the primary update path. (Ref: R-PlanOpen)
- [ ] T031 [US3] Replace the mockup's `createPlanFromInbox` with a Tauri command calling `inbox.confirm`. **MOCKUP-REPLACED.**

**Checkpoint**: A mixed folder can be split into Inventory via the real plan pipeline. Content-signature TOCTOU guard active. File list sourced from evidence rows.

---

## Phase 6: User Story 4 - Dedupe Open Plan For Same Inbox Item (Priority: P4)

**Goal**: A second attempt to confirm/split an Inbox item with an open plan returns `inbox.has.open.plan { existing_plan_id }` and the UI routes to that plan.

**Independent Test**: After generating a split plan, re-call `inbox.confirm`; assert the error code and `existing_plan_id`. In the UI, the CTA reads "Open existing plan".

**Mockup status**: `InboxPage.tsx` already filters `usePlans()` to dedupe CTAs. **The contract enforcement is new.**

### Tests for User Story 4

- [ ] T032 [P] [US4] Contract test: second `inbox.confirm` returns `inbox.has.open.plan` with `existing_plan_id` populated; asserts `paused` appears in `existing_plan_state` enum. (Ref: E1)
- [ ] T033 [P] [US4] Integration test for the partial unique index in `crates/persistence/db`: attempting to insert a second open `inbox_plan_links` row fails.
- [ ] T034 [P] [US4] UI test: with an open plan present, the CTA renders "Open existing plan" and clicking it navigates to the plan detail.

### Implementation for User Story 4

- [ ] T035 [US4] Enforce the invariant in `InboxConfirmUseCase` (pre-flight check on `inbox_plan_links` before plan creation). Treat the partial unique index as a defense-in-depth backstop.
- [ ] T036 [US4] On plan close (`applied`/`discarded`/`failed`/`cancelled`), confirm the listener from T030 releases the link so a new split is permitted.
- [ ] T037 [US4] Rewire the existing mockup dedupe logic in `apps/desktop/src/features/inbox/InboxPage.tsx` to consume the contract error rather than client-side `useMemo` filtering. **MOCKUP-REPLACED.**

**Checkpoint**: All four user stories functional. Invariant holds across UI, use case, and DB layers.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T-NormCorpus [P] Unit test fixture corpus: create FITS test files per capture software (NINA, SGP, APT, ASIAIR, Ekos/KStars) covering each FrameType variant. Assert each normalizes to the expected FrameType. (Ref: R-IMAGETYP-Norm, T0-IMAGETYP-Research)
- [ ] T039 [P] Add quickstart.md walking through the four user stories against the fixture corpus.
- [ ] T040 Performance bench: classify a 500-file folder; assert under 2 s on the reference workstation (SC adjacent to SC-004).
- [ ] T041 [P] Audit log: ensure classifier, confirm, reclassify, and plan-creation operations emit audit events through `crates/audit` per constitution principle II.
- [ ] T-VideoLaneDocs [P] Document `inbox.video.*` lane boundary: what is handled by `crates/metadata/video/`, what is out of scope for spec 005, and reference the future spec for planetary/lunar workflows. (Ref: R-Video-1)

---

## Dependencies & Execution Order

### Task Dependencies

```toml
[graph]

[graph.T0-IMAGETYP-Research]
blocked_by = []

[graph.T001]
blocked_by = []
[graph.T002]
blocked_by = []
[graph.T003]
blocked_by = []

[graph.T004]
blocked_by = ["T001", "T0-IMAGETYP-Research"]
[graph.T-NormTable]
blocked_by = ["T004", "T0-IMAGETYP-Research"]
[graph.T005]
blocked_by = ["T001", "T004"]
[graph.T006]
blocked_by = ["T001", "T004"]
[graph.T007]
blocked_by = ["T004"]
[graph.T-VideoDetect]
blocked_by = ["T001"]
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
[graph.T-RecursiveScan]
blocked_by = ["T-RecursiveScanImpl"]
[graph.T-RecursiveScanImpl]
blocked_by = ["T010", "T-VideoDetect"]
[graph.T-SigCompute]
blocked_by = ["T001"]
[graph.T014]
blocked_by = ["T010", "T005", "T006", "T-NormTable", "T-SigCompute"]
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
[graph.T-ReclassifyContract]
blocked_by = ["T009"]
[graph.T-ReclassifyImpl]
blocked_by = ["T010", "T008"]

[graph.T023]
blocked_by = ["T009"]
[graph.T024]
blocked_by = ["T027"]
[graph.T025]
blocked_by = ["T027"]
[graph.T026]
blocked_by = ["T027"]
[graph.T-StaleSig]
blocked_by = ["T027"]
[graph.T027a]
blocked_by = ["T027"]
[graph.T027]
blocked_by = ["T014", "T016", "T020", "T-SigCompute"]
[graph.T028]
blocked_by = ["T027"]
[graph.T029]
blocked_by = ["T027"]
[graph.T030]
blocked_by = ["T027", "T008"]
[graph.T-PlanRepair]
blocked_by = ["T030", "T008"]
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

[graph.T-NormCorpus]
blocked_by = ["T012", "T0-IMAGETYP-Research"]
[graph.T039]
blocked_by = ["T031", "T037"]
[graph.T040]
blocked_by = ["T014"]
[graph.T041]
blocked_by = ["T027"]
[graph.T-VideoLaneDocs]
blocked_by = ["T-RecursiveScanImpl"]
```

### Phase Dependencies

- **Phase 0 (IMAGETYP Research)**: independent; blocks T004 and T-NormTable
- **Setup (Phase 1)**: independent; blocks all
- **Foundational (Phase 2)**: depends on Setup; blocks all user stories
- **US1 (Phase 3)**: depends on Foundational; MVP
- **US2 (Phase 4)**: depends on US1 (consumes its breakdown shape)
- **US3 (Phase 5)**: depends on US1; independent of US2 in principle, but UI rewire (T031) benefits from T021
- **US4 (Phase 6)**: depends on US3 (needs a real plan to dedupe)
- **Polish (Phase 7)**: depends on the user stories it touches

### Parallel Opportunities

- T002, T003, T0-IMAGETYP-Research can run alongside T001.
- T005, T006, T-VideoDetect are different crates and run in parallel after T004.
- All `[P]` test tasks within a user story can run in parallel before their implementation tasks (TDD-friendly).

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 0 (IMAGETYP Research — can overlap with Phase 1).
2. Phases 1–2 (Setup + Foundational).
3. Phase 3 (US1): classify works end-to-end against fixtures using IMAGETYP only.
4. **STOP**: validate the normalization table against the fixture corpus before
   layering UI polish or plan generation on top. This is the single highest-value
   gate in the feature.

### Incremental Delivery

US1 → US2 → US3 → US4. Each story tightens the loop; US4 is the
safety-net invariant and should not be skipped.

---

## Notes

- The desktop mockup is intentionally retained during US1–US2 to keep the
  UI testable while the Rust core is built. From US3 onward the mockup's
  fake plan creation is replaced; do not extend the mockup further.
- There are no `[NEEDS DECISION]` items remaining in spec.md; all domain
  questions have been resolved (2026-05-22).
- Hashing of image files is explicitly avoided in this feature per
  constitution; `content_signature` uses 64 KB partial read + stat. (Ref: R-Sig-1)
- User-extended IMAGETYP normalization mappings are deferred to v1.x (spec 018
  follow-up). (Ref: R-IMAGETYP-Norm)
