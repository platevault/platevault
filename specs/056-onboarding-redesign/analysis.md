# Specification Analysis Report: Onboarding Redesign (Spec 056)

**Date**: 2026-07-18 | **Mode**: unattended (findings resolved from the
approved decision record where possible; unresolved → PENDING_REVIEW_QUESTIONS.md)
**Artifacts**: spec.md, plan.md, tasks.md, research.md, data-model.md,
contracts/onboarding-commands.md, quickstart.md

## Findings

| ID | Category | Severity | Location(s) | Summary | Recommendation |
|----|----------|----------|-------------|---------|----------------|
| U1 | Underspecification | MEDIUM | spec.md §FR-015/FR-021; research R5 | Recovery for a milestone event MISSED by the subscriber (e.g. published during startup before subscription, or process kill between action and write) is not specified; seed/restore self-heals only when the user runs restore. | Accepted as v1 limitation with provisional answer — see PQ-005. Implementation should start the subscriber before the UI can trigger use cases (tasks.md T006 wiring note). |
| U2 | Underspecification | LOW | research R4; tasks T004 | `tool.launch` payload field `outcome == "spawned"` is taken from the decision record; the payload shape was not re-verified against `tool_launch.rs` during research. | Verify field name at T004 implementation; registry unit test pins it. |
| A1 | Ambiguity | LOW | spec.md §SC-006 | "Locate ... in under 10 seconds" is a usability metric not directly automatable; the automatable half (dismissal paths, no timer) is separately stated. | Keep; treat the 10 s figure as a UX design target validated via journey review, not CI. |
| A2 | Ambiguity | LOW | tasks T016/T021/T025/T028/T031 | Playwright spec file locations are given as the mock-suite home rather than exact filenames. | Acceptable — filenames are implementer's choice; harness conventions referenced. |
| C1 | Inconsistency | LOW | spec.md (passim), plan.md | Capitalization drift: "Getting started" vs "Getting Started". | Cosmetic; canonical UI string lives in Paraglide catalog (FR-028) — decide there. |
| C2 | Inconsistency | LOW | research R11 vs spec | Spotlight target contrast (≥3:1 against dimmed field) is normative only in research.md; spec FR-025 stays silent (flagged as checklist CHK034). | Promote to a spec FR only if reviewers want it testable at spec level; otherwise R11 binds implementation via tasks T026. |
| D1 | Dependency | MEDIUM | spec VC-001/VC-005; tasks T033 | J18 journey and the coverage-matrix row are owned by a different lane; 056 "done" depends on cross-lane delivery. | Already explicit in T033 (verify-they-exist gate). Orchestrator sequencing risk only. |

No CRITICAL or HIGH findings. No duplications detected. No unresolved
placeholders (TODO/TKTK/???) in any artifact.

## Coverage Summary

All 31 functional requirements map to ≥1 task; spot list of the load-bearing
mappings (full inventory omitted — 100% coverage):

| Requirement Key | Has Task? | Task IDs | Notes |
|-----------------|-----------|----------|-------|
| FR-001–FR-005 (L1 walk) | ✓ | T012–T016 | US1 phase |
| FR-006–FR-014, FR-031 (L2) | ✓ | T004, T017–T021, T029–T031 | US2/US5 phases |
| FR-015–FR-021 (ticks) | ✓ | T003–T006, T022–T025 | US3 + foundations |
| FR-022–FR-026 (L3) | ✓ | T010, T026–T028 | US4 phase; anchor dedupe in T010 |
| FR-027 (deletion) | ✓ | T010, T036 | verifiable via T036 rg sweep |
| FR-028 (i18n) | ✓ | T011 | |
| FR-029 (a11y) | ✓ | T009, T013, T035 | |
| FR-030 (suppression) | ✓ | T008, T010 | atomic with deletion |
| FR-009 (no demo data) | ✓ | T004, T023 | enforced by seed derivation tests (SC-003) |
| SC-002 (2 s tick) | ✓ | T022, T032 | Layer-1 + Layer-2 |
| VC-001–VC-005 | ✓ | T016/T021/T025/T028/T031 (VC-002), T022/T023 (VC-003), T032 (VC-004), T033 (VC-001/VC-005) | mock-mode auto-tick limit documented |

**Unmapped tasks**: none — T034 (follow-up issues) traces to FR-015's
"missing milestones are follow-ups"; T036 traces to FR-027 and the repo gate
rules.

## Constitution Alignment

No violations. §III boundary respected (tool items observe launches only);
§IV satisfied by verified event inventory (research R4) and the recorded
faceoff/spike evidence (R1/R2); §V satisfied by the language-neutral contract
delta. The deliberate modal-walk exception is documented in plan.md
(Constitution Check) and spec FR-002 — an exception record, not a violation.

## Metrics

- Total requirements: 31 FR + 6 SC + 5 VC
- Total tasks: 36
- Coverage: 100% (every FR has ≥1 task)
- Ambiguity count: 2 (both LOW)
- Duplication count: 0
- Critical issues: 0

## Next Actions

- No CRITICAL/HIGH blockers — proceed toward implementation once the
  orchestrator's critique/security-review lanes (if scheduled) complete.
- PQ-005 (missed-event recovery) awaits user review; provisional answer is
  encoded and non-blocking.
- Optional polish: settle C1 capitalization when authoring Paraglide keys
  (T011); decide C2 promotion during review.
