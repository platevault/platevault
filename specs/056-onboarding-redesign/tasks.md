# Tasks: Onboarding Redesign — Three-Layer Onboarding

**Input**: Design documents from `/specs/056-onboarding-redesign/`
**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/onboarding-commands.md](contracts/onboarding-commands.md), [quickstart.md](quickstart.md)

**Tests**: Included — the spec's Validation Contract (VC-001…VC-005) and the
repo's real-stack coverage rule mandate them.

**Organization**: Phases 1–2 build shared foundations and clear the legacy
ground; Phases 3–7 map 1:1 to spec user stories US1–US5; Phase 8 is
polish + cross-feature validation.

## Phase 1: Setup (persistence + contracts + core)

- [ ] T001 Create migration `crates/persistence/db/migrations/0069_onboarding.sql`: `onboarding_state` (item_id PK, state CHECK unchecked|auto_checked|manually_checked|dismissed, at, source CHECK seed|event|user), `onboarding_flags` singleton (orientation_done_at, section_removed_at, sidebar_collapsed), `DROP TABLE IF EXISTS guided_flow_state`; leave `0030_guided_flow.sql` untouched; renumber if 0069 is claimed by a parallel merge (research R6)
- [ ] T002 [P] Add onboarding DTOs in `crates/contracts/core/src/onboarding.rs` per `contracts/onboarding-commands.md` (state.get / item.set_state / orientation.complete / section.set / restore + notification payload) and register `pub mod onboarding` in `crates/contracts/core/src/lib.rs`
- [ ] T003 Add repository boundary `crates/persistence/db/src/repositories/onboarding.rs`: read projection, idempotent tick write (settled states never downgraded), flags upsert, seed/restore write path; unit tests against real migrations (touch `crates/persistence/db/src/lib.rs` for sqlx re-embed)
- [ ] T004 Add `crates/app/core/src/onboarding.rs`: item registry (item_id, page, completion_topic per research R4 verified table, payload_filter `tool.launch → outcome=="spawned"`, prerequisite, seed_query, anchor) + use cases (get_state, set_item_state, orientation_complete, section_set, restore) with the SINGLE seed/restore derivation reading real tables (FR-014 — re-derives AUTOMATIC items only; manually_checked/dismissed rows preserved) and the shared settle path that sets `section_hidden_at` when the last open item settles across all groups (FR-031 auto-hide); registry unit tests assert only verified topics appear

## Phase 2: Foundational (subscriber, commands, adapter, deletion lane)

