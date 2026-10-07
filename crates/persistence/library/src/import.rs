// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Import records (spec 071 STO-IMP-FR-01..06/08): saved sources, the recorded
//! preview and each item's route, evidence and phase.
//!
//! The catalog only records; it never reads or writes the files an item
//! names. A preview is revised by compare-and-swap on its revision, so Start
//! approves exactly the items the user saw. Once started, the import's runner
//! records each item's phase and storage journal item as its transfer advances.

use std::collections::HashMap;

use platevault_model::{
    CaptureMetadata, EntryEvidence, FileIdentity, ImportBlock, ImportChoice, ImportDraft,
    ImportDuplicate, ImportItem, ImportItemPhase, ImportItemRecord, ImportMode, ImportRecord,
    ImportRig, ImportState, ItemReason, LibraryError, LocationRole, NamingFallback,
    NamingFrameType, NativePath, ObservationFingerprint, Revision, SavedSource, SettleObservation,
    StorageRef, UnknownFilter,
};
use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnection, SqliteRow};
use sqlx::{Connection, Row};
use uuid::Uuid;

use super::{
    conflict, db_size, from_json, from_text, now, parse_uuid, path_from_key, path_key, revision,
    to_json, to_text, Catalog, Result,
};

/// The item fields kept in the `detail` column.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredDetail {
    relative_path: NativePath,
    size_bytes: u64,
    image_type: Option<String>,
    excluded: bool,
    role: Option<LocationRole>,
    fallbacks: Vec<NamingFallback>,
    rig: Option<ImportRig>,
    unknown_filter: Option<UnknownFilter>,
    duplicate: Option<ImportDuplicate>,
    block: Option<ImportBlock>,
    landed: bool,
    indexed: bool,
    observation: Option<SettleObservation>,
    evidence: Option<EntryEvidence>,
    metadata: Option<CaptureMetadata>,
    written: Option<FileIdentity>,
}

impl Catalog {
    /// Save a mounted folder under a name for Import new.
    ///
    /// # Errors
    /// `InvalidInput` for a blank name or a relative path; `Conflict` when the
    /// folder is already saved.
    pub async fn save_import_source(&self, name: &str, path: &NativePath) -> Result<SavedSource> {
        let name = name.trim();
        if name.is_empty() {
            return Err(LibraryError::InvalidInput("a saved source needs a name".into()));
        }
        if !path.to_path_buf()?.is_absolute() {
            return Err(LibraryError::InvalidInput("an import source path is absolute".into()));
        }
        let id = Uuid::new_v4();
        let source = write_txn!(self, |conn| {
            let existing: Option<String> =
                sqlx::query_scalar("SELECT id FROM import_sources WHERE path = ?1")
                    .bind(path_key(path))
                    .fetch_optional(&mut *conn)
                    .await?;
            if let Some(existing) = existing {
                return Err(conflict(parse_uuid(&existing)?, 1));
            }
            sqlx::query(
                "INSERT INTO import_sources (id, name, path, last_imported_at, created_at) \
                 VALUES (?1, ?2, ?3, NULL, ?4)",
            )
            .bind(id.to_string())
            .bind(name)
            .bind(path_key(path))
            .bind(now()?)
            .execute(&mut *conn)
            .await?;
            load_source(conn, id).await?
        });
        Ok(source)
    }

    /// Every saved source, by name.
    ///
    /// # Errors
    /// `PersistenceFailure` for an unreadable catalog.
    pub async fn import_sources(&self) -> Result<Vec<SavedSource>> {
        let mut conn = self.reader().await?;
        let rows = sqlx::query(
            "SELECT id, name, path, last_imported_at, created_at FROM import_sources \
             ORDER BY name, id",
        )
        .fetch_all(&mut *conn)
        .await?;
        rows.iter().map(source_from_row).collect()
    }

    /// # Errors
    /// `NotFound` for an unknown source.
    pub async fn import_source(&self, id: Uuid) -> Result<SavedSource> {
        let mut conn = self.reader().await?;
        load_source(&mut conn, id).await
    }

