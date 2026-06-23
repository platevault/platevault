//! `inbox.item.metadata` use case (spec 041 US2/FR-010, T017).
//!
//! Assembles the per-file metadata DTO for an inbox item by combining three
//! persisted sources, all keyed by `(inbox_item_id, relative_file_path)`:
//!
//! - `inbox_file_metadata` — extracted header fields (filter, exposure, gain,
//!   binning, temperature, object, date_obs, instrume, telescop, naxis1/2,
//!   stack_count) plus per-file identity (size/mtime).
//! - `inbox_classification_evidence` — `frame_type_effective` (override ??
//!   extracted), the raw `IMAGETYP` (`image_typ`), and `is_master`.
//! - `inbox_items` — `is_master_item` for single-file master items (folder
//!   items default to per-file evidence).
//!
//! Pure orchestration: all DB access goes through
//! `persistence_db::repositories::inbox`.
#![allow(clippy::doc_markdown)]

use std::collections::HashMap;

use patterns::{resolve_pattern_str, MetadataBundle};
use persistence_db::repositories::inbox::{self as repo};
use persistence_db::repositories::settings as settings_repo;
use sqlx::SqlitePool;

use contracts_core::error_code::ErrorCode;
use contracts_core::inbox::InboxFileMetadata;
use contracts_core::{ContractError, ErrorSeverity};

/// Read the assembled per-file metadata for an inbox item (spec 041 US2).
///
/// Returns one [`InboxFileMetadata`] per file with a persisted metadata row,
/// ordered by relative path. Files that were enumerated during classify always
/// have a metadata row (identity is recorded even when no header fields parsed),
/// so this is effectively one entry per classified file.
///
/// # Errors
///
/// - `inbox.item.not_found` — the item does not exist.
/// - `internal.database` — a query failed.
pub async fn get_inbox_item_metadata(
    pool: &SqlitePool,
    inbox_item_id: &str,
) -> Result<Vec<InboxFileMetadata>, ContractError> {
    // 1. Verify the item exists (and learn whether the whole item is a master).
    let item = repo::get_inbox_item(pool, inbox_item_id).await.map_err(|_| {
        ContractError::new(
            ErrorCode::InboxItemNotFound,
            format!("InboxItem not found: {inbox_item_id}"),
            ErrorSeverity::Blocking,
            false,
        )
    })?;
    let item_is_master = item.is_master_item != 0;

    // 2. Load the per-file metadata rows + evidence rows, then join in memory by
    //    relative path. Metadata rows are the spine (one per enumerated file).
    let meta_rows =
        repo::list_inbox_file_metadata(pool, inbox_item_id).await.map_err(|e| db_err(&e))?;
    let evidence_rows = repo::list_evidence(pool, inbox_item_id).await.map_err(|e| db_err(&e))?;

    // Index evidence by relative path for O(1) lookup while iterating metadata.
    let evidence_by_path: HashMap<&str, &repo::InboxEvidenceRow> =
        evidence_rows.iter().map(|ev| (ev.relative_file_path.as_str(), ev)).collect();

    let mut files = Vec::with_capacity(meta_rows.len());
    for m in &meta_rows {
        let ev = evidence_by_path.get(m.relative_file_path.as_str());

        // frame_type_effective: override (if set) else extracted frame type.
        let frame_type_effective =
            ev.and_then(|e| e.manual_override.clone().or_else(|| e.frame_type.clone()));

        // image_typ: the raw IMAGETYP header value captured as evidence
        // raw_value (only header-sourced evidence carries it).
        let image_typ = ev.and_then(|e| e.raw_value.clone());

        // is_master: a single-file master item OR a per-file detected master.
        let is_master = item_is_master || ev.is_some_and(|e| e.is_master != 0);

        // Non-type overrides: override_filter/exposure/binning take
        // precedence over the extracted header values when set.
        let filter = ev.and_then(|e| e.override_filter.clone()).or_else(|| m.filter.clone());
        let exposure_s = ev.and_then(|e| e.override_exposure_s).or(m.exposure_s);
        // Parse "NxN" binning string (e.g. "2x2") → (binning_x, binning_y).
        let (binning_x, binning_y) =
            ev.and_then(|e| e.override_binning.as_deref()).and_then(parse_binning).map_or_else(
                || {
                    (
                        m.binning_x.and_then(|v| i32::try_from(v).ok()),
                        m.binning_y.and_then(|v| i32::try_from(v).ok()),
                    )
                },
                |(bx, by)| (Some(bx), Some(by)),
            );

        // R-4: read the persisted override_stale flag from the evidence row.
        let override_stale = ev.is_some_and(|e| e.override_stale != 0);

        let mut entry = InboxFileMetadata {
            relative_file_path: m.relative_file_path.clone(),
            frame_type_effective: frame_type_effective.clone(),
            image_typ,
            filter: filter.clone(),
            exposure_s,
            gain: m.gain.clone(),
            binning_x,
            binning_y,
            temperature_c: m.temperature_c,
            object: m.object.clone(),
            date_obs: m.date_obs.clone(),
            instrume: m.instrume.clone(),
            telescop: m.telescop.clone(),
            naxis1: m.naxis1.and_then(|v| i32::try_from(v).ok()),
            naxis2: m.naxis2.and_then(|v| i32::try_from(v).ok()),
            stack_count: m.stack_count.and_then(|v| i32::try_from(v).ok()),
            is_master,
            override_stale,
            missing_path_attributes: Vec::new(),
            missing_mandatory: Vec::new(),
        };

        // US9 (FR-032/FR-033): surface the path-load-bearing attributes this file
        // is missing for its frame type's destination pattern, so the UI can
        // prompt the user before confirm blocks. A pattern's token set defines
        // its required attributes; tokens that fall back to a default are the
        // misses. Mirrors the confirm gate but reads persisted metadata (with
        // overrides applied) instead of re-reading headers.
        entry.missing_path_attributes =
            missing_path_attributes(pool, &entry).await.unwrap_or_default();

        // T070 / FR-047: surface the mandatory-attribute gate per file so the UI
        // can prompt the user before the needs-review bucket blocks confirm.
        // Uses the same DTO values (override-applied) as missing_path_attributes.
        entry.missing_mandatory = compute_missing_mandatory(&entry);

        files.push(entry);
    }

    Ok(files)
}

