---
status: applied
applied: 2026-07-15
created: 2026-07-15
change_request: "Apply the approved planner observability UX iterate (docs/research/044-047-planner-observability-ux-iterate.md, PR #819, all five open questions resolved 2026-07-14) to spec 044: three-quantity model, reason-for-zero, table why-glyph, column consolidation/right-sizing, site-context label, #817 detail-graph fix, and mono/OSC single-pass imaging time."
scope: "Feature-wide"
---

## Change Summary

Expose the planner's three already-computed quantities (dark window, target
uptime, imaging time) as distinguishable UI facts, never show an unexplained
zero, consolidate and right-size the planner table columns (sparkline column
removed), fix the #817 graph/metric contradiction, add a persistent
"Computed for" site-context label, and add a camera sensor-type dimension so
OSC single-pass imaging time is computed with strictest-band-wins aggregation.
Presentation-only astronomy: no change to ephemeris math or the Track A rule.

## Implementation Progress

- **Tasks completed**: T001–T035, T037 (36 of 40 total)
- **Tasks remaining**: T017 (wizard prefill from FITS observer), T036
  (react-table wire-up), T038 (verify-on-windows), T039 (SPEC_STATUS row)
- **Current phase**: Phase 9 (Polish & verification) — feature is shipped on
  `main`; this iterate lands on a fresh branch off `origin/main`
  (`docs/planner-obs-iterate-define`), so no branch-diff/adhoc analysis applies
- **Adhoc changes**: None on this branch

## Impact Assessment

| Artifact | Action | Details |
|----------|--------|---------|
| spec.md | Modify + Add | Amend FR-005/FR-007 (three quantities; sparkline column removed; detail-graph overlays); add FR-029–FR-039 (D1–D7); new edge cases; Key Entities (Camera sensor type); SC-014–SC-017 |
| plan.md | Modify | Component/file impact for the new presentation behaviors + equipment field |
| tasks.md | Add | New Phase 10 iterate tasks (T040+); note T036 interaction with the D4 column change |
| data-model.md | Modify | Camera gains `sensorType: 'mono' \| 'osc'` and, for `osc`, `passband: 'rgb' \| narrowband set` |
| research.md | Modify | Reference the approved design doc + its Resolved Questions as the decision record |
| contracts/ | Modify | Equipment/settings contract gains the camera sensor-type + passband fields |

## Risk Checks

- [ ] **Completed tasks ARE affected (by design — acknowledged in review)**:
  the shipped table/detail surfaces from Phases 3/7 (sparkline column,
  visible-tonight column, unconditional green usable fill in
  `TargetDetailV2.tsx`) are deliberately changed/removed by D4/D6. This is the
  point of the iterate, not an accident; the #819 review resolved it.
- [x] No scope boundary violations: Track A (047) rule ownership untouched
  (D7 aggregates Track A's per-band output on the Track B side, exactly the
  FR-022/FR-023 shape); no `min_lunar_separation_deg` revival (rejected in
  four artifacts).
- [ ] **Downstream dependency to sequence**: open task T036 (react-table
  wire-up in `TargetsTable.tsx`) touches the same column definitions D4
  rewrites — sequence the D4 tasks with/after T036 or fold T036 into the
  iterate phase to avoid double rework.

## Planned Changes

### spec.md

- **Amend FR-005**: name the three distinct quantities — (a) astronomical
  darkness window (site+date; existing `night.darkWindow`, FR-015/FR-017),
  (b) target uptime window (above horizon + usable-altitude), (c) imaging
  time = (a) ∩ (b) ∩ per-band moon-viability — and require (a) and (b) be
  exposed as distinguishable UI facts in the detail panel, not just their
  intersection (D1-FR1). No new math.
- **Amend FR-007**: (1) remove the per-row altitude sparkline requirement —
  hard removal of the sparkline column; the detail panel's full altitude
  graph is the canonical altitude view (D4-FR3, resolved Q2); (2) fold the
  dedicated "Visible tonight" column into the imaging-time glyph (a zero row
  already implies not-visible); (3) the detail altitude graph MUST overlay
  twilight/darkness bands, the usable-altitude threshold line, and
  Moon-excluded spans for the displayed band (D6-FR1), keeping FR-007's
  existing automatic band default (most moon-free time — resolved Q3, global
  band picker stays deferred). Survivor columns: Designation, Type, Max alt,
  Opposition, Lunar dist, Filters, Imaging time.
- **Add FR-029 (D2)**: whenever imaging time is 0, state the binding blocker
  — "no astronomical darkness tonight" vs "never above <N>°" vs "Moon too
  close (<band>)" — never a bare 0. Precedence when multiple blockers hold:
  darkness > altitude > moon.
- **Add FR-030 (D3-FR1)**: the table imaging-time cell MUST show, for zero
  values, a warning glyph with reason tooltip: ☀ (darkness), ▲ (altitude),
  ☾ (moon).
- **Add FR-031 (D3-FR2, resolved Q1)**: for non-zero values, a muted ☾ glyph
  only when the Moon is the *actionable* binding limiter — some band's
  moon-viable window strictly smaller than dark ∩ uptime ("any band"
  trigger, no per-user band setting); tooltip names the affected bands;
  per-band truth lives in the detail panel. No glyph when the cap is pure
  darkness/altitude geometry.
- **Add FR-032 (D4-FR1/FR2)**: planner astronomy columns MUST be sized to
  their real content — no clipping of the widest real value (fixes #792
  `.alm-targets-col--opposition` 9% stub width); the imaging-time column
  MUST hold "2h10m" + glyph unclipped.
