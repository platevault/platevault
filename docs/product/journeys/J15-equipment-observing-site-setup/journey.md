## Journey 15 — Equipment & observing-site setup

**Goal:** register optical hardware (cameras, telescopes, optical trains,
filters) and observing site(s) so calibration fingerprints, naming, and
planner astronomy operate on real equipment data instead of raw FITS
strings.

**Preconditions:** none (equipment CRUD is independent of library content).

**Narrative flow:**

1. **Settings → Equipment**: register cameras and telescopes with aliases
   matching the strings capture software writes into FITS headers; compose
   optical trains (camera + telescope + focal length). Aliases are the join
   key: a session whose `INSTRUME` matches a camera alias displays the
   friendly name everywhere.
2. Filters: adjust the seeded list to the actual filter wheel; categories
   (broadband/narrowband/dual-band) feed per-band moon avoidance.
3. **Settings → Target Planner**: add site(s) with coordinates, timezone,
   horizon; mark default/active. The active site drives Tonight/Max-alt.
4. Consequences visible where they matter: sessions and masters show
   friendly equipment names; matching explains fingerprints in equipment
   terms; the planner names the active site.

**Touch & validate:**

- CRUD every entity type (add, edit, remove) including validation: empty
  name rejected, duplicate name/alias flagged, train requires its parts.
- Alias join: ingest (or use) a session whose header matches a registered
  alias → friendly name appears on Sessions/Calibration rows; removing the
  equipment degrades the display back to the raw header string, never to
  blank.
- Site: add a second site, switch active, planner columns/labels follow;
  coordinate/timezone validation; removing the active site forces an
  explicit fallback choice.
- Moon avoidance: per-band table edits persist per cell, feed the planner's
  per-band guidance, and Restore defaults states its scope.
- Every form answers back on save/cancel.

**Safety & trust notes:** equipment records are pure index data — no
filesystem interaction; deleting equipment must never orphan sessions.

**Scenario files:** *(to be authored)*
`e2e-agentic-test/journeys/equipment-site-setup/scenario.md`.