fn db_err(e: &persistence_db::DbError) -> ContractError {
    ContractError::new(ErrorCode::InternalDatabase, e.to_string(), ErrorSeverity::Fatal, true)
}

/// Compute the mandatory-attribute gate for a file from the already-built DTO
/// (spec 041 T070 / FR-047 / R-14).
///
/// Uses the same override-applied values as `missing_path_attributes` so that
/// supplying a value via reclassify clears the gate on the next read.
/// Returns an empty vec when all mandatory attributes are present.
fn compute_missing_mandatory(m: &InboxFileMetadata) -> Vec<String> {
    let Some(ft_str) = m.frame_type_effective.as_deref() else {
        // Unclassified files are implicitly needs-review; frameType is the gate.
        return vec!["frameType".to_owned()];
    };

    // Derive mandatory set from the same R-14 table as classify::mandatory_set_for.
    let mandatory: &[&str] = match ft_str {
        "light" => &["frameType", "target", "filter", "exposureS"],
        "dark" | "dark_flat" => &["frameType", "exposureS", "gain"],
        "bias" => &["frameType", "gain"],
        "flat" => &["frameType", "filter"],
        _ => return Vec::new(), // unknown type: no gate
    };

    let mut missing = Vec::new();
    for &key in mandatory {
        let absent = match key {
            "target" => {
                // light: satisfied by OBJECT header (proxy for coord resolution).
                m.object.as_deref().map_or("", str::trim).is_empty()
            }
            "filter" => m.filter.as_deref().map_or("", str::trim).is_empty(),
            "exposureS" => !m.exposure_s.is_some_and(|v| v > 0.0),
            "gain" => m.gain.as_deref().map_or("", str::trim).is_empty(),
            // "frameType" already resolved (ft_str is Some); unknown keys never absent.
            _ => false,
        };
        if absent {
            missing.push(key.to_owned());
        }
    }
    missing
}

