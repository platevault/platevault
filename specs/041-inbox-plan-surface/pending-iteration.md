---
status: pending
created: 2026-07-13
change_request: "Global plan/queue + apply-now/add-to-plan + catalogue-no-plan. Every plan-producing action (Inbox move, Cleanup, Archive, Restructure, PreparedView gen/regen/removal, Project-scaffold) gets a combined 'Apply now / Add to plan' control. Introduce a single GLOBAL plan/queue visible app-wide (NOT per-window): a status-bar counter (queuedActionCount in useStatusSummary, a peer chip) plus a fold-out Plan/Queue panel modeled on LogPanel (own PlanQueueContext) listing all queued actions across origins with origin + from->to + per-item Apply/Remove + Apply-all. 'Add to plan' routes into this global queue; 'Apply now' bypasses it. A plan record + audit are ALWAYS written, even for ceremony/auto-apply origins (project_create.rs mkdir precedent). 'Apply now' is not silent: destructive/move origins still show from->to inline before executing; ceremony origins just do it. Catalogue-in-place registers directly at confirm (move the plan_listener registration to confirm-time for catalogue items) — no plan needed since nothing mutates. Stays within the constitution WITHOUT amendment."
scope: "Feature-wide"
---

## Change Summary

Promote the inbox-local plan panel into a single **global plan/queue** shared by
every plan-producing surface (Inbox move, Cleanup, Archive, Restructure,
PreparedView gen/regen/removal, Project-scaffold), give every such action a
combined **"Apply now / Add to plan"** control, always write a plan record +
audit (even for ceremony/auto-apply origins), and move catalogue-in-place
registration to confirm-time so it produces no plan. No constitution amendment.

## Implementation Progress

- **Tasks completed**: T001–T059, T061–T078, T080–T081 (79 of 81; from the
  applied 2026-06-21 and 2026-06-23 iterations on `main`).
- **Remaining**: T060 (`[~]` Windows E2E for the destination-model phase,
  merge-gated by Layer-1 + vitest; live tauri-MCP run recommended post-merge),
  T079 (`[ ]` Phase 13 quickstart + Windows E2E).
- **Current phase**: feature is implementation-complete except the two Windows
  E2E verification tasks; this iteration opens a new **Phase 14**.
- **Files changed on branch**: 0 (fresh branch `docs/grilling-decisions-2026-07-13`
  off `origin/main`; this define run adds only `pending-iteration.md`).
- **Potential task completions to mark**: none.
- **Adhoc changes**: The prior applied iteration record was archived to
  `iteration-2026-06-23-applied.md` to preserve history before writing this
  pending file.

## Impact Assessment

| Artifact | Action | Details |
|----------|--------|---------|
| spec.md | Modify | Add US17 (global plan/queue), US18 (apply-now vs add-to-plan on every plan producer), US19 (catalogue registers at confirm, no plan); add FR-055–FR-063; add SC entries for the global queue count + apply-now/add-to-plan + catalogue-no-plan; note the plan surface is no longer inbox-local (relaxes FR-003/FR-004 wording) |
| plan.md | Modify | Add `PlanQueueContext` + fold-out Plan/Queue panel (modeled on `apps/desktop/src/ui/LogPanel.tsx`) + `queuedActionCount` peer chip in `useStatusSummary`/`StatusBar`; a global unapplied-plan enumeration path in app/core; catalogue confirm-time registration move; re-assert constitution gate (II + V hold, no amendment); add Phase 14 |
| tasks.md | Add | Phase 14: T082–T093 (backend queue query + contract, PlanQueueContext, status chip, fold-out panel, per-origin Apply now/Add to plan control, always-write plan+audit for ceremony origins, catalogue confirm-time registration move, tests) |
| data-model.md | Modify | Define the global queue as a read model over persisted-but-unapplied plan records across origins; add `origin` discriminator on plan records if not already present; note ceremony/auto-apply origins still persist a (possibly immediately-applied) plan record |
| research.md | Modify | Record the plan-origin inventory + verdicts (valuable / ceremony / low-stakes), the "always write plan+audit" rationale (project_create.rs precedent), and the constitution-without-amendment argument |
| contracts/operations.md | Modify | Add `plan.queue.list` (all unapplied actions across origins with origin + from→to), `plan.queue.apply_item` / `plan.queue.remove_item` / `plan.queue.apply_all`; note `inbox.confirm` catalogue path registers at confirm-time (no plan emitted) |
| quickstart.md | Modify | Add scenarios: queue counter increments on Add-to-plan across origins; Apply now bypasses queue but shows from→to for destructive/move; catalogue confirm produces no queued action; Apply-all drains the queue |

