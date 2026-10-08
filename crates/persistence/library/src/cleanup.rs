// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Run Clean up and Empty Trash records (spec 071 STO-FR-01..05/10/17,
//! RES-FR-10): the recorded review of a run's removal, its items and folders,
//! and the removal of a trashed run's record with every row it owns.
//!
//! The catalog only records; PV-STO's executor moves files through the
//! storage journal and records each folder phase before the move it leads
//! into. A review is recorded with its storage operation in one transaction,
//! and recording another review of the run withdraws one that never started.
//! The run record leaves only inside [`Catalog::remove_trashed_run`], which
//! takes the run's Empty Trash permit (`run_record_removals`, views.sql) for
//! the length of that one transaction.

use std::collections::HashSet;

use platevault_model::{
    CleanupFolderRole, CleanupKind, CleanupRole, CleanupState, FileIdentity, ItemOutcome,
    ItemPhase, ItemReason, LibraryError, NativePath, PreparedEntryKey, StorageItemDraft,
    StorageOperationKind,
};
use sqlx::sqlite::{SqliteConnection, SqliteRow};
use sqlx::{Connection, Row};
use uuid::Uuid;

use super::storage::{insert_operation, withdraw_reviewed_operation};
use super::views::load_record;
use super::{from_json, from_text, now, parse_uuid, to_json, to_text, Catalog, Result};

fn invalid(message: impl Into<String>) -> LibraryError {
    LibraryError::InvalidInput(message.into())
}

/// What review decided for one listed item.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CleanupDisposition {
    /// Recorded as an item of the review's Trash operation.
    Moves(Box<StorageItemDraft>),
    /// Left in place, for the reason named.
    Stays(ItemReason),
}

/// One listed item of a review to record.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CleanupItemDraft {
    pub path: NativePath,
    pub role: CleanupRole,
    pub entry: Option<PreparedEntryKey>,
    pub disposition: CleanupDisposition,
}

/// One Empty Trash folder of a review to record: it moves once emptied, or
/// it stays for `staying`.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CleanupFolderDraft {
    pub path: NativePath,
    pub role: CleanupFolderRole,
    pub identity: Option<FileIdentity>,
    pub staying: Option<ItemReason>,
}

/// A review to record.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RunCleanupDraft {
    pub kind: CleanupKind,
    pub view_id: Uuid,
    pub results_ticked: bool,
    pub items: Vec<CleanupItemDraft>,
    pub folders: Vec<CleanupFolderDraft>,
}

/// A recorded item.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RunCleanupItem {
    pub n: u32,
    pub path: NativePath,
    pub role: CleanupRole,
    pub entry: Option<PreparedEntryKey>,
    /// The storage item moving it.
    pub storage_seq: Option<u32>,
    /// Why it stays in place since review.
    pub staying: Option<ItemReason>,
}

/// A recorded Empty Trash folder.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RunCleanupFolder {
    pub n: u32,
    pub path: NativePath,
    pub role: CleanupFolderRole,
    pub identity: Option<FileIdentity>,
    /// `Pending`, `Retiring` (the move was about to be requested) or `Settled`.
    pub phase: ItemPhase,
    /// `Trashed`, `Blocked` (kept in place) or `Uncertain`.
    pub outcome: Option<ItemOutcome>,
    pub reason: Option<ItemReason>,
}

/// A recorded review with where it stands.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RunCleanupRecord {
    pub id: Uuid,
    pub kind: CleanupKind,
    pub view_id: Uuid,
    pub project_id: Uuid,
    pub run_name: String,
    pub results_ticked: bool,
    pub operation_id: Option<Uuid>,
    pub state: CleanupState,
    pub items: Vec<RunCleanupItem>,
    pub folders: Vec<RunCleanupFolder>,
    pub created_at: String,
    pub settled_at: Option<String>,
    pub run_removed_at: Option<String>,
}

/// The other runs using one of run `?1`'s accepted Results as an input.
const RESULT_USERS: &str = "SELECT DISTINCT p.view_id FROM view_product_inputs p \
     JOIN result_candidates r ON r.id = p.result_id \
     WHERE r.view_id = ?1 AND p.view_id <> ?1 ORDER BY p.view_id";

