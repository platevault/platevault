# Targets and planning

The **Targets** page is your catalog: thousands of deep-sky objects seeded
out of the box, searchable by any name they go by, enriched with your own
aliases and observing notes, and linked to the sessions and projects that
image them. It also carries a *planner* view — columns answering "what should
I shoot tonight?" — and this chapter is candid about which of those numbers
are real astronomy today and which are still placeholders.

## Browsing the catalog

The list is virtualized, so scrolling stays smooth across thousands of rows.
You can:

- **Search** by designation or any alias — "M31" and "Andromeda" find the
  same row.
- Filter by **Catalogues** (Messier, NGC, IC, Caldwell, Sharpless, Barnard,
  LBN, LDN) and by object type (**Galaxy**, **Emission nebula**, **Globular
  cluster**, and so on).
- Sort any column — one active sort indicator at a time.
- Group rows, for example by **Object type** or catalogue.
- Star targets (☆ — "Add to My Targets") to collect favourites under the
  **My Targets** view.

[screenshot: the Targets page with search results and planner columns]

## Adding targets and SIMBAD lookups

**Add target** ("Search for an astronomical target to add it to your
library.") searches locally first — offline, against the bundled seed
catalog. Confirming a match persists exactly one canonical row; re-adding the
same object never creates a duplicate.

For an object outside the seed, PlateVault resolves the name on demand
against the SIMBAD astronomical database (network required) and caches the
answer for next time. If SIMBAD is unreachable or the name does not resolve,
the dialog says so inline — 'Could not resolve target "{query}". Try a
different name.' — rather than fabricating a row. Online lookups can be
disabled entirely under Settings (Catalogs pane), leaving only the seed and
local cache.

## Target detail: identity, aliases, notes

A target's detail page shows its real identity data — **Designation**, object
type, **RA / Dec**, **Constellation**, **Magnitude**, source, and catalog IDs
such as the **SIMBAD OID** — plus:

- **Aliases** — catalog-provided aliases are fixed; your own ("Add user
  alias…") can be added and removed freely, and a user alias immediately
  becomes searchable in the list. "Only user-added aliases can be removed."
- **Display label** — choose which name the list shows for this target
  ("Not set — showing primary designation").
- **Observing notes** — freehand, saved with visible confirmation
  ("Saved").
- Linked sessions and projects, with **+ New project here** as a shortcut.

[screenshot: target detail with identity, aliases, and observing notes]

## The planner columns — what is real today

The planner-shaped columns — **Max alt**, **Tonight** (altitude sparkline),
**Visible**, **Opposition**, **Lunar** (Moon separation), recommended
filters, and **Img time** — are where you must read the fine print:

> **Not yet available (honest-stub warning):** in the current build these
> columns are **not computed from real coordinates, tonight's date, or your
> observer location**. They are deterministic placeholders derived from each
> target's designation — stable across reloads, deliberately disclosed as
> approximate in their tooltips, but *not astronomically meaningful*. The
> **Opposition** and Sessions columns render as a dash. The target detail's
> altitude graph is titled with its fixed placeholder latitude
> ("Tonight · ~{lat}°N") for the same reason, and its Coverage/Transit
> sections are explicit stub notes.
>
> Real astronomy is on its way in two tracks:
>
> - **Moon separation, filter recommendations, and Opposition** are
>   implemented and awaiting merge (spec 047) — once that lands, the
>   **Lunar** column, tonight's recommended filter set, and the next
>   opposition date become real ephemeris-driven values.
> - **Altitude columns** (Max alt, Tonight, Visible, Img time) follow under
>   spec 044, which brings the full astronomy engine and observer-location
>   support.

Two related notes:

- The **Target Planner** settings pane already exposes a real tunable — the
  usable-altitude threshold (0–90°, default 30°) — which the planner columns
  will honor; see [Settings](./08-settings.md#target-planner).
- **My Targets** favourites are currently stored locally in the app's
  browser storage, not in your library database — they will not follow you
  across machines and may not survive certain resets.

The design principle behind all of this: a stub must never be mistakable for
real astronomical data. If a planner number ever looks concrete but cannot be
traced to your location and the current date, that is a bug worth reporting —
not a feature.

## Related journeys

- [Journey 9 — Targets & planning (what's real today vs. 044/047-pending)](../product/user-journeys.md#journey-9--targets--planning-whats-real-today-vs-044047-pending)

Click-by-click scenario scripts:

- `e2e-agentic-test/035-targets-catalog/list-search-aliases-sort/scenario.md`
- `e2e-agentic-test/035-targets-catalog/simbad-resolve-on-demand/scenario.md`
- `e2e-agentic-test/023-target-identity/detail-identity-aliases-notes/scenario.md`
- `e2e-agentic-test/044-planner-stubs/planner-columns-visibly-stubs/scenario.md` (the authority on the real-vs-stub boundary)