- [ ] T005 Implement bus tick subscriber in `apps/desktop/src-tauri/src/commands/onboarding.rs` (`start_onboarding_subscriber`, pattern of the removed `start_guided_event_forwarder` but WRITING): topic→item mapping from the T004 registry, payload filters, server-side skip of envelope `source == "restore"` (FR-016), persist via T003, then emit `onboarding:state-changed`
- [ ] T006 Implement `onboarding_state_get` / `onboarding_item_set_state` / `onboarding_orientation_complete` / `onboarding_section_set` / `onboarding_restore` commands in `apps/desktop/src-tauri/src/commands/onboarding.rs`; register in `specta_builder()` AND the invoke handler in `apps/desktop/src-tauri/src/lib.rs` (same fn names — never rename invoke targets); wire subscriber start into app setup BEFORE the webview can invoke use cases (PQ-005 ordering obligation)
- [ ] T007 Regenerate TS bindings; add mock-mode entries for the five commands in `apps/desktop/src/api/mocks.ts` (static state; event path is a documented no-op — VC-002 limit)
- [ ] T008 [P] Create frontend onboarding store + API wrapper in `apps/desktop/src/features/onboarding/store.ts`: reads `onboarding_state_get`, refreshes on `onboarding:state-changed`, exposes the deterministic suppression flag (VITE_E2E input family; FR-030, research R8)
- [ ] T009 [P] Create the joyride adapter in `apps/desktop/src/features/onboarding/joyrideAdapter.tsx` (spike-verified rules, research R2): custom `tooltipComponent` that does NOT spread `tooltipProps`, own role + aria-live announcer from step title/content, per-layer focus-trap config (walk keeps trap; spotlight sets `disableFocusTrap`), Escape via default `dismissKeyAction`, ALWAYS gate `run={steps.length > 0}` (#1211); joyride imports confined to this module; pin `react-joyride` at `^3.2.0` in `apps/desktop/package.json`
- [ ] T010 Deletion lane (atomic with harness migration; research R7): delete `crates/app/core/src/guided_flow.rs`, `apps/desktop/src-tauri/src/commands/guided.rs`, `apps/desktop/src-tauri/src/commands/tour.rs`, `crates/contracts/core/src/guided.rs` (+ `mod` in lib.rs), `apps/desktop/src/features/guided/` (all files incl. `__tests__`), `preferences.tourCompleted` from `apps/desktop/src/data/preferences.ts` + `apps/desktop/src/api/mocks.ts` + bindings/tests; drop all guided/tour registrations from `apps/desktop/src-tauri/src/lib.rs:54,321-325,564-568`; remove the duplicate anchor from `apps/desktop/src/features/inbox/InboxDetail.tsx:779` (InboxPage bulk-confirm keeps `inbox.confirm-row`, FR-026); replace `tests/e2e/support/harness.ts:72 disableGuidedTourOverlay` with `disableOnboarding` (sets the T008 suppression flag) and migrate all ~30 call sites across 7 e2e files
- [ ] T011 Seed all onboarding Paraglide message keys in `apps/desktop/messages/en.json`: item labels (3–5 words), tooltip sentences, prerequisite reasons, orientation stop copy, section header/menu/confirm strings, announcer strings (FR-028)

**Checkpoint**: backend state machine-free, legacy coach gone, new commands
callable, `just lint && just test && just typecheck` green before any story UI.

## Phase 3: User Story 1 — First-Run Orientation Walk (P1) — MVP

**Goal**: modal page-by-page walk right after first-run setup; Next/Back/Skip/
Escape; done-forever; replay from Settings → Advanced (FR-001…FR-005).

**Independent test**: fresh profile → wizard finish → walk runs → skip/finish
never auto-runs again; replay works (spec US1 scenarios).

- [ ] T012 [US1] Define the 6 walk stops (the 5 FR-006 workflow pages in workflow order + the final stop anchored on the sidebar Getting started section introducing the checklists, FR-002 L1→L2 bridge) with spotlight targets + copy keys in `apps/desktop/src/features/onboarding/orientationSteps.ts`
- [ ] T013 [US1] Implement `OrientationWalk.tsx` in `apps/desktop/src/features/onboarding/` on the T009 adapter: modal mode, real route navigation per stop, Next/Back/Skip on every stop, Escape=skip, focus trap kept, aria-live stop announcements
- [ ] T014 [US1] Wire launch + completion: auto-run when first-run completed AND `orientationDone` false AND suppression flag absent; call `onboarding_orientation_complete` on finish/skip; mid-walk app close leaves it not-done (FR-004)
- [ ] T015 [US1] Add replay control in Settings → Advanced (`apps/desktop/src/features/settings/`), adjacent to the T027 restore control placement
- [ ] T016 [P] [US1] Playwright mock specs in `tests/e2e/` (or the mock-suite home per harness conventions): walk auto-runs once, full traversal, skip path, Escape path, never-auto-twice across reload, replay from Settings, no `role="alertdialog"`/`aria-modal` in DOM (VC-002)

**Checkpoint**: US1 alone is a shippable MVP.

## Phase 4: User Story 2 — Per-Page Getting Started Checklists (P2)

**Goal**: one sidebar accordion above pinned Settings; per-page groups; tooltips;
prerequisites + jump links; collapsed-mode popover; persisted collapse
(FR-006…FR-012, FR-031).

**Independent test**: spec US2 scenarios — auto-expand by route, counts,
popover, persistence.

- [ ] T017 [US2] Build the ONE parameterised checklist component + single CSS class family (tokens only) in `apps/desktop/src/features/onboarding/ChecklistSection.tsx` + `checklist.css`: accordion groups, item rows, tooltip on hover AND focus (WCAG 1.4.13), completed area slot, progress line; reused verbatim by the popover (R10 — run `scripts/css-dup-sniff.mjs`)
- [ ] T018 [US2] Mount the section in the sidebar above the pinned Settings entry (`apps/desktop/src/` app shell/sidebar component): overall progress line, groups in workflow-stage order, current route's group auto-expanded, others one-line with done/total counts, expanded by default on first visit, collapse persisted via `onboarding_section_set`
- [ ] T019 [US2] Implement prerequisite presentation: reason string (Paraglide) + jump link navigating to the upstream page; prerequisite satisfaction computed live from T004 data, clearing without reload (FR-010, spec edge case)
- [ ] T020 [US2] Icon-collapsed mode: progress-ring icon (`role="progressbar"`, `aria-valuenow`) opening the SAME checklist component as a non-modal popover (FR-011)
- [ ] T021 [P] [US2] Playwright mock specs: accordion semantics (expand-by-route, counts, tooltip on focus, `aria-expanded`), popover open/close + non-modality, collapse persistence, completed-group collapse to one-line done header + full-section auto-hide when the last item settles (FR-031)

## Phase 5: User Story 3 — Automatic Completion from Real Work (P3)

**Goal**: backend-authoritative auto-ticks + completion choreography + restore
inertness (FR-015…FR-021).

**Independent test**: real confirm/create/launch each tick their item within
2 s; restarts keep state; restore-sourced events never tick (spec US3
scenarios).

- [ ] T022 [US3] Layer-1 integration tests (first bus-subscribing Layer-1 tests, VC-003) in `crates/app/core/tests/onboarding_ticks_integration.rs`: real use cases publish `inventory.confirmed` / `project.created` / `tool.launch`; T005 subscriber persists the correct tick; `tool.launch` with outcome != `spawned` does NOT tick; envelope `source=="restore"` is inert; settled items are never downgraded
- [ ] T023 [US3] Layer-1 tests for seed/restore derivation in `crates/app/core/tests/onboarding_seed_integration.rs`: pre-existing confirmed inventory/projects/launches pre-tick on seed AND restore; unmet milestones stay unchecked; manually_checked/dismissed rows survive restore untouched; restore clears `section_hidden_at`; settle of the final open item sets `section_hidden_at` (FR-031); restore idempotent (FR-014, SC-004)
- [ ] T024 [US3] Implement completion choreography in the T017 component: check animation + brief row emphasis in place, then move to the completed (greyed, checked) area at the bottom of the group; auto-ticks additionally pulse the progress line / progress ring; `prefers-reduced-motion` applies final state instantly with zero animation/pulse (FR-018…FR-020); aria-live polite announcement per tick
- [ ] T025 [P] [US3] Playwright mock specs: manual check-off + dismiss choreography, completed-area move, reduced-motion parity (state identical, no motion); document in-spec that auto-tick event flow is NOT covered in mock mode (VC-002 limit)

## Phase 6: User Story 4 — Find-It Spotlight (P4)

**Goal**: per-item non-modal spotlight on the real control with the full
dismissal matrix (FR-022…FR-026).

**Independent test**: spec US4 scenarios — five dismissal paths, no timer,
reduced-motion.

- [ ] T026 [US4] Implement `FindSpotlight.tsx` in `apps/desktop/src/features/onboarding/` as a single-step non-modal joyride run via the T009 adapter (`disableFocusTrap`, no focus steal): resolves the item's `data-guide-anchor`, navigates to the item's page first when needed (FR-022), pulse first seconds → static outline, no pulse under reduced motion, overlay may span/dim the sidebar with ≥3:1 target contrast (R11); unavailable-target state explains why (spec edge case)
- [ ] T027 [US4] Wire the find/magnify affordance onto checklist item rows (T017 component) with pressed-state toggle semantics; dismissal matrix: click target, click anywhere else, Escape, toggle, route change; NEVER timebound (FR-023)
- [ ] T028 [P] [US4] Playwright mock specs: full dismissal matrix (all five paths), no timer dismissal, cross-page find navigates then spotlights, reduced-motion suppresses pulse (VC-002)

## Phase 7: User Story 5 — Removal, Restore, Replay Controls (P5)

**Goal**: permanent remove with one-line confirm; single Settings restore that
re-seeds from DB state (FR-013, FR-014).

**Independent test**: spec US5 scenarios.

- [ ] T029 [US5] Section-header small menu with "Remove getting started" + one-line confirm calling `onboarding_section_set removed=true`; hides section AND progress-ring icon permanently; active spotlight dismisses with it (spec edge case)
- [ ] T030 [US5] Settings → Advanced restore/reset control calling `onboarding_restore`; unhides after explicit removal AND after completion auto-hide, re-derived automatic pre-ticks visible, manual/dismissed states preserved, still-complete section stays visible until a new settle (FR-014/FR-031); idempotent double-restore; place beside the T015 replay control
- [ ] T031 [P] [US5] Playwright mock specs: remove → hidden across reload; restore → section back with mock pre-ticked state; confirm copy from Paraglide keys

## Phase 8: Polish & Cross-Feature Validation

- [ ] T032 Layer-2 tauri-driver E2E journey in `crates/e2e-tests/`: orientation walk (real UI) → real inventory confirm → assert live auto-tick renders (VC-004); wire into `just test-e2e`
- [ ] T033 Reference the journey-lane deliverables: journey **J18** in `docs/journeys/` is the behavioral contract (VC-001) and the coverage-matrix row in `specs/037-e2e-integration-testing/contracts/coverage-matrix.md` (VC-005) — both authored by the validation lane; verify they exist and match before closing the spec
- [ ] T034 File follow-up issues for missing milestone events (`calibration.master.registered`, site-saved) per research R4 — one issue each, referencing campaign tracker #881; no new events in v1
- [ ] T035 A11y pass over all three layers (accessibility-compliance/wcag-audit checklist, research R11): keyboard-only completion of every flow, focus return on close, announcer text sanity, contrast tokens, tooltip persistence — fix findings
- [ ] T036 Full gates: `just lint`, `just test`, `just typecheck`, `scripts/css-dup-sniff.mjs`, Playwright mock suite green; verify no `guided`/`tour_complete_step`/`tourCompleted` references remain (`rg -i "guided|tourCompleted|tour_complete_step"` clean outside specs/docs history)

## Dependencies

```text
Phase 1: T001 ─▶ T003 ─▶ T004        T002 ─▶ T004 (T002 ∥ T001/T003)
Phase 2: T004 ─▶ T005 ─▶ T006 ─▶ T007        T008 ∥ T009 ∥ T011 (after T007 for bindings in T008)
         T008 ─▶ T010 (harness flag must exist before the old helper dies)
Stories: Phase 2 ─▶ US1 (T012─▶T013─▶T014─▶T015; T016 after T013)
         Phase 2 ─▶ US2 (T017─▶T018─▶T019/T020; T021 after T018)
         US2(T017) + Phase 2 ─▶ US3 (T022/T023 after T005; T024 after T017; T025 after T024)
         US2(T017) + Phase 2 ─▶ US4 (T026─▶T027; T028 after T027)
         US2(T018) ─▶ US5 (T029─▶T030; T031 after T030)   T015 ∥ T030 share the Settings surface
Polish:  all stories ─▶ T032─▶T033; T034 anytime after research; T035/T036 last
```

- US1 depends only on Phase 2 → **MVP = Phases 1–3**.
- US3 tests (T022/T023) are backend-only and can run in parallel with US1/US2
  UI work once Phase 2 lands.
- T010 (deletion) MUST land atomically with its harness migration — never
  leave a window where e2e suites call a deleted helper.

## Parallel examples

- After T004: `T005` (subscriber) ∥ `T002-consumers` — while UI lanes start `T008`/`T009`/`T011`.
- After Phase 2: one lane per story — US1 (T012–T016), US2 (T017–T021) in
  parallel; US3 backend tests (T022/T023) in a third lane.
- Playwright spec tasks (T016, T021, T025, T028, T031) are [P] within their
  stories — different spec files.

## Implementation strategy

1. **MVP first**: Phases 1–3 → shippable orientation walk with legacy coach
   already deleted (largest risk retired early).
2. **Incremental**: land US2 (visible checklist, manual ticks) before US3
   (auto-ticks) — each phase is independently demoable and testable.
3. **Validation continuous**: Layer-1 tests land with US3 backend; J18 +
   coverage row (T033) are the external contract; final gates in T036.
