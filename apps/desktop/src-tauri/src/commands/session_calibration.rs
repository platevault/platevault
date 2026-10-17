// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Session calibration IPC (spec 064 LIB-FR-17, spec 068): the Needs
//! calibration queue and Reassign of a session's pinned calibration.
//!
//! Registered only by the isolated rebuilt shell ([`crate::library_shell`])
//! under its `calibration` block. Matching runs at ingestion and is pinned on
//! the session; Reassign replaces one kind's pin with the raw set or master the
//! user picked, checked against the session by the calibration rules, at the
//! session's calibration generation. A reassignment writes nothing into any
//! Project. Failures follow the library [`platevault_core::ErrorResponse`]
//! conventions, naming the session.

use std::sync::Arc;

use platevault_core::library::Library;
use platevault_core::{InputKind, InputRef, Revision, SessionCalibration, SessionNeeds};
use tauri::State;
use uuid::Uuid;

use super::library::{fail, Reply};

/// The Needs calibration queue, in Sessions order: every listed session with a
/// kind neither pinned nor No, and every one whose pinned file changed or went
/// missing. Read-only.
///
/// # Errors
/// `PersistenceFailure` for an unreadable or corrupt catalog.
#[tauri::command]
pub async fn calibration_needs(library: State<'_, Arc<Library>>) -> Reply<Vec<SessionNeeds>> {
    library.catalog().needs_calibration().await.map_err(fail(None))
}

/// Reassign the session's `kind` to `input` at the calibration generation the
/// user saw.
///
/// # Errors
/// `NotFound` for an unknown session; `Conflict` (with successors for a
/// superseded session) for another generation than `expected_generation`;
/// `InvalidInput` for an input of another kind or one a hard check refuses;
/// `SourceUnavailable` when a frame to hash can't be read.
#[tauri::command]
pub async fn calibration_reassign(
    library: State<'_, Arc<Library>>,
    session_id: Uuid,
    kind: InputKind,
    input: InputRef,
    expected_generation: Revision,
) -> Reply<SessionCalibration> {
    library
        .reassign_calibration(session_id, kind, input, expected_generation)
        .await
        .map_err(fail(Some(session_id)))
}