/// The rows that go with a run record, child before parent. Committed rows
/// leave only while the run holds its Empty Trash permit.
const RUN_ROWS: [&str; 14] = [
    "DELETE FROM view_product_inputs WHERE view_id = ?1",
    "DELETE FROM master_offers WHERE view_id = ?1 \
     OR result_id IN (SELECT id FROM result_candidates WHERE view_id = ?1)",
    "DELETE FROM result_candidates WHERE view_id = ?1",
    "DELETE FROM prepared_entries \
     WHERE prep_id IN (SELECT id FROM preparation_revisions WHERE view_id = ?1)",
    "DELETE FROM preparation_revisions WHERE view_id = ?1",
    "DELETE FROM results_folders WHERE view_id = ?1",
    "DELETE FROM calibration_decisions WHERE view_id = ?1",
    "DELETE FROM calibration_plans WHERE view_id = ?1",
    "DELETE FROM view_member_copies \
     WHERE revision_row IN (SELECT id FROM view_revisions WHERE view_id = ?1)",
    "DELETE FROM view_members \
     WHERE revision_row IN (SELECT id FROM view_revisions WHERE view_id = ?1)",
    "DELETE FROM view_session_choices \
     WHERE revision_row IN (SELECT id FROM view_revisions WHERE view_id = ?1)",
    "DELETE FROM view_revisions WHERE view_id = ?1",
    "DELETE FROM view_refresh_reviews WHERE view_id = ?1",
    "DELETE FROM views WHERE id = ?1",
];

impl Catalog {
    /// Record a review of a run's removal with the Trash operation of its
    /// moving items, in one transaction. A review of the run that never
    /// started is withdrawn. Nothing on disk changes.
    ///
    /// # Errors
    /// `NotFound` for an unknown run; `InvalidInput` for an Empty Trash of a
    /// run outside its Project's Trash or a Clean up of one inside it, while
    /// another removal of the run is running, or for an item the storage
    /// journal refuses.
    pub async fn record_run_cleanup(&self, draft: &RunCleanupDraft) -> Result<RunCleanupRecord> {
        let id = Uuid::new_v4();
        let record = write_txn!(self, |conn| {
            let run = load_record(conn, draft.view_id).await?;
            require_kind_fits(draft.kind, run.view.trashed_at.is_some(), draft.view_id)?;
            if let Some(running) = running_cleanup(conn, draft.view_id).await? {
                return Err(invalid(format!(
                    "a {} of run {} is running ({running}); it finishes before another review",
                    kind_name(draft.kind),
                    draft.view_id
                )));
            }
            withdraw_reviews(conn, draft.view_id).await?;
            let moving: Vec<StorageItemDraft> = draft
                .items
                .iter()
                .filter_map(|item| match &item.disposition {
                    CleanupDisposition::Moves(storage) => Some(storage.as_ref().clone()),
                    CleanupDisposition::Stays(_) => None,
                })
                .collect();
            let operation = if moving.is_empty() {
                None
            } else {
                Some(insert_operation(conn, StorageOperationKind::Trash, &moving).await?)
            };
            let name = run
                .revision
                .as_ref()
                .map(|revision| revision.name.clone())
                .or_else(|| run.draft.as_ref().map(|draft| draft.name.clone()))
                .unwrap_or_default();
            let at = now()?;
            sqlx::query(
                "INSERT INTO run_cleanups (id, kind, view_id, project_id, run_name, \
                 results_ticked, op_id, state, created_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'reviewed', ?8)",
            )
            .bind(id.to_string())
            .bind(to_text(&draft.kind)?)
            .bind(draft.view_id.to_string())
            .bind(run.view.project_id.to_string())
            .bind(&name)
            .bind(i64::from(draft.results_ticked))
            .bind(operation.map(|op| op.to_string()))
            .bind(&at)
            .execute(&mut *conn)
            .await?;
            insert_items(conn, id, &draft.items).await?;
            insert_folders(conn, id, &draft.folders, &at).await?;
            load_cleanup(conn, id).await?
        });
        Ok(record)
    }

    /// # Errors
    /// `NotFound` for an unknown review.
    pub async fn run_cleanup(&self, id: Uuid) -> Result<RunCleanupRecord> {
        let mut conn = self.reader().await?;
        load_cleanup(&mut conn, id).await
    }

