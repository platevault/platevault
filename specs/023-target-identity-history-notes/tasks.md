# Tasks: Target Identity, History, And Notes

**Spec**: 023-target-identity-history-notes | **Plan**: [plan.md](./plan.md)

Tasks are grouped by user story so each story can be developed and tested
independently. The full feature is **NOT IMPLEMENTED**; all tasks below are
deferred until each story passes review.

## Foundations

- T001. Create `crates/targeting/` with the `Target`, `CatalogRef`, and
  alias-normalization types defined in `data-model.md`. Unit-test
  normalization (whitespace, case, "M 31" vs "M31" vs "Messier 31") and
  alias conflict detection.
- T002. Add target/alias/catalog_ref tables and indexes to
  `crates/persistence/db` via a new migration. Add `target_id` FKs on
  `sessions` and `projects` (nullable for v1 to support existing rows).
- T003. Generate Rust DTOs in `crates/contracts/core/` and TypeScript types
  in `packages/contracts/generated/` from the three JSON Schemas
  (`target.get`, `target.note.update`, `target.alias.add`).
- T004. Add Tauri command adapters mapping each contract to a use case in
  `crates/app/core/`.

## US 1 — View Target Identity (P1)

- T005. Implement `target_get` use case: load `Target` by id; on miss
  return `target.not_found`.
- T006. Wire `routes/targets.$targetId.tsx` in the desktop app with header
  (primary name, `updated_at`, alias chips, catalog ref chips).
- T007. Confirm the router config does NOT register Targets as a primary
  nav entry; add a regression test that fails if the sidebar manifest gains
  a Targets entry.
- T008. Add alias-aware results to the Cmd+K palette: match on
  `primary` and any `alias_normalized` row; selecting routes to
  `/targets/$targetId`.
- T009. Add a target chip on Inventory rows that have a resolved
  `target_id`; chip click opens the target detail route.
- T010. Add a target chip on Project source rows that have a resolved
  `target_id`; chip click opens the target detail route.
- T011. Tests: contract test for `target.get`; Playwright covering Cmd+K,
  Inventory, and Project entry points reaching the same target detail.

## US 2 — See Sessions Over Time (P2)

- T012. Extend `target_get` to join `TargetSession` rows from
  `crates/sessions/` ordered reverse-chronologically by `captured_on`.
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

- T021. Implement `target_note_update` use case: replace `notes`, bump
  `updated_at`, write one audit event via `crates/audit/`.
- T022. Render an editable notes section on target detail with debounced
  save through `target.note.update`.
- T023. Confirm per-target notes render only here; per-session notes remain
  on session rows inside the sessions list (R4).
- T024. Add `target_alias_add` use case: validate, conflict-check
  (`alias.duplicate` with `conflicting_target_id` in `details`), write
  alias and one audit event.
- T025. Wire an alias-add control in the target detail header; surface
  inline error toasts for `alias.duplicate` and `alias.invalid`.
- T026. Tests: note round-trip survives alias rename; alias duplicate
  rejection returns conflicting target id; idempotent re-add of an existing
  alias returns `added=false`.

## Cross-Cutting

- X-1. Update the steering index entry for `specs/023-` once tasks land.
- X-2. Generate a contract snapshot test that fails on enum drift between
  `target.get.json` `ProjectLifecycle` and the spec 009 enum.
- X-3. Add an integration test asserting Targets is not present in the
  primary nav manifest (defensive against accidental promotion).

## Dependency Graph

```
T001 ┐
T002 ┼─► T003 ─► T004 ─► T005 ─► T006 ─► T007
                                  ├─► T008
                                  ├─► T009
                                  └─► T010
                         T005 ─► T012 ─► T013 ─► T014
                         T005 ─► T017 ─► T018 ─► T019
                         T004 ─► T021 ─► T022
                         T004 ─► T024 ─► T025
```

## Out of Scope (v1)

- Target merge/split workflow (alias remove, primary rename, identity
  merge) — deferred to a follow-up spec.
- Observing-plan references (R5) — deferred.
- Year grouping in the sessions list — cosmetic enhancement; flat reverse
  chronological is the v1 cut.
- Promoting Targets to primary navigation — explicitly rejected by design.
