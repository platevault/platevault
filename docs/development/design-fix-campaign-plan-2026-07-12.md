# Design-review fix campaign — DAG plan (draft for review)

Drafted 2026-07-12. Source: docs/development/design-review-2026-07-11.md (report + 2 addenda),
open issues #552–#670. No coders dispatched; this is the reviewable plan.

## Gates (before any coder)

- **G0 — design-sync stack decision.** PR #495 (`chore/design-sync-platevault` → main, sync inputs)
  is open; PR #530 (`design-system-fixes`, a11y/overlays/skeletons/Table, 6 commits 2026-07-09)
  is stacked on it. Land #495 then #530 (auto-retarget), or retarget #530 to main (folds both),
  or abandon. **Blocks T4, C1, C2** (overlay/primitives/skeleton file overlap).
  - **G0.1 — post-merge re-triage.** The discovery sweeps ran on `8097d9c6`, which PREDATES #530's
    fixes. After #530 lands, re-check on a fresh build whether it already resolves any of:
    #640 (ConfirmOverlay styling), #628 (disabled styling), #616 (control heights), #620 partial.
    Close what's fixed before dispatching those nodes.
- **G1 — lane sync.** `orch/adopt-target-match` (+ skymath 0.3 adoption) is active in another
  session and owns Targets-adjacent surfaces + verify issues #633–#635. Confirm closed/coordinated
  before dispatching C3, and before touching Targets ephemeris code (#579/#580 also gated on the
  #596 design decision).

## Excluded from this campaign (separate lanes)

- TanStack Query migration: #608 #610 #613 #615 #630 (own handover: astro-plan__tanstack-query-migration.md).
  Coordinate: #658 (list refresh) and #643 (metadata load) sit next to its territory.
- #633–#635 target-match real-app verify (other session), #596 ephemeris design decision.
- #575 / #577 (spec 025 resume-executor) — product decision pending with user.

## Wave 1 — Trust + shared infra

| Node | Issues | Scope (files) | Size | Deps |
|---|---|---|---|---|
| W1-infra feedback toasts | #604 | ToastContainer + toast variants; wire success+navigate on apply/confirm/create/register sites | M | — |
| W1-wizard truth | #599 #612 #614 | StepCalibration.tsx, StepReview.tsx, WizardPage.tsx, TargetDetailV2 handoff | L | — |
| W1-advanced truth | #601 #602 | Advanced.tsx, en.json; NEW real db-stats command (app/core + persistence + contracts + bindings) | M | — |
| W1-overlay unify | #606 #607 #609 | PlanApprovalOverlay + PlanReviewOverlay → one component; usePlanApplyProgress keep item_failed; From→To columns | L | **G0** |
| W1-runtime stability | #557 #573 | Inbox render loop; Targets catalog load off main path | L (risky) | isolate worktree |

## Wave 2 — Feedback + P1 correctness

| Node | Issues | Scope | Size | Deps |
|---|---|---|---|---|
| W2-refusals | #600 #603 | Lifecycle refusal reasons → UI banner/toast; empty-plan diagnostics | M | W1-infra |
| W2-confirm pipeline | #605 + land-in-project | Inbox confirm→apply single visible flow; wizard → project detail landing | M | W1-infra, W1-wizard |
| W2-inbox state | #643 #644 #648 #649 #653 #552 #569 | Inbox selection identity, metadata gate, dest-root leak, sort, counts, split preview | L | coordinate TanStack lane |
| W2-bulk guard | #611 | Reclassify heterogeneity warning + undo/reset-to-detected | S | — |
| W2-calibration detail | #642 #664 | MasterDetail onClick handlers; readiness code mapping | M | — |
| W2-settings contract | #639 #641 #645 #646 #623 #624 | Settings scope_keys/persistence integrity; dedupe scan stores; prune orphaned keys | L | — |

## Wave 3 — Consistency (post-G0/G0.1)

| Node | Issues | Scope | Size | Deps |
|---|---|---|---|---|
| W3-control metrics | #616 #587 #627 #628 | --alm-control-h, row rhythm on --alm-row-height, delete accent variant, disabled styling | M | G0.1 |
| W3-palette+dialogs | #581 #617 #640 | Palette CSS + matching + keyboard nav; dead routes; ConfirmOverlay styling (if not fixed by #530) | M | G0.1 |
| W3-targets chrome | #618 #574 #625 | Targets header collapse; count labels; status-bar vocabulary + IMAGETYP normalize | M | G1 |
| W3-cosmetics | #631 #670 #585 | Typography floor, format drift, enum chips, plurals, beacon removal | S | — |

## Wave 4 — Panels + data integrity

| Node | Issues | Scope | Size | Deps |
|---|---|---|---|---|
| W4-panel delta | #619 #620 #621 #622 #554 #555 #556 #568 | Detail-as-delta, unresolved chips vs fake zeros, CoverageBar units, dead columns, inbox/session detail restructure | L | W3-control metrics |
| W4-sessions integrity | #564 #654 #650 #651 #652 #663 #567 | Session identity fallback, counts, links, reveal-correct-folder, humanize UUIDs | L | — |
| W4-log activity | #582 #583 #666 #667 #668 #669 #626 | Severity floor, richer lines, filter UI, export title, event flooding, entity links, empty states | M | — |
| W4-archive audit | #629 #647 | Archive detail dedupe + outcome/actor; EventBus→durable audit coverage | M | — |

## Wave 5 — Settings UX + backend odds

| Node | Issues | Scope | Size | Deps |
|---|---|---|---|---|
| W5-settings ux | #655 #656 #657 #659 #661 #662 #584 | Naming preview casing, tool re-enable, protection revert, equipment dupes, error text, manual path entry, toggle flash | L | W2-settings contract |
| W5-manifests | #665 | Wire Created/SourceChange/LifecycleTransition manifest subscribers | M | — |
| W5-data sources | #559 #560 #562 #563 | Delete action, remap verify sampling, kebab consolidation, protection get/set consistency | M | — |
| W5-guided dedup | #586 | Guided flow reuses CreateProjectDialog validation | S | W1-wizard |

## Ordering / parallelism notes

- Within a wave, nodes are file-scope disjoint → parallel worktree coders.
- W1 can start immediately except W1-overlay (G0). W2 starts as W1 nodes merge (pipeline, no barrier).
- Every node: worktree coder → reviewer → CI-green PR → gatekeeper FCFS merge (standard orchestrate roles).
- Verification: each fix node cites its issue's repro; real-app verify batch on Windows per wave
  (verify-on-windows scenarios), not per PR.
- Journey contracts in docs/product/user-journeys.md are the acceptance oracle for W1/W2 nodes.
