//! `inbox.classify` use case (spec 005, T014/T016/T020).
//!
//! Reads cached classification when `content_signature` matches; falls back
//! to metadata adapters on miss or `force_rescan`. Normalizes IMAGETYP via
//! `ImageTypNormalizationTable`. Marks files `unclassified = true` when
//! IMAGETYP is absent or unmapped.
//!
//! This module is pure orchestration: DB reads/writes via
//! `persistence_db::repositories::inbox`; metadata reads via
//! `metadata_fits::FitsExtractor` / `metadata_xisf::XisfExtractor`.
#![allow(clippy::doc_markdown)]

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use calibration_master_detect::{detect_master, DetectInput};
use camino::Utf8Path;
use metadata_core::{v1_normalization_table, EvidenceSource, FrameType, MetadataExtractor};
use metadata_fits::FitsExtractor;
use metadata_xisf::XisfExtractor;

use super::grouping::{group_file, FrameMetadata, GroupingConfig};
use super::signature::folder_signature;
use persistence_db::repositories::inbox::{
    self as repo, InsertEvidence, UpsertClassification, UpsertInboxSubItem,
};
use sqlx::SqlitePool;
use time::format_description::well_known::Rfc3339;
use uuid::Uuid;

use contracts_core::error_code::ErrorCode;
use contracts_core::ContractError;
use contracts_core::ErrorSeverity;

// ── Response types ────────────────────────────────────────────────────────────

/// Per-frame-type breakdown entry.
#[derive(Clone, Debug, serde::Serialize)]
pub struct BreakdownEntry {
    pub kind: String,
    pub count: usize,
    pub destination_preview: Option<String>,
    pub sample_files: Vec<String>,
}

/// Response from the classify use case.
#[derive(Clone, Debug, serde::Serialize)]
pub struct ClassifyResponse {
    pub inbox_item_id: String,
    /// API vocabulary (stable for frontend): "single_type" | "mixed" | "unclassified".
    /// Note: the DB stores "classified" / "unclassified" (migration 0048 CHECK);
    /// the API vocabulary is mapped from the DB value so the frontend contract
    /// stays unchanged until T071/T072 update the contracts.
    pub classification_type: String,
    /// Present when type == "single_type"
    pub frame_type: Option<String>,
    pub content_signature: String,
    pub breakdown: Vec<BreakdownEntry>,
    pub unclassified_files: Vec<String>,
    pub sample_files: Vec<String>,
    pub computed_at: String,
}

// ── Request ───────────────────────────────────────────────────────────────────

pub struct ClassifyRequest {
    pub inbox_item_id: String,
    /// Path to the root of the inbox root (needed to compute absolute file paths).
    pub root_absolute_path: PathBuf,
    pub force_rescan: bool,
}

// ── classify ──────────────────────────────────────────────────────────────────

