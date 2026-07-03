---
status: applied
created: 2026-07-03
applied: 2026-07-03
change_request: "Reconcile spec 006 (inventory-library-lifecycle) to the current design after the 041 inbox single-type split and the 043 UI redesign deprecated several pieces. Five dispositions: (1) drop session.mixed_state + the `mixed` frame-type entirely (deprecated by 041 single-type ingest); (2) drop the FR-002 frame-type filter (lights-centric Inventory; dark/flat/bias filtering lives on the Calibration page per 040); (3) keep + implement FR-007 per-row Reveal-in-OS via the spec-004 native command; (4) reconcile FR-010 — keep the distinct `ignored` state, ADD an Ignore action to the redesigned Sessions UI, and reroute the Cmd+K \"Show ignored\" entry to /sessions?reviewFilter=ignored; (5) add a Layer-1 test for the T403 disabled-source guard. Reconciliation to as-built + shipped-redesign design, not new scope."
scope: "Feature-wide (reconciliation: 1 subtraction + 2 amendments + 2 additions)"
---

## Change Summary

Reconcile spec 006 to the as-built + shipped-043-redesign reality: remove the
now-impossible `mixed` session concept and the Inventory frame-type filter,
implement the two requirements the redesign left as dead spec (FR-007 Reveal-in-OS,
FR-010 Ignore action + Cmd+K route), and close the T403 test-coverage gap.

## Implementation Progress

- **Tasks completed**: 28 of 43 `[x]` (per tasks.md); 15 open, 14 of which were
  DEFERRED (Playwright/no-GUI-runtime, follow-up integration tests).
- **Current phase**: Closeout-ready (no active phase; this is a reconciliation
  iteration, not new-phase work).
- **Files changed on branch**: 0 (fresh branch off `origin/redesign-ui-platevault`;
  only `.specify/feature.json` retargeted to 006).
- **Potential task completions to mark**: none from git.
- **Adhoc changes**: None.

## Impact Assessment

| Artifact | Action | Details |
|----------|--------|---------|
| spec.md | Modify | Drop `mixed` from FR-002 + reword FR-002 to remove the frame-type filter; reconcile SC-001 (frame-type filter going away); reword acceptance scenarios US1.2 + Edge Case (lines 35, 57) to point at the Inbox split gate not a `mixed` frame-type; amend FR-010 route `/inventory`→`/sessions` and add the Ignore action; drop the `mixed` filter note in Implementation Status (~126-129); tighten FR-007 to require the per-row Reveal action wired to the native command. |
| data-model.md | Modify | Remove `mixed` from the `type` enum (line 69); delete the server-derived `mixed` detection note (~90-92); delete the E5 "Mixed-session assign guard" section (~163-165). |
| tasks.md | Modify + Add | Mark **T308** (mixed_state contract test) and **T311** (server-side mixed detection) **OBSOLETE** — "deprecated by 041 inbox single-type split". Reword **T309** to implement the Cmd+K "Show ignored" entry against `/sessions?reviewFilter=ignored` (was deferred as "spec 020 router work"). Add **T410** FR-007 per-row Reveal-in-OS desktop action + wire to native command; **T411** Layer-1/contract test for Reveal. Add **T420** FR-010 Ignore action in the redesigned Sessions UI (row/drawer overflow, `review_session→ignored`); **T421** Layer-1 test asserting the Ignore action sets `ignored` and the row leaves the default ledger. Reword **T403** to an executed Layer-1 test (disabled-source review → `transition.refused`), no longer PARTIAL/deferred. |
| plan.md | No change | Architecture unchanged; no new tech decisions. |
| research.md | No change | `mixed` sentinel note in research §2 is superseded but historical; leave with a one-line supersession pointer only if apply finds it load-bearing. |
| contracts/ | No change (v1) | Backend `frame_filter` param + the `mixed` sentinel in the contract are retained as inert (no migration); the UI simply stops exposing the frame-type control. Flagged, not removed, to avoid a contract break. |

## Risk Checks

- [x] No completed `[x]` tasks invalidated — T308 is `[x]` but is being marked
  OBSOLETE (the fake test is removed, which is the point; it never guarded real
  behavior). No other completed task regresses.
- [x] No scope boundary violations — all five dispositions reconcile 006 to
  already-shipped 041/043/040 design; no new product surface.
- [x] No downstream dependency breaks — dropping `mixed` removes a phantom guard
  nothing depends on; FR-007/FR-010 additions are leaf UI + tests.

## Planned Changes

### spec.md
- **FR-002**: replace "Inventory rows MUST include frame type filtering for
  light, dark, flat, and bias" with a statement that the Inventory/Sessions view
  is lights-centric and does NOT expose a frame-type filter; dark/flat/bias
  filtering lives on the Calibration page (spec 040); note supersession by the
  043 redesign + 041 single-type ingest.
- **SC-001**: reconcile — remove "filter Inventory by frame type in one
  interaction"; replace with the source/review filter that the shipped Sessions
  page actually provides (or drop if fully covered elsewhere).
- **US1 Acceptance Scenario 2 (line 35)** + **Edge Case (line 57)**: reword the
  "mixed folder" language to reference the Inbox single-type split gate (041)
  rather than a `mixed` frame-type / move-time block.
- **FR-007**: tighten to require a per-row "Open location / Reveal in OS" action
  wired to the existing native reveal command when the Tauri integration is
  available.
- **FR-010**: amend the route to `/sessions?reviewFilter=ignored`; add that the
  Sessions UI MUST expose an **Ignore** action (distinct from Reject) so a
  discovered/needs-review session can be set to `ignored` and recovered via the
  Cmd+K "Show ignored items" entry.
- **Implementation Status (~126-129)**: drop the `mixed` filter-option note; keep
  the review-state and action-bound descriptions, adding Ignore alongside Reject.
- **Key Entities / Frame Type**: drop `mixed` from any enumerated list; keep
  `light, dark, flat, bias` (dark flat reserved).

### data-model.md
- Line 69: `type` enum → `enum(light, dark, flat, bias)`; drop the `mixed`
  sentinel clause (keep the `dark_flat` reserved note).
- Lines ~90-92: delete the server-derived `mixed` detection paragraph.
- Lines ~163-165: delete the E5 "Mixed-session assign guard" section.

### tasks.md
- **T308** → mark `[x]`→OBSOLETE with note "deprecated by 041 inbox single-type
  split; fake mixed_state fixture test removed".
- **T311** → mark OBSOLETE, same note.
- **T309** → reword + keep open: implement Cmd+K "Show ignored items" navigating
  to `/sessions?reviewFilter=ignored`.
- **T403** → reword to an executed Layer-1 test (no longer PARTIAL): review on a
  session under a `disabled` source returns `transition.refused`.
- **Add T410** [US3] FR-007 per-row Reveal-in-OS action wired to the native
  command (reuse the spec-004 reveal command already used by projects).
- **Add T411** [US3][P] Layer-1/contract test for the Reveal action wiring.
- **Add T420** [US3] FR-010 Ignore action in the redesigned Sessions UI
  (row/drawer overflow → `review_session(id, "ignored")`), idempotent.
- **Add T421** [US3][P] Layer-1 test: Ignore sets `ignored` and the row leaves
  the default ledger; `reviewFilter=ignored` surfaces it.
- Update the Dependency Graph + Story Map notes to reflect the obsolete/added
  tasks (T410/T411/T420/T421 follow T301; T403 no longer deferred).

### research.md
- (No change; optional one-line supersession pointer on the §2 `mixed` sentinel
  if apply finds it referenced elsewhere.)

### plan.md
- (No change.)
