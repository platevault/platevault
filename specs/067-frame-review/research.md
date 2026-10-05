# Frame review research

## Decision

Decode FITS and XISF pixel data and measure stars in a new pure Rust crate, `crates/platevault-pixels`, with no catalog, Tauri or PlateVault dependency. Store measurement runs, cached measurements and confirmed measurement imports as tables of the clean library catalog, `crates/persistence/library`, through its single serialized writer. The catalog also gains one read-only source reader that streams a contained file to a decoder and hashes the same bytes. A `platevault_core::frame_review` service owns the measurement queue, preview cache and import review. The isolated rebuilt shell exposes `pix_*` commands. The plan reuses no legacy preview, review or measurement code, because none of it computes anything.

## Source evidence

Read at `97ca51be`, the reviewed 064 backend plus the 065 plan. No runtime behavior is claimed from reading.

- Header-only readers: `RawFileMetadata` has NAXIS1/2 and XISF geometry but no BITPIX, BZERO/BSCALE, BLANK, BAYERPAT, ROWORDER, SATURATE, sample format or channel count (`crates/metadata/core/src/lib.rs:232-348`). The FITS and XISF adapters map only those fields (`crates/metadata/fits/src/lib.rs:180-213`, `crates/metadata/xisf/src/lib.rs:152-180`).
- Header packages: fits-header 0.4.3 exposes generic card access through `Header::parse` and `Header::get` and has no data-unit API (`fits-header-0.4.3/src/header.rs:77`, `:319-368`). xisf-header 0.4.4 documents that its `Header` "models keywords and properties, not image structure" (`xisf-header-0.4.4/src/header.rs:16-21`). Its attachment location is parsed privately for header splicing only (`src/reader.rs:300-320`).
- Source custody: `hash_contained`, `open_contained` and `current_digest` open sources without following links, compare size and nanosecond mtime before and after reading and re-verify the folder chain. All three are private to the catalog crate (`crates/persistence/library/src/lib.rs:6096-6153`, `:6207`). `SourceProbe` is public and core implements it as `InventoryProbe` (`lib.rs:234-249`; `crates/platevault-core/src/library.rs:95-105`).
- Digest writes: `Catalog::verify_digest` writes the asset fingerprint and `last_verified_at` (`lib.rs:1181-1219`). `fingerprint_matches` accepts a missing digest on one side and refuses differing digests (`lib.rs:4305-4322`).
- Catalog durability and versioning: `write_txn!` runs `BEGIN IMMEDIATE` on the FULL-synchronous writer (`lib.rs:52-64`, `:324-347`). `SCHEMA_VERSION` is 6, and `install_schema` refuses any other recorded version before DDL (`lib.rs:45-46`, `:2066-2102`). `recover_interrupted` marks Running scans Partial at open (`lib.rs:2104-2122`).
- Operations: `scan_operations` and `ScanOperation` carry no kind discriminator, so `list_operations` lists scans only (`schema.sql:39-61`; `crates/platevault-model/src/lib.rs:721-810`). Scans keep a cancel flag per operation and publish committed snapshots on a `broadcast` channel (`library.rs:48-60`, `:67-70`, `:120`, `:139-142`).
- Browsing: `SessionQuery` has no quality filter and listing sessions measures nothing (`lib.rs:136-143`; `apps/desktop/src-tauri/src/commands/library.rs:153`). VSEL owns the quality-state filter (VSEL-FR-05).
- Shell: handlers return `Reply<T>` and use `fail` and `report` (`commands/library.rs:28-50`). `library_shell.rs` registers handlers with `generate_handler!`, forwards scan snapshots as `library_scan_progress` and binds the `dev-tools` bridge to IPv4 loopback (`apps/desktop/src-tauri/src/library_shell.rs:55-56`, `:72-100`, `:177-233`). No handler returns a raw binary IPC response.
- Workspace: `unsafe_code` is forbidden (`Cargo.toml:158`), which rules out memory-mapped reads. `csv = "1"` is pinned for staged adoption and unused (`Cargo.toml:130`). flate2 1.1.9 is present only as a transitive dependency. No lz4, zstd, rayon or nalgebra crate is in `Cargo.lock`.
- Fixtures: `tests/support/mod.rs` writes small FITS and XISF files with real pixel payloads (`crates/platevault-core/tests/support/mod.rs:6-39`, `:50-77`). `crates/testing/fits-fixtures` writes headers only.
- Legacy: measurement values in `apps/desktop/src/data/fixtures/review.ts:323-325` are mock UI data, not computation.
- SubframeSelector CSV: the PCL module at commit `aad4c99e69` (PixInsight 1.9.5, module 1.9.3) writes the file in `ExportCSV()`. The [measurements interface](https://gitlab.com/pixinsight/PCL/-/blob/aad4c99e69/src/modules/processes/contrib/cleger/SubframeSelector/SubframeSelectorMeasurementsInterface.cpp) defines a 22-line preamble and a 30-column table. Version 1.8.9 had 28 columns and 1.8.8-12 had 23. FWHM units follow the `Scale Unit` and `Subframe Scale` rows. Median and Noise follow `Data Unit`. `Approved` and `Locked` are written as `true`/`false`, and `Locked` marks a manual approval. The File column and the expressions are quoted without escaping. Stars come from `pcl::StarDetector` and `pcl::PSFFit`, with an elliptical Moffat beta 4 default ([parameters](https://gitlab.com/pixinsight/PCL/-/blob/aad4c99e69/src/modules/processes/contrib/cleger/SubframeSelector/SubframeSelectorParameters.h)).

## Resolved ambiguities

Each entry records the decision, its basis and the alternative considered. Where the spec is silent, the default follows root decisions [D03 and D19](../063-clean-rebuild-contract/decisions.md).

- **R1 Storage and schema order.** Measurement tables live in `crates/persistence/library/src/measurements.sql` with SQL in `src/measurements.rs`, appended to the catalog schema. `SCHEMA_VERSION` becomes the version on the integration base plus one. The dependency order is 064 (version 6), 065 (planned 7), 066 (planned, its own increment), then 067. This plan hard-codes no number. Older catalogs are refused like any other version; the autonomous objective permits resetting development catalogs. Basis: foreign keys to `assets`, one writer and one reader snapshot for frame states. Alternative: a separate database would need a second writer and could not reference assets.
- **R2 Pixel crate.** `platevault_pixels` decodes, validates samples, measures and renders display tiles from any `Read`. It depends on fits-header for cards, quick-xml for the XISF `<Image>` element, xisf-header for XISF keywords, and flate2 and lz4_flex for decompression. Basis: the metadata crates are header-only, and xisf-header's contract excludes image structure, so D18's shared-package rule does not fit. A separate crate keeps numerical code testable without SQLite. Alternatives: extending `metadata_core` would make indexing read pixels; extending xisf-header contradicts its contract; cfitsio adds a C library.
- **R3 Source reading.** A new `Catalog::read_contained` reuses the private no-follow open. It streams the file to a consumer, hashes every byte and drains the remainder. It then re-checks stats and the folder chain and returns the value with its SHA-256. It writes nothing and never calls `verify_digest`. Basis: one custody implementation, and the measured bytes are exactly the hashed bytes (D19). Alternative: a second opener in core would duplicate the link and junction checks.
- **R4 Supported inputs.** FITS primary-HDU images with BITPIX 8, 16, 32, 64, -32 or -64, BZERO, BSCALE and BLANK, and NAXIS 2 or 3. XISF monolithic files with one `<Image>` in an attachment block: UInt8, UInt16, UInt32, Float32 or Float64, Planar or Normal storage, either byte order, and no compression, zlib, lz4 or lz4hc, with or without byte shuffling. Samples stay in their stored type with their scaling (D03). FITS tile compression, image extensions, XISF zstd, inline or embedded blocks, complex samples and several images return `UnsupportedFormat` naming the feature. Truncated or inconsistent data returns `MetadataUnreadable`. Alternative: zstd through ruzstd waits for a dependency decision (open question O3).
- **R5 Planes and coordinates.** A file yields one mono plane, one CFA mosaic plane or one plane per channel. A plane is CFA when the FITS header records BAYERPAT, with XBAYROFF, YBAYROFF and ROWORDER kept as evidence, or the XISF image has a `ColorFilterArray` element. The mosaic is shown as stored and channels are shown one at a time; nothing is debayered or combined (D03). Coordinates are 0-based storage indices, with x the column and y the stored row, and integer coordinates at pixel centers. FITS pixel (1, 1) is (0, 0). Tiles keep storage row order; ROWORDER is evidence only.
- **R6 Sample validity.** Each sample is valid or belongs to one mask category: `nan`, `pos_inf`, `neg_inf`, `blank` (integer FITS BLANK) or `saturated`. The saturation level comes from the SATURATE keyword, then the recorded XISF `bounds` upper limit for float data, then the stored type's maximum after scaling for integer data. Otherwise it is unknown, and each star carries `saturation_unknown`. Statistics and fits read valid samples only. The mask shows every other sample, and sample readout returns it unchanged. No masked sample is replaced (PIX-FR-09).
- **R7 Method `platevault.stars` version 1.** It runs on one mono plane, single-threaded and deterministic.
  - Background: median of valid unsaturated samples after iterative 3-sigma clipping, stopping when the set is stable or after 10 passes. Noise is 1.4826 times the median absolute deviation of the clipped set.
  - Detection: 3×3 local maxima at least 5 noise units above background, with at least 5 connected samples 3 units above it. A candidate closer than its box radius to an edge is listed `near_edge` without a fit. Only the 2000 brightest candidates are kept, and the frame records `truncated`.
  - Fit: an elliptical Gaussian with a constant term, fitted by Levenberg-Marquardt over valid samples in a box of radius three estimated sigma, clamped to 4 through 15 pixels. FWHM major and minor are 2.35482 sigma. The star FWHM is their geometric mean. Eccentricity is the square root of 1 minus the squared sigma ratio. The position angle of the major axis is measured from +x toward +y in storage coordinates, from 0 to 180 degrees.
  - HFR: the radius at which the background-subtracted flux inside the box radius reaches half its total, linearly interpolated over sample-center distances. It is measured, never derived from FWHM.
  - Frame metrics: `star_count`, `fitted_star_count`, `fwhm_median`, `eccentricity_median`, `hfr_median`, `background_median`, `background_noise` and the mask counts. Medians use only fitted stars and are null with reason `no_fitted_stars` when none fit.
  - Units: `px` for widths and radii, `count`, `dimensionless` and `deg`. Plane values use `dn` for integer data, `normalized` for float data with recorded bounds [0, 1], and `data_unit` otherwise.
  - Every constant is recorded in the method parameters, and any change increments the version.
- **R8 Failed fits.** A star with a saturated sample in its box, more than 10 percent masked samples, no convergence in 50 iterations, sigma outside 0.3 pixels to the box radius, or a center moving more than 1.5 pixels reads `failed` with its reasons. It has no FWHM and no HFR (PIX-FR-05, J22 SC3). Warnings are `saturated`, `masked_samples_excluded`, `near_edge`, `blended` and `saturation_unknown`.
- **R9 Qualification.** Fixtures and tolerances are defined in the qualification section below. A method version is qualified only when every listed fixture passes.
- **R10 CFA measurement.** A CFA mosaic receives background, noise and mask counts over the whole mosaic with basis `cfa_mosaic` and its pattern evidence. Star metrics read unavailable with reason `cfa_star_metrics_unqualified`. Basis: D03 permits mosaic inspection and forbids RGB-derived claims, and a fit across Bayer sites is biased unless the channel responses are equal. Alternative: fitting each CFA site separately needs its own qualification (O1).
- **R11 Multi-channel images.** Each channel is previewable. Built-in measurement reads unavailable with reason `multichannel_unqualified`. Basis: raw light frames are mono or CFA, and no metric has been qualified per channel (O2).
- **R12 Cache validity.** A measurement record binds the asset ID, the observed fingerprint with the SHA-256 of the measured bytes, the method and version, the plane basis and the measurement time. It is valid when the asset is not Retired, the method version is current, `fingerprint_matches` accepts the current fingerprint, and no recorded digest for that fingerprint differs. Reading never rehashes. An Offline or Unreadable asset keeps its valid record labelled last-observed and unverified (D19). PIX never writes asset, digest or quality rows, so measuring cannot change quality applicability.
- **R13 Frame states.** States are `cached`, `pending`, `failed`, `unavailable` and `not_measured`. A frame is `pending` only while a Running run holds it. `failed` is a stored outcome of the method for the current basis and version, such as an unsupported encoding. Offline, unreadable, retired or changed sources read `unavailable` and are recorded as run issues, never cached. A record whose basis no longer applies shows no value.
- **R14 Measurement runs.** One run is Running per catalog. Starting a run enqueues frames without a valid record or a current failure. If a run is already Running, the frames join it and the same run is returned. Priority frames go first, then request order, and prioritizing moves frames to the head. Workers are dedicated blocking tasks, `max(1, available_parallelism - 1)` of them, under a 1 GiB budget of decoded samples. Preview work never waits behind them.
  - Cancel stops dequeuing, abandons in-flight frames at stage checkpoints without writing them and keeps every committed record.
  - Restart marks a Running run Interrupted with its unfinished count.
  - Runs are durable rows in their own table, because `scan_operations` has no kind. Snapshots go out on a broadcast channel, and polling stays the durable truth.
  - Reading frame states, browsing and filtering never start a run (PIX-AC-06).
- **R15 Preview.** Decoded planes stay in a memory cache keyed by asset and SHA-256, capped at 768 MiB, and are never written to disk.
  - Tiles are at most 1024 pixels per side. Level k averages valid samples in 2^k blocks for display only. Comparison returns the center and four corner regions at full resolution.
  - Stretches are `linear` with black and white points, `mtf` with shadows, midtones and highlights, and `auto`, which derives an MTF from median and MAD with recorded constants. The applied parameters are returned.
  - Tiles carry 8-bit gray values and a mask code plane, base64 in JSON, because the shell's commands return serializable replies. Sample readout returns up to 64×64 stored and scaled values; non-finite values are strings.
  - Display types have no conversion back to a plane, so a stretched tile cannot reach measurement (PIX-FR-04).
- **R16 CSV parsing.** The preamble is read line by line by key, because paths and expressions are quoted without escaping. The table header selects the 30-, 28- or 23-column layout by name. Index and File are required, or the file is `UnsupportedFormat`. Rows parse with the workspace `csv` crate in flexible mode. A row that does not parse is listed `unparsed`, never dropped. The source file is read once, at most 16 MiB, and its size and SHA-256 are recorded.
- **R17 Columns and units.** Values keep the units the export declares and are never converted.
  - FWHM and FWHM Mean Deviation take units from Scale Unit (`arcsec` or `px`), recorded with Subframe Scale. A scale of exactly 1 with arcsec units carries the warning `default_subframe_scale`.
  - Median, Median Mean Deviation and Noise take Data Unit (`e-`, `dn` or `normalized`).
  - Eccentricity and its mean deviation are `dimensionless`, and unavailable with reason `circular_psf` when Circular PSF is true.
  - Stars and PSF Count are `count`.
  - Without the matching preamble row, a column reads unavailable with `missing_units` and is listed for review.
  - Columns without declared units read unavailable with `no_declared_units`: Weight, PSF Signal Weight, PSF SNR, PSF Scale, PSF Scale SNR, the four PSF Total flux columns, M*, N*, SNR, Noise Ratio, Star Residual and Star Residual Mean Deviation. Altitude and Azimuth read `not_supported`, because header pointing is library evidence and the module has an azimuth bug. Unknown columns read `unknown_column`.
  - Approved and Locked are approval decisions and are never imported (`decision_not_imported`).
  - Every imported value is labelled with the SubframeSelector method, module version and PSF Type and is never shown as built-in FWHM or HFR (PIX-AC-05).
- **R18 Row matching.** Rows match only assets in the review scope that are not Retired. An exact native path match, with `/` read as the separator for Windows paths, is `matched_path`. Otherwise a unique exact basename is `matched_name`. Several candidates make the row `ambiguous`, and two rows naming one asset are `ambiguous` with `duplicate_asset_match`. No match is `unmatched`. Matching applies no case folding, Unicode normalization, suffix stripping or fuzzy match. Confirmation may resolve an ambiguous row only to one of its listed candidates.
- **R19 Import durability and verification.** A review is a durable proposal. Confirmation is a Tier 1 user decision committed in one FULL transaction and is single-use.
  - Each matched or resolved row records the asset fingerprint. It reuses a SHA-256 already recorded for that fingerprint by a measurement or the library. Otherwise review hashes the file through `read_contained`; an offline file keeps a null digest.
  - Imported values read `unverified` permanently, as D19 names for name-matched imports. Drift is derived at read without rehashing.
  - Confirmation refuses the whole import with Conflict when any attached asset's fingerprint changed since review.
  - Imported values are stored apart from built-in records and never replace them. Several imports coexist, newest first.
- **R20 No decisions.** PIX writes only its own tables. It has no write path to quality, Views, Projects, associations or corrections, and never imports Approved or Locked (PIX-FR-07, PIX-FR-08).
- **R21 Retire.** Measurement and import records are not memberships and register no `AssetReferences` source. `ReferenceKind` names only View, Project and Result (`crates/platevault-model/src/lib.rs:962-970`). Records of Retired copies stay as history and read unavailable.
- **R22 Naming.** Commands use the `pix_` prefix in `commands/frame_review.rs`. The progress event is `pix_measurement_progress`.

## Cross-spec seams

Each seam states the interface 067 needs and the conservative default used until the other feature's contract is planned.

- **VSEL (066), Review frames host.** VSEL supplies the draft's asset IDs, one physical copy per logical capture of its choice, to `pix_review_frames`, `pix_start_measurement` and `pix_review_import`. It reads `FrameReview::frame_states` for its measurement columns (VSEL-FR-05). It owns selection, exclusion and membership, and its quality-state filter never starts a run. Default: the PIX API takes asset IDs, reads no View table and writes none. PIX-AC-01 cancel retention and PIX-AC-06 are proven from the PIX side by unchanged non-PIX rows. They are re-verified with a real 066 draft when it exists.
- **LIB (064), implemented.** 067 adds `Catalog::read_contained`, the measurement module and its schema increment. It changes no existing command or record.
- **RES (070), product inspection.** RES may call `platevault_pixels` decode and display functions for product files. Default: PIX commands stay asset-scoped and need no RES record.
- **STO (071), moved or archived files.** Measurement validity follows the asset fingerprint, so a changed path or identity makes a record stale. Default: STO never rewrites measurement rows, and PIX never writes files.
- **PRJ (065), CAL (068), PREP (069), PLAN (072).** No interface. Measurements never feed rejection, matching, preparation or planning. The only coupling is schema order.

## Open questions

- O1 CFA star metrics: fitting each CFA site separately needs fixtures with unequal channel response before version 2 can claim it.
- O2 Per-channel metrics for multi-channel images.
- O3 XISF zstd decoding needs a dependency decision.
- O4 Agreement with PixInsight on real frames is unmeasured; qualification is synthetic only.
- O5 FR-07 says missing units require review. Version 1 lists such columns and keeps them unavailable; a user unit assignment control is not specified.
- O6 Whether measurement digests should become library digest evidence for D16 duplicate proof. Version 1 writes none (R12).
- O7 Decode and measurement time on 26 to 60 megapixel frames is unmeasured.

## Qualification

Generated fixtures use a seeded deterministic generator and no real library. The [acceptance guide](quickstart.md) lists the file inputs.

- Background and noise: a 512×512 UInt16 frame at 1000 DN with noise sigma 10. The median is within 0.5 sigma of the true level and the noise within 5 percent.
- Detection: 50 isolated stars at signal-to-noise 20 to 500 give at least 95 percent completeness above 20. A noise-only frame with 20 hot pixels and five 2-pixel cosmic-ray streaks gives no star.
- Fit: elliptical Gaussian stars at signal-to-noise 50 or more give centroids within 0.1 pixel, FWHM within 3 percent, eccentricity within 0.03 and position angle within 3 degrees for eccentricity of 0.5 or more. HFR is within 5 percent of the analytic finite-box value.
- Trailed stars: a sigma ratio of 2.5 reads eccentricity at least 0.9.
- Saturation: a star clipped at 65535 reads `failed` with `saturated` and no width number.
- Invalid samples: Float32 frames with NaN, infinities, BLANK in integer data and a saturated plateau keep every mask count, and readout returns the stored values.
- CFA: an RGGB mosaic in FITS and XISF keeps its checkerboard sample for sample in tiles, names `cfa_mosaic` and reads stars unavailable.
- Stretch: metrics are bit-identical before and after rendering linear, strong MTF and auto tiles.
- Determinism: measuring one file twice, with one worker and with several, gives identical records.
- Formats: every supported FITS BITPIX and XISF format, storage, byte order and codec decodes to the same samples. Every unsupported feature is named.

Every scenario compares source hashes before and after. Real development-MCP evidence remains an acceptance gate. No legacy result proves the rebuild.
