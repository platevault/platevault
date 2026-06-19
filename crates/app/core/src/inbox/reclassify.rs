//! `inbox.reclassify` use case (spec 005, T-ReclassifyImpl).
//!
//! Writes `manual_override` to `InboxClassificationEvidence` rows, re-runs
//! aggregation, and returns the updated classification type plus count of
//! remaining unclassified files.
//!
//! Reclassification is NOT permitted while a plan is open (Ref: E1 variant).
#![allow(clippy::doc_markdown)]

use persistence_db::repositories::inbox::{self as inbox_repo};
use sqlx::SqlitePool;

use contracts_core::{ContractError, ErrorSeverity};

// ── Request / Response ────────────────────────────────────────────────────────

#[derive(Clone, Debug)]
pub struct ReclassifyOverride {
    pub file_path: String,
    pub frame_type: String,
}

#[derive(Clone, Debug)]
pub struct ReclassifyRequest {
    pub inbox_item_id: String,
    pub overrides: Vec<ReclassifyOverride>,
}

#[derive(Clone, Debug)]
pub struct ReclassifyResponse {
    pub inbox_item_id: String,
    pub updated_type: String,
    pub frame_type: Option<String>,
    pub remaining_unclassified: usize,
    pub applied_count: usize,
}

// ── reclassify ────────────────────────────────────────────────────────────────

