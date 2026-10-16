// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! A Project's `Output/` (spec 070 RES-FR-01/02/06 to RES-FR-08/11, CAL-FR-06;
//! D-W93, D-W98): what the Output watcher observed, Copy to Output under the
//! Project's `copy_to_output` operation, and the hand-off of a generated
//! master found in `Processing/` to CAL's once-only offer.
//!
//! Filesystem work is the caller's. The watcher walks `Output/` and hands each
//! pass to [`Catalog::record_output_scan`]; a copy is reviewed, reserved and
//! recorded in the storage journal by [`Catalog::begin_output_copy`] and
//! listed by [`Catalog::finish_output_copy`] once its re-read verified. Every
//! file in `Output/` is a Result: nothing is accepted, and nothing records
//! which inputs produced a Result or where a copy came from. Kind and Channel
//! are the user's and survive every pass. A Closed Project's Output is
//! read-only (RES-FR-07; `project_output.sql` refuses the writes too).

use std::path::{Path, PathBuf};

use platevault_model::{
    Classification, EntryEvidence, GroupName, LibraryError, MasterOfferState, NativePath,
    ObservationFingerprint, OutputKind, OutputObservation, OutputOrigin, OutputState,
    ProcessingMasterOffer, ProjectLifecycle, ProjectOperationKind, StorageItemDraft,
    StorageOperationKind, TransferDestination,
};
use sqlx::sqlite::SqliteConnection;
use sqlx::{Connection, Row};
use uuid::Uuid;

use super::project_operations::{reserve_operation, settle_operation};
use super::storage::insert_operation;
use super::{from_json, from_text, now, parse_uuid, path_key, to_json, to_text, Catalog, Result};

fn invalid(message: impl Into<String>) -> LibraryError {
    LibraryError::InvalidInput(message.into())
}

/// A panel group of the Project: its `Output/Panels/` folder holds its result.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OutputPanel {
    pub group_id: Uuid,
    pub name: GroupName,
}

/// What one Output pass reads first, from one catalog snapshot.
#[derive(Clone, Debug)]
pub struct OutputBasis {
    pub project_id: Uuid,
    pub lifecycle: ProjectLifecycle,
    /// The Project's name and chosen processing location, which place its
    /// folder (`None` until chosen: there is no assumed root).
    pub name: String,
    pub parent: Option<NativePath>,
    /// The Copy to Output operations the Project has recorded: a pass read
    /// before another one started is stale.
    pub copies: u64,
    /// A Copy to Output is running; a pass waits until it settles.
    pub copying: bool,
    pub panels: Vec<OutputPanel>,
    pub recorded: Vec<OutputObservation>,
}

/// One file a pass found in `Output/`, relative to that folder.
#[derive(Clone, Debug)]
pub struct ScannedOutput {
    pub path: NativePath,
    pub panel_group_id: Option<Uuid>,
    /// Settling or Settled; the watcher decides which.
    pub state: OutputState,
    pub size_bytes: u64,
    /// `None` while the file could not be fingerprinted (held by its writer).
    pub fingerprint: Option<ObservationFingerprint>,
}

/// What a pass found where the Project's `Output/` belongs.
#[derive(Clone, Debug)]
pub enum OutputFolder {
    /// Every regular file below `Output/`, with the entries (relative to it)
    /// that could not be read: what was recorded below one is unknown, not
    /// removed.
    Walked { files: Vec<ScannedOutput>, unreadable: Vec<NativePath> },
    /// The Project folder is there and holds no `Output/`.
    Absent,
    /// `Output/`, or the Project folder holding it, could not be read.
    Unreadable,
}

/// One pass over a Project's `Output/`.
#[derive(Clone, Debug)]
pub struct OutputScan {
    pub project_id: Uuid,
    /// [`OutputBasis::copies`] as the pass read it.
    pub copies: u64,
    pub folder: OutputFolder,
}

/// How [`Catalog::record_output_scan`] took a pass.
#[derive(Clone, Debug)]
pub enum OutputScanRecord {
    /// Recorded; the Project's Output as it now reads.
    Recorded(Vec<OutputObservation>),
    /// A Copy to Output started since the pass read its basis: nothing was
    /// written, and the caller walks again.
    Stale,
}