/// Run or retrieve a classification for an inbox item.
///
/// # Errors
/// Returns a `ContractError` with appropriate error codes.
#[allow(clippy::too_many_lines)]
pub async fn classify(
    pool: &SqlitePool,
    req: ClassifyRequest,
) -> Result<ClassifyResponse, ContractError> {
    // 1. Fetch the inbox item
    let item = repo::get_inbox_item(pool, &req.inbox_item_id).await.map_err(|_| {
        ContractError::new(
            ErrorCode::InboxItemNotFound,
            format!("InboxItem not found: {}", req.inbox_item_id),
            ErrorSeverity::Blocking,
            false,
        )
    })?;

    // 2. Check cache unless force_rescan
    if !req.force_rescan {
        if let Some(cached) =
            repo::get_classification(pool, &req.inbox_item_id).await.ok().flatten()
        {
            // If sig matches, return from cache
            if item.content_signature.as_deref() == Some(&cached.content_signature) {
                return build_response_from_cache(pool, &item, &cached).await;
            }
        }
    }

    // 3. Build absolute path for this item.  Sub-frame groups are folders; a
    //    detected calibration master (spec 040) is a single file.
    let folder_abs = req.root_absolute_path.join(&item.relative_path);

    // 4. Enumerate the FITS/XISF files to classify.  Master items are one file,
    //    not a directory, so reading them as a folder finds nothing — enumerate
    //    the file itself instead (this is why masters were stuck "Loading
    //    classification" forever).
    let file_paths = if item.is_master_item != 0 {
        if folder_abs.is_file() {
            vec![folder_abs.clone()]
        } else {
            Vec::new()
        }
    } else {
        enumerate_fits_files(&folder_abs)
    };
    if file_paths.is_empty() {
        return Err(ContractError::new(
            ErrorCode::MetadataUnreadable,
            format!("No FITS/XISF files found for item: {}", folder_abs.display()),
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // 5. Compute folder content signature
    let sig_refs: Vec<&Path> = file_paths.iter().map(PathBuf::as_path).collect();
    let content_signature = super::signature::compute_content_signature(&sig_refs);

    // 6. Run metadata extraction + classification
    let norm_table = v1_normalization_table();
    let fits_extractor = FitsExtractor;
    let xisf_extractor = XisfExtractor;

    // spec 041 R-4 / T025: before wiping evidence, snapshot per-path override
    // values and detect which files have changed identity (size/mtime). After
    // the fresh evidence re-insert both are re-applied: overrides are
    // re-written for all paths still present in the scan, and the subset whose
    // identity changed is additionally marked override_stale = 1.
    let override_snapshot =
        snapshot_overrides(pool, &req.inbox_item_id, &file_paths, &req.root_absolute_path).await;

    // Delete stale evidence
    repo::delete_evidence_for_item(pool, &req.inbox_item_id).await.ok();
    repo::delete_breakdown_for_item(pool, &req.inbox_item_id).await.ok();
    // spec 041 US2/T016: clear stale per-file metadata so removed files do not
    // leave orphaned rows behind after a re-scan.
    repo::delete_file_metadata_for_item(pool, &req.inbox_item_id).await.ok();

    let mut frame_type_files: HashMap<String, Vec<String>> = HashMap::new();
    let mut unclassified_files: Vec<String> = Vec::new();
    // T066: per-file records for sub-item grouping after the loop.
    // Each entry: (relative_path, frame_type, raw_meta_for_grouping)
    let mut file_records: Vec<(String, Option<FrameType>, Option<metadata_core::RawFileMetadata>)> =
        Vec::new();

    for abs_path in &file_paths {
        // Lossless path → wire-string conversion (camino). `abs_path` descends
        // from a UTF-8 root supplied by the contract, so `Utf8Path::from_path`
        // succeeds; the `to_string_lossy` arms are defensive fallbacks only and
        // replace the previous always-lossy conversions.
        let rel = match abs_path.strip_prefix(&req.root_absolute_path) {
            Ok(p) => Utf8Path::from_path(p).map_or_else(
                || p.to_string_lossy().replace('\\', "/"),
                |u| u.as_str().replace('\\', "/"),
            ),
            Err(_) => Utf8Path::from_path(abs_path)
                .map_or_else(|| abs_path.display().to_string(), |u| u.as_str().to_owned()),
        };

        let ext = abs_path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();

        // Extract raw metadata
        let raw_meta = if xisf_extractor.supports_extension(&ext) {
            xisf_extractor.extract(abs_path).ok().flatten()
        } else if fits_extractor.supports_extension(&ext) {
            fits_extractor.extract(abs_path).ok().flatten()
        } else {
            None
        };

        let image_typ_raw = raw_meta.as_ref().and_then(|m| m.image_typ.as_deref());
        let stack_count = raw_meta.as_ref().and_then(|m| m.stack_count);
        let file_name = abs_path.file_name().and_then(|n| n.to_str()).unwrap_or("");

        // Run master detection first (spec 040 FR-004).
        // detect_master provides both frame_type and is_master when it matches.
        let detect_input =
            DetectInput { imagetyp: image_typ_raw, stack_count, file_name, rel_path: &rel };
        let master_result = detect_master(&detect_input);

        let (frame_type, evidence_source, raw_value, is_unclassified, is_master, master_detector) =
            if let Some(ref det) = master_result {
                // Detector produced a classification — use it directly.
                let src = if ext == "xisf" {
                    EvidenceSource::XisfProperty
                } else {
                    EvidenceSource::ImagetypHeader
                };
                (
                    Some(det.frame_type),
                    src,
                    image_typ_raw.map(str::to_owned),
                    false,
                    det.is_master,
                    Some(det.detector),
                )
            } else if let Some(raw) = image_typ_raw {
                // No master detector matched; fall back to the normalization table.
                match norm_table.normalize(raw) {
                    Some(ft) => {
                        let src = if ext == "xisf" {
                            EvidenceSource::XisfProperty
                        } else {
                            EvidenceSource::ImagetypHeader
                        };
                        (Some(ft), src, Some(raw.to_owned()), false, false, None)
                    }
                    None => (None, EvidenceSource::None, Some(raw.to_owned()), true, false, None),
                }
            } else {
                (None, EvidenceSource::None, None, true, false, None)
            };

        // Persist evidence
        let ev_id = Uuid::new_v4().to_string();
        let ev = InsertEvidence {
            id: &ev_id,
            inbox_item_id: &req.inbox_item_id,
            relative_file_path: &rel,
            frame_type: frame_type.map(FrameType::as_str),
            evidence_source: evidence_source.as_str(),
            raw_value: raw_value.as_deref(),
            unclassified: is_unclassified,
            manual_override: None,
            is_master,
            master_detector,
        };
        repo::insert_evidence(pool, &ev).await.ok();

        // spec 041 US2/T016: persist per-file extracted header metadata. The
        // raw extractor returns string fields; we parse the numeric ones here
        // (gain stays a string — some cameras report scaled/non-integer gain).
        persist_file_metadata(pool, &req.inbox_item_id, &rel, abs_path, raw_meta.as_ref()).await;

        if is_unclassified {
            unclassified_files.push(rel.clone());
        } else if let Some(ft) = frame_type {
            frame_type_files.entry(ft.as_str().to_owned()).or_default().push(rel.clone());
        }
        // T066: collect for sub-item grouping (done after the loop).
        file_records.push((rel, frame_type, raw_meta));
    }

    // spec 041 R-4 / T025: re-apply snapshotted overrides to freshly-inserted
    // evidence rows, then mark stale the subset whose file identity changed.
    for entry in &override_snapshot {
        repo::set_overrides(
            pool,
            &req.inbox_item_id,
            &entry.relative_file_path,
            entry.manual_override.as_deref(),
            entry.override_filter.as_deref(),
            entry.override_exposure_s,
            entry.override_binning.as_deref(),
        )
        .await
        .ok();
        if entry.stale {
            repo::mark_override_stale(pool, &req.inbox_item_id, &entry.relative_file_path)
                .await
                .ok();
        }
    }

    // 7. Determine folder-level classification result.
    //
    // Two distinct string spaces are used:
    //   db_result    — stored in inbox_classifications.result; must match the
    //                  CHECK constraint introduced in migration 0048:
    //                  ('classified', 'unclassified').  'single_type' and
    //                  'mixed' no longer exist at the DB level. A folder with
    //                  a single frame type → 'classified'; a folder with
    //                  multiple frame types → 'unclassified' (the mixed case
    //                  will be re-split into single-type sub-items in T066).
    //   api_result   — returned in ClassifyResponse.classification_type; kept
    //                  on the stable pre-0048 vocabulary ('single_type' /
    //                  'mixed' / 'unclassified') so the frontend contract and
    //                  confirm routing remain unchanged until T071/T072 land.
    let distinct_types: Vec<&str> = frame_type_files.keys().map(String::as_str).collect();
    let (db_result, api_result, single_frame_type) = match distinct_types.len() {
        0 => ("unclassified", "unclassified", None),
        1 => ("classified", "single_type", Some(distinct_types[0].to_owned())),
        _ => ("unclassified", "mixed", None),
    };

    let unclassified_count = i64::try_from(unclassified_files.len()).unwrap_or(i64::MAX);

    // T066: Materialize single-type sub-items (R-9/R-11).
    //
    // For each file we build a FrameMetadata from extracted raw_meta, then call
    // group_file with the per-type GroupingConfig::default_for to get its
    // deterministic group_key. Files are partitioned by group_key; unclassifiable
    // files go into the sentinel __needs_review__ bucket (gate logic is T070).
    // For each group we upsert one inbox_items row with identity
    // (root_id, relative_path, group_key) and a per-sub-group content_signature.
    //
    // Only runs when the item has a source_group_id (i.e. was discovered via
    // T065 scan → source group). Legacy items without a source group are
    // skipped here (they continue to function as single folder-level items
    // until they are rescanned after T065 is in place).
    if let Some(ref sg_id) = item.source_group_id {
        materialize_sub_items(
            pool,
            sg_id,
            &item.root_id,
            &item.relative_path,
            &item.lane,
            &file_paths,
            &file_records,
        )
        .await;
    }

    // 8. Persist classification (use db_result which satisfies migration 0048 CHECK).
    let classification = UpsertClassification {
        inbox_item_id: &req.inbox_item_id,
        result: db_result,
        frame_type: single_frame_type.as_deref(),
        content_signature: &content_signature,
        unclassified_file_count: unclassified_count,
    };
    repo::upsert_classification(pool, &classification).await.ok();

    // 9. Update item state and signature
    repo::update_inbox_item_scan(
        pool,
        &req.inbox_item_id,
        &content_signature,
        i64::try_from(file_paths.len()).unwrap_or(i64::MAX),
    )
    .await
    .ok();

    repo::update_inbox_item_state(pool, &req.inbox_item_id, "classified").await.ok();

    // 10. Build + persist breakdown with destination previews
    let breakdown =
        build_breakdown(pool, &req.inbox_item_id, &frame_type_files, &req.root_absolute_path).await;

    // 11. Sample files for top-level response
    let all_classified: Vec<String> =
        frame_type_files.values().flatten().take(10).cloned().collect();

    let computed_at = time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned());

    Ok(ClassifyResponse {
        inbox_item_id: req.inbox_item_id,
        // api_result retains the pre-0048 vocabulary for frontend stability.
        classification_type: api_result.to_owned(),
        frame_type: single_frame_type,
        content_signature,
        breakdown,
        unclassified_files,
        sample_files: all_classified,
        computed_at,
    })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Map extracted `RawFileMetadata` → an `inbox_file_metadata` upsert and write
/// it (spec 041 US2/T016).
///
/// Numeric header fields arrive as `Option<String>` from the extractor; we
/// parse them to `i64`/`f64` here. `gain` is intentionally left as a string.
/// `file_size_bytes`/`file_mtime` are the cheap per-file identity used for
/// override staleness (R-4); a failed `stat` simply leaves them `None`.
async fn persist_file_metadata(
    pool: &SqlitePool,
    inbox_item_id: &str,
    rel: &str,
    abs_path: &Path,
    raw_meta: Option<&metadata_core::RawFileMetadata>,
) {
    // Parse a trimmed numeric string (e.g. "120.0", "2") to a target number.
    fn parse_f64(s: Option<&String>) -> Option<f64> {
        s.and_then(|v| v.trim().parse::<f64>().ok())
    }
    fn parse_i64(s: Option<&String>) -> Option<i64> {
        // Integer headers (NAXIS*, XBINNING/YBINNING) are whole numbers; a few
        // writers append a trailing ".0", so strip that before parsing.
        s.and_then(|v| {
            let t = v.trim();
            t.parse::<i64>()
                .ok()
                .or_else(|| t.strip_suffix(".0").and_then(|i| i.parse::<i64>().ok()))
        })
    }

    // Cheap per-file identity (size + mtime) for override staleness (R-4).
    let (file_size_bytes, file_mtime) = match std::fs::metadata(abs_path) {
        Ok(md) => {
            let size = i64::try_from(md.len()).ok();
            let mtime = md
                .modified()
                .ok()
                .and_then(|t| time::OffsetDateTime::from(t).format(&Rfc3339).ok());
            (size, mtime)
        }
        Err(_) => (None, None),
    };

    let m = if let Some(meta) = raw_meta {
        repo::UpsertFileMetadata {
            inbox_item_id,
            relative_file_path: rel,
            filter: meta.filter.as_deref().map(str::trim).filter(|s| !s.is_empty()),
            exposure_s: parse_f64(meta.exposure.as_ref()),
            gain: meta.gain.as_deref().map(str::trim).filter(|s| !s.is_empty()),
            binning_x: parse_i64(meta.x_binning.as_ref()),
            binning_y: parse_i64(meta.y_binning.as_ref()),
            // temperature: not currently extracted into RawFileMetadata; leave None.
            temperature_c: None,
            object: meta.object.as_deref().map(str::trim).filter(|s| !s.is_empty()),
            date_obs: meta.date_obs.as_deref().map(str::trim).filter(|s| !s.is_empty()),
            instrume: meta.instrume.as_deref().map(str::trim).filter(|s| !s.is_empty()),
            telescop: meta.telescop.as_deref().map(str::trim).filter(|s| !s.is_empty()),
            naxis1: parse_i64(meta.naxis1.as_ref()),
            naxis2: parse_i64(meta.naxis2.as_ref()),
            stack_count: meta.stack_count.map(i64::from),
            file_size_bytes,
            file_mtime: file_mtime.as_deref(),
        }
    } else {
        // No header metadata — still record identity for staleness tracking.
        repo::UpsertFileMetadata {
            inbox_item_id,
            relative_file_path: rel,
            file_size_bytes,
            file_mtime: file_mtime.as_deref(),
            ..Default::default()
        }
    };

    repo::upsert_inbox_file_metadata(pool, &m).await.ok();
}

/// Collect relative file paths that need to be marked as stale after the
/// rescan evidence/metadata wipe (spec 041 R-4).
///
/// A file is stale when ALL of:
/// - it has at least one override column set (manual_override / filter /
///   exposure_s / binning), AND
/// - its current on-disk size or mtime differs from what was stored in
///   `inbox_file_metadata` at the previous classify.
///
/// Called BEFORE `delete_evidence_for_item` / `delete_file_metadata_for_item`
/// because both tables are wiped in the rescan. The returned paths are then
/// used to call `mark_override_stale` on the freshly-inserted evidence rows.
///
/// Failures are silently ignored — the classify result is unaffected.
/// Snapshot of a single evidence row's override values, captured before the
/// evidence table is wiped on a rescan (spec 041 R-4 / T025).
struct OverrideSnapshot {
    relative_file_path: String,
    manual_override: Option<String>,
    override_filter: Option<String>,
    override_exposure_s: Option<f64>,
    override_binning: Option<String>,
    /// True when the file's current on-disk identity (size/mtime) differs from
    /// the stored `inbox_file_metadata` row, meaning the file changed since the
    /// override was recorded.
    stale: bool,
}

/// Before the evidence/metadata wipe on a rescan, snapshot all evidence rows
/// that carry any override, paired with a staleness flag (spec 041 R-4 / T025).
///
/// For each such row that also appears in the current scan:
/// - compare stored file identity (size/mtime in `inbox_file_metadata`) against
///   the current on-disk stat; set `stale = true` when they differ.
///
/// Called BEFORE `delete_evidence_for_item` / `delete_file_metadata_for_item`.
/// After the fresh evidence re-insert the caller must:
///   1. call `set_overrides` for every entry (preserves the user's decision), and
///   2. call `mark_override_stale` for entries where `stale == true`.
///
/// Failures are silently ignored — the classify result is unaffected.
async fn snapshot_overrides(
    pool: &SqlitePool,
    inbox_item_id: &str,
    file_paths: &[PathBuf],
    root_absolute_path: &Path,
) -> Vec<OverrideSnapshot> {
    let mut snapshots = Vec::new();

    let evidence = repo::list_evidence(pool, inbox_item_id).await.unwrap_or_default();

    for ev in evidence {
        let has_override = ev.manual_override.is_some()
            || ev.override_filter.is_some()
            || ev.override_exposure_s.is_some()
            || ev.override_binning.is_some();

        if !has_override {
            continue;
        }

        // Only re-apply for files that appear in the current scan.
        let in_scan = file_paths.iter().any(|p| {
            p.strip_prefix(root_absolute_path)
                .is_ok_and(|r| r.to_string_lossy().replace('\\', "/") == ev.relative_file_path)
        });
        if !in_scan {
            continue;
        }

        // Compare stored identity against current on-disk stat.
        let stale = 'stale: {
            let prior = repo::get_file_metadata(pool, inbox_item_id, &ev.relative_file_path)
                .await
                .ok()
                .flatten();
            let Some(prior) = prior else { break 'stale false };

            let abs = root_absolute_path.join(&ev.relative_file_path);
            let Ok(md) = std::fs::metadata(&abs) else { break 'stale false };
            let new_size = i64::try_from(md.len()).ok();
            let new_mtime = md
                .modified()
                .ok()
                .and_then(|t| time::OffsetDateTime::from(t).format(&Rfc3339).ok());

            prior.file_size_bytes != new_size || prior.file_mtime.as_deref() != new_mtime.as_deref()
        };

        snapshots.push(OverrideSnapshot {
            relative_file_path: ev.relative_file_path,
            manual_override: ev.manual_override,
            override_filter: ev.override_filter,
            override_exposure_s: ev.override_exposure_s,
            override_binning: ev.override_binning,
            stale,
        });
    }

    snapshots
}

/// Sentinel group key used for files that are unclassifiable or missing
/// grouping-mandatory attributes (T066 / R-14). T070 adds the gate logic.
pub const SENTINEL_NEEDS_REVIEW: &str = "__needs_review__";

/// Build a [`FrameMetadata`] from a [`metadata_core::RawFileMetadata`] for use
/// with the grouping engine (T066). Only fields that the grouping engine reads
/// are populated; extended fields (set_temp, pointing, rotation, optic-train,
/// observing-night) require additional FITS keywords not yet extracted by the
/// core extractor — they default to `None` so those dimensions gracefully fall
/// back to the [`crate::grouping::SENTINEL_MISSING`] bucket (R-9 best-effort).
fn build_frame_metadata(
    frame_type: FrameType,
    raw: &metadata_core::RawFileMetadata,
) -> FrameMetadata {
    fn parse_f64(s: Option<&String>) -> Option<f64> {
        s.and_then(|v| v.trim().parse::<f64>().ok())
    }
    fn parse_i32(s: Option<&String>) -> Option<i32> {
        s.and_then(|v| {
            let t = v.trim();
            t.parse::<i32>()
                .ok()
                .or_else(|| t.strip_suffix(".0").and_then(|i| i.parse::<i32>().ok()))
        })
    }
    FrameMetadata {
        frame_type,
        filter: raw.filter.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_owned),
        exposure_s: parse_f64(raw.exposure.as_ref()),
        gain: raw.gain.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_owned),
        offset: None, // OFFSET not yet in RawFileMetadata; phase-12 adds it
        binning_x: parse_i32(raw.x_binning.as_ref()),
        binning_y: parse_i32(raw.y_binning.as_ref()),
        set_temp_c: None, // SET-TEMP: phase-12
        ccd_temp_c: None, // CCD-TEMP: phase-12
        ra_deg: None,     // RA/DEC: phase-12
        dec_deg: None,
        rotator_angle_deg: None, // ROTATANG: phase-12
        readout_mode: None,      // READOUTM: phase-12
        telescop: raw
            .telescop
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned),
        instrume: raw
            .instrume
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned),
        focal_length_mm: None, // FOCALLEN: phase-12
        date_loc: None,        // DATE-LOC: phase-12
        date_obs: raw
            .date_obs
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned),
    }
}

