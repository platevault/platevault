// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Wrap up's catalog side (spec 065 PRJ-FR-14/15/25, 071 STO-FR-01/04/06/13
//! to STO-FR-16; D-W43, D-W80, D-W97, D-W111, D-W112): where a Project's
//! Wrap up stands, each step's record and operation, what Trash and Archive
//! read, Close's transaction with its snapshot, and the archive moves and
//! kept-View repoints, written in the order `project_lifecycle.sql` and
//! `project_wrap_up.sql` expect.
//!
//! Wrap up opens under [`ClosePolicy::CURRENT`]: on an open Project with no
//! pending change and no running operation. Each step is recorded once, in
//! order, and reopening one removes it with the later ones. Close records
//! the Archive step, the Closed snapshot and the lifecycle in one
//! transaction; the archive itself runs after, while the Project reads
//! Closing, and settles it Archived, or Closed when nothing moved.
//!
//! The catalog only records; core re-verifies and moves the files through
//! the storage journal.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use platevault_model::{
    counts_as_confirmed, ApplicableQuality, ArchiveFile, ArchiveMove, ArchiveMoveOutcome,
    ArchiveProgress, Asset, AssociationState, Availability, ClosePolicy, ClosedSnapshot,
    EvidenceItem, FileIdentity, ItemReason, KeptViewLink, LibraryError, Location, ManifestEntry,
    MeasurementMethod, NativePath, ObservationFingerprint, ProjectLifecycle, ProjectOperation,
    ProjectOperationKind, Revision, SettledPin, StorageItemDraft, StorageOperationKind, TrashGroup,
    WrapUpBlocker, WrapUpOutcome, WrapUpRecord, WrapUpStatus, WrapUpStep,
};
use sqlx::sqlite::{SqliteConnection, SqliteRow};
use sqlx::{Connection, Row};
use uuid::Uuid;

use super::{
    admission, asset_from_row, capture_quality, db_size, fingerprint_matches, from_json, from_text,
    json_ids, load_asset, load_assets, logical_captures, now, parse_uuid, path_from_key, path_key,
    project_inputs, project_operations, project_view, projects, rebind_association_bases,
    require_revision, revision, storage, to_json, to_text, Catalog, Result,
};

fn invalid(message: impl Into<String>) -> LibraryError {
    LibraryError::InvalidInput(message.into())
}

fn corrupt(what: &str) -> LibraryError {
    LibraryError::PersistenceFailure(format!("corrupt record: {what}"))
}

const fn step_label(step: WrapUpStep) -> &'static str {
    match step {
        WrapUpStep::CleanUp => "Clean up",
        WrapUpStep::Trash => "Trash",
        WrapUpStep::Archive => "Archive",
    }
}

/// The refusal a [`WrapUpBlocker`] reads as.
fn blocked(blocker: &WrapUpBlocker) -> LibraryError {
    invalid(match blocker {
        WrapUpBlocker::NotOpen { lifecycle } => {
            format!("a {lifecycle} Project is locked; its Wrap up is a read-only record")
        }
        WrapUpBlocker::PendingChanges { count } => {
            format!("Apply or discard {count} changes first")
        }
        WrapUpBlocker::OperationRunning { kind } => {
            format!(
                "a {} operation is running on this Project; wait for it to finish",
                match kind {
                    ProjectOperationKind::Apply => "Apply",
                    ProjectOperationKind::CopyToOutput => "Copy to Output",
                    ProjectOperationKind::CleanUp => "Clean up",
                    ProjectOperationKind::Trash => "Trash",
                    ProjectOperationKind::Archive => "Archive",
                }
            )
        }
    })
}

// ── Status and steps ─────────────────────────────────────────────────────────

impl Catalog {
    /// Where Project `project_id`'s Wrap up stands, from one snapshot.
    ///
    /// # Errors
    /// `NotFound` for an unknown Project; `PersistenceFailure` for a corrupt
    /// record.
    pub async fn wrap_up_status(&self, project_id: Uuid) -> Result<WrapUpStatus> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let status = read_status(&mut snapshot, project_id).await?;
        snapshot.rollback().await?;
        Ok(status)
    }

    /// Reopen `step` from the step strip: it and every later step are no
    /// longer recorded, back to front. Only while the Project is open and
    /// nothing runs on it.
    ///
    /// # Errors
    /// `InvalidInput` for a Project that is not open or one an operation
    /// runs on; `NotFound` for an unknown Project.
    pub async fn reopen_wrap_up_step(
        &self,
        project_id: Uuid,
        step: WrapUpStep,
    ) -> Result<WrapUpStatus> {
        Ok(write_txn!(self, |conn| {
            let status = read_status(conn, project_id).await?;
            if let Some(
                blocker @ (WrapUpBlocker::NotOpen { .. } | WrapUpBlocker::OperationRunning { .. }),
            ) = &status.blocker
            {
                return Err(blocked(blocker));
            }
            for later in WrapUpStep::ORDER.iter().rev().filter(|later| **later >= step) {
                sqlx::query(
                    "DELETE FROM project_wrap_up_steps WHERE project_id = ?1 AND step = ?2",
                )
                .bind(project_id.to_string())
                .bind(to_text(later)?)
                .execute(&mut *conn)
                .await?;
            }
            read_status(conn, project_id).await?
        }))
    }

    /// Record Clean up or Trash proceeding with nothing to move: Skipped when
    /// the user selected nothing, Finished when the step had nothing left to
    /// offer. Archive is recorded by Close.
    ///
    /// # Errors
    /// `Conflict` for a stale Project revision; `InvalidInput` while Wrap up
    /// doesn't open, out of order, or for Archive.
    pub async fn record_wrap_up_step(
        &self,
        project_id: Uuid,
        expected: Revision,
        step: WrapUpStep,
        outcome: WrapUpOutcome,
    ) -> Result<WrapUpRecord> {
        if step == WrapUpStep::Archive {
            return Err(invalid("Archive's Proceed is Close project…"));
        }
        Ok(write_txn!(self, |conn| {
            require_step(conn, project_id, step, expected).await?;
            insert_record(conn, project_id, step, outcome, None).await?
        }))
    }
}

async fn read_status(conn: &mut SqliteConnection, project_id: Uuid) -> Result<WrapUpStatus> {
    let row = sqlx::query("SELECT lifecycle, revision FROM projects WHERE id = ?1")
        .bind(project_id.to_string())
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| LibraryError::NotFound(format!("project {project_id}")))?;
    let lifecycle: ProjectLifecycle = from_text(&row.try_get::<String, _>("lifecycle")?)?;
    let desired_revision = revision(row.try_get("revision")?)?;
    let records = read_records(conn, project_id).await?;
    let blocker = if lifecycle.is_open() {
        let running = project_operations::active_operation(conn, project_id).await?;
        let pending = project_inputs::pending_changes(conn, project_id).await?.len();
        if ClosePolicy::CURRENT.wrap_up_opens(pending, running.is_some()) {
            None
        } else if let Some(operation) = running {
            Some(WrapUpBlocker::OperationRunning { kind: operation.kind })
        } else {
            Some(WrapUpBlocker::PendingChanges { count: pending })
        }
    } else {
        Some(WrapUpBlocker::NotOpen { lifecycle })
    };
    let current = if lifecycle.is_open() {
        WrapUpStep::ORDER.into_iter().find(|step| records.iter().all(|record| record.step != *step))
    } else {
        None
    };
    Ok(WrapUpStatus { project_id, lifecycle, desired_revision, blocker, records, current })
}

async fn read_records(conn: &mut SqliteConnection, project_id: Uuid) -> Result<Vec<WrapUpRecord>> {
    let rows = sqlx::query(
        "SELECT step, outcome, operation_id, recorded_at FROM project_wrap_up_steps \
         WHERE project_id = ?1 ORDER BY CASE step WHEN 'clean_up' THEN 0 WHEN 'trash' THEN 1 \
         ELSE 2 END",
    )
    .bind(project_id.to_string())
    .fetch_all(&mut *conn)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(WrapUpRecord {
                step: from_text(&row.try_get::<String, _>("step")?)?,
                outcome: from_text(&row.try_get::<String, _>("outcome")?)?,
                operation_id: row
                    .try_get::<Option<String>, _>("operation_id")?
                    .as_deref()
                    .map(parse_uuid)
                    .transpose()?,
                recorded_at: row.try_get("recorded_at")?,
            })
        })
        .collect()
}

