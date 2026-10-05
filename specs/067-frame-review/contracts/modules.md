# Frame review module contracts

The foundation owner publishes the shared model types, the pixel crate's plane types and the fixture generator before parallel work. The decode, measurement, display, catalog and CSV workers code against those types and this contract and leave foundation files alone. No mock, empty default or placeholder success satisfies a contract.

## Shared model

`crates/platevault-model/src/frame_review.rs`, re-exported from `lib.rs`, defines the wire types of the [IPC contract](frame-review.md). These are `MeasurementMethod`, `PlaneBasis`, `CfaEvidence`, `SaturationSource`, `MaskCounts`, `InputBasis`, `MetricId`, `Units`, `MetricValue`, `StarState`, `StarRecord`, `MeasurementOutcome`, `MeasurementRecord`, `FrameStateKind`, `FrameState`, `RunState`, `RunIssue`, `MeasurementRun`, `MeasurementProgress`, `Stretch`, `TileRequest`, `PreviewTile`, `FramePreview`, `SampleValue`, `StarCutouts`, `FrameDetail`, `ColumnClass`, `ImportColumn`, `RowMatch`, `ImportRow`, `ImportReview`, `RowResolution`, `ConfirmedImport`, `ImportedValue` and `Drift`. Wire types use camelCase serde. A `sample_number` serde helper writes finite values as JSON numbers and non-finite values as `NaN`, `Infinity` or `-Infinity`. `Stretch::validate`, `TileRequest::validate` and the sample-region bound return `LibraryError::InvalidInput` naming the field, as `TargetCone::validate` does. Errors reuse `LibraryError` and `ErrorResponse`, and the plan adds no variant.

## Pixel crate

`crates/platevault-pixels` is a pure Rust library with no PlateVault, SQLite or Tauri dependency. It reads from a `Read`, writes nothing and forbids `unsafe` under the workspace lint. Core maps its types to the shared model.

```rust
// plane.rs: foundation
pub enum Container { Fits, Xisf }
pub enum StoredSamples { U8(Vec<u8>), I16(Vec<i16>), U16(Vec<u16>), I32(Vec<i32>), U32(Vec<u32>), I64(Vec<i64>), F32(Vec<f32>), F64(Vec<f64>) }
pub enum PlaneKind { Mono, CfaMosaic(CfaEvidence), Channel { index: u32, count: u32, color_space: Option<String> } }
pub enum Category { Valid, Nan, PosInf, NegInf, Blank, Saturated }
pub struct Plane { pub width: u32, pub height: u32, pub kind: PlaneKind, pub samples: StoredSamples,
                   pub scaling: Scaling, pub blank: Option<i64>, pub saturation: Saturation }
impl Plane {
    pub fn sample(&self, x: u32, y: u32) -> Sample;          // stored value, scaled value, category
    pub fn mask_counts(&self) -> MaskCounts;
}
pub struct DecodedImage { pub container: Container, pub planes: Vec<Plane>, pub evidence: StructureEvidence }
pub enum PixelError { Unsupported(String), Malformed(String), Io(std::io::Error), Canceled }

// decode/: decode owner
pub fn decode(container: Container, reader: &mut dyn Read, canceled: &AtomicBool) -> Result<DecodedImage, PixelError>;

// measure.rs, stats.rs, stars.rs, psf.rs, hfr.rs: measurement owner
pub const METHOD: Method = Method { name: "platevault.stars", version: 1 };
pub fn measure(image: &DecodedImage, canceled: &AtomicBool) -> Result<Measurement, PixelError>;
pub fn cutouts(plane: &Plane, star: &Star) -> Cutouts;

// display.rs: display owner
pub fn statistics(plane: &Plane) -> PlaneStatistics;
pub fn render_tile(plane: &Plane, stats: &PlaneStatistics, region: Region, level: u8, stretch: &Stretch) -> Result<DisplayTile, PixelError>;
pub fn comparison_regions(width: u32, height: u32, size: u32) -> [Region; 5];
pub fn sample_region(plane: &Plane, region: Region) -> Result<Vec<Sample>, PixelError>;
```

`decode` follows research R4 through R6. It parses FITS cards with fits-header after reading 2880-byte blocks up to END, and the XISF `<Image>` and `<ColorFilterArray>` elements with quick-xml. XISF keywords come from xisf-header, and zlib and lz4 blocks are decompressed with flate2 and lz4_flex. `measure` implements method version 1 of R7 and R8 on a mono plane, R10 on a CFA mosaic and R11 on channels. It checks `canceled` between stages and returns `PixelError::Canceled` without a partial result. `DisplayTile` holds 8-bit gray values and mask codes and has no conversion to a `Plane`, so no display output can be measured.