    /// Record a new preview. Nothing on disk changes.
    ///
    /// # Errors
    /// `NotFound` for an unknown saved source; `InvalidInput` for items whose
    /// sequence numbers are not `0..n` in order.
    pub async fn record_import(&self, draft: &ImportDraft) -> Result<ImportRecord> {
        check_sequence(&draft.items)?;
        let id = Uuid::new_v4();
        let record = write_txn!(self, |conn| {
            if let Some(source) = draft.source_id {
                load_source(conn, source).await?;
            }
            let at = now()?;
            sqlx::query(
                "INSERT INTO import_operations (id, source_id, source_path, mode, state, choices, \
                 revision, created_at, updated_at, settled_at) \
                 VALUES (?1, ?2, ?3, NULL, 'previewed', '[]', 1, ?4, ?4, NULL)",
            )
            .bind(id.to_string())
            .bind(draft.source_id.map(|source| source.to_string()))
            .bind(path_key(&draft.source_path))
            .bind(&at)
            .execute(&mut *conn)
            .await?;
            for item in &draft.items {
                insert_item(conn, id, item).await?;
            }
            load_import(conn, id).await?
        });
        Ok(record)
    }

    /// # Errors
    /// `NotFound` for an unknown import.
    pub async fn import_record(&self, id: Uuid) -> Result<ImportRecord> {
        let mut conn = self.reader().await?;
        load_import(&mut conn, id).await
    }

    /// Replace a preview's choices and items (a recheck may add files).
    ///
    /// # Errors
    /// `Conflict` for a stale `expected` revision; `InvalidInput` once the
    /// import has started or for items not numbered `0..n`.
    pub async fn revise_import(
        &self,
        id: Uuid,
        expected: Revision,
        choices: &[ImportChoice],
        items: &[ImportItemRecord],
    ) -> Result<ImportRecord> {
        check_sequence(items)?;
        let record = write_txn!(self, |conn| {
            let (state, current) = operation_head(conn, id).await?;
            if current != expected {
                return Err(conflict(id, current));
            }
            if state != ImportState::Previewed {
                return Err(LibraryError::InvalidInput(
                    "an import that has started is no longer a preview".into(),
                ));
            }
            sqlx::query("DELETE FROM import_items WHERE op_id = ?1")
                .bind(id.to_string())
                .execute(&mut *conn)
                .await?;
            for item in items {
                insert_item(conn, id, item).await?;
            }
            sqlx::query(
                "UPDATE import_operations SET choices = ?2, revision = revision + 1, \
                 updated_at = ?3 WHERE id = ?1",
            )
            .bind(id.to_string())
            .bind(to_json(choices)?)
            .bind(now()?)
            .execute(&mut *conn)
            .await?;
            load_import(conn, id).await?
        });
        Ok(record)
    }

    /// Start a previewed import: record its mode and approve exactly its
    /// Ready items, which become Pending. Nothing on disk changes.
    ///
    /// # Errors
    /// `Conflict` for a stale `expected` revision; `InvalidInput` once started
    /// or when no item is Ready.
    pub async fn start_import(
        &self,
        id: Uuid,
        expected: Revision,
        mode: ImportMode,
    ) -> Result<ImportRecord> {
        let record = write_txn!(self, |conn| {
            let (state, current) = operation_head(conn, id).await?;
            if current != expected {
                return Err(conflict(id, current));
            }
            if state != ImportState::Previewed {
                return Err(LibraryError::InvalidInput("this import has already started".into()));
            }
            let approved = sqlx::query(
                "UPDATE import_items SET phase = 'pending' WHERE op_id = ?1 AND phase = 'ready'",
            )
            .bind(id.to_string())
            .execute(&mut *conn)
            .await?
            .rows_affected();
            if approved == 0 {
                return Err(LibraryError::InvalidInput("no item is ready to import".into()));
            }
            sqlx::query(
                "UPDATE import_operations SET mode = ?2, state = 'running', \
                 revision = revision + 1, updated_at = ?3 WHERE id = ?1",
            )
            .bind(id.to_string())
            .bind(to_text(&mode)?)
            .bind(now()?)
            .execute(&mut *conn)
            .await?;
            load_import(conn, id).await?
        });
        Ok(record)
    }

