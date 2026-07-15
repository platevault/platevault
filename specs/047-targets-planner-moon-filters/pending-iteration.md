---
status: pending
created: 2026-07-15
change_request: "Apply the approved planner observability UX iterate (docs/research/044-047-planner-observability-ux-iterate.md, PR #819, all five open questions resolved 2026-07-14) to spec 047: retire the vestigial Track-B placeholder-integrity requirement, record that rule consumers may aggregate per-band minima across an OSC passband, and note the opposition column right-sizing (#792)."
scope: "Feature-wide"
---

## Change Summary

Track A's rule, parameters, pills, and opposition math are untouched. This
iteration retires FR-015/FR-016's now-vestigial "placeholder columns must
remain in place until Track B lands" language (Track B shipped, and the 044
iterate removes the sparkline and visible-tonight columns outright), records
the ownership-preserving OSC aggregation contract (consumers take a max of
`minSeparationDeg` across a passband — no new parameters), and notes the
opposition column's content-driven right-sizing (#792).

## Implementation Progress

- **Tasks completed**: T001–T027 (28 of 29 total)
- **Tasks remaining**: T028 (verify-on-windows scenario)
- **Current phase**: Phase 7 (Polish & cross-cutting) — feature is shipped on
  `main`; this iterate lands on `docs/planner-obs-iterate-define` off
  `origin/main`, so no branch-diff/adhoc analysis applies
- **Adhoc changes**: None on this branch

## Impact Assessment

| Artifact | Action | Details |
|----------|--------|---------|
| spec.md | Modify + Add | Supersede FR-015/FR-016's placeholder-integrity clause; add FR-020 (passband aggregation by consumers); annotate FR-014 (column right-sized, sort unchanged) |
| plan.md | Modify | One-line note referencing the iterate decision record |
| tasks.md | No change | No Track-A-side implementation work — all D1–D7 execution is Track B (spec 044) |
| data-model.md | No change | Rule/parameter model untouched |
| checklists/requirements.md | No change | Its FR-015 mention is a historical boundary note, still accurate |

## Risk Checks

- [x] No completed tasks invalidated: pills, parameters table, moon summary,
  lunar-distance and opposition math/sort all unchanged.
- [x] No scope boundary violations: 047 keeps sole ownership of the
  Lorentzian rule and per-band parameters; the OSC aggregation is a
  consumer-side max over the rule's existing per-band output (exactly the
  FR-022/FR-023 shape in spec 044); explicitly NOT a
  `min_lunar_separation_deg` revival (rejected in research.md:106,
  plan.md:260, contracts/settings.plannerMoonAvoidance.md:66).
- [x] No downstream dependency breaks: FR-014's sortable opposition column
  survives the 044 column consolidation (resolved Q2 keeps Opposition and
  Max-alt in the table), so SC-003 needs no new access point.

## Planned Changes

### spec.md

- **Amend FR-015**: mark the placeholder-integrity clause superseded as of
  this iteration — Track B (spec 044) shipped real values for max altitude,
  imaging time, and visible-tonight, and the 044 observability iterate
  (D4-FR3, resolved Q2) removes the per-row altitude sparkline column and
  folds visible-tonight into the imaging-time glyph. The "MUST remain in
  place ... unchanged in behavior" obligation no longer binds; Track A still
  MUST NOT use observer location.
- **Amend FR-016**: note the usable-altitude threshold has carried over to
  Track B as planned (obligation fulfilled; historical).
- **Add FR-020**: rule consumers MAY aggregate the per-band required
  separations across an OSC passband by taking the strictest (maximum)
  `minSeparationDeg` over the passband's bands for a given Moon age
  (044 D7-FR3). The aggregation lives on the consumer (Track B) side; 047's
  rule, parameters, defaults, and pills are unchanged, and no scalar
  aggregate parameter is introduced.
- **Annotate FR-014**: the opposition column is retained in the consolidated
  044 table and MUST be sized to its real content ("14 Apr · in 9 months")
  per 044's content-driven sizing requirement — closing #792; soonest-next
  sort semantics (SC-003) unchanged.

### plan.md

- Add a one-line iterate note pointing to
  `docs/research/044-047-planner-observability-ux-iterate.md` (approved
  2026-07-14, PR #819) and restating that all implementation lands under
  spec 044's Phase 10.

### tasks.md

- (No new tasks — Track A has no implementation work in this iterate; T028
  remains the only open task.)

### data-model.md

- (No changes.)

### checklists/requirements.md

- (No changes — its FR-015..FR-017 mention describes the historical track
  boundary, which remains accurate.)
