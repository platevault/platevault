// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! `target.note.get` / `target.note.update` (spec 023 US4).

use audit::bus::EventBus;
use audit::event_bus::{Source, TargetNoteUpdated, TOPIC_TARGET_NOTE_UPDATED};
use sqlx::SqlitePool;
use uuid::Uuid;

use contracts_core::targets::{
    TargetNoteGetRequest, TargetNoteGetResult, TargetNoteUpdateRequest, TargetNoteUpdateResult,
};
use contracts_core::{error_code::ErrorCode, ContractError, ErrorSeverity};
use domain_core::ids::Timestamp;

use super::{db_err, invalid_id, not_found};

/// Maximum UTF-8 byte length for a target observing note (FR-004 / spec 023).
pub(super) const MAX_NOTE_BYTES: usize = 16_384;

/// `target.note.get` — read the observing notes for a target (spec 023 US4).
///
/// Returns `notes: null` when no notes are stored.  Returns `target.not_found`
/// when the target does not exist.
///
/// # Errors
///
/// Returns [`ContractError`] with code `target.not_found`, `target.invalid_id`,
/// or `internal.database`.
pub async fn note_get(
    pool: &SqlitePool,
    req: &TargetNoteGetRequest,
) -> Result<TargetNoteGetResult, ContractError> {
    let _uuid = Uuid::parse_str(&req.target_id).map_err(|_| invalid_id(&req.target_id))?;
    let exists = persistence_db::repositories::q_targets_mgmt::target_exists(pool, &req.target_id)
        .await
        .map_err(db_err)?;
    if !exists {
        return Err(not_found(&req.target_id));
    }
    let notes = persistence_db::repositories::targets::get_target_notes(pool, &req.target_id)
        .await
        .map_err(db_err)?;
    Ok(TargetNoteGetResult { notes })
}

/// `target.note.update` — write observing notes for a target (spec 023 US4).
///
/// Empty or whitespace-only `notes` clears the field (stores NULL).
/// Returns the stored value after the update.
/// Notes exceeding 16 384 UTF-8 bytes (after trimming) are rejected with
/// `note.content_too_large` (FR-004).
///
/// Emits a `target.note.updated` audit event after a successful DB write.
/// Bus publish failures are logged at `warn` but do NOT fail the operation.
///
/// # Errors
///
/// Returns [`ContractError`] with code `target.not_found`, `target.invalid_id`,
/// `note.content_too_large`, or `internal.database`.
pub async fn note_update(
    pool: &SqlitePool,
    bus: &EventBus,
    req: &TargetNoteUpdateRequest,
) -> Result<TargetNoteUpdateResult, ContractError> {
    let _uuid = Uuid::parse_str(&req.target_id).map_err(|_| invalid_id(&req.target_id))?;
    let exists = persistence_db::repositories::q_targets_mgmt::target_exists(pool, &req.target_id)
        .await
        .map_err(db_err)?;
    if !exists {
        return Err(not_found(&req.target_id));
    }
    // Blank/whitespace → store NULL (clear).
    let trimmed = req.notes.trim();
    // FR-004: reject notes exceeding 16 KB UTF-8.
    if trimmed.len() > MAX_NOTE_BYTES {
        return Err(ContractError::new(
            ErrorCode::NoteContentTooLarge,
            format!("Note body exceeds the 16 384-byte limit ({} bytes supplied).", trimmed.len()),
            ErrorSeverity::Blocking,
            false,
        ));
    }
    let stored: Option<&str> = if trimmed.is_empty() { None } else { Some(trimmed) };
    let updated =
        persistence_db::repositories::targets::set_target_notes(pool, &req.target_id, stored)
            .await
            .map_err(db_err)?;
    if !updated {
        // Should not happen (we verified existence above), but be defensive.
        return Err(not_found(&req.target_id));
    }

    // Emit audit event — bus failure is non-fatal.
    if let Err(e) = bus
        .publish(
            TOPIC_TARGET_NOTE_UPDATED,
            Source::User,
            TargetNoteUpdated {
                target_id: req.target_id.clone(),
                has_notes: stored.is_some(),
                at: Timestamp::now_iso(),
            },
        )
        .await
    {
        tracing::warn!(target_id = %req.target_id, error = %e, "audit bus publish failed for target.note.updated");
    }

    Ok(TargetNoteUpdateResult { notes: stored.map(str::to_owned) })
}