`fixtures.rs`, behind the `fixtures` feature, holds the seeded synthetic frame generator: background, noise, elliptical stars, saturation, NaN, infinities, BLANK, hot pixels, cosmic-ray streaks and CFA modulation. It also holds writers for every supported FITS BITPIX and XISF format, storage, byte order and codec. Tests of every crate use it through `dev-dependencies`. Release builds never enable it.

## Catalog owner

`crates/persistence/library/src/measurements.rs` is a child module of the catalog crate. It reuses the private `write_txn!`, `load_asset`, `fingerprint_matches`, `SourceRoot` and `open_contained` helpers. `src/measurements.sql` holds the run, record, import, column and row tables. The catalog owner declares the module in `lib.rs`, appends `measurements.sql` to `SCHEMA` and sets `SCHEMA_VERSION` to the integration base's version plus one, with the matching `catalog_meta` row in `schema.sql`. `Catalog::open` calls `measurements::recover_interrupted` after scan recovery. All SQL stays under `crates/persistence`, so `scripts/check-db-boundary.sh` keeps an empty baseline.

```rust
pub struct ContainedRead<T> { pub value: T, pub asset: Asset, pub sha256: String, pub fingerprint: ObservationFingerprint }

impl Catalog {
    pub async fn read_contained<P, T, F>(&self, asset_id: Uuid, probe: P, consume: F) -> Result<ContainedRead<T>>
    where P: SourceProbe, T: Send + 'static, F: FnOnce(&mut dyn Read) -> Result<T> + Send + 'static;
    pub async fn frame_records(&self, assets: &[Uuid], method: &MeasurementMethod) -> Result<Vec<FrameRecordBasis>>;
    pub async fn begin_measurement_run(&self, method: &MeasurementMethod, queued: &[Uuid], already_cached: u64) -> Result<MeasurementRun>;
    pub async fn extend_measurement_run(&self, run: Uuid, queued: &[Uuid], already_cached: u64) -> Result<MeasurementRun>;
    pub async fn record_measurement(&self, run: Uuid, record: &MeasurementRecord) -> Result<MeasurementRun>;
    pub async fn record_run_issue(&self, run: Uuid, issue: &RunIssue) -> Result<MeasurementRun>;
    pub async fn finish_measurement_run(&self, run: Uuid, state: RunState) -> Result<MeasurementRun>;
    pub async fn measurement_run(&self, run: Uuid) -> Result<MeasurementRun>;
    pub async fn list_measurement_runs(&self, offset: u32, limit: u32) -> Result<Vec<MeasurementRun>>;
    pub async fn measurement(&self, id: Uuid) -> Result<MeasurementRecord>;
    pub async fn import_candidates(&self, scope: &[Uuid]) -> Result<Vec<ImportCandidate>>;
    pub async fn create_import_review(&self, review: &ImportReviewInput) -> Result<ImportReview>;
    pub async fn import_review(&self, id: Uuid) -> Result<ImportReview>;
    pub async fn confirm_import(&self, id: Uuid, resolutions: &[RowResolution]) -> Result<ConfirmedImport>;
    pub async fn imported_values(&self, assets: &[Uuid]) -> Result<Vec<ImportedValue>>;
}
```

`read_contained` resolves the asset and its location in a reader transaction and verifies the root through `probe`. In a blocking task it opens the file with the existing no-follow chain and checks stats. It passes a hashing reader to `consume` and hashes any unread remainder. It checks stats and the folder chain again and returns the value with the SHA-256 of every byte. It writes no row. `frame_records` returns each asset with its latest record and the validity of R12, decided in one reader snapshot. `record_measurement` refuses to store a record whose basis no longer matches the asset and records an issue instead. `import_candidates` returns each non-Retired scope asset's absolute native path, basename, fingerprint and a SHA-256 already recorded for that fingerprint. A `#[cfg(test)]` unit test in the module forces SQLITE_FULL through `limit_writer_pages_for_test` for `record_measurement` and `confirm_import`.

## CSV owner

`crates/platevault-core/src/subframe_csv.rs` holds pure SubframeSelector parsing and matching with no I/O. The CSV owner declares it in `crates/platevault-core/src/lib.rs`.

```rust
pub fn parse(bytes: &[u8]) -> Result<SubframeExport, LibraryError>;
pub fn match_rows(export: &SubframeExport, candidates: &[ImportCandidate]) -> Vec<ImportRow>;
```

`parse` reads the preamble by key, selects the column layout, classifies every column under R17 and parses rows with the workspace `csv` crate. It keeps unparseable rows as `unparsed`. Missing Index or File columns return `UnsupportedFormat`. `match_rows` applies R18 and never consults the filesystem.

## Integration owner

`crates/platevault-core/src/frame_review.rs` holds `FrameReview`, created in `Library::open` with the shared `Arc<Catalog>`, and `library.rs` adds `pub fn frame_review(&self) -> &FrameReview`.