/// A Copy to Output reserved and journaled, not yet listed.
#[derive(Clone, Debug)]
pub struct OutputCopy {
    pub operation_id: Uuid,
    pub project_id: Uuid,
    pub storage_operation_id: Uuid,
    /// What the Output step lists once the copy verifies.
    pub planned: OutputObservation,
}

impl Catalog {
    /// The open Projects with a processing location: the ones whose
    /// `Output/` and `Processing/` the watcher follows. Read-only.
    ///
    /// # Errors
    /// `PersistenceFailure` for a corrupt record.
    pub async fn output_projects(&self) -> Result<Vec<Uuid>> {
        let mut conn = self.reader().await?;
        let ids: Vec<String> = sqlx::query_scalar(
            "SELECT id FROM projects WHERE lifecycle = 'open' AND processing_parent IS NOT NULL \
             ORDER BY created_at, id",
        )
        .fetch_all(&mut *conn)
        .await?;
        ids.iter().map(|id| parse_uuid(id)).collect()
    }

    /// The basis of one Output pass over `project_id`. Read-only.
    ///
    /// # Errors
    /// `NotFound` for an unknown Project; `PersistenceFailure` for a corrupt
    /// record.
    pub async fn output_basis(&self, project_id: Uuid) -> Result<OutputBasis> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let lifecycle = lifecycle(&mut snapshot, project_id).await?;
        let (name, parent): (String, Option<String>) =
            sqlx::query_as("SELECT name, processing_parent FROM projects WHERE id = ?1")
                .bind(project_id.to_string())
                .fetch_one(&mut *snapshot)
                .await?;
        let parent = parent.map(|parent| from_json(&parent)).transpose()?;
        let (copies, copying) = copies(&mut snapshot, project_id).await?;
        let rows = sqlx::query(
            "SELECT id, name FROM project_groups WHERE project_id = ?1 AND panel = 1 \
             ORDER BY position, id",
        )
        .bind(project_id.to_string())
        .fetch_all(&mut *snapshot)
        .await?;
        let panels = rows
            .iter()
            .map(|row| {
                Ok(OutputPanel {
                    group_id: parse_uuid(&row.try_get::<String, _>("id")?)?,
                    name: GroupName::new(&row.try_get::<String, _>("name")?)?,
                })
            })
            .collect::<Result<_>>()?;
        let recorded = recorded(&mut snapshot, project_id).await?;
        snapshot.commit().await?;
        Ok(OutputBasis { project_id, lifecycle, name, parent, copies, copying, panels, recorded })
    }

    /// The Project's Output step: every file recorded in its `Output/`, by
    /// path. Read-only.
    ///
    /// # Errors
    /// `NotFound` for an unknown Project.
    pub async fn project_outputs(&self, project_id: Uuid) -> Result<Vec<OutputObservation>> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        lifecycle(&mut snapshot, project_id).await?;
        let outputs = recorded(&mut snapshot, project_id).await?;
        snapshot.commit().await?;
        Ok(outputs)
    }

    /// Record one pass over the Project's `Output/` (RES-FR-01): a found file
    /// takes its state, size, fingerprint and panel, keeping the Kind and
    /// Channel the user chose; a new one is listed as Observed; a recorded one
    /// the pass did not find leaves the table, unless it lies below an entry
    /// that could not be read, which reads Unreadable. A copied file whose
    /// bytes changed is no longer the verified copy and reads Observed. A
    /// Project that is not open records nothing.
    ///
    /// # Errors
    /// `NotFound` for an unknown Project; `InvalidInput` once it is not open,
    /// or for a file outside `Output/` or a panel outside its panel folder.
    pub async fn record_output_scan(&self, scan: &OutputScan) -> Result<OutputScanRecord> {
        let at = now()?;
        let record = write_txn!(self, |conn| {
            require_open(conn, scan.project_id).await?;
            let (copies, copying) = copies(conn, scan.project_id).await?;
            if copying || copies != scan.copies {
                OutputScanRecord::Stale
            } else {
                apply_scan(conn, scan, &at).await?;
                OutputScanRecord::Recorded(recorded(conn, scan.project_id).await?)
            }
        });
        Ok(record)
    }

    /// Set the Kind and Channel of the file at `path` in `Output/` (RES-AC-24);
    /// nothing else of it changes and nothing asks for acceptance.
    ///
    /// # Errors
    /// `NotFound` for an unknown Project or a path not listed; `InvalidInput`
    /// once the Project is not open, or for a blank Channel.
    pub async fn set_output_details(
        &self,
        project_id: Uuid,
        path: &NativePath,
        kind: Option<OutputKind>,
        channel: Option<String>,
    ) -> Result<OutputObservation> {
        let observation = write_txn!(self, |conn| {
            require_open(conn, project_id).await?;
            let mut observation = load(conn, project_id, path).await?.ok_or_else(|| {
                LibraryError::NotFound(format!("{} in the Project's Output/", path.display()))
            })?;
            observation.kind = kind;
            observation.channel = channel;
            observation.validate()?;
            update(conn, project_id, &observation, None).await?;
            observation
        });
        Ok(observation)
    }

    /// Reserve the Project for one Copy to Output (RES-FR-02, RES-FR-07) and
    /// record its copy of the reviewed `source` in the storage journal, in one
    /// transaction. `planned` is what the Output step lists once the copy's
    /// re-read matches the source's SHA-256; a copy of a master the Project
    /// offered from `Processing/` is prefilled as that calibration master.
    /// Nothing on disk changes.
    ///
    /// # Errors
    /// `NotFound` for an unknown Project; `InvalidInput` naming the running
    /// operation, for a Project that is not open, for a destination already
    /// listed or being copied to (nothing is overwritten), or for a planned
    /// observation that is not the source's verified copy.
    pub async fn begin_output_copy(
        &self,
        project_id: Uuid,
        source: &EntryEvidence,
        destination: &TransferDestination,
        planned: &OutputObservation,
    ) -> Result<OutputCopy> {
        if planned.origin != OutputOrigin::Copied
            || planned.sha256.is_none()
            || planned.sha256 != source.sha256
            || planned.fingerprint.is_some()
        {
            return Err(invalid("a Copy to Output lists the source's verified copy"));
        }
        planned.validate()?;
        let copy = write_txn!(self, |conn| {
            let operation =
                reserve_operation(conn, project_id, ProjectOperationKind::CopyToOutput).await?;
            if load(conn, project_id, &planned.path).await?.is_some() {
                return Err(invalid(format!(
                    "Output/{} already exists; choose another name",
                    planned.path.display()
                )));
            }
            let mut planned = planned.clone();
            if planned.kind.is_none() {
                planned.kind = offered_master(conn, project_id, planned.sha256.as_deref()).await?;
            }
            let draft = StorageItemDraft {
                source: source.clone(),
                relied_on: Vec::new(),
                destination: Some(destination.clone()),
            };
            let storage_operation_id =
                insert_operation(conn, StorageOperationKind::Copy, &[draft]).await?;
            sqlx::query(
                "INSERT INTO output_copies (operation_id, project_id, storage_operation_id, \
                 path_key, observation) VALUES (?1, ?2, ?3, ?4, ?5)",
            )
            .bind(operation.id.to_string())
            .bind(project_id.to_string())
            .bind(storage_operation_id.to_string())
            .bind(path_key(&planned.path))
            .bind(to_json(&planned)?)
            .execute(&mut *conn)
            .await?;
            OutputCopy { operation_id: operation.id, project_id, storage_operation_id, planned }
        });
        Ok(copy)
    }

    /// Settle Copy to Output `operation_id` once its storage operation has
    /// settled: a verified copy, `installed` as the destination now reads,
    /// joins the Output step as Copied with the source's digest; a blocked
    /// one lists nothing. The record of the copy then goes, and the Project's
    /// operation settles.
    ///
    /// # Errors
    /// `NotFound` for an unknown copy; `InvalidInput` while its storage
    /// operation runs, or for a verified copy without its installed
    /// fingerprint.
    pub async fn finish_output_copy(
        &self,
        operation_id: Uuid,
        installed: Option<&ObservationFingerprint>,
    ) -> Result<Option<OutputObservation>> {
        let at = now()?;
        let listed = write_txn!(self, |conn| {
            let copy = load_copy(conn, operation_id).await?;
            let outcome: Option<(String, Option<String>)> = sqlx::query_as(
                "SELECT o.state, i.outcome FROM storage_operations o \
                 JOIN storage_items i ON i.op_id = o.id WHERE o.id = ?1 AND i.seq = 0",
            )
            .bind(copy.storage_operation_id.to_string())
            .fetch_optional(&mut *conn)
            .await?;
            let Some((state, outcome)) = outcome else {
                return Err(LibraryError::PersistenceFailure(format!(
                    "Copy to Output {operation_id} names no storage item"
                )));
            };
            if state != "settled" {
                return Err(invalid(format!("Copy to Output {operation_id} is still copying")));
            }
            let listed = if outcome.as_deref() == Some("copied") {
                let installed = installed.ok_or_else(|| {
                    invalid("a verified copy is listed with its installed fingerprint")
                })?;
                let mut observation = copy.planned.clone();
                observation.size_bytes = installed.size_bytes;
                observation.fingerprint = Some(installed.clone());
                observation.state = OutputState::Settled;
                observation.validate()?;
                upsert(conn, copy.project_id, &observation, &at).await?;
                Some(observation)
            } else {
                None
            };
            sqlx::query("DELETE FROM output_copies WHERE operation_id = ?1")
                .bind(operation_id.to_string())
                .execute(&mut *conn)
                .await?;
            settle_operation(conn, operation_id).await?;
            listed
        });
        Ok(listed)
    }

    /// Every Copy to Output an earlier process left unsettled, oldest first.
    ///
    /// # Errors
    /// `PersistenceFailure` for a corrupt record.
    pub async fn unfinished_output_copies(&self) -> Result<Vec<OutputCopy>> {
        let mut conn = self.reader().await?;
        let ids: Vec<String> = sqlx::query_scalar(
            "SELECT c.operation_id FROM output_copies c \
             JOIN project_operations o ON o.id = c.operation_id ORDER BY o.reserved_at, o.id",
        )
        .fetch_all(&mut *conn)
        .await?;
        let mut copies = Vec::with_capacity(ids.len());
        for id in ids {
            copies.push(load_copy(&mut conn, parse_uuid(&id)?).await?);
        }
        Ok(copies)
    }

    /// Hand a generated master found at `path` in the Project's `Processing/`
    /// to CAL's once-only offer (RES-FR-11, CAL-FR-06): offered when the
    /// Project has never offered its digest, whatever path a rerun wrote it
    /// to. Returns the new offer, or `None` when the digest was offered before.
    ///
    /// # Errors
    /// `NotFound` for an unknown Project; `InvalidInput` once it is not open,
    /// or for a file that is not a master.
    pub async fn offer_processing_master(
        &self,
        project_id: Uuid,
        path: &NativePath,
        sha256: &str,
        classification: &Classification,
    ) -> Result<Option<ProcessingMasterOffer>> {
        let offer = ProcessingMasterOffer {
            id: Uuid::new_v4(),
            project_id,
            path: path.clone(),
            sha256: sha256.to_owned(),
            classification: classification.clone(),
            state: MasterOfferState::Offered,
            offered_at: now()?,
            decided_at: None,
        };
        offer.validate()?;
        let inserted = write_txn!(self, |conn| {
            require_open(conn, project_id).await?;
            sqlx::query(
                "INSERT INTO processing_master_offers (id, project_id, path_key, sha256, kind, \
                 offer, state, offered_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'offered', ?7) \
                 ON CONFLICT (project_id, sha256) DO NOTHING",
            )
            .bind(offer.id.to_string())
            .bind(project_id.to_string())
            .bind(path_key(path))
            .bind(sha256)
            .bind(to_text(&classification.kind)?)
            .bind(to_json(&offer)?)
            .bind(&offer.offered_at)
            .execute(&mut *conn)
            .await?
            .rows_affected()
                == 1
        });
        Ok(inserted.then_some(offer))
    }

    /// Every master the Project's `Processing/` offered, in the order found:
    /// the Output step's Add to calibration library rows (RES-AC-15).
    /// Read-only.
    ///
    /// # Errors
    /// `NotFound` for an unknown Project.
    pub async fn processing_master_offers(
        &self,
        project_id: Uuid,
    ) -> Result<Vec<ProcessingMasterOffer>> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        lifecycle(&mut snapshot, project_id).await?;
        let offers: Vec<String> = sqlx::query_scalar(
            "SELECT offer FROM processing_master_offers WHERE project_id = ?1 \
             ORDER BY offered_at, id",
        )
        .bind(project_id.to_string())
        .fetch_all(&mut *snapshot)
        .await?;
        snapshot.commit().await?;
        offers.iter().map(|offer| from_json(offer)).collect()
    }
}

