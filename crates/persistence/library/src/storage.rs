// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Storage custody journal (spec 071): durable operations and items.
//!
//! The catalog only records; it never touches the files an item names. Each
//! item change is a compare-and-swap on the item's revision committed before
//! it returns, so the custody executor records a phase before the step it
//! leads into can be observed on disk. Settled items and operations are final.

use platevault_model::{
    EntryEvidence, EntryKind, ItemChange, ItemOutcome, ItemPhase, KeptCopy, LibraryError,
    NativePath, ObservationFingerprint, Revision, StorageItem, StorageItemDraft, StorageOperation,
    StorageOperationKind, StorageOperationState, TransferDestination,
};
use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnection, SqliteRow};
use sqlx::{Connection, Row};
use uuid::Uuid;

use super::{
    conflict, from_json, from_text, now, parse_uuid, path_from_key, path_key, revision, to_json,
    to_text, Catalog, Result,
};

/// What the `identity` column holds: the entry kind and its no-follow fingerprint.
#[derive(Serialize, Deserialize)]
struct StoredIdentity {
    kind: EntryKind,
    fingerprint: ObservationFingerprint,
}

impl Catalog {
    /// Durably record a reviewed storage operation. Nothing on disk changes.
    ///
    /// # Errors
    /// `InvalidInput` for an empty item list or an item whose evidence, kept
    /// copies or destination do not fit the operation kind.
    pub async fn record_storage_operation(
        &self,
        kind: StorageOperationKind,
        drafts: &[StorageItemDraft],
    ) -> Result<StorageOperation> {
        if drafts.is_empty() {
            return Err(LibraryError::InvalidInput("a storage operation needs an item".into()));
        }
        for draft in drafts {
            validate_draft(kind, draft)?;
        }
        let id = Uuid::new_v4();
        let operation = write_txn!(self, |conn| {
            let at = now()?;
            sqlx::query(
                "INSERT INTO storage_operations (id, kind, state, revision, created_at, updated_at) \
                 VALUES (?1, ?2, 'reviewed', 1, ?3, ?3)",
            )
            .bind(id.to_string())
            .bind(to_text(&kind)?)
            .bind(&at)
            .execute(&mut *conn)
            .await?;
            for (seq, draft) in drafts.iter().enumerate() {
                let seq = i64::try_from(seq)
                    .map_err(|_| LibraryError::InvalidInput("too many storage items".into()))?;
                let identity = StoredIdentity {
                    kind: draft.source.kind.clone(),
                    fingerprint: draft.source.fingerprint.clone(),
                };
                sqlx::query(
                    "INSERT INTO storage_items (op_id, seq, path, identity, sha256, relied_on, \
                     destination, written, phase, outcome, reason, revision, updated_at) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, 'pending', NULL, NULL, 1, ?8)",
                )
                .bind(id.to_string())
                .bind(seq)
                .bind(path_key(&draft.source.path))
                .bind(to_json(&identity)?)
                .bind(draft.source.sha256.as_deref())
                .bind(to_json(&draft.relied_on)?)
                .bind(draft.destination.as_ref().map(to_json).transpose()?)
                .bind(&at)
                .execute(&mut *conn)
                .await?;
            }
            load_operation(conn, id).await?
        });
        Ok(operation)
    }

    /// # Errors
    /// `NotFound` for an unknown operation.
    pub async fn storage_operation(&self, id: Uuid) -> Result<StorageOperation> {
        let mut conn = self.reader().await?;
        load_operation(&mut conn, id).await
    }

    /// Every operation not yet settled, oldest first: reviewed work not started
    /// and running work, which an earlier process may have left interrupted.
    ///
    /// # Errors
    /// `PersistenceFailure` when the journal cannot be read.
    pub async fn unsettled_storage_operations(&self) -> Result<Vec<StorageOperation>> {
        let mut conn = self.reader().await?;
        let ids: Vec<String> = sqlx::query_scalar(
            "SELECT id FROM storage_operations WHERE state <> 'settled' ORDER BY created_at, id",
        )
        .fetch_all(&mut *conn)
        .await?;
        let mut operations = Vec::with_capacity(ids.len());
        for id in ids {
            operations.push(load_operation(&mut conn, parse_uuid(&id)?).await?);
        }
        Ok(operations)
    }

