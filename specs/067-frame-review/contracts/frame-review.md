# Frame review IPC contract

Version: 1. Requests and responses are JSON with UUID identities and camelCase fields, following the [library contract](../../064-library-inventory/contracts/library.md). `NativePath`, `ObservationFingerprint` with decimal-string `modifiedNs`, `ErrorResponse` and `Availability` keep their library wire forms. Pixel coordinates are 0-based storage indices (x column, y stored row). Widths and radii are pixels, angles degrees. Every value names its units and source. A JSON number is always finite. A non-finite sample is the string `NaN`, `Infinity` or `-Infinity`, and an unknown value is `null` with a reason.

## Inputs

- `Stretch`: `{kind: "linear", black, white}` with finite `black < white` in plane units; `{kind: "mtf", shadows, midtones, highlights}` with `0 <= shadows < highlights <= 1` and `0 < midtones < 1`; or `{kind: "auto"}`. Every tile response returns the applied parameters.
- `TileRequest`: `{assetId, sha256, plane, level, x, y, width, height, stretch}` with `width` and `height` from 1 to 1024 and `level` from 0 to 8. `x`, `y`, `width` and `height` are in level coordinates.
- `RowResolution`: `{index, assetId}`. The asset must be one of the row's listed candidates.

## Commands

| Command | Request | Response and behavior |
| --- | --- | --- |
| pix_review_frames | assets: Uuid[] | One FrameState per asset in request order, plus the Running run if any. Catalog read only. It starts no measurement and reads no source. |
| pix_start_measurement | assets: Uuid[], priority: Uuid[] | MeasurementRun, Running. Frames with a valid record or a current failure are counted `alreadyCached` and not queued. When a run is Running, the frames join it and that run is returned. `priority` must be a subset of `assets` and is measured first. |
| pix_prioritize_measurement | operationId, assets: Uuid[] | MeasurementRun with those queued frames moved to the head. Settled frames are unaffected. |
| pix_measurement_status | operationId | MeasurementRun: state, counters, issues and revision. Durable truth after reload or restart. |
| pix_cancel_measurement | operationId | MeasurementRun after the cancel request; it reads Canceled once in-flight frames settle. Committed records stay. No View, selection, exclusion or quality record changes. |
| pix_list_measurement_runs | offset, limit | Runs newest first, including Interrupted runs after restart. |
| pix_open_frame | assetId | FramePreview after a verified contained read of the current file. Decoding happens off the UI thread and never waits behind measurement. Returns SourceUnavailable for an unavailable asset and UnsupportedFormat naming the feature. |
| pix_preview_tile | TileRequest | PreviewTile: `{level, x, y, width, height, appliedStretch, gray, mask}`, where `gray` is base64 8-bit values and `mask` is base64 category codes, or null when the tile has no masked sample. The source and every record are unchanged. |
| pix_compare_regions | assetId, sha256, plane, size, stretch | Five full-resolution PreviewTiles at fixed positions: center, top-left, top-right, bottom-left, bottom-right. `size` is 16 to 1024 and clamps to the frame. |
| pix_sample_region | assetId, sha256, plane, x, y, width, height | Up to 64×64 samples, each `{stored, value, category}`, with non-finite values as strings. Masked samples are returned as stored, never replaced. |
| pix_frame_stars | assetId | Stars of the valid record with state, warnings and reasons, or the frame state when no valid record exists. |
| pix_star_cutouts | assetId, measurementId, star, sha256 | Observed, fitted and residual arrays for a fitted star; observed only for a failed star. Conflict when the decoded digest differs from the record's basis. |
| pix_frame_detail | assetId | Disclosure: the asset identity and fingerprint, observed and effective header metadata, and the built-in record with method, version, units, input basis and verification label. Also lists imported values with their import, column, units, method, match basis, verification and drift. Read only. |
| pix_review_import | path: NativePath, scope: Uuid[] | ImportReview, durable and `reviewed`: preamble, layout, every column with class, units and reason, and every row with match state and candidates. Hashing for the import basis runs off the UI thread. No value is attached to a frame yet. |
| pix_import_review | reviewId | The stored ImportReview, reviewed or confirmed. |
| pix_confirm_import | reviewId, resolutions: RowResolution[] | ConfirmedImport after one commit: attached rows, imported values per asset and the rows left unattached. Conflict when the review was already confirmed or an attached asset changed since review. InvalidInput for a resolution outside a row's candidates. Nothing is written on refusal. |

No command writes a source file, a preview file or a non-PIX catalog record.

## Response shapes

- `FrameState`: `assetId`, `state` (`cached`, `pending`, `failed`, `unavailable`, `not_measured`), `reason`, `availability`, `measurementId`, `measuredAt`, `verification` (`current` or `last_observed`), `basis` `{fingerprint, plane, saturation}`, `values[]` and `imported[]`.
- `values[]`: `{metric, label, value, units, state, reason, source: {kind: "built_in", method, version}}`. Labels keep "FWHM (Gaussian fit)" and "HFR (half-flux radius)" distinct.
- `imported[]`: `{importId, column, label, value, units, unitsBasis, warnings, source: {kind: "imported", format, moduleVersion, psfType}, match, verification: "unverified", drift}`. An imported value never replaces or fills a built-in value.
- `MeasurementRun`: `operationId`, `revision`, `state` (`running`, `completed`, `canceled`, `interrupted`, `failed`), `method`, the six counters, `issues[]` `{assetId, kind, message}`, `startedAt`, `finishedAt`.
- `Star`: `index`, `x`, `y`, `state`, `reasons`, `warnings`, `peak`, `flux`, `localBackground`, and for fitted stars `model`, `fwhmMajorPx`, `fwhmMinorPx`, `fwhmPx`, `eccentricity`, `positionAngleDeg`, `hfrPx`.
- `ImportReview`: `reviewId`, `revision`, `state`, `source` `{path, sizeBytes, sha256}`, `moduleVersion`, `preamble[]`, `layout`, `columns[]` `{header, position, class, units, unitsBasis, reason, warnings}` and `rows[]` `{index, file, match, candidates, assetId, basis, values}`.

## Errors

InvalidInput, NotFound, Conflict, IdentityConflict, SourceUnavailable, AccessDenied, UnsupportedFormat, MetadataUnreadable and PersistenceFailure use the library `ErrorResponse`. They name the asset, run, import, row or path and say whether reload, review or retry applies. Malformed or truncated pixel data is MetadataUnreadable naming the structure. A source that changed while being read is IdentityConflict and leaves no record. Unknown evidence is data, never a zero or a measured value.

## Events

`pix_measurement_progress` carries `{operationId, revision, state, counters, assetId, frameState}` for each settled frame and state change. Events can be lost; `pix_measurement_status` and `pix_review_frames` are the durable truth.

## Contract extensions

VSEL (066) calls these commands with draft asset IDs and reads frame states for its measurement columns. RES (070) may reuse the pixel decode and display library for product files through its own commands. Each feature versions its own additive fields.

## Development verification

The isolated rebuilt shell registers these commands beside the library commands, with the same loopback-only dev bridge and release exclusion. Backend IPC proof does not certify the Frames surface. The clean-slate frontend must keep row, plot and preview selection in sync, show the Stars overlay, the disclosure and the import mapping review, and validate them through MCP with fresh J22 validation.