/// Compute the path-load-bearing attributes a file is missing for its frame
/// type's destination pattern (spec 041 US9/FR-032/FR-033).
///
/// Returns `["image type"]` when the frame type is unknown (no pattern class —
/// same surfacing as missing IMAGETYP), the pattern's `missing_tokens` when the
/// chosen pattern references attributes the file lacks, or an empty vec when the
/// destination resolves. Reads the persisted (override-applied) values on the
/// DTO, so supplying a value via reclassify clears the gate on the next read.
async fn missing_path_attributes(
    pool: &SqlitePool,
    m: &InboxFileMetadata,
) -> Result<Vec<String>, ContractError> {
    let Some(ft) = m.frame_type_effective.as_deref() else {
        return Ok(vec!["image type".to_owned()]);
    };
    let pattern = settings_repo::effective_pattern_for(pool, ft, m.is_master)
        .await
        .map_err(|e| db_err(&e))?;
    let Some(pattern) = pattern else {
        return Ok(vec!["image type".to_owned()]);
    };

    let mut bundle = MetadataBundle::new();
    bundle.insert("frame_type".to_owned(), ft.to_owned());
    if let Some(v) = m.object.as_deref().filter(|s| !s.trim().is_empty()) {
        bundle.insert("target".to_owned(), v.trim().to_owned());
    }
    if let Some(v) = m.filter.as_deref().filter(|s| !s.trim().is_empty()) {
        bundle.insert("filter".to_owned(), v.trim().to_owned());
    }
    if let Some(v) = m.date_obs.as_deref().filter(|s| !s.trim().is_empty()) {
        let date_part = v.split('T').next().unwrap_or(v);
        bundle.insert("date".to_owned(), date_part.to_owned());
    }
    if let Some(v) = m.instrume.as_deref().filter(|s| !s.trim().is_empty()) {
        bundle.insert("camera".to_owned(), v.trim().to_owned());
    }
    if let Some(exp) = m.exposure_s {
        // Only presence matters for the gate; the exact format is irrelevant
        // (this path computes missing_tokens, not the final destination).
        bundle.insert("exposure".to_owned(), exp.to_string());
    }
    if let Some(v) = m.gain.as_deref().filter(|s| !s.trim().is_empty()) {
        bundle.insert("gain".to_owned(), v.trim().to_owned());
    }
    if let (Some(bx), Some(by)) = (m.binning_x, m.binning_y) {
        bundle.insert("binning".to_owned(), format!("{bx}x{by}"));
    }

    match resolve_pattern_str(&pattern, &bundle) {
        Ok(r) => Ok(r.missing_tokens),
        // A structural failure is not a missing-attribute case; treat as
        // "no surfaced misses" here (confirm reports the hard error).
        Err(_) => Ok(Vec::new()),
    }
}