async fn insert_record(
    conn: &mut SqliteConnection,
    project_id: Uuid,
    step: WrapUpStep,
    outcome: WrapUpOutcome,
    operation_id: Option<Uuid>,
) -> Result<WrapUpRecord> {
    let record = WrapUpRecord { step, outcome, operation_id, recorded_at: now()? };
    sqlx::query(
        "INSERT INTO project_wrap_up_steps (project_id, step, outcome, operation_id, recorded_at) \
         VALUES (?1, ?2, ?3, ?4, ?5)",
    )
    .bind(project_id.to_string())
    .bind(to_text(&step)?)
    .bind(to_text(&outcome)?)
    .bind(operation_id.map(|id| id.to_string()))
    .bind(&record.recorded_at)
    .execute(&mut *conn)
    .await?;
    Ok(record)
}

/// `step` may run now: Wrap up opens, the Project is still at `expected`,
/// and `step` is the current one.
async fn require_step(
    conn: &mut SqliteConnection,
    project_id: Uuid,
    step: WrapUpStep,
    expected: Revision,
) -> Result<WrapUpStatus> {
    let status = read_status(conn, project_id).await?;
    if let Some(blocker) = &status.blocker {
        return Err(blocked(blocker));
    }
    require_revision(project_id, status.desired_revision, expected)?;
    if status.current != Some(step) {
        let detail = if status.records.iter().any(|record| record.step == step) {
            format!("{} is recorded; reopen it from the step strip first", step_label(step))
        } else {
            format!(
                "Wrap up runs Clean up, Trash, then Archive; {} can't run yet",
                step_label(step)
            )
        };
        return Err(invalid(detail));
    }
    Ok(status)
}

/// Settle `operation` and record its step Finished, in the caller's
/// transaction, once the operation is still the Project's active one.
async fn finish_step(
    conn: &mut SqliteConnection,
    operation: &ProjectOperation,
    step: WrapUpStep,
) -> Result<WrapUpRecord> {
    let active = project_operations::active_operation(conn, operation.project_id).await?;
    if active.as_ref().map(|active| active.id) != Some(operation.id) {
        return Err(LibraryError::NotFound(format!("active Project operation {}", operation.id)));
    }
    let record = insert_record(
        conn,
        operation.project_id,
        step,
        WrapUpOutcome::Finished,
        Some(operation.id),
    )
    .await?;
    project_operations::settle_operation(conn, operation.id).await?;
    Ok(record)
}

// ── Clean up ─────────────────────────────────────────────────────────────────

impl Catalog {
    /// Reserve the Project for its Clean up (PREP-FR-19), before any file
    /// effect.
    ///
    /// # Errors
    /// As [`Catalog::record_wrap_up_step`]; `InvalidInput` naming a running
    /// operation.
    pub async fn begin_clean_up(
        &self,
        project_id: Uuid,
        expected: Revision,
    ) -> Result<ProjectOperation> {
        Ok(write_txn!(self, |conn| {
            require_step(conn, project_id, WrapUpStep::CleanUp, expected).await?;
            project_operations::reserve_operation(conn, project_id, ProjectOperationKind::CleanUp)
                .await?
        }))
    }

    /// Record that the running Clean up removed View entry `seq` of the
    /// installed `generation`: deleted (a link) or trashed (a copy).
    ///
    /// # Errors
    /// `PersistenceFailure` when the schema refuses it: not the Project's
    /// running Clean up, or an entry already removed.
    pub async fn record_view_entry_removal(
        &self,
        operation: &ProjectOperation,
        generation: Revision,
        seq: u32,
        trashed: bool,
    ) -> Result<()> {
        write_txn!(self, |conn| {
            sqlx::query(
                "INSERT INTO view_entry_removals (project_id, generation, seq, operation_id, \
                 outcome, removed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            )
            .bind(operation.project_id.to_string())
            .bind(super::db_revision(generation)?)
            .bind(i64::from(seq))
            .bind(operation.id.to_string())
            .bind(if trashed { "trashed" } else { "deleted" })
            .bind(now()?)
            .execute(&mut *conn)
            .await?;
        });
        Ok(())
    }

    /// The seqs of manifest `generation` that Clean up removed.
    ///
    /// # Errors
    /// `PersistenceFailure` for a corrupt record.
    pub async fn view_entry_removals(
        &self,
        project_id: Uuid,
        generation: Revision,
    ) -> Result<BTreeSet<u32>> {
        let mut conn = self.reader().await?;
        removed_seqs(&mut conn, project_id, generation).await
    }

    /// Finish the running Clean up: retire the installed manifest when its
    /// `View/` is gone, record the step Finished and settle the operation,
    /// in one transaction.
    ///
    /// # Errors
    /// `NotFound` unless `operation` is the Project's active one.
    pub async fn finish_clean_up(
        &self,
        operation: &ProjectOperation,
        view_gone: bool,
    ) -> Result<WrapUpRecord> {
        Ok(write_txn!(self, |conn| {
            if view_gone {
                sqlx::query(
                    "UPDATE view_manifests SET state = 'retired' WHERE project_id = ?1 \
                     AND state = 'installed'",
                )
                .bind(operation.project_id.to_string())
                .execute(&mut *conn)
                .await?;
            }
            finish_step(conn, operation, WrapUpStep::CleanUp).await?
        }))
    }
}

async fn removed_seqs(
    conn: &mut SqliteConnection,
    project_id: Uuid,
    generation: Revision,
) -> Result<BTreeSet<u32>> {
    let seqs: Vec<i64> = sqlx::query_scalar(
        "SELECT seq FROM view_entry_removals WHERE project_id = ?1 AND generation = ?2",
    )
    .bind(project_id.to_string())
    .bind(super::db_revision(generation)?)
    .fetch_all(&mut *conn)
    .await?;
    seqs.into_iter().map(|seq| u32::try_from(seq).map_err(|_| corrupt("removal seq"))).collect()
}

// ── Trash ────────────────────────────────────────────────────────────────────

/// One frame of the Project the Trash step reads: a held light capture
/// (D16) or a raw calibration frame its sessions' pins use, with every
/// byte-identical live copy in an active location, Missing ones included.
#[derive(Clone, Debug)]
pub struct WrapUpFrame {
    /// A light's capture key, or the calibration frame's asset id.
    pub key: Uuid,
    pub light: bool,
    /// The capture's applicable library quality.
    pub quality: ApplicableQuality,
    pub copies: Vec<Asset>,
}

/// What the Trash step reads, in one catalog snapshot.
#[derive(Clone, Debug)]
pub struct TrashBasis {
    pub project_id: Uuid,
    pub name: String,
    pub desired_revision: Revision,
    pub parent: Option<NativePath>,
    pub frames: Vec<WrapUpFrame>,
    /// Every registered location, earliest registered first.
    pub locations: Vec<Location>,
    /// The copies another open Project's View places, with its names.
    pub in_open_views: BTreeMap<Uuid, Vec<String>>,
    /// Each copy's first observation id: the copy catalogued first wins a
    /// tie for the kept copy (D-W116).
    pub first_observed: BTreeMap<Uuid, i64>,
}

/// One item a Trash step journals.
#[derive(Clone, Debug)]
pub struct TrashItemDraft {
    pub group: TrashGroup,
    /// The frame's capture key or the duplicate copy's asset id.
    pub item_id: Option<Uuid>,
    /// The library copy it moves.
    pub asset_id: Option<Uuid>,
    pub draft: StorageItemDraft,
}

/// A journaled Trash item and whether the catalog took its outcome.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WrapUpTrashItem {
    pub seq: u32,
    pub group: TrashGroup,
    pub item_id: Option<Uuid>,
    pub asset_id: Option<Uuid>,
    pub recorded: bool,
}