async fn lifecycle(conn: &mut SqliteConnection, project_id: Uuid) -> Result<ProjectLifecycle> {
    let lifecycle: Option<String> =
        sqlx::query_scalar("SELECT lifecycle FROM projects WHERE id = ?1")
            .bind(project_id.to_string())
            .fetch_optional(&mut *conn)
            .await?;
    from_text(&lifecycle.ok_or_else(|| LibraryError::NotFound(format!("project {project_id}")))?)
}

async fn require_open(conn: &mut SqliteConnection, project_id: Uuid) -> Result<()> {
    let lifecycle = lifecycle(conn, project_id).await?;
    if lifecycle.is_open() {
        Ok(())
    } else {
        Err(invalid(format!("a {lifecycle} Project's Output is read-only")))
    }
}

/// How many Copy to Output operations the Project recorded, and whether one
/// is running.
async fn copies(conn: &mut SqliteConnection, project_id: Uuid) -> Result<(u64, bool)> {
    let (count, active): (i64, i64) = sqlx::query_as(
        "SELECT COUNT(*), COALESCE(SUM(state = 'active'), 0) FROM project_operations \
         WHERE project_id = ?1 AND kind = 'copy_to_output'",
    )
    .bind(project_id.to_string())
    .fetch_one(&mut *conn)
    .await?;
    let count = u64::try_from(count)
        .map_err(|_| LibraryError::PersistenceFailure("negative operation count".into()))?;
    Ok((count, active > 0))
}

