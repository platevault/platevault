# Implementation Plan: Frame pixel review and measurements

**Branch**: `067-frame-review`
**Spec**: [067-frame-review](spec.md)
**Date**: 2026-10-05

## Summary

Implement the PIX contract on the rebuilt 064 backend. A new pure Rust pixel crate decodes FITS and XISF samples in their stored type with scaling, CFA evidence and invalid-sample masks. It measures background, noise and stars with the qualified method `platevault.stars` version 1 and renders stretched display tiles that cannot reach measurement. The catalog stores measurement runs and cached records bound to the SHA-256 of the measured bytes. It also stores reviewed and confirmed SubframeSelector imports. A core `FrameReview` service runs a cancellable, prioritized measurement queue and an in-memory preview cache. Measuring, previewing and importing write only measurement tables. They never change source files, quality, membership or exclusions. [Research](research.md) records the source evidence, the defaults R1 through R22 and the cross-spec seams.

## Technical Context

- Language: Rust workspace toolchain, edition 2021, on the 064 crates `platevault_model`, `platevault_core`, `persistence_library` and `desktop_shell`, plus the new `platevault_pixels`.
- Dependencies: workspace serde, sqlx SQLite, Tokio, UUID, time, sha2, hex and quick-xml. The pinned workspace `csv` crate gets its first consumer. fits-header 0.4.3 and xisf-header 0.4.4 supply header cards and keywords. flate2, already in the lock, becomes a direct dependency, and base64 0.22, also in the lock, encodes tiles. lz4_flex is the one new crate. The workspace forbids `unsafe`, so reads stream and never memory-map.
- Storage: the clean library catalog at the next schema version after its dependencies, with tables from `measurements.sql`. The order is 064 (6), 065 (planned 7), 066 (planned), then 067, which takes the integration base's version plus one. Older development catalogs are refused and reset. No legacy data is imported. Previews live only in memory.
- Platform: desktop Tauri 2 isolated library shell on macOS, Windows and Linux. Host proof is macOS; other-platform gates stay explicit.
- Testing: failing-first behavior tests with generated FITS/XISF in the seven test files listed under Source. After integration, run `cargo test --workspace`, `just db-boundary` and the dev-surface guard. Real development Tauri MCP scenarios follow.
- Performance goals, measured and reported but not certified: frame states for 208 frames come from one catalog read with no source access. A 512-pixel tile renders from a decoded plane without reading the file again. Measurement uses all but one core under a 1 GiB decode budget and never delays a preview. Decode and measurement time on 26 to 60 megapixel frames is open question O7.
- Constraints: SQL only under `crates/persistence`. No debayering, no output image and no stretched data in measurement. Unknown evidence stays explicit, and every value names its units, method and source.

## Constitution Check

Pre-research gate: pass. Post-design recheck: pass.

- I Local-first custody: sources are read only through the catalog's contained no-follow reader, with stats and the folder chain re-checked after each read. PIX writes no image, preview or cache file. Hash manifests before and after every scenario prove it.
- II Reviewable mutation: the feature adds no filesystem mutation. An import changes the catalog only after a durable review and an explicit confirmation.
- III PixInsight boundary: PIX calibrates, debayers, registers, integrates and edits nothing, and produces no output image. CFA data is inspected as the recorded mosaic plane. Display stretch exists only in memory tiles, as the root assumptions require.
- IV Research-led modeling: research.md compares alternatives for crate placement, source reading, formats, CFA, masks, the fit model, caching, queueing, preview transport and CSV matching. It records defaults and the qualification fixtures D03 requires.
- V Portable contracts: [contracts/frame-review.md](contracts/frame-review.md) is a versioned language-neutral command contract with states, revisions, events and errors. A confirmed import is a Tier 1 user decision committed before acknowledgment. Runs and records are Tier 2, re-derivable from the files, and still commit on the FULL-synchronous writer.

The all-human-gate waiver leaves analysis, tests, independent review and Sniff mandatory.

## Project Structure

### Documentation

```text
specs/067-frame-review/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── frame-review.md
│   └── modules.md
└── checklists/requirements.md
```

