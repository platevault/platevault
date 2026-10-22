// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Session calibration IPC (spec 064 LIB-FR-17, spec 068 CAL-FR-05): the
//! Needs calibration queue, and Confirm, No and Reassign of a session's
//! calibration.
//!
//! Registered only by the isolated rebuilt shell ([`crate::library_shell`])
//! under its `calibration` block. Matching runs at ingestion and is pinned on
//! the session. Confirm pins a kind's suggestion as the user confirmed it; No
//! declines a kind on many sessions at once and needs no reason; Reassign
//! replaces one kind's pin with the raw set or master the user picked, checked
//! against the session by the calibration rules. Each runs at the session's
//! calibration generation the user saw and writes nothing into any Project.
//! Failures follow the library [`platevault_core::ErrorResponse`] conventions,
//! naming the session.

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
#[specta::specta]
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
#[specta::specta]
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

/// Confirm the session's `kind` suggestion at the calibration generation the
/// user saw: it is pinned as the user confirmed it.
///
/// # Errors
/// `NotFound` for an unknown session; `Conflict` (with successors for a
/// superseded session) for another generation than `expected_generation`;
/// `InvalidInput` when the kind has no suggestion.
#[tauri::command]
#[specta::specta]
pub async fn calibration_confirm(
    library: State<'_, Arc<Library>>,
    session_id: Uuid,
    kind: InputKind,
    expected_generation: Revision,
) -> Reply<SessionCalibration> {
    library
        .catalog()
        .confirm_calibration(session_id, kind, expected_generation)
        .await
        .map_err(fail(Some(session_id)))
}

/// No darks, No flats or No bias on each session, each sent as
/// `[sessionId, expectedGeneration]` with the calibration generation the user
/// saw for it. One transaction: every session takes it or none does. Returns
/// each session's calibration in request order.
///
/// # Errors
/// `NotFound` for an unknown session; `Conflict` (with successors for a
/// superseded session) for another generation. The refusal's identity is the
/// session it refused.
#[tauri::command]
#[specta::specta]
pub async fn calibration_decline(
    library: State<'_, Arc<Library>>,
    sessions: Vec<(Uuid, Revision)>,
    kind: InputKind,
) -> Reply<Vec<SessionCalibration>> {
    library.catalog().decline_calibration(&sessions, kind).await.map_err(fail(None))
}
