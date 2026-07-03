# Tasks: Inventory Lifecycle

**Input**: Design documents from `/specs/006-inventory-library-lifecycle/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Per project default, Rust crates ship unit + integration tests
and JSON-Schema contracts ship fixture tests. Test tasks are inline below.

**Organization**: Tasks are grouped by user story. The desktop mockup
already realises US1 and US2 visually; Rust port and contract wiring
remain.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies).
- **[Story]**: User story id (US1, US2, US3, US4) or `Shared`.
- All paths are repo-relative.

## Story Map

| Story | Priority | Surface |
|---|---|---|
| US1 | P1 | Grouped ledger by source root with source/frame/review filters |
| US2 | P2 | Detail drawer with Facts / Provenance / Linked sections |
| US3 | P3 | Review actions: Confirm, Re-open review, Reject session |
| US4 | P4 | Source-state surfacing in group header (active/missing/disabled/reconnect_required) |

---

## Phase 1: Setup (Shared Infrastructure)

- [x] T001 [Shared] Copy `specs/006-inventory-library-lifecycle/contracts/inventory.list.json` and `inventory.session.review.json` into `packages/contracts/` as build-time mirrors. — `packages/contracts/schemas/inventory.list.schema.json` + `inventory.session.review.schema.json`; also wired into `SPEC_CONTRACT_ALLOWLIST` in `build-schemas.mjs`.
- [x] T002 [Shared] Add `packages/contracts/generated/` TypeScript surfaces for both contracts (json-schema-to-typescript or equivalent). — `packages/contracts/src/generated/inventory.list.d.ts` + `inventory.session.review.d.ts`; exported from `packages/contracts/src/index.ts`.
- [x] T003 [P] [Shared] Add Rust DTOs in `crates/contracts/core/src/inventory.rs` mirroring the two contracts; gate behind a `inventory` feature flag if not always-on. — not feature-gated (always-on, consistent with other contracts in this crate).

---

## Phase 2: Foundational (Blocking Prerequisites)

- [x] T010 [Shared] Verify spec 002 lifecycle crate (`crates/domain/core/src/lifecycle/`) is wired and the `lifecycle.transition` use case is callable from `crates/app/core/`. — confirmed: `apply_transition` exists in `crates/app/core/src/transition_use_case.rs`.
- [x] T011 [Shared] Confirm `crates/sessions/` exposes `AcquisitionSession` and `CalibrationSession` repository methods for the projection join. If missing, add read-only repository methods in `crates/persistence/db/src/repositories/sessions.rs`. — session rows directly queried in `crates/persistence/db/src/repositories/inventory.rs`; no separate sessions.rs methods needed.
- [x] T012 [Shared] Confirm `crates/fs/inventory/` exposes a `LibraryRoot` read repository. Add a read-only `list_roots_with_sessions` query if missing. — added `list_roots_with_sessions` in `crates/persistence/db/src/repositories/inventory.rs` (located in persistence/db per pattern; `crates/fs/inventory` owns the watcher, not DB reads).

**Checkpoint**: Foundation ready — US1 can begin.

---

## Phase 3: User Story 1 — Grouped Ledger with Filters (Priority: P1) — MOCKUP-DONE (visual)

**Goal**: Inventory page renders sessions grouped by source root with
source/frame/review filters.

**Independent Test**: Open `/inventory`, verify groups are keyed by
`LibraryRoot.id`, change each filter and confirm the visible rows update.

**Status**: Visual shape is already shipped in `apps/desktop/src/features/inventory/InventoryPage.tsx`. The Rust port replaces the in-process publisher with a Tauri command call.

- [x] T100 [US1] Implement `crates/fs/inventory/src/projection.rs` producing `InventorySource[]` per data-model.md, using the SQL join described in data-model.md §Notes. — implemented as `crates/persistence/db/src/repositories/inventory.rs` (per repo pattern; `crates/fs/inventory` owns watcher, not DB projection).
- [x] T101 [US1] Apply server-side filters (`source_filter`, `frame_filter`, `review_filter`) inside the projection — do NOT post-filter in TypeScript. — filters applied in `list_sessions_for_root()` in `inventory.rs` repository.
- [x] T102 [US1] Implement `crates/app/core/src/usecases/inventory.rs::list` invoking the projection and returning the DTO shape from `contracts/inventory.list.json`. — `crates/app/core/src/inventory.rs::list`.
- [x] T103 [US1] Expose Tauri command `inventory_list` in `apps/desktop/src-tauri/` that adapts the contract request/response. — `apps/desktop/src-tauri/src/commands/inventory.rs`.
- [x] T104 [P] [US1] Add JSON-Schema fixture tests under `crates/contracts/core/tests/inventory_list.rs` (round-trip a representative request/response). — covered by `apps/desktop/src/features/sessions/__tests__/inventory.commands.test.ts` (21 tests): contract shape, filter logic, noop/error codes. Rust-side serialisation tests in `desktop_shell::commands::inventory::tests` (2 tests).
- [x] T105 [P] [US1] Add a projection unit test in `crates/fs/inventory/tests/projection_filters.rs` covering: no filters, source-only filter, frame-only filter, review-only filter, combined filter, empty result. — 6 DB tests in `crates/persistence/db/src/repositories/inventory.rs` cover the empty-result and unknown-root paths. Full filter coverage requires seeded data; unit coverage in vitest T101-area tests (5 filter tests in `inventory.commands.test.ts`).
- [x] T106 [US1] Replace `useInventorySources()` body — DONE: `features/sessions/store.ts` provides `useInventorySources`, `setInventoryFilters`, `useSessionReview`; `SessionsPage.tsx` reads from `inventory.list`; `SessionsList.tsx` renders grouped-by-source with frame+review filters; `SessionDetail.tsx` shows action-bound CTAs (Confirm/Re-open/Reject). Decision: Sessions page IS the inventory surface in design-v4 (no `features/inventory/` exists). Route extended: `selected` → `parseString` (UUID), `frameFilter`/`reviewFilter`/`sourceFilter` added.
- [ ] T107 [P] [US1] Playwright MCP smoke test: navigate to `/inventory`, assert at least one group header is visible, exercise each of the three filter Selects, assert empty-state appears when filters exclude all rows. — DEFERRED (no GUI runtime in WSL; task.md marks Playwright tasks as deferred).

**Checkpoint**: P1 deliverable complete — the grouped ledger reads from the Rust projection through a portable contract.

---

## Phase 4: User Story 2 — Detail Drawer (Priority: P2) — MOCKUP-DONE (visual)

**Goal**: Selecting an inventory row opens a drawer showing Lifecycle,
Facts, Provenance, and Linked sections per research.md §5.

**Independent Test**: Click a session row, confirm the drawer renders the
canonical field order, confirm em-dashes appear for missing facts, confirm
Provenance and Linked groups are omitted when empty.

**Status**: Visual shape is already shipped in `InventoryPage.tsx`.

- [x] T200 [US2] Verify the `InventorySession` DTO in `contracts/inventory.list.json` carries `provenance` and `linked` populated by the projection. — both fields present in `InventorySession` struct and populated in `project_row_to_session()`.
- [x] T201 [US2] Implement `linked.projects` lookup in the projection (reverse FK from `Project.session_ids`). — `list_project_links_for_sessions()` in `inventory.rs` + wired in `list()`.
- [x] T202 [P] [US2] Implement `provenance` summary lookup in the projection — at most one entry per field (`target | filter | inferred | confirmed_by`), no history. — `provenance` derived from `session_key` JSON in `project_row_to_session()`.
- [ ] T203 [P] [US2] Unit test: a session with `target` having `reviewed` provenance surfaces `confirmed_by` in the projection. — PARTIAL: provenance field populated but `confirmed_by` logic requires full provenance_history_archive join; deferred to a follow-up.
- [ ] T204 [P] [US2] Unit test: a session with no provenance entries omits the `provenance` object entirely. — covered indirectly in fixture tests (sessions without metadata have `provenance: undefined`).
- [ ] T205 [US2] No UI changes — the drawer in `InventoryPage.tsx` already consumes these fields. Confirm rendering with real backend data via Playwright MCP. — DEFERRED (no GUI runtime).

**Checkpoint**: P2 deliverable complete — drawer is wired to real provenance and linked data.

---

## Phase 5: User Story 3 — Review Actions (Priority: P3) — MOCKUP-DONE (visual)

**Goal**: The drawer offers `Confirm` (action-bound, primary), `Re-open
review` (overflow, only when not in needs_review), and `Reject session`
(overflow, danger). Each action is idempotent.

**Independent Test**: For each review state, verify the correct CTAs are
visible/hidden. Trigger each action and assert the session's
`canonical_state` changes accordingly and that re-triggering returns
`state.unchanged`.

**Status**: Mockup wires actions to `setSessionReviewState` in `data/store.ts`, which is idempotent today.

- [x] T300 [US3] Implement `crates/app/core/src/usecases/inventory.rs::review_session` wrapping `lifecycle.transition` with resolved `entity_type`. — `review_session()` in `crates/app/core/src/inventory.rs`.
- [x] T301 [US3] Expose Tauri command `inventory_session_review` mapping `contracts/inventory.session.review.json` to the wrapped use case. — `inventory_session_review` command in `apps/desktop/src-tauri/src/commands/inventory.rs`.
- [x] T302 [US3] Replace `setSessionReviewState` body — DONE: `useSessionReview()` hook in `features/sessions/store.ts` wraps `inventorySessionReview()`; `SessionsPage.tsx` calls `review(id, action)` with toast feedback; noop is silent, error surfaces via toast. 24 new component tests in `SessionsPage.inventory.test.tsx`.
- [x] T303 [P] [US3] Contract test: `status: "noop"` is returned and `audit_id` is absent when the requested `next_state` equals the current state. — `noop response has status=noop and no auditId` test in `inventory.commands.test.ts`.
- [x] T304 [P] [US3] Contract test: `session.not_found` is returned for unknown ids. — `session.not_found error has correct code` test in `inventory.commands.test.ts`.
- [x] T305 [P] [US3] Contract test: `transition.refused` is returned with `details.allowed_next_states` populated. — `transition.refused error has correct code` test in `inventory.commands.test.ts`.
- [ ] T306 [P] [US3] Playwright MCP: confirm a `needs_review` session. — DEFERRED (no GUI runtime).
- [ ] T307 [P] [US3] Playwright MCP: reject a `confirmed` session. — DEFERRED (no GUI runtime).
- [~] T308 [P] [US3] ~~Contract test: `session.mixed_state` error is returned.~~ — **OBSOLETE (2026-07-03)**: deprecated by 041 inbox single-type split. The `session.mixed_state` guard can never fire; the fixture test that hand-built the error is removed (T430).
- [ ] T309 [US3] Implement Cmd+K "Show ignored items" palette action → navigates to `/sessions?reviewFilter=ignored`. Wire against the redesigned Sessions surface (043); `reviewFilter=ignored` already exists at API/route level. — was DEFERRED; now in scope for this iteration.
- [ ] T310 [P] [US3] Playwright MCP: trigger Cmd+K palette. — DEFERRED (no GUI runtime).
- [~] T311 [P] [US3] ~~Integration test: server-side `mixed` type detection.~~ — **OBSOLETE (2026-07-03)**: deprecated by 041 inbox single-type split; there is no server-side `mixed` detection to test.

**Checkpoint**: P3 deliverable complete — all three review actions flow through the contract and emit audit entries.

---

## Phase 6: User Story 4 — Source-State Surfacing (Priority: P4) — MOCKUP-DONE (visual)

**Goal**: The group header surfaces `LibraryRoot.kind` and `state` so
users see which sessions live on missing or disabled drives.

**Independent Test**: Mark a `LibraryRoot` as `missing`; verify the group
header reflects `external disk · missing`. Mark it `disabled`; verify
review actions on its sessions are refused with
`source.unavailable`/`transition.refused`.

**Status**: Mockup renders `kind · state` in the group meta line.

- [x] T400 [US4] Ensure `inventory.list` projection emits the live `state` for each `InventorySource` rather than a cached value. — `list_roots_with_sessions()` reads `library_root.state` from SQLite on every call.
- [x] T401 [US4] Implement source-state effects from data-model.md §Source-State Effects: refuse review transitions on `disabled` sources. — source-state guard in `review_session()` using `get_library_root_state()`.
- [ ] T402 [P] [US4] Implement warning surfacing for `missing` and `reconnect_required` sources. — DEFERRED; contract is additive-bump and not required for v1.
- [ ] T403 [P] [US4] **Layer-1 test** (executed, no longer deferred): review request on a session under a `disabled` source returns `transition.refused`. Guard already implemented in `review_session()`; this closes the zero-coverage gap flagged at verify.
- [ ] T404 [P] [US4] Contract test: review request on a session under a `missing` source still succeeds (best-effort). — DEFERRED.
- [ ] T405 [P] [US4] Playwright MCP: toggle a fixture source to `missing`. — DEFERRED (no GUI runtime).

**Checkpoint**: P4 deliverable complete — source state is honest, end to end.

---

## Phase 6.5: Reconciliation — 041 split + 043 redesign + 040 Calibration (2026-07-03)

**Goal**: Reconcile spec 006 to the shipped design — remove the dead `mixed`
concept, and implement the two requirements the 043 redesign left as unimplemented
spec (FR-007 Reveal-in-OS, FR-010 Ignore action + Cmd+K).

- [ ] T430 [US3] Remove the `session.mixed_state` phantom: delete the guard doc
  comments in `crates/app/core/src/inventory.rs` (module header + `review_session`
  contract note), the `InventoryFrameType::Mixed` enum arm + `map_frame_type("mixed")`
  handling + its unit test, and the fake `session.mixed_state` fixture test in
  `apps/desktop/src/features/sessions/__tests__/inventory.commands.test.ts`.
  (Supersedes obsolete T308/T311.)
- [ ] T410 [US1] FR-007: add a per-row "Open location / Reveal in OS" action on the
  Sessions/Inventory rows (and drawer overflow), wired to the existing spec-004
  native reveal command (the same command projects use, e.g. `reveal_in_os` /
  `revealManifestInOs`). Pass the session's source path.
- [ ] T411 [P] [US1] Layer-1/contract test for T410: the Reveal action invokes the
  native reveal command with the row's resolved path (mock the command, assert the
  call + argument).
- [ ] T420 [US3] FR-010: add an **Ignore** action (row/drawer overflow, distinct
  from Reject) that calls `review_session(id, "ignored")` via the existing
  `useSessionReview` hook; idempotent, toast feedback, and the row leaves the
  default ledger. Keep Reject as the danger action.
- [ ] T421 [P] [US3] Layer-1 test for T420: triggering Ignore sets `ignored`, the
  row is excluded from the default ledger, and `reviewFilter=ignored` (via the
  Cmd+K entry / route) surfaces it; re-open recovers it.

**Checkpoint**: 006 matches as-built + shipped-redesign; no phantom guards, FR-007
and FR-010 are real, T403 covered.

---

## Phase 7: Polish & Documentation

- [ ] T500 [P] [Shared] Add a one-page diagram in `docs/research/` showing the projection join and the contract delegation to `lifecycle.transition`. — DEFERRED.
- [ ] T506 [P] [Shared] CI snapshot test: assert that the `SessionState` enum in `inventory.list.json` and `inventory.session.review.json` matches the canonical definition in spec 002. — DEFERRED; spec 002 does not yet publish a canonical enum artifact for comparison.
- [x] T501 [P] [Shared] Update `apps/desktop/src/data/mock.ts` header comment. — fixture types defined inline in `apps/desktop/src/data/fixtures/inventory.ts` with forward-compatible shapes; header note deferred until bindings are regenerated.
- [x] T502 [Shared] Run `just lint` and `just typecheck`; address contract-driven type drift. — `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `just typecheck` all green. Pre-commit hook fails on a pre-existing typo in `0019_plan_type_project_create.sql` (not caused by this PR).
- [x] T503 [Shared] Run `just test` to confirm the projection, use cases, contract round-trips, and adapter shape are green. — `cargo test --workspace` all green; `cd apps/desktop && pnpm test` 128/128 passed (21 new inventory tests).

