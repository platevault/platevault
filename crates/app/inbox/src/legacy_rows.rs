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
//! row would classify and confirm that other file; the old master row may come
//! from any image file whose text holds `\`, also one that is no longer a
//! master, so every such file is a source. Only the cases where confirm would
//! act on another file (that frame, or a path outside the root) are checked
//! for a file this scan does not read as a master. When a folder is there, a
//! master row names something that cannot be a master file; when this scan
//! stores that folder, its source groups stay, and only the master item and
//! its own overrides go.
//! When a file is there, a folder row's items would plan sources below
//! something that is not a folder; that file may be a real master, as
//! `g/h.fits` beside the folder `g\h.fits`, and then only the folder's rows
//! go. When a folder the scan read whole is there with no image or video file
//! directly inside (it is empty, or holds only subfolders or other files), a
//! folder row's items name files that are not there. A backslash folder with
//! no such file is a source too: the scan stores nothing for it, but the old
//! row of its old text may still be there. [`find`] lists the old rows a scan
//! proves stale, and [`retire`] deletes them.
//!
//! An old row is kept when this scan stores the same text itself (a nested
//! folder or master really is there, and the row is its own), or when
//! something the scan could not account for is at the nested path: a folder
//! it could not read whole (unreadable, or holding a link it skipped or an
//! entry it could not read), a file whose header it could not read, a link on
//! the way there or at the path (a dangling one may be an unmounted drive).
//! Only unconfirmed rows are deleted: still `pending_classification` or
//! `classified`, with no plan linking them; a folder is kept whole when any
//! of its items is not. A folder's rows never include a master row, so
//! deleting them never touches a master stored at the same path.
//!
//! A kept master row can still hold another file's master fields. When the
//! old scan read both `a\b.fits` and a nested master `a/b.fits`, it wrote both
//! to the one `a/b.fits` row with `INSERT OR IGNORE`, the root-level file
//! first. [`LegacyRows::masters_to_refresh`] lists such rows, and the scan
//! rewrites their master type, filter and exposure from the nested master,
//! whatever it reads in `a\b.fits` now: still a master, a frame that is not,
//! or a file whose header it cannot read.
//!
//! A master row with a plan link survives the scan, but the plan can still be
//! discarded or fail later, which removes the link and returns the row to
//! unconfirmed with no scan in between. [`retire_stale_master`] closes that
//! gap: `confirm` calls it before planning, so such a row is deleted rather
//! than confirmed again. Its verdict comes from the database alone: the scan
//! stored the row's current text beside it, and classify read the file at the
//! old path and classified it as a frame that is not a master (a file it
//! found no frame type for proves nothing). Checking at the one step that
//! plans covers every way a link goes away (cancel, discard, a failed apply,
//! the startup repair sweep) and does not race the plan listener.
//!
//! On Windows `\` is a separator, so the wire text never contains it, and
//! `old_text_under` returns nothing for the walk's own paths (its
//! `cfg!(windows)` guard): nothing is ever found.
#![allow(clippy::doc_markdown)]

use std::collections::HashSet;
use std::io;
use std::path::{Path, PathBuf};

use fs_pathsafe::is_link_or_junction_metadata;

use persistence_core::DbResult;
use persistence_inbox::repositories::inbox as repo;
use sqlx::{SqliteConnection, SqlitePool};

use crate::scan::ScannedInboxItem;

/// Old-text inbox rows of one root that a scan proved stale, and the kept
/// master rows whose master fields it must rewrite. Each list is sorted.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct LegacyRows {
    /// Folder paths: the source group and its items.
    pub folders: Vec<String>,
    /// Master item paths. Each is the old text of an image file this scan
    /// lists, also one it no longer reads as a master: the old scan may have
    /// read that file as one and stored a master row there.
    pub masters: Vec<String>,
    /// Master item paths that now name a folder this scan stores. A master
    /// item names a file, so such a row is stale too, but the source groups at
    /// its path are the folder's and stay: only the item and its own
    /// overrides go. A folder the scan does not store (empty, or holding only
    /// subfolders or other files) has no group of its own, so a master row
    /// there is listed in `masters` and goes with its groups.
    pub masters_at_folders: Vec<String>,
    /// Master item paths this scan stores itself that are also the old text
    /// of an image file it lists, as `a/b.fits` is for `a\b.fits`. The row is
    /// the nested master's own and is kept, but the old scan may have filled
    /// its master type, filter and exposure from the other file, whatever
    /// this scan reads in that file now. The scan rewrites them from the
    /// nested master it read.
    pub masters_to_refresh: Vec<String>,
}

