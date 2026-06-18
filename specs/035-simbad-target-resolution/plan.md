# Implementation Plan: SIMBAD Target Resolution

**Branch**: `035-simbad-target-resolution` | **Date**: 2026-06-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/035-simbad-target-resolution/spec.md`

## Summary

Resolve astronomical target identities (from FITS `OBJECT` headers and from the project-creation
search box) **on demand against SIMBAD**, backed by a **bundled seed index** of popular catalogues
that pre-populates a **local SQLite cache** at first run. Interactive typeahead is served instantly
from local data; long-tail queries hit SIMBAD (debounced, cancellable) and are cached. Ingest
resolution is **asynchronous** (background queue, pending until resolved). Users may **override** a
resolution (persisted, wins over SIMBAD). An **enable/disable** setting (default ON) controls online
resolution. This **supersedes** spec 014's download/manifest/minisign catalog feature and reverses
spec 013's R4 deferral of online providers; it **reuses** the spec-013 target-identity model.

## Technical Context

**Language/Version**: Rust 1.95 (workspace crates); TypeScript 5 / React 19 (frontend); Tauri 2 shell.

**Primary Dependencies**: `reqwest` (HTTPS to SIMBAD TAP `sim-tap/sync` + Sesame `sim-id`); `serde`/`serde_json`; `tokio` (async + `broadcast` event bus); SQLite via `crates/persistence/db`; `tauri-specta` (TS bindings); frontend TanStack Query/Router + Base UI. Reuses `crates/targeting` (`CatalogId`, `CatalogRef`, `TargetCatalog`, normalize/match).

**Storage**: SQLite (local cache: resolved targets + aliases + source + resolved_at; resolver settings). A **bundled seed asset** (SQLite db or JSON) shipped in the app bundle, loaded into the cache at first run.

**Testing**: `cargo test` (crate unit + `tests/contract` conformance, parity of DTO ↔ wire); a `FakeResolver` seam (no real network in unit tests, mirroring the old `FakeFetcher`); Playwright MCP for the search/settings UI; a gated online integration test against SIMBAD.

**Target Platform**: Windows / macOS / Linux desktop (Tauri 2).

**Project Type**: Desktop app (Tauri + React frontend + granular Rust crates).

**Performance Goals**: local typeahead suggestions < 100 ms (SC-001); SIMBAD long-tail debounced ~300 ms, cancellable; each object resolved at most once (cache).

**Constraints**: connectivity assumed at import/organize time; graceful degrade to seed+cache when offline; polite SIMBAD usage (debounce, min query length, cancel-in-flight, cache, identifying `User-Agent`); never fabricate coordinates.

**Scale/Scope**: seed ≈ 14k+ objects (NGC/IC + M/C + named + popular survey objects), a few MB; cache grows by distinct objects a user actually images/searches (hundreds).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Local-First File Custody** — PASS. Image files are never copied/moved by this feature;
  resolution produces metadata (target identity + associations) only. The local SQLite cache holds
  metadata, not image files.
- **II. Reviewable Filesystem Mutation** — PASS (N/A). This feature performs no filesystem mutation
  of user images; it writes cache/association rows. Catalog/target resolution + override events are
  audited (§V). No move/copy/delete plans involved.
- **III. PixInsight Boundary** — PASS. No calibration/registration/stacking/editing; resolution is
  name→identity metadata only.
- **IV. Research-Led Domain Modeling** — PASS. SIMBAD/VizieR/OpenNGC sourcing + the resolve-on-demand
  decision are documented (this spec + `docs/development/catalog-data-pipeline-plan.md`, with live
  SIMBAD coverage verification).
- **V. Portable Contracts & Durable Records** — PASS. The resolver is exposed via language-neutral
  operation contracts (`target.resolve`, `target.search`, resolver settings); the SQLite cache is the
  durable record; SIMBAD results are reproducible projections cached locally.

**Result**: No violations. Note: spec 014/013's catalog-download decisions are superseded (reconciled
via supersession banners in 002/003/013/014/018/033); this is a research-backed direction change, not
a constitution violation.

## Project Structure

### Documentation (this feature)

```text
specs/035-simbad-target-resolution/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (target.resolve / target.search / resolver settings)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
crates/
├── targeting/                     # REUSE: CatalogId, CatalogRef, canonical target, normalize, match
│   ├── src/catalog.rs             # target-identity model (kept)
│   └── resolver/                  # NEW: Resolver trait + SimbadResolver + FakeResolver + cache lookup
│       ├── simbad.rs              # SIMBAD TAP/Sesame client (reqwest), response → canonical identity
│       ├── cache.rs               # cache read/write, dedupe by SIMBAD oid, source precedence
│       └── seed.rs                # bundled-seed load at first run
├── persistence/db/
│   └── migrations/                # NEW migration: resolution cache + resolver settings; supersede 0016_catalogs
├── contracts/core/src/
│   └── targets.rs                 # NEW/EXTEND: target.resolve / target.search / resolver-settings DTOs
└── app/core/src/                  # use-case orchestration: search, resolve, ingest-resolve queue, override

apps/desktop/
├── src-tauri/src/commands/
│   └── targets.rs                 # Tauri commands: target_search, target_resolve, target_override, resolver_settings(_update)
└── src/
    ├── components/                # target search/typeahead (debounced) + optional catalogue/type filter
    └── settings/                  # resolver settings (enable toggle, endpoint, cache) — replaces catalog manifest UI

assets/seed/                       # NEW: bundled seed index asset (built once from SIMBAD+OpenNGC)
tests/contract/                    # conformance: DTO↔wire parity; SIMBAD response mapping; cache precedence
```

**Structure Decision**: Reuse the existing `crates/targeting` target-identity model and add a
`targeting::resolver` module (Resolver trait + `SimbadResolver`/`FakeResolver` + cache + seed loader),
mirroring the testable-seam pattern the old `download::CatalogFetcher` used. The catalog-download
machinery in `crates/targeting/catalogs` (`download.rs`/`loader.rs`) and spec-014 contracts are
retired. New operation contracts live in `crates/contracts/core` + `packages/contracts`. The Tauri
`commands/catalogs.rs` surface is replaced by a `targets.rs` resolver surface.

## Complexity Tracking

> No constitution violations — section intentionally empty.
