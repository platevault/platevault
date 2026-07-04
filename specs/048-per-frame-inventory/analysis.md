# Specification Analysis Report: 048-per-frame-inventory

**Date**: 2026-07-04 | **Artifacts**: spec.md, plan.md, tasks.md (+research/data-model/contracts) | **Mode**: read-only cross-artifact analysis

## Findings

| ID | Category | Severity | Location | Summary | Recommendation |
|----|----------|----------|----------|---------|----------------|
| G1 | Coverage Gap | MEDIUM | SC-005 / tasks.md | SC-005 (reconcile ≥10k frames non-blocking + progress) implemented by T020/T022 but no dedicated verification task | **Fixed**: added T043a large-root performance verification task |
| I1 | Inconsistency | LOW | spec.md vs data-model.md | Spec uses user-facing states present/missing/recovered; `file_record.state` enum is observed/changed/classified/missing/rejected/protected (data-model maps present→classified) | Keep; implement per the data-model mapping |
| C1 | Terminology | LOW | contracts/operations.md | `inventory.frame.list` returns a user-facing state subset (present/missing/protected) | Add state-mapping note at implementation |
| U1 | Underspecification | LOW | FR-005 | "Sessions stay derived (no lifecycle)" is an invariant with no guarding task | Acceptable non-action constraint; honored by T012/T014 |
| S1 | Style | LOW | FR-012a | Non-standard requirement id inserted rather than renumbering | Cosmetic; left to avoid churn |

## Coverage summary

- Requirement keys: 26 FR + 6 SC = 32.
- FR coverage: **100%** (every FR → ≥1 task).
- Buildable SC coverage: SC-001..004, SC-006 have impl+test tasks; SC-005 impl-only → **G1 fixed** (T043a).
- Ambiguity: 0. Duplication: 0. Critical: 0. High: 0.

## Constitution alignment

No conflicts. All 5 principles PASS (custody, reviewable mutation, PixInsight boundary, research-led, portable contracts). Reconciliation-never-mutates-files is asserted by tests (T016/T021).

## Verdict

**Ready to implement.** No CRITICAL/HIGH issues. The one MEDIUM (G1) is resolved by adding a verification task. LOW items are implementer notes, not blockers.
