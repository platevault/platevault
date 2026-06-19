# TinySpec: Catalog Entry File (`<slug>.json`) Format + CatalogReader

**Branch**: 033-validation-bugfix-remediation
**Date**: 2026-06-18
**Status**: implemented 2026-06-18 (all tasks done, tests green)
**Complexity**: small (Phase 0 / F3 of the catalog pipeline plan)

## What

Ratify the canonical per-catalog `<slug>.json` entry-file schema that each
`catalog.download` installs, implement the `CatalogReader` (today a reserved
placeholder), and lock the format with a contract test. Gates the
`astro-plan-catalogs` build-script output (S2/F3).

## Decisions (confirmed)

1. **Coordinates**: sexagesimal strings — `ra` in HOURS `"HH MM SS.sss"` (0–24h),
   `dec` in DEGREES `"±DD MM SS.ss"` (−90..+90). Canonical astronomical notation,
   matches OpenNGC/SIMBAD source data. Reader validates field ranges.
2. **`type`**: **closed enum** with an `other` fallback (galaxy, planetary_nebula,
   emission_nebula, reflection_nebula, dark_nebula, open_cluster, globular_cluster,
   supernova_remnant, galaxy_cluster, double_star, asterism, other).
3. **Equivalences**: **in this file** — each entry carries optional
   `equivalents: [{ catalogId, designation }]`; install seeds spec-013
   `CatalogEquivalence` rows from these.
4. **File shape**: single JSON document `{ catalogId, catalogDisplay, version, entries[] }`
   (not NDJSON) for v1, incl. ~13k-entry OpenNGC (~2 MB; single-blob checksum/sign).
5. **Casing**: camelCase wire format (consistent with F1).

## Context

| File | Role |
|------|------|
| `crates/targeting/catalogs/src/loader.rs` | Modified — replace placeholder `CatalogReader` with entry structs + JSON reader + validation |
| `crates/targeting/src/catalog.rs` | Context — `CatalogId` closed enum + `CatalogRef` the reader maps onto |
| `crates/contracts/core/src/catalogs.rs` | Modified — add `CatalogEntryFile` / `CatalogEntry` DTOs (camelCase) |
| `specs/014-catalog-index-licensing/contracts/catalog.entry-file.json` | New — JSON Schema for the entry file (canonical wire contract) |
| `tests/contract/catalog_entry_file_test.rs` | New — round-trip + rejection conformance test |

## Requirements

1. Entry-file schema = `{ catalogId, catalogDisplay, version, entries: [...] }`; each entry =
   `{ designation, names[], ra, dec, type, constellation?, magnitude?, equivalents?[] }`
   where `equivalents` = `[{ catalogId, designation }]`.
2. `catalogId` MUST be in the closed slug enum (reuse `validate_slug`); else reject.
3. `ra` = sexagesimal hours `"HH MM SS.sss"`, `dec` = sexagesimal degrees `"±DD MM SS.ss"`;
   the reader validates component ranges (H 0–23, D 0–90, M/S 0–59) and rejects malformed values.
4. `type` parses to the closed enum; unknown string → `other` (no hard fail).
5. `CatalogReader` reads a `<slug>.json` byte slice → validated entries; pure, no I/O assumptions in the type.
6. Each `equivalents` entry's `catalogId` MUST also be in the closed slug enum.
7. camelCase round-trips identically through the contract DTO and the reader (mirror the F1 parity test).

## Plan

1. Add `catalog.entry-file.json` JSON Schema under `specs/014/contracts/`.
2. Add `CatalogEntry` + `CatalogEntryFile` DTOs (camelCase) to `contracts_core::catalogs`.
3. Implement reader + entry structs + `ObjectType` enum + typed errors in `loader.rs`.
4. Add the contract test (valid sample parses on both sides; bad slug / bad coords / bad JSON rejected).

## Tasks

- [x] Author `specs/014-catalog-index-licensing/contracts/catalog.entry-file.json`
- [x] Add `CatalogEntry`/`CatalogEntryFile`/`ObjectType`/`CatalogEntryEquivalent` DTOs to `contracts_core`
- [x] Implement `read_catalog_file` + structs + `ObjectType` + coordinate/slug validation in `loader.rs`
- [x] Add `tests/contract/catalog_entry_file_test.rs` (round-trip parity + rejections)
- [x] `cargo fmt` + `cargo clippy --workspace -D warnings` + `cargo test --workspace` clean

## Done When

- [x] All tasks checked off
- [x] Tests pass (10 loader unit + 5 parity + workspace 68 ok)
- [x] No lint errors (workspace clippy + fmt clean)
- [ ] `astro-plan-catalogs/build/compile.py` output format updated to match (tracked in S2, separate repo)
