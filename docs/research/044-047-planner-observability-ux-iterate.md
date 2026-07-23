# Planner Observability UX Iterate — 044 (Track B) / 047 (Track A)

**Status**: Approved (design reviewed 2026-07-14; all open questions
resolved — see Resolved Questions below). Not an implementation plan.
**Date**: 2026-07-14
**Scope**: presentation of already-correct astronomy, plus one equipment field
and one aggregation function. No change to ephemeris math, the shared
Moon-avoidance rule, or either spec's ownership boundary.

## Context & Problem

Spec 044 (Track B, `specs/044-targets-planner-astronomy/spec.md`) computes
per-site, per-date observability — altitude samples, transit/rise/set, dark
window, Moon geometry, band-free total imaging time, and per-band moon-free
time via `apps/desktop/src/features/targets/planner-derive.ts`. Spec 047
(Track A, `specs/047-targets-planner-moon-filters/spec.md`) owns the
per-band Lorentzian Moon-avoidance rule and its tunable `(distanceDeg,
widthDays)` parameters (`apps/desktop/src/features/targets/astro/moon-avoidance.ts`)
plus Moon phase/illumination and the opposition/best-date search
(`apps/desktop/src/features/targets/astro/opposition.ts`, reused by Track B's
`bestDate` per `planner-derive.ts:22-25`).

**Verified baseline**: the astronomy is correct. Independently cross-checked
(app astronomy-engine, skyfield/DE421, and Telescopius all agree): at
52.09°N on 2026-07-14, the Sun bottoms at −16.4° and astronomical darkness
(−18°) is never reached, so M31 correctly shows 0 imaging minutes even
though its transit altitude is 73°. This is documented in issue #817's
verification section and is the load-bearing fact behind this whole
iterate — **the defect is presentational, not computational**. Four
presentation problems compound on top of that correct math:

1. **Graph/metric contradiction (#817)**: `TargetDetailV2.tsx:177-197`
   renders the twilight (not-dark) shading only when `darkWindowHours` is
   non-null — the no-dark-window case is exactly when that shading is
   *omitted*. The unconditional green usable-altitude `Threshold` fill at
   `TargetDetailV2.tsx:199-211` then paints the full above-30° portion of
   the curve as if it were imageable, while the stat row reads "Img time
   0.0 h" and only an out-of-graph banner (`:769-772`,
   `m.targets_table_no_dark_window_title()`) discloses the truth.