    /// Start a recorded review: it runs only while the run is still where
    /// the review found it, in its Project's Trash for Empty Trash and outside
    /// it for Clean up. A running or settled review is returned unchanged, so
    /// an interrupted one resumes.
    ///
    /// # Errors
    /// `NotFound` for an unknown review or run; `InvalidInput` when the run
    /// moved into or out of its Project's Trash since the review.
    pub async fn start_run_cleanup(&self, id: Uuid) -> Result<RunCleanupRecord> {
        let record = write_txn!(self, |conn| {
            let record = load_cleanup(conn, id).await?;
            if record.state == CleanupState::Reviewed {
                let run = load_record(conn, record.view_id).await?;
                require_kind_fits(record.kind, run.view.trashed_at.is_some(), record.view_id)?;
                sqlx::query("UPDATE run_cleanups SET state = 'running' WHERE id = ?1")
                    .bind(id.to_string())
                    .execute(&mut *conn)
                    .await?;
                load_cleanup(conn, id).await?
            } else {
                record
            }
        });
        Ok(record)
    }

    /// Settle a running Clean up once its operation has settled.
    ///
    /// # Errors
    /// `NotFound` for an unknown review; `InvalidInput` for an Empty Trash,
    /// which settles only by removing the run record, or a review never
    /// started.
    pub async fn settle_run_cleanup(&self, id: Uuid) -> Result<RunCleanupRecord> {
        let record = write_txn!(self, |conn| {
            let record = load_cleanup(conn, id).await?;
            if record.kind == CleanupKind::EmptyTrash {
                return Err(invalid("Empty Trash settles by removing the run record"));
            }
            match record.state {
                CleanupState::Settled => record,
                CleanupState::Reviewed => {
                    return Err(invalid("a Clean up that never started cannot settle"));
                }
                CleanupState::Running => {
                    sqlx::query(
                        "UPDATE run_cleanups SET state = 'settled', settled_at = ?2 WHERE id = ?1",
                    )
                    .bind(id.to_string())
                    .bind(now()?)
                    .execute(&mut *conn)
                    .await?;
                    load_cleanup(conn, id).await?
                }
            }
        });
        Ok(record)
    }

    /// Record one phase of an Empty Trash folder of a running review: its
    /// retirement intent before the move is requested, then its outcome.
    ///
    /// # Errors
    /// `NotFound` for an unknown folder; `InvalidInput` when the review is
    /// not running, the folder is settled, or the phase and outcome do not
    /// fit.
    pub async fn advance_cleanup_folder(
        &self,
        id: Uuid,
        n: u32,
        outcome: Option<ItemOutcome>,
        reason: Option<&ItemReason>,
    ) -> Result<()> {
        let phase = match outcome {
            None => ItemPhase::Retiring,
            Some(ItemOutcome::Trashed | ItemOutcome::Blocked | ItemOutcome::Uncertain) => {
                ItemPhase::Settled
            }
            Some(other) => return Err(invalid(format!("a folder never ends {other:?}"))),
        };
        write_txn!(self, |conn| {
            let record = load_cleanup(conn, id).await?;
            if record.state != CleanupState::Running {
                return Err(invalid("only a running Empty Trash records folder progress"));
            }
            let folder =
                record.folders.iter().find(|folder| folder.n == n).ok_or_else(|| {
                    LibraryError::NotFound(format!("Empty Trash folder {n} of {id}"))
                })?;
            if folder.phase == ItemPhase::Settled {
                return Err(invalid(format!("Empty Trash folder {n} is settled")));
            }
            sqlx::query(
                "UPDATE run_cleanup_folders SET phase = ?3, outcome = ?4, reason = ?5, \
                 updated_at = ?6 WHERE cleanup_id = ?1 AND n = ?2",
            )
            .bind(id.to_string())
            .bind(i64::from(n))
            .bind(to_text(&phase)?)
            .bind(outcome.as_ref().map(to_text).transpose()?)
            .bind(reason.map(to_json).transpose()?)
            .bind(now()?)
            .execute(&mut *conn)
            .await?;
        });
        Ok(())
    }