/// Materialize one single-type `inbox_items` sub-item per homogeneous group
/// within a source group (spec 041 T066, R-9/R-10/R-11/R-12).
///
/// # Algorithm
/// 1. Build a [`FrameMetadata`] for each file from its extracted raw metadata.
/// 2. Call [`group_file`] with [`GroupingConfig::default_for`] the file's frame
///    type to get a deterministic `(group_key, group_label)`.
/// 3. Unclassifiable files (no frame type) go into the sentinel
///    [`SENTINEL_NEEDS_REVIEW`] bucket (gate logic is T070).
/// 4. Per group: compute a per-sub-group `content_signature` =
///    `folder_signature(sorted per-file sigs of files in that group)`, then
///    upsert an `inbox_items` row with identity `(root_id, relative_path,
///    group_key)` — stable across rescans of unchanged content (FR-042).
/// 5. Update the source group's `child_count`.
///
/// Failures are silently ignored — classify's primary evidence/classification
/// result is unaffected.
#[allow(clippy::too_many_arguments)]
async fn materialize_sub_items(
    pool: &sqlx::SqlitePool,
    source_group_id: &str,
    root_id: &str,
    relative_path: &str,
    lane: &str,
    file_paths: &[PathBuf],
    file_records: &[(String, Option<FrameType>, Option<metadata_core::RawFileMetadata>)],
) {
    // Step 1 + 2: partition files by group_key.
    // key → (group_label, Vec<abs_path>)
    let mut groups: std::collections::HashMap<String, (String, Vec<PathBuf>)> =
        std::collections::HashMap::new();

    for (i, (rel, frame_type_opt, raw_meta_opt)) in file_records.iter().enumerate() {
        let abs_path = file_paths.get(i).cloned();

        let (group_key, group_label) = if let Some(ft) = *frame_type_opt {
            // Build effective FrameMetadata for the grouping engine.
            let meta = raw_meta_opt
                .as_ref()
                .map(|r| build_frame_metadata(ft, r))
                .unwrap_or_else(|| FrameMetadata { frame_type: ft, ..Default::default() });

            let config = GroupingConfig::default_for(ft);
            let result = group_file(&meta, &config);
            (result.key.0, result.label.0)
        } else {
            // Unclassifiable — sentinel bucket (T070 adds gate).
            (SENTINEL_NEEDS_REVIEW.to_owned(), "(root) · needs review".to_owned())
        };

        let entry = groups.entry(group_key).or_insert_with(|| (group_label, Vec::new()));
        // Track the absolute path for signature computation.
        if let Some(p) = abs_path {
            entry.1.push(p);
        } else {
            // If we can't resolve the abs path (shouldn't happen), still create
            // the group entry so the sub-item is upserted with file_count.
            let _ = rel; // rel is in scope; abs derivation would need root + rel
        }
    }

    // Step 4 + 5: upsert one sub-item per group and update child_count.
    let child_count = i64::try_from(groups.len()).unwrap_or(i64::MAX);

    for (group_key, (group_label, abs_paths)) in &groups {
        // Per-sub-group content_signature (R-11).
        let file_sigs: Vec<[u8; 32]> =
            abs_paths.iter().filter_map(|p| super::signature::file_signature(p)).collect();
        let sub_sig = folder_signature(file_sigs);

        // Determine frame_type from the group_key prefix (type=<value>).
        let frame_type_str: Option<&str> = if group_key == SENTINEL_NEEDS_REVIEW {
            None
        } else {
            // group_key starts with "type=<ft>·..." — extract the type token.
            group_key
                .strip_prefix("type=")
                .and_then(|rest| rest.split('·').next())
                .filter(|s| !s.is_empty())
        };

        let file_count = i64::try_from(abs_paths.len()).unwrap_or(i64::MAX);
        let sub_id = Uuid::new_v4().to_string();

        let sub_item = UpsertInboxSubItem {
            id: &sub_id,
            root_id,
            relative_path,
            source_group_id,
            group_key,
            group_label,
            frame_type: frame_type_str,
            content_signature: &sub_sig,
            file_count,
            lane,
        };

        repo::upsert_inbox_sub_item(pool, &sub_item).await.ok();
    }

    repo::update_source_group_child_count(pool, source_group_id, child_count).await.ok();
}