async fn recorded(conn: &mut SqliteConnection, project_id: Uuid) -> Result<Vec<OutputObservation>> {
    let rows: Vec<String> =
        sqlx::query_scalar("SELECT observation FROM project_outputs WHERE project_id = ?1")
            .bind(project_id.to_string())
            .fetch_all(&mut *conn)
            .await?;
    let mut outputs = rows.iter().map(|row| from_json(row)).collect::<Result<Vec<_>>>()?;
    outputs.sort_by_key(|output: &OutputObservation| output.path.display());
    Ok(outputs)
}

async fn load(
    conn: &mut SqliteConnection,
    project_id: Uuid,
    path: &NativePath,
) -> Result<Option<OutputObservation>> {
    let row: Option<String> = sqlx::query_scalar(
        "SELECT observation FROM project_outputs WHERE project_id = ?1 AND path_key = ?2",
    )
    .bind(project_id.to_string())
    .bind(path_key(path))
    .fetch_optional(&mut *conn)
    .await?;
    row.map(|row| from_json(&row)).transpose()
}

async fn load_copy(conn: &mut SqliteConnection, operation_id: Uuid) -> Result<OutputCopy> {
    let row = sqlx::query(
        "SELECT project_id, storage_operation_id, observation FROM output_copies \
         WHERE operation_id = ?1",
    )
    .bind(operation_id.to_string())
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| LibraryError::NotFound(format!("Copy to Output {operation_id}")))?;
    Ok(OutputCopy {
        operation_id,
        project_id: parse_uuid(&row.try_get::<String, _>("project_id")?)?,
        storage_operation_id: parse_uuid(&row.try_get::<String, _>("storage_operation_id")?)?,
        planned: from_json(&row.try_get::<String, _>("observation")?)?,
    })
}

