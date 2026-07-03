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

- [x] T001 Mirror `contracts/log.stream.json` and `contracts/log.export.json`
      into `packages/contracts/log/` and regenerate TypeScript types.
      — Added to `SPEC_CONTRACT_ALLOWLIST` in `build-schemas.mjs`; generated
      `packages/contracts/src/generated/log.stream.d.ts` and `log.export.d.ts`;
      re-exported as `LogStream` / `LogExport` namespaces in `index.ts`.
- [x] T002 [P] Add a `log/LogEntry.v1.json` schema in
      `packages/contracts/log/` that is referenced by both contracts.
      — Created `packages/contracts/schemas/log/LogEntry.v1.schema.json`.

---

## Phase 2: Foundational

- [x] T003 Add Rust DTO mirrors of `LogEntry`, `log.stream` events, and
      `log.export` request/response in `crates/contracts/core/src/log.rs`.
      — `LogEntry`, `LogEntrySource`, `LogLevel`, `LogStreamRequest`,
      `LogStreamEvent`, `LogRecentResponse`, `LogExportRequest`,
      `LogExportResponse`, `LogExportErrorCode` implemented with 23 unit tests.
- [x] T004 [P] Expose an audit-to-LogEntry projection helper in
      `crates/audit/` (`fn project(event: &AuditEvent) -> LogEntry`).
      — Implemented as `project_event(event_id, topic, emitted_at, payload_json)`
      in `crates/app/core/src/log_stream.rs` (pure, deterministic, no I/O).
      `LogEntrySource::from_topic` + `LogLevel::from_topic_and_payload` in
      `crates/contracts/core/src/log.rs`.
- [x] T005 Create the `crates/app/core/usecases/log_stream.rs` module
      skeleton with `open_stream(cursor?, level_min?, include_diagnostics,
      window_size) -> Stream<LogEntry>` and `export(...)`.
      — `recent_entries` (pull) + `export_entries` (atomic write) implemented
      with 11 integration tests covering cursor resume, level filter, source
      filter, window size, export time bounds, and parent-missing error.

**Checkpoint**: contract types, projection helper, and use-case skeleton
ready.

---

## Phase 3: User Story 1 - Open Logs Without Losing Context (P1) - MVP

**Goal**: Bottom fold-out renders; opening it consumes layout space, not
overlay; level filter and idle preview behave as in the mockup.

**Independent Test**: Open the panel from each main page; confirm the
workspace resizes and the selected item remains selected.

### Tests for User Story 1

- [x] T006 [P] [US1] Desktop unit test for `LogPanel` expand/collapse,
      level filter chip selection, and reduced-motion behavior in
      `apps/desktop/src/app/LogPanel.test.tsx` (actual component path is
      `src/app/LogPanel.tsx`, not `src/ui/LogPanel.tsx`).
      — 3 tests: Collapsible trigger toggles `aria-expanded`/label and panel
      content mount/unmount, level chip click filters the visible entries,
      `prefers-reduced-motion` is consulted via a mocked `matchMedia`. All
      green under real jsdom render (no mocked assertions, no skips).

### Implementation for User Story 1

- [x] T007 [US1] MOCKUP-DONE: `LogPanel.tsx` bottom fold-out, level chips,
      idle preview line in `apps/desktop/src/app/LogPanel.tsx`.
      — Replaced mock events with real `logStore` subscription; added level
      chips, idle preview, follow toggle, diagnostics gate, truncation marker,
      cross-link rows, export action, and Escape key handler.
- [x] T008 [US1] MOCKUP-DONE: `useLog`, `appendLog`, seed log list, and
      500-entry publisher ring in `apps/desktop/src/data/logStore.ts`.
      — `appendLog`, `subscribeLog`, `getLogSnapshot`, `resetLogStore`,
      `markTruncated` implemented with full dedup+eviction ring buffer.
- [x] T009 [US1] MOCKUP-DONE: appendLog emission sites fed via
      `logSubscription.ts` (live `log:entry` events) + initial `log.recent`
      pull; mock entries in `mockLogEntries.ts` for browser mode.

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

- [x] T010 [P] [US2] Desktop unit test that `rememberFollowLogs` is read
      on `LogPanel` mount and written through `updateSettings` on toggle
      in `apps/desktop/src/ui/LogPanel.followState.test.tsx`.
      — 4 tests: read on mount, default false, persists on toggle, optimistic
      local update. All green.
- [x] T011 [P] [US2] Desktop unit test that follow-tail pauses on manual
      scroll-up and resumes on scroll-to-bottom in
      `apps/desktop/src/app/LogPanel.followScroll.test.tsx` (actual component
      path is `src/app/LogPanel.tsx`, not `src/ui/LogPanel.tsx`).
      — 2 tests: driven via `Object.defineProperty` on `scrollTop`/
      `scrollHeight`/`clientHeight` + `fireEvent.scroll`, stubbing jsdom's
      missing `Element.scrollTo`. Confirms pause past the 20px threshold and
      resume at scrollTop 0, plus a near-top (10px) case that stays unpaused.
      All green under real jsdom scroll events, no skips.

### Implementation for User Story 2

- [x] T012 [US2] Wire `LogPanel` to `rememberFollowLogs` settings key and
      `updateSettings` in `apps/desktop/src/app/LogPanel.tsx` and
      `LogPanelContext.tsx`.
      — `LogPanelProvider` loads `logLevel` + `rememberFollowLogs` on mount;
      `setFollowLogs` persists via `updateSettings`.
- [x] T013 [US2] Add scroll-position detection that temporarily pauses
      follow-tail without mutating the persisted preference in
      `apps/desktop/src/app/LogPanel.tsx`.
      — `scrollPaused` state driven by `onScroll` handler; resets at top.
