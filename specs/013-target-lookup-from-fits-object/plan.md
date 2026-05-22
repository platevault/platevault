# Implementation Plan: Target Lookup From FITS OBJECT

**Branch**: `013-target-lookup-from-fits-object` | **Date**: 2026-05-20 |
**Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/013-target-lookup-from-fits-object/spec.md`

## Implementation Status: NOT IMPLEMENTED

No crates, packages, or contracts have been generated. The `crates/targeting/`
crate referenced below does not yet exist on disk.

## Summary

Resolve the FITS `OBJECT` header value to a stable target identity by querying a
downloaded local catalog (thirteen catalogs: Messier, Caldwell, Sharpless 2,
Abell PN, Abell galaxy clusters, Arp, van den Bergh, Barnard, LBN, LDN,
Melotte, common names, and OpenNGC) with exact and fuzzy matchers. Catalog data
is installed by the spec 014 `catalog.download` flow at first run; no catalog
data files are bundled with the app binary. Lookup is offline-first after first
run, non-blocking, and returns ranked candidates with explicit confidence and
evidence so the UI can show a single suggestion for high-confidence matches and
a chooser for ambiguous ones.

## Technical Context

**Language/Version**: Rust 1.75+ for the targeting crate; TypeScript surface
generated from JSON Schema contracts.
**Primary Dependencies**: no bundled catalog data files; catalog rows are read
from SQLite tables installed by spec 014's `catalog.download` flow. A fuzzy
string matcher (candidate: `strsim` or `rapidfuzz-rs`), `serde` for SQLite
row deserialization.
**Storage**: SQLite (owned by `crates/persistence/db/`). The targeting crate
reads catalog and `CatalogEquivalence` rows from SQLite at startup to build an
in-memory index. Resolved target identities (Target rows, target_id FKs on
`acquisition_sessions`) are also persisted to SQLite.
**Testing**: `cargo test` for the targeting crate; contract round-trip tests
against the JSON Schemas in `contracts/`.
**Target Platform**: desktop (Tauri host), invoked by `crates/app/core/`.
**Project Type**: pure-domain Rust crate plus operation contracts.
**Performance Goals**: P95 lookup latency under 10 ms on the in-memory index
(~20k entries) on a warm start.
**Constraints**: offline after first-run download, no network calls in the
targeting crate itself, deterministic matching, no hidden mutations of catalog
data.
**Scale/Scope**: catalog size on the order of 10k–30k entries; typical session
issues at most a handful of lookups during ingestion.

## Architecture

Three collaborating components inside a new `crates/targeting/` crate:

1. **Catalog reader** — At startup, reads all catalog rows and
   `CatalogEquivalence` rows from SQLite (installed by spec 014) into an
   in-memory `TargetCatalog`. On receipt of a `catalog.download.completed`
   event-bus event, the index rebuilds incrementally (or fully for a bulk
   install). No `crates/targeting/data/` folder; no bundled data files in the
   binary.
2. **Alias resolution** — Normalizes incoming queries (trim, casefold, collapse
   whitespace, strip punctuation, expand catalog prefixes such as `M`/`NGC`/
   `IC`) and looks them up against a canonical alias index keyed to a stable
   `target_id`. Cross-catalog equivalences (e.g. M31 ≡ NGC 224) are resolved
   via the `CatalogEquivalence` table seeded at first catalog install (T010-eq,
   T011-eq).
3. **Fuzzy matcher** — When the normalized exact-match path fails, runs a
   bounded fuzzy search (token-set similarity plus prefix/edit distance) over
   the alias index, returning ranked candidates with evidence and a confidence
   bucket (`high`, `medium`, `low`).

Spec 014 is the source of truth for catalog data and the `catalog.download`
flow. The targeting crate has no direct responsibility for catalog acquisition.

The `target.resolve` operation wraps these for the single-value FITS OBJECT
case; `target.lookup` exposes the ranked-results form for the catalog picker
UI. Both are surfaced through `crates/app/core/` as use cases and through
`packages/contracts/` to the desktop UI.

`Target` rows are persisted to SQLite on first catalog install (T010-eq). The
targeting crate caches the index in memory and rebuilds on
`catalog.download.completed`. `acquisition_sessions.target_id` is a real SQLite
FK to `targets.id`.

## Constitution Check

- Local-first file custody: catalog data is downloaded and stored in SQLite;
  no app-owned catalog files are written to user-owned directories. Image files
  are never touched.
- Reviewable filesystem mutation: lookup performs no filesystem mutation.
- PixInsight boundary: no image processing involved.
- Research-led domain modeling: catalog sources, fuzzy algorithm, and
  ambiguity policy are decided in `research.md`.
- Portable contracts and durable records: lookup is exposed via JSON Schema
  operation contracts; resolved identities flow into the existing persistence
  boundary.
- Cross-platform path safety: not applicable (no path handling).

## Phase Plan

- Phase 0 — Research: confirm catalog sources, licensing, and fuzzy algorithm.
- Phase 1 — Design: finalize `data-model.md` and `contracts/`.
- Phase 2 — Tasks: see `tasks.md`.
- Phase 3+ — Implementation: out of scope for this artifact set.