    /// Record the execution progress of started items: phase, reason,
    /// landing, indexing and their current storage journal item.
    ///
    /// # Errors
    /// `InvalidInput` unless the import is running or interrupted, or for an
    /// item of another source path; `NotFound` for an unknown item.
    pub async fn record_import_progress(
        &self,
        id: Uuid,
        items: &[ImportItemRecord],
    ) -> Result<ImportRecord> {
        let record = write_txn!(self, |conn| {
            let (state, _) = operation_head(conn, id).await?;
            if !matches!(state, ImportState::Running | ImportState::Interrupted) {
                return Err(LibraryError::InvalidInput(
                    "only a started, unsettled import records progress".into(),
                ));
            }
            for item in items {
                update_item(conn, id, item).await?;
            }
            sqlx::query(
                "UPDATE import_operations SET revision = revision + 1, updated_at = ?2 \
                 WHERE id = ?1",
            )
            .bind(id.to_string())
            .bind(now()?)
            .execute(&mut *conn)
            .await?;
            load_import(conn, id).await?
        });
        Ok(record)
    }

    /// Move a started import between Running and Interrupted, or settle it.
    /// Settling records when its saved source was last imported.
    ///
    /// # Errors
    /// `InvalidInput` for a preview, a settled import, or settling while an
    /// approved item is still Pending or Landed.
    pub async fn set_import_state(&self, id: Uuid, next: ImportState) -> Result<ImportRecord> {
        let record = write_txn!(self, |conn| {
            let (state, _) = operation_head(conn, id).await?;
            let allowed = matches!(state, ImportState::Running | ImportState::Interrupted)
                && next != ImportState::Previewed;
            if !allowed {
                return Err(LibraryError::InvalidInput(format!(
                    "an import cannot go from {state:?} to {next:?}"
                )));
            }
            let at = now()?;
            if next == ImportState::Settled {
                let open: i64 = sqlx::query_scalar(
                    "SELECT COUNT(*) FROM import_items WHERE op_id = ?1 \
                     AND phase IN ('pending', 'landed')",
                )
                .bind(id.to_string())
                .fetch_one(&mut *conn)
                .await?;
                if open > 0 {
                    return Err(LibraryError::InvalidInput(format!(
                        "{open} approved item(s) have no outcome yet"
                    )));
                }
                sqlx::query(
                    "UPDATE import_sources SET last_imported_at = ?2 WHERE id = \
                     (SELECT source_id FROM import_operations WHERE id = ?1)",
                )
                .bind(id.to_string())
                .bind(&at)
                .execute(&mut *conn)
                .await?;
            }
            sqlx::query(
                "UPDATE import_operations SET state = ?2, revision = revision + 1, \
                 updated_at = ?3, settled_at = CASE WHEN ?2 = 'settled' THEN ?3 END \
                 WHERE id = ?1",
            )
            .bind(id.to_string())
            .bind(to_text(&next)?)
            .bind(&at)
            .execute(&mut *conn)
            .await?;
            load_import(conn, id).await?
        });
        Ok(record)
    }

    /// SHA-256 digests of frames imported from a saved source by other
    /// imports, each with the earliest import that landed it.
    ///
    /// # Errors
    /// `PersistenceFailure` for an unreadable catalog.
    pub async fn imported_from_source(
        &self,
        source_id: Uuid,
        excluding: Uuid,
    ) -> Result<HashMap<String, Uuid>> {
        let mut conn = self.reader().await?;
        let rows = sqlx::query(
            "SELECT i.sha256, o.id FROM import_items i \
             JOIN import_operations o ON o.id = i.op_id \
             WHERE o.source_id = ?1 AND o.id <> ?2 AND i.sha256 IS NOT NULL \
             AND i.phase IN ('landed', 'copied', 'moved', 'source_kept') \
             ORDER BY o.created_at DESC, o.id DESC",
        )
        .bind(source_id.to_string())
        .bind(excluding.to_string())
        .fetch_all(&mut *conn)
        .await?;
        let mut imported = HashMap::with_capacity(rows.len());
        for row in rows {
            imported.insert(row.try_get("sha256")?, parse_uuid(&row.try_get::<String, _>("id")?)?);
        }
        Ok(imported)
    }

