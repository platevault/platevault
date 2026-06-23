# Tasks: Target Identity, History, And Notes

**Spec**: 023-target-identity-history-notes | **Plan**: [plan.md](./plan.md)

Tasks are grouped by user story so each story can be developed and tested
independently.

> **Implementation status (2026-06-23): IMPLEMENTED on gen-3.** The task list below was authored against
> the retired gen-2 model; it has been delivered on the spec-035/036 gen-3 `canonical_target` model instead:
> - **US1 (identity + aliases)** — `target.get`, `target.alias.add/remove` shipped on gen-3.
> - **US2 (linked sessions)** — `target.sessions.list` (filters `acquisition_session.canonical_target_id`)
>   + `TargetDetailV2` sessions section.
> - **US3 (linked projects)** — `target.projects.list` (filters `projects.canonical_target_id`)
>   + `TargetDetailV2` projects section. *Known gap: rows deep-link to `/projects` without selecting a
>   specific project (route keys `selected` on a numeric index, not the UUID) — follow-up.*
> - **US4 (observing notes)** — migration `0048_target_notes` (`canonical_target.notes`) +
>   `target.note.get/update` + a notes editor in `TargetDetailV2`.
> - **`target.primary.rename` DROPPED** (out of scope; contract orphaned).
> - **Foundations (T001–T005) are OBSOLETE** — they target the gen-2 `target_alias`/`target_id`-FK model
>   that spec 036 deleted. Do not implement as written.

## Foundations *(OBSOLETE — gen-2 model retired by spec 036; see status note above)*

- T001. [DONE] Create `crates/targeting/` with the `Target`, `CatalogRef`, and
  alias-normalization types defined in `data-model.md`. Unit-test
  normalization (whitespace, case, "M 31" vs "M31" vs "Messier 31"),
  alias conflict detection, alias removal (`alias.is_primary` guard), and
  primary rename (`designation.not_in_aliases` guard).
- T002. [DONE] Add target/alias/catalog_ref tables and indexes to
  `crates/persistence/db` via a new migration. Add `target_id` FKs on
  `sessions` and `projects` (nullable for v1 to support existing rows).
  Use `primary_designation` column name (not `primary`).
- T003. [DONE] Generate Rust DTOs in `crates/contracts/core/` and TypeScript types
  in `packages/contracts/generated/` from the five JSON Schemas
  (`target.get`, `target.note.update`, `target.alias.add`,
  `target.alias.remove`, `target.primary.rename`).
- T004. [DONE] Add Tauri command adapters mapping each contract to a use case in
  `crates/app/core/`.

## US 1 — View Target Identity (P1)

- T005. [DONE] Implement `target_get` use case: load `Target` by id; on miss
  return `target.not_found`.
- T006. [DONE — TargetDetailV2.tsx] Wire `routes/targets.$targetId.tsx` in the desktop app with header
  (primary name, `updated_at`, alias chips, catalog ref chips).
- T007. [DONE — target-identity.test.ts] Confirm the router config does NOT register Targets as a primary
  nav entry; add a regression test that fails if the sidebar manifest gains
  a Targets entry.
- T008. [DONE — CommandPalette.test.tsx + palette-target-search.test.ts; router uses parseString so /targets/$uuid redirects to ?selected=<uuid>] Add alias-aware results to the Cmd+K palette: match on
  `primary` and any `alias_normalized` row; selecting routes to
  `/targets/$targetId`.
- T009. Add a target chip on Inventory rows that have a resolved
  `target_id`; chip click opens the target detail route.
- T010. Add a target chip on Project source rows that have a resolved
  `target_id`; chip click opens the target detail route.
- T011. Tests: contract test for `target.get`; Playwright covering Cmd+K,
  Inventory, and Project entry points reaching the same target detail.

## US 2 — See Sessions Over Time (P2)

- T011b. Implement `captured_on` derivation: for each session, compute
  `captured_on = date_of(exposure_start_utc − 12h)` in the timezone of
  `AcquisitionSession.observer_location.tz`. Return null when
  `observer_location` is null or unreviewed; exclude such sessions from
  the `target.get` sessions array (R3, R-3.1). Unit-test the solar-noon
  boundary rule (e.g. 00:30 UTC before and after local midnight).