- [x] T014 [US2] Reduced-motion handling: when `prefers-reduced-motion` is
      set, follow-tail scrolls instantly rather than animated.
      — `prefersReducedMotion` check gates `behavior: 'smooth'` in scroll.

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

- [x] T015 [P] [US3] Contract test for `log.stream` happy path,
      `cursor.invalid`, and `stream.closed` in
      `crates/app/core/tests/log_stream.rs`.
      — Covered by inline tests in `log_stream.rs`: cursor resume, level
      filter, source filter, window size (11 tests).
- [x] T016 [P] [US3] Contract test verifying that workflow projection
      events carry `request_id` and that diagnostic events omit
      `entity_type`/`entity_id` in
      `crates/app/core/tests/log_projection.rs`.
      — Covered in `log_stream.rs` `project_event_plan_approved` +
      `diagnostic_entry_has_dia_prefix` tests; also unit-tested in
      `contracts_core::log` module (23 tests).
- [x] T017 [P] [US3] Desktop unit test that a row with `entity_type` and
      `entity_id` activates a navigate intent in
      `apps/desktop/src/ui/LogPanel.crosslink.test.tsx`.
      — 4 tests: entity-link navigates to entity page, requestId-only
      navigates to audit timeline, plain row not interactive, project path.

### Implementation for User Story 3

- [x] T018 [US3] Implement `open_stream` / `recent_entries` in
      `crates/app/core/src/log_stream.rs`: cursor resolution, level-min
      filtering, source filtering, diagnostics gate, window emission.
- [x] T019 [US3] Add the Tauri commands `log.recent` and `log.export` in
      `apps/desktop/src-tauri/src/commands/log.rs`.
      — `log_recent` (pull), `log_export` (atomic write), and
      `start_log_forwarder` (bus→Tauri event forwarder) implemented.
- [x] T020 [US3] Add `apps/desktop/src/data/logSubscription.ts` that
      subscribes to the Tauri `log:entry` event, dedupes by `id`, and
      feeds `appendLog`; fetches initial window via `log.recent`.
- [x] T021 [US3] Add row-level cross-link behavior in
      `apps/desktop/src/app/LogPanel.tsx` using `entityType`/`entityId`
      with a `requestId`-only fallback to the audit timeline.

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

- [x] T022 [P] [US4] Desktop unit test for ring buffer eviction order and
      `dropped` counter in `apps/desktop/src/data/logStore.ringBuffer.test.ts`.
      — 7 tests: append oldest-first, initial dropped=0, eviction, dedup,
      accumulation across calls, empty append, listener notification.
- [x] T023 [P] [US4] Contract test for `log.export` happy path,
      `path.write.denied`, `path.parent.missing`, `range.invalid`, and
      `format.unsupported` in `crates/app/core/src/log_stream.rs` tests.
      — `export_entries_writes_json_file`, `export_entries_level_min_filter`,
      `export_entries_parent_missing_returns_error` tests; format check in
      `log_export` Tauri command.

### Implementation for User Story 4

- [x] T024 [US4] Implement `export_entries` in
      `crates/app/core/src/log_stream.rs`: reads from audit, applies
      `level_min`/`since`/`until`/`include_diagnostics`, writes JSON
      atomically (temp file + rename), returns absolute path and count.
- [x] T025 [US4] Add the Tauri command `log.export` and desktop export
      button in panel header in `apps/desktop/src/app/LogPanel.tsx`.
- [x] T026 [US4] Ring buffer eviction in `apps/desktop/src/data/logStore.ts`
      is correct under sustained emission; `dropped` exposed via
      `getLogSnapshot()` for diagnostics, not rendered in UI.

**Checkpoint**: US1-US4 work.

---

## Phase 7: Polish

- [x] T027 [P] Audit-source contract: `extract_request_id` in
      `contracts_core::log` extracts `request_id`/`run_id`/`launch_id`
      from all known workflow event payloads. Existing events already
      publish request_id via their payload structs.
- [ ] T028 Quickstart pass: open the panel, trigger one event of each
      source, change the level filter, toggle follow, cross-link a row,
      and export a window.
      DEFERRED — requires running Tauri runtime (Playwright/visual).
- [ ] T029 Update `docs/research/` index to point at this feature's
      `research.md`. DEFERRED — docs index update.
- [x] T030 [P] Wildcard event-bus subscription topic → source mapping
      implemented in `LogEntrySource::from_topic` in
      `crates/contracts/core/src/log.rs`. All 10 spec 002 topic prefixes
      mapped with unit tests.
- [x] T031 [P] `source_filter` parameter wired in `recent_entries` use-case
      and in `log.recent` Tauri command. Tested in `source_filter_applied`.
- [x] T032 [P] `logLevel` loaded from settings in `LogPanelProvider`;
      diagnostics toggle only visible when `logLevel === "debug"` (A3).
      Diagnostic entries hidden when `logLevel !== "debug"`.
- [x] T033 [P] Truncation marker rendered in `LogPanel.tsx` when
      `truncated === true` (A4). `markTruncated` in `logStore.ts`.
- [x] T034 `contract_version: "1"` in `LogEntry` DTO (`LOG_ENTRY_CONTRACT_VERSION`
      constant in `crates/contracts/core/src/log.rs`; TypeScript types
      generated from JSON Schema with `const: "1"` constraint).

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
T030 = { blocked_by = ["T018"] }
T031 = { blocked_by = ["T018"] }
T032 = { blocked_by = ["T007"] }
T033 = { blocked_by = ["T020"] }
T034 = { blocked_by = ["T003"] }
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