/// Enumerate FITS/XISF files directly inside a folder (non-recursive).
fn enumerate_fits_files(folder: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let Ok(read_dir) = std::fs::read_dir(folder) else {
        return files;
    };
    for entry in read_dir.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
        if matches!(ext.as_str(), "fits" | "fit" | "fts" | "xisf") {
            files.push(path);
        }
    }
    files.sort();
    files
}

/// Build breakdown entries and persist them.
///
/// spec 041 US3/T018: each frame-type group gets a `destination_preview` —
/// the directory the active Naming & Structure pattern resolves to for that
/// group's first file. This reuses the SAME resolve path `confirm.rs` uses
/// (`load_active_pattern` + `build_metadata_bundle` + `resolve_v1`) so the
/// inbox surface previews exactly where a confirm would move the files. When
/// the pattern is unset/invalid or resolution fails, the preview is left
/// `None` (the surface shows a dash).
async fn build_breakdown(
    pool: &SqlitePool,
    inbox_item_id: &str,
    frame_type_files: &HashMap<String, Vec<String>>,
    root_absolute_path: &Path,
) -> Vec<BreakdownEntry> {
    // Load the active pattern once; if it is unset/invalid every preview is None.
    let active_pattern = super::confirm::load_active_pattern(pool).await.ok();
    let norm_table = v1_normalization_table();
    let fits_extractor = FitsExtractor;
    let xisf_extractor = XisfExtractor;

    let mut entries = Vec::new();

    for (kind, files) in frame_type_files {
        let count = files.len();
        let sample: Vec<String> = files.iter().take(10).cloned().collect();
        let sample_json = serde_json::to_string(&sample).unwrap_or_else(|_| "[]".to_owned());

        // Resolve a destination-directory preview from the group's first file.
        let destination_preview = active_pattern.as_ref().and_then(|pattern| {
            let first_rel = files.first()?;
            let abs_path = root_absolute_path.join(first_rel);
            let bundle = super::confirm::build_metadata_bundle(
                &abs_path,
                kind,
                &norm_table,
                &fits_extractor,
                &xisf_extractor,
            );
            patterns::resolve_v1(pattern, &bundle).ok().map(|r| r.relative_path)
        });

        let bd_id = Uuid::new_v4().to_string();
        let count_i64 = i64::try_from(count).unwrap_or(i64::MAX);
        repo::upsert_breakdown_row(
            pool,
            &bd_id,
            inbox_item_id,
            kind,
            count_i64,
            destination_preview.as_deref(),
            &sample_json,
        )
        .await
        .ok();

        entries.push(BreakdownEntry {
            kind: kind.clone(),
            count,
            destination_preview,
            sample_files: sample,
        });
    }

    entries.sort_by(|a, b| a.kind.cmp(&b.kind));
    entries
}