No `tasks.md`: executable task state lives under the molecule implement step in Beads.

### Source

- `crates/platevault-pixels/`: new workspace crate. `src/plane.rs` holds stored samples, scaling, masks and plane kinds. `src/decode/` holds FITS and XISF decoding. `src/{measure,stats,stars,psf,hfr}.rs` hold method version 1, `src/display.rs` stretch, tiles and regions, and `src/fixtures.rs` the seeded generator and writers behind the `fixtures` feature.
- `crates/platevault-model/src/frame_review.rs`: shared wire types and validation, re-exported from `lib.rs`.
- `crates/persistence/library/src/measurements.sql` and `src/measurements.rs`: run, record and import tables, frame-record validity, import confirmation and `read_contained`. `lib.rs` wires the module, the schema increment and interrupted-run recovery.
- `crates/platevault-core/src/subframe_csv.rs`: pure CSV parsing, column classification and row matching.
- `crates/platevault-core/src/frame_review.rs`: the queue, workers, preview cache and import review. `library.rs` creates it in `Library::open` and exposes `frame_review()`.
- `apps/desktop/src-tauri/src/commands/frame_review.rs`: the sixteen `pix_*` handlers, registered in `library_shell.rs` with a `pix_measurement_progress` bridge.
- Tests: `crates/platevault-pixels/tests/{decode.rs,measure.rs,display.rs}`, `crates/persistence/library/tests/measurements.rs` and `crates/platevault-core/tests/{subframe_csv.rs,frame_review.rs,measurement_import.rs}`, with wire-form cases in `crates/platevault-core/tests/model.rs`.

[contracts/modules.md](contracts/modules.md) defines signatures and file ownership.

## Owned interaction steps

| Step | Requirements | Acceptance evidence |
| --- | --- | --- |
| D1 Measure selected sessions | PIX-FR-01 | PIX-AC-01, PIX-AC-06 |
| D2 Select a frame | PIX-FR-02, PIX-FR-03, PIX-FR-04 | PIX-AC-02, PIX-AC-07 |
| D3 Inspect star/PSF diagnostics | PIX-FR-05, PIX-FR-06, PIX-FR-09 | PIX-AC-03, PIX-AC-08, PIX-AC-09 |
| D6 Import existing measurements | PIX-FR-06, PIX-FR-07, PIX-FR-08 | PIX-AC-04, PIX-AC-05 |
| Cross-flow: Measurement pending/failed | PIX-FR-01, PIX-FR-05 | PIX-AC-01, PIX-AC-03 |

## Independent units and integration

The foundation owner lands the workspace registration, the model types, the plane types and the fixture generator first. The decode, measurement, display, catalog and CSV units then work in separate linked worktrees from that recorded commit. None edits foundation files or another unit's files. Measurement and display need only the plane types and fixtures, not the decoder. The integration owner waits for all five and owns `frame_review.rs`, `library.rs`, the composed tests, IPC and the shell wiring.

Workers skip repository-wide builds, tests, lint and formatters. The lead runs the focused tests and one integrated workspace verification, then exact-head independent review and Sniff. Original hashes are checked before and after. VSEL (066) re-verifies PIX-AC-01 cancel retention and PIX-AC-06 with a real draft and quality-state filter. The Frames surface and J22 S1 to S7, S14 and S15 stay open on the final-frontend acceptance task. After five failed fixes, an issue gets a reproducible backlog entry, never a stub.

## Complexity Tracking

| Addition | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| New `platevault_pixels` crate | Pixel decoding and numerical methods need fixture qualification without SQLite or Tauri | The header crates and `metadata_core` are header-only by contract; adding pixels there would make indexing read image data |
| Measurement tables in the library catalog | Records reference assets and validity joins asset fingerprints in one snapshot | A separate store needs a second writer and cannot hold foreign keys to assets |
| `Catalog::read_contained` | Decoding must read exactly the bytes it hashes under the existing no-follow checks | A second opener in core would duplicate the link, junction and stat checks |
| lz4_flex dependency | XISF lights are often written with lz4 or lz4hc | Naming lz4 unsupported would refuse common capture files |