- **Add FR-033 (D5-FR1/FR2, resolved Q5)**: an always-visible header/toolbar
  label "Computed for: <site> <lat>°N · <twilight definition> · ≥<N>° ·
  change" — disclosing active site, twilight definition (FR-015), and
  minimum-horizon/usable-altitude (FR-018) — with "change" opening the
  existing site/settings switch (FR-012 / US3).
- **Add FR-034 (D6-FR2)**: when no dark window exists, the altitude graph
  MUST NOT render the green usable-altitude fill as if the night were dark —
  shade the whole plot non-dark or grey the fill, so graph and 0-h stat
  agree (the #817 fix).
- **Add FR-035 (D7-FR1)**: the equipment Camera model MUST gain
  `sensorType: 'mono' | 'osc'` and, for `osc`, a passband: `'rgb'` or a
  narrowband set (e.g. Ha+OIII). Exactly these fields; no wider equipment
  redesign.
- **Add FR-036 (D7-FR2/FR3, resolved Q4)**: mono cameras keep the existing
  per-filter model unchanged; OSC single-pass imaging time collapses to one
  window using the strictest (largest) required Moon separation across the
  passband's bands — `max` over bands of Track A's `minSeparationDeg` —
  applied through the existing dark∩uptime∩moon-viable integration. No new
  parameter store; NOT the retired `min_lunar_separation_deg` scalar.
- **Add FR-037 (D7-FR5, resolved Q4)**: for an OSC narrowband passband the
  detail panel MUST additionally list each captured line's own moon-viable
  window (e.g. "Ha 4h · OIII 1h"); the strict single-pass number remains the
  table headline and sort key.
- **Add FR-038 (D7-FR4 + Recommended Defaults)**: when equipment is unset,
  infer sensor type from ingested per-frame FILTER-keyword presence;
  unknown → behave as mono/per-filter (today's behavior) so the change is
  additive and never regresses mono users.
- **Add FR-039**: reason-for-zero, glyph tooltips, and the site-context
  label MUST follow the existing localization approach and remain
  keyboard/screen-reader accessible (glyphs carry text alternatives).
- **Edge cases — add**: simultaneous blockers (no-dark AND never-above)
  resolved by the darkness > altitude > moon precedence; OSC narrowband on a
  moonlit night shows headline 0/low with the per-line breakdown disclosing
  usable Ha time.
- **Key Entities — amend**: Camera (equipment) gains sensor type + passband;
  Planning context notes the displayed-band default is unchanged (FR-007).
- **Success Criteria — add**: SC-014 graph and stat never contradict (no
  green imageable fill with a 0-h stat, #817 repro passes); SC-015 every
  zero imaging-time cell exposes a reason (glyph+tooltip in table, sentence
  in detail); SC-016 survivor columns render unclipped at 1100×720 (#792
  repro passes); SC-017 for an OSC camera the headline equals the
  strictest-band window and the detail lists each line's window.

### plan.md

- Add an "Iterate 2026-07-15 (planner observability UX)" section mapping
  decisions to files: `TargetsTable.tsx` (drop sparkline + visible-tonight
  columns, glyph cell, survivor columns), `merges-3.css:323-355`
  (content-driven widths), `TargetDetailV2.tsx:140-243` (overlays,
  no-dark-window rendering, three-quantity breakdown, OSC per-line list),
  `planner-derive.ts` (expose dark/uptime windows, binding-blocker reason,
  moon-is-actionable-limiter boolean, OSC strictest-band aggregation),
  `astro/moon-avoidance.ts` (consumed verbatim, unchanged),
  `features/settings/Equipment.tsx` + equipment contract/DTO (sensor-type +
  passband fields).
- Note the persistence/contract touchpoint: camera fields flow through the
  settings/equipment contract; schema + generated bindings must be
  regenerated (packages/contracts).

### tasks.md

- Add **Phase 10: Iterate — planner observability UX (2026-07-15)** with
  dependency-ordered tasks (T040+): derive-layer exposure (windows, reason,
  limiter boolean); reason-for-zero + glyph in table; column
  consolidation/right-sizing (sequenced with T036's react-table wire-up);
  site-context label; detail-graph overlay + no-dark rendering; equipment
  sensor-type field end-to-end (contract, settings UI, persistence);
  OSC aggregation + per-line detail; i18n/a11y sweep; regression tests for
  #817/#792 repros; verify-on-windows scenario for the new surfaces.
- Annotate T036: fold into / sequence before the Phase 10 column tasks so
  the column model is rewritten once.
  **Deviation at apply time**: T036 carries a documented deferral assessment
  (react-table swap = risk without user benefit; entangled shared grouping
  engine). That assessment stands — Phase 10 column work stays within the
  existing sort/group engine and T036 remains a separate refactor decision.

### data-model.md

- Camera entity: add `sensorType: 'mono' | 'osc'` (default inferred/unknown
  → mono behavior) and `passband: 'rgb' | NarrowbandSet` (OSC only).

### research.md

- Add a pointer to `docs/research/044-047-planner-observability-ux-iterate.md`
  (approved 2026-07-14, PR #819) as the decision record for D1–D7 and the
  five resolved questions; reiterate the `min_lunar_separation_deg` rejection.

### quickstart.md / checklists

- (No quickstart in this spec dir.) If a checklist is added during apply,
  include the #817 and #792 repro checks and the 1100×720 no-clipping check.
