// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Sessions > Archive IPC (spec 064 LIB-FR-17, 071 STO-FR-13): the archive
//! review of the sessions the user selected, and the archive it confirms.
//!
//! Registered only by the isolated rebuilt shell ([`crate::library_shell`])
//! under its `sessions archive` block. The review lays the sessions' files out
//! for the destination, keeps each session an open Project holds, and lists the
//! kept-View links of Closed and Archived Projects the archive repoints; it
//! writes and moves nothing. The archive runs as reviewed, refused when the
//! review moved since (its digest), unattended like Close, and retires each
//! verified original to the [`WrapUpTrash`] the shell manages. No Project
//! closes or changes. Failures follow the library
//! [`platevault_core::ErrorResponse`] conventions, naming the destination.

use std::sync::Arc;

use platevault_core::apply::Unattended;
use platevault_core::library::Library;
use platevault_core::{ArchiveProgress, ArchiveReview, ArchiveSelection};
use tauri::State;
use uuid::Uuid;

use super::library::{fail, Reply};
use super::project_wrap_up::WrapUpTrash;

/// Archive's review of the selected sessions for `destination`. Read-only.
///
/// # Errors
/// `NotFound` for an unknown destination; `InvalidInput` for a retired one.
#[tauri::command]
#[specta::specta]
pub async fn sessions_archive_review(
    library: State<'_, Arc<Library>>,
    sessions: Vec<Uuid>,
    destination: Uuid,
) -> Reply<ArchiveReview> {
    library.sessions_archive_review(&sessions, destination).await.map_err(fail(Some(destination)))
}

/// Archive the sessions the user confirmed on the review whose digest the
/// selection echoes. Returns the archive's progress once it settles.
///
/// # Errors
/// `Conflict` when the review moved since the user saw it; `InvalidInput` for
/// a session that can't move or that an open Project now keeps; journal and
/// catalog failures.
#[tauri::command]
#[specta::specta]
pub async fn sessions_archive(
    library: State<'_, Arc<Library>>,
    trash: State<'_, WrapUpTrash>,
    selection: ArchiveSelection,
) -> Reply<ArchiveProgress> {
    library
        .sessions_archive(&selection, trash.get(), &Unattended)
        .await
        .map_err(fail(Some(selection.destination)))
}