/// Parse an `"NxN"` binning string (e.g. `"2x2"`, `"1x1"`) into `(x, y)`.
/// Returns `None` for any other format so the caller can fall back to extracted
/// header values.
fn parse_binning(s: &str) -> Option<(i32, i32)> {
    let (lhs, rhs) = s.split_once('x')?;
    let bx = lhs.trim().parse::<i32>().ok()?;
    let by = rhs.trim().parse::<i32>().ok()?;
    Some((bx, by))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use persistence_db::repositories::inbox::{
        InsertEvidence, InsertInboxItem, UpsertFileMetadata,
    };
    use persistence_db::Database;

    async fn test_db() -> Database {
        let db = Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        db
    }

    #[tokio::test]
    async fn assembles_metadata_from_rows() {
        let db = test_db().await;
        let item_id = "item-meta-1";

        repo::insert_inbox_item(
            db.pool(),
            &InsertInboxItem {
                id: item_id,
                root_id: "root-1",
                relative_path: "lights",
                file_count: 1,
                content_signature: Some("sig"),
                lane: "fits",
            },
        )
        .await
        .unwrap();

        // Evidence carries frame type + raw IMAGETYP.
        repo::insert_evidence(
            db.pool(),
            &InsertEvidence {
                id: "ev-1",
                inbox_item_id: item_id,
                relative_file_path: "lights/light_001.fits",
                frame_type: Some("light"),
                evidence_source: "imagetyp_header",
                raw_value: Some("Light Frame"),
                unclassified: false,
                manual_override: None,
                is_master: false,
                master_detector: None,
            },
        )
        .await
        .unwrap();

        // Metadata row carries header fields.
        repo::upsert_inbox_file_metadata(
            db.pool(),
            &UpsertFileMetadata {
                inbox_item_id: item_id,
                relative_file_path: "lights/light_001.fits",
                filter: Some("Ha"),
                exposure_s: Some(120.0),
                gain: Some("100"),
                binning_x: Some(1),
                binning_y: Some(1),
                object: Some("M42"),
                date_obs: Some("2025-10-10"),
                instrume: Some("ASI2600"),
                telescop: Some("RC8"),
                naxis1: Some(6248),
                naxis2: Some(4176),
                file_size_bytes: Some(1234),
                file_mtime: Some("2025-10-10T22:00:00Z"),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        let files = get_inbox_item_metadata(db.pool(), item_id).await.unwrap();
        assert_eq!(files.len(), 1);
        let f = &files[0];
        assert_eq!(f.relative_file_path, "lights/light_001.fits");
        assert_eq!(f.frame_type_effective.as_deref(), Some("light"));
        assert_eq!(f.image_typ.as_deref(), Some("Light Frame"));
        assert_eq!(f.filter.as_deref(), Some("Ha"));
        assert_eq!(f.exposure_s, Some(120.0));
        assert_eq!(f.gain.as_deref(), Some("100"));
        assert_eq!(f.binning_x, Some(1));
        assert_eq!(f.naxis1, Some(6248));
        assert!(!f.is_master);
        assert!(!f.override_stale);
    }

    /// A manual override takes precedence over the extracted frame type when
    /// assembling `frame_type_effective`.
    #[tokio::test]
    async fn override_wins_for_effective_frame_type() {
        let db = test_db().await;
        let item_id = "item-meta-2";

        repo::insert_inbox_item(
            db.pool(),
            &InsertInboxItem {
                id: item_id,
                root_id: "root-1",
                relative_path: "mixed",
                file_count: 1,
                content_signature: Some("sig2"),
                lane: "fits",
            },
        )
        .await
        .unwrap();

        repo::insert_evidence(
            db.pool(),
            &InsertEvidence {
                id: "ev-2",
                inbox_item_id: item_id,
                relative_file_path: "mixed/mystery.fits",
                frame_type: None,
                evidence_source: "none",
                raw_value: None,
                unclassified: true,
                manual_override: Some("dark"),
                is_master: false,
                master_detector: None,
            },
        )
        .await
        .unwrap();

        repo::upsert_inbox_file_metadata(
            db.pool(),
            &UpsertFileMetadata {
                inbox_item_id: item_id,
                relative_file_path: "mixed/mystery.fits",
                ..Default::default()
            },
        )
        .await
        .unwrap();

        let files = get_inbox_item_metadata(db.pool(), item_id).await.unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].frame_type_effective.as_deref(), Some("dark"));
    }

    #[tokio::test]
    async fn missing_item_returns_not_found() {
        let db = test_db().await;
        let err = get_inbox_item_metadata(db.pool(), "nope").await.unwrap_err();
        assert_eq!(err.code, ErrorCode::InboxItemNotFound);
    }

    /// Non-type overrides (filter/exposure/binning) on an evidence row surface
    /// as effective values in the assembled metadata DTO, and override_stale is
    /// false when the override was freshly set.
    #[tokio::test]
    async fn non_type_overrides_surface_as_effective_values() {
        let db = test_db().await;
        let item_id = "item-meta-override-1";

        repo::insert_inbox_item(
            db.pool(),
            &InsertInboxItem {
                id: item_id,
                root_id: "root-1",
                relative_path: "darks",
                file_count: 1,
                content_signature: Some("sig-ov1"),
                lane: "fits",
            },
        )
        .await
        .unwrap();

        // Evidence row with extracted values (no overrides yet).
        repo::insert_evidence(
            db.pool(),
            &InsertEvidence {
                id: "ev-ov-1",
                inbox_item_id: item_id,
                relative_file_path: "darks/dark_001.fits",
                frame_type: Some("dark"),
                evidence_source: "imagetyp_header",
                raw_value: Some("Dark Frame"),
                unclassified: false,
                manual_override: None,
                is_master: false,
                master_detector: None,
            },
        )
        .await
        .unwrap();

        // Metadata row with extracted header values.
        repo::upsert_inbox_file_metadata(
            db.pool(),
            &UpsertFileMetadata {
                inbox_item_id: item_id,
                relative_file_path: "darks/dark_001.fits",
                filter: Some("L"),
                exposure_s: Some(60.0),
                binning_x: Some(1),
                binning_y: Some(1),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        // Apply non-type overrides.
        repo::set_overrides(
            db.pool(),
            item_id,
            "darks/dark_001.fits",
            None,        // no frame-type override
            Some("Ha"),  // override filter
            Some(120.0), // override exposure
            Some("2x2"), // override binning
        )
        .await
        .unwrap();

        let files = get_inbox_item_metadata(db.pool(), item_id).await.unwrap();
        assert_eq!(files.len(), 1);
        let f = &files[0];
        // Frame type comes from extracted evidence (no type override applied).
        assert_eq!(f.frame_type_effective.as_deref(), Some("dark"));
        // Non-type overrides win over extracted values.
        assert_eq!(f.filter.as_deref(), Some("Ha"), "override_filter should win");
        assert_eq!(f.exposure_s, Some(120.0), "override_exposure_s should win");
        assert_eq!(f.binning_x, Some(2), "parsed binning x from '2x2'");
        assert_eq!(f.binning_y, Some(2), "parsed binning y from '2x2'");
        // A freshly-set override is not stale.
        assert!(!f.override_stale, "freshly-set override must not be stale");
    }

    /// When mark_override_stale has been called (simulating R-4 detection),
    /// get_inbox_item_metadata returns override_stale = true.
    #[tokio::test]
    async fn stale_override_surfaces_in_metadata() {
        let db = test_db().await;
        let item_id = "item-meta-stale-1";

        repo::insert_inbox_item(
            db.pool(),
            &InsertInboxItem {
                id: item_id,
                root_id: "root-1",
                relative_path: "lights",
                file_count: 1,
                content_signature: Some("sig-stale1"),
                lane: "fits",
            },
        )
        .await
        .unwrap();

        repo::insert_evidence(
            db.pool(),
            &InsertEvidence {
                id: "ev-stale-meta-1",
                inbox_item_id: item_id,
                relative_file_path: "lights/light_001.fits",
                frame_type: Some("light"),
                evidence_source: "imagetyp_header",
                raw_value: Some("Light Frame"),
                unclassified: false,
                manual_override: None,
                is_master: false,
                master_detector: None,
            },
        )
        .await
        .unwrap();

        repo::upsert_inbox_file_metadata(
            db.pool(),
            &UpsertFileMetadata {
                inbox_item_id: item_id,
                relative_file_path: "lights/light_001.fits",
                filter: Some("Ha"),
                exposure_s: Some(300.0),
                file_size_bytes: Some(4_194_304),
                file_mtime: Some("2025-10-10T22:00:00Z"),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        // Simulate R-4 detection: size/mtime changed → mark stale.
        repo::mark_override_stale(db.pool(), item_id, "lights/light_001.fits").await.unwrap();

        let files = get_inbox_item_metadata(db.pool(), item_id).await.unwrap();
        assert_eq!(files.len(), 1);
        assert!(files[0].override_stale, "override_stale must be true after mark_override_stale");
    }

    /// US9/FR-032/FR-033: a light missing its date surfaces `date` in
    /// `missing_path_attributes` so the UI can prompt before confirm blocks; a
    /// light with all required attributes surfaces none.
    #[tokio::test]
    async fn missing_path_attributes_surface_per_file() {
        let db = test_db().await;
        let item_id = "item-missing-attr";

        repo::insert_inbox_item(
            db.pool(),
            &InsertInboxItem {
                id: item_id,
                root_id: "root-1",
                relative_path: "lights",
                file_count: 2,
                content_signature: Some("sig-ma"),
                lane: "fits",
            },
        )
        .await
        .unwrap();

        for (i, (fname, has_date)) in
            [("light_ok.fits", true), ("light_nodate.fits", false)].iter().enumerate()
        {
            repo::insert_evidence(
                db.pool(),
                &InsertEvidence {
                    id: &format!("ev-ma-{i}"),
                    inbox_item_id: item_id,
                    relative_file_path: fname,
                    frame_type: Some("light"),
                    evidence_source: "imagetyp_header",
                    raw_value: Some("Light Frame"),
                    unclassified: false,
                    manual_override: None,
                    is_master: false,
                    master_detector: None,
                },
            )
            .await
            .unwrap();
            repo::upsert_inbox_file_metadata(
                db.pool(),
                &UpsertFileMetadata {
                    inbox_item_id: item_id,
                    relative_file_path: fname,
                    object: Some("M42"),
                    filter: Some("Ha"),
                    date_obs: if *has_date { Some("2025-10-10") } else { None },
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        }

        let files = get_inbox_item_metadata(db.pool(), item_id).await.unwrap();
        let by_path: std::collections::HashMap<&str, &InboxFileMetadata> =
            files.iter().map(|f| (f.relative_file_path.as_str(), f)).collect();
        assert!(
            by_path["light_ok.fits"].missing_path_attributes.is_empty(),
            "fully-attributed light surfaces no missing attributes"
        );
        assert!(
            by_path["light_nodate.fits"].missing_path_attributes.contains(&"date".to_owned()),
            "light without DATE-OBS surfaces 'date' as missing, got {:?}",
            by_path["light_nodate.fits"].missing_path_attributes
        );
    }
}
