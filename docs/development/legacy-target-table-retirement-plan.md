# Legacy target-table retirement plan

**Status:** PLAN ONLY — not executed. This is a sprawling, cross-spec refactor that
breaks live features if done naively; it needs its own SpecKit feature and a couple
of product decisions (called out below). Do **not** drop the tables before the
prerequisite rewrites land.

## Why this exists

Spec 035 introduced a third generation of target storage. Three now coexist:

| Gen | Tables | Migration | Status |
|-----|--------|-----------|--------|
| 1 (legacy) | `target` (singular) | 0002 | abandoned — never written by modern code |
| 2 (spec 013/023) | `targets`, `target_aliases`, `target_catalog_refs`, `catalog_equivalences` | 0017, 0027 | **ACTIVE** — Targets page, catalog load, identity UI |
| 3 (spec 035, keeper) | `canonical_target`, `target_alias` | 0031, 0033 | keeper |

Goal: retire gen 1 + gen 2, keep gen 3.

## Blast radius (why it is NOT a simple DROP)

Retiring gen 2 breaks these **live** paths unless they are rewritten first:

1. **In-memory catalog** — `crates/targeting/src/load.rs:40,51` reads `targets` +
   `target_catalog_refs` to build the catalog used by spec-013 `target.lookup` /
   `target.resolve.fits`. Drop the tables → empty catalog.
2. **Targets page identity UI (spec 023)** — `crates/app/core/src/target_identity.rs`
   + `apps/desktop/src-tauri/src/commands/target_identity.rs` expose 5 live commands
   (`target.get`, `target.note.update`, `target.alias.add/remove`,
   `target.primary.rename`) that read/write `targets`/`target_aliases`. These back the
   primary-nav "Targets" page (spec 033 design-v4). Drop → page breaks.
3. **Inventory projection (spec 006)** — `crates/persistence/db/src/repositories/inventory.rs:137`
   `LEFT JOIN target t ON t.id = acs.target_id` (gen-1 table) for `target_name`.
4. **Project / session / source FK columns** — `projects.target_id`,
   `project_sources.target_id`, `acquisition_session.acq_target_id` (all 0027), plus
   `acquisition_session.target_id` (0002). Legacy projects may carry `target_id` with
   no `canonical_target_id`.

`crates/app/core/src/ingest_resolution.rs` and `project_setup.rs` already use gen 3
only — they are safe.

## Product decisions required (cannot proceed without these)

- **D1 — Target notes.** Gen-3 `canonical_target` has **no `notes` field**; spec-023
  notes live on `targets.notes`. Decide: add `notes`/`updated_at` to `canonical_target`
  (or a side `canonical_target_notes` table), or drop the notes feature.
- **D2 — Primary-designation rename.** Spec-023 `target.primary.rename` edits
  `targets.primary_designation` freely. Gen 3 derives the primary from
  `target_alias.kind='designation'` + `canonical_target.primary_designation` sourced
  from SIMBAD. Decide whether user free-rename of a SIMBAD-canonical target is still
  allowed, and how it persists (manual-override precedence already exists for
  resolution; rename is a different axis).
- **D3 — Targets page.** Confirm the Targets page is rebuilt on gen-3 data (it must be,
  since its commands get rewritten).

## Dependency-ordered execution (each step ships + is verified before the next)

1. **Catalog load → gen 3.** Rewrite `targeting::load::load_from_db()` to read
   `canonical_target` + `target_alias`. Keep `target.lookup`/`target.resolve.fits`
   working off gen 3 (or retire `target.resolve.fits`, already superseded by spec-035
   `target.resolve` and not called by the frontend).
2. **Identity commands → gen 3.** Rewrite the 5 `target_identity` use-cases + commands
   to `canonical_target`/`target_alias` (needs D1/D2). Migrate the Targets page (D3).
3. **Inventory projection → gen 3.** Repoint `inventory.rs` `target_name` join at the
   keeper table; backfill/relink `acquisition_session` target ids.
4. **Project link backfill.** For every `projects.target_id IS NOT NULL AND
   canonical_target_id IS NULL`, resolve/create the gen-3 `canonical_target` and set
   `canonical_target_id`. Verify zero remaining before step 6.
5. **project_sources.target_id audit.** Confirm dead (no reads/writes found) or add a
   parallel `canonical_target_id` and migrate.
6. **Retirement migration (e.g. `0034_retire_legacy_targets.sql`).** Append-only. Drop
   FK columns (`projects.target_id`, `project_sources.target_id`,
   `acquisition_session.acq_target_id`, `acquisition_session.target_id`) and tables
   (`target_aliases`, `target_catalog_refs`, `catalog_equivalences`, `targets`,
   `target`) with `IF EXISTS`. SQLite needs table rebuilds to drop columns.
7. **Cleanup.** Remove `repositories/targets.rs`, the gen-2 contract DTOs, and dead
   commands; update specs 013/023/006/008 docs to point at gen 3.

## Recommendation

Run this as a dedicated SpecKit feature (`/speckit.specify` "retire legacy target
tables, consolidate on spec-035 canonical_target") so D1–D3 get clarified and each
rewrite step is tasked + verified. Estimated effort: multi-day, not a single PR.
Executing it blind/unattended would break the Targets page, catalog lookup, and the
Inbox target column.