    /// Live frames of active locations that hold, or may hold, these bytes: a
    /// frame whose recorded digest is `sha256`, and an unhashed frame of the
    /// same size and observed DATE-OBS (identical bytes share both), each with
    /// its recorded digest. Missing frames are left out.
    ///
    /// # Errors
    /// `PersistenceFailure` for an unreadable catalog.
    pub async fn content_candidates(
        &self,
        sha256: &str,
        size_bytes: u64,
        date_obs: Option<&str>,
    ) -> Result<Vec<(Uuid, Option<String>)>> {
        let mut conn = self.reader().await?;
        let rows = sqlx::query(
            "SELECT a.id, a.content_sha256 FROM live_assets a \
             JOIN locations l ON l.id = a.location_id \
             WHERE l.lifecycle = 'active' AND a.availability <> 'missing' \
             AND (a.content_sha256 = ?1 OR (a.content_sha256 IS NULL AND a.size_bytes = ?2 \
             AND json_extract(a.observed, '$.dateObs') IS ?3)) \
             ORDER BY a.content_sha256 IS NULL, a.id",
        )
        .bind(sha256)
        .bind(db_size(size_bytes)?)
        .bind(date_obs)
        .fetch_all(&mut *conn)
        .await?;
        rows.iter()
            .map(|row| {
                Ok((parse_uuid(&row.try_get::<String, _>("id")?)?, row.try_get("content_sha256")?))
            })
            .collect()
    }

    /// Rigs confirmed on current sessions whose live frames come from this
    /// camera and telescope (trimmed header values; no telescope matches
    /// frames without one), by name.
    ///
    /// # Errors
    /// `PersistenceFailure` for an unreadable catalog.
    pub async fn confirmed_rigs_for(
        &self,
        camera: &str,
        telescope: Option<&str>,
    ) -> Result<Vec<(Uuid, String)>> {
        let mut conn = self.reader().await?;
        let rows = sqlx::query(
            "SELECT DISTINCT x.equipment_id, e.name FROM associations x \
             JOIN equipment e ON e.id = x.equipment_id \
             JOIN sessions s ON s.id = x.session_id AND s.superseded_by IS NULL \
             JOIN live_assets a ON a.session_id = s.id \
             WHERE x.kind = 'equipment' AND x.state = 'confirmed' \
             AND trim(json_extract(a.effective, '$.camera')) = ?1 \
             AND nullif(trim(json_extract(a.effective, '$.telescope')), '') IS ?2 \
             ORDER BY e.name, x.equipment_id",
        )
        .bind(camera)
        .bind(telescope)
        .fetch_all(&mut *conn)
        .await?;
        rows.iter()
            .map(|row| {
                Ok((parse_uuid(&row.try_get::<String, _>("equipment_id")?)?, row.try_get("name")?))
            })
            .collect()
    }

    /// The live frame indexed at a location-relative path, with the identity
    /// it was observed with.
    ///
    /// # Errors
    /// `PersistenceFailure` for an unreadable catalog.
    pub async fn live_asset_at(
        &self,
        location_id: Uuid,
        relative_path: &NativePath,
    ) -> Result<Option<(Uuid, FileIdentity)>> {
        let mut conn = self.reader().await?;
        let row = sqlx::query(
            "SELECT id, fingerprint FROM live_assets WHERE location_id = ?1 AND path_key = ?2",
        )
        .bind(location_id.to_string())
        .bind(path_key(relative_path))
        .fetch_optional(&mut *conn)
        .await?;
        row.map(|row| {
            let fingerprint: ObservationFingerprint =
                from_json(&row.try_get::<String, _>("fingerprint")?)?;
            Ok((parse_uuid(&row.try_get::<String, _>("id")?)?, fingerprint.identity))
        })
        .transpose()
    }
}

fn check_sequence(items: &[ImportItemRecord]) -> Result<()> {
    for (index, record) in items.iter().enumerate() {
        if usize::try_from(record.item.seq).ok() != Some(index) {
            return Err(LibraryError::InvalidInput(format!(
                "import item {} is out of sequence",
                record.item.seq
            )));
        }
    }
    Ok(())
}

