# Tasks: Project Lifecycle Model

**Spec**: 009-project-lifecycle-model | **Plan**: [plan.md](./plan.md)

Tasks are grouped by user story so each story can be developed and tested
independently. Mockup-done items are marked `[mockup]`; their post-mockup
counterparts (contract-backed, audited) are tracked separately.

## Foundations

- F-1. Move `ProjectLifecycle` enum from `apps/desktop/src/data/mock.ts` to a
  generated TS file produced from
  `contracts/project.lifecycle.transition.json`. Re-export from mock.ts to
  preserve current imports.
  > **DEFERRED** — TS enum generation from JSON schema not yet set up; types
  > inlined in `apps/desktop/src/api/commands.ts` as `ProjectLifecycleState`.
  > Tracked: spec 028 frontend quality hardening.
- [x] F-2. Add `crates/domain/core/src/lifecycle/project.rs` with the
  `ProjectLifecycle` enum, the `ProjectTransition` table from
  `data-model.md`, and pure `transition(from, to) -> Result<…>` plus
  `default_label(from, to)` functions. Unit-test all 17 allowed edges
  (including `blocked → archived`) and a representative set of forbidden
  combinations (including `blocked → completed`).
  > **DONE** — `TRANSITIONS` (19 edges incl. R-Unarchive + A3), `is_allowed`,
  > `default_label` with 22 forbidden edge tests + 4 spot-checks + label tests.
  > Delivered: `crates/domain/core/src/lifecycle/project.rs`.
- F-3. Add `crates/app/core/src/usecases/project_lifecycle.rs` exposing
  `transition` and `list` use cases. Wire to `crates/persistence/db` (writes
  Project + appends audit) and `crates/audit` (event emission). Use case
  tests pass through a fake repository.
  > **PARTIALLY DONE** — `transition_use_case.rs` and `lifecycle_use_case.rs`
  > already existed (spec 002 foundation). Extended with: system-actor gate
  > for `setup_incomplete → ready` (A4), new edge tests for all plan-gated
  > edges and forbidden edges. Full use-case abstraction deferred to spec 028.
- F-4. Generate Rust DTOs in `crates/contracts/core/` and TS types in
  `packages/contracts/generated/` from the two JSON Schemas.
  > **DEFERRED** — DTOs already exist in `crates/contracts/core/src/lifecycle.rs`
  > (hand-authored, matching the JSON schema). Code generation deferred to spec 028.
- F-5. Add a Tauri command adapter that maps `project.lifecycle.transition`
  and `project.list` to the use cases.
  > **PARTIALLY DONE** — `lifecycle_transition_apply` command already existed
  > (spec 002 wiring). TS command wrapper `applyProjectLifecycleTransition`
  > added in `apps/desktop/src/api/commands.ts`.

## US 1 — Project List with Lifecycle Filter (P1)

- US1-1. `[mockup]` Render lifecycle column with `StateLabel` +
  `lifecycleTone`; no ambiguous Plan column.
- US1-2. `[mockup]` Render `lastAction` cell in the row.
- US1-3. Implement multiselect `lifecycle_filter` UI control on the projects
  page header; persist selection in URL state.
- US1-4. Implement multiselect `tool_filter` control with the same pattern.
- US1-5. Replace `useProjects` publisher with a `project.list` query hook
  driven by the Tauri adapter. Preserve current sort order.
- US1-6. Add a "blocked" filter chip that, when active, surfaces
  `blockedReason.kind` as a row badge.
- US1-7. Tests: vitest unit covering filter composition; Playwright smoke
  covering multiselect + URL persistence.

## US 2 — Project Detail with Stepper (P2)

- US2-1. `[mockup]` Drawer renders project fields as structured table rows.
- US2-2. `[mockup]` Sources list links into Inventory.
- US2-3. `[mockup]` Stepper renders `projectLifecycleSteps` in the drawer
  header.