- T012. Extend `target_get` to join `TargetSession` rows from
  `crates/sessions/` ordered reverse-chronologically by `captured_on`.
  Filter out sessions where `captured_on` is null.
- T013. Render the sessions section on the target detail route with date,
  filter, exposure, and frame count.
- T014. Wire session rows to deep-link to the corresponding Inventory item.
- T015. Render an explicit empty state when `sessions[]` is empty.
- T016. Tests: fixture with sessions across three years renders in correct
  order; empty-state test; deep-link smoke test.

## US 3 — See Projects Per Target (P3)

- T017. Extend `target_get` to join `TargetProject` rows from
  `crates/project/structure/` ordered by lifecycle then name.
- T018. Render the projects section on target detail using the shared
  lifecycle tone tokens from spec 002/009.
- T019. Wire project rows to deep-link to that project's detail route.
- T020. Tests: fixture with two projects referencing one target renders
  both; archived project shows archived tone.

## US 4 — Observing Notes Per Target (P4)

- T021. [DONE] Implement `target_note_update` use case: replace `notes`, bump
  `updated_at`, write one audit event via `crates/audit/`.
- T022. [DONE — TargetDetailV2.tsx + TargetDetailV2.test.tsx tests 5-6] Render an editable notes section on target detail with a
  5-second debounced save through `target.note.update` (A7).
- T023. Confirm per-target notes render only here; per-session notes remain
  on session rows inside the sessions list (R4).
- T024. [DONE] Add `target_alias_add` use case: validate, conflict-check
  (`alias.duplicate` with `conflicting_target_id` in `details`), write
  alias and one audit event.
- T025. [DONE — TargetDetailV2.tsx alias add form + tests 7-11] Wire an alias-add control in the target detail header; surface
  inline error toasts for `alias.duplicate` and `alias.invalid`.
- T026. Tests: note round-trip survives alias rename; alias duplicate
  rejection returns conflicting target id; idempotent re-add of an existing
  alias returns `added=false`.
- T027. [DONE] Implement `target_alias_remove` use case: look up alias by
  normalized form; reject with `alias.is_primary` if it matches
  `primary_designation`; else delete row and write audit event
  `target.alias_removed` + provenance entry.
- T028. [DONE] Implement `target_primary_rename` use case: verify
  `newPrimaryDesignation` is in `aliases[]`; swap primary and alias;
  write audit event `target.primary_renamed` + provenance entry. Reject
  with `designation.not_in_aliases` or `designation.already_primary`.
- T029. [DONE — TargetDetailV2.tsx remove/make-primary buttons + tests 9-10,12-13] Wire alias-remove and primary-rename controls in the target detail
  header; surface inline error toasts for `alias.is_primary`,
  `designation.not_in_aliases`, and `designation.already_primary`.
- T030. Tests: alias.remove happy path; alias.is_primary rejection;
  alias.not_found rejection; primary.rename happy path (verify prior
  primary becomes alias); designation.not_in_aliases rejection.

## Cross-Cutting

- X-1. Update the steering index entry for `specs/023-` once tasks land.
- X-2. Generate a contract snapshot test that fails on enum drift between
  `target.get.json` `ProjectLifecycle` and the spec 009 canonical enum.
  The contract explicitly documents this dependency (E6).
- X-3. Add an integration test asserting Targets is not present in the
  primary nav manifest (defensive against accidental promotion).

## Dependency Graph

```
T001 ┐
T002 ┼─► T003 ─► T004 ─► T005 ─► T006 ─► T007
                                  ├─► T008
                                  ├─► T009
                                  └─► T010
                         T005 ─► T011b ─► T012 ─► T013 ─► T014
                         T005 ─► T017 ─► T018 ─► T019
                         T004 ─► T021 ─► T022
                         T004 ─► T024 ─► T025
                         T001 ─► T027 ─► T029 ─► T030
                         T001 ─► T028 ─► T029
```

## Out of Scope (v1)

- Full identity merge/split workflow (moving sessions across target records)
  — deferred; not to be confused with `alias.remove` + `primary.rename`
  which ARE in v1 scope (T027–T030, R-3.4).
- Observing-plan references (R5) — deferred.
- Year grouping in the sessions list — cosmetic enhancement; flat reverse
  chronological is the v1 cut.
- Promoting Targets to primary navigation — explicitly rejected by design.