async fn load_source(conn: &mut SqliteConnection, id: Uuid) -> Result<SavedSource> {
    let row = sqlx::query(
        "SELECT id, name, path, last_imported_at, created_at FROM import_sources WHERE id = ?1",
    )
    .bind(id.to_string())
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| LibraryError::NotFound(format!("import source {id}")))?;
    source_from_row(&row)
}

fn source_from_row(row: &SqliteRow) -> Result<SavedSource> {
    Ok(SavedSource {
        id: parse_uuid(&row.try_get::<String, _>("id")?)?,
        name: row.try_get("name")?,
        path: path_from_key(&row.try_get::<Vec<u8>, _>("path")?)?,
        last_imported_at: row.try_get("last_imported_at")?,
        created_at: row.try_get("created_at")?,
    })
}

async fn operation_head(conn: &mut SqliteConnection, id: Uuid) -> Result<(ImportState, Revision)> {
    let row = sqlx::query("SELECT state, revision FROM import_operations WHERE id = ?1")
        .bind(id.to_string())
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| LibraryError::NotFound(format!("import {id}")))?;
    Ok((from_text(&row.try_get::<String, _>("state")?)?, revision(row.try_get("revision")?)?))
}

fn detail_of(record: &ImportItemRecord) -> StoredDetail {
    let item = &record.item;
    StoredDetail {
        relative_path: item.relative_path.clone(),
        size_bytes: item.size_bytes,
        image_type: item.image_type.clone(),
        excluded: item.excluded,
        role: item.role,
        fallbacks: item.fallbacks.clone(),
        rig: item.rig.clone(),
        unknown_filter: item.unknown_filter.clone(),
        duplicate: item.duplicate.clone(),
        block: item.block.clone(),
        landed: item.landed,
        indexed: item.indexed,
        observation: record.observation.clone(),
        evidence: record.evidence.clone(),
        metadata: record.metadata.clone(),
        written: record.written.clone(),
    }
}

fn frame_type_text(frame_type: Option<NamingFrameType>) -> Option<&'static str> {
    frame_type.map(NamingFrameType::as_str)
}

async fn insert_item(
    conn: &mut SqliteConnection,
    id: Uuid,
    record: &ImportItemRecord,
) -> Result<()> {
    let item = &record.item;
    sqlx::query(
        "INSERT INTO import_items (op_id, seq, source_path, sha256, classification, user_type, \
         destination_location_id, destination_path, phase, reason, detail, storage_op_id, \
         storage_seq) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
    )
    .bind(id.to_string())
    .bind(i64::from(item.seq))
    .bind(path_key(&item.source_path))
    .bind(item.sha256.as_deref())
    .bind(frame_type_text(item.classification))
    .bind(frame_type_text(item.user_type))
    .bind(item.destination_location_id.map(|location| location.to_string()))
    .bind(item.destination_path.as_ref().map(path_key))
    .bind(to_text(&item.phase)?)
    .bind(item.reason.as_ref().map(to_json).transpose()?)
    .bind(to_json(&detail_of(record))?)
    .bind(record.storage.map(|storage| storage.operation_id.to_string()))
    .bind(record.storage.map(|storage| i64::from(storage.seq)))
    .execute(&mut *conn)
    .await?;
    Ok(())
}

async fn update_item(
    conn: &mut SqliteConnection,
    id: Uuid,
    record: &ImportItemRecord,
) -> Result<()> {
    let item = &record.item;
    let updated = sqlx::query(
        "UPDATE import_items SET phase = ?3, reason = ?4, detail = ?5, storage_op_id = ?6, \
         storage_seq = ?7 WHERE op_id = ?1 AND seq = ?2 AND source_path = ?8",
    )
    .bind(id.to_string())
    .bind(i64::from(item.seq))
    .bind(to_text(&item.phase)?)
    .bind(item.reason.as_ref().map(to_json).transpose()?)
    .bind(to_json(&detail_of(record))?)
    .bind(record.storage.map(|storage| storage.operation_id.to_string()))
    .bind(record.storage.map(|storage| i64::from(storage.seq)))
    .bind(path_key(&item.source_path))
    .execute(&mut *conn)
    .await?
    .rows_affected();
    if updated == 0 {
        return Err(LibraryError::NotFound(format!("import {id} item {}", item.seq)));
    }
    Ok(())
}

