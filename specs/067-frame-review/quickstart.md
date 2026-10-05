# Frame review acceptance guide

## Inputs

Use a fresh disposable catalog and frames from the `platevault_pixels` fixture generator, never a real library. The [library acceptance guide](../064-library-inventory/quickstart.md) describes indexing. Build this set:

- Five sessions of 256×256 UInt16 lights: 18 Sep Ha 55, 28 Sep Ha 56, 24 Sep OIII 20, 26 Sep OIII 35 and 30 Sep OIII 42, so 208 frames in total. Mix FITS and XISF, including zlib and lz4 XISF with byte shuffling.
- In the 30 Sep session, six frames with trailed stars at a sigma ratio of 2.5. One frame W has a well-exposed star at a recorded position. One frame S has a star clipped at 65535 at a recorded position.
- Defect frames: Float32 FITS and XISF with NaN, positive and negative infinity and a saturated plateau, and a 16-bit FITS frame with BLANK samples.
- CFA frames: an RGGB UInt16 FITS with BAYERPAT, XBAYROFF and YBAYROFF, and an XISF with a `ColorFilterArray` element.
- SubframeSelector CSV A: the 1.9.x 30-column layout with its preamble, Scale Unit arcsec and Data Unit DN. It covers the five sessions by absolute paths from another machine. It adds a row naming a file in no session and a row whose basename exists in two session folders. Every row has Approved and Locked set.
- CSV B: the same table without its preamble.

Record every path, size and SHA-256 before running. Read [the data model](data-model.md) and [the IPC contract](contracts/frame-review.md) for fields and states.

## Backend proof

1. Index the locations. List and page sessions, then read frame states for the 208 frames. Every frame reads `not_measured`, and no run or record exists (PIX-AC-06; VSEL's quality-state filter is re-checked with 066).
2. Measure 100 frames and wait for Completed. Read frame states: 100 read `cached` from the catalog read alone and 108 read `not_measured` (PIX-AC-01).
3. Start measurement of all 208 with frame W as priority. The run reports 100 `alreadyCached`, and W has `dequeueSequence` 1. While it runs, open W and read tiles; both succeed before the run ends (PIX-FR-01).
4. Cancel. The run reads Canceled, frames measured before the cancel stay `cached` and the rest read `not_measured`. Asset, quality, session and every other non-measurement row is unchanged (PIX-AC-01). Start again: only the missing frames are queued.
5. On W, read linear, strong MTF and auto tiles, the five comparison regions and the next and previous frames in request order. Its record and values are identical before and after, and the source hashes are unchanged (PIX-AC-02, PIX-FR-03, PIX-FR-04).
6. Read the stars of S. The clipped star reads `failed` with `saturated` and carries no FWHM or HFR. W's star reads fitted with model, shape values, "FWHM (Gaussian fit)" and "HFR (half-flux radius)" in px. Its cutouts return observed, fitted and residual arrays (PIX-AC-03, PIX-FR-05).
7. Read the detail of one asset taken from the frame-state rows. It names the header evidence, the input fingerprint and SHA-256, the plane basis, and each value's method, version, units and source (PIX-AC-07 backend part, PIX-FR-02, PIX-FR-06).
8. Open the defect frames. Mask counts list every category. Sample readout returns `NaN` and the infinities as stored, tile mask codes mark them, and every metric excludes them (PIX-AC-08, PIX-FR-09).
9. Open and measure the CFA frames. The basis reads `cfa_mosaic` with the recorded pattern, and tiles keep the checkerboard sample for sample. Background is reported on the mosaic, and star metrics read unavailable with `cfa_star_metrics_unqualified`. Hashes are unchanged (PIX-AC-09).
10. Review CSV A. The review lists rows as `matched_path`, `matched_name`, `ambiguous` and `unmatched`, with units and method. FWHM reads arcsec with its Subframe Scale, and Median and Noise read DN. Columns without declared units read unavailable, and Approved and Locked read `decision_not_imported`. Confirm without resolving the ambiguous row. Imported values appear beside built-in values, `unverified`, while the `ambiguous` and `unmatched` rows attach to nothing. No quality, membership or built-in value changed (PIX-AC-04, PIX-FR-07, PIX-FR-08).
11. Review CSV B. FWHM, Median and Noise read unavailable with `missing_units`. No column is labelled built-in FWHM or HFR (PIX-AC-05).
12. Close the app during a run and reopen the catalog. Committed records and the confirmed import return unchanged, and the run reads Interrupted. Force SQLITE_FULL through the catalog unit test and observe PersistenceFailure with nothing persisted.
13. Compare the original manifest and hashes exactly (PV-PIX-SC-03).

Run the focused pixel, catalog and core frame review tests, then `cargo test --workspace`, `just db-boundary` and `bash scripts/check-dev-surface-absent.sh` after integration. These checks do not certify the UI or other platforms.

## Real development application

Launch `cargo run -p desktop_shell --features dev-tools --bin platevault-library` with a fresh `PV_LIBRARY_DATA_DIR`. Leave `PV_MCP_BRIDGE_BIND` unset so the bridge binds `127.0.0.1`. Through Tauri MCP `ipc_execute_command`, repeat steps 1 to 12 with the `pix_*` and `library_*` commands and confirm the committed state after restart. The Frames surface, with row, plot and preview selection, the Stars overlay, the disclosure and the import mapping review, stays pending on the final clean-slate frontend. J22 S1 to S7, S14 and S15 stay pending on fresh journey validation, and the View draft steps are verified with 066.

Any untested profile, platform or fixture stays an explicit acceptance gap. After five failed fixes, an issue gets a reproducible backlog entry; this guide is never weakened to pass.