/// A Trash step's journal: its Project operation and storage operation.
#[derive(Clone, Debug)]
pub struct WrapUpTrash {
    pub operation: ProjectOperation,
    pub storage_operation_id: Uuid,
    pub items: Vec<WrapUpTrashItem>,
}

impl Catalog {
    /// What the Trash step of Project `project_id` reads.
    ///
    /// # Errors
    /// `NotFound` for an unknown Project; `PersistenceFailure` for a corrupt
    /// record.
    pub async fn trash_basis(&self, project_id: Uuid) -> Result<TrashBasis> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let basis = read_trash_basis(&mut snapshot, project_id).await?;
        snapshot.rollback().await?;
        Ok(basis)
    }

    /// Reserve the Project for its Trash step and journal the ticked rows'
    /// items, before any file effect, in one transaction.
    ///
    /// # Errors
    /// As [`Catalog::record_wrap_up_step`]; `InvalidInput` for no item.
    pub async fn begin_trash(
        &self,
        project_id: Uuid,
        expected: Revision,
        items: &[TrashItemDraft],
    ) -> Result<WrapUpTrash> {
        let storage_operation_id = write_txn!(self, |conn| {
            require_step(conn, project_id, WrapUpStep::Trash, expected).await?;
            let operation = project_operations::reserve_operation(
                conn,
                project_id,
                ProjectOperationKind::Trash,
            )
            .await?;
            let drafts: Vec<StorageItemDraft> =
                items.iter().map(|item| item.draft.clone()).collect();
            let storage =
                storage::insert_operation(conn, StorageOperationKind::Trash, &drafts).await?;
            for (seq, item) in items.iter().enumerate() {
                sqlx::query(
                    "INSERT INTO wrap_up_trash_items (storage_operation_id, seq, project_id, \
                     operation_id, trash_group, item_id, asset_id) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                )
                .bind(storage.to_string())
                .bind(i64::try_from(seq).map_err(|_| invalid("too many items to move"))?)
                .bind(project_id.to_string())
                .bind(operation.id.to_string())
                .bind(to_text(&item.group)?)
                .bind(item.item_id.map(|id| id.to_string()))
                .bind(item.asset_id.map(|id| id.to_string()))
                .execute(&mut *conn)
                .await?;
            }
            storage
        });
        self.wrap_up_trash(storage_operation_id).await
    }

    /// A Trash step's journal by its storage operation.
    ///
    /// # Errors
    /// `NotFound` for an operation no Trash step recorded.
    pub async fn wrap_up_trash(&self, storage_operation_id: Uuid) -> Result<WrapUpTrash> {
        let mut conn = self.reader().await?;
        read_trash(&mut conn, storage_operation_id).await
    }

    /// The Trash step a stop left running on an open Project, if any.
    ///
    /// # Errors
    /// `PersistenceFailure` for a corrupt record.
    pub async fn running_wrap_up_trashes(&self) -> Result<Vec<Uuid>> {
        let mut conn = self.reader().await?;
        let ids: Vec<String> = sqlx::query_scalar(
            "SELECT DISTINCT t.storage_operation_id FROM wrap_up_trash_items t \
             JOIN project_operations o ON o.id = t.operation_id WHERE o.state = 'active'",
        )
        .fetch_all(&mut *conn)
        .await?;
        ids.iter().map(|id| parse_uuid(id)).collect()
    }

    /// Note that the catalog took the Trashed outcome of items `seqs`.
    ///
    /// # Errors
    /// `PersistenceFailure` when the write cannot commit.
    pub async fn mark_wrap_up_trash_recorded(
        &self,
        storage_operation_id: Uuid,
        seqs: &[u32],
    ) -> Result<()> {
        write_txn!(self, |conn| {
            let at = now()?;
            for seq in seqs {
                sqlx::query(
                    "UPDATE wrap_up_trash_items SET recorded_at = ?3 \
                     WHERE storage_operation_id = ?1 AND seq = ?2 AND recorded_at IS NULL",
                )
                .bind(storage_operation_id.to_string())
                .bind(i64::from(*seq))
                .bind(&at)
                .execute(&mut *conn)
                .await?;
            }
        });
        Ok(())
    }

    /// Finish a Trash step whose journal settled: record the step Finished
    /// and settle the Project operation in one transaction.
    ///
    /// # Errors
    /// `NotFound` unless its operation is the Project's active one.
    pub async fn finish_trash(&self, trash: &WrapUpTrash) -> Result<WrapUpRecord> {
        Ok(write_txn!(self, |conn| finish_step(conn, &trash.operation, WrapUpStep::Trash).await?))
    }

    /// Settle a Project operation a stop left running whose own step
    /// recorded nothing more to do (a Clean up interrupted between files).
    ///
    /// # Errors
    /// `NotFound` unless `id` is an active operation.
    pub async fn settle_interrupted_operation(&self, id: Uuid) -> Result<()> {
        write_txn!(self, |conn| project_operations::settle_operation(conn, id).await?);
        Ok(())
    }

    /// The Clean up operations a stop left running.
    ///
    /// # Errors
    /// `PersistenceFailure` for a corrupt record.
    pub async fn running_clean_ups(&self) -> Result<Vec<Uuid>> {
        let mut conn = self.reader().await?;
        let ids: Vec<String> = sqlx::query_scalar(
            "SELECT id FROM project_operations WHERE kind = 'clean_up' AND state = 'active'",
        )
        .fetch_all(&mut *conn)
        .await?;
        ids.iter().map(|id| parse_uuid(id)).collect()
    }
}