async fn load_import(conn: &mut SqliteConnection, id: Uuid) -> Result<ImportRecord> {
    let row = sqlx::query(
        "SELECT source_id, source_path, mode, state, choices, revision, created_at, updated_at, \
         settled_at FROM import_operations WHERE id = ?1",
    )
    .bind(id.to_string())
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| LibraryError::NotFound(format!("import {id}")))?;
    let rows = sqlx::query(
        "SELECT seq, source_path, sha256, classification, user_type, destination_location_id, \
         destination_path, phase, reason, detail, storage_op_id, storage_seq \
         FROM import_items WHERE op_id = ?1 ORDER BY seq",
    )
    .bind(id.to_string())
    .fetch_all(&mut *conn)
    .await?;
    Ok(ImportRecord {
        id,
        source_id: row
            .try_get::<Option<String>, _>("source_id")?
            .as_deref()
            .map(parse_uuid)
            .transpose()?,
        source_path: path_from_key(&row.try_get::<Vec<u8>, _>("source_path")?)?,
        mode: row.try_get::<Option<String>, _>("mode")?.as_deref().map(from_text).transpose()?,
        state: from_text(&row.try_get::<String, _>("state")?)?,
        choices: from_json(&row.try_get::<String, _>("choices")?)?,
        revision: revision(row.try_get("revision")?)?,
        items: rows.iter().map(item_from_row).collect::<Result<_>>()?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
        settled_at: row.try_get("settled_at")?,
    })
}

fn frame_type_of(text: Option<String>) -> Result<Option<NamingFrameType>> {
    text.map(|text| {
        NamingFrameType::from_stored(&text).ok_or_else(|| {
            LibraryError::PersistenceFailure(format!("corrupt import frame type {text}"))
        })
    })
    .transpose()
}

fn item_from_row(row: &SqliteRow) -> Result<ImportItemRecord> {
    let seq: i64 = row.try_get("seq")?;
    let seq = u32::try_from(seq)
        .map_err(|_| LibraryError::PersistenceFailure(format!("corrupt import item {seq}")))?;
    let detail: StoredDetail = from_json(&row.try_get::<String, _>("detail")?)?;
    let storage = match row.try_get::<Option<String>, _>("storage_op_id")? {
        Some(operation) => {
            let storage_seq: i64 = row.try_get("storage_seq")?;
            Some(StorageRef {
                operation_id: parse_uuid(&operation)?,
                seq: u32::try_from(storage_seq).map_err(|_| {
                    LibraryError::PersistenceFailure(format!("corrupt storage item {storage_seq}"))
                })?,
            })
        }
        None => None,
    };
    let phase: ImportItemPhase = from_text(&row.try_get::<String, _>("phase")?)?;
    let reason: Option<ItemReason> =
        row.try_get::<Option<String>, _>("reason")?.as_deref().map(from_json).transpose()?;
    Ok(ImportItemRecord {
        item: ImportItem {
            seq,
            source_path: path_from_key(&row.try_get::<Vec<u8>, _>("source_path")?)?,
            relative_path: detail.relative_path,
            size_bytes: detail.size_bytes,
            sha256: row.try_get("sha256")?,
            image_type: detail.image_type,
            classification: frame_type_of(row.try_get("classification")?)?,
            user_type: frame_type_of(row.try_get("user_type")?)?,
            excluded: detail.excluded,
            role: detail.role,
            destination_location_id: row
                .try_get::<Option<String>, _>("destination_location_id")?
                .as_deref()
                .map(parse_uuid)
                .transpose()?,
            destination_path: row
                .try_get::<Option<Vec<u8>>, _>("destination_path")?
                .as_deref()
                .map(path_from_key)
                .transpose()?,
            fallbacks: detail.fallbacks,
            rig: detail.rig,
            unknown_filter: detail.unknown_filter,
            phase,
            duplicate: detail.duplicate,
            block: detail.block,
            reason,
            landed: detail.landed,
            indexed: detail.indexed,
        },
        observation: detail.observation,
        evidence: detail.evidence,
        metadata: detail.metadata,
        storage,
        written: detail.written,
    })
}
