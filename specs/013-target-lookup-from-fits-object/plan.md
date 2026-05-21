# Implementation Plan: Target Lookup From FITS OBJECT

**Branch**: `013-target-lookup-from-fits-object` | **Date**: 2026-05-20 |
**Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/013-target-lookup-from-fits-object/spec.md`

## Implementation Status: NOT IMPLEMENTED

No crates, packages, or contracts have been generated. The `crates/targeting/`
crate referenced below does not yet exist on disk.

## Summary

Resolve the FITS `OBJECT` header value to a stable target identity by querying a
bundled local catalog (Messier, NGC, IC, popular common names) with exact and
fuzzy matchers. Lookup is offline-first, non-blocking, and returns ranked
candidates with explicit confidence and evidence so the UI can show a single
suggestion for high-confidence matches and a chooser for ambiguous ones.

## Technical Context

**Language/Version**: Rust 1.75+ for the targeting crate; TypeScript surface
generated from JSON Schema contracts.
**Primary Dependencies**: bundled static catalog data (no network), a fuzzy
string matcher (candidate: `strsim` or `rapidfuzz-rs`), `serde` for catalog
parsing.
**Storage**: bundled read-only catalog file shipped with the app; resolved
target identities persisted via `crates/persistence/db/` (out of scope here).
**Testing**: `cargo test` for the targeting crate; contract round-trip tests
against the JSON Schemas in `contracts/`.
**Target Platform**: desktop (Tauri host), invoked by `crates/app/core/`.
**Project Type**: pure-domain Rust crate plus operation contracts.
**Performance Goals**: P95 lookup latency under 10 ms on the bundled catalog
(~20k entries) on a warm in-memory index.
**Constraints**: offline by default, no network calls in v1, deterministic
matching, no hidden mutations of the target catalog.
**Scale/Scope**: catalog size on the order of 10k–30k entries; typical session
issues at most a handful of lookups during ingestion.

## Architecture

Three collaborating components inside a new `crates/targeting/` crate:

1. **Catalog reader** — Loads the bundled Messier, NGC, IC, and popular-names
   sources into an in-memory `TargetCatalog`. Reads happen once at startup;
   the catalog is immutable for the application lifetime.
2. **Alias resolution** — Normalizes incoming queries (trim, casefold, collapse
   whitespace, strip punctuation, expand catalog prefixes such as `M`/`NGC`/
   `IC`) and looks them up against a canonical alias index keyed to a stable
   `target_id`.
3. **Fuzzy matcher** — When the normalized exact-match path fails, runs a
   bounded fuzzy search (token-set similarity plus prefix/edit distance) over
   the alias index, returning ranked candidates with evidence and a confidence
   bucket (`high`, `medium`, `low`).

The `target.resolve` operation wraps these for the single-value FITS OBJECT
case; `target.lookup` exposes the ranked-results form for the catalog picker
UI. Both are surfaced through `crates/app/core/` as use cases and through
`packages/contracts/` to the desktop UI.

## Constitution Check

- Local-first file custody: catalog data is bundled and read-only; image files
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