## Risk Checks

- [x] No completed tasks invalidated — Phase 14 is additive; the inbox-local
  `PlanPanel` (T014/T041/T055) is superseded UI-side by the global panel but its
  app/core plan-generation and audit paths are reused, not reworked. The
  catalogue registration move (decision 6) touches `plan_listener.rs`
  (T032) — verify the existing catalogue tests are re-pointed, not deleted.
- [x] No scope boundary violations — stays within the constitution without
  amendment: every action still yields a reviewable from→to (Principle II) and a
  durable audit record (Principle V); ceremony origins auto-apply per the
  already-decided 2026-07-04 project-scaffold mkdir precedent.
- [x] No downstream dependency breaks — the global queue is a read model over
  the existing persisted plan records; adding an `origin` discriminator is
  backward-compatible (default to the inbox origin for existing rows).

## Planned Changes

### spec.md

- **US17 — Global plan/queue (P1)**: as a user I see a single app-wide queue of
  all not-yet-applied actions regardless of which surface produced them, with a
  status-bar counter and a fold-out panel; I can Apply or Remove any single
  queued action or Apply-all. The queue is global, NOT per-window.
- **US18 — Apply now vs Add to plan on every plan producer (P1)**: every
  plan-producing action (Inbox move, Cleanup, Archive, Restructure, PreparedView
  gen/regen/removal, Project-scaffold) offers a combined "Apply now / Add to
  plan" control. "Add to plan" routes the action into the global queue; "Apply
  now" bypasses the queue. "Apply now" is not silent — destructive/move origins
  show from→to inline before executing; ceremony origins just do it.
- **US19 — Catalogue registers at confirm, no plan (P2)**: cataloguing in place
  registers records directly at confirm-time and produces no plan/queue entry,
  since nothing on disk mutates.
- **FR-055**: The system MUST maintain a single global plan/queue of all
  not-yet-applied actions across every plan-producing origin, visible app-wide
  (not scoped to one window/surface).
- **FR-056**: The status bar MUST show a `queuedActionCount` peer chip reflecting
  the number of queued (not-yet-applied) actions across all origins.
- **FR-057**: A fold-out Plan/Queue panel MUST list every queued action with its
  origin, its from→to (or catalogue/ceremony descriptor), and per-item Apply /
  Remove controls plus an Apply-all control.
- **FR-058**: Every plan-producing action MUST expose a combined "Apply now /
  Add to plan" control; "Add to plan" enqueues into the global queue and "Apply
  now" bypasses it.
- **FR-059**: "Apply now" MUST NOT be silent for destructive or move origins —
  the from→to MUST be shown inline before execution (Principle II); ceremony
  origins (project-scaffold, catalogue-in-place) MAY apply without an inline
  review step.
- **FR-060**: A plan record AND an audit record MUST be written for every applied
  action, including ceremony/auto-apply origins (per the `project_create.rs`
  mkdir precedent).
- **FR-061**: Cataloguing in place MUST register records directly at confirm-time
  and MUST NOT emit a plan or a queue entry (nothing on disk mutates).
- **FR-062**: The plan/queue surface MUST be reachable from any page (it is not
  the inbox-local panel) — relaxes the inbox-local wording of FR-003/FR-004 while
  preserving "explicit Apply step" and "no unexpected navigation".
- **FR-063**: Removing a queued action MUST leave all files untouched and MUST
  NOT write a filesystem-mutation audit record (only queue-management state).
- **Success Criteria**: add SC entries — (a) the queue counter reflects queued
  actions across ≥2 distinct origins in one session; (b) Apply-all drains the
  queue and each drained action writes its own audit record; (c) a catalogue
  confirm produces zero queue entries; (d) an "Apply now" on a move origin shows
  from→to before executing.

### plan.md

- Add `PlanQueueContext` (React context) as the single client-side owner of the
  global queue state; the fold-out panel is a sibling of `LogPanel`
  (`apps/desktop/src/ui/LogPanel.tsx`) and reuses its fold-out chrome pattern.
