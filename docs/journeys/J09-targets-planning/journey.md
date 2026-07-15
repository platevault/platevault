---
id: J09
title: Find, add, and plan around an astrophotography target
version: 1
status: active
last_reviewed: 2026-07-14
actors: [astrophotographer]
surfaces: [targets]
interfaces: [desktop-ui]
trace:
  - docs/product/journeys/J09-targets-planning/journey.md @ 66026463
  - deltas/2026-07-14-jval-docdrift.md (folded: astronomy columns real, favourites DB-backed, aria-sort, library-vs-seed correction)
  - deltas/2026-07-14-q16-t132.md (not folded — see Delta log)
  - deltas/2026-07-14-q16-t133.md (not folded — see Delta log)
  - commits 6b263a1e, 94dfa492, 1efdc0c5, fd87e99c, 6a51dfd5, ba68bf27 (target search: NED/VizieR fallback, coordinate-based suggestions, hybrid UX, lookup caching, Enter/offline handling)
  - PR #415 (aria-sort on sortable table headers, incl. Targets)
  - issues #757, #758, #817 (open, known gaps)
---

## Goal

The astrophotographer wants to find a specific object (by designation or
common name), add it to their own target library if it isn't there yet, and
review or edit what the app knows about it — its identity, its aliases, their
own notes, and tonight's real observing prospects at their configured site.
"Done" is: the target is in the user's library, findable by any of its names,
and its detail panel shows accurate identity data and (when a site is
configured) real per-site astronomy for tonight.

## Preconditions

- P1: The app has the bundled seed index available (Messier, Caldwell, and a
  slice of NGC/IC/Sharpless/LBN/LDN) for local, offline typeahead matching.
- P2: A network connection is optional; it is required only to resolve a
  target that isn't in the local seed or cache.
- P3: An observing site is configured in Settings for planner columns (Max
  altitude, Tonight's sparkline, Visible-tonight, Lunar separation, Filters,
  Image time, Opposition) to compute real values; without a site, those
  columns disclose that they need one rather than showing a number.

## Steps

### S1 — Browse and search the target library {#S1}
- **Do:** Open Targets. Search by designation or by any alias (catalog-
  provided or user-added).
- **Expect:** The list shows the targets the user has actually added to their
  library (not the full bundled seed catalog), sortable by any column with a
  single active sort indicator, and optionally groupable (e.g. by catalogue).
  A search for a designation or alias (e.g. "M31" or "Andromeda") finds the
  same row. The active sortable column header announces its sort direction
  to assistive technology (`aria-sort`).
- **Expect (negative):** The bundled seed catalog (thousands of entries) is
  never materialized as browsable rows in this list — it is reachable only
  through the Add-target search (S2).
- **Trace:** commits fd87e99c, PR #415

### S2 — Add a target {#S2}
- **Do:** Open Add target and type a name or designation.
- **Expect:** Local, offline typeahead results appear first (from the bundled
  seed plus any previously cached lookups). Confirming a local match persists
  exactly one canonical target row — re-adding the same target never creates
  a duplicate. If the name isn't in the local seed/cache, the app also tries
  a SIMBAD lookup on-demand while the user keeps typing; once the query is
  long enough, an "unresolved" outcome (including "offline" / online
  resolution disabled) is shown as a plain, non-fatal state, never as an
  error. If both the local and SIMBAD phases come up empty, the dialog offers
  an explicit "search more catalogues" action (falls back to SIMBAD's wider
  Sesame/NED/VizieR lookup) framed as a next step, not a dead end; pressing
  Enter triggers that same action only when it is the sole actionable thing
  on screen (zero suggestions) — with any suggestion present, Enter selects
  the highlighted one instead. A resolved lookup (any phase) is cached so the
  same name resolves instantly next time.
- **Expect (negative):** An unresolvable name never fabricates a row; the
  dialog states the outcome inline instead.
- **Trace:** commits 6b263a1e, 94dfa492, 1efdc0c5, fd87e99c, 6a51dfd5, ba68bf27