/// List the rows the old scan stored for the entries in `items` under `root`
/// and for the folders in `bare_dirs` that this scan proves stale, and the
/// kept master rows whose master fields it must rewrite. Stats only the
/// nested paths of entries whose text contains `\`. `bare_dirs` are the
/// folders the scan read whole and found no image or video file directly in.
pub(crate) fn find(
    root: &Path,
    items: &[ScannedInboxItem],
    bare_dirs: &HashSet<PathBuf>,
) -> LegacyRows {
    let folders: HashSet<&str> = items.iter().map(|item| item.relative_path.as_str()).collect();
    let masters: HashSet<&str> =
        items.iter().flat_map(|item| &item.masters).map(|m| m.relative_path.as_str()).collect();
    let master_files: HashSet<&Path> =
        items.iter().flat_map(|item| &item.masters).map(|m| m.abs_path.as_path()).collect();
    let unread_files: HashSet<&Path> =
        items.iter().flat_map(|item| &item.unread_files).map(PathBuf::as_path).collect();
    // Files the scan read and found not to be masters. A file whose header it
    // could not read is unknown, and unknown is never proof.
    let frames: HashSet<&Path> = items
        .iter()
        .flat_map(|item| item.fits_files.iter().chain(&item.xisf_files))
        .map(PathBuf::as_path)
        .filter(|file| !master_files.contains(file) && !unread_files.contains(file))
        .collect();

    let mut rows = LegacyRows::default();
    // The folders this scan stores, and the bare ones it stores nothing for:
    // an old row may name either under its old text.
    let old_folders = folders
        .iter()
        .filter_map(|text| old_text(text))
        .chain(bare_dirs.iter().filter_map(|dir| old_text_under(root, dir)));
    for old in old_folders {
        if folders.contains(old.as_str()) {
            continue;
        }
        let stale = never_current(&old)
            || match look_up(root, &old) {
                Entry::Absent | Entry::Other => true,
                Entry::Folder => bare_dirs.contains(&root.join(&old)),
                Entry::Unknown => false,
            };
        if stale {
            rows.folders.push(old);
        }
    }
    // Every image file whose text holds `\`: the old scan may have read it as
    // a master and stored a master row at its old text, whatever this scan
    // reads in it now.
    let old_images =
        items.iter().flat_map(|item| item.fits_files.iter().chain(&item.xisf_files)).filter_map(
            |file| Some((old_text_under(root, file)?, master_files.contains(file.as_path()))),
        );
    for (old, is_master) in old_images {
        if masters.contains(old.as_str()) {
            // The nested master's own row. The old scan may have filled its
            // master fields from this file; rewriting them from its own file
            // is always right.
            rows.masters_to_refresh.push(old);
        } else if never_current(&old) || frames.contains(&root.join(&old).as_path()) {
            // A master row there would plan a path outside the root, or a
            // frame that is not a master.
            rows.masters.push(old);
        } else if is_master {
            // A master row at an absent path or at a folder cannot be
            // classified, so it is looked up only for a file this scan reads
            // as a master; for any other file that would stat, and delete at,
            // every backslash frame on every scan.
            match look_up(root, &old) {
                Entry::Folder if folders.contains(old.as_str()) => {
                    rows.masters_at_folders.push(old);
                }
                Entry::Absent | Entry::Folder => rows.masters.push(old),
                Entry::Other | Entry::Unknown => {}
            }
        }
    }
    for paths in [
        &mut rows.folders,
        &mut rows.masters,
        &mut rows.masters_at_folders,
        &mut rows.masters_to_refresh,
    ] {
        paths.sort_unstable();
        paths.dedup();
    }
    rows
}

