## Journey 9 — Targets & planning (what's real today vs. 044/047-pending)

**Goal:** browse the target catalog, resolve new targets against SIMBAD, and
review per-target identity/aliases/notes — while understanding which parts of
the "planner" view are real astronomy today and which are still placeholders.

**Preconditions:** a bundled seed catalog (loaded automatically) and,
optionally, a network connection for SIMBAD lookups.

**Narrative flow (real today):**

1. **Targets** lists the seeded catalog (thousands of rows, virtualized for
   smooth scrolling), searchable by name or known alias (e.g. searching
   "M31" or "Andromeda" both find the same row), sortable by any column with
   a single active sort indicator, and optionally groupable (e.g. by
   catalogue).
2. **Add target** offers local, offline typeahead first; confirming a local
   match persists exactly one canonical target row (re-adding the same
   target never creates a duplicate). For a target not in the local seed,
   PlateVault resolves it on demand against SIMBAD and caches the result for
   next time; if SIMBAD is unreachable or the name doesn't resolve, the
   dialog says so inline rather than fabricating a row.
3. **Target detail** shows real identity data (designation, type,
   coordinates, source, optional catalog id), lets the user add/remove their
   own aliases (catalog-provided aliases can't be removed) — and a
   user-added alias immediately becomes searchable too — set or clear a
   display label (which propagates to the list), and write/save observing
   notes.

**Narrative flow (stubbed/pending — 044 Track B / 047 Track A):**

4. The Targets table's astronomy-shaped columns — Max altitude, Tonight's
   sparkline, Visible-tonight, Opposition, Lunar separation, recommended
   Filters, and Image time — are **not** computed from real coordinates,
   date, or observer location yet. They are deterministic placeholders
   derived from a hash of the target's designation, so they look stable
   across reloads but are not astronomically meaningful. Opposition and
   Sessions columns always render as a dash today (Sessions awaits a
   session-linkage backend feature; Opposition awaits an ephemeris engine).
   The target detail's altitude graph uses a fixed placeholder observer
   latitude (disclosed in the graph's own title), and its Coverage/Transit
   sections are explicit stub notes rather than real data.
5. "Favourites"/"My Targets" is currently a browser-local (`localStorage`)
   preference only — it is not backed by the database yet, so it won't
   follow the user across machines or survive certain resets.

**Touch & validate:**

- Search & counts: search by designation and by alias (catalog and
  user-added); the list count, the sidebar count, and any "My targets"
  count must each be labeled so a user can tell catalog size from library
  size at a glance.
- Add target: local typeahead hit; SIMBAD on-demand hit; unresolvable name
  (inline failure, no fabricated row); re-add produces no duplicate; after
  add, the new target is findable and visibly indicated (selection,
  highlight, or scroll-to) with a confirmation signal.
- Favorites: star toggles with feedback; "My targets" filter shows exactly
  the user's set; favorite state survives restart.
- Identity: alias add/remove (catalog aliases protected); display label
  set/clear propagates to the list; notes save and persist; type/casing of
  values consistent between row and detail.
- Planner columns: every stubbed value is visibly disclosed as approximate/
  stub (tooltip or label) — a concrete-looking fabricated value fails the
  run; sort on each planner column; group + secondary sorts; sparkline
  legibility in **every** theme.
- Detail actions: "+ New project here" (see Journey 14 for the contract);
  any other CTA on the panel must be functional or absent — placeholders
  are a coverage failure.
- Guidance popover: "Why this guidance" opens from both the row and the
  detail, names the per-filter thresholds behind the recommendation, and
  closes cleanly (Escape/outside click).
- List freshness: identity edits made in the detail (alias add, display
  label) are immediately reflected in the list — the new alias is
  searchable and the label propagates without a reload.

**Safety & trust notes:** this journey is the one place in the product where
the honesty of a stub matters as much as its function — the design intent is
that a stub must never be mistaken for real astronomical data (hover
tooltips disclose "approximate" wording and the placeholder latitude), and
the project's own verification plan treats a *concrete-looking fabricated
value* as a failure, even though the column itself is allowed to be a stub.

**Scenario files:**
`e2e-agentic-test/035-targets-catalog/list-search-aliases-sort/scenario.md`,
`.../simbad-resolve-on-demand/scenario.md`,
`e2e-agentic-test/023-target-identity/detail-identity-aliases-notes/scenario.md`,
`e2e-agentic-test/044-planner-stubs/planner-columns-visibly-stubs/scenario.md`
(the authority on the real-vs-stub boundary — read this one first if you're
unsure whether a planner number is real).

**Known gaps (2026-07-04):** everything in the "stubbed/pending" section
above. Real astronomy for these columns is planned under specs 044 (Track B
— astronomy-engine unification, Lorentzian filter model) and 047 (Track A —
Moon/filters), gated on an ephemeris/observer backend; session-linkage and
favourites-persistence are separate, smaller backend gaps. `aria-sort` on the
Targets table's active sortable column requires **PR #415** (open).
