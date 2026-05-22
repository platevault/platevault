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

- [ ] T001 [Shared] Copy `specs/006-inventory-library-lifecycle/contracts/inventory.list.json` and `inventory.session.review.json` into `packages/contracts/` as build-time mirrors.
- [ ] T002 [Shared] Add `packages/contracts/generated/` TypeScript surfaces for both contracts (json-schema-to-typescript or equivalent).
- [ ] T003 [P] [Shared] Add Rust DTOs in `crates/contracts/core/src/inventory.rs` mirroring the two contracts; gate behind a `inventory` feature flag if not always-on.

---

## Phase 2: Foundational (Blocking Prerequisites)

- [ ] T010 [Shared] Verify spec 002 lifecycle crate (`crates/domain/core/src/lifecycle/`) is wired and the `lifecycle.transition` use case is callable from `crates/app/core/`. If not, block on spec 002 finishing first.
- [ ] T011 [Shared] Confirm `crates/sessions/` exposes `AcquisitionSession` and `CalibrationSession` repository methods for the projection join. If missing, add read-only repository methods in `crates/persistence/db/src/repositories/sessions.rs`.
- [ ] T012 [Shared] Confirm `crates/fs/inventory/` exposes a `LibraryRoot` read repository. Add a read-only `list_roots_with_sessions` query if missing.

**Checkpoint**: Foundation ready — US1 can begin.

---

## Phase 3: User Story 1 — Grouped Ledger with Filters (Priority: P1) — MOCKUP-DONE (visual)

**Goal**: Inventory page renders sessions grouped by source root with
source/frame/review filters.

**Independent Test**: Open `/inventory`, verify groups are keyed by
`LibraryRoot.id`, change each filter and confirm the visible rows update.

**Status**: Visual shape is already shipped in `apps/desktop/src/features/inventory/InventoryPage.tsx`. The Rust port replaces the in-process publisher with a Tauri command call.

- [ ] T100 [US1] Implement `crates/fs/inventory/src/projection.rs` producing `InventorySource[]` per data-model.md, using the SQL join described in data-model.md §Notes.
- [ ] T101 [US1] Apply server-side filters (`source_filter`, `frame_filter`, `review_filter`) inside the projection — do NOT post-filter in TypeScript.
- [ ] T102 [US1] Implement `crates/app/core/src/usecases/inventory.rs::list` invoking the projection and returning the DTO shape from `contracts/inventory.list.json`.
- [ ] T103 [US1] Expose Tauri command `inventory_list` in `apps/desktop/src-tauri/` that adapts the contract request/response.
- [ ] T104 [P] [US1] Add JSON-Schema fixture tests under `crates/contracts/core/tests/inventory_list.rs` (round-trip a representative request/response).
- [ ] T105 [P] [US1] Add a projection unit test in `crates/fs/inventory/tests/projection_filters.rs` covering: no filters, source-only filter, frame-only filter, review-only filter, combined filter, empty result.
- [ ] T106 [US1] Replace `useInventorySources()` body in `apps/desktop/src/data/store.ts` with a Tauri call to `inventory_list`. Preserve the hook signature so `InventoryPage.tsx` is untouched. **Already done in mockup**: keep `mock.ts` types as the response shape source until generated TS types land.
- [ ] T107 [P] [US1] Playwright MCP smoke test: navigate to `/inventory`, assert at least one group header is visible, exercise each of the three filter Selects, assert empty-state appears when filters exclude all rows.

**Checkpoint**: P1 deliverable complete — the grouped ledger reads from the Rust projection through a portable contract.

---

## Phase 4: User Story 2 — Detail Drawer (Priority: P2) — MOCKUP-DONE (visual)

**Goal**: Selecting an inventory row opens a drawer showing Lifecycle,
Facts, Provenance, and Linked sections per research.md §5.

**Independent Test**: Click a session row, confirm the drawer renders the
canonical field order, confirm em-dashes appear for missing facts, confirm
Provenance and Linked groups are omitted when empty.

**Status**: Visual shape is already shipped in `InventoryPage.tsx`.

- [ ] T200 [US2] Verify the `InventorySession` DTO in `contracts/inventory.list.json` carries `provenance` and `linked` populated by the projection.
- [ ] T201 [US2] Implement `linked.projects` lookup in the projection (reverse FK from `Project.session_ids`).
- [ ] T202 [P] [US2] Implement `provenance` summary lookup in the projection — at most one entry per field (`target | filter | inferred | confirmed_by`), no history.
- [ ] T203 [P] [US2] Unit test: a session with `target` having `reviewed` provenance surfaces `confirmed_by` in the projection.
- [ ] T204 [P] [US2] Unit test: a session with no provenance entries omits the `provenance` object entirely.
- [ ] T205 [US2] No UI changes — the drawer in `InventoryPage.tsx` already consumes these fields. Confirm rendering with real backend data via Playwright MCP.

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