/// Delete the unconfirmed `rows` of `root_id` with everything that hangs off
/// them: see `delete_unconfirmed_master_rows_conn`,
/// `delete_unconfirmed_master_item_at_folder_conn` and
/// `delete_unconfirmed_folder_rows_conn`. Masters go first, so a source group
/// at a folder path is never kept alive by a master row this call deletes.
///
/// # Errors
/// Returns `persistence_core::DbError::Database` on connection failure.
pub async fn retire(conn: &mut SqliteConnection, root_id: &str, rows: &LegacyRows) -> DbResult<()> {
    for master in &rows.masters {
        repo::delete_unconfirmed_master_rows_conn(conn, root_id, master).await?;
    }
    for master in &rows.masters_at_folders {
        repo::delete_unconfirmed_master_item_at_folder_conn(conn, root_id, master).await?;
    }
    for folder in &rows.folders {
        repo::delete_unconfirmed_folder_rows_conn(conn, root_id, folder).await?;
    }
    Ok(())
}

/// Delete the master item `inbox_item_id` when it is an unconfirmed old-text
/// row whose path names a frame that is not a master, as
/// `delete_stale_old_text_master_conn` decides. Returns whether it was
/// deleted. Always `false` on Windows.
///
/// # Errors
/// Returns `persistence_core::DbError::Database` on connection failure.
pub async fn retire_stale_master(pool: &SqlitePool, inbox_item_id: &str) -> DbResult<bool> {
    if cfg!(windows) {
        return Ok(false);
    }
    let mut tx = pool.begin().await?;
    let retired = repo::delete_stale_old_text_master_conn(&mut tx, inbox_item_id).await?;
    tx.commit().await?;
    Ok(retired)
}

/// The text the old `wire_path` stored for `text`, when it differs. Also used
/// by classify to carry an override from a cached evidence row stored under
/// the old text to the file it was set on.
pub(crate) fn old_text(text: &str) -> Option<String> {
    text.contains('\\').then(|| text.replace('\\', "/"))
}

/// The old text of `path`, a file or folder the walk listed under `root`,
/// when its own text holds `\`. On macOS and Linux the walk lists UTF-8 paths
/// only, and their wire text is their own text, so this reads it without
/// building it; on Windows `\` is a separator and nothing is found.
fn old_text_under(root: &Path, path: &Path) -> Option<String> {
    if cfg!(windows) {
        return None;
    }
    old_text(path.strip_prefix(root).ok()?.to_str()?)
}

/// Whether `text` has an empty, `.` or `..` name. The current wire text of an
/// entry the scan lists never does, so such a row can only be old text (for
/// example `p//b.fits` from `p/\b.fits`), and it is never joined onto the root
/// to look.
fn never_current(text: &str) -> bool {
    text.split('/').any(|name| name.is_empty() || name == "." || name == "..")
}

/// What is at a root-relative path, looked up without following links.
enum Entry {
    /// Nothing can be there: a name on the way is missing, or names a file.
    Absent,
    /// A folder.
    Folder,
    /// Something that is not a folder, such as a regular file.
    Other,
    /// A link or junction on the way or at the path, or a stat error.
    Unknown,
}

/// Look up the root-relative `text` under `root`, every folder on the way
/// there a real folder.
///
/// Each name is checked in turn without following links. The first missing
/// one makes the path absent, and so does a name below a file: when the file
/// `a` sits beside `a\b.fits`, stating `a/b.fits` reports `NotADirectory`,
/// and nothing can be at that path. A link or junction on the way, or at the
/// path, makes the answer unknown, because a dangling link (an unmounted
/// drive, say) reports the path below it missing although the drive may hold
/// it. So does any other stat error. Unknown is never absent.
fn look_up(root: &Path, text: &str) -> Entry {
    let mut path = root.to_path_buf();
    let mut is_folder = true;
    for name in text.split('/') {
        path.push(name);
        match std::fs::symlink_metadata(&path) {
            Err(e)
                if matches!(e.kind(), io::ErrorKind::NotFound | io::ErrorKind::NotADirectory) =>
            {
                return Entry::Absent
            }
            Err(_) => return Entry::Unknown,
            Ok(meta) if is_link_or_junction_metadata(&meta) => return Entry::Unknown,
            Ok(meta) => is_folder = meta.is_dir(),
        }
    }
    if is_folder {
        Entry::Folder
    } else {
        Entry::Other
    }
}