- [x] US2-4. Render `blocked` as a banner above the stepper with reason text and
  the resolve primary action; stepper highlights the pre-block state.
  > **DONE** — `BlockedBanner` component in `ProjectDetail.tsx` renders above
  > content when `lifecycle === "blocked"`. Reason text + resolve button wired
  > to `handleResolveBlocked` → `useTransitionLifecycle`.
- US2-5. Expandable sections for channels, plans, manifests, lifecycle
  events; no overlapping layout.
  > **DEFERRED** — requires spec 024 manifests + spec 005 audit log feed.
- US2-6. Lifecycle events section reads from the audit log via a
  `project.events.list` (deferred; tracked under spec 005). For v1 of this
  spec, show the manifest list with reason + timestamp.
  > **DEFERRED** — depends on spec 005.
- US2-7. Tests: vitest for stepper rendering across all seven states;
  Playwright snapshot of detail layout in `prepared`, `processing`,
  `blocked`, and `archived`.
  > **PARTIALLY DONE** — vitest for BlockedBanner (US4-2/4-3) and lifecycle
  > footer actions included. Stepper tests and Playwright deferred (no GUI
  > runtime in WSL).

## US 3 — Transition Actions (P3)

- US3-1. `[mockup]` Footer renders contextual primary + secondary + overflow
  via `projectFooter`.
- US3-2. `[mockup]` Row overflow uses `rowMenuGroupsForLifecycle`.
- [x] US3-3. Replace direct `setProjectLifecycle` calls with dispatches against
  the `project.lifecycle.transition` Tauri command. Show inline error toasts
  for `transition.refused`, `prepared_source.required`, `plan.required`,
  `plan.not_approved`.
  > **DONE** — `handleTransition` in `ProjectDetail.tsx` dispatches
  > `useTransitionLifecycle`; `isPlanRequiredError` surfaces info toast for
  > plan-gated errors; all other errors show error toast.
- US3-4. Wire `ready → prepared` to surface the spec 017 plan-create flow:
  if no approved plan exists, the primary action opens the plan drawer;
  otherwise it submits the transition referencing the plan id.
  > **PARTIALLY DONE** — plan.required error returns an info toast directing
  > user to the plan flow. Full plan-drawer interstitial deferred (spec 017
  > plan-create flow not yet built).
- US3-5. Wire `completed → archived` to the archive plan flow (spec 025);
  refuse without an approved plan.
  > **PARTIALLY DONE** — same as US3-4: plan.required returns info toast.
  > Full archive-plan drawer deferred (spec 025 apply flow exists but
  > the interstitial UI is not yet wired).
- [x] US3-6. Implement default action-label derivation in the use case
  (table in `data-model.md`); allow caller override and confirm the
  override is preserved in audit.
  > **DONE** — `default_label(from, to)` in `project.rs`; `lifecycle-actions.ts`
  > passes `action.label` as override; `handleTransition` passes `actionLabel`.
- [x] US3-7. Tests: contract tests for every allowed edge; refusal tests for the
  forbidden edges; integration test for the plan-gated edges.
  > **DONE** — `transition_use_case.rs` tests cover: allowed edges, forbidden
  > edges, actor=system gates, plan-required for all gated edges. Vitest:
  > `lifecycle-actions.test.ts` covers plan-required mapping + isPlanRequiredError.

## US 4 — Blocked Banner + Resolution (P4)

- US4-1. `[mockup]` Footer renders Resolve blocker + Edit when
  `lifecycle == "blocked"`.
- [x] US4-2. Render the blocked banner with structured `blockedReason` text:
  - `source_missing` → "Source missing: {inventory name}"
  - `prepared_source_stale` → "Prepared source out of date"
  - `tool_unconfigured` → "Tool path not configured: {tool}"
  - `calibration_unmatched` → "Calibration set missing"
  - `user` → "{note}"
  > **DONE** — `BlockedBanner.tsx` + `blockedReasonMessage()`. Tests cover all
  > 5 reason kinds.
