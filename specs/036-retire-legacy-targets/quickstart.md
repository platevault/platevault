# Quickstart: Retire Legacy Target Tables

Manual verification once implemented. Run on a **fresh** database (greenfield).

## Schema / build (US1)

1. Delete the local DB, start the app (or run migrations). It starts cleanly.
2. Inspect schema:
   - `target`, `targets`, `target_aliases`, `target_catalog_refs`, `catalog_equivalences`
     do **not** exist.
   - `canonical_target` has a `display_alias` column; `target_alias.kind` accepts `user`.
   - `projects`/`project_sources`/`acquisition_session` have **no** legacy `target_id`/
     `acq_target_id` columns; `projects.canonical_target_id` exists.
3. `rg` for `targets`/`target_aliases`/`target.lookup`/`target.note.update`/
   `target.primary.rename` in `crates/` + `apps/` → no live references.
4. Gates green: `cargo test --workspace`, `cargo clippy --workspace --all-targets -D
   warnings`, `cargo fmt --check`, `just typecheck`, `vitest`, bindings drift check.

## Targets page — view + aliases (US2)

5. Resolve a target (e.g. search `M 31` in project creation or Cmd+K) so a
   `canonical_target` exists.
6. Open the Targets page (primary nav) → select the target. Confirm: primary designation,
   object type, coordinates, and alias list render (from gen-3). No note box. No
   primary-rename control.
7. Add an alias ("My Andromeda") → it appears in the list and persists across reload.
8. Remove that alias → it disappears. Confirm a SIMBAD-derived designation (e.g.
   `NGC 224`) has no remove affordance / refuses removal.
9. Add a duplicate of an existing alias → rejected with a clear message.

## Display alias (US3)

10. Set a display alias ("Backyard Andromeda"). The target now shows that label on the
    Targets page, in the list, and anywhere the target is referenced; the canonical
    `primaryDesignation` is unchanged (still `M 31`).
11. Re-resolve the same target against SIMBAD → the display alias is still "Backyard
    Andromeda" (not overwritten).
12. Clear the display alias → the label reverts to `M 31`.

## Regression

13. Inbox/inventory list shows no error and no missing-data regression where a legacy
    target-name column used to (empty) appear.
14. Project creation target selection + ProjectDetail "Target" card (spec 035) still work.