    /// Remove the record of the run a running Empty Trash empties, with every
    /// row it owns, and settle the review (STO-FR-17, RES-FR-10). The run
    /// holds its Empty Trash permit only inside this transaction. Library
    /// frames, their quality decisions and other runs never change; a run
    /// group keeps its other panel runs (D-W75).
    ///
    /// # Errors
    /// `NotFound` for an unknown review; `InvalidInput` for a Clean up, a
    /// review not running, a run no longer in its Project's Trash, or a run
    /// whose accepted Result another run uses.
    pub async fn remove_trashed_run(&self, id: Uuid) -> Result<RunCleanupRecord> {
        let record = write_txn!(self, |conn| {
            let record = load_cleanup(conn, id).await?;
            if record.kind != CleanupKind::EmptyTrash {
                return Err(invalid("only Empty Trash removes a run record"));
            }
            match record.state {
                CleanupState::Settled => return Ok(record),
                CleanupState::Reviewed => {
                    return Err(invalid("an Empty Trash that never started removes nothing"));
                }
                CleanupState::Running => {}
            }
            let view = record.view_id.to_string();
            let run = load_record(conn, record.view_id).await?;
            require_kind_fits(record.kind, run.view.trashed_at.is_some(), record.view_id)?;
            let users: Vec<String> =
                sqlx::query_scalar(RESULT_USERS).bind(&view).fetch_all(&mut *conn).await?;
            if !users.is_empty() {
                return Err(invalid(format!(
                    "run {view} cannot be removed: an accepted Result of it is an input to run {}",
                    users.join(", ")
                )));
            }
            let attributed: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM result_candidates WHERE prepared_revision_id IN \
                 (SELECT id FROM preparation_revisions WHERE view_id = ?1) \
                 AND (view_id IS NULL OR view_id <> ?1)",
            )
            .bind(&view)
            .fetch_one(&mut *conn)
            .await?;
            if attributed > 0 {
                return Err(invalid(format!(
                    "run {view} cannot be removed: {attributed} Result(s) of another owner \
                     record one of its preparation revisions"
                )));
            }
            withdraw_reviews(conn, record.view_id).await?;
            sqlx::query("INSERT INTO run_record_removals (view_id) VALUES (?1)")
                .bind(&view)
                .execute(&mut *conn)
                .await?;
            for statement in RUN_ROWS {
                sqlx::query(statement).bind(&view).execute(&mut *conn).await?;
            }
            sqlx::query("DELETE FROM run_record_removals WHERE view_id = ?1")
                .bind(&view)
                .execute(&mut *conn)
                .await?;
            let at = now()?;
            sqlx::query(
                "UPDATE run_cleanups SET state = 'settled', settled_at = ?2, run_removed_at = ?2 \
                 WHERE id = ?1",
            )
            .bind(id.to_string())
            .bind(&at)
            .execute(&mut *conn)
            .await?;
            load_cleanup(conn, id).await?
        });
        Ok(record)
    }

    /// The prepared entries of `view` an earlier Clean up moved to the OS
    /// Trash: the run's record of what it removed (STO-FR-05).
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn removed_prepared_entries(&self, view: Uuid) -> Result<HashSet<PreparedEntryKey>> {
        let mut conn = self.reader().await?;
        let rows = sqlx::query(
            "SELECT i.prep_id, i.entry_seq FROM run_cleanup_items i \
             JOIN run_cleanups c ON c.id = i.cleanup_id \
             JOIN storage_items s ON s.op_id = c.op_id AND s.seq = i.storage_seq \
             WHERE c.view_id = ?1 AND i.prep_id IS NOT NULL AND s.outcome = 'trashed'",
        )
        .bind(view.to_string())
        .fetch_all(&mut *conn)
        .await?;
        rows.iter()
            .map(|row| {
                Ok(PreparedEntryKey {
                    preparation_id: parse_uuid(&row.try_get::<String, _>("prep_id")?)?,
                    seq: u32_of(row.try_get("entry_seq")?)?,
                })
            })
            .collect()
    }

    /// The running Clean up or Empty Trash of `view`, if any, with its kind:
    /// a storage mutation affecting the run (RES-FR-07).
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn running_run_cleanup(&self, view: Uuid) -> Result<Option<(Uuid, CleanupKind)>> {
        let mut conn = self.reader().await?;
        let row = sqlx::query(
            "SELECT id, kind FROM run_cleanups WHERE view_id = ?1 AND state = 'running'",
        )
        .bind(view.to_string())
        .fetch_optional(&mut *conn)
        .await?;
        row.map(|row| {
            Ok((
                parse_uuid(&row.try_get::<String, _>("id")?)?,
                from_text(&row.try_get::<String, _>("kind")?)?,
            ))
        })
        .transpose()
    }

    /// The other runs using one of `view`'s accepted Results as an input:
    /// while one does, the run record cannot be removed (RES-FR-10).
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn run_result_users(&self, view: Uuid) -> Result<Vec<Uuid>> {
        let mut conn = self.reader().await?;
        let users: Vec<String> =
            sqlx::query_scalar(RESULT_USERS).bind(view.to_string()).fetch_all(&mut *conn).await?;
        users.iter().map(|user| parse_uuid(user)).collect()
    }
}