### S3 — Review and edit target identity {#S3}
- **Do:** Open a target's detail panel. Add or remove an alias, set or clear
  a display label, write an observing note.
- **Expect:** The detail panel shows real identity data (designation, type,
  coordinates, source, optional catalog id). A user-added alias becomes
  immediately searchable from the list (S1) without a reload; catalog-
  provided aliases cannot be removed. Setting or clearing a display label
  propagates to the list immediately. Notes save and persist across a
  restart.
- **Expect (negative):** A catalog-provided alias has no remove control.

### S4 — Read tonight's real per-site astronomy {#S4}
- **Do:** With an observing site configured, open a target's row or detail
  panel and read Max altitude, Tonight's sparkline, Visible-tonight, Lunar
  separation, recommended Filters, Image time, and Opposition.
- **Expect:** These values are computed from the target's real coordinates,
  tonight's date, and the configured site — they vary meaningfully by target
  and by site, and change as the site or date changes (not a value stable
  across reloads regardless of input). "Why this guidance" opens (from either
  the row or the detail panel), names the per-filter thresholds behind the
  recommendation, and closes on Escape or an outside click.
- **Expect (negative):** Without a configured observing site, these columns
  disclose that they need a site rather than rendering a plausible-looking
  number. The Sessions column always renders as a dash — session-linkage is
  not implemented yet (see G1).
- **Trace:** deltas/2026-07-14-jval-docdrift.md

### S5 — Toggle a favourite / "My Targets" {#S5}
- **Do:** Star a target from the row or detail panel; switch the list to "My
  Targets".
- **Expect:** The star toggles with immediate visual feedback; "My Targets"
  shows exactly the user's starred set; the favourite state is stored in the
  database and survives an app restart (not a browser-local preference).
- **Trace:** deltas/2026-07-14-jval-docdrift.md

## Success criteria

- SC1: Searching a target's designation and searching any of its aliases
  (catalog or user-added) both resolve to the same row (S1, S3).
- SC2: Adding a target already in the library never creates a second row for
  it (S2).
- SC3: Every stubbed or site-dependent planner value is either a real
  per-site computation or an explicit "needs a site" / "—" disclosure — never
  a concrete-looking number that isn't actually computed (S4).
- SC4: A favourite toggled in one session is still set after an app restart
  (S5).

## Known gaps

- G1: The Sessions column always renders as a dash; session-linkage to the
  planner is not implemented yet.
- G2: A target with an active observing site but unresolved/missing
  coordinates (e.g. a manually-added target never matched to a catalog
  entry) crashes the detail panel's altitude graph instead of rendering an
  explicit "needs coordinates" state, and the table itself renders such a
  target indistinguishably from a genuinely low-altitude one (no label,
  pill, or tooltip). Open issues #757, #758; fix in flight on branch
  `fix/target-detail-coords-moon`, not yet merged to main — this journey
  describes current (pre-fix) behavior only.
- G3: On a night with no qualifying dark window, the altitude graph still
  paints the usable-altitude fill under the curve while omitting twilight
  shading, so the graph visually implies imaging time even though the
  computed Image time correctly reads 0 — a rendering contradiction, not a
  calculation error. Open issue #817.

## Delta log

(empty at last_reviewed — window holds only entries newer than
last_reviewed)

<!--
Not folded into the body: deltas/2026-07-14-q16-t132.md and
2026-07-14-q16-t133.md describe a shared-value-renderer /
unresolved-vs-not-applicable rendering model and a "detail panels lead with
new information" content model. Their own source (spec-030 iteration
2026-07-14-q16-applied.md) records these as spec-only ("Tasks completed: 0 of
117 ticked... post-implementation campaign; #620 and #619 are open findings
against the shipped UI") and issues #619/#620 are still OPEN. The current
Targets code still renders missing/unavailable values as a plain "—" (e.g.
TargetsTable.tsx unknown-coordinates / no-site branches), not the FR-137
"unresolved chip". Not verifiably shipped for this surface — left out of
current-truth steps per journey-authoring rules; see open questions below.
-->