    /// Mark a reviewed operation running; a running one is returned unchanged.
    ///
    /// # Errors
    /// `NotFound` for an unknown operation; `InvalidInput` once it is settled.
    pub async fn start_storage_operation(&self, id: Uuid) -> Result<StorageOperation> {
        let operation = write_txn!(self, |conn| {
            let state = operation_state(conn, id).await?;
            match state {
                StorageOperationState::Running => {}
                StorageOperationState::Reviewed => {
                    set_operation_state(conn, id, StorageOperationState::Running).await?;
                }
                StorageOperationState::Settled => {
                    return Err(LibraryError::InvalidInput(
                        "storage operation is settled; review the remaining items again".into(),
                    ));
                }
            }
            load_operation(conn, id).await?
        });
        Ok(operation)
    }

    /// Record one item change of a running operation by compare-and-swap.
    ///
    /// # Errors
    /// `Conflict` for a stale item revision; `NotFound` for an unknown item;
    /// `InvalidInput` when the operation is not running, the item is already
    /// settled, or the change does not fit the operation kind.
    pub async fn advance_storage_item(
        &self,
        id: Uuid,
        seq: u32,
        expected: Revision,
        change: &ItemChange,
    ) -> Result<StorageItem> {
        let item = write_txn!(self, |conn| {
            let kind: String =
                sqlx::query_scalar("SELECT kind FROM storage_operations WHERE id = ?1")
                    .bind(id.to_string())
                    .fetch_optional(&mut *conn)
                    .await?
                    .ok_or_else(|| LibraryError::NotFound(format!("storage operation {id}")))?;
            validate_change(from_text(&kind)?, change)?;
            if operation_state(conn, id).await? != StorageOperationState::Running {
                return Err(LibraryError::InvalidInput(
                    "only a running storage operation records item progress".into(),
                ));
            }
            let current = load_item(conn, id, seq).await?;
            if current.outcome.is_some() {
                return Err(LibraryError::InvalidInput(format!(
                    "storage item {seq} is settled and does not change again"
                )));
            }
            if current.revision != expected {
                return Err(conflict(id, current.revision));
            }
            sqlx::query(
                "UPDATE storage_items SET phase = ?3, outcome = ?4, reason = ?5, written = ?6, \
                 revision = revision + 1, updated_at = ?7 WHERE op_id = ?1 AND seq = ?2",
            )
            .bind(id.to_string())
            .bind(i64::from(seq))
            .bind(to_text(&change.phase)?)
            .bind(change.outcome.as_ref().map(to_text).transpose()?)
            .bind(change.reason.as_ref().map(to_json).transpose()?)
            .bind(change.written.as_ref().map(to_json).transpose()?)
            .bind(now()?)
            .execute(&mut *conn)
            .await?;
            load_item(conn, id, seq).await?
        });
        Ok(item)
    }

    /// Settle a running operation once every item carries an outcome.
    ///
    /// # Errors
    /// `NotFound` for an unknown operation; `InvalidInput` while an item is
    /// open or the operation was never started.
    pub async fn settle_storage_operation(&self, id: Uuid) -> Result<StorageOperation> {
        let operation = write_txn!(self, |conn| {
            match operation_state(conn, id).await? {
                StorageOperationState::Running => {}
                StorageOperationState::Settled => return load_operation(conn, id).await,
                StorageOperationState::Reviewed => {
                    return Err(LibraryError::InvalidInput(
                        "a storage operation that never started cannot settle".into(),
                    ));
                }
            }
            let open: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM storage_items WHERE op_id = ?1 AND outcome IS NULL",
            )
            .bind(id.to_string())
            .fetch_one(&mut *conn)
            .await?;
            if open > 0 {
                return Err(LibraryError::InvalidInput(format!(
                    "{open} storage item(s) have no outcome yet"
                )));
            }
            set_operation_state(conn, id, StorageOperationState::Settled).await?;
            load_operation(conn, id).await?
        });
        Ok(operation)
    }
}

fn invalid(message: &str) -> LibraryError {
    LibraryError::InvalidInput(message.into())
}

fn absolute(path: &NativePath) -> Result<()> {
    if path.to_path_buf()?.is_absolute() {
        Ok(())
    } else {
        Err(invalid("custody paths must be absolute"))
    }
}