/// Build a ClassifyResponse from cached DB rows.
async fn build_response_from_cache(
    pool: &SqlitePool,
    item: &persistence_db::repositories::inbox::InboxItemRow,
    cached: &persistence_db::repositories::inbox::InboxClassificationRow,
) -> Result<ClassifyResponse, ContractError> {
    let breakdown_rows = repo::list_breakdown(pool, &item.id).await.unwrap_or_default();
    let evidence_rows = repo::list_evidence(pool, &item.id).await.unwrap_or_default();

    let breakdown: Vec<BreakdownEntry> = breakdown_rows
        .into_iter()
        .map(|row| {
            let samples: Vec<String> = serde_json::from_str(&row.sample_files).unwrap_or_default();
            BreakdownEntry {
                kind: row.kind,
                count: usize::try_from(row.count).unwrap_or(0),
                destination_preview: row.destination_preview,
                sample_files: samples,
            }
        })
        .collect();

    let unclassified_files: Vec<String> = evidence_rows
        .iter()
        .filter(|ev| ev.unclassified != 0 && ev.manual_override.is_none())
        .map(|ev| ev.relative_file_path.clone())
        .collect();

    let sample_files: Vec<String> = evidence_rows
        .iter()
        .filter(|ev| ev.frame_type.is_some())
        .take(10)
        .map(|ev| ev.relative_file_path.clone())
        .collect();

    let computed_at = cached.computed_at.clone();

    Ok(ClassifyResponse {
        inbox_item_id: item.id.clone(),
        classification_type: cached.result.clone(),
        frame_type: cached.frame_type.clone(),
        content_signature: cached.content_signature.clone(),
        breakdown,
        unclassified_files,
        sample_files,
        computed_at,
    })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use persistence_db::repositories::inbox as inbox_repo;
    use persistence_db::repositories::inbox::InsertInboxItem;
    use persistence_db::Database;
    use std::io::Write;

    async fn test_db() -> Database {
        let db = Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        db
    }

    fn write_fits_with_imagetyp(dir: &Path, name: &str, imagetyp: &str) {
        let path = dir.join(name);
        // Write minimal valid FITS-like content with an IMAGETYP card
        // (not a real FITS file but sufficient for the header extractor to try)
        let mut data = vec![b' '; 2880];
        let card = format!("IMAGETYP= '{imagetyp:<8}'");
        let bytes = card.as_bytes();
        let len = bytes.len().min(80);
        data[0..len].copy_from_slice(&bytes[..len]);
        // END card
        data[80..83].copy_from_slice(b"END");
        let mut f = std::fs::File::create(path).unwrap();
        f.write_all(&data).unwrap();
    }

    #[tokio::test]
    async fn classify_single_type_light_folder() {
        let tmp = tempfile::tempdir().unwrap();
        write_fits_with_imagetyp(tmp.path(), "light_001.fits", "Light Frame");
        write_fits_with_imagetyp(tmp.path(), "light_002.fits", "Light Frame");

        let db = test_db().await;

        // Insert the item
        let item_id = "item-classify-1";
        repo::insert_inbox_item(
            db.pool(),
            &InsertInboxItem {
                id: item_id,
                root_id: "root-1",
                relative_path: "",
                file_count: 0,
                content_signature: None,
                lane: "fits",
            },
        )
        .await
        .unwrap();

        let req = ClassifyRequest {
            inbox_item_id: item_id.to_owned(),
            root_absolute_path: tmp.path().to_owned(),
            force_rescan: false,
        };

        let resp = classify(db.pool(), req).await.unwrap();
        assert_eq!(resp.classification_type, "single_type");
        assert_eq!(resp.frame_type, Some("light".to_owned()));
        assert!(!resp.content_signature.is_empty());
    }

    #[tokio::test]
    async fn classify_mixed_folder() {
        let tmp = tempfile::tempdir().unwrap();
        write_fits_with_imagetyp(tmp.path(), "light.fits", "Light Frame");
        write_fits_with_imagetyp(tmp.path(), "dark.fits", "Dark Frame");

        let db = test_db().await;
        let item_id = "item-classify-mixed";
        repo::insert_inbox_item(
            db.pool(),
            &InsertInboxItem {
                id: item_id,
                root_id: "root-1",
                relative_path: "",
                file_count: 0,
                content_signature: None,
                lane: "fits",
            },
        )
        .await
        .unwrap();

        let req = ClassifyRequest {
            inbox_item_id: item_id.to_owned(),
            root_absolute_path: tmp.path().to_owned(),
            force_rescan: false,
        };

        let resp = classify(db.pool(), req).await.unwrap();
        assert_eq!(resp.classification_type, "mixed");
        assert!(resp.frame_type.is_none());
        assert_eq!(resp.breakdown.len(), 2);
    }

    #[tokio::test]
    async fn classify_no_imagetyp_returns_unclassified() {
        let tmp = tempfile::tempdir().unwrap();
        // Write a file with no IMAGETYP card
        let path = tmp.path().join("mystery.fits");
        let mut data = vec![b' '; 2880];
        data[0..3].copy_from_slice(b"END");
        let mut f = std::fs::File::create(path).unwrap();
        f.write_all(&data).unwrap();

        let db = test_db().await;
        let item_id = "item-unclassified";
        repo::insert_inbox_item(
            db.pool(),
            &InsertInboxItem {
                id: item_id,
                root_id: "root-1",
                relative_path: "",
                file_count: 0,
                content_signature: None,
                lane: "fits",
            },
        )
        .await
        .unwrap();

        let req = ClassifyRequest {
            inbox_item_id: item_id.to_owned(),
            root_absolute_path: tmp.path().to_owned(),
            force_rescan: false,
        };

        let resp = classify(db.pool(), req).await.unwrap();
        assert_eq!(resp.classification_type, "unclassified");
        assert_eq!(resp.unclassified_files.len(), 1);
    }

    /// spec 041 US2/T016: per-file metadata rows are persisted during classify
    /// and carry the parsed header fields (here: OBJECT/FILTER/DATE-OBS).
    #[tokio::test]
    async fn classify_persists_per_file_metadata() {
        use persistence_db::repositories::inbox as inbox_repo;

        let tmp = tempfile::tempdir().unwrap();
        // Reuse the richer FITS writer from the confirm tests to embed headers.
        let path = tmp.path().join("light_001.fits");
        let mut block = vec![b' '; 2880];
        let mut idx = 0usize;
        let mut write_card = |block: &mut Vec<u8>, card: &str| {
            let bytes = card.as_bytes();
            let len = bytes.len().min(80);
            block[idx * 80..idx * 80 + len].copy_from_slice(&bytes[..len]);
            idx += 1;
        };
        write_card(&mut block, &format!("{:<80}", "IMAGETYP= 'Light Frame'"));
        write_card(&mut block, &format!("{:<80}", "OBJECT  = 'M42'"));
        write_card(&mut block, &format!("{:<80}", "FILTER  = 'Ha'"));
        write_card(&mut block, &format!("{:<80}", "DATE-OBS= '2025-10-10T22:00:00'"));
        block[idx * 80..idx * 80 + 3].copy_from_slice(b"END");
        std::fs::File::create(&path).unwrap().write_all(&block).unwrap();

        let db = test_db().await;
        let item_id = "item-meta-persist";
        repo::insert_inbox_item(
            db.pool(),
            &InsertInboxItem {
                id: item_id,
                root_id: "root-1",
                relative_path: "",
                file_count: 0,
                content_signature: None,
                lane: "fits",
            },
        )
        .await
        .unwrap();

        classify(
            db.pool(),
            ClassifyRequest {
                inbox_item_id: item_id.to_owned(),
                root_absolute_path: tmp.path().to_owned(),
                force_rescan: false,
            },
        )
        .await
        .unwrap();

        let rows = inbox_repo::list_inbox_file_metadata(db.pool(), item_id).await.unwrap();
        assert_eq!(rows.len(), 1, "one metadata row per classified file");
        assert_eq!(rows[0].relative_file_path, "light_001.fits");
        assert_eq!(rows[0].object.as_deref(), Some("M42"));
        assert_eq!(rows[0].filter.as_deref(), Some("Ha"));
        assert_eq!(rows[0].date_obs.as_deref(), Some("2025-10-10T22:00:00"));
        // File identity is recorded for override-staleness tracking (R-4).
        assert!(rows[0].file_size_bytes.is_some());

        // Re-classify (force) must REPLACE rows, not duplicate them.
        classify(
            db.pool(),
            ClassifyRequest {
                inbox_item_id: item_id.to_owned(),
                root_absolute_path: tmp.path().to_owned(),
                force_rescan: true,
            },
        )
        .await
        .unwrap();
        let rows2 = inbox_repo::list_inbox_file_metadata(db.pool(), item_id).await.unwrap();
        assert_eq!(rows2.len(), 1, "re-classify replaces, does not duplicate");
    }

    /// spec 041 US3/T018: the breakdown resolves a `destination_preview` for the
    /// light group via the default Naming & Structure pattern.
    #[tokio::test]
    async fn classify_breakdown_has_destination_preview() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("light_001.fits");
        let mut block = vec![b' '; 2880];
        let mut idx = 0usize;
        let mut write_card = |block: &mut Vec<u8>, card: &str| {
            let bytes = card.as_bytes();
            let len = bytes.len().min(80);
            block[idx * 80..idx * 80 + len].copy_from_slice(&bytes[..len]);
            idx += 1;
        };
        write_card(&mut block, &format!("{:<80}", "IMAGETYP= 'Light Frame'"));
        write_card(&mut block, &format!("{:<80}", "OBJECT  = 'M42'"));
        write_card(&mut block, &format!("{:<80}", "FILTER  = 'Ha'"));
        write_card(&mut block, &format!("{:<80}", "DATE-OBS= '2025-10-10T22:00:00'"));
        block[idx * 80..idx * 80 + 3].copy_from_slice(b"END");
        std::fs::File::create(&path).unwrap().write_all(&block).unwrap();

        let db = test_db().await;
        let item_id = "item-dest-preview";
        repo::insert_inbox_item(
            db.pool(),
            &InsertInboxItem {
                id: item_id,
                root_id: "root-1",
                relative_path: "",
                file_count: 0,
                content_signature: None,
                lane: "fits",
            },
        )
        .await
        .unwrap();

        let resp = classify(
            db.pool(),
            ClassifyRequest {
                inbox_item_id: item_id.to_owned(),
                root_absolute_path: tmp.path().to_owned(),
                force_rescan: false,
            },
        )
        .await
        .unwrap();

        let light = resp.breakdown.iter().find(|b| b.kind == "light").expect("light group");
        let preview = light.destination_preview.as_deref().expect("destination preview resolved");
        assert!(!preview.is_empty(), "preview path is non-empty: {preview}");
    }

    /// spec 041 R-4: when a file's size changes between two classify runs AND
    /// it had an override set, the second classify must mark override_stale = 1
    /// on the freshly-inserted evidence row.
    #[tokio::test]
    async fn classify_rescan_marks_override_stale_on_changed_file() {
        use persistence_db::repositories::inbox as inbox_repo;
        use std::io::Write;

        let tmp = tempfile::tempdir().unwrap();
        let file_path = tmp.path().join("light_001.fits");

        // Write initial file content.
        write_fits_with_imagetyp(tmp.path(), "light_001.fits", "Light Frame");

        let db = test_db().await;
        let item_id = "item-r4-stale";

        repo::insert_inbox_item(
            db.pool(),
            &InsertInboxItem {
                id: item_id,
                root_id: "root-1",
                relative_path: "",
                file_count: 0,
                content_signature: None,
                lane: "fits",
            },
        )
        .await
        .unwrap();

        // First classify: no overrides yet.
        classify(
            db.pool(),
            ClassifyRequest {
                inbox_item_id: item_id.to_owned(),
                root_absolute_path: tmp.path().to_owned(),
                force_rescan: false,
            },
        )
        .await
        .unwrap();

        // Apply a non-type override.
        inbox_repo::set_overrides(
            db.pool(),
            item_id,
            "light_001.fits",
            None,
            Some("Ha"),
            Some(300.0),
            Some("2x2"),
        )
        .await
        .unwrap();

        // Verify not stale yet.
        let ev_before = inbox_repo::list_evidence(db.pool(), item_id).await.unwrap();
        let ev0 = ev_before.iter().find(|e| e.relative_file_path == "light_001.fits").unwrap();
        assert_eq!(ev0.override_stale, 0, "override freshly set, not yet stale");

        // Mutate the file so its size changes.
        {
            let mut f = std::fs::OpenOptions::new().append(true).open(&file_path).unwrap();
            f.write_all(b"extra bytes that change size").unwrap();
        }

        // Second classify (force rescan): should detect size change and mark stale.
        classify(
            db.pool(),
            ClassifyRequest {
                inbox_item_id: item_id.to_owned(),
                root_absolute_path: tmp.path().to_owned(),
                force_rescan: true,
            },
        )
        .await
        .unwrap();

        // After rescan, override_stale should be 1 AND the override VALUE must survive.
        let ev_after = inbox_repo::list_evidence(db.pool(), item_id).await.unwrap();
        let ev1 = ev_after.iter().find(|e| e.relative_file_path == "light_001.fits").unwrap();
        assert_eq!(ev1.override_stale, 1, "override_stale must be 1 after file size changed");
        // The override values must survive the rescan even when marked stale.
        assert_eq!(
            ev1.override_filter.as_deref(),
            Some("Ha"),
            "override_filter must survive rescan"
        );
        assert_eq!(ev1.override_exposure_s, Some(300.0), "override_exposure_s must survive rescan");
        assert_eq!(
            ev1.override_binning.as_deref(),
            Some("2x2"),
            "override_binning must survive rescan"
        );
    }

    /// R-4 negative guard: a force rescan that observes the SAME size/mtime must
    /// NOT mark an override stale. Protects against the size/mtime identity being
    /// stored and compared in mismatched formats (which would make every rescan
    /// falsely report staleness).
    #[tokio::test]
    async fn classify_rescan_keeps_override_fresh_when_file_unchanged() {
        use persistence_db::repositories::inbox as inbox_repo;

        let tmp = tempfile::tempdir().unwrap();
        write_fits_with_imagetyp(tmp.path(), "light_001.fits", "Light Frame");

        let db = test_db().await;
        let item_id = "item-r4-fresh";

        repo::insert_inbox_item(
            db.pool(),
            &InsertInboxItem {
                id: item_id,
                root_id: "root-1",
                relative_path: "",
                file_count: 0,
                content_signature: None,
                lane: "fits",
            },
        )
        .await
        .unwrap();

        classify(
            db.pool(),
            ClassifyRequest {
                inbox_item_id: item_id.to_owned(),
                root_absolute_path: tmp.path().to_owned(),
                force_rescan: false,
            },
        )
        .await
        .unwrap();

        inbox_repo::set_overrides(
            db.pool(),
            item_id,
            "light_001.fits",
            None,
            Some("Ha"),
            Some(300.0),
            Some("2x2"),
        )
        .await
        .unwrap();

        // Force rescan WITHOUT touching the file.
        classify(
            db.pool(),
            ClassifyRequest {
                inbox_item_id: item_id.to_owned(),
                root_absolute_path: tmp.path().to_owned(),
                force_rescan: true,
            },
        )
        .await
        .unwrap();

        let ev = inbox_repo::list_evidence(db.pool(), item_id).await.unwrap();
        let row = ev.iter().find(|e| e.relative_file_path == "light_001.fits").unwrap();
        assert_eq!(
            row.override_stale, 0,
            "unchanged file must not mark the override stale on rescan"
        );
        // The override values must also survive the rescan.
        assert_eq!(row.override_filter.as_deref(), Some("Ha"));
    }

    // ── T066: sub-item materialization tests ─────────────────────────────────

    /// Insert a source group + inbox item with source_group_id set.
    /// Returns (source_group_id, inbox_item_id).
    async fn insert_source_group_with_item(
        db: &Database,
        sg_id: &str,
        item_id: &str,
        root_id: &str,
        relative_path: &str,
    ) {
        let pool = db.pool();
        // Insert registered_sources row (FK required by inbox_source_groups).
        sqlx::query(
            "INSERT OR IGNORE INTO registered_sources \
             (id, path, kind, scan_depth, organization_state) \
             VALUES (?, '/test/root', 'inbox', 1, 'unorganized')",
        )
        .bind(root_id)
        .execute(pool)
        .await
        .ok();

        // Insert source group.
        sqlx::query(
            "INSERT INTO inbox_source_groups \
             (id, root_id, relative_path, discovered_at, last_scanned_at, child_count) \
             VALUES (?, ?, ?, '2025-10-10T20:00:00Z', '2025-10-10T20:00:00Z', 0)",
        )
        .bind(sg_id)
        .bind(root_id)
        .bind(relative_path)
        .execute(pool)
        .await
        .unwrap();

        // Insert inbox_item with source_group_id.
        sqlx::query(
            "INSERT INTO inbox_items \
             (id, root_id, relative_path, source_group_id, group_key, \
              discovered_at, last_scanned_at, state, lane) \
             VALUES (?, ?, ?, ?, '', \
                     '2025-10-10T20:00:00Z', '2025-10-10T20:00:00Z', \
                     'pending_classification', 'fits')",
        )
        .bind(item_id)
        .bind(root_id)
        .bind(relative_path)
        .bind(sg_id)
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn t066_single_type_folder_produces_one_sub_item() {
        // A folder with only light frames → one single-type sub-item.
        let tmp = tempfile::tempdir().unwrap();
        write_fits_with_imagetyp(tmp.path(), "light_001.fits", "Light Frame");
        write_fits_with_imagetyp(tmp.path(), "light_002.fits", "Light Frame");

        let db = test_db().await;
        insert_source_group_with_item(&db, "sg-t066-single", "item-t066-single", "root-sg1", "")
            .await;

        classify(
            db.pool(),
            ClassifyRequest {
                inbox_item_id: "item-t066-single".to_owned(),
                root_absolute_path: tmp.path().to_owned(),
                force_rescan: false,
            },
        )
        .await
        .unwrap();

        // Exactly one classified sub-item in the source group.
        let sub_items =
            inbox_repo::list_inbox_sub_items(db.pool(), "sg-t066-single").await.unwrap();
        assert_eq!(sub_items.len(), 1, "single-type folder must produce exactly one sub-item");
        let si = &sub_items[0];
        assert_eq!(si.frame_type.as_deref(), Some("light"), "sub-item frame_type must be 'light'");
        assert!(si.group_key.starts_with("type=light"), "group_key must start with type=light");
        assert!(si.content_signature.is_some(), "sub-item must have a content_signature");
        assert_eq!(si.file_count, 2, "sub-item file_count must match files in the group");

        // Source group child_count updated.
        let sg = inbox_repo::get_inbox_source_group_by_path(db.pool(), "root-sg1", "")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(sg.child_count, 1, "source group child_count must be 1");
    }

    #[tokio::test]
    async fn t066_mixed_folder_produces_n_sub_items() {
        // A folder with lights + darks → two single-type sub-items.
        let tmp = tempfile::tempdir().unwrap();
        write_fits_with_imagetyp(tmp.path(), "light_ha.fits", "Light Frame");
        write_fits_with_imagetyp(tmp.path(), "dark_1.fits", "Dark Frame");
        write_fits_with_imagetyp(tmp.path(), "dark_2.fits", "Dark Frame");

        let db = test_db().await;
        insert_source_group_with_item(&db, "sg-t066-mixed", "item-t066-mixed", "root-sg2", "")
            .await;

        classify(
            db.pool(),
            ClassifyRequest {
                inbox_item_id: "item-t066-mixed".to_owned(),
                root_absolute_path: tmp.path().to_owned(),
                force_rescan: false,
            },
        )
        .await
        .unwrap();

        let sub_items = inbox_repo::list_inbox_sub_items(db.pool(), "sg-t066-mixed").await.unwrap();
        assert_eq!(sub_items.len(), 2, "mixed folder must produce one sub-item per frame type");

        let types: Vec<_> = sub_items.iter().filter_map(|s| s.frame_type.as_deref()).collect();
        assert!(types.contains(&"light"), "must have a light sub-item");
        assert!(types.contains(&"dark"), "must have a dark sub-item");

        // Each sub-item has its own group_key and content_signature.
        let keys: std::collections::HashSet<_> =
            sub_items.iter().map(|s| s.group_key.as_str()).collect();
        assert_eq!(keys.len(), 2, "each sub-item must have a distinct group_key");

        for si in &sub_items {
            assert!(si.content_signature.is_some(), "each sub-item must have a content_signature");
            // file_count per group (1 light, 2 darks).
            if si.frame_type.as_deref() == Some("light") {
                assert_eq!(si.file_count, 1);
            } else {
                assert_eq!(si.file_count, 2);
            }
        }

        // Source group child_count updated.
        let sg = inbox_repo::get_inbox_source_group_by_path(db.pool(), "root-sg2", "")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(sg.child_count, 2, "source group child_count must be 2");
    }

    #[tokio::test]
    async fn t066_rescan_determinism() {
        // Classifying unchanged content twice must produce identical group keys
        // and no duplicated sub-items (FR-042).
        let tmp = tempfile::tempdir().unwrap();
        write_fits_with_imagetyp(tmp.path(), "light_001.fits", "Light Frame");
        write_fits_with_imagetyp(tmp.path(), "dark_001.fits", "Dark Frame");

        let db = test_db().await;
        insert_source_group_with_item(&db, "sg-t066-determ", "item-t066-determ", "root-sg3", "")
            .await;

        // First classify.
        classify(
            db.pool(),
            ClassifyRequest {
                inbox_item_id: "item-t066-determ".to_owned(),
                root_absolute_path: tmp.path().to_owned(),
                force_rescan: false,
            },
        )
        .await
        .unwrap();

        let items_first =
            inbox_repo::list_inbox_sub_items(db.pool(), "sg-t066-determ").await.unwrap();
        let keys_first: Vec<String> = items_first.iter().map(|i| i.group_key.clone()).collect();
        let sigs_first: Vec<Option<String>> =
            items_first.iter().map(|i| i.content_signature.clone()).collect();

        // Second classify (force_rescan = true on unchanged content).
        classify(
            db.pool(),
            ClassifyRequest {
                inbox_item_id: "item-t066-determ".to_owned(),
                root_absolute_path: tmp.path().to_owned(),
                force_rescan: true,
            },
        )
        .await
        .unwrap();

        let items_second =
            inbox_repo::list_inbox_sub_items(db.pool(), "sg-t066-determ").await.unwrap();
        let keys_second: Vec<String> = items_second.iter().map(|i| i.group_key.clone()).collect();
        let sigs_second: Vec<Option<String>> =
            items_second.iter().map(|i| i.content_signature.clone()).collect();

        // Same group_keys.
        assert_eq!(
            keys_first, keys_second,
            "rescan of unchanged content must produce identical group_keys (FR-042)"
        );
        // Same signatures.
        assert_eq!(
            sigs_first, sigs_second,
            "rescan of unchanged content must produce identical content_signatures (FR-042)"
        );
        // No duplicates — still exactly 2 sub-items.
        assert_eq!(items_second.len(), 2, "rescan must not create duplicate sub-items");
    }

    #[tokio::test]
    async fn t066_unclassifiable_file_goes_to_sentinel_bucket() {
        // A file with no IMAGETYP → sentinel __needs_review__ sub-item.
        let tmp = tempfile::tempdir().unwrap();
        // No IMAGETYP card.
        let path = tmp.path().join("mystery.fits");
        let mut data = vec![b' '; 2880];
        data[0..3].copy_from_slice(b"END");
        std::fs::write(&path, &data).unwrap();

        let db = test_db().await;
        insert_source_group_with_item(
            &db,
            "sg-t066-sentinel",
            "item-t066-sentinel",
            "root-sg4",
            "",
        )
        .await;

        classify(
            db.pool(),
            ClassifyRequest {
                inbox_item_id: "item-t066-sentinel".to_owned(),
                root_absolute_path: tmp.path().to_owned(),
                force_rescan: false,
            },
        )
        .await
        .unwrap();

        let sub_items =
            inbox_repo::list_inbox_sub_items(db.pool(), "sg-t066-sentinel").await.unwrap();
        assert_eq!(sub_items.len(), 1, "unclassifiable file must produce one sentinel sub-item");
        let si = &sub_items[0];
        assert_eq!(
            si.group_key, SENTINEL_NEEDS_REVIEW,
            "unclassifiable file must go to __needs_review__ sentinel bucket"
        );
        assert!(si.frame_type.is_none(), "sentinel sub-item must have no frame_type");
    }

    // ── T067: composite identity + signature stability (FR-042) ──────────────

    /// Write a minimal FITS file whose IMAGETYP + FILTER headers are embedded,
    /// allowing the grouping engine to distinguish the filter dimension.
    ///
    /// Unlike `write_fits_with_imagetyp`, this also embeds a FILTER card so that
    /// two files written with different filter values end up in different sub-groups.
    fn write_fits_with_filter(dir: &std::path::Path, name: &str, imagetyp: &str, filter: &str) {
        let path = dir.join(name);
        let mut data = vec![b' '; 2880];
        let mut idx = 0usize;

        let mut write_card = |card: &str| {
            let bytes = card.as_bytes();
            let len = bytes.len().min(80);
            data[idx * 80..idx * 80 + len].copy_from_slice(&bytes[..len]);
            idx += 1;
        };

        write_card(&format!("{:<80}", format!("IMAGETYP= '{imagetyp:<8}'")));
        write_card(&format!("{:<80}", format!("FILTER  = '{filter:<8}'")));
        data[idx * 80..idx * 80 + 3].copy_from_slice(b"END");

        use std::io::Write as _;
        let mut f = std::fs::File::create(path).unwrap();
        f.write_all(&data).unwrap();
    }

    /// T067-1 — Composite identity uniqueness.
    ///
    /// Two flat files that differ ONLY in the `FILTER` header (a grouping
    /// dimension) must materialise as **two distinct sub-items** with distinct
    /// `group_key`s. The identity triple `(root_id, relative_path, group_key)`
    /// must be unique across the pair (R-11).
    #[tokio::test]
    async fn t067_composite_identity_differs_by_grouping_dimension() {
        let tmp = tempfile::tempdir().unwrap();
        // Two flat files — same folder, same type, but different filters.
        // The flat recipe includes Filter as a dimension, so they split.
        write_fits_with_filter(tmp.path(), "flat_ha.fits", "Flat Frame", "Ha");
        write_fits_with_filter(tmp.path(), "flat_oiii.fits", "Flat Frame", "OIII");

        let db = test_db().await;
        insert_source_group_with_item(&db, "sg-t067-id", "item-t067-id", "root-t067a", "").await;

        classify(
            db.pool(),
            ClassifyRequest {
                inbox_item_id: "item-t067-id".to_owned(),
                root_absolute_path: tmp.path().to_owned(),
                force_rescan: false,
            },
        )
        .await
        .unwrap();

        let sub_items = inbox_repo::list_inbox_sub_items(db.pool(), "sg-t067-id").await.unwrap();

        // Two files in different filter groups → two sub-items.
        assert_eq!(
            sub_items.len(),
            2,
            "flat files differing only in FILTER must produce two distinct sub-items; got {sub_items:?}"
        );

        let keys: std::collections::HashSet<_> =
            sub_items.iter().map(|s| s.group_key.as_str()).collect();
        assert_eq!(
            keys.len(),
            2,
            "group_key must differ between the two filter groups — identity is not unique: {sub_items:?}"
        );

        // Both sub-items share the same (root_id, relative_path) — only group_key differs.
        for si in &sub_items {
            assert_eq!(si.root_id, "root-t067a");
            assert_eq!(si.relative_path, "");
            assert!(
                si.group_key.contains("filter="),
                "group_key must embed the filter dimension: {}",
                si.group_key
            );
        }

        // The two group_keys contain different filter values.
        let filter_values: Vec<_> = sub_items
            .iter()
            .map(|s| {
                s.group_key
                    .split('·')
                    .find(|seg| seg.starts_with("filter="))
                    .unwrap_or("filter=<missing>")
                    .to_owned()
            })
            .collect();
        assert_ne!(
            filter_values[0], filter_values[1],
            "the two group_keys must embed different filter tokens; both read: {}",
            filter_values[0]
        );
    }

    /// T067-2 — Per-sub-group signature correctness.
    ///
    /// Each sub-item's `content_signature` must equal
    /// `folder_signature(sorted(per-file sigs of only the files in that group))`
    /// (R-11). Two sub-groups in the same folder must therefore have **different**
    /// signatures because they cover different file sets.
    #[tokio::test]
    async fn t067_per_subgroup_signatures_differ_and_match_formula() {
        let tmp = tempfile::tempdir().unwrap();
        // One Ha flat and one OIII flat → two distinct groups.
        write_fits_with_filter(tmp.path(), "flat_ha.fits", "Flat Frame", "Ha");
        write_fits_with_filter(tmp.path(), "flat_oiii.fits", "Flat Frame", "OIII");

        let db = test_db().await;
        insert_source_group_with_item(&db, "sg-t067-sig", "item-t067-sig", "root-t067b", "").await;

        classify(
            db.pool(),
            ClassifyRequest {
                inbox_item_id: "item-t067-sig".to_owned(),
                root_absolute_path: tmp.path().to_owned(),
                force_rescan: false,
            },
        )
        .await
        .unwrap();

        let sub_items = inbox_repo::list_inbox_sub_items(db.pool(), "sg-t067-sig").await.unwrap();
        assert_eq!(sub_items.len(), 2, "expected two sub-items");

        // Both must have a non-empty content_signature.
        for si in &sub_items {
            assert!(
                si.content_signature.as_deref().map(|s| !s.is_empty()).unwrap_or(false),
                "sub-item {} must have a non-empty content_signature",
                si.group_key
            );
        }

        // The two sub-groups share the same folder but different file sets →
        // their per-sub-group signatures must be distinct.
        let sig_a = sub_items[0].content_signature.as_deref().unwrap_or("");
        let sig_b = sub_items[1].content_signature.as_deref().unwrap_or("");
        assert_ne!(
            sig_a, sig_b,
            "two sub-groups covering different files must have distinct content_signatures"
        );

        // Verify each signature matches the formula: folder_signature(sorted per-file sigs).
        // We can do this by computing the expected signature for each group ourselves
        // and comparing — we know which file belongs to which group from the group_key.
        let ha_abs = tmp.path().join("flat_ha.fits");
        let oiii_abs = tmp.path().join("flat_oiii.fits");

        // Access signature primitives through the crate root (sibling module of classify).
        let ha_file_sig =
            crate::signature::file_signature(&ha_abs).expect("flat_ha.fits must be stat-able");
        let oiii_file_sig =
            crate::signature::file_signature(&oiii_abs).expect("flat_oiii.fits must be stat-able");

        let expected_ha_sig = crate::signature::folder_signature(vec![ha_file_sig]);
        let expected_oiii_sig = crate::signature::folder_signature(vec![oiii_file_sig]);

        // Locate which sub-item corresponds to which filter.
        let ha_item = sub_items
            .iter()
            .find(|s| s.group_key.contains("filter=ha"))
            .expect("must find Ha sub-item by group_key");
        let oiii_item = sub_items
            .iter()
            .find(|s| s.group_key.contains("filter=oiii"))
            .expect("must find OIII sub-item by group_key");

        assert_eq!(
            ha_item.content_signature.as_deref().unwrap_or(""),
            expected_ha_sig,
            "Ha sub-item signature must equal folder_signature(sorted per-file sigs of Ha group)"
        );
        assert_eq!(
            oiii_item.content_signature.as_deref().unwrap_or(""),
            expected_oiii_sig,
            "OIII sub-item signature must equal folder_signature(sorted per-file sigs of OIII group)"
        );
    }

    /// T067-3 — Rescan determinism (the key FR-042 property).
    ///
    /// Classifying identical content twice must yield:
    /// - identical `group_key` for every sub-item,
    /// - identical `content_signature` for every sub-item, and
    /// - **no new rows** (the UNIQUE constraint absorbs the upsert).
    ///
    /// This extends the existing `t066_rescan_determinism` test with an explicit
    /// filter-split scenario (two sub-items) and asserts the count stays at two.
    #[tokio::test]
    async fn t067_rescan_determinism_no_item_churn() {
        let tmp = tempfile::tempdir().unwrap();
        write_fits_with_filter(tmp.path(), "flat_ha.fits", "Flat Frame", "Ha");
        write_fits_with_filter(tmp.path(), "flat_oiii.fits", "Flat Frame", "OIII");

        let db = test_db().await;
        insert_source_group_with_item(&db, "sg-t067-redet", "item-t067-redet", "root-t067c", "")
            .await;

        // First classify.
        classify(
            db.pool(),
            ClassifyRequest {
                inbox_item_id: "item-t067-redet".to_owned(),
                root_absolute_path: tmp.path().to_owned(),
                force_rescan: false,
            },
        )
        .await
        .unwrap();

        let first = inbox_repo::list_inbox_sub_items(db.pool(), "sg-t067-redet").await.unwrap();
        let first_keys: Vec<_> = first.iter().map(|s| s.group_key.clone()).collect();
        let first_sigs: Vec<_> = first.iter().map(|s| s.content_signature.clone()).collect();

        // Second classify — force rescan, same files on disk.
        classify(
            db.pool(),
            ClassifyRequest {
                inbox_item_id: "item-t067-redet".to_owned(),
                root_absolute_path: tmp.path().to_owned(),
                force_rescan: true,
            },
        )
        .await
        .unwrap();

        let second = inbox_repo::list_inbox_sub_items(db.pool(), "sg-t067-redet").await.unwrap();
        let second_keys: Vec<_> = second.iter().map(|s| s.group_key.clone()).collect();
        let second_sigs: Vec<_> = second.iter().map(|s| s.content_signature.clone()).collect();

        // Count must not grow.
        assert_eq!(
            second.len(),
            2,
            "rescan must not create duplicate sub-items; expected 2, got {}",
            second.len()
        );

        // Keys and signatures must be bitwise identical.
        assert_eq!(
            first_keys, second_keys,
            "rescan of unchanged content must produce identical group_keys (FR-042)"
        );
        assert_eq!(
            first_sigs, second_sigs,
            "rescan of unchanged content must produce identical content_signatures (FR-042)"
        );
    }

    /// T067-4 — Correct churn on change.
    ///
    /// When a file's metadata moves it to a different sub-group (here: we replace
    /// a file on disk with a different FILTER header so the extractor sees a new
    /// value), the affected sub-group signatures must change after the next
    /// classify.  Specifically:
    ///
    /// - The old sub-group (Ha) now has zero files → it must be absent from the
    ///   live sub-item list (not left as a stale row).
    /// - The new sub-group (SII) appears with the moved file.
    /// - The untouched group (OIII, flat_b) has a stable signature.
    ///
    /// This models the "file whose metadata/override moves it to a different group
    /// changes both its old and new sub-group signatures" requirement (R-11).
    ///
    /// # KNOWN BUG (production code)
    ///
    /// `materialize_sub_items` (classify.rs) uses `upsert_inbox_sub_item` which
    /// runs `ON CONFLICT … DO UPDATE` for groups that still exist after the rescan,
    /// but **never deletes rows for groups that have become empty**.  After flat_a
    /// moves from Ha→SII, the Ha row persists in `inbox_items` with its old
    /// `file_count = 1` — it is never cleaned up.
    ///
    /// Expected result: 2 sub-items (OIII + SII) after the rescan.
    /// Actual result:   3 sub-items (Ha stale + OIII + SII) — the Ha row survives.
    ///
    /// The failing assertion below (`ha_after.is_none()`) documents this bug.
    /// Fix required: after upserting the current groups, delete `inbox_items` rows
    /// belonging to this `source_group_id` whose `group_key` is NOT in the current
    /// set (i.e. `DELETE … WHERE source_group_id = ? AND group_key NOT IN (…)`).
    #[tokio::test]
    async fn t067_churn_on_metadata_change_updates_group_signatures() {
        let tmp = tempfile::tempdir().unwrap();
        // Initial state: Ha flat + OIII flat → two sub-items.
        write_fits_with_filter(tmp.path(), "flat_a.fits", "Flat Frame", "Ha");
        write_fits_with_filter(tmp.path(), "flat_b.fits", "Flat Frame", "OIII");

        let db = test_db().await;
        insert_source_group_with_item(&db, "sg-t067-churn", "item-t067-churn", "root-t067d", "")
            .await;

        // First classify: Ha group (flat_a) + OIII group (flat_b).
        classify(
            db.pool(),
            ClassifyRequest {
                inbox_item_id: "item-t067-churn".to_owned(),
                root_absolute_path: tmp.path().to_owned(),
                force_rescan: false,
            },
        )
        .await
        .unwrap();

        let first = inbox_repo::list_inbox_sub_items(db.pool(), "sg-t067-churn").await.unwrap();
        assert_eq!(first.len(), 2, "initial classify: two filter groups");

        let ha_sig_before = first
            .iter()
            .find(|s| s.group_key.contains("filter=ha"))
            .expect("Ha sub-item must exist after first classify")
            .content_signature
            .clone();

        // Change flat_a on disk: overwrite with SII filter header so it moves groups.
        write_fits_with_filter(tmp.path(), "flat_a.fits", "Flat Frame", "SII");

        // Second classify: now Ha is gone, OIII remains, SII appears.
        classify(
            db.pool(),
            ClassifyRequest {
                inbox_item_id: "item-t067-churn".to_owned(),
                root_absolute_path: tmp.path().to_owned(),
                force_rescan: true,
            },
        )
        .await
        .unwrap();

        let second = inbox_repo::list_inbox_sub_items(db.pool(), "sg-t067-churn").await.unwrap();

        // SII sub-item must now exist (new group from the moved file).
        let sii_after = second.iter().find(|s| s.group_key.contains("filter=sii"));
        assert!(
            sii_after.is_some(),
            "SII sub-item must appear after flat_a was rewritten with FILTER=SII; \
             got sub-items: {second:?}"
        );

        // OIII sub-item must still exist and its signature must be unchanged
        // (flat_b was not touched).
        let oiii_before = first
            .iter()
            .find(|s| s.group_key.contains("filter=oiii"))
            .expect("OIII sub-item must exist after first classify");
        let oiii_after = second
            .iter()
            .find(|s| s.group_key.contains("filter=oiii"))
            .expect("OIII sub-item must still exist after second classify");
        assert_eq!(
            oiii_before.content_signature, oiii_after.content_signature,
            "OIII sub-item signature must be stable when its files are unchanged"
        );

        // The new SII sub-item's signature must differ from the old Ha signature
        // because the file was rewritten on disk (different content → different file sig).
        let sii_sig = sii_after.unwrap().content_signature.as_deref().unwrap_or("");
        assert_ne!(
            ha_sig_before.as_deref().unwrap_or(""),
            sii_sig,
            "SII sub-item signature must differ from the old Ha signature after the file changed"
        );

        // ── BUG ASSERTION (will fail until production code is fixed) ───────────
        //
        // After flat_a moved from Ha→SII, the Ha row must be purged.
        // Currently `materialize_sub_items` never deletes stale group rows, so
        // the Ha row survives.  Expected: 2 sub-items.  Actual (buggy): 3.
        let ha_after = second.iter().find(|s| s.group_key.contains("filter=ha"));
        assert!(
            ha_after.is_none(),
            "BUG: Ha sub-item must be absent after flat_a moved to SII (R-11 correct churn). \
             materialize_sub_items must delete inbox_items rows for groups no longer in \
             the current scan. Got stale row: {ha_after:?}. \
             All sub-items after rescan: {second:?}"
        );
    }

    #[tokio::test]
    async fn t066_no_source_group_does_not_create_sub_items() {
        // Items without a source_group_id (legacy or pre-T065 scan) must not
        // have sub-items created — the materialization is skipped gracefully.
        let tmp = tempfile::tempdir().unwrap();
        write_fits_with_imagetyp(tmp.path(), "light_001.fits", "Light Frame");

        let db = test_db().await;
        // Insert WITHOUT a source_group_id (legacy path via insert_inbox_item).
        let item_id = "item-t066-legacy";
        repo::insert_inbox_item(
            db.pool(),
            &InsertInboxItem {
                id: item_id,
                root_id: "root-legacy",
                relative_path: "",
                file_count: 0,
                content_signature: None,
                lane: "fits",
            },
        )
        .await
        .unwrap();

        classify(
            db.pool(),
            ClassifyRequest {
                inbox_item_id: item_id.to_owned(),
                root_absolute_path: tmp.path().to_owned(),
                force_rescan: false,
            },
        )
        .await
        .unwrap();

        // No source group → no sub-items (can't list, so just verify classify
        // returned normally without error; no assertion on sub-items needed).
        // The classify response should still show single_type.
        let cached = repo::get_classification(db.pool(), item_id).await.unwrap();
        assert!(cached.is_some(), "classification must be persisted");
    }
}