```rust
impl FrameReview {
    pub async fn frame_states(&self, assets: &[Uuid]) -> Result<Vec<FrameState>, LibraryError>;
    pub async fn start_measurement(&self, assets: &[Uuid], priority: &[Uuid]) -> Result<MeasurementRun, LibraryError>;
    pub async fn prioritize(&self, run: Uuid, assets: &[Uuid]) -> Result<MeasurementRun, LibraryError>;
    pub async fn cancel_measurement(&self, run: Uuid) -> Result<MeasurementRun, LibraryError>;
    pub async fn measurement_status(&self, run: Uuid) -> Result<MeasurementRun, LibraryError>;
    pub async fn list_runs(&self, offset: u32, limit: u32) -> Result<Vec<MeasurementRun>, LibraryError>;
    pub fn subscribe_measurement_progress(&self) -> broadcast::Receiver<MeasurementProgress>;
    pub async fn open_frame(&self, asset: Uuid) -> Result<FramePreview, LibraryError>;
    pub async fn preview_tile(&self, request: &TileRequest) -> Result<PreviewTile, LibraryError>;
    pub async fn compare_regions(&self, request: &RegionsRequest) -> Result<Vec<PreviewTile>, LibraryError>;
    pub async fn sample_region(&self, request: &SampleRequest) -> Result<Vec<SampleValue>, LibraryError>;
    pub async fn frame_stars(&self, asset: Uuid) -> Result<FrameStars, LibraryError>;
    pub async fn star_cutouts(&self, request: &CutoutRequest) -> Result<StarCutouts, LibraryError>;
    pub async fn frame_detail(&self, asset: Uuid) -> Result<FrameDetail, LibraryError>;
    pub async fn review_import(&self, path: &NativePath, scope: &[Uuid]) -> Result<ImportReview, LibraryError>;
    pub async fn import_review(&self, id: Uuid) -> Result<ImportReview, LibraryError>;
    pub async fn confirm_import(&self, id: Uuid, resolutions: &[RowResolution]) -> Result<ConfirmedImport, LibraryError>;
}
```

`frame_states` combines `Catalog::frame_records`, the in-memory queue and `Catalog::imported_values`. It starts no work and reads no source. The run queue, the cancel flag, the priority order, the worker tasks and the 1 GiB decode budget follow R14. Each worker calls `read_contained` with `InventoryProbe`, then `decode` and `measure`. It records the result, a failed outcome or an issue, and publishes a snapshot. The preview cache follows R15 and decodes through the same contained read. `review_import` reads the chosen CSV read-only, then calls `parse`, `import_candidates` and `match_rows`. It hashes, through `read_contained`, only attached assets without a recorded digest, then stores the review.

`apps/desktop/src-tauri/src/commands/frame_review.rs` holds the sixteen `pix_*` handlers with the library `Reply`, `fail` and `report` conventions. `commands/mod.rs` declares the module. `library_shell.rs` adds the handlers to its `generate_handler!` list and spawns a bridge that forwards `pix_measurement_progress` like `ProgressBridge`.

## Ownership

| Owner | Files |
| --- | --- |
| Foundation | `Cargo.toml`, `Cargo.lock`, `crates/platevault-pixels/{Cargo.toml,src/lib.rs,src/plane.rs,src/fixtures.rs}`, `crates/platevault-model/src/{frame_review.rs,lib.rs}`, `crates/platevault-core/Cargo.toml`, `crates/platevault-core/tests/model.rs` |
| Decode | `crates/platevault-pixels/src/decode/{mod.rs,fits.rs,xisf.rs}`, `crates/platevault-pixels/tests/decode.rs` |
| Measurement | `crates/platevault-pixels/src/{measure.rs,stats.rs,stars.rs,psf.rs,hfr.rs}`, `crates/platevault-pixels/tests/measure.rs` |
| Display | `crates/platevault-pixels/src/display.rs`, `crates/platevault-pixels/tests/display.rs` |
| Catalog | `crates/persistence/library/src/{measurements.rs,measurements.sql,lib.rs,schema.sql}`, `crates/persistence/library/tests/measurements.rs` |
| CSV | `crates/platevault-core/src/subframe_csv.rs`, `crates/platevault-core/tests/subframe_csv.rs` |
| Integration | `crates/platevault-core/src/{frame_review.rs,library.rs,lib.rs}`, `crates/platevault-core/tests/{frame_review.rs,measurement_import.rs}`, `apps/desktop/src-tauri/src/{commands/frame_review.rs,commands/mod.rs,library_shell.rs}` |

Each pixel worker adds its own `pub mod` line to `crates/platevault-pixels/src/lib.rs`, and the lead integrates those one-line additions. The CSV and integration owners both edit `crates/platevault-core/src/lib.rs` the same way. Backend acceptance exercises real decode, catalog, core and IPC outcomes. The Frames surface UI and journey steps stay pending on the final-frontend acceptance task.