fn sha256(value: &str) -> Result<()> {
    if value.len() == 64 && value.bytes().all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f')) {
        Ok(())
    } else {
        Err(invalid("a SHA-256 must be 64 lowercase hex digits"))
    }
}

fn validate_evidence(source: &EntryEvidence) -> Result<()> {
    absolute(&source.path)?;
    if source.fingerprint.content_sha256.is_some() {
        return Err(invalid("entry evidence keeps its digest outside the fingerprint"));
    }
    match (&source.kind, source.sha256.as_deref()) {
        (EntryKind::File, Some(digest)) => sha256(digest),
        (EntryKind::File, None) => Err(invalid("a file entry needs its reviewed SHA-256")),
        (EntryKind::Link { .. }, None) => Ok(()),
        (EntryKind::Link { .. }, Some(_)) => {
            Err(invalid("a link is recorded without following it, so it has no digest"))
        }
    }
}

fn validate_kept(source: &EntryEvidence, kept: &KeptCopy) -> Result<()> {
    absolute(&kept.path)?;
    sha256(&kept.sha256)?;
    if kept.path == source.path {
        return Err(invalid("an entry cannot be its own retained original or kept copy"));
    }
    Ok(())
}

fn validate_destination(destination: &TransferDestination) -> Result<()> {
    absolute(&destination.root)?;
    let relative = destination.relative.relative_path()?;
    let mut parts = relative.components().peekable();
    if parts.peek().is_none() {
        return Err(invalid("a transfer destination names a file below its root"));
    }
    if !parts.all(|part| matches!(part, std::path::Component::Normal(_))) {
        return Err(invalid("a transfer destination is a plain relative path"));
    }
    Ok(())
}

fn validate_draft(kind: StorageOperationKind, draft: &StorageItemDraft) -> Result<()> {
    validate_evidence(&draft.source)?;
    for kept in &draft.relied_on {
        validate_kept(&draft.source, kept)?;
    }
    match (kind, &draft.destination) {
        (StorageOperationKind::Trash, None) => Ok(()),
        (StorageOperationKind::Trash, Some(_)) => {
            Err(invalid("a Trash item has no transfer destination"))
        }
        (StorageOperationKind::Copy | StorageOperationKind::Move, None) => {
            Err(invalid("a transfer item needs its destination"))
        }
        (StorageOperationKind::Copy | StorageOperationKind::Move, Some(destination)) => {
            if !matches!(draft.source.kind, EntryKind::File) {
                return Err(invalid("only files are transferred; links are never followed"));
            }
            if !draft.relied_on.is_empty() {
                return Err(invalid("a transfer relies on its own verified destination"));
            }
            validate_destination(destination)
        }
    }
}

/// The phases an item of `kind` passes through.
const fn phase_fits(kind: StorageOperationKind, phase: ItemPhase) -> bool {
    match kind {
        StorageOperationKind::Trash => {
            matches!(phase, ItemPhase::Pending | ItemPhase::Retiring | ItemPhase::Settled)
        }
        StorageOperationKind::Copy => !matches!(phase, ItemPhase::Retiring),
        StorageOperationKind::Move => true,
    }
}

const fn outcome_fits(kind: StorageOperationKind, outcome: ItemOutcome) -> bool {
    match outcome {
        ItemOutcome::Trashed => matches!(kind, StorageOperationKind::Trash),
        ItemOutcome::Copied => matches!(kind, StorageOperationKind::Copy),
        ItemOutcome::Moved | ItemOutcome::SourceKept => matches!(kind, StorageOperationKind::Move),
        ItemOutcome::Blocked | ItemOutcome::Uncertain => true,
    }
}

fn validate_change(kind: StorageOperationKind, change: &ItemChange) -> Result<()> {
    if !phase_fits(kind, change.phase) {
        return Err(invalid("the phase does not belong to this kind of storage operation"));
    }
    match (change.phase, change.outcome) {
        (ItemPhase::Settled, None) => return Err(invalid("a settled item needs its outcome")),
        (ItemPhase::Settled, Some(outcome)) if !outcome_fits(kind, outcome) => {
            return Err(invalid("the outcome does not belong to this kind of storage operation"));
        }
        (ItemPhase::Settled, Some(_)) | (_, None) => {}
        (_, Some(_)) => return Err(invalid("only a settled item carries an outcome")),
    }
    let explained = matches!(
        change.outcome,
        Some(ItemOutcome::Blocked | ItemOutcome::Uncertain | ItemOutcome::SourceKept)
    );
    if explained != change.reason.is_some() {
        return Err(invalid(
            "blocked, uncertain and source-kept outcomes carry a reason; other changes carry none",
        ));
    }
    let wrote = matches!(
        change.phase,
        ItemPhase::Writing | ItemPhase::Installed | ItemPhase::DestinationVerified
    ) || (kind == StorageOperationKind::Move && change.phase == ItemPhase::Retiring);
    if wrote && change.written.is_none() {
        return Err(invalid("a transfer phase past pending names the copy it wrote"));
    }
    if kind == StorageOperationKind::Trash && change.written.is_some() {
        return Err(invalid("a Trash item writes no copy"));
    }
    Ok(())
}