/// Apply manual frame-type overrides and re-aggregate the classification.
///
/// # Errors
///
/// - `inbox.item.not_found` — item does not exist.
/// - `inbox.has.open.plan` — reclassification blocked by an open plan.
/// - `file.not_found` — one or more file paths don't match evidence rows.
pub async fn reclassify(
    pool: &SqlitePool,
    req: ReclassifyRequest,
) -> Result<ReclassifyResponse, ContractError> {
    // 1. Verify item exists
    let item = inbox_repo::get_inbox_item(pool, &req.inbox_item_id).await.map_err(|_| {
        ContractError::new(
            "inbox.item.not_found",
            format!("InboxItem not found: {}", req.inbox_item_id),
            ErrorSeverity::Blocking,
            false,
        )
    })?;

    // 2. Block if open plan exists (Ref: E1)
    if inbox_repo::get_plan_link(pool, &req.inbox_item_id).await.unwrap_or(None).is_some() {
        return Err(ContractError::new(
            "inbox.has.open.plan",
            "Reclassification is not permitted while a plan is open.",
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // 3. Validate file paths exist in evidence
    let evidence = inbox_repo::list_evidence(pool, &req.inbox_item_id).await.map_err(|e| {
        ContractError::new("internal.database", e.to_string(), ErrorSeverity::Fatal, true)
    })?;

    let known_paths: std::collections::HashSet<&str> =
        evidence.iter().map(|ev| ev.relative_file_path.as_str()).collect();

    let missing: Vec<&str> = req
        .overrides
        .iter()
        .map(|o| o.file_path.as_str())
        .filter(|p| !known_paths.contains(p))
        .collect();

    if !missing.is_empty() {
        return Err(ContractError::new(
            "file.not_found",
            format!("File paths not found in evidence: {missing:?}"),
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // 4. Apply overrides
    let mut applied_count = 0usize;
    for o in &req.overrides {
        let updated =
            inbox_repo::set_manual_override(pool, &req.inbox_item_id, &o.file_path, &o.frame_type)
                .await
                .map_err(|e| {
                    ContractError::new(
                        "internal.database",
                        e.to_string(),
                        ErrorSeverity::Fatal,
                        true,
                    )
                })?;
        if updated {
            applied_count += 1;
        }
    }

    // 5. Re-aggregate: re-load all evidence (overrides now set)
    let updated_evidence =
        inbox_repo::list_evidence(pool, &req.inbox_item_id).await.map_err(|e| {
            ContractError::new("internal.database", e.to_string(), ErrorSeverity::Fatal, true)
        })?;

    let mut frame_types: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut remaining_unclassified = 0usize;

    for ev in &updated_evidence {
        let effective = ev.manual_override.as_deref().or(ev.frame_type.as_deref());

        if let Some(ft) = effective {
            frame_types.insert(ft.to_owned());
        } else if ev.unclassified != 0 {
            remaining_unclassified += 1;
        }
    }

    let (updated_type, single_frame_type) = match frame_types.len() {
        0 => ("unclassified".to_owned(), None),
        1 => ("single_type".to_owned(), frame_types.into_iter().next()),
        _ => ("mixed".to_owned(), None),
    };

    // 6. Update persisted classification
    inbox_repo::upsert_classification(
        pool,
        &persistence_db::repositories::inbox::UpsertClassification {
            inbox_item_id: &req.inbox_item_id,
            result: &updated_type,
            frame_type: single_frame_type.as_deref(),
            content_signature: item.content_signature.as_deref().unwrap_or(""),
            unclassified_file_count: i64::try_from(remaining_unclassified).unwrap_or(i64::MAX),
        },
    )
    .await
    .ok();

    Ok(ReclassifyResponse {
        inbox_item_id: req.inbox_item_id,
        updated_type,
        frame_type: single_frame_type,
        remaining_unclassified,
        applied_count,
    })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use persistence_db::repositories::inbox::{
        InsertEvidence, InsertInboxItem, UpsertClassification,
    };
    use persistence_db::Database;

    async fn test_db() -> Database {
        let db = Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        db
    }

    async fn setup_unclassified_item(db: &Database, item_id: &str) {
        inbox_repo::insert_inbox_item(
            db.pool(),
            &InsertInboxItem {
                id: item_id,
                root_id: "root-1",
                relative_path: "inbox_folder",
                file_count: 2,
                content_signature: Some("sig"),
                lane: "fits",
            },
        )
        .await
        .unwrap();

        inbox_repo::upsert_classification(
            db.pool(),
            &UpsertClassification {
                inbox_item_id: item_id,
                result: "unclassified",
                frame_type: None,
                content_signature: "sig",
                unclassified_file_count: 2,
            },
        )
        .await
        .unwrap();

        inbox_repo::insert_evidence(
            db.pool(),
            &InsertEvidence {
                id: &format!("{item_id}-ev-1"),
                inbox_item_id: item_id,
                relative_file_path: "inbox_folder/mystery_001.fits",
                frame_type: None,
                evidence_source: "none",
                raw_value: None,
                unclassified: true,
                manual_override: None,
                is_master: false,
                master_detector: None,
            },
        )
        .await
        .unwrap();

        inbox_repo::insert_evidence(
            db.pool(),
            &InsertEvidence {
                id: &format!("{item_id}-ev-2"),
                inbox_item_id: item_id,
                relative_file_path: "inbox_folder/mystery_002.fits",
                frame_type: None,
                evidence_source: "none",
                raw_value: None,
                unclassified: true,
                manual_override: None,
                is_master: false,
                master_detector: None,
            },
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn reclassify_two_files_to_dark() {
        let db = test_db().await;
        setup_unclassified_item(&db, "item-recl-1").await;

        let resp = reclassify(
            db.pool(),
            ReclassifyRequest {
                inbox_item_id: "item-recl-1".to_owned(),
                overrides: vec![
                    ReclassifyOverride {
                        file_path: "inbox_folder/mystery_001.fits".to_owned(),
                        frame_type: "dark".to_owned(),
                    },
                    ReclassifyOverride {
                        file_path: "inbox_folder/mystery_002.fits".to_owned(),
                        frame_type: "dark".to_owned(),
                    },
                ],
            },
        )
        .await
        .unwrap();

        assert_eq!(resp.updated_type, "single_type");
        assert_eq!(resp.frame_type, Some("dark".to_owned()));
        assert_eq!(resp.remaining_unclassified, 0);
        assert_eq!(resp.applied_count, 2);
    }

    #[tokio::test]
    async fn partial_reclassify_leaves_remaining_unclassified() {
        let db = test_db().await;
        setup_unclassified_item(&db, "item-recl-2").await;

        let resp = reclassify(
            db.pool(),
            ReclassifyRequest {
                inbox_item_id: "item-recl-2".to_owned(),
                overrides: vec![ReclassifyOverride {
                    file_path: "inbox_folder/mystery_001.fits".to_owned(),
                    frame_type: "light".to_owned(),
                }],
            },
        )
        .await
        .unwrap();

        assert_eq!(resp.remaining_unclassified, 1);
        assert_eq!(resp.applied_count, 1);
    }

    #[tokio::test]
    async fn missing_file_path_returns_error() {
        let db = test_db().await;
        setup_unclassified_item(&db, "item-recl-3").await;

        let err = reclassify(
            db.pool(),
            ReclassifyRequest {
                inbox_item_id: "item-recl-3".to_owned(),
                overrides: vec![ReclassifyOverride {
                    file_path: "nonexistent/path.fits".to_owned(),
                    frame_type: "dark".to_owned(),
                }],
            },
        )
        .await
        .unwrap_err();

        assert_eq!(err.code, "file.not_found");
    }
}
