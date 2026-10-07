// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Run lifecycle (spec 070 RES-FR-06/07/10, PRJ-FR-20, amended D-W72): Mark
//! Complete, Move run to Trash and the Empty Trash review, with the two ports
//! the features owning a run's operations, Results and folders implement.
//!
//! [`RunOperationGuard`] sources name what blocks a lifecycle action: PREP
//! and PV-STO their Running operations affecting the run, RES the runs using
//! one of its accepted Results as an input. Mark Complete is blocked only by a
//! Running operation; Move run to Trash by every blocker. The sources are
//! asked inside the catalog write that records the change, holding the
//! catalog writer, so an operation recorded by its own catalog write either
//! committed before the ask and is named, or starts after the change and
//! finds the run Complete or in the Trash. A source therefore reports durable
//! catalog state and only reads.
//!
//! [`RunFolders`] sources name each run's prepared folders and Results
//! folder for the Empty Trash review, which PV-STO executes.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use tokio::sync::RwLock;
use uuid::Uuid;

use crate::library::Library;
use crate::{
    EmptyTrashReview, EmptyTrashRun, LibraryError, LifecycleBlocker, RunFolderSet, View, ViewRecord,
};

/// What [`RunOperationGuard::blockers`] returns.
pub type BlockersFuture<'a> =
    Pin<Box<dyn Future<Output = Result<Vec<LifecycleBlocker>, LibraryError>> + Send + 'a>>;

/// What [`RunFolders::folders`] returns.
pub type FoldersFuture<'a> =
    Pin<Box<dyn Future<Output = Result<RunFolderSet, LibraryError>> + Send + 'a>>;

/// The seam PREP (preparation revisions), PV-STO (storage mutations) and RES
/// (Results used as inputs) implement to block a run's lifecycle actions
/// (RES-FR-07, RES-FR-10). It is asked holding the catalog writer: it must
/// only read, and report state its feature records in catalog writes.
pub trait RunOperationGuard: Send + Sync + 'static {
    /// Every blocker this source holds on `view` now: its Running app-owned
    /// operations affecting the run, and the runs using one of the run's
    /// accepted Results as an input.
    fn blockers<'a>(&'a self, view: &'a View) -> BlockersFuture<'a>;
}

/// The seam PREP implements to name a run's recorded folders for Empty Trash.
pub trait RunFolders: Send + Sync + 'static {
    /// The prepared folders and Results folder recorded for `view`.
    fn folders<'a>(&'a self, view: &'a View) -> FoldersFuture<'a>;
}

/// The registered lifecycle sources.
#[derive(Default)]
pub(crate) struct RunLifecycle {
    guards: RwLock<Vec<Arc<dyn RunOperationGuard>>>,
    folders: RwLock<Vec<Arc<dyn RunFolders>>>,
}

/// The blockers every guard names on `view`; for Mark Complete only the
/// Running operations (RES-FR-07).
async fn blockers(
    guards: Vec<Arc<dyn RunOperationGuard>>,
    view: View,
    complete: bool,
) -> Result<Vec<LifecycleBlocker>, LibraryError> {
    let mut found = Vec::new();
    for guard in &guards {
        found.extend(guard.blockers(&view).await?);
    }
    if complete {
        found.retain(LifecycleBlocker::blocks_complete);
    }
    Ok(found)
}

const EMPTY_TRASH_STATEMENT: &str = "Empty Trash removes each listed run record and moves \
    each of its prepared folders to the OS Trash; its Results folder goes to the OS Trash only \
    when ticked. Library frames, their quality decisions and other runs never change. Nothing \
    moves until Empty Trash is confirmed.";

impl Library {
    /// Register a feature's source of lifecycle blockers (see
    /// [`RunOperationGuard`]).
    pub async fn register_run_guard(&self, guard: Arc<dyn RunOperationGuard>) {
        self.lifecycle.guards.write().await.push(guard);
    }

    /// Register a feature's source of run folders (see [`RunFolders`]).
    pub async fn register_run_folders(&self, source: Arc<dyn RunFolders>) {
        self.lifecycle.folders.write().await.push(source);
    }

    /// Mark processing complete (RES-FR-06): the run moves to Done with no
    /// Result needed, removes nothing and starts no Clean up. Only a Running
    /// app-owned operation affecting the run blocks it (RES-FR-07).
    ///
    /// # Errors
    /// `InvalidInput` naming each Running operation, or for a run already
    /// Complete or in the Project's Trash; `NotFound` for an unknown run; any
    /// guard error.
    pub async fn mark_view_complete(&self, id: Uuid) -> Result<ViewRecord, LibraryError> {
        let guards = self.lifecycle.guards.read().await.clone();
        self.catalog().complete_view(id, |view| blockers(guards, view, true)).await
    }

    /// Move run to Trash (RES-FR-10): refused while an app-owned operation
    /// affecting the run is Running or one of its accepted Results is an input
    /// to another run. Moves no file.
    ///
    /// # Errors
    /// `InvalidInput` naming each blocker, or for a run already in the Trash;
    /// `NotFound` for an unknown run; any guard error.
    pub async fn move_view_to_trash(&self, id: Uuid) -> Result<ViewRecord, LibraryError> {
        let guards = self.lifecycle.guards.read().await.clone();
        self.catalog().trash_view(id, |view| blockers(guards, view, false)).await
    }

    /// The Empty Trash review of `project` (RES-FR-10, PRJ-FR-20): every run
    /// in its Trash, or only `views`, each with its prepared folders and its
    /// Results folder, which goes only when ticked. Read-only.
    ///
    /// # Errors
    /// `InvalidInput` for an asked run that is not in this Project's Trash;
    /// `NotFound` for an unknown Project; any folder source error.
    pub async fn empty_trash_review(
        &self,
        project: Uuid,
        views: &[Uuid],
    ) -> Result<EmptyTrashReview, LibraryError> {
        let mut trashed = self.catalog().trashed_views(project).await?;
        if !views.is_empty() {
            if let Some(id) = views.iter().find(|id| !trashed.iter().any(|t| t.run.id == **id)) {
                return Err(LibraryError::InvalidInput(format!(
                    "run {id} is not in this Project's Trash"
                )));
            }
            trashed.retain(|t| views.contains(&t.run.id));
        }
        let sources = self.lifecycle.folders.read().await.clone();
        let mut runs = Vec::with_capacity(trashed.len());
        for run in trashed {
            let view = self.catalog().view(run.run.id).await?.view;
            if view.trashed_at.is_none() {
                return Err(LibraryError::InvalidInput(format!(
                    "run {} left this Project's Trash during the review",
                    view.id
                )));
            }
            let mut prepared_folders = Vec::new();
            let mut results_folders = Vec::new();
            for source in &sources {
                let folders = source.folders(&view).await?;
                prepared_folders.extend(folders.prepared);
                results_folders.extend(folders.results);
            }
            prepared_folders.sort_by(|a, b| {
                (a.preparation_revision, &a.path).cmp(&(b.preparation_revision, &b.path))
            });
            prepared_folders.dedup();
            results_folders.sort();
            results_folders.dedup();
            runs.push(EmptyTrashRun { run, prepared_folders, results_folders });
        }
        Ok(EmptyTrashReview { project_id: project, runs, statement: EMPTY_TRASH_STATEMENT.into() })
    }
}