async fn operation_state(conn: &mut SqliteConnection, id: Uuid) -> Result<StorageOperationState> {
    let state: String = sqlx::query_scalar("SELECT state FROM storage_operations WHERE id = ?1")
        .bind(id.to_string())
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| LibraryError::NotFound(format!("storage operation {id}")))?;
    from_text(&state)
}

async fn set_operation_state(
    conn: &mut SqliteConnection,
    id: Uuid,
    state: StorageOperationState,
) -> Result<()> {
    sqlx::query(
        "UPDATE storage_operations SET state = ?2, revision = revision + 1, updated_at = ?3 \
         WHERE id = ?1",
    )
    .bind(id.to_string())
    .bind(to_text(&state)?)
    .bind(now()?)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

async fn load_operation(conn: &mut SqliteConnection, id: Uuid) -> Result<StorageOperation> {
    let row = sqlx::query(
        "SELECT kind, state, revision, created_at, updated_at FROM storage_operations \
         WHERE id = ?1",
    )
    .bind(id.to_string())
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| LibraryError::NotFound(format!("storage operation {id}")))?;
    let rows = sqlx::query(
        "SELECT seq, path, identity, sha256, relied_on, destination, written, phase, outcome, \
         reason, revision, updated_at FROM storage_items WHERE op_id = ?1 ORDER BY seq",
    )
    .bind(id.to_string())
    .fetch_all(&mut *conn)
    .await?;
    Ok(StorageOperation {
        id,
        kind: from_text(&row.try_get::<String, _>("kind")?)?,
        state: from_text(&row.try_get::<String, _>("state")?)?,
        revision: revision(row.try_get("revision")?)?,
        items: rows.iter().map(item_from_row).collect::<Result<_>>()?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

async fn load_item(conn: &mut SqliteConnection, id: Uuid, seq: u32) -> Result<StorageItem> {
    let row = sqlx::query(
        "SELECT seq, path, identity, sha256, relied_on, destination, written, phase, outcome, \
         reason, revision, updated_at FROM storage_items WHERE op_id = ?1 AND seq = ?2",
    )
    .bind(id.to_string())
    .bind(i64::from(seq))
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| LibraryError::NotFound(format!("storage item {seq} of operation {id}")))?;
    item_from_row(&row)
}

fn item_from_row(row: &SqliteRow) -> Result<StorageItem> {
    let seq: i64 = row.try_get("seq")?;
    let identity: StoredIdentity = from_json(&row.try_get::<String, _>("identity")?)?;
    let optional = |column: &str| -> Result<Option<String>> { Ok(row.try_get(column)?) };
    Ok(StorageItem {
        seq: u32::try_from(seq)
            .map_err(|_| LibraryError::PersistenceFailure(format!("corrupt item {seq}")))?,
        source: EntryEvidence {
            path: path_from_key(&row.try_get::<Vec<u8>, _>("path")?)?,
            kind: identity.kind,
            fingerprint: identity.fingerprint,
            sha256: optional("sha256")?,
        },
        relied_on: from_json(&row.try_get::<String, _>("relied_on")?)?,
        destination: optional("destination")?.as_deref().map(from_json).transpose()?,
        written: optional("written")?.as_deref().map(from_json).transpose()?,
        phase: from_text(&row.try_get::<String, _>("phase")?)?,
        outcome: optional("outcome")?.as_deref().map(from_text).transpose()?,
        reason: optional("reason")?.as_deref().map(from_json).transpose()?,
        revision: revision(row.try_get("revision")?)?,
        updated_at: row.try_get("updated_at")?,
    })
}
