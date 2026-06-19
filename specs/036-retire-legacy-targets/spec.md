# Feature Specification: Retire Legacy Target Tables

**Feature Branch**: `036-retire-legacy-targets`

**Created**: 2026-06-19

**Status**: Draft

**Input**: User description: "Retire the legacy target tables and consolidate all target storage and management on the spec-035 canonical_target model."

## Overview

The application accumulated three generations of target storage that now coexist: a
legacy `target` table, the spec-013/023 `targets` family (`targets`, `target_aliases`,
`target_catalog_refs`, `catalog_equivalences`), and the spec-035 `canonical_target` /
`target_alias` model (the keeper, SIMBAD-backed). This feature removes the first two
generations entirely and rebuilds the live Targets management surface on the spec-035
model, so there is exactly one source of target truth.

This is a greenfield project: there is no production data to preserve, so legacy schema
and code are deleted outright (no data migration, no backwards-compatibility shims).

## Clarifications

### Session 2026-06-19

- Q: Should per-target notes survive? → A: No. Notes are a project concept only
  (spec 024). Per-target notes are dropped; a future per-target notes feature is deferred.
- Q: Should users be able to freely rename a target's primary designation? → A: No. A
  target always links to SIMBAD and its primary designation stays canonical. Users may
  instead set an optional **display alias** that changes only the displayed label.
- Q: What happens to the live Targets page? → A: It is rebuilt on the spec-035 model
  (loses the note box, gains the display-alias control, keeps alias management).
- Q: Backwards compatibility / data migration? → A: None. Greenfield; delete legacy
  schema and code outright.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One source of target truth (Priority: P1)

A maintainer (and, indirectly, every user) needs the app to have a single, coherent
notion of a "target." Today three overlapping stores exist, which causes drift,
duplicate identities, and confusion about which table backs a given screen. After this
change, all target reads and writes go through the spec-035 `canonical_target` model.

**Why this priority**: Without consolidation, every later target feature must reason
about which of three stores it touches. This is the foundational slice — removing the
legacy stores is the whole point of the feature.

**Independent Test**: Inspect the schema and codebase: the legacy `target`, `targets`,
`target_aliases`, `target_catalog_refs`, `catalog_equivalences` tables and their FK
columns no longer exist; no code references them; the full build and test suite pass on
a fresh database.

**Acceptance Scenarios**:

1. **Given** a freshly initialised database, **When** migrations run, **Then** none of
   the legacy target tables or legacy target FK columns exist, and the spec-035
   `canonical_target` / `target_alias` tables do.
2. **Given** the running app, **When** any target-related screen or command is used,
   **Then** it reads/writes only the spec-035 model (no query references a legacy table).
3. **Given** the test suite, **When** it runs on a fresh DB, **Then** it passes with no
   references to legacy target tables or the removed commands.

---

### User Story 2 - View and manage a target on the spec-035 model (Priority: P1)

A user opens the Targets page (primary navigation, or via Cmd+K target search) and sees
a target's canonical identity — primary designation, object type, coordinates, and the
full alias list — sourced from the spec-035 model. They can add and remove user aliases.

**Why this priority**: The Targets page is a live primary-nav surface backed entirely by
the legacy store. Retiring the legacy store without rebuilding this surface would remove
a feature users have. This must ship together with US1.

**Independent Test**: Open the Targets page for a resolved target; confirm identity +
aliases render from the spec-035 model; add an alias and remove it; confirm persistence.

**Acceptance Scenarios**:

1. **Given** a canonical target exists, **When** the user opens its detail view, **Then**
   the primary designation, object type, coordinates, and alias list are displayed from
   the spec-035 model.
2. **Given** a target detail view, **When** the user adds a new alias, **Then** it is
   persisted and appears in the alias list.
3. **Given** a target with a user-added alias, **When** the user removes that alias,
   **Then** it no longer appears and is removed from storage.
4. **Given** a target detail view, **When** the user attempts to change the primary
   designation directly, **Then** no such control exists (rename is not offered).

---

### User Story 3 - Set a friendly display name without breaking SIMBAD identity (Priority: P2)

A user wants a target to show a friendly label (e.g. "Backyard Andromeda") in the UI
without altering its canonical SIMBAD identity. They set a **display alias**; the app
shows it in place of (or alongside) the canonical designation everywhere the target
appears, while the underlying identity and resolution link stay canonical. They can
clear it to revert to the canonical designation.

**Why this priority**: This is the deliberate replacement for the removed free-rename
capability. It is valuable but secondary to consolidation and the core view/manage flow.

**Independent Test**: Set a display alias on a target; confirm the UI shows it and the
canonical designation is unchanged; clear it; confirm the UI reverts to canonical.

**Acceptance Scenarios**:

1. **Given** a target with no display alias, **When** the user sets a display alias,
   **Then** the UI shows the display alias and the canonical primary designation is
   unchanged in storage.
2. **Given** a target with a display alias, **When** the target is re-resolved against
   SIMBAD, **Then** the display alias persists (it is not overwritten by resolution).
