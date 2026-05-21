# Tasks: Bottom Log Viewer

**Input**: Design documents from `/specs/019-bottom-log-viewer/`
**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`

**Tests**: Tests are required at the contract and use-case boundary because
the stream is consumed by a UI projection that drops history.

**Organization**: Grouped by user story so each story delivers
incrementally. `MOCKUP-DONE` tasks already exist in the desktop mockup;
reuse the existing code rather than rewriting it.

## Path Conventions

- Desktop: `apps/desktop/src/`
- Rust core (future): `crates/app/core/`, `crates/audit/`,
  `crates/contracts/core/`
- Contracts: `specs/019-bottom-log-viewer/contracts/` mirrored to
  `packages/contracts/log/`

---

## Phase 1: Setup

- [ ] T001 Mirror `contracts/log.stream.json` and `contracts/log.export.json`
      into `packages/contracts/log/` and regenerate TypeScript types.
- [ ] T002 [P] Add a `log/LogEntry.v1.json` schema in
      `packages/contracts/log/` that is referenced by both contracts.

---

## Phase 2: Foundational

- [ ] T003 Add Rust DTO mirrors of `LogEntry`, `log.stream` events, and
      `log.export` request/response in `crates/contracts/core/src/log.rs`.
- [ ] T004 [P] Expose an audit-to-LogEntry projection helper in
      `crates/audit/` (`fn project(event: &AuditEvent) -> LogEntry`).
- [ ] T005 Create the `crates/app/core/usecases/log_stream.rs` module
      skeleton with `open_stream(cursor?, level_min?, include_diagnostics,
      window_size) -> Stream<LogEntry>` and `export(...)`.

**Checkpoint**: contract types, projection helper, and use-case skeleton
ready.

---

## Phase 3: User Story 1 - Open Logs Without Losing Context (P1) - MVP

**Goal**: Bottom fold-out renders; opening it consumes layout space, not
overlay; level filter and idle preview behave as in the mockup.

**Independent Test**: Open the panel from each main page; confirm the
workspace resizes and the selected item remains selected.

### Tests for User Story 1

- [ ] T006 [P] [US1] Desktop unit test for `LogPanel` expand/collapse,
      level filter chip selection, and reduced-motion behavior in
      `apps/desktop/src/ui/LogPanel.test.tsx`.

### Implementation for User Story 1

- [ ] T007 [US1] MOCKUP-DONE: `LogPanel.tsx` bottom fold-out, level chips,
      idle preview line in `apps/desktop/src/ui/LogPanel.tsx`.
- [ ] T008 [US1] MOCKUP-DONE: `useLog`, `appendLog`, seed log list, and
      500-entry publisher ring in `apps/desktop/src/data/store.ts`.
- [ ] T009 [US1] MOCKUP-DONE: appendLog emission sites for plan create,
      apply progress, plan discard, lifecycle transitions, inventory
      review, and settings updates (non-noisy keys) in
      `apps/desktop/src/data/store.ts`.

**Checkpoint**: US1 fully functional in the mockup.

---

## Phase 4: User Story 2 - Filter Log Noise (P2)

**Goal**: Level filter and remembered follow-tail preference behave per
spec FR-003 through FR-006. The follow preference is wired through the
existing settings store.

**Independent Test**: Toggle follow-tail; reopen the panel; confirm the
state persists. Change the level filter; confirm the next panel open
resets to `all` (per research R7).

### Tests for User Story 2

- [ ] T010 [P] [US2] Desktop unit test that `rememberFollowLogs` is read
      on `LogPanel` mount and written through `updateSettings` on toggle
      in `apps/desktop/src/ui/LogPanel.followState.test.tsx`.
- [ ] T011 [P] [US2] Desktop unit test that follow-tail pauses on manual
      scroll-up and resumes on scroll-to-bottom in
      `apps/desktop/src/ui/LogPanel.followScroll.test.tsx`.

### Implementation for User Story 2

- [ ] T012 [US2] Wire `LogPanel` to `useSettings("rememberFollowLogs")` and
      `updateSettings` in `apps/desktop/src/ui/LogPanel.tsx`.
- [ ] T013 [US2] Add scroll-position detection that temporarily pauses
      follow-tail without mutating the persisted preference in
      `apps/desktop/src/ui/LogPanel.tsx`.
- [ ] T014 [US2] Reduced-motion handling: when `prefers-reduced-motion` is
      set, follow-tail scrolls instantly rather than animated.

**Checkpoint**: US1 + US2 work.

---

## Phase 5: User Story 3 - Cross-Link to Entities (P3)

**Goal**: A log entry that carries `entity_type` and `entity_id`
navigates to the entity page; an entry with only `request_id` opens the
audit timeline filtered to that request id.

**Independent Test**: Trigger a plan-apply error; activate the log row;
confirm the plan detail page opens with the matching `request_id` shown
in the audit panel.

### Tests for User Story 3

- [ ] T015 [P] [US3] Contract test for `log.stream` happy path,
      `cursor.invalid`, and `stream.closed` in
      `crates/app/core/tests/log_stream.rs`.
- [ ] T016 [P] [US3] Contract test verifying that workflow projection
      events carry `request_id` and that diagnostic events omit
      `entity_type`/`entity_id` in
      `crates/app/core/tests/log_projection.rs`.
- [ ] T017 [P] [US3] Desktop unit test that a row with `entity_type` and
      `entity_id` activates a navigate intent in
      `apps/desktop/src/ui/LogPanel.crosslink.test.tsx`.

### Implementation for User Story 3

- [ ] T018 [US3] Implement `open_stream` in
      `crates/app/core/usecases/log_stream.rs`: cursor resolution,
      `cursor.invalid` recovery, level-min filtering, diagnostics
      inclusion, initial window emission.
- [ ] T019 [US3] Add the Tauri command `log_stream` that exposes the use
      case as an event channel in `apps/desktop/src-tauri/`.
- [ ] T020 [US3] Add `apps/desktop/src/data/logSubscription.ts` that
      subscribes to the Tauri channel, dedupes by `id`, and feeds
      `appendLog`; replace the seed log path on first successful
      subscription.
- [ ] T021 [US3] Add row-level cross-link behavior in
      `apps/desktop/src/ui/LogPanel.tsx` using `entity_type`/`entity_id`
      with a `request_id`-only fallback to the audit timeline.

**Checkpoint**: US1-US3 work. The stream is backend-driven and rows
cross-link.

---

## Phase 6: User Story 4 - Bounded Retention and Export (P4)

**Goal**: The UI ring buffer is bounded at 500 with oldest-first
eviction; export writes a JSON file at a user-chosen path and reports
count.

**Independent Test**: Emit 1000 entries; confirm the visible list is
500 and the oldest are dropped. Run export with `level_min = "warn"`
and a time range; confirm the response `count` matches the file rows.

### Tests for User Story 4

- [ ] T022 [P] [US4] Desktop unit test for ring buffer eviction order and
      `dropped` counter in `apps/desktop/src/data/store.ringBuffer.test.ts`.
- [ ] T023 [P] [US4] Contract test for `log.export` happy path,
      `path.write.denied`, `path.parent.missing`, `range.invalid`, and
      `format.unsupported` in
      `crates/app/core/tests/log_export.rs`.

### Implementation for User Story 4

- [ ] T024 [US4] Implement `export` in
      `crates/app/core/usecases/log_stream.rs`: reads from audit, applies
      `level_min`/`since`/`until`/`include_diagnostics`, writes JSON
      atomically (temp file + rename), returns absolute path and count.
- [ ] T025 [US4] Add the Tauri command `log_export` and a desktop action
      surface (panel header menu) in
      `apps/desktop/src/ui/LogPanel.tsx`.
- [ ] T026 [US4] Confirm ring buffer eviction in
      `apps/desktop/src/data/store.ts` is correct under sustained
      emission; expose `dropped` count to diagnostics but not to render.

**Checkpoint**: US1-US4 work.

---

## Phase 7: Polish

- [ ] T027 [P] Audit-source contract: ensure all workflow audit events
      include `request_id` so the projection always populates it.
- [ ] T028 Quickstart pass: open the panel, trigger one event of each
      source, change the level filter, toggle follow, cross-link a row,
      and export a window.
- [ ] T029 Update `docs/research/` index to point at this feature's
      `research.md`.

---

## Dependencies & Execution Order

### Task Dependencies

```toml
[graph]
T001 = { blocked_by = [] }
T002 = { blocked_by = [] }
T003 = { blocked_by = ["T001", "T002"] }
T004 = { blocked_by = [] }
T005 = { blocked_by = ["T003", "T004"] }
T006 = { blocked_by = [] }
T007 = { blocked_by = [] }
T008 = { blocked_by = [] }
T009 = { blocked_by = [] }
T010 = { blocked_by = ["T007", "T008"] }
T011 = { blocked_by = ["T007"] }
T012 = { blocked_by = ["T007", "T010"] }
T013 = { blocked_by = ["T011"] }
T014 = { blocked_by = ["T013"] }
T015 = { blocked_by = ["T005"] }
T016 = { blocked_by = ["T005"] }
T017 = { blocked_by = ["T007"] }
T018 = { blocked_by = ["T005", "T015", "T016"] }
T019 = { blocked_by = ["T018"] }
T020 = { blocked_by = ["T019", "T008"] }
T021 = { blocked_by = ["T020", "T017"] }
T022 = { blocked_by = ["T008"] }
T023 = { blocked_by = ["T005"] }
T024 = { blocked_by = ["T023", "T018"] }
T025 = { blocked_by = ["T024"] }
T026 = { blocked_by = ["T022"] }
T027 = { blocked_by = ["T018"] }
T028 = { blocked_by = ["T012", "T021", "T025", "T026"] }
T029 = { blocked_by = [] }
```

### Phase Dependencies

- **Setup (Phase 1)** starts immediately.
- **Foundational (Phase 2)** depends on Setup and blocks the backend
  parts of US3+.
- **US1 (Phase 3)** is largely `MOCKUP-DONE`; the test (T006) lands first.
- **US2 (Phase 4)** wires the existing settings key into the panel.
- **US3 (Phase 5)** replaces the seed log with the backend stream.
- **US4 (Phase 6)** adds retention guarantees and export.
- **Polish (Phase 7)** depends on US3+US4.

### Parallel Opportunities

- T001 / T002 in Setup.
- T003 / T004 in Foundational.
- T015 / T016 / T017 in US3 tests.
- T022 / T023 in US4 tests.

---

## Implementation Strategy

### MVP First

1. Phases 1-2.
2. Phase 3 (US1) — already done on the desktop; add T006.
3. Phase 4 (US2) — wire follow state through settings.

### Incremental Delivery

1. MVP (US1+US2).
2. US3 (backend stream + cross-link).
3. US4 (retention + export).
4. Polish.

---

## Notes

- [P] = different files, no dependencies.
- [Story] = traceability to spec.md user story.
- MOCKUP-DONE = code already exists in the desktop mockup; reuse, do not
  rewrite.
- Avoid: persisting the level filter without a research decision;
  raising `LOG_BUFFER_SIZE` without a research decision; introducing a
  second viewer in parallel with the audit timeline.
