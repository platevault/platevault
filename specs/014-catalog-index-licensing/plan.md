# Implementation Plan: Catalog Index Licensing

**Branch**: `014-catalog-index-licensing` | **Date**: 2026-05-20 | **Spec**:
[spec.md](./spec.md)

## Summary

This feature owns two surfaces that share a single registry:

1. A CI-generated minimal catalog index (Messier, NGC, IC; user-added
   catalogs registered locally) bundled with the app for offline target
   lookup.
2. A Settings → Catalogs page that lists registered catalogs and the
   license attribution required to ship them.

The catalog registry lives in `crates/targeting/catalogs/`. License
metadata is bundled alongside each catalog file, never inferred at
runtime. The Settings page reads the registry through two contracts
(`catalog.list`, `catalog.attribution.get`) and renders nothing else —
acquisition/transforms remain CI-side.

## Constitution Check

- **I. Local-First File Custody**: Catalog index files are app-owned
  resources, not user image files; they live inside the app bundle (or
  user-added directory) and are referenced by id, never by absolute path
  in user-visible state.
- **II. Reviewable Filesystem Mutation**: Catalog updates are atomic
  swaps with the previous bundle retained until verification; the swap
  is recorded in the audit log under `catalog.updated`.
- **III. PixInsight Boundary**: Catalogs feed target lookup only; no
  catalog feature performs image processing or alters processing output.
- **IV. Research-Led Domain Modeling**: Format, license obligation, and
  update strategy decisions are recorded in `research.md` before any
  catalog file ships.
- **V. Portable Contracts and Durable Records**: `catalog.list` and
  `catalog.attribution.get` are JSON-Schema contracts; the registry
  state is durable in SQLite, and license attribution text travels with
  the bundle, not the binary.

## Architecture

### Layering

```
apps/desktop (Tauri + React)
  └─ features/settings/catalogs/* hooks
       └─ tauri commands: catalog.list / catalog.attribution.get
            └─ crates/app/core/usecases/catalogs.rs
                 ├─ crates/targeting/catalogs/registry.rs (registry)
                 ├─ crates/targeting/catalogs/license.rs  (attribution model)
                 ├─ crates/persistence/db (catalog table + audit hooks)
                 └─ crates/audit (catalog.* events)
```

### Catalog Registry (`crates/targeting/catalogs/`)

- `registry.rs`: read-only listing of known catalogs. Built-in catalogs
  are compiled into the binary via a generated manifest produced from
  the CI bundle; user-added catalogs are read from the SQLite `catalog`
  table joined with the on-disk index file.
- `license.rs`: `LicenseAttribution` model and a loader that pairs each
  registered catalog id with a sidecar attribution record produced by
  CI. Attribution text is stored verbatim — never templated at runtime.
- `loader.rs` (out-of-scope here): file-format readers (CSV/JSON
  variants) live behind a `CatalogReader` trait; only the registry
  metadata and license attribution are in v1 contract scope.

### Settings Page

`apps/desktop/src/features/settings/catalogs/`:

- `CatalogsPage` (replaces the empty stub) is composed of two sections:
  - **Available catalogs**: table with id, name, version, license short
    code, origin badge, source link, last-updated date. Sourced from
    `catalog.list`.
  - **License attribution**: read-only panel grouped by catalog id,
    showing full notice text + source link. Sourced from
    `catalog.attribution.get`. Provides a "Copy NOTICE" action that
    serialises the visible attributions into a single buffer suitable
    for downstream redistribution.

### Contracts

- `catalog.list`: request is `{}` (no filters); response returns
  `catalogs: Catalog[]` ordered by origin (built-in first) then name.
- `catalog.attribution.get`: request is `{}`; response returns
  `attributions: LicenseAttribution[]`. Separation from `catalog.list`
  keeps the attribution payload (which may be large) out of the
  metadata listing.

### CI / Bundling

CI is owned by the wider repo workflow (out of this spec's
implementation scope). The plan only records that:

- CI consumes catalog source definitions and emits a manifest plus
  per-catalog index file and per-catalog attribution sidecar.
- Manifest + sidecars are committed into the app bundle's resources
  directory and the registry loader reads them at startup.

## Phasing

### Phase 0 — Research (this spec)

- Decide bundle formats (CSV vs JSON vs FITS extension).
- Confirm license obligations per catalog (Messier, NGC, IC, common
  name lists).
- Define update strategy: atomic swap, version pinning, rollback.

### Phase 1 — Design

- Finalize `data-model.md` for `Catalog` and `LicenseAttribution`.
- Finalize the two contracts in this directory.
- Document the CI manifest shape (separate task; out of v1 scope).

### Phase 2 — Implementation (deferred, gated by review)

1. Add `crates/targeting/catalogs/` skeleton with the registry and
   license model and an in-memory test fixture.
2. Add `crates/app/core/usecases/catalogs.rs` with `list` and
   `attribution.get` use cases.
3. Generate Rust DTOs and TypeScript types from the two contracts.
4. Replace the empty Settings → Catalogs stub with the two-section
   page driven by Tauri commands.
5. Add a Playwright smoke verifying that Messier, NGC, and IC appear
   with non-empty attribution text.

## Cross-Spec Links

- **Spec 013 (Target Lookup from FITS OBJECT)** is the primary consumer
  of the bundled index; this spec MUST keep the minimal-fields shape
  defined there (`name, identifiers, RA, DEC, source`).
- **Spec 018 (Settings Configuration Model)** owns the Settings shell;
  this spec contributes the Catalogs nav entry's content only.
- **Spec 023 (Target Identity, History, Notes)** may, in a future
  revision, surface the catalog source on a target detail page; the
  `Catalog.id` shape exposed here is stable enough to reference.

## Risks

- **Attribution drift**: If a CI-bundled catalog updates its required
  notice text mid-version, the in-app panel will silently lag until
  the next bundle. Mitigation: every catalog update bumps the version
  and is audit-logged.
- **User-added catalogs without license metadata**: Users may try to
  register catalogs that lack attribution. The registry MUST refuse
  registration unless the user supplies attribution text and an
  acknowledgement that they may not be allowed to redistribute the
  app with that catalog included.
- **Bundle size**: Even minimal indexes can grow. The plan defers the
  size cap to research and does not assume a number.
