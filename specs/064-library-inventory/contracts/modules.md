# Library module contracts

Shared model, exported ports, Cargo dependencies and fixture writers have one foundation owner. Inventory/grouping, catalog and target workers consume this interface and do not edit shared files. No mock/default success path satisfies a contract.

## Paths and identity

`NativePath` is `{encoding: unix-bytes|windows-utf16, payload: number[], display: string}`. Payload is lossless; display is never a lookup key. Relative paths reject absolute/root/parent traversal. IDs are UUIDs. `FileIdentity` records volume/filesystem ID and file ID; locations retain both volume and root identity. Mismatch reports Offline/IdentityConflict and prevents absence reconciliation. Overlapping same-volume roots are refused at registration.

`ObservationFingerprint` includes stable volume identity, size/nanosecond mtime, and file identity only where remount stability is qualified. `ExpectedAsset` carries assetId, expectedDecisionRevision and expectedObservationFingerprint. `ExpectedSession` carries sessionId, groupingRevision and expectedDecisionRevision; superseded sessions return Conflict with successor IDs. Multi-record changes commit all or nothing; decision revisions and observation sequences remain independent.

`CaptureKey` has canonical typed fields defined in data-model.md; equivalent numeric strings normalize identically. `GroupingResult` contains candidate keys and exact asset memberships. `SessionLineage` records predecessor/successor IDs, correction and moved assets. Settings and Target labels never enter capture identity.

## Inventory/grouping owner

`scan(location: &Location, options: &ScanOptions, progress: impl FnMut(ScanBatch) -> Result<(), LibraryError>, canceled: &AtomicBool) -> Result<ScanObservation, LibraryError>`.

A `ScanBatch` includes observed files/errors plus progress; the integration owner can persist it and show sessions before the walk finishes. `ScanObservation` holds complete and uncertain/skipped scopes, root identity evidence and terminal counts. Failed or canceled identity observations are not empty complete scans. A file includes native relative path, identity/fingerprint, format and original typed metadata.

`group_assets(assets: &[Asset]) -> GroupingResult` is pure and reads effective catalog corrections passed in its input. It never queries storage. Measured temperature, mechanical-rotation jitter and pointing remain per-frame evidence; cooler setpoint is a key field. Header-derived noon night and canonical decimals follow data-model.md.

## Catalog owner

`Catalog::open(path: &Path) -> Result<Catalog, LibraryError>` initializes the clean schema with one serialized writer connection and separate readers. Foreign keys, WAL/FULL and macOS fullfsync/checkpoint_fullfsync apply to the writer. No legacy schema is imported.

Operations: register/update/reselect location, begin/apply batch/finish/retry scan, list/status operations, assets/sessions/coverage, metadata preview/confirm, quality decisions, target save/association, equipment save/confirmation and reviewed remap. Reads return persisted scope and revisions.

`apply_correction_and_regroup(expected, corrections, compute_grouping)` validates current observations/decision revisions, applies corrections, calls a supplied pure grouping callback on effective assets and stores grouping/lineage in one transaction. Library supplies the real grouping callback; catalog compiles independently against the shared model/closure contract and implements no stub grouping. Its focused tests exercise real atomic corrections and a simple behavioral grouping calculation, not a mock success echo.

Catalog owns target tables and saved-target alias/coordinate search through shared models. `find_targets(aliasKeys, cone, limit)` returns durable user/provider targets. Library merges seed/saved results by stable identity/provenance. Targets.rs supplies simbad-resolver-normalized keys, owns no schema or writes, and introduces no second normalization implementation.

Remap review durably stores all per-asset identity/digest evidence without source writes. Apply is atomic per location: revalidate every asset, then change the root; any mismatch or NoByteProof leaves all paths unchanged. Hash readable originals/candidates at review and apply, or compare a valid prior fingerprint-bound digest when originals are offline. Source drift preserves historical decisions but excludes stale applicability from usable totals.

## Target owner

`TargetIndex::bundled()` loads seed provenance. Offline search accepts text and optional typed cone `{raDeg, decDeg, radiusDeg}`. `Catalog::find_targets(aliasKeys, cone, limit)` owns saved target search; Library merges seed/saved results by stable identity with provenance. `normalize_alias` delegates to simbad-resolver.

`resolve(query: &str) -> Result<TargetCandidate, LibraryError>` returns provider provenance or explicit failure. Geometry uses shared math/matching. Suggested association needs an agreeing observed alias and qualified coordinate/footprint evidence; a label or separation alone is insufficient. Unknown/conflicting evidence is NeedsReview/Unresolved. Rescans preserve confirmations; regroup inherits a confirmed association only when every successor asset shares it.

## Foundation and integration owners

Foundation owns model.rs/lib.rs, Cargo.toml/Cargo.lock, dependencies/dev-dependencies and `crates/platevault-core/tests/support/mod.rs` FITS/XISF writers. Inventory owns `tests/inventory.rs`, catalog `tests/catalog.rs`, targets `tests/targets.rs`; integration owns `tests/library.rs`. Publish compile-checked pure types and ports before parallel work, with no placeholder implementation. Each worker owns only its module and named behavior tests.
Foundation maps every CaptureKey input to existing RawFileMetadata: image_typ, date_obs/date_loc, observer_long, set_temp_c, readout_mode, instrume/cameraid, telescop/focal_length_mm, exposure/gain/offset, binning and dimensions. These fields exist in metadata_core; metadata adapter/upstream changes, if required by qualification, stay with the foundation owner before fan-out.

`Library` composes catalog/inventory/targets, offloads blocking work, controls scan cancellation/status/events and exposes durable operations. The isolated rebuilt shell uses a distinct data directory and disables legacy command/job registration. Dev MCP is enforced loopback-only in code; release builds reject dev-tools exposure through the existing absence guard and build checks.

Backend acceptance exercises real core/IPC outcomes. UI-dependent LIB criteria and J19 remain explicitly pending a separate final-frontend acceptance task; inspection-only surfaces do not certify them. This preserves backend-first sequencing without closing full feature verification prematurely.

Errors: InvalidInput, NotFound, Conflict, IdentityConflict, SourceUnavailable, UnsupportedFormat, MetadataUnreadable, ProviderUnavailable, PersistenceFailure and Canceled. Every error carries affected identity/scope and retry applicability.