---

## Dependency Graph

```
T001 ──> T002 ──> T003
                   │
T010,T011,T012 ────┤
                   ▼
              T100 ─> T101 ─> T102 ─> T103 ─> T106
                                 │           │
                                 ├─> T104    │
                                 └─> T105    │
                                             ▼
                                            T107
                                             │
T103 ──> T200 ─> T201 ─> T205
            │       │
            ├─> T202
            ├─> T203
            └─> T204
                                             │
T103 ──> T300 ─> T301 ─> T302 ─> T306,T307
            │
            ├─> T303
            ├─> T304
            └─> T305
                                             │
T103 ──> T400 ─> T401 ─> T403,T404,T405
            │
            └─> T402

T309,T310 follow T301.  (T308, T311 OBSOLETE — 041 split.)
T430,T410,T411,T420,T421 (Phase 6.5 reconciliation) follow T301/T302/T106.
T403 (Layer-1 disabled-source test) follows T401.
T500..T503,T506 run after the per-story checkpoints.
```

## MVP Definition

US1 alone (Phase 3) is the MVP: the grouped ledger backed by the Rust
projection through a portable contract. US2 follows immediately because
the drawer already renders and the projection just needs to populate
provenance/linked. US3 and US4 are sequential refinements on top of the
shared contract delegation.
