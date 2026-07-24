// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! `inventory.frame.relink` — confirm a candidate file's identity by sha256.

use std::path::Path;

use contracts_core::error_code::ErrorCode;
use contracts_core::inventory_frame::{InventoryFrameRelinkRequest, InventoryFrameRelinkResponse};
use contracts_core::{ContractError, ErrorSeverity};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;

use app_core_errors::db_err;

use super::{internal, iso_now, rows_by_ids};

/// sha256 of a file's full contents, hex-encoded. Only ever called on demand
/// (relink), never eagerly at ingest/reconcile — lazy hashing is a
/// constitution requirement (FR-004).
pub(super) fn sha256_hex(path: &Path) -> std::io::Result<String> {
    use std::io::Read;
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 65536];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

/// `inventory.frame.relink` (spec 048 T025/US2, FR-012a/R3): confirm the
/// identity of a candidate file for a `missing` frame by sha256 content
/// hash — never by size or mtime (same-camera FITS commonly share identical
/// sizes; mtime is unreliable across copy tools).
///
/// DESIGN NOTE: a `missing` frame's original bytes are, by definition,
/// unreadable at its recorded path — there is no baseline hash to compare
/// against on a frame's FIRST relink attempt. `file_record.content_hash` is
/// populated lazily (data-model.md: "populated only on user-initiated
/// relink"), so the first relink trusts the caller's candidate selection and
/// records its hash as the frame's canonical content hash going forward. Any
/// SUBSEQUENT relink attempt for the same `frame_id` must reproduce that
/// stored hash exactly, or the operation fails with `hash.mismatch` — this
/// is what protects a same-size-different-content candidate once a baseline
/// exists.
///
/// # Errors
///
/// `frame.not_found` when the frame id is unknown; `root.unavailable` when
/// the owning root isn't registered; `file.not_found` when the candidate
/// path doesn't exist under the root; `hash.mismatch` when the candidate's
/// hash doesn't match a previously recorded one. Never mutates the candidate
/// file or writes to any other frame's row — only this `file_record` (INV-2).
pub async fn relink_frame(
    pool: &SqlitePool,
    bus: &audit::bus::EventBus,
    req: &InventoryFrameRelinkRequest,
) -> Result<InventoryFrameRelinkResponse, ContractError> {
    let rows = rows_by_ids(pool, std::slice::from_ref(&req.frame_id)).await?;
    let row = rows.into_iter().next().ok_or_else(|| {
        ContractError::new(
            ErrorCode::FrameNotFound,
            format!("frame {} not found", req.frame_id),
            ErrorSeverity::Warning,
            false,
        )
    })?;

    let root_path_str =
        persistence_targets::repositories::inventory::get_library_root_path(pool, &row.root_id)
            .await
            .map_err(db_err)?
            .ok_or_else(|| {
                ContractError::new(
                    ErrorCode::RootUnavailable,
                    format!("library root {} is not registered", row.root_id),
                    ErrorSeverity::Blocking,
                    false,
                )
            })?;

    let candidate_abs = Path::new(&root_path_str).join(&req.candidate_relative_path);
    if !candidate_abs.is_file() {
        return Err(ContractError::new(
            ErrorCode::FileNotFound,
            format!("candidate path {} does not exist under the root", req.candidate_relative_path),
            ErrorSeverity::Warning,
            false,
        ));
    }

    let candidate_hash = sha256_hex(&candidate_abs)
        .map_err(|e| internal(format!("hashing candidate {}: {e}", req.candidate_relative_path)))?;

    let existing_hash =
        persistence_core::repositories::q_core::get_file_record_content_hash(pool, &req.frame_id)
            .await
            .map_err(db_err)?;

    if let Some(expected) = existing_hash {
        if expected != candidate_hash {
            return Err(ContractError::new(
                ErrorCode::HashMismatch,
                "candidate content hash does not match the frame's recorded hash".to_owned(),
                ErrorSeverity::Warning,
                false,
            ));
        }
    }

    let now = iso_now();
    persistence_core::repositories::q_core::relink_file_record(
        pool,
        &req.frame_id,
        &req.candidate_relative_path,
        &candidate_hash,
        &now,
    )
    .await
    .map_err(db_err)?;

    bus.publish(
        audit::event_bus::TOPIC_FRAME_RELINKED,
        audit::event_bus::Source::User,
        audit::event_bus::FrameRelinked {
            frame_id: req.frame_id.clone(),
            root_id: row.root_id.clone(),
            from_path: row.relative_path.clone(),
            to_path: req.candidate_relative_path.clone(),
            sha256: candidate_hash.clone(),
            at: now,
        },
    )
    .await
    .map_err(internal)?;

    Ok(InventoryFrameRelinkResponse { relinked: true, matched_hash: candidate_hash })
}
