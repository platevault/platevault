# Library rebuild research

## Decision

Use a new `platevault_core` Rust crate with a clean SQLite catalog. Reuse verified header extraction and no-follow primitives; do not import the old database or orchestration. The desktop shell adopts this backend through explicit Tauri commands. The old implementation remains a recoverable Git baseline during the staged cutover and is removed from the active application after the rebuilt backend contracts are complete.

## Source evidence

Read-only `LibraryRebuildScout` mapped baseline `94a3dc958c13e297baf501aa2721efa2c2628622`. No runtime correctness is claimed by that review.

- `crates/metadata/core/src/lib.rs` defines read-only `MetadataExtractor` and `RawFileMetadata` including camera, exposure, filter, gain, offset, binning, dimensions, readout, temperature, pointing and WCS evidence.
- `crates/metadata/fits` uses fits-header 0.4.3; `crates/metadata/xisf` uses xisf-header 0.4.3. Both read headers without modifying inputs.
- `crates/fs/pathsafe/src/lib.rs` distinguishes unavailable roots and links/junctions. Existing Inbox scanning silently skips some file errors and is not suitable as the new full inventory reconciler.
- The old `crates/sessions/src/key.rs` includes Target and omits camera/exposure/offset/readout. Its ingest caller falls back to the current date. Neither behavior satisfies capture identity independent of Target or deterministic missing-evidence handling.
- The bundled `assets/seed/seed.json` is a reusable catalog dataset with provider provenance. Reuse the asset, shared alias normalization and SIMBAD APIs without the old AppState/cache/database coupling.
- Existing development bridge uses `dev-tools`, the dev config overlay and `PV_MCP_BRIDGE_ENABLE=1`. Real app verification must use those settings with loopback binding; release builds omit the unauthenticated plugin.

## Boundaries and defaults

CaptureKey uses canonical typed frame type, header-derived night/date basis, camera, optical-train evidence, filter, exposure, gain, offset, binning, dimensions, readout and cooler setpoint. Measured temperature, pointing and mechanical-rotation jitter remain per-frame evidence rather than exact identity fields. Decimal-equivalent values share canonical encoding. Night uses DATE-LOC/noon or header longitude with a labelled mean-solar noon boundary; otherwise a provisional UTC date is shown. No clock, app settings, OBJECT or Target fallback enters identity. Reviewed key changes produce grouping lineage.

Inventory is progressive and read-only. Registration records volume and root-file identity and rejects overlapping locations; scans revalidate that identity before absence reconciliation. Asset identity uses volume/file identity plus lossless path records. Source drift invalidates decision applicability. Full-image hashes are lazy for explicit identity/custody work and stored against their observed fingerprint. Offline remap without valid prior digest refuses rather than guesses. Partial, unreadable and skipped-link scopes never imply Missing.

One serialized SQLite writer owns short scan-batch transactions and synchronous user decisions. WAL, foreign keys and FULL synchronous apply to the writer connection; macOS uses fullfsync/checkpoint_fullfsync. Correction, current-evidence regroup and lineage commit together. Per-record decision revisions are independent of scan sequences. Failed transactions report errors, never saved success.

## Shared packages

Verified repositories: [skymath](https://github.com/nightwatch-astro/skymath), [simbad-resolver](https://github.com/nightwatch-astro/simbad-resolver), [target-match](https://github.com/nightwatch-astro/target-match), [fits-header](https://github.com/nightwatch-astro/fits-header), [xisf-header](https://github.com/nightwatch-astro/xisf-header).

The baseline uses skymath 0.7.2, SIMBAD 0.5.0 and target-match 0.5.1. Target-match re-exports a different skymath version; adapters must convert through degree values rather than assume type identity. Reusable algorithm changes belong upstream; application catalog and lifecycle code stay in PlateVault.

## Alternatives

Retrofitting the old SQLite schema would retain conflicting roots/source/session models. Copying its Inbox grouping key would silently retain arbitrary classification tolerances. A network-only target catalog would violate local-first use. These alternatives are not selected.

## Qualification

Actual fixtures must cover valid and malformed FITS/XISF, progressive indexing, per-file errors, partial/offline scans, restart, stale edits, remap mismatch, target enrichment failure and unchanged originals. Supported-platform and real development-MCP evidence remain acceptance gates. No imported old test result proves the rebuild.
