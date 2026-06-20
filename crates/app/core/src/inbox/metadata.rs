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

use persistence_db::repositories::inbox::{self as repo};
use sqlx::SqlitePool;

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
            "inbox.item.not_found",
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

    let files = meta_rows
        .iter()
        .map(|m| {
            let ev = evidence_by_path.get(m.relative_file_path.as_str());

            // frame_type_effective: override (if set) else extracted frame type.
            let frame_type_effective =
                ev.and_then(|e| e.manual_override.clone().or_else(|| e.frame_type.clone()));

            // image_typ: the raw IMAGETYP header value captured as evidence
            // raw_value (only header-sourced evidence carries it).
            let image_typ = ev.and_then(|e| e.raw_value.clone());

            // is_master: a single-file master item OR a per-file detected master.
            let is_master = item_is_master;

            InboxFileMetadata {
                relative_file_path: m.relative_file_path.clone(),
                frame_type_effective,
                image_typ,
                filter: m.filter.clone(),
                exposure_s: m.exposure_s,
                gain: m.gain.clone(),
                binning_x: m.binning_x.and_then(|v| i32::try_from(v).ok()),
                binning_y: m.binning_y.and_then(|v| i32::try_from(v).ok()),
                temperature_c: m.temperature_c,
                object: m.object.clone(),
                date_obs: m.date_obs.clone(),
                instrume: m.instrume.clone(),
                telescop: m.telescop.clone(),
                naxis1: m.naxis1.and_then(|v| i32::try_from(v).ok()),
                naxis2: m.naxis2.and_then(|v| i32::try_from(v).ok()),
                stack_count: m.stack_count.and_then(|v| i32::try_from(v).ok()),
                is_master,
                // R-4: override staleness compares the file's CURRENT size/mtime
                // against the stored identity. This use case has no root path, so
                // it cannot cheaply stat the file here.
                // TODO(spec 041 R-4): surface staleness once a root path is
                // threaded through, or read the persisted evidence.override_stale
                // flag when reclassify begins writing it.
                override_stale: false,
            }
        })
        .collect();

    Ok(files)
}

fn db_err(e: &persistence_db::DbError) -> ContractError {
    ContractError::new("internal.database", e.to_string(), ErrorSeverity::Fatal, true)
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
        assert_eq!(err.code, "inbox.item.not_found");
    }
}