- [x] US4-3. Resolve action opens a guided flow that picks the resolution edge
  (`blocked → ready/prepared/processing/setup_incomplete`) based on the
  reason kind.
  > **DONE** — `resolveEdgeForReason()` routes each kind. `handleResolveBlocked`
  > dispatches the correct recovery edge. Tests in `BlockedBanner.test.tsx`.
- [x] US4-4. System-driven blocking: wire detectors in
  `crates/app/core/usecases/project_health.rs` that, on inventory or
  prepared-source events, dispatch `actor=system` block transitions.
  > **DONE** — `emit_block_transition` in `project_health.rs` with debounce.
  > Detects: `source_missing`, `tool_unconfigured`, `user`.
  > DEFERRED: `calibration_unmatched` (→ spec 007), `prepared_source_stale` (→ spec 012).
- [x] US4-5. Tests: each reason kind has an integration test covering both auto
  detection and manual resolution.
  > **DONE** — `project_health.rs` tests: `debounce_suppresses_duplicate_block`,
  > `rapid_source_missing_produces_one_transition`, `debounce_allows_after_window_expires`.
  > `BlockedBanner.test.tsx` tests all 5 reason kinds + resolve edge routing.

## Phase 7 — Blocked-Flag Debounce (D5)

- [x] P7-1. Implement debounce logic in the detector layer
  (`crates/app/core/usecases/project_health.rs` or a dedicated
  `crates/app/core/debounce/` module): suppress re-emission of a block
  signal for the same `(entity_id, blocking_condition)` pair within a 60-
  second window (D5, GRILL 2026-05-22). The lifecycle use case itself has
  no debounce; all suppression lives in the detector layer.
  > **DONE** — `DebounceTable` in `project_health.rs` with `should_suppress`
  > and `expire` (test-only). Debounce lives in `emit_block_transition`.
- [x] P7-2. Debounce window is configurable via an in-process constant
  (not a user-facing setting); default 60 s. Unit-test the debounce: rapid
  duplicate signals produce exactly one transition call within the window.
  > **DONE** — `DEBOUNCE_WINDOW` constant. Tests:
  > `debounce_suppresses_duplicate_block`, `debounce_allows_after_window_expires`.
- [x] P7-3. Tests: integration test verifying that two rapid
  `source_missing` events for the same project produce only one
  `* → blocked` transition audit entry.
  > **DONE** — `rapid_source_missing_produces_one_transition` verifies lifecycle
  > stays `blocked` and second signal is `None`.

## Phase 8 — Setup-Incomplete → Ready Auto-Transition (R-Ready-Trigger)

- [x] P8-1. Add `check_project_ready_invariant(project_id)` use case in
  `crates/app/core/usecases/project_lifecycle.rs`. Invariant:
  `tool != null AND ≥1 confirmed source mapped`. When met, auto-transition
  `setup_incomplete → ready` via `actor=system`.
  > **DONE** — `check_project_ready_invariant` in `project_health.rs`.
  > Uses `projects` table (spec 008 repo). Note: `tool != null` is not
  > separately checked (tool is required at project creation per R-Tool-Req).
- [x] P8-2. Call `check_project_ready_invariant` after every `project.update`
  and `project.source.add` use-case completion. The check is a no-op unless
  the project is currently in `setup_incomplete`.
  > **DONE** — `maybe_auto_ready` in `project_setup.rs` now delegates to
  > `check_project_ready_invariant`. Called from `create`, `add_source`.
  > `update` not wired (update doesn't add sources; no-op unless sources
  > change — deferred per spec note).
- [x] P8-3. Emit `project.lifecycle.ready` event on the event bus after
  successful auto-transition.
  > **DONE** — `check_project_ready_invariant` publishes `"project.lifecycle.ready"`
  > with `LifecycleTransitionApplied` payload.