async fn read_trash(
    conn: &mut SqliteConnection,
    storage_operation_id: Uuid,
) -> Result<WrapUpTrash> {
    let rows = sqlx::query(
        "SELECT seq, operation_id, trash_group, item_id, asset_id, recorded_at \
         FROM wrap_up_trash_items WHERE storage_operation_id = ?1 ORDER BY seq",
    )
    .bind(storage_operation_id.to_string())
    .fetch_all(&mut *conn)
    .await?;
    let first = rows
        .first()
        .ok_or_else(|| LibraryError::NotFound(format!("trash step {storage_operation_id}")))?;
    let operation_id = parse_uuid(&first.try_get::<String, _>("operation_id")?)?;
    let operation = read_operation(conn, operation_id).await?;
    let optional = |row: &SqliteRow, column: &str| -> Result<Option<Uuid>> {
        row.try_get::<Option<String>, _>(column)?.as_deref().map(parse_uuid).transpose()
    };
    let items = rows
        .iter()
        .map(|row| {
            Ok(WrapUpTrashItem {
                seq: u32::try_from(row.try_get::<i64, _>("seq")?).map_err(|_| corrupt("seq"))?,
                group: from_text(&row.try_get::<String, _>("trash_group")?)?,
                item_id: optional(row, "item_id")?,
                asset_id: optional(row, "asset_id")?,
                recorded: row.try_get::<Option<String>, _>("recorded_at")?.is_some(),
            })
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(WrapUpTrash { operation, storage_operation_id, items })
}

async fn read_operation(conn: &mut SqliteConnection, id: Uuid) -> Result<ProjectOperation> {
    let row = sqlx::query(
        "SELECT project_id, kind, state, reserved_at, settled_at FROM project_operations \
         WHERE id = ?1",
    )
    .bind(id.to_string())
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| LibraryError::NotFound(format!("Project operation {id}")))?;
    Ok(ProjectOperation {
        id,
        project_id: parse_uuid(&row.try_get::<String, _>("project_id")?)?,
        kind: from_text(&row.try_get::<String, _>("kind")?)?,
        state: from_text(&row.try_get::<String, _>("state")?)?,
        reserved_at: row.try_get("reserved_at")?,
        settled_at: row.try_get("settled_at")?,
    })
}

const fn live(asset: &Asset) -> bool {
    !matches!(asset.availability, Availability::Trashed | Availability::Retired)
}

/// Every live copy, in an active location, of these SHA-256 digests.
const SAME_BYTES: &str = asset_sql!(live
    "WHERE a.content_sha256 IN (SELECT value FROM json_each(?1)) AND l.lifecycle = 'active' \
     ORDER BY a.location_id, a.id"
);

/// The copies another open Project's installed or previous View places.
const IN_OPEN_VIEWS: &str = "SELECT DISTINCT e.asset_id, p.name FROM view_manifest_entries e \
     JOIN view_manifests m ON m.project_id = e.project_id AND m.generation = e.generation \
     JOIN projects p ON p.id = e.project_id \
     WHERE m.state IN ('installed', 'previous') AND p.lifecycle = 'open' AND p.id <> ?1 \
     AND e.asset_id IN (SELECT value FROM json_each(?2)) ORDER BY p.name";

async fn read_trash_basis(conn: &mut SqliteConnection, project_id: Uuid) -> Result<TrashBasis> {
    let inputs = project_view::read_inputs(conn, project_id).await?;
    let frames = project_frames(conn, project_id).await?;
    let all_copies: BTreeSet<Uuid> =
        frames.iter().flat_map(|frame| frame.copies.iter().map(|copy| copy.id)).collect();
    let mut in_open_views: BTreeMap<Uuid, Vec<String>> = BTreeMap::new();
    for row in sqlx::query(IN_OPEN_VIEWS)
        .bind(project_id.to_string())
        .bind(json_ids(&all_copies)?)
        .fetch_all(&mut *conn)
        .await?
    {
        in_open_views
            .entry(parse_uuid(&row.try_get::<String, _>("asset_id")?)?)
            .or_default()
            .push(row.try_get("name")?);
    }
    let mut first_observed = BTreeMap::new();
    for row in sqlx::query(
        "SELECT asset_id, min(id) AS first FROM observations \
         WHERE asset_id IN (SELECT value FROM json_each(?1)) GROUP BY asset_id",
    )
    .bind(json_ids(&all_copies)?)
    .fetch_all(&mut *conn)
    .await?
    {
        first_observed.insert(
            parse_uuid(&row.try_get::<String, _>("asset_id")?)?,
            row.try_get::<i64, _>("first")?,
        );
    }
    Ok(TrashBasis {
        project_id,
        name: inputs.name,
        desired_revision: inputs.desired_revision,
        parent: inputs.parent,
        frames,
        locations: registered_locations(conn).await?,
        in_open_views,
        first_observed,
    })
}

/// The Project's held light captures and the raw calibration frames its
/// sessions' pins use, each with every live byte-identical copy.
async fn project_frames(conn: &mut SqliteConnection, project_id: Uuid) -> Result<Vec<WrapUpFrame>> {
    let held = project_inputs::held_captures(conn, project_id).await?;
    let held_ids: BTreeSet<Uuid> =
        held.iter().flat_map(|held| held.capture.copies.iter().map(|copy| copy.asset_id)).collect();
    let held_assets: Vec<Asset> =
        load_assets(conn, &held_ids).await?.into_iter().filter(live).collect();
    let (key_of, logical) = logical_captures(conn, &held_assets).await?;
    let calibration = pinned_frames(conn, project_id).await?;
    let calibration_assets: Vec<Asset> =
        load_assets(conn, &calibration).await?.into_iter().filter(live).collect();
    let digests: BTreeSet<String> = held_assets
        .iter()
        .chain(&calibration_assets)
        .filter_map(|asset| asset.fingerprint.content_sha256.clone())
        .collect();
    let same_bytes = same_bytes(conn, &digests).await?;
    let mut frames = Vec::new();
    let mut seen_keys = BTreeSet::new();
    for capture in &held {
        let Some(key) = capture.capture.copies.iter().find_map(|copy| key_of.get(&copy.asset_id))
        else {
            continue;
        };
        if !seen_keys.insert(key.clone()) {
            continue;
        }
        let group: Vec<Asset> =
            logical.get(key).into_iter().flatten().filter(|asset| live(asset)).cloned().collect();
        if group.is_empty() {
            continue;
        }
        let quality = capture_quality(&group.iter().collect::<Vec<_>>());
        frames.push(WrapUpFrame {
            key: capture.capture.capture_key,
            light: true,
            quality,
            copies: with_bytes(&group, &same_bytes),
        });
    }
    for asset in &calibration_assets {
        let quality = capture_quality(&[asset]);
        frames.push(WrapUpFrame {
            key: asset.id,
            light: false,
            quality,
            copies: with_bytes(std::slice::from_ref(asset), &same_bytes),
        });
    }
    Ok(frames)
}

/// The raw calibration frames the settled pins of the Project's sessions use.
async fn pinned_frames(conn: &mut SqliteConnection, project_id: Uuid) -> Result<BTreeSet<Uuid>> {
    let mut frames = BTreeSet::new();
    for session in project_desired_sessions(conn, project_id).await? {
        let Some(settled) = admission::read_calibration(conn, session).await?.settled() else {
            continue;
        };
        for pin in [&settled.dark, &settled.flat, &settled.bias] {
            if let SettledPin::Pinned { target } = pin {
                frames.extend(target.files.iter().filter_map(|file| file.asset_id));
            }
        }
    }
    Ok(frames)
}

async fn same_bytes(conn: &mut SqliteConnection, digests: &BTreeSet<String>) -> Result<Vec<Asset>> {
    if digests.is_empty() {
        return Ok(Vec::new());
    }
    sqlx::query(SAME_BYTES)
        .bind(to_json(digests)?)
        .fetch_all(&mut *conn)
        .await?
        .iter()
        .map(super::asset_from_row)
        .collect()
}

/// `group` with every copy of `same_bytes` that holds one of its digests.
fn with_bytes(group: &[Asset], same_bytes: &[Asset]) -> Vec<Asset> {
    let digests: BTreeSet<&String> =
        group.iter().filter_map(|asset| asset.fingerprint.content_sha256.as_ref()).collect();
    let mut copies: BTreeMap<Uuid, Asset> =
        group.iter().map(|asset| (asset.id, asset.clone())).collect();
    for asset in same_bytes {
        if asset.fingerprint.content_sha256.as_ref().is_some_and(|sha| digests.contains(sha)) {
            copies.entry(asset.id).or_insert_with(|| asset.clone());
        }
    }
    let mut copies: Vec<Asset> = copies.into_values().collect();
    copies.sort_by_key(|copy| (copy.location_id, copy.id));
    copies
}

async fn project_desired_sessions(
    conn: &mut SqliteConnection,
    project_id: Uuid,
) -> Result<Vec<Uuid>> {
    let ids: Vec<String> = sqlx::query_scalar(
        "SELECT session_id FROM project_sessions WHERE project_id = ?1 ORDER BY session_id",
    )
    .bind(project_id.to_string())
    .fetch_all(&mut *conn)
    .await?;
    ids.iter().map(|id| parse_uuid(id)).collect()
}

/// Every registered location, earliest registered first (D-W74).
async fn registered_locations(conn: &mut SqliteConnection) -> Result<Vec<Location>> {
    let rows = sqlx::query("SELECT * FROM locations").fetch_all(&mut *conn).await?;
    let mut located = rows
        .iter()
        .map(|row| {
            let created: String = row.try_get("created_at")?;
            let registered =
                super::instant(&created).ok_or_else(|| corrupt("registration time"))?;
            Ok((registered, super::location_from_row(row)?))
        })
        .collect::<Result<Vec<_>>>()?;
    located.sort_by_key(|(registered, location)| (*registered, location.id));
    Ok(located.into_iter().map(|(_, location)| location).collect())
}

// ── Archive and Close ────────────────────────────────────────────────────────

/// A kept-View link an archive may repoint, with what a no-follow check of
/// it expects.
#[derive(Clone, Debug)]
pub struct KeptLinkRecord {
    pub link: KeptViewLink,
    /// The Project folder's parent and the Project's name.
    pub parent: Option<NativePath>,
    pub project_name: String,
    /// The manifest entry: its path below `View/`, and the link identity Apply wrote.
    pub entry: ManifestEntry,
    /// The entry's latest repoint: the target it now reads and its identity.
    pub repointed: Option<(Uuid, NativePath, FileIdentity)>,
}

/// One file of a confirmed archive, as journaled.
#[derive(Clone, Debug)]
pub struct ArchiveDraft {
    pub session_id: Uuid,
    /// The catalog record as reviewed.
    pub asset: Asset,
    pub to_location_id: Uuid,
    pub to_path: NativePath,
    pub links: Vec<KeptViewLink>,
    /// The reviewed source snapshot and its templated destination.
    pub draft: StorageItemDraft,
}

/// One journaled archive file.
#[derive(Clone, Debug)]
pub struct ArchiveMoveRecord {
    pub seq: u32,
    pub session_id: Uuid,
    pub asset_id: Uuid,
    pub from_location_id: Uuid,
    pub from_path: NativePath,
    pub from_fingerprint: ObservationFingerprint,
    pub to_location_id: Uuid,
    pub to_path: NativePath,
    pub size_bytes: u64,
    pub links: Vec<KeptViewLink>,
    pub repointed: bool,
    pub outcome: Option<ArchiveMoveOutcome>,
    pub reason: Option<ItemReason>,
}

/// A journaled archive: Wrap up's (with its Project operation) or Sessions
/// > Archive's.
#[derive(Clone, Debug)]
pub struct ArchiveRun {
    pub storage_operation_id: Uuid,
    pub project_id: Option<Uuid>,
    pub project_operation: Option<ProjectOperation>,
    pub moves: Vec<ArchiveMoveRecord>,
    pub repointed_links: Vec<KeptViewLink>,
}

impl ArchiveRun {
    /// Every move carries an outcome and Wrap up's operation settled.
    #[must_use]
    pub fn settled(&self) -> bool {
        self.moves.iter().all(|step| step.outcome.is_some())
            && self.project_operation.as_ref().is_none_or(|operation| {
                operation.state == platevault_model::ProjectOperationState::Settled
            })
    }

    /// The model's view of the run.
    #[must_use]
    pub fn progress(&self, locations: &BTreeMap<Uuid, Location>) -> ArchiveProgress {
        let absolute = |location: Uuid, path: &NativePath| {
            locations
                .get(&location)
                .and_then(|location| {
                    let root = location.path.to_path_buf().ok()?;
                    Some(NativePath::from_path(&root.join(path.relative_path().ok()?)))
                })
                .unwrap_or_else(|| path.clone())
        };
        ArchiveProgress {
            storage_operation_id: self.storage_operation_id,
            project_id: self.project_id,
            settled: self.settled(),
            moves: self
                .moves
                .iter()
                .map(|step| ArchiveMove {
                    seq: step.seq,
                    session_id: step.session_id,
                    file: ArchiveFile {
                        asset_id: step.asset_id,
                        from: absolute(step.from_location_id, &step.from_path),
                        to: absolute(step.to_location_id, &step.to_path),
                        size_bytes: step.size_bytes,
                    },
                    repointed: step.repointed,
                    outcome: step.outcome,
                    reason: step.reason.clone(),
                })
                .collect(),
            repointed_links: self.repointed_links.clone(),
        }
    }
}

/// What Close took: the lifecycle it left, the snapshot and the archive it
/// journaled.
#[derive(Clone, Debug)]
pub struct ClosedProject {
    pub lifecycle: ProjectLifecycle,
    pub snapshot: ClosedSnapshot,
    pub storage_operation_id: Option<Uuid>,
}

/// The sessions of `sessions` that an open Project other than `project`
/// holds, or whose files its View places, with those Projects' names.
const HOLDERS: &str = "SELECT s.session_id, p.name FROM project_sessions s \
     JOIN projects p ON p.id = s.project_id \
     WHERE p.lifecycle = 'open' AND p.id IS NOT ?1 \
     AND s.session_id IN (SELECT value FROM json_each(?2)) \
     UNION SELECT a.session_id, p.name FROM view_manifest_entries e \
     JOIN view_manifests m ON m.project_id = e.project_id AND m.generation = e.generation \
     JOIN projects p ON p.id = e.project_id JOIN assets a ON a.id = e.asset_id \
     WHERE m.state IN ('installed', 'previous') AND p.lifecycle = 'open' AND p.id IS NOT ?1 \
     AND a.session_id IN (SELECT value FROM json_each(?2)) ORDER BY 2";

/// The links of kept Views that read one of `?1`: installed manifests of
/// Projects that are not open, or of `?2` itself, less what Clean up removed.
const KEPT_LINKS: &str = "SELECT e.project_id, e.generation, e.seq, e.asset_id, e.entry, \
         p.name, p.processing_parent FROM view_manifest_entries e \
     JOIN view_manifests m ON m.project_id = e.project_id AND m.generation = e.generation \
     JOIN projects p ON p.id = e.project_id \
     WHERE m.state = 'installed' AND e.placement = 'symlink' \
     AND e.asset_id IN (SELECT value FROM json_each(?1)) \
     AND (p.lifecycle <> 'open' OR p.id IS ?2) \
     AND NOT EXISTS (SELECT 1 FROM view_entry_removals r WHERE r.project_id = e.project_id \
         AND r.generation = e.generation AND r.seq = e.seq) \
     ORDER BY p.name, e.project_id, e.generation, e.seq";

/// A live frame copy of a session Archive may transfer.
#[derive(Clone, Debug)]
pub struct ArchiveAsset {
    pub session_id: Uuid,
    pub asset: Asset,
    /// The session's confirmed Target, or `None` for Unclassified; archive
    /// naming uses the confirmed Target or its `unclassified` fallback, never
    /// the frame's OBJECT label (D-W107, D-W129).
    pub target: Option<String>,
}

impl Catalog {
    /// The open Projects other than `project` that keep each of `sessions`
    /// at its path: they hold it or their View places its files. A
    /// suggestion doesn't count.
    ///
    /// # Errors
    /// `PersistenceFailure` for a corrupt record.
    pub async fn archive_holders(
        &self,
        project: Option<Uuid>,
        sessions: &BTreeSet<Uuid>,
    ) -> Result<BTreeMap<Uuid, Vec<String>>> {
        let mut conn = self.reader().await?;
        holders(&mut conn, project, sessions).await
    }

    /// The live frame copies of `sessions`, ordered by their location's
    /// registration, then path, each with its session's confirmed Target.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn archive_assets(&self, sessions: &BTreeSet<Uuid>) -> Result<Vec<ArchiveAsset>> {
        let mut conn = self.reader().await?;
        let rows = sqlx::query(asset_sql!(live
            "WHERE a.session_id IN (SELECT value FROM json_each(?1)) \
             ORDER BY l.created_at, l.id, a.path_key"
        ))
        .bind(json_ids(sessions)?)
        .fetch_all(&mut *conn)
        .await?;
        let mut assets = Vec::with_capacity(rows.len());
        for row in &rows {
            let asset = asset_from_row(row)?;
            let session: Option<String> =
                sqlx::query_scalar("SELECT session_id FROM assets WHERE id = ?1")
                    .bind(asset.id.to_string())
                    .fetch_one(&mut *conn)
                    .await?;
            let session_id =
                parse_uuid(&session.ok_or_else(|| corrupt("archive frame without a session"))?)?;
            let association = sqlx::query(
                "SELECT state, evidence, target_id FROM associations \
                 WHERE session_id = ?1 AND kind = 'target'",
            )
            .bind(session_id.to_string())
            .fetch_optional(&mut *conn)
            .await?;
            let target = if let Some(association) = association {
                let state: AssociationState =
                    from_text(&association.try_get::<String, _>("state")?)?;
                let evidence: Vec<EvidenceItem> =
                    from_json(&association.try_get::<String, _>("evidence")?)?;
                if counts_as_confirmed(&state, &evidence) {
                    if let Some(target_id) =
                        association.try_get::<Option<String>, _>("target_id")?
                    {
                        sqlx::query_scalar("SELECT designation FROM targets WHERE id = ?1")
                            .bind(target_id)
                            .fetch_optional(&mut *conn)
                            .await?
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else {
                None
            };
            assets.push(ArchiveAsset { session_id, asset, target });
        }
        Ok(assets)
    }

    /// The kept-View links that read one of `assets`.
    ///
    /// # Errors
    /// `PersistenceFailure` for a corrupt record.
    pub async fn kept_view_links(
        &self,
        project: Option<Uuid>,
        assets: &BTreeSet<Uuid>,
    ) -> Result<Vec<KeptLinkRecord>> {
        let mut conn = self.reader().await?;
        let rows = sqlx::query(KEPT_LINKS)
            .bind(json_ids(assets)?)
            .bind(project.map(|id| id.to_string()))
            .fetch_all(&mut *conn)
            .await?;
        let mut links = Vec::with_capacity(rows.len());
        for row in &rows {
            let project_id = parse_uuid(&row.try_get::<String, _>("project_id")?)?;
            let generation = revision(row.try_get("generation")?)?;
            let seq = u32::try_from(row.try_get::<i64, _>("seq")?).map_err(|_| corrupt("seq"))?;
            let entry: ManifestEntry = from_json(&row.try_get::<String, _>("entry")?)?;
            let parent = row
                .try_get::<Option<String>, _>("processing_parent")?
                .map(|parent| from_json::<NativePath>(&parent))
                .transpose()?;
            let latest = sqlx::query(
                "SELECT target_location_id, target_path, link_identity FROM view_entry_repoints \
                 WHERE project_id = ?1 AND generation = ?2 AND seq = ?3 \
                 ORDER BY repointed_at DESC, rowid DESC LIMIT 1",
            )
            .bind(project_id.to_string())
            .bind(super::db_revision(generation)?)
            .bind(i64::from(seq))
            .fetch_optional(&mut *conn)
            .await?;
            let repointed = latest
                .map(|latest| -> Result<_> {
                    Ok((
                        parse_uuid(&latest.try_get::<String, _>("target_location_id")?)?,
                        path_from_key(&latest.try_get::<Vec<u8>, _>("target_path")?)?,
                        from_json(&latest.try_get::<String, _>("link_identity")?)?,
                    ))
                })
                .transpose()?;
            let project_name: String = row.try_get("name")?;
            links.push(KeptLinkRecord {
                link: KeptViewLink {
                    project_id,
                    project: project_name.clone(),
                    generation,
                    seq,
                    asset_id: parse_uuid(&row.try_get::<String, _>("asset_id")?)?,
                    link: entry.path.clone(),
                },
                parent,
                project_name,
                entry,
                repointed,
            });
        }
        Ok(links)
    }

    /// Close project… (PRJ-FR-14/25): in one transaction, record the
    /// Archive step (Finished with its operation when `archive` moves
    /// anything, else Skipped), take the Closed snapshot of the last
    /// installed View's basis, or the desired basis labelled never applied,
    /// with the goals frozen as `method` counts them, journal the archive,
    /// and move the lifecycle to Closing, or Closed with no archive. No
    /// Reopen follows (`ClosePolicy::CURRENT`).
    ///
    /// # Errors
    /// `Conflict` for a stale Project revision; `InvalidInput` while Wrap up
    /// doesn't open, before Trash is recorded, or naming the open Projects
    /// that now keep an archived session; `NotFound` for an unknown Project.
    pub async fn close_project(
        &self,
        project_id: Uuid,
        expected: Revision,
        method: &MeasurementMethod,
        archive: &[ArchiveDraft],
    ) -> Result<ClosedProject> {
        Ok(write_txn!(self, |conn| {
            require_step(conn, project_id, WrapUpStep::Archive, expected).await?;
            let sessions: BTreeSet<Uuid> = archive.iter().map(|draft| draft.session_id).collect();
            require_unheld(conn, Some(project_id), &sessions).await?;
            let operation = if archive.is_empty() {
                None
            } else {
                Some(
                    project_operations::reserve_operation(
                        conn,
                        project_id,
                        ProjectOperationKind::Archive,
                    )
                    .await?,
                )
            };
            let outcome =
                if operation.is_some() { WrapUpOutcome::Finished } else { WrapUpOutcome::Skipped };
            insert_record(
                conn,
                project_id,
                WrapUpStep::Archive,
                outcome,
                operation.as_ref().map(|op| op.id),
            )
            .await?;
            let snapshot = take_snapshot(conn, project_id, method).await?;
            let storage_operation_id = match &operation {
                Some(operation) => {
                    Some(journal_archive(conn, Some((project_id, operation.id)), archive).await?)
                }
                None => None,
            };
            let next = if operation.is_some() {
                ProjectLifecycle::Closing
            } else {
                ProjectLifecycle::Closed
            };
            let lifecycle = ProjectLifecycle::Open.transition(next)?;
            let at = now()?;
            sqlx::query(
                "UPDATE projects SET lifecycle = ?2, closed_at = ?3, updated_at = ?3 WHERE id = ?1",
            )
            .bind(project_id.to_string())
            .bind(to_text(&lifecycle)?)
            .bind(&at)
            .execute(&mut *conn)
            .await?;
            ClosedProject { lifecycle, snapshot, storage_operation_id }
        }))
    }

    /// A Closed, Closing or Archived Project's snapshot; `None` while open.
    ///
    /// # Errors
    /// `PersistenceFailure` for a corrupt record.
    pub async fn closed_snapshot(&self, project_id: Uuid) -> Result<Option<ClosedSnapshot>> {
        let mut conn = self.reader().await?;
        let snapshot: Option<String> =
            sqlx::query_scalar("SELECT snapshot FROM project_snapshots WHERE project_id = ?1")
                .bind(project_id.to_string())
                .fetch_optional(&mut *conn)
                .await?;
        snapshot.as_deref().map(from_json).transpose()
    }

    /// Journal Sessions > Archive (LIB-FR-17, STO-FR-13): no Project closes
    /// or changes; a session an open Project keeps is refused.
    ///
    /// # Errors
    /// `InvalidInput` for no file or naming the open Projects that keep a
    /// session.
    pub async fn begin_sessions_archive(&self, archive: &[ArchiveDraft]) -> Result<Uuid> {
        if archive.is_empty() {
            return Err(invalid("an archive needs a file to move"));
        }
        Ok(write_txn!(self, |conn| {
            let sessions: BTreeSet<Uuid> = archive.iter().map(|draft| draft.session_id).collect();
            require_unheld(conn, None, &sessions).await?;
            journal_archive(conn, None, archive).await?
        }))
    }

    /// A journaled archive by its storage operation.
    ///
    /// # Errors
    /// `NotFound` for an operation no archive journaled.
    pub async fn archive_run(&self, storage_operation_id: Uuid) -> Result<ArchiveRun> {
        let mut conn = self.reader().await?;
        read_archive(&mut conn, storage_operation_id).await
    }

    /// Every archive a stop left unsettled: one with a move that has no
    /// outcome, or a Closing Project's whose operation is still active.
    ///
    /// # Errors
    /// `PersistenceFailure` for a corrupt record.
    pub async fn unsettled_archives(&self) -> Result<Vec<Uuid>> {
        let mut conn = self.reader().await?;
        let ids: Vec<String> = sqlx::query_scalar(
            "SELECT DISTINCT m.storage_operation_id FROM archive_moves m \
             LEFT JOIN project_operations o ON o.id = m.project_operation_id \
             WHERE m.outcome IS NULL OR o.state = 'active' ORDER BY 1",
        )
        .fetch_all(&mut *conn)
        .await?;
        ids.iter().map(|id| parse_uuid(id)).collect()
    }

    /// The archive copy of move `seq` verified: move the frame's catalog
    /// record to it, keeping its id, decisions and memberships and rebinding
    /// the bases bound to the observation it left. Its kept-View links are
    /// repointed after this and recorded one by one
    /// ([`Catalog::record_kept_link_repoint`]).
    ///
    /// # Errors
    /// `IdentityConflict` when the record changed since review or the
    /// catalog records another frame at the destination; `InvalidInput`
    /// for a settled or repointed move.
    pub async fn record_archive_repoint(
        &self,
        storage_operation_id: Uuid,
        seq: u32,
        to_fingerprint: &ObservationFingerprint,
    ) -> Result<()> {
        if to_fingerprint.content_sha256.is_none() {
            return Err(invalid("a verified archive copy carries its digest"));
        }
        write_txn!(self, |conn| {
            let step = read_move(conn, storage_operation_id, seq).await?;
            if step.outcome.is_some() || step.repointed {
                return Err(invalid(format!("archive move {seq} already moved its record")));
            }
            let at = move_asset_record(
                conn,
                &RecordMove {
                    asset_id: step.asset_id,
                    from_location_id: step.from_location_id,
                    from_path: &step.from_path,
                    from_fingerprint: &step.from_fingerprint,
                    to_location_id: step.to_location_id,
                    to_path: &step.to_path,
                    to_fingerprint,
                },
            )
            .await?;
            sqlx::query(
                "UPDATE archive_moves SET repointed_at = ?3 \
                 WHERE storage_operation_id = ?1 AND seq = ?2",
            )
            .bind(storage_operation_id.to_string())
            .bind(i64::from(seq))
            .bind(&at)
            .execute(&mut *conn)
            .await?;
        });
        Ok(())
    }

    /// Record that `link`, one of move `seq`'s kept-View links, now reads the
    /// archive copy, with the link's new no-follow `identity` (D-W111).
    ///
    /// # Errors
    /// `InvalidInput` before the move's record moved; `PersistenceFailure`
    /// when the schema refuses it (an open Project's View).
    pub async fn record_kept_link_repoint(
        &self,
        storage_operation_id: Uuid,
        seq: u32,
        link: &KeptViewLink,
        identity: &FileIdentity,
    ) -> Result<()> {
        write_txn!(self, |conn| {
            let step = read_move(conn, storage_operation_id, seq).await?;
            if !step.repointed {
                return Err(invalid(format!("archive move {seq} has not moved its record yet")));
            }
            let sha256 = load_asset(conn, step.asset_id)
                .await?
                .fingerprint
                .content_sha256
                .ok_or_else(|| corrupt("archived frame digest"))?;
            sqlx::query(
                "INSERT INTO view_entry_repoints (project_id, generation, seq, \
                 storage_operation_id, target_location_id, target_path, sha256, \
                 link_identity, repointed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            )
            .bind(link.project_id.to_string())
            .bind(super::db_revision(link.generation)?)
            .bind(i64::from(link.seq))
            .bind(storage_operation_id.to_string())
            .bind(step.to_location_id.to_string())
            .bind(path_key(&step.to_path))
            .bind(&sha256)
            .bind(to_json(identity)?)
            .bind(now()?)
            .execute(&mut *conn)
            .await?;
        });
        Ok(())
    }

    /// Settle archive move `seq` with its outcome.
    ///
    /// # Errors
    /// `PersistenceFailure` for a move already settled.
    pub async fn settle_archive_move(
        &self,
        storage_operation_id: Uuid,
        seq: u32,
        outcome: ArchiveMoveOutcome,
        reason: Option<&ItemReason>,
    ) -> Result<()> {
        write_txn!(self, |conn| {
            sqlx::query(
                "UPDATE archive_moves SET outcome = ?3, reason = ?4 \
                 WHERE storage_operation_id = ?1 AND seq = ?2",
            )
            .bind(storage_operation_id.to_string())
            .bind(i64::from(seq))
            .bind(to_text(&outcome)?)
            .bind(reason.map(to_json).transpose()?)
            .execute(&mut *conn)
            .await?;
        });
        Ok(())
    }

    /// Settle an archive whose every move carries an outcome: Wrap up's
    /// operation settles, and its Closing Project becomes Archived when a
    /// record moved to the archive, else Closed. Returns that lifecycle.
    ///
    /// # Errors
    /// `InvalidInput` while a move has no outcome.
    pub async fn settle_archive(
        &self,
        storage_operation_id: Uuid,
    ) -> Result<Option<ProjectLifecycle>> {
        Ok(write_txn!(self, |conn| {
            let run = read_archive(conn, storage_operation_id).await?;
            if run.moves.iter().any(|step| step.outcome.is_none()) {
                return Err(invalid("an archive settles once every file has an outcome"));
            }
            let Some(operation) = &run.project_operation else { return Ok(None) };
            if operation.state == platevault_model::ProjectOperationState::Active {
                project_operations::settle_operation(conn, operation.id).await?;
            }
            let current: String =
                sqlx::query_scalar("SELECT lifecycle FROM projects WHERE id = ?1")
                    .bind(operation.project_id.to_string())
                    .fetch_one(&mut *conn)
                    .await?;
            let current: ProjectLifecycle = from_text(&current)?;
            if current == ProjectLifecycle::Closing {
                let next = if run.moves.iter().any(|step| step.repointed) {
                    ProjectLifecycle::Archived
                } else {
                    ProjectLifecycle::Closed
                };
                let next = current.transition(next)?;
                sqlx::query("UPDATE projects SET lifecycle = ?2, updated_at = ?3 WHERE id = ?1")
                    .bind(operation.project_id.to_string())
                    .bind(to_text(&next)?)
                    .bind(now()?)
                    .execute(&mut *conn)
                    .await?;
                Some(next)
            } else {
                Some(current)
            }
        }))
    }
}

async fn holders(
    conn: &mut SqliteConnection,
    project: Option<Uuid>,
    sessions: &BTreeSet<Uuid>,
) -> Result<BTreeMap<Uuid, Vec<String>>> {
    let mut held: BTreeMap<Uuid, Vec<String>> = BTreeMap::new();
    if sessions.is_empty() {
        return Ok(held);
    }
    for row in sqlx::query(HOLDERS)
        .bind(project.map(|id| id.to_string()))
        .bind(json_ids(sessions)?)
        .fetch_all(&mut *conn)
        .await?
    {
        let names = held.entry(parse_uuid(&row.try_get::<String, _>("session_id")?)?).or_default();
        let name: String = row.try_get("name")?;
        if !names.contains(&name) {
            names.push(name);
        }
    }
    Ok(held)
}

async fn require_unheld(
    conn: &mut SqliteConnection,
    project: Option<Uuid>,
    sessions: &BTreeSet<Uuid>,
) -> Result<()> {
    if let Some((session, names)) = holders(conn, project, sessions).await?.into_iter().next() {
        return Err(invalid(format!(
            "session {session} stays at its path: {} holds it",
            names.join(", ")
        )));
    }
    Ok(())
}

/// Journal one archive's moves: a verified-transfer storage operation and a
/// move row per file.
async fn journal_archive(
    conn: &mut SqliteConnection,
    project: Option<(Uuid, Uuid)>,
    archive: &[ArchiveDraft],
) -> Result<Uuid> {
    let drafts: Vec<StorageItemDraft> = archive.iter().map(|draft| draft.draft.clone()).collect();
    let storage = storage::insert_operation(conn, StorageOperationKind::Move, &drafts).await?;
    for (seq, draft) in archive.iter().enumerate() {
        sqlx::query(
            "INSERT INTO archive_moves (storage_operation_id, seq, project_id, \
             project_operation_id, session_id, asset_id, from_location_id, from_path, \
             from_fingerprint, to_location_id, to_path, size_bytes, links) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        )
        .bind(storage.to_string())
        .bind(i64::try_from(seq).map_err(|_| invalid("too many files to archive"))?)
        .bind(project.map(|(project, _)| project.to_string()))
        .bind(project.map(|(_, operation)| operation.to_string()))
        .bind(draft.session_id.to_string())
        .bind(draft.asset.id.to_string())
        .bind(draft.asset.location_id.to_string())
        .bind(path_key(&draft.asset.relative_path))
        .bind(to_json(&draft.asset.fingerprint)?)
        .bind(draft.to_location_id.to_string())
        .bind(path_key(&draft.to_path))
        .bind(db_size(draft.asset.fingerprint.size_bytes)?)
        .bind(to_json(&draft.links)?)
        .execute(&mut *conn)
        .await?;
    }
    Ok(storage)
}

async fn read_archive(
    conn: &mut SqliteConnection,
    storage_operation_id: Uuid,
) -> Result<ArchiveRun> {
    let rows =
        sqlx::query("SELECT * FROM archive_moves WHERE storage_operation_id = ?1 ORDER BY seq")
            .bind(storage_operation_id.to_string())
            .fetch_all(&mut *conn)
            .await?;
    let first = rows
        .first()
        .ok_or_else(|| LibraryError::NotFound(format!("archive {storage_operation_id}")))?;
    let project_id =
        first.try_get::<Option<String>, _>("project_id")?.as_deref().map(parse_uuid).transpose()?;
    let operation_id = first
        .try_get::<Option<String>, _>("project_operation_id")?
        .as_deref()
        .map(parse_uuid)
        .transpose()?;
    let project_operation = match operation_id {
        Some(id) => Some(read_operation(conn, id).await?),
        None => None,
    };
    let moves = rows
        .iter()
        .map(|row| {
            Ok(ArchiveMoveRecord {
                seq: u32::try_from(row.try_get::<i64, _>("seq")?).map_err(|_| corrupt("seq"))?,
                session_id: parse_uuid(&row.try_get::<String, _>("session_id")?)?,
                asset_id: parse_uuid(&row.try_get::<String, _>("asset_id")?)?,
                from_location_id: parse_uuid(&row.try_get::<String, _>("from_location_id")?)?,
                from_path: path_from_key(&row.try_get::<Vec<u8>, _>("from_path")?)?,
                from_fingerprint: from_json(&row.try_get::<String, _>("from_fingerprint")?)?,
                to_location_id: parse_uuid(&row.try_get::<String, _>("to_location_id")?)?,
                to_path: path_from_key(&row.try_get::<Vec<u8>, _>("to_path")?)?,
                size_bytes: u64::try_from(row.try_get::<i64, _>("size_bytes")?)
                    .map_err(|_| corrupt("size"))?,
                links: from_json(&row.try_get::<String, _>("links")?)?,
                repointed: row.try_get::<Option<String>, _>("repointed_at")?.is_some(),
                outcome: row
                    .try_get::<Option<String>, _>("outcome")?
                    .as_deref()
                    .map(from_text)
                    .transpose()?,
                reason: row
                    .try_get::<Option<String>, _>("reason")?
                    .as_deref()
                    .map(from_json)
                    .transpose()?,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    let by_entry: HashMap<(Uuid, Revision, u32), KeptViewLink> = moves
        .iter()
        .flat_map(|step| step.links.iter())
        .map(|link| ((link.project_id, link.generation, link.seq), link.clone()))
        .collect();
    let mut repointed_links = Vec::new();
    for row in sqlx::query(
        "SELECT project_id, generation, seq FROM view_entry_repoints \
         WHERE storage_operation_id = ?1 ORDER BY repointed_at, project_id, generation, seq",
    )
    .bind(storage_operation_id.to_string())
    .fetch_all(&mut *conn)
    .await?
    {
        let key = (
            parse_uuid(&row.try_get::<String, _>("project_id")?)?,
            revision(row.try_get("generation")?)?,
            u32::try_from(row.try_get::<i64, _>("seq")?).map_err(|_| corrupt("seq"))?,
        );
        if let Some(link) = by_entry.get(&key) {
            repointed_links.push(link.clone());
        }
    }
    Ok(ArchiveRun { storage_operation_id, project_id, project_operation, moves, repointed_links })
}

async fn read_move(
    conn: &mut SqliteConnection,
    storage_operation_id: Uuid,
    seq: u32,
) -> Result<ArchiveMoveRecord> {
    read_archive(conn, storage_operation_id)
        .await?
        .moves
        .into_iter()
        .find(|step| step.seq == seq)
        .ok_or_else(|| LibraryError::NotFound(format!("archive move {seq}")))
}

/// The Closed snapshot, in Close's transaction while the Project is still
/// open: the basis of the last View ever installed, or the desired basis
/// labelled never applied, and the goals as they stand.
async fn take_snapshot(
    conn: &mut SqliteConnection,
    project_id: Uuid,
    method: &MeasurementMethod,
) -> Result<ClosedSnapshot> {
    let last: Option<(i64, String)> = sqlx::query_as(
        "SELECT generation, basis FROM view_manifests WHERE project_id = ?1 \
         AND installed_at IS NOT NULL ORDER BY generation DESC LIMIT 1",
    )
    .bind(project_id.to_string())
    .fetch_optional(&mut *conn)
    .await?;
    let (applied_generation, basis) = match last {
        Some((generation, basis)) => (Some(revision(generation)?), from_json(&basis)?),
        None => (None, project_view::read_inputs(conn, project_id).await?.basis),
    };
    let goals = projects::progress_basis(conn, project_id, method).await?.goals;
    let snapshot =
        ClosedSnapshot { project_id, taken_at: now()?, applied_generation, basis, goals };
    snapshot.validate()?;
    sqlx::query(
        "INSERT INTO project_snapshots (project_id, applied_generation, snapshot, taken_at) \
         VALUES (?1, ?2, ?3, ?4)",
    )
    .bind(project_id.to_string())
    .bind(applied_generation.map(super::db_revision).transpose()?)
    .bind(to_json(&snapshot)?)
    .bind(&snapshot.taken_at)
    .execute(&mut *conn)
    .await?;
    Ok(snapshot)
}

// ── Moving a frame's record ──────────────────────────────────────────────────

/// Where a frame's catalog record moves: from the observation a transfer
/// reviewed to its verified destination copy.
pub struct RecordMove<'a> {
    pub asset_id: Uuid,
    pub from_location_id: Uuid,
    pub from_path: &'a NativePath,
    pub from_fingerprint: &'a ObservationFingerprint,
    pub to_location_id: Uuid,
    pub to_path: &'a NativePath,
    /// The destination's observation, with the verified digest.
    pub to_fingerprint: &'a ObservationFingerprint,
}

/// Move one frame's record to its verified copy in the caller's
/// transaction: it keeps its id, decisions, memberships and sessions, and
/// every basis bound to the observation it left is rebound to the
/// byte-identical copy, as a verified remap does. Returns the time it moved.
///
/// # Errors
/// `IdentityConflict` when the record is no longer what was reviewed, or
/// the catalog records another frame at the destination.
pub async fn move_asset_record(
    conn: &mut SqliteConnection,
    record: &RecordMove<'_>,
) -> Result<String> {
    let asset = load_asset(conn, record.asset_id).await?;
    if asset.location_id != record.from_location_id
        || asset.relative_path != *record.from_path
        || !fingerprint_matches(&asset.fingerprint, record.from_fingerprint)
    {
        return Err(LibraryError::IdentityConflict(format!(
            "the catalog record of {} changed since the transfer reviewed it",
            asset.relative_path.display()
        )));
    }
    let occupant: Option<String> =
        sqlx::query_scalar("SELECT id FROM assets WHERE location_id = ?1 AND path_key = ?2")
            .bind(record.to_location_id.to_string())
            .bind(path_key(record.to_path))
            .fetch_optional(&mut *conn)
            .await?;
    if occupant.is_some() {
        return Err(LibraryError::IdentityConflict(format!(
            "the catalog records another frame at {}",
            record.to_path.display()
        )));
    }
    let fingerprint = record.to_fingerprint;
    let basis = asset.quality_basis.as_ref().map(|basis| {
        if fingerprint_matches(&asset.fingerprint, basis) {
            fingerprint.clone()
        } else {
            basis.clone()
        }
    });
    let at = now()?;
    sqlx::query(
        "UPDATE assets SET location_id = ?1, path_key = ?2, fingerprint = ?3, \
         size_bytes = ?4, modified_ns = ?5, availability = 'available', \
         verification_pending = 0, quality_basis = ?6, last_verified_at = ?7 \
         WHERE id = ?8",
    )
    .bind(record.to_location_id.to_string())
    .bind(path_key(record.to_path))
    .bind(to_json(fingerprint)?)
    .bind(db_size(fingerprint.size_bytes)?)
    .bind(fingerprint.modified_ns.to_string())
    .bind(basis.as_ref().map(to_json).transpose()?)
    .bind(&at)
    .bind(asset.id.to_string())
    .execute(&mut *conn)
    .await?;
    let rebound = HashMap::from([(asset.id, (asset.fingerprint.clone(), fingerprint.clone()))]);
    rebind_association_bases(conn, &rebound).await?;
    Ok(at)
}