3. **Given** a target with a display alias, **When** the user clears it, **Then** the UI
   reverts to showing the canonical primary designation.

---

### Edge Cases

- A target that has no user aliases and no display alias displays only its canonical
  designation and SIMBAD-derived aliases.
- Adding an alias that duplicates an existing alias (canonical or user) is rejected with
  a clear message rather than creating a duplicate.
- Clearing a display alias that was never set is a no-op (no error).
- Acquisition sessions / projects that previously carried a legacy target link show no
  target link after retirement (the legacy links are discarded by design; only the
  spec-035 `projects.canonical_target_id` association remains).
- The Inbox / inventory list, which previously showed a target name via a legacy join
  that always returned empty, shows no regression (the empty join is removed).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST remove the legacy `target` table and the spec-013/023
  `targets`, `target_aliases`, `target_catalog_refs`, and `catalog_equivalences` tables
  from the schema so a freshly initialised database does not contain them.
- **FR-002**: The system MUST remove the now-unused legacy target foreign-key columns
  (`acquisition_session.target_id`, `acquisition_session.acq_target_id`,
  `projects.target_id`, `project_sources.target_id`) and their indexes.
- **FR-003**: The system MUST retain the spec-035 `canonical_target` / `target_alias`
  model and the `projects.canonical_target_id` association unchanged as the sole target
  store.
- **FR-004**: The system MUST remove all code that reads or writes the legacy tables,
  including the legacy target repository, the legacy catalog-load path, and the
  superseded legacy lookup/FITS-resolve commands.
- **FR-005**: The system MUST remove the inventory projection's join to the legacy
  target table without changing any other inventory behaviour.
- **FR-006**: Users MUST be able to view a target's canonical identity (primary
  designation, object type, coordinates) and its alias list from the spec-035 model on
  the Targets page (reachable via primary navigation and target search).
- **FR-007**: Users MUST be able to add a user alias to a target and remove a user alias
  from a target, persisted in the spec-035 model.
- **FR-008**: The system MUST reject adding an alias that duplicates an existing alias
  for the same or a different target, with a clear, user-facing reason.
- **FR-009**: The system MUST NOT offer free editing of a target's primary designation;
  the primary designation remains the SIMBAD-canonical value.
- **FR-010**: Users MUST be able to set an optional display alias for a target that the
  UI uses as the target's displayed label without changing the canonical identity or the
  resolution link.
- **FR-011**: Users MUST be able to clear a target's display alias, reverting the
  displayed label to the canonical primary designation.
- **FR-012**: A set display alias MUST persist across re-resolution against SIMBAD (it
  is user-owned and takes display precedence, mirroring the existing manual-override
  precedence model).
- **FR-013**: The system MUST remove the legacy target contract data shapes and
  regenerate the generated client bindings so no legacy target types remain.
- **FR-014**: The test suite MUST be updated so no test references the removed legacy
  tables or removed commands, and MUST pass on a fresh database.
- **FR-015**: Per-target notes MUST NOT exist after this change (no notes field on the
  canonical target model and no per-target note command); project notes are unaffected.

### Key Entities *(include if feature involves data)*

- **Canonical target** (kept): the single physical-object identity — canonical primary
  designation, object type, ICRS coordinates, SIMBAD linkage, and an optional
  user-owned display alias used for presentation only.
- **Target alias** (kept): an alternate designation/name for a canonical target, either
  SIMBAD-derived or user-added, with normalised form for matching.
- **Legacy target stores** (removed): the `target` table and the spec-013/023 `targets`
  family and their FK columns — deleted entirely.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a freshly initialised database, zero legacy target tables and zero
  legacy target FK columns exist; the spec-035 target tables exist.
- **SC-002**: Zero source references to the legacy target tables or removed commands
  remain in non-test and test code (verifiable by search).
- **SC-003**: The full build, lint, type-check, and test suite pass on a fresh database
  with no legacy-target references.
- **SC-004**: A user can open a target, view its identity and aliases, and add then
  remove an alias, with each change reflected immediately.
- **SC-005**: A user can set a display alias and see it used as the target's label across
  the app, and clear it to revert — with the canonical designation never altered.
- **SC-006**: Setting/clearing a display alias and managing aliases on a target each
  complete in a single, obvious interaction (no migration prompts, no legacy fallbacks).

## Assumptions

- Greenfield: there is no production target data to preserve; legacy rows are discarded
  with their tables, and no data-migration/backfill is performed.
- The spec-035 `canonical_target` / `target_alias` model is sufficient to back the
  rebuilt Targets page (identity, object type, coordinates, aliases) — confirmed by the
  spec-035 schema.
- Spec-035 `target.search` / `target.resolve` already supersede the legacy
  `target.lookup` / FITS-resolve commands, so removing the legacy commands loses no
  capability.
- Project↔target association (spec-035 `projects.canonical_target_id`) and project notes
  (spec 024) are out of scope here and remain unchanged.
- Removing the legacy inventory join causes no regression because the legacy `target`
  table is never populated by current code (the join already returns empty).
- The display alias is presentation-only; sorting/search keying on the canonical
  designation is acceptable unless a later spec says otherwise.