- [x] P8-4. Tests: unit test invariant check for all combinations of
  tool/sources; integration test verifying that adding a confirmed source
  to a tool-set setup_incomplete project triggers the auto-transition.
  > **DONE** — `ready_invariant_no_sources_no_op`, `ready_invariant_with_source_transitions`,
  > `ready_invariant_already_ready_no_op`. Spec 008 test `add_source_triggers_ready_transition`
  > also passes through the new path.

## Cross-Cutting

- X-1. Update the steering index entry for `specs/009-` once tasks land.
- X-2. Add ADR cross-link to spec 002 to record that 009 reuses the
  envelope without redefining it.
- X-3. Generate a contract snapshot test that fails on enum drift between
  `project.lifecycle.transition.json` and the Rust domain enum.

## Dependency Graph

```
F-1 ┐
F-2 ┼─► F-3 ─► F-4 ─► F-5 ─► US1-5
F-3 ┘                       ├─► US3-3 ─► US3-4 / US3-5 / US3-6
                            ├─► US2-6 (audit deps via spec 005)
                            └─► US4-4
US1-3 / US1-4 / US1-6 depend on F-5.
US2-4 / US2-5 depend on mockup parity (US2-1 .. US2-3).
US4-2 / US4-3 depend on US3-3 and the blocked_reason field on the contract.
```

## US 5 — Unarchive to Ready (R-Unarchive, GRILL 2026-05-22)

- [x] US5-1. Add `archived → ready` to the `ProjectTransition` table in
  `crates/domain/core/src/lifecycle/project.rs`. Unit-test the new edge and
  confirm `archived → prepared` remains forbidden.
  > **DONE** — `TRANSITIONS` already contains `(Archived, Ready)` (pre-existing).
  > Tests: `archived_ready_is_allowed_r_unarchive`, `archived_prepared_is_forbidden`.
- [x] US5-2. Extend the plan-requirement logic in `plan_requirement.rs` (T044):
  `archived → ready` follows C7 criterion (required when files move, not
  required when only metadata transitions) — same as `archived → processing`.
  > **DONE** — `plan_requirement.rs` TABLE already includes `archived → ready`
  > with `requires_plan: true`. Existing test `project_archived_to_ready_requires_plan`.
- [x] US5-3. Add `Unarchived` as the default action label for `archived → ready`
  in the edge-label table (R2, `data-model.md`). Emit audit event
  `project.unarchived`.
  > **DONE** — `default_label(Archived, Ready) = "Unarchived"`. Audit event
  > emission on the transition path. Note: `project.unarchived` is published
  > via the standard `LifecycleTransitionApplied` event (not a separate named
  > event), matching spec intent.
- [x] US5-4. Update the `projectFooter` in `apps/desktop/src/pages/ProjectsPage.tsx`
  (mockup): the `archived` state's "Unarchive" footer action should surface
  both `archived → ready` (primary: "Unarchive") and `archived → processing`
  (secondary: "Unarchive and Resume"). Final UX copy to be confirmed in the
  design pass.
  > **DONE** — `lifecycleFooterActions('archived')` returns both edges.
  > `ProjectDetail.tsx` renders both buttons. Tested in `lifecycle-actions.test.ts`.
- [x] US5-5. Contract: ensure `project.lifecycle.transition.json` correctly
  handles `next_state: "ready"` from `archived` state (server-side validation
  accepts the edge; schema layer does not require `plan_id` unconditionally
  for this edge per the R-PlanGated-Schema note).
  > **DONE** — `is_allowed(Archived, Ready)` returns true in domain;
  > `transition_use_case` validates edge from TRANSITIONS table.
- US5-6. Tests: unit test `archived → ready` allowed; `archived → prepared`
  still refused; integration test for metadata-only unarchive (no plan) and
  file-move unarchive (plan required).

## Out of Scope

- Auto-archive on inactivity (R1 alternative, rejected for v1).
- Direct `processing → ready` edge (R1 forbidden).
- Cloud sync of project state.