/// The calibration master the Project offered with digest `sha256`, as a Kind.
async fn offered_master(
    conn: &mut SqliteConnection,
    project_id: Uuid,
    sha256: Option<&str>,
) -> Result<Option<OutputKind>> {
    let kind: Option<String> = sqlx::query_scalar(
        "SELECT kind FROM processing_master_offers WHERE project_id = ?1 AND sha256 = ?2",
    )
    .bind(project_id.to_string())
    .bind(sha256)
    .fetch_optional(&mut *conn)
    .await?;
    kind.map(|kind| Ok(OutputKind::CalibrationMaster { input: from_text(&kind)? })).transpose()
}

async fn apply_scan(conn: &mut SqliteConnection, scan: &OutputScan, at: &str) -> Result<()> {
    let project_id = scan.project_id;
    let existing = recorded(conn, project_id).await?;
    let (files, unreadable) = match &scan.folder {
        OutputFolder::Walked { files, unreadable } => (files.as_slice(), unreadable.as_slice()),
        OutputFolder::Absent => (&[][..], &[][..]),
        OutputFolder::Unreadable => {
            for mut observation in existing {
                if observation.state != OutputState::Unreadable {
                    observation.state = OutputState::Unreadable;
                    update(conn, project_id, &observation, Some(at)).await?;
                }
            }
            return Ok(());
        }
    };
    let unknown = unreadable.iter().map(NativePath::relative_path).collect::<Result<Vec<_>>>()?;
    for file in files {
        let found = existing.iter().find(|recorded| recorded.path == file.path);
        let observation = observed(found, file);
        observation.validate()?;
        match found {
            Some(recorded) if *recorded == observation => {}
            Some(_) => update(conn, project_id, &observation, Some(at)).await?,
            None => upsert(conn, project_id, &observation, at).await?,
        }
    }
    for mut observation in existing {
        if files.iter().any(|file| file.path == observation.path) {
            continue;
        }
        if below_any(&observation.path.relative_path()?, &unknown) {
            if observation.state != OutputState::Unreadable {
                observation.state = OutputState::Unreadable;
                update(conn, project_id, &observation, Some(at)).await?;
            }
        } else {
            sqlx::query("DELETE FROM project_outputs WHERE project_id = ?1 AND path_key = ?2")
                .bind(project_id.to_string())
                .bind(path_key(&observation.path))
                .execute(&mut *conn)
                .await?;
        }
    }
    Ok(())
}