const fn kind_name(kind: CleanupKind) -> &'static str {
    match kind {
        CleanupKind::CleanUp => "Clean up",
        CleanupKind::EmptyTrash => "Empty Trash",
    }
}

/// Empty Trash acts on a run in its Project's Trash, Clean up on one outside.
fn require_kind_fits(kind: CleanupKind, trashed: bool, view: Uuid) -> Result<()> {
    match (kind, trashed) {
        (CleanupKind::EmptyTrash, false) => Err(invalid(format!(
            "run {view} is not in its Project's Trash; only Empty Trash of a trashed run removes it"
        ))),
        (CleanupKind::CleanUp, true) => Err(invalid(format!(
            "run {view} is in its Project's Trash; Empty Trash removes its prepared folders"
        ))),
        _ => Ok(()),
    }
}

async fn running_cleanup(conn: &mut SqliteConnection, view: Uuid) -> Result<Option<String>> {
    Ok(sqlx::query_scalar("SELECT id FROM run_cleanups WHERE view_id = ?1 AND state = 'running'")
        .bind(view.to_string())
        .fetch_optional(&mut *conn)
        .await?)
}

/// Withdraw every review of `view` that never started, with its operation.
async fn withdraw_reviews(conn: &mut SqliteConnection, view: Uuid) -> Result<()> {
    let rows =
        sqlx::query("SELECT id, op_id FROM run_cleanups WHERE view_id = ?1 AND state = 'reviewed'")
            .bind(view.to_string())
            .fetch_all(&mut *conn)
            .await?;
    for row in rows {
        let id: String = row.try_get("id")?;
        for statement in [
            "DELETE FROM run_cleanup_items WHERE cleanup_id = ?1",
            "DELETE FROM run_cleanup_folders WHERE cleanup_id = ?1",
            "DELETE FROM run_cleanups WHERE id = ?1",
        ] {
            sqlx::query(statement).bind(&id).execute(&mut *conn).await?;
        }
        if let Some(op) = row.try_get::<Option<String>, _>("op_id")? {
            withdraw_reviewed_operation(conn, parse_uuid(&op)?).await?;
        }
    }
    Ok(())
}

