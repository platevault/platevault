# UX & Semantics Requirements Checklist: Onboarding Redesign (Spec 056)

**Purpose**: Unit-test the written requirements (spec.md / plan.md / tasks.md)
for completeness, clarity, consistency, and coverage before implementation.
**Created**: 2026-07-18 (unattended run; answers judged against the approved
decision record)
**Feature**: [spec.md](../spec.md)

## Layer 1 — Orientation Walk

- [x] CHK001 - Is the modality exception (modal walk in a non-modal product) explicitly documented with its scope and justification? [Clarity, Spec §FR-002; Plan §Constitution Check]
- [x] CHK002 - Are all walk exit paths (finish, skip, Escape, app close mid-walk) and their done-forever consequences individually specified? [Completeness, Spec §FR-003/FR-004; Edge Cases]
- [x] CHK003 - Is the auto-run trigger condition fully specified (first-run completion AND not done AND suppression absent)? [Completeness, Spec §FR-001; data-model §Derived]
- [x] CHK004 - Are replay semantics defined so replay cannot re-enable auto-run? [Clarity, Spec §FR-005]
- [x] CHK005 - Is the stop content model specified (whole-page spotlight + short copy, per-stop controls)? [Completeness, Spec §FR-002/FR-003]
- [x] CHK006 - Is the number/order of walk stops bounded and tied to real pages? [Clarity, Plan §Scale/Scope; Tasks T012]

## Layer 2 — Checklist Accordion

- [x] CHK007 - Are the exact page set (5 in, 3 excluded) and per-page item bounds (2–4) explicitly specified? [Completeness, Spec §FR-006]
- [x] CHK008 - Is the section placement (above pinned Settings) and group ordering (workflow stages) unambiguous? [Clarity, Spec §FR-007]
- [x] CHK009 - Are label length (3–5 words) and tooltip behavior (hover AND keyboard focus) both specified? [Completeness, Spec §FR-008; research R11]
- [x] CHK010 - Are prerequisite-state requirements complete: reason text, jump link destination, live clearing without reload? [Completeness, Spec §FR-010; Edge Cases]
- [x] CHK011 - Are icon-collapsed requirements (progress ring semantics, non-modal popover, same component) specified? [Completeness, Spec §FR-011; research R10]
- [x] CHK012 - Are default-expanded vs persisted-collapse rules non-conflicting and tied to a storage decision? [Consistency, Spec §FR-012; data-model §onboarding_flags]
- [x] CHK013 - Is the completion end state defined (per-group collapse to a done header, full-section auto-hide on the last settle, restore resurfacing incl. the still-complete case)? [Edge Case, Spec §FR-031; PQ-004 resolved]
- [x] CHK014 - Is remove/restore behavior fully specified: one-line confirm, permanence, single restore control, idempotence, automatic-items-only re-derivation with manual states preserved? [Completeness, Spec §FR-013/FR-014]
- [x] CHK015 - Is first-activation seeding explicitly aligned with restore seeding (one derivation)? [Consistency, Spec §FR-014; PQ-001]

## Completion Semantics (backend-authoritative)

- [x] CHK016 - Is the auto-tick event list closed and evidence-backed (verified topics only; no new events in v1)? [Traceability, Spec §FR-015; research R4]
- [x] CHK017 - Is the restore-inertness rule located server-side and testable? [Clarity, Spec §FR-016; contracts §Invariants; VC-003]
- [x] CHK018 - Are manual vs auto item behaviors distinguished, including the no-per-item-undo rule? [Clarity, Spec §FR-017; PQ-002]
- [x] CHK019 - Is the completion choreography specified end-to-end (in-place animation → completed area move → auto-tick pulse) with a reduced-motion equivalent that preserves state parity? [Completeness, Spec §FR-018–FR-020; research R11]
- [x] CHK020 - Is "backend-authoritative" operationalized (UI cannot write auto states; refresh only via notification)? [Clarity, Spec §FR-021; contracts §Invariants]
- [x] CHK021 - Are settled-state rules defined (events never downgrade or re-tick)? [Edge Case, data-model §State transitions]
- [x] CHK022 - Is the 2-second tick visibility target measurable and journey-testable? [Measurability, Spec §SC-002]

## Layer 3 — Spotlight

- [x] CHK023 - Is the dismissal matrix exhaustive and closed (five paths, never timebound)? [Completeness, Spec §FR-023]
- [x] CHK024 - Are pulse timing/settle and reduced-motion suppression specified? [Clarity, Spec §FR-024]
- [x] CHK025 - Is single-target anchor resolution required, with the known duplicate resolved to a named target? [Consistency, Spec §FR-026; research R7]
- [x] CHK026 - Is cross-page find behavior defined (navigate then spotlight, dismissal ordering)? [Edge Case, Spec §FR-022; PQ-003]
- [x] CHK027 - Is the unavailable-target state (control not rendered) addressed? [Edge Case, Spec §Edge Cases; Tasks T026]
- [x] CHK028 - Is non-modality operationalized (no focus steal, app stays interactive, sidebar dimming allowed)? [Clarity, Spec §FR-022/FR-025; research R2/R11]

## Accessibility (WCAG 2.2 AA)

- [x] CHK029 - Are keyboard operability requirements stated for every surface (walk, accordion, popover, spotlight, tooltips)? [Coverage, Spec §FR-029; SC-005]
- [x] CHK030 - Are assistive announcements specified for the three announcement classes (walk stops, ticks, spotlight open/close) with non-interrupting politeness? [Completeness, Spec §FR-029; research R2.1/R11]
- [x] CHK031 - Are focus-management rules per layer explicit (trap kept for modal walk, no trap for spotlight, focus return on close)? [Clarity, research R2.2/R11; Tasks T009]
- [x] CHK032 - Is the removal of library-default modal ARIA a stated requirement rather than an implementation accident? [Traceability, research R2.1; Tasks T016]
- [x] CHK033 - Are reduced-motion requirements uniform across all three layers and choreography? [Consistency, Spec §FR-020/FR-024; SC-005]
- [x] CHK034 - Are contrast requirements defined for the dimmed-overlay spotlight target? [Gap → addressed in research R11 (≥3:1 non-text); consider promoting to spec if contested]

## Validation & Cross-Cutting

- [x] CHK035 - Does every VC map to a named vehicle with its known limits documented (mock-mode no-op event path)? [Traceability, Spec §VC-001–VC-005; Plan §Validation Plan]
- [x] CHK036 - Is the e2e suppression replacement a functional requirement with a migration obligation (all legacy call sites)? [Completeness, Spec §FR-030; research R8; Tasks T010]
- [x] CHK037 - Is the deletion scope enumerated file-by-file so "fully removed" is verifiable? [Measurability, Spec §FR-027; research R7; Tasks T010/T036]
- [x] CHK038 - Are i18n obligations total (all strings incl. announcer text via the catalog)? [Coverage, Spec §FR-028; research R9; Tasks T011]
- [x] CHK039 - Is the no-demo-data rule carried forward and tied to seeding semantics? [Consistency, Spec §FR-009/SC-003]
- [x] CHK040 - Are open questions isolated with provisional answers rather than silent assumptions? [Assumption, PENDING_REVIEW_QUESTIONS.md PQ-001–PQ-004]

## Notes

- All 40 items pass against the current artifacts. CHK034 is satisfied at the
  research level only — the spotlight-contrast figure lives in research R11,
  not the spec; promote to a spec FR if reviewers want it normative.
- Unattended run: no user questions asked; focus areas taken from the
  invocation (3 layers, a11y, tick/restore semantics), depth Standard,
  audience: reviewer before implementation.