/// A found file as it now reads: a recorded one keeps the user's Kind and
/// Channel, and its verified digest while its bytes are the copy's.
fn observed(recorded: Option<&OutputObservation>, file: &ScannedOutput) -> OutputObservation {
    let (kind, channel) =
        recorded.map_or((None, None), |recorded| (recorded.kind.clone(), recorded.channel.clone()));
    let copied = recorded.filter(|recorded| {
        recorded.origin == OutputOrigin::Copied
            && file.fingerprint.is_some()
            && recorded.fingerprint == file.fingerprint
    });
    OutputObservation {
        path: file.path.clone(),
        kind,
        channel,
        panel_group_id: file.panel_group_id,
        state: file.state,
        size_bytes: file.size_bytes,
        fingerprint: file.fingerprint.clone(),
        sha256: copied.and_then(|recorded| recorded.sha256.clone()),
        origin: copied.map_or(OutputOrigin::Observed, |_| OutputOrigin::Copied),
    }
}

fn below_any(path: &Path, folders: &[PathBuf]) -> bool {
    folders.iter().any(|folder| path.starts_with(folder))
}

/// Insert `observation`, or replace the row recorded at its path, keeping
/// when it was first seen.
async fn upsert(
    conn: &mut SqliteConnection,
    project_id: Uuid,
    observation: &OutputObservation,
    at: &str,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO project_outputs (project_id, path_key, observation, state, origin, \
         panel_group_id, sha256, first_seen_at, last_observed_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8) \
         ON CONFLICT (project_id, path_key) DO UPDATE SET observation = excluded.observation, \
         state = excluded.state, origin = excluded.origin, \
         panel_group_id = excluded.panel_group_id, sha256 = excluded.sha256, \
         last_observed_at = excluded.last_observed_at",
    )
    .bind(project_id.to_string())
    .bind(path_key(&observation.path))
    .bind(to_json(observation)?)
    .bind(to_text(&observation.state)?)
    .bind(to_text(&observation.origin)?)
    .bind(observation.panel_group_id.map(|id| id.to_string()))
    .bind(observation.sha256.as_deref())
    .bind(at)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Rewrite the row recorded at `observation`'s path; `observed_at` when a
/// pass observed it.
async fn update(
    conn: &mut SqliteConnection,
    project_id: Uuid,
    observation: &OutputObservation,
    observed_at: Option<&str>,
) -> Result<()> {
    sqlx::query(
        "UPDATE project_outputs SET observation = ?3, state = ?4, origin = ?5, \
         panel_group_id = ?6, sha256 = ?7, last_observed_at = coalesce(?8, last_observed_at) \
         WHERE project_id = ?1 AND path_key = ?2",
    )
    .bind(project_id.to_string())
    .bind(path_key(&observation.path))
    .bind(to_json(observation)?)
    .bind(to_text(&observation.state)?)
    .bind(to_text(&observation.origin)?)
    .bind(observation.panel_group_id.map(|id| id.to_string()))
    .bind(observation.sha256.as_deref())
    .bind(observed_at)
    .execute(&mut *conn)
    .await?;
    Ok(())
}