2. **Column clipping (#792)**: `.alm-targets-col--opposition { width: 9%; }`
   (`merges-3.css:338`) is sized for the old stub dash, not the real
   `formatOppositionDate` + `oppositionRelative` value ("14 Apr · in 9
   months") it has carried since spec 047 shipped; the cell clips at
   1100×720 with no recoverable tooltip (its `title` is the static label,
   not the value).
3. **Detail-pane clipping (#816)**: `.alm-detail.alm-detail--fill` has
   `overflow: hidden` and no internal scroll region, so content below the
   altitude graph (coverage note, linked projects, alias editor, notes) is
   unreachable at typical viewport heights. Not part of the 7 decisions
   below (it is a layout-contract bug, not an astronomy-presentation one)
   but referenced because it bounds how much the detail panel can absorb
   from table-column consolidation (Decision 4).
4. **Popover clipping (#815)**: the add-target search dropdown is clipped
   by `.alm-modal__body`'s `overflow: auto` boundary. Referenced for the
   same reason as #816 — an existing clipping-class bug in the surrounding
   chrome, not something this iterate fixes, but it means "make room in a
   panel" fixes must be checked against overflow contracts, not assumed
   safe by default.

Today the planner also collapses three physically distinct quantities into
one number ("imaging time"), which is what makes the #817 contradiction
possible in the first place, and it has no dimension for OSC (one-shot-color)
cameras — every moon-free-time calculation implicitly assumes mono
per-filter imaging.

## Decisions

Each decision is written as FR-style bullets against the existing 044/047
requirement numbering, since this is an iterate on both specs' surfaces, not
a new spec.

### D1 — Three distinct quantities, shown separately

- **D1-FR1**: The planner MUST distinguish, per target/site/date: (a) the
  **astronomical darkness window** (function of site+date only: Sun below
  the site's configured twilight depression — this is exactly Track B's
  existing `night.darkWindow`, FR-015/FR-017 of spec 044); (b) the **target
  uptime window** (function of target+site+date: above horizon +
  usable-altitude offset — the existing per-sample `altDeg >= usableAltitudeDeg`
  test in `planner-derive.ts:220-227`); (c) **imaging time**, defined as the
  intersection of (a) ∩ (b) ∩ per-band moon-viability — which is exactly
  what `totalImagingMinutes` (band-free) and `moonFreeMinutesByBand` already
  compute (`planner-derive.ts:214-227`, `:159-184`). No new math: this
  decision is about exposing the two already-computed intermediate windows
  (dark window, uptime window) as distinguishable UI facts, not just their
  intersection.
- **Rationale**: #817 exists precisely because "imaging time" quietly means
  "the intersection," and the UI shows uptime-window geometry (the green
  fill) without labeling it as such. Naming the three quantities separately
  is what makes a reason-for-zero (D2) expressible at all.
- **Tradeoff**: more surface area (three concepts vs one number) risks
  overwhelming a table row; mitigated by keeping the *table* headline metric
  as imaging time alone (D3/D4) and pushing the three-way breakdown to the
  detail panel (D6).

### D2 — Reason-for-zero, never a bare 0

- **D2-FR1**: Whenever imaging time is 0 for a target/site/date, the UI
  MUST state the binding blocker rather than showing an unexplained zero:
  "no astronomical darkness tonight" (dark window is null/empty — FR-017)
  vs "never above `<N>`°" (uptime window is empty — target never clears
  the usable-altitude/horizon threshold) vs "Moon too close (`<band>`)"
  (dark ∩ uptime is non-empty but every band's moon-viable window is empty).
- **Rationale**: this is the direct fix for the user-facing half of #817 —
  a bare 0 is indistinguishable from a bug; a stated reason is not.
- **Tradeoff**: requires picking exactly one "the" reason when multiple
  blockers overlap (e.g., no dark window AND never above threshold can both
  be true in the same high-latitude summer case) — precedence is fixed in
  Recommended Defaults (darkness > altitude > moon).

### D3 — Table why-glyph (narrow columns)

- **D3-FR1**: In the planner table's imaging-time cell, a **zero** value
  MUST show a warning glyph with a reason tooltip: ☀ (darkness), ▲
  (altitude), or ☾ (moon) — the same three reasons as D2.
- **D3-FR2**: A **non-zero** value MUST show the ☾ glyph (muted) only when
  the Moon is the *actionable* binding limiter — i.e., some band's
  moon-viable window is strictly smaller than dark ∩ uptime for that
  target/night ("more on a darker night" is actionable: wait for a
  different Moon phase). When imaging time is capped purely by darkness/
  altitude geometry (dark ∩ uptime already the limiting factor, Moon not
  cutting further), NO glyph is shown — that cap is just geometry the user
  cannot act on tonight.
- **Rationale**: the glyph is a scannability device for a narrow table
  column; it must mark "you can do something about this" not "here is
  every fact about this cell." The full three-way breakdown (D1) belongs in
  the detail panel (D6), not fought into a narrow column.
- **Tradeoff**: this is a judgment call requiring one more derived boolean
  (is Moon *the* limiter, vs merely *a* limiter) beyond what
  `moonFreeMinutesByBand` currently exposes directly — see Recommended
  Defaults.

### D4 — Right-sized + consolidated planner columns

- **D4-FR1**: Planner astronomy columns MUST be sized to their real content
  (fit the widest real value, no clipping) rather than carrying widths sized
  for retired stub content. This directly fixes #792 (`.alm-targets-col--opposition`
  frozen at the old "—" stub's 9%, per `merges-3.css:338`).
- **D4-FR2**: The imaging-time column (`.alm-targets-col--imagingtime`,
  currently 7.5% per `merges-3.css:355`) MUST be widened to hold a value
  like "2h10m" plus the D3 glyph without clipping.
- **D4-FR3** *(revised per review)*: The ~7 astronomy columns currently in
  the table (`TargetsTable.tsx:12-13`: Max alt, sparkline, Visible tonight,
  Opposition, Lunar dist, Filters, Imaging time) MUST be consolidated by
  dropping the **altitude sparkline** column (hard removal — the detail
  panel's full altitude graph, upgraded by D6, is the canonical altitude
  view; a per-row thumbnail duplicates it at unreadable size) and folding
  "Visible tonight" into the D3 glyph (a zero-imaging-time row already
  implies not-visible; a dedicated column is redundant once the glyph
  exists). Survivors — Designation, Type, Max alt, Opposition, Lunar dist,
  Filters, Imaging time — keep their columns, right-sized per D4-FR1/FR2
  with the width reclaimed from the sparkline.
- **Rationale**: #792 is a direct instance of "column never revisited once
  real data replaced a stub" — the general fix is content-driven sizing,
  not a one-off width bump for the Opposition column alone. Consolidation
  is necessary because content-right-sizing seven columns without dropping
  any would still not fit at common desktop widths (confirmed narrow at
  1100×720 per the #792 repro). Review chose the sparkline (the widest
  column, and informationally redundant with the detail graph) as the drop
  over the originally proposed Opposition/Max-alt move, which would have
  cost at-a-glance sortable scanning of both values across the catalogue.
- **Tradeoff**: none of substance remains — Opposition and Max-alt stay
  sortable in place (spec 047 FR-014 / SC-003 and spec 044 max-alt
  behaviors unaffected), and no column-visibility-toggle machinery is
  needed. Verify the survivor set fits without clipping at 1100×720.

### D5 — Prominent + editable active site

- **D5-FR1**: The planner table's header/toolbar MUST show "Computed for:
  `<site name>` `<lat>`°N · change" in one always-visible place, with
  "change" opening the active-site switch (existing US3 site-switching from
  spec 044 FR-012).
- **D5-FR2** *(added per review)*: The label MUST also disclose the two
  settings that silently change imaging time besides location: the active
  twilight definition (astronomical/nautical, spec 044 FR-015) and the
  minimum-horizon / usable-altitude value (FR-018) — e.g. "Computed for:
  `<site>` `<lat>`°N · astro twilight · ≥30° · change", with "change"
  covering all of them.
- **Rationale**: spec 044 already requires switching sites to recompute
  everything (FR-012, SC-005) and the wizard seeds a default site (US6,
  e.g. "Home Backyard" 52.09°N — the exact site in the #817 repro). Without
  a persistent on-screen label, a user comparing planner numbers against a
  tool set to *their own* location (as happened in the #817 investigation)
  has no way to notice the mismatch is a site setting, not a bug.
- **Tradeoff**: consumes toolbar space already crowded by catalogue/group-by
  controls (`TargetsTable.tsx:68`); needs a compact, single-line treatment.

### D6 — Detail graph fix (#817)

- **D6-FR1**: The altitude graph (`TargetDetailV2.tsx`'s `AltitudeGraph`)
  MUST overlay: the twilight/darkness bands, the usable-altitude threshold
  line (already present, `:213-222`), and Moon-excluded spans for the
  displayed band — all already computed by `planner-derive.ts`/
  `planner-astronomy.ts`, so this is a rendering change over existing
  values, not new math.
- **D6-FR2**: When there is no dark window at all, the graph MUST NOT render
  the unconditional green usable-area fill as if the night were dark — it
  MUST either shade the entire plot as non-dark or grey the usable-altitude
  fill, so the graph agrees with a 0 imaging-time stat instead of
  contradicting it.
- **Rationale**: this is the exact, scoped fix for #817's root cause
  (`TargetDetailV2.tsx:177-197` omits twilight shading exactly when it's
  most needed; `:199-211`'s `Threshold` fill is unconditional). No new
  computation — `darkWindowHours == null` is already available as the
  branch condition; the fix is what each branch renders.
- **Tradeoff**: none identified beyond implementation care in the SVG
  layering (twilight shading must not visually override the Moon-excluded
  overlay or the transit marker).

### D7 — Mono vs OSC single-pass imaging time

- **D7-FR1**: The equipment model MUST gain a camera **sensor-type**
  dimension: `sensorType: 'mono' | 'osc'`, and for `osc`, a **passband**:
  either `'rgb'` (a plain color camera) or a narrowband set (dual/tri-band
  filter, e.g. Ha+OIII). `apps/desktop/src/features/settings/Equipment.tsx:12-13`
  documents today's `Camera` DTO as `{ id, name, aliases, autoDetected }`
  with **no sensor, color, or mono field at all** — this is a real gap, not
  a refinement of an existing field.
- **D7-FR2**: For **mono** cameras, per-filter moon-free windows are
  unchanged (the current LRGB/Ha/SII/OIII model in
  `moonFreeMinutesByBand`, `planner-derive.ts:159-184`).
- **D7-FR3**: For **OSC single-pass** imaging (one exposure captures every
  band in the passband simultaneously), imaging time MUST collapse to **one
  window**: the intersection using the **strictest** (largest) required
  Moon separation across the passband's bands — i.e.
  `effective_min_sep(age) = max over band in passband of minSeparationDeg(band, age, params)`
  — because viability must satisfy every captured band simultaneously, so
  the smallest (most restrictive) resulting window is the correct one.
  This reuses `minSeparationDeg` from `astro/moon-avoidance.ts` verbatim
  per band, then takes a max across the passband before applying the
  existing dark∩uptime∩moon-viable intersection loop
  (`planner-derive.ts:159-184`) — no new parameter store, no new Lorentzian
  math, and explicitly NOT the retired `min_lunar_separation_deg` scalar
  (dead per `moon-avoidance.ts:11-12`, `specs/044-targets-planner-astronomy/research.md:106`,
  `specs/047-targets-planner-moon-filters/plan.md:260`, and
  `specs/047-targets-planner-moon-filters/contracts/settings.plannerMoonAvoidance.md:66`
  — all four independently confirm this exact scalar is a dead-end that
  keeps getting proposed and rejected).
- **D7-FR4**: When equipment is unset, the default inference is: a single
  OSC-style exposure with no filter wheel → single-pass; per-filter subs →
  per-filter (mono model, unchanged).
- **D7-FR5** *(added per review)*: For an OSC narrowband passband, the
  **detail panel** MUST additionally list each captured line's own
  moon-viable window (e.g. "Ha 4h · OIII 1h"), mirroring the mono per-band
  display (D1/D3 resolution). The strict single-pass number (D7-FR3)
  remains the table headline; the per-line breakdown discloses that a
  moonlit night may still yield usable data on the tolerant line (the
  common "shoot dual-band through moonlight, keep the Ha" workflow),
  without breaking the one-number table cell or sort semantics.
- **Rationale**: today's model implicitly assumes every imager is mono
  with a filter wheel; an OSC/DSLR imager's single sub is bound by
  whichever of its passband's channels is least Moon-tolerant, not by an
  average or by treating each channel as independently schedulable (they
  are captured in the same exposure). Reusing the existing per-band
  Lorentzian avoids forking tolerances (constitution-adjacent constraint:
  047 owns the rule; this decision is Track-B-side aggregation over
  Track-A's existing per-band output, exactly the shape FR-022/FR-023
  already describe).
- **Tradeoff**: the "max across passband" rule is a genuine product choice
  (vs., e.g., a weighted/average rule) — flagged as an explicit design
  decision here rather than an emergent implementation detail, precisely
  because it changes which nights read as usable for OSC users.

## Recommended Defaults

- D2/D3 reason precedence when multiple blockers are simultaneously true
  (e.g., no dark window AND never above threshold): darkness > altitude >
  moon, i.e. report the "most upstream" structural blocker first (a target
  that's also too low is moot if there's no dark window at all tonight).
- D3's "Moon is the actionable limiter" test: `moonFreeMinutes[bestBand] <
  totalImagingMinutes` for at least one band the user cares about (or,
  absent a per-user "preferred band" setting, any band) — i.e. show the
  glyph whenever Track A's rule is cutting into the band-free total for
  *some* band, muted, so it reads as "worth checking a darker night," not
  as an error.
- D4: Opposition and Max-alt keep their columns (revised D4-FR3), so spec
  047's SC-003 (sortable, soonest-next) and spec 044's max-alt sort need no
  new access point; the only removed data views are the sparkline (canonical
  altitude view = detail graph) and the redundant Visible-tonight column.
- D7 default sensor type when nothing is configured: infer from the
  existing per-frame FILTER header presence in ingested sessions (mono
  workflows populate a `FILTER` keyword per sub; OSC/DSLR workflows
  typically don't) rather than forcing a wizard step; treat as "unknown →
  behave as mono/per-filter" (today's existing behavior) until equipment or
  ingested metadata says otherwise, so this is additive and never regresses
  current mono users.

## Out of Scope / Non-Goals

- **Real ephemeris correctness** — already done and independently verified
  (see baseline above); this iterate touches no astronomy math in
  `planner-astronomy.ts`, `opposition.ts`, or the Lorentzian rule itself.
- **Any new parameter store or a `min_lunar_separation_deg`-style scalar**
  — explicitly rejected three times already across 044/047 artifacts (see
  D7-FR3 citations); this iterate must not reintroduce it under a new name.
- **#816 (detail-pane overflow) and #815 (add-target popover clipping)** —
  real bugs, referenced for context (they bound how much content the detail
  panel in D6/D4 can safely absorb) but are layout-contract defects outside
  this iterate's astronomy-presentation scope; they should be fixed on
  their own tracks.
- **Fixing every equipment gap** — D7 adds exactly one field
  (`sensorType`) and one passband field for OSC; it does not redesign the
  Camera/Equipment data model beyond that.
- **A user-facing "preferred band" setting** — referenced only as an
  option in Recommended Defaults' D3 tie-break; not required by this
  proposal.
- **Changing which twilight/horizon definitions exist** — spec 044's
  astronomical/nautical twilight choice (FR-015) and minimum-horizon model
  (FR-018) are consumed as-is.

## Resolved Questions (user review, 2026-07-14)

1. **D3 glyph band — resolved: any band, no per-user setting.** The table's
   single imaging-time cell shows the muted ☾ whenever the Moon cuts *any*
   band's window (the Recommended Defaults tie-break is now the decision);
   the tooltip names the affected bands, and the per-band truth ("Ha fine,
   OIII moon-cut") lives in the detail panel's per-band imaging-time
   breakdown (D1). No "my band" user setting.
2. **D4 columns — resolved: keep Opposition and Max-alt, drop the sparkline
   instead.** The original move-to-detail proposal is withdrawn; the
   sparkline column is a hard removal (the D6-upgraded detail graph is the
   canonical altitude view) and Visible-tonight folds into the glyph as
   proposed. No column-visibility toggle; D4-FR3 above is rewritten
   accordingly.
3. **D6 overlay band — resolved: keep spec 044 FR-007's automatic default**
   (band with the most moon-free time). The deferred global band picker
   stays deferred; it can be added later if users ask for it.
4. **D7 OSC aggregation — resolved: strict headline + per-line detail.**
   The single-pass headline number stays strictest-band-wins (D7-FR3), and
   the detail panel additionally lists each captured line's own moon-viable
   window (new D7-FR5) so a moonlit night's usable Ha time is visible
   instead of a bare 0. Separate per-line windows as the *primary* model
   were rejected (breaks the one-number table cell and sort semantics);
   strictest-only was rejected (misreads moonlit nights as useless for the
   common shoot-through-moonlight dual-band workflow).
5. **D5 disclosure — resolved: yes.** The "Computed for:" label also
   surfaces the twilight definition and minimum-horizon value (new D5-FR2),
   since both silently change imaging time (FR-015/FR-018).

## References

- Issues: #817 (graph/metric contradiction — root cause + verified
  baseline), #792 (Opposition column clipping), #816 (detail-pane
  overflow), #815 (add-target popover clipping).
- Specs: `specs/044-targets-planner-astronomy/spec.md` (Track B: FR-001
  through FR-028, esp. FR-005/FR-006/FR-017 imaging-time + no-dark-window,
  FR-022/FR-023 moon-free integration + rule ownership boundary,
  FR-007 sparkline band default); `specs/047-targets-planner-moon-filters/spec.md`
  (Track A: FR-009/FR-009a/FR-010 Lorentzian rule + pills + params,
  FR-014 opposition); `specs/044-targets-planner-astronomy/research.md:90-106`
  and `specs/047-targets-planner-moon-filters/plan.md:255-260` and
  `specs/047-targets-planner-moon-filters/contracts/settings.plannerMoonAvoidance.md:60-70`
  (all reject the dead `min_lunar_separation_deg` scalar).
- Code: `apps/desktop/src/features/targets/planner-derive.ts` (imaging-time
  + moon-free integration, `:159-266`), `apps/desktop/src/features/targets/astro/moon-avoidance.ts`
  (shared Lorentzian rule, spec-047-owned, `:1-147`), `apps/desktop/src/features/targets/astro/opposition.ts`
  (best-date/opposition search, reused by Track B), `apps/desktop/src/features/targets/TargetDetailV2.tsx`
  (altitude graph `:140-243`, no-dark-window banner `:765-773`), `apps/desktop/src/features/targets/TargetsTable.tsx`
  (column inventory `:12-13`, `:41-61`), `apps/desktop/src/styles/components/merges-3.css`
  (column widths `:323-355`), `apps/desktop/src/features/settings/Equipment.tsx:1-25`
  (current Camera DTO, no sensor/color field).