- [ ] T300 [US3] Implement `crates/app/core/src/usecases/inventory.rs::review_session` wrapping `lifecycle.transition` with resolved `entity_type`.
- [ ] T301 [US3] Expose Tauri command `inventory_session_review` mapping `contracts/inventory.session.review.json` to the wrapped use case.
- [ ] T302 [US3] Replace `setSessionReviewState` body in `apps/desktop/src/data/store.ts` with a Tauri call. The hook accepts canonical 6-value states (`discovered | candidate | needs_review | confirmed | rejected | ignored`). UI layer maps display labels locally: `discovered` and `candidate` display as "Needs review". Preserve the function signature and the idempotency guarantee (re-applying current state returns `status: "noop"` — UI layer does not re-render on noop).
- [ ] T303 [P] [US3] Contract test: `status: "noop"` is returned and `audit_id` is absent when the requested `next_state` equals the current state, per spec 002 idempotency rules (A2 — `state.unchanged` error code is NOT used).
- [ ] T304 [P] [US3] Contract test: `session.not_found` is returned for unknown ids.
- [ ] T305 [P] [US3] Contract test: `transition.refused` is returned with `details.allowed_next_states` populated for a state that the spec-002 graph forbids.
- [ ] T306 [P] [US3] Playwright MCP: confirm a `needs_review` session, verify the `Confirm` button disappears and `Re-open review` appears in the overflow.
- [ ] T307 [P] [US3] Playwright MCP: reject a `confirmed` session, verify the danger-toned menu item is reachable and the row state updates to `rejected`.
- [ ] T308 [P] [US3] Contract test: `session.mixed_state` error is returned when attempting to review a session whose `type == "mixed"`. User must split via spec 005 reclassify first.
- [ ] T309 [US3] Implement Cmd+K "Show ignored items" palette action. The action navigates to `/inventory?reviewFilter=ignored` per spec 020 router conventions. Only visible when `ignored` sessions exist in the library (FR-010).
- [ ] T310 [P] [US3] Playwright MCP: trigger Cmd+K palette, invoke "Show ignored items", assert the URL updates to `/inventory?reviewFilter=ignored` and any ignored sessions appear in the ledger.
- [ ] T311 [P] [US3] Integration test (not JSON Schema fixture): verify the server-side `mixed` type detection (D2) — seed a session with heterogeneous member frames post-promotion, call `inventory.list`, assert `type == "mixed"` is returned and no `mixed` value is stored in the underlying session row.

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

- [ ] T400 [US4] Ensure `inventory.list` projection emits the live `state` for each `InventorySource` rather than a cached value.
- [ ] T401 [US4] Implement source-state effects from data-model.md §Source-State Effects in `inventory.session.review`: refuse review transitions on `disabled` sources with `transition.refused` + `{reason: "source_disabled"}`.
- [ ] T402 [P] [US4] Implement warning surfacing for `missing` and `reconnect_required` sources at the projection level — add a future `warnings: string[]` field to `InventorySource` (contract additive bump if needed; not required for v1).
- [ ] T403 [P] [US4] Contract test: review request on a session under a `disabled` source returns `transition.refused`.
- [ ] T404 [P] [US4] Contract test: review request on a session under a `missing` source still succeeds (best-effort) per data-model.md.
- [ ] T405 [P] [US4] Playwright MCP: toggle a fixture source to `missing` in a test database, reload `/inventory`, assert the group meta line reflects the new state without a page-wide error banner.

**Checkpoint**: P4 deliverable complete — source state is honest, end to end.

---

## Phase 7: Polish & Documentation

- [ ] T500 [P] [Shared] Add a one-page diagram in `docs/research/` showing the projection join and the contract delegation to `lifecycle.transition`.
- [ ] T506 [P] [Shared] CI snapshot test: assert that the `SessionState` enum in `inventory.list.json` and `inventory.session.review.json` matches the canonical definition in spec 002 when spec 002 adds it — fails build on drift (D6). Wire as a JSON-diff step in the contracts validation harness.
- [ ] T501 [P] [Shared] Update `apps/desktop/src/data/mock.ts` header comment to clarify that `InventorySession` and `InventorySource` are now generated-type aliases backed by `packages/contracts/generated/`.
- [ ] T502 [Shared] Run `just lint` and `just typecheck`; address contract-driven type drift.
- [ ] T503 [Shared] Run `just test` to confirm the projection, use cases, contract round-trips, and adapter shape are green.

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

T308,T309,T310,T311 follow T301.
T500..T503,T506 run after the per-story checkpoints.
```

## MVP Definition

US1 alone (Phase 3) is the MVP: the grouped ledger backed by the Rust
projection through a portable contract. US2 follows immediately because
the drawer already renders and the projection just needs to populate
provenance/linked. US3 and US4 are sequential refinements on top of the
shared contract delegation.
