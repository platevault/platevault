# Implementation Plan: Target Identity, History, And Notes

**Branch**: `023-target-identity-history-notes` | **Date**: 2026-05-20 |
**Spec**: [spec.md](./spec.md)

## Summary

Target detail is a dedicated route (`/targets/$targetId`) that aggregates per
target acquisition history across years, lists projects that reference the
target, exposes alias and catalog references, and stores a free-text user
note. Target identity itself is owned by a new `crates/targeting/` crate; the
detail route is rendered inside the Tauri/React desktop shell. Targets are
**not** added to primary navigation: the only entry points are global Cmd+K
search, Inventory row deep links, and Project source deep links.

This spec follows spec 013 (Target Lookup From FITS `OBJECT`). Spec 013 owns
the FITS hint → suggestion pipeline; this spec owns the durable target record
that suggestions resolve to.

## Constitution Check

- **I. Local-First File Custody**: Target identity, aliases, projects-per
  target, sessions-per-target, and notes are metadata only. No image files
  are touched by this feature.
- **II. Reviewable Filesystem Mutation**: Adding or editing target metadata
  never mutates the filesystem; only spec 017 plans can move files. Target
  rename does not rename folders.
- **III. PixInsight Boundary**: Target detail surfaces processing project
  references; it never inspects or invokes PixInsight/WBPP.
- **IV. Research-Led Domain Modeling**: Identity resolution rules, alias
  conflict policy, history grouping, and notes scope are documented in
  `research.md`.
- **V. Portable Contracts and Durable Records**: Three JSON-Schema contracts
  (`target.get`, `target.note.update`, `target.alias.add`) front the
  use cases. SQLite remains canonical for target identity, aliases, and
  notes.

## Architecture

### Layering

```
apps/desktop (Tauri + React)
  └─ routes/targets.$targetId.tsx           (detail route; not in primary nav)
       ├─ Cmd+K search adapter              (alias-aware)
       ├─ Inventory row deep link
       └─ Project source deep link
            └─ tauri commands: target.get / target.note.update / target.alias.add
                 └─ crates/app/core/usecases/target_*.rs
                      ├─ crates/targeting/                (new crate: identity model)
                      ├─ crates/persistence/db            (target + alias + note tables)
                      ├─ crates/sessions/                 (TargetSession join)
                      ├─ crates/project/structure/        (TargetProject join)
                      └─ crates/audit/                    (note + alias edits)
```

### Domain Layer (`crates/targeting/`)

A new crate that owns:

- `Target { id, primary, aliases, catalog_refs, notes?, created_at, updated_at }`.
- Alias normalization (case-folding, whitespace, hyphen/space variants).
- Alias conflict detection (returns `alias.duplicate` error code when an alias
  is already attached to another target).
- Identity merge/split helpers (deferred behind a feature flag for v1; only
  alias add/remove and primary rename are wired through contracts in v1).

The crate has no Tauri, no DB, and no UI dependency. Persistence is owned by
`crates/persistence/db`.

### Use Case Layer (`crates/app/core/`)

- `target_get(TargetGetRequest) -> Response`: loads the Target record, joins
  `TargetSession[]` from `crates/sessions`, joins `TargetProject[]` from
  `crates/project/structure`, returns aggregate.
- `target_note_update(TargetNoteUpdateRequest) -> Response`: replaces note
  body, refreshes `updated_at`, writes one audit event.
- `target_alias_add(TargetAliasAddRequest) -> Response`: validates the alias
  via the targeting crate, rejects on duplicate (`alias.duplicate`), writes
  the alias and one audit event.

### Contracts

- `target.get`: detail aggregate read.
- `target.note.update`: write per-target note.
- `target.alias.add`: append alias.

Alias removal, primary rename, and identity merge/split are deferred and will
get their own contracts in later specs.

### UI Layer

`apps/desktop/src/routes/targets.$targetId.tsx`:

- Header: primary name, `updated_at` timestamp, alias chips, catalog ref
  chips.
- Sessions section: reverse-chronological list with date, filter, exposure,
  frames; rows deep-link to Inventory.
- Projects section: list of `TargetProject` rows with lifecycle tone; rows
  deep-link to Project detail.
- Notes section: editable text area, debounced save through
  `target.note.update`.

The Cmd+K palette gains alias-aware target results that route to this view.
Inventory rows that have a resolved `target_id` (spec 013) render a button
that opens the same route. Project source rows with a resolved `target_id`
render the same button.

The route is **not** wired into the primary nav. The router config explicitly
excludes Targets from the sidebar manifest.

## Phasing

### Phase 0 — Research (this spec)

- Confirm target identity resolution boundary with spec 013.
- Confirm alias conflict policy.
- Confirm history grouping (per session vs per night).
- Confirm note scope (per-target vs per-session) — both exist and are
  separate.

### Phase 1 — Design

- Finalize `data-model.md`.
- Finalize three contracts.
- Confirm Cmd+K adapter contract surface.

### Phase 2 — Implementation (deferred, gated by review)

1. Stand up `crates/targeting/` with identity + alias logic and unit tests.
2. Add target/alias/note tables to `crates/persistence/db` migration.
3. Add the three use cases in `crates/app/core/`.
4. Generate Rust DTOs and TS types from the three JSON Schemas.
5. Add Tauri command adapters.
6. Build `routes/targets.$targetId.tsx` and wire Cmd+K + Inventory + Project
   entry points.
7. Playwright smoke for each entry point.

## Cross-Spec Links

- **Spec 013 (Target Lookup From FITS `OBJECT`)**: owns the
  hint-to-suggestion pipeline. This spec owns the durable target record that
  resolved suggestions write into.
- **Spec 014 (Catalog Index & Licensing)**: catalog refs displayed on target
  detail are sourced from the catalog index when available.
- **Spec 020 (Router URL State)**: `/targets/$targetId` is registered as a
  detail route only, not as a primary nav entry.
- **Spec 002 (Lifecycle State Model)**: project lifecycle tone shown on the
  projects section reuses the shared tone tokens.

## Risks

- **Alias collision across catalogs**: e.g. "NGC 224" and "M31" both resolve
  to Andromeda. Mitigated by storing aliases as structured `catalog_refs`
  with `(catalog, designation)` shape rather than free strings.
- **Hidden discoverability**: keeping Targets off primary nav means users may
  not know the detail view exists. Mitigated by surfacing target chips on
  Inventory and Project rows; Cmd+K hint copy advertises the route.
- **Note vs session-note confusion**: per-target and per-session notes both
  exist. Mitigated by distinct UI affordances and a research decision (R4)
  documenting the separation.
