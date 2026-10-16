// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Wrap up and Close (spec 065 PRJ-FR-14/15/25/30, 071 STO-FR-01/04 to
//! STO-FR-08/13 to STO-FR-16; D19, D-W43, D-W80, D-W81, D-W97, D-W111,
//! D-W112, D-W116): the one ordered flow that closes a Project, on the
//! composed library.
//!
//! Wrap up opens on an open Project with no pending change and no running
//! operation (`ClosePolicy`). Clean up removes what the user ticked of the
//! View `PlateVault` placed and of what `View (previous)/` still holds; Trash
//! moves the ticked rows (rejected frames, `Processing/` files, duplicate
//! copies) to the OS Trash; Archive's Proceed is Close project…, which
//! records the Closed snapshot, locks the Project for good and runs the
//! archive while the Project reads Closing. Each file is re-verified
//! immediately before it moves (D19) and nothing the user didn't review is
//! ever moved; `Output/` and the masters `Processing/` offered are never
//! offered. There is no Reopen; Duplicate continues a Closed Project.
//!
//! A stop leaves durable records: [`Library::recover_wrap_up`] settles an
//! interrupted Clean up, resumes a Trash step and resumes or settles every
//! archive, so no Project stays half-closed. The shell calls it at start.

mod archive;
mod clean_up;
mod trash;

use std::path::PathBuf;
use std::sync::Arc;

use uuid::Uuid;

pub use self::archive::ArchiveControl;
use crate::custody::trash::OsTrash;
use crate::layout;
use crate::library::Library;
use crate::{
    ArchiveProgress, ClosedSnapshot, DuplicateRequest, LibraryError, NativePath, Project,
    WrapUpStatus, WrapUpStep,
};

impl Library {
    /// Where Project `project_id`'s Wrap up stands: its recorded steps, the
    /// current one, and why it doesn't open ("Apply or discard N changes
    /// first", a running operation, or a locked Project).
    ///
    /// # Errors
    /// `NotFound` for an unknown Project; catalog errors.
    pub async fn wrap_up_status(&self, project_id: Uuid) -> Result<WrapUpStatus, LibraryError> {
        self.catalog().wrap_up_status(project_id).await
    }

    /// Reopen `step` from the step strip: it and the later steps are no
    /// longer recorded, until the Project is closed.
    ///
    /// # Errors
    /// `InvalidInput` for a Project that is not open or that an operation
    /// runs on; `NotFound` for an unknown Project.
    pub async fn reopen_wrap_up_step(
        &self,
        project_id: Uuid,
        step: WrapUpStep,
    ) -> Result<WrapUpStatus, LibraryError> {
        self.catalog().reopen_wrap_up_step(project_id, step).await
    }

    /// What a Closed, Closing or Archived Project reads for good: its basis
    /// with the calibration each session used, and its goals frozen at Close.
    /// `None` while the Project is open.
    ///
    /// # Errors
    /// Catalog errors.
    pub async fn closed_snapshot(
        &self,
        project_id: Uuid,
    ) -> Result<Option<ClosedSnapshot>, LibraryError> {
        self.catalog().closed_snapshot(project_id).await
    }

    /// Duplicate… (PRJ-FR-30): a new open Project with what the user kept
    /// ticked, its sessions on their current calibration pins, no files and
    /// no link to the original.
    ///
    /// # Errors
    /// As `Catalog::duplicate_project`.
    pub async fn duplicate_project(
        &self,
        request: &DuplicateRequest,
    ) -> Result<Project, LibraryError> {
        self.catalog().duplicate_project(request).await
    }

    /// Settle what a stop left of Wrap up: an interrupted Clean up's
    /// operation is released (each file it removed is recorded, the step is
    /// not), a Trash step runs to its end and records Finished, and every
    /// archive resumes from its recorded phases and settles its Closing
    /// Project Archived, or Closed when nothing moved. Returns the archives
    /// it settled.
    ///
    /// # Errors
    /// Catalog errors; the first archive that couldn't settle.
    pub async fn recover_wrap_up(
        &self,
        trash: Arc<dyn OsTrash>,
    ) -> Result<Vec<ArchiveProgress>, LibraryError> {
        for operation in self.catalog().running_clean_ups().await? {
            self.catalog().settle_interrupted_operation(operation).await?;
        }
        for storage in self.catalog().running_wrap_up_trashes().await? {
            let journal = self.catalog().wrap_up_trash(storage).await?;
            self.drive_trash(journal, &trash).await?;
        }
        let mut settled = Vec::new();
        for storage in self.catalog().unsettled_archives().await? {
            settled.push(self.run_archive(storage, &trash, &crate::apply::Unattended).await?);
        }
        Ok(settled)
    }
}

/// `<processing location>/<Project>/`, or `None` before the user chose a
/// processing location (so the Project has no folder yet).
fn project_folder(parent: Option<&NativePath>, name: &str) -> Result<Option<PathBuf>, LibraryError> {
    parent.map(|parent| layout::project_folder(&parent.to_path_buf()?, name)).transpose()
}
