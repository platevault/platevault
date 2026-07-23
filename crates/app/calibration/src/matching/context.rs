// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Session context enrichment (spec P9).
//!
//! `calibration_core::suggest` is pure domain (no DB access — see module
//! docs). Target/filter/night/frame-count context is resolved here, in the
//! same layer that already loads sessions and masters from persistence, as a
//! post-processing pass over the DTOs `match_to_dto` produced with those
//! fields left `None`.

use std::collections::HashMap;

use contracts_core::calibration_match::CalibrationMatchDto;
use persistence_db::repositories::inventory::{get_session_context_by_ids, SessionContextRow};
use sqlx::SqlitePool;

/// Batch-load session context for a set of session ids and index it by id.
///
/// Always a single query (`persistence_db::repositories::inventory::
/// get_session_context_by_ids`) regardless of how many ids are requested.
/// Ids that don't resolve (unknown session, or a session with no context)
/// are simply absent from the returned map — callers must treat a missing
/// key the same as "no context available", not an error.
pub(super) async fn load_session_contexts(
    pool: &SqlitePool,
    session_ids: &[String],
) -> HashMap<String, SessionContextRow> {
    // Dedup before querying — batch callers (batch_suggest) may pass the same
    // id from overlapping calibration types.
    let mut seen = std::collections::HashSet::new();
    let unique_ids: Vec<String> =
        session_ids.iter().filter(|id| seen.insert((*id).clone())).cloned().collect();

    match get_session_context_by_ids(pool, &unique_ids).await {
        Ok(rows) => rows.into_iter().map(|row| (row.id.clone(), row)).collect(),
        // A lookup failure degrades to "no context" rather than failing the
        // whole suggest response — context is presentational, not load-bearing.
        Err(_) => HashMap::new(),
    }
}

/// Apply resolved session context onto a `CalibrationMatchDto`, keyed by
/// `dto.session_id`. Leaves the DTO's context fields as `None` when the
/// session id has no entry in `ctx` (unknown session, or missing metadata).
pub(super) fn apply_session_context(
    mut dto: CalibrationMatchDto,
    ctx: &HashMap<String, SessionContextRow>,
) -> CalibrationMatchDto {
    if let Some(row) = ctx.get(&dto.session_id) {
        dto.target_name = row.target_name.clone();
        dto.filter = row.filter.clone();
        dto.acquisition_night = row.acquisition_night.clone();
        dto.frame_count = u32::try_from(row.frame_count).ok();
    }
    dto
}
