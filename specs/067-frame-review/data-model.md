# Frame review data model

## Durable entities

Measurement rows are catalog records in `crates/persistence/library/src/measurements.sql`. They reference `assets(id)` with foreign keys and never change an asset, digest, quality, session, association, correction, View or Project row. Research entries R1 through R22 give the basis for each rule.

- MeasurementRun: UUID, method `{name, version}`, state, revision starting at 1, the requested asset IDs in queue order, counters and issues, and start and finish times. States are Running, Completed, Canceled, Interrupted and Failed. At most one run is Running, enforced by a partial unique index like `scan_operations_one_running`. Counters are `requested`, `alreadyCached`, `measured`, `failed`, `unavailable` and `remaining`. Each issue holds an asset ID, an error kind and a message for a source that was offline, unreadable, retired or changed while being read. Tier 2: an operation record kept visible after restart (root FR-012).
- MeasurementRecord: UUID, asset ID, run ID, method, `dequeueSequence` within its run, input basis, outcome, frame metrics, stars and mask counts, and the measurement time. The latest record per asset and method replaces the previous one; it is recomputable cache (Tier 2). Outcome `measured` holds metrics, each with a value or an unavailable reason. Outcome `failed` holds the method's reason for the whole frame, such as `unsupported_format` or `multichannel_unqualified`.
- InputBasis: the asset's observed `ObservationFingerprint` with `contentSha256` set to the SHA-256 of the measured bytes, and the container, FITS or XISF. It also holds the plane basis, the stored sample format, the scaling `{zero, scale}`, the BLANK value, the dimensions, and the saturation level with its source: `saturate_keyword`, `xisf_bounds`, `type_maximum` or `unknown`.
- PlaneBasis: `mono`, `cfa_mosaic` with `{pattern, xOffset, yOffset, rowOrder, source}` evidence, or `channel` with `{index, count, colorSpace}`. Evidence values stay as recorded, null when absent.
- StarRecord: index, centroid `{x, y}` in 0-based storage pixels, state `fitted`, `failed` or `not_fitted` (`near_edge`), failure reasons and warnings, peak and flux above local background, and local background. A fitted star adds the model `elliptical_gaussian`, `fwhmMajorPx`, `fwhmMinorPx`, `fwhmPx`, `eccentricity`, `positionAngleDeg` and `hfrPx`. A failed or unfitted star has no width or radius value.
- MeasurementImport: UUID, format `subframe_selector_csv`, source native path, size and SHA-256, the module version line, the parsed preamble rows as recorded, the table layout and the scope asset IDs. It also holds the column mapping, state `reviewed` or `confirmed`, review and confirmation times and revision. A reviewed import is a durable proposal (Tier 2). Confirmation is a Tier 1 user decision.
- ImportColumn: header text, position, class and, for mapped columns, units, units basis and warnings. The class is `mapped`, `unavailable` with a reason, `identity` (Index, File) or `excluded` (`decision_not_imported`). The units basis records the preamble rows the units came from.
- ImportRow: import ID, 1-based CSV Index, the File text, match state, candidates, the attached asset ID and per-column values. Match states are `matched_path`, `matched_name`, `ambiguous`, `unmatched`, `unparsed` and, after confirmation, `resolved`. Each attached row stores its import basis: the asset fingerprint and the SHA-256 at review, null when the asset was offline. Each value keeps the raw text and the parsed number, or a parse reason. Values are written for mapped columns only.

## Frame metrics

| Metric | Units | Basis |
| --- | --- | --- |
| `star_count` | count | Detected stars, fitted or not |
| `fitted_star_count` | count | Stars with state `fitted` |
| `fwhm_median` | px | Median `fwhmPx` of fitted stars; label "FWHM (Gaussian fit)" |
| `eccentricity_median` | dimensionless | Median eccentricity of fitted stars |
| `hfr_median` | px | Median `hfrPx` of fitted stars; label "HFR (half-flux radius)" |
| `background_median` | `dn`, `normalized` or `data_unit` | Clipped median of valid unsaturated samples |
| `background_noise` | as background | 1.4826 × MAD of the clipped set |
| `masked_samples` | count | Counts per category: `nan`, `pos_inf`, `neg_inf`, `blank`, `saturated` |

A CFA mosaic records background, noise and mask counts with basis `cfa_mosaic`, and its star metrics read unavailable with `cfa_star_metrics_unqualified` (R10). A multi-channel image records outcome `failed` with `multichannel_unqualified` (R11). A frame without fitted stars has null medians with reason `no_fitted_stars`. HFR is never computed from FWHM, and no metric is relabelled as another.

## Frame state

The state is derived on read in one reader transaction and is never stored.

1. The asset is Retired: `unavailable` with reason `retired`. The asset is not Available and has no valid record: `unavailable` with its availability as reason.
2. A valid record exists (R12): `cached`, with `measuredAt` and the verification label `current` or `last_observed` for an unavailable asset.
3. A record for the current basis and method version has outcome `failed`: `failed` with its reason.
4. A Running run holds the asset in its queue or in flight: `pending`.
5. Otherwise: `not_measured`. A stale record supplies no value.

Imported values attach beside the state and never change it. Each imported value reads `unverified`. Its drift is `matches` when the current fingerprint matches the import basis, `differs` when the fingerprint or a recorded digest differs, or `unknown` when the asset is unavailable or has no digest.

## Run transitions

```text
Running --all queued frames settled--> Completed
Running --cancel settled--> Canceled
Running --catalog reopened--> Interrupted
Running --catalog write failed--> Failed
```

A run settles a frame by committing its record, a failed outcome or an issue. `record_measurement` checks inside its transaction that the asset's current fingerprint still matches the basis and records an issue instead when it does not. Cancel and interruption leave frames without a record in `not_measured`. A later start skips every asset with a valid record and reports `alreadyCached`.

## Display values

Previews are memory-only and never stored. A FramePreview names the asset, the SHA-256 of the decoded bytes, the fingerprint, the dimensions, the planes, the sample format, the scaling, the saturation level and per-plane mask counts and statistics. It also states whether the decoded digest equals the valid record's basis. A tile carries its level, region, applied stretch, gray values and mask codes. Tile, region, sample and cutout requests name the expected SHA-256. A different decoded digest returns Conflict, and the caller reopens the frame. Cutouts of a fitted star return observed, fitted and residual arrays. A failed star returns only the observed array.

## Atomicity and durability

Every write is one `BEGIN IMMEDIATE` transaction on the FULL-synchronous writer, and nothing reports success before its commit. Recording a measurement and updating its run counters commit together. Confirming an import validates the single-use review, every resolution against its candidates and every attached asset's current fingerprint. It then commits the state, the resolutions and the values together, or returns Conflict, InvalidInput or PersistenceFailure with no row changed. A disposable `max_page_count` catalog proves PersistenceFailure for both writes and that nothing persists after reopen. Restart restores committed records and imports and marks a Running run Interrupted.

## Independence

PIX writes no asset, digest, quality, session, association, correction, View, Project or source file. Measurement never excludes, rejects or marks a frame Usable (PIX-FR-08). Approved and Locked columns are never stored. Retire location keeps a retired copy's records as history, and those copies read unavailable (R21).
