> **MIGRATED:** current truth now lives at
> `docs/journeys/J13-audit-activity-investigation/journey.md`. This file and
> its deltas are frozen legacy history.

## Journey 13 — Audit & activity investigation: "what happened to my files?"

**Goal:** reconstruct what PlateVault did (or refused to do) after an
unattended scan, an apply, or a forgotten session — using the Activity panel
for "what is happening now" and the Audit Log for "what was done".

**Preconditions:** at least one applied plan, one refused action, and
ongoing background activity.

**Narrative flow:**

1. The status-bar **Log** toggle opens the Activity panel: live stream,
   severity chips, follow mode; rows referencing an entity cross-link to
   that entity's page with it selected.
2. **Settings → Audit Log** holds the durable record: every attempted
   mutating action with timestamp, event, entity, outcome, actor — plan
   applications without exception.
3. Filtering by entity/date narrows the trail; an audit row links back to
   the entity and, for plan events, to the plan's item list.
4. **Export** writes a file via a native save dialog and confirms where.
5. An archived project's detail shows the same history scoped to that
   project, with outcomes.

**Touch & validate:**

- Perform a plan apply, then find it in the Audit Log by entity and by date
  — coverage of plan events is the core assertion of this journey.
- Cross-link one Activity row per entity type (project, session, target,
  plan, catalog) — each must land on an existing route with the entity
  selected.
- Severity chips: assert floor-vs-exact semantics match the documented
  behavior; a severity filter with zero matching rows reads as a filter
  miss, never as "no log entries"; follow mode keeps the newest row
  visible; export produces a readable file.
- Panel chrome: collapse control and Escape both close the panel; follow
  pauses on scroll-up and resumes from the newest row when re-enabled; the
  export dialog is titled for the Activity panel (not another surface);
  periodic internal housekeeping events must not drown user-meaningful
  rows in the default view.
- Category/source filter narrows the stream alongside severity (once its
  UI ships — its absence is a coverage failure of this journey).
- Audit search + date range (including an all-excluding range → explicit
  empty state), pagination past one page.
- Outcome and actor visible for every row, in both the settings pane and
  the archived-project view.

**Safety & trust notes:** for the meticulous librarian this product serves,
an audit surface that *misses* events is worse than none — "empty log" must
never be ambiguous between "nothing happened" and "nothing was recorded".

**Scenario files:** *(to be authored)*
`e2e-agentic-test/journeys/audit-investigation/scenario.md`.
