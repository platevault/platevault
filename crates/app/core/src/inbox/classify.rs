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
use metadata_core::{v1_normalization_table, EvidenceSource, FrameType, MetadataExtractor};
use metadata_fits::FitsExtractor;
use metadata_xisf::XisfExtractor;
use persistence_db::repositories::inbox::{self as repo, InsertEvidence, UpsertClassification};
use sqlx::SqlitePool;
use time::format_description::well_known::Rfc3339;
use uuid::Uuid;

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
    /// "single_type" | "mixed" | "unclassified"
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
            "inbox.item.not_found",
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
            "metadata.unreadable",
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

    for abs_path in &file_paths {
        let rel = abs_path.strip_prefix(&req.root_absolute_path).map_or_else(
            |_| abs_path.display().to_string(),
            |p| p.to_string_lossy().replace('\\', "/"),
        );

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
            unclassified_files.push(rel);
        } else if let Some(ft) = frame_type {
            frame_type_files.entry(ft.as_str().to_owned()).or_default().push(rel);
        }
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

    // 7. Determine folder-level classification result
    let distinct_types: Vec<&str> = frame_type_files.keys().map(String::as_str).collect();
    let (result, single_frame_type) = match distinct_types.len() {
        0 => ("unclassified", None),
        1 => ("single_type", Some(distinct_types[0].to_owned())),
        _ => ("mixed", None),
    };

    let unclassified_count = i64::try_from(unclassified_files.len()).unwrap_or(i64::MAX);

    // 8. Persist classification
    let classification = UpsertClassification {
        inbox_item_id: &req.inbox_item_id,
        result,
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
        classification_type: result.to_owned(),
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
}