async fn insert_items(
    conn: &mut SqliteConnection,
    id: Uuid,
    items: &[CleanupItemDraft],
) -> Result<()> {
    let mut storage_seq = 0_i64;
    for (n, item) in items.iter().enumerate() {
        let (seq, staying) = match &item.disposition {
            CleanupDisposition::Moves(_) => {
                storage_seq += 1;
                (Some(storage_seq - 1), None)
            }
            CleanupDisposition::Stays(reason) => (None, Some(to_json(reason)?)),
        };
        sqlx::query(
            "INSERT INTO run_cleanup_items (cleanup_id, n, path, role, prep_id, entry_seq, \
             storage_seq, staying) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )
        .bind(id.to_string())
        .bind(i64::try_from(n).map_err(|_| invalid("too many Clean up items"))?)
        .bind(to_json(&item.path)?)
        .bind(to_text(&item.role)?)
        .bind(item.entry.map(|entry| entry.preparation_id.to_string()))
        .bind(item.entry.map(|entry| i64::from(entry.seq)))
        .bind(seq)
        .bind(staying)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

async fn insert_folders(
    conn: &mut SqliteConnection,
    id: Uuid,
    folders: &[CleanupFolderDraft],
    at: &str,
) -> Result<()> {
    for (n, folder) in folders.iter().enumerate() {
        let (phase, outcome) = match folder.staying {
            Some(_) => (ItemPhase::Settled, Some(ItemOutcome::Blocked)),
            None if folder.identity.is_none() => {
                return Err(invalid("a folder Empty Trash moves needs its reviewed identity"));
            }
            None => (ItemPhase::Pending, None),
        };
        sqlx::query(
            "INSERT INTO run_cleanup_folders (cleanup_id, n, path, role, identity, phase, \
             outcome, reason, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        )
        .bind(id.to_string())
        .bind(i64::try_from(n).map_err(|_| invalid("too many Empty Trash folders"))?)
        .bind(to_json(&folder.path)?)
        .bind(to_json(&folder.role)?)
        .bind(folder.identity.as_ref().map(to_json).transpose()?)
        .bind(to_text(&phase)?)
        .bind(outcome.as_ref().map(to_text).transpose()?)
        .bind(folder.staying.as_ref().map(to_json).transpose()?)
        .bind(at)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

fn u32_of(value: i64) -> Result<u32> {
    u32::try_from(value)
        .map_err(|_| LibraryError::PersistenceFailure(format!("corrupt cleanup number {value}")))
}

async fn load_cleanup(conn: &mut SqliteConnection, id: Uuid) -> Result<RunCleanupRecord> {
    let row = sqlx::query(
        "SELECT kind, view_id, project_id, run_name, results_ticked, op_id, state, created_at, \
         settled_at, run_removed_at FROM run_cleanups WHERE id = ?1",
    )
    .bind(id.to_string())
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| LibraryError::NotFound(format!("Clean up review {id}")))?;
    let items = sqlx::query(
        "SELECT n, path, role, prep_id, entry_seq, storage_seq, staying FROM run_cleanup_items \
         WHERE cleanup_id = ?1 ORDER BY n",
    )
    .bind(id.to_string())
    .fetch_all(&mut *conn)
    .await?;
    let folders = sqlx::query(
        "SELECT n, path, role, identity, phase, outcome, reason FROM run_cleanup_folders \
         WHERE cleanup_id = ?1 ORDER BY n",
    )
    .bind(id.to_string())
    .fetch_all(&mut *conn)
    .await?;
    Ok(RunCleanupRecord {
        id,
        kind: from_text(&row.try_get::<String, _>("kind")?)?,
        view_id: parse_uuid(&row.try_get::<String, _>("view_id")?)?,
        project_id: parse_uuid(&row.try_get::<String, _>("project_id")?)?,
        run_name: row.try_get("run_name")?,
        results_ticked: row.try_get::<i64, _>("results_ticked")? == 1,
        operation_id: row
            .try_get::<Option<String>, _>("op_id")?
            .map(|op| parse_uuid(&op))
            .transpose()?,
        state: from_text(&row.try_get::<String, _>("state")?)?,
        items: items.iter().map(item_from_row).collect::<Result<_>>()?,
        folders: folders.iter().map(folder_from_row).collect::<Result<_>>()?,
        created_at: row.try_get("created_at")?,
        settled_at: row.try_get("settled_at")?,
        run_removed_at: row.try_get("run_removed_at")?,
    })
}

fn item_from_row(row: &SqliteRow) -> Result<RunCleanupItem> {
    let entry = match (
        row.try_get::<Option<String>, _>("prep_id")?,
        row.try_get::<Option<i64>, _>("entry_seq")?,
    ) {
        (Some(prep), Some(seq)) => {
            Some(PreparedEntryKey { preparation_id: parse_uuid(&prep)?, seq: u32_of(seq)? })
        }
        _ => None,
    };
    Ok(RunCleanupItem {
        n: u32_of(row.try_get("n")?)?,
        path: from_json(&row.try_get::<String, _>("path")?)?,
        role: from_text(&row.try_get::<String, _>("role")?)?,
        entry,
        storage_seq: row.try_get::<Option<i64>, _>("storage_seq")?.map(u32_of).transpose()?,
        staying: row
            .try_get::<Option<String>, _>("staying")?
            .map(|reason| from_json(&reason))
            .transpose()?,
    })
}

fn folder_from_row(row: &SqliteRow) -> Result<RunCleanupFolder> {
    Ok(RunCleanupFolder {
        n: u32_of(row.try_get("n")?)?,
        path: from_json(&row.try_get::<String, _>("path")?)?,
        role: from_json(&row.try_get::<String, _>("role")?)?,
        identity: row
            .try_get::<Option<String>, _>("identity")?
            .map(|identity| from_json(&identity))
            .transpose()?,
        phase: from_text(&row.try_get::<String, _>("phase")?)?,
        outcome: row
            .try_get::<Option<String>, _>("outcome")?
            .map(|outcome| from_text(&outcome))
            .transpose()?,
        reason: row
            .try_get::<Option<String>, _>("reason")?
            .map(|reason| from_json(&reason))
            .transpose()?,
    })
}