- Add the `queuedActionCount` field to `apps/desktop/src/app/useStatusSummary.ts`
  and render a peer chip in `apps/desktop/src/app/StatusBar.tsx`.
- Add an app/core enumeration of unapplied plan records across origins backing
  `plan.queue.list`; reuse the existing plan-generation + audit paths.
- Catalogue-in-place: relocate the calibration/light registration from
  `crates/app/inbox/src/plan_listener.rs` (apply-completion) to confirm-time for
  catalogue items, so no plan is generated for the catalogue path.
- Re-assert the Constitution Check: Principle II (reviewable mutation) and
  Principle V (durable records) both hold — every action yields a reviewable
  from→to and a durable audit record; ceremony auto-apply follows the
  already-ratified 2026-07-04 project-scaffold decision. Verdict: PASS, no
  amendment required.
- Add **Phase 14** to the phase list.

### tasks.md

- **T082 [US17]** app/core + persistence: enumerate unapplied plan records across
  all origins; add an `origin` discriminator to plan records (default inbox for
  existing rows). (FR-055/FR-060)
- **T083 [US17]** contracts + bindings: `plan.queue.list`,
  `plan.queue.apply_item`, `plan.queue.remove_item`, `plan.queue.apply_all`.
  (FR-055/FR-057/FR-063)
- **T084 [P] [US17]** frontend: `PlanQueueContext` owning global queue state,
  fed by `plan.queue.list`.
- **T085 [US17]** frontend: `queuedActionCount` in `useStatusSummary` + a peer
  chip in `StatusBar`. (FR-056)
- **T086 [US17]** frontend: fold-out Plan/Queue panel modeled on `LogPanel`,
  listing origin + from→to + per-item Apply/Remove + Apply-all. (FR-057)
- **T087 [US18]** frontend: shared combined "Apply now / Add to plan" control;
  wire it into Inbox move, Cleanup, Archive, Restructure, PreparedView
  gen/regen/removal, Project-scaffold. One component, all origins inherit it.
  (FR-058)
- **T088 [US18]** "Apply now" path: show from→to inline for destructive/move
  origins before executing; ceremony origins apply directly. (FR-059)
- **T089 [US18]** always write plan record + audit for ceremony/auto-apply
  origins (project-scaffold, catalogue) per the `project_create.rs` precedent.
  (FR-060)
- **T090 [US19]** move catalogue-in-place registration from `plan_listener.rs`
  apply-completion to confirm-time; catalogue confirm emits no plan. Re-point
  (do not delete) the existing catalogue tests. (FR-061)
- **T091 [P] [US17/US18/US19]** Layer-1 tests: cross-origin queue enumeration;
  apply-item/remove-item/apply-all; ceremony origins write plan+audit; catalogue
  confirm emits no plan; remove-item writes no fs-mutation audit.
- **T092 [P] [US17/US18/US19]** vitest: status chip count, fold-out panel
  rendering + per-item controls, combined control across origins, Apply-now
  from→to inline for move.
- **T093 [US17]** quickstart + Windows E2E (tauri MCP) for the global queue
  across ≥2 origins; update `specs/037-e2e-integration-testing/contracts/coverage-matrix.md`.

### data-model.md

- Define the global queue as a **read model** over persisted-but-unapplied plan
  records across origins (no new durable table strictly required; the queue is a
  projection).
- Add an `origin` discriminator on plan records (inbox-move | cleanup | archive |
  restructure | prepared-view | project-scaffold | catalogue) with a default of
  the inbox origin for existing rows.
- Note ceremony/auto-apply origins still persist a plan record (possibly
  immediately marked applied) so the audit trail is complete (FR-060).

### research.md

- Record the plan-origin inventory + verdicts: Inbox-move valuable;
  Inbox-catalogue ceremony (no mutation); Cleanup valuable (§II); Archive
  valuable; Restructure valuable; PreparedView gen/regen/removal low-stakes
  (reproducible §V projection); Project-scaffold ceremony (mkdir auto-applies per
  2026-07-04).
- Record the "always write plan + audit" rationale (project_create.rs mkdir
  precedent) and the constitution-without-amendment argument (Principles II + V
  both satisfied).

### quickstart.md

- Add scenarios: queue counter increments on Add-to-plan across ≥2 origins; Apply
  now bypasses the queue but shows from→to inline for a move origin; a catalogue
  confirm produces zero queued actions; Apply-all drains the queue and each
  action writes its own audit record.
