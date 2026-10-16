// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Inbox rows a scan stored before bd astro-plan-3pvvc for a macOS or Linux
//! name that contains a backslash.
//!
//! The old `wire_path` turned every `\` into `/`, so the folder `c\d` was
//! stored as `c/d` and the master file `a\b.fits` as `a/b.fits`. A scan now
//! stores such an entry under its own text, which adds a new row; the old row
//! stays and names the nested path. When nothing is there, the old row can
//! never be classified. When a frame that is not a master is there, a master
//! row would classify and confirm that other file. [`find`] lists the old rows
//! a scan proves stale, and [`retire`] deletes them.
//!
//! An old row is kept when this scan stores the same text itself (a nested
//! folder or master really is there, and the row is its own), or when
//! something the scan could not account for is at the nested path: an
//! unreadable folder, a link on the way there (a dangling one may be an
//! unmounted drive), a file of another kind. Only unconfirmed rows are
//! deleted: still `pending_classification` or `classified`, with no plan
//! linking them; a folder is kept whole when any of its items is not.
//!
//! On Windows the wire text never contains `\`, so nothing is ever found.
#![allow(clippy::doc_markdown)]

use std::collections::HashSet;
use std::io;
use std::path::{Path, PathBuf};

use fs_pathsafe::is_link_or_junction_metadata;

use persistence_core::DbResult;
use persistence_inbox::repositories::inbox as repo;
use sqlx::SqliteConnection;

use crate::scan::ScannedInboxItem;

/// Old-text inbox rows of one root that a scan proved stale.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct LegacyRows {
    /// Folder paths: the source group and its items.
    pub folders: Vec<String>,
    /// Master item paths.
    pub masters: Vec<String>,
}

/// List the rows the old scan stored for the entries in `items` under `root`
/// that this scan proves stale. Stats only the nested paths of entries whose
/// text contains `\`.
pub(crate) fn find(root: &Path, items: &[ScannedInboxItem]) -> LegacyRows {
    let folders: HashSet<&str> = items.iter().map(|item| item.relative_path.as_str()).collect();
    let masters: HashSet<&str> =
        items.iter().flat_map(|item| &item.masters).map(|m| m.relative_path.as_str()).collect();
    let master_files: HashSet<&Path> =
        items.iter().flat_map(|item| &item.masters).map(|m| m.abs_path.as_path()).collect();
    let frames: HashSet<&Path> = items
        .iter()
        .flat_map(|item| item.fits_files.iter().chain(&item.xisf_files))
        .map(PathBuf::as_path)
        .filter(|file| !master_files.contains(file))
        .collect();

    let mut rows = LegacyRows::default();
    for old in folders.iter().filter_map(|text| old_text(text)) {
        if !folders.contains(old.as_str()) && (never_current(&old) || is_absent(root, &old)) {
            rows.folders.push(old);
        }
    }
    for old in masters.iter().filter_map(|text| old_text(text)) {
        if masters.contains(old.as_str()) {
            continue;
        }
        if never_current(&old)
            || is_absent(root, &old)
            || frames.contains(&root.join(&old).as_path())
        {
            rows.masters.push(old);
        }
    }
    for paths in [&mut rows.folders, &mut rows.masters] {
        paths.sort_unstable();
        paths.dedup();
    }
    rows
}

/// Delete the unconfirmed `rows` of `root_id` with everything that hangs off
/// them: see `delete_unconfirmed_master_rows_conn` and
/// `delete_unconfirmed_folder_rows_conn`. Masters go first, so a source group
/// at a folder path is never kept alive by a master row this call deletes.
///
/// # Errors
/// Returns `persistence_core::DbError::Database` on connection failure.
pub async fn retire(conn: &mut SqliteConnection, root_id: &str, rows: &LegacyRows) -> DbResult<()> {
    for master in &rows.masters {
        repo::delete_unconfirmed_master_rows_conn(conn, root_id, master).await?;
    }
    for folder in &rows.folders {
        repo::delete_unconfirmed_folder_rows_conn(conn, root_id, folder).await?;
    }
    Ok(())
}

/// The text the old `wire_path` stored for `text`, when it differs.
fn old_text(text: &str) -> Option<String> {
    text.contains('\\').then(|| text.replace('\\', "/"))
}

/// Whether `text` has an empty, `.` or `..` name. The current wire text of an
/// entry the scan lists never does, so such a row can only be old text (for
/// example `p//b.fits` from `p/\b.fits`), and it is never joined onto the root
/// to look.
fn never_current(text: &str) -> bool {
    text.split('/').any(|name| name.is_empty() || name == "." || name == "..")
}

/// Whether nothing at all is at the root-relative `text` under `root`, with
/// every folder on the way there a real folder.
///
/// Each name is checked in turn without following links. The first missing
/// one makes the path absent. A link or junction on the way makes the answer
/// unknown, because a dangling link (an unmounted drive, say) reports the path
/// below it missing although the drive may hold it. So does any other stat
/// error. Unknown is never absent.
fn is_absent(root: &Path, text: &str) -> bool {
    let mut path = root.to_path_buf();
    for name in text.split('/') {
        path.push(name);
        match std::fs::symlink_metadata(&path) {
            Err(e) => return e.kind() == io::ErrorKind::NotFound,
            Ok(meta) if is_link_or_junction_metadata(&meta) => return false,
            Ok(_) => {}
        }
    }
    false
}
