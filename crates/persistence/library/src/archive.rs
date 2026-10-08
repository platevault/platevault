// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Archive and restore transfers (spec 071 STO-FR-06/07/08/13, D06, D-W69):
//! the reviewed transfer and its items, each item's recorded phase, and the
//! repoint that moves a frame's catalog record to its verified destination
//! copy together with the prepared entries that read it.
//!
//! The catalog only records; the custody executor in core writes, re-reads
//! and retires the files. A repoint keeps the asset's identity: its id,
//! decisions, memberships and sessions stay, and every basis bound to the
//! fingerprint it left is rebound to the byte-identical copy, as a verified
//! remap does.

use std::collections::{BTreeSet, HashMap};

use platevault_model::{
    ArchiveDestination, ArchiveHold, ArchiveItem, ArchiveKind, ArchiveOutcome, ArchivePhase,
    ArchiveReference, ArchiveState, ArchiveTransfer, Asset, EntryEvidence, EntryState, ItemReason,
    KeptSession, LibraryError, NamingFallback, NativePath, ObservationFingerprint, OfferRun,
    PreparedEntryKind, ProjectName, Revision,
};
use sqlx::sqlite::SqliteRow;
use sqlx::{Connection, Row, SqliteConnection};
use uuid::Uuid;

use super::{
    asset_from_row, conflict, db_revision, db_size, fingerprint_matches, from_json, from_text,
    json_ids, load_asset, now, parse_uuid, path_key, rebind_association_bases, revision, to_json,
    to_text, Catalog, Result,
};

/// One reviewed item of a new transfer.
#[derive(Clone, Debug)]
pub struct NewArchiveItem {
    pub session_id: Uuid,
    pub asset_id: Uuid,
    pub source_location_id: Uuid,
    pub source_path: NativePath,
    pub destination_location_id: Uuid,
    pub destination_path: NativePath,
    pub size_bytes: u64,
    /// The reviewed snapshot; `None` only for an item held back.
    pub evidence: Option<EntryEvidence>,
    pub fallbacks: Vec<NamingFallback>,
    pub references: Vec<ArchiveReference>,
    pub hold: Option<ArchiveHold>,
    /// Why the item is held, as its settled reason.
    pub reason: Option<ItemReason>,
}

/// A reviewed transfer to record.
#[derive(Clone, Debug)]
pub struct NewArchiveTransfer {
    pub kind: ArchiveKind,
    pub project_id: Uuid,
    pub project_revision: Revision,
    pub destinations: Vec<ArchiveDestination>,
    pub kept: Vec<KeptSession>,
    pub expected_reclaim_bytes: u64,
    pub items: Vec<NewArchiveItem>,
}

/// What the executor needs of one item beyond its view.
#[derive(Clone, Debug)]
pub struct ArchiveItemState {
    pub evidence: Option<EntryEvidence>,
    /// The item's seq in the transfer's storage journal operation.
    pub journal_seq: Option<u32>,
    pub revision: Revision,
}

/// A recorded transfer: its view, and each item's executor state in item order.
#[derive(Clone, Debug)]
pub struct ArchiveRecord {
    pub transfer: ArchiveTransfer,
    pub states: Vec<ArchiveItemState>,
}

/// One recorded change of an item, applied by compare-and-swap on its revision.
#[derive(Clone, Debug)]
pub struct ArchiveItemChange {
    pub phase: ArchivePhase,
    pub outcome: Option<ArchiveOutcome>,
    pub reason: Option<ItemReason>,
    pub references: Vec<ArchiveReference>,
}

/// A prepared entry that now reads the destination copy.
#[derive(Clone, Debug)]
pub struct EntryRepoint {
    pub preparation_id: Uuid,
    pub seq: u32,
    /// The source the entry must still record; anything else is drift.
    pub previous_source: NativePath,
    pub source: NativePath,
    pub source_evidence: EntryEvidence,
    /// A rebuilt link's own evidence; `None` keeps the recorded entry.
    pub entry_identity: Option<EntryEvidence>,
}

/// Move a frame's catalog record to its verified destination copy.
#[derive(Clone, Debug)]
pub struct ArchiveRepoint {
    pub asset_id: Uuid,
    /// The record must still be there with this observation.
    pub from_location_id: Uuid,
    pub from_path: NativePath,
    pub from_fingerprint: ObservationFingerprint,
    pub to_location_id: Uuid,
    pub to_path: NativePath,
    /// The destination copy's observation, with the verified digest.
    pub to_fingerprint: ObservationFingerprint,
    pub entries: Vec<EntryRepoint>,
}

/// A live frame copy of a session Archive may transfer.
#[derive(Clone, Debug)]
pub struct ArchiveAsset {
    pub session_id: Uuid,
    pub asset: Asset,
    /// The session's confirmed Target, the template's `{target}` when the
    /// header names none.
    pub target: Option<String>,
}

/// A prepared entry, of a run in any Project, that reads a frame copy.
#[derive(Clone, Debug)]
pub struct EntryReference {
    pub asset_id: Uuid,
    pub run: OfferRun,
    pub preparation_id: Uuid,
    pub preparation: u32,
    pub seq: u32,
    pub kind: PreparedEntryKind,
    pub path: NativePath,
    pub source: Option<NativePath>,
    pub entry_identity: Option<EntryEvidence>,
    pub state: EntryState,
}

/// The repointed archive item that last moved a frame's record.
#[derive(Clone, Debug)]
pub struct LatestRepoint {
    pub transfer_id: Uuid,
    pub kind: ArchiveKind,
    pub project: ProjectName,
    /// Where the item took the record from, and to.
    pub source_location_id: Uuid,
    pub source_path: NativePath,
    pub destination_location_id: Uuid,
    pub destination_path: NativePath,
    pub repointed_at: String,
}

/// A live frame copy of a session with the repoint that last moved it.
#[derive(Clone, Debug)]
pub struct SessionFrame {
    pub session_id: Uuid,
    pub asset: Asset,
    pub repoint: Option<LatestRepoint>,
}

const ENTRY_REFERENCES: &str = "SELECT e.asset_id, e.prep_id, e.seq, e.kind, e.path, e.source, \
         e.entry_identity, e.state, p.n, v.id AS view_id, v.stage, v.project_id, \
         pj.name AS project_name, coalesce(c.name, d.name) AS run_name \
     FROM prepared_entries e JOIN preparation_revisions p ON p.id = e.prep_id \
     JOIN views v ON v.id = p.view_id JOIN projects pj ON pj.id = v.project_id \
     LEFT JOIN view_revisions c ON c.view_id = v.id AND c.revision = v.revision \
     LEFT JOIN view_revisions d ON d.view_id = v.id AND d.state = 'draft' \
     WHERE e.asset_id IN (SELECT value FROM json_each(?1)) \
     ORDER BY e.asset_id, pj.name, v.id, p.n, e.seq";

const LATEST_REPOINTS: &str = "SELECT i.asset_id, i.transfer_id, t.kind, t.project_id, \
         pj.name AS project_name, i.source_location_id, i.source_path, \
         i.destination_location_id, i.destination_path, i.repointed_at \
     FROM archive_items i JOIN archive_transfers t ON t.id = i.transfer_id \
     JOIN projects pj ON pj.id = t.project_id \
     WHERE i.repointed_at IS NOT NULL AND i.asset_id IN (SELECT value FROM json_each(?1)) \
     ORDER BY i.asset_id, i.repointed_at, t.created_at";

impl Catalog {
    /// Durably record a reviewed transfer. Nothing on disk changes; an item
    /// review held back is recorded settled as Blocked with its hold.
    ///
    /// # Errors
    /// `InvalidInput` for a transfer with no item, or an item that is neither
    /// held nor carries its reviewed snapshot.
    pub async fn record_archive_transfer(
        &self,
        input: &NewArchiveTransfer,
    ) -> Result<ArchiveRecord> {
        if input.items.is_empty() {
            return Err(LibraryError::InvalidInput("a transfer needs an item".into()));
        }
        if input.items.iter().any(|item| item.hold.is_none() && item.evidence.is_none()) {
            return Err(LibraryError::InvalidInput(
                "a transfer item carries its reviewed snapshot unless review held it".into(),
            ));
        }
        let id = Uuid::new_v4();
        let record = write_txn!(self, |conn| {
            let at = now()?;
            sqlx::query(
                "INSERT INTO archive_transfers (id, kind, project_id, project_revision, state, \
                 destinations, kept, expected_reclaim_bytes, storage_op_id, created_at, \
                 updated_at) VALUES (?1, ?2, ?3, ?4, 'reviewed', ?5, ?6, ?7, NULL, ?8, ?8)",
            )
            .bind(id.to_string())
            .bind(to_text(&input.kind)?)
            .bind(input.project_id.to_string())
            .bind(db_revision(input.project_revision)?)
            .bind(to_json(&input.destinations)?)
            .bind(to_json(&input.kept)?)
            .bind(db_size(input.expected_reclaim_bytes)?)
            .bind(&at)
            .execute(&mut *conn)
            .await?;
            for (seq, item) in input.items.iter().enumerate() {
                let (phase, outcome) = if item.hold.is_some() {
                    (ArchivePhase::Settled, Some(ArchiveOutcome::Blocked))
                } else {
                    (ArchivePhase::Pending, None)
                };
                sqlx::query(
                    "INSERT INTO archive_items (transfer_id, seq, session_id, asset_id, \
                     source_location_id, source_path, destination_location_id, \
                     destination_path, size_bytes, evidence, fallbacks, refs, hold, phase, \
                     outcome, reason, journal_seq, repointed_at, revision, updated_at) VALUES \
                     (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, \
                     NULL, NULL, 1, ?17)",
                )
                .bind(id.to_string())
                .bind(i64::try_from(seq).map_err(|_| invalid("too many transfer items"))?)
                .bind(item.session_id.to_string())
                .bind(item.asset_id.to_string())
                .bind(item.source_location_id.to_string())
                .bind(to_json(&item.source_path)?)
                .bind(item.destination_location_id.to_string())
                .bind(to_json(&item.destination_path)?)
                .bind(db_size(item.size_bytes)?)
                .bind(item.evidence.as_ref().map(to_json).transpose()?)
                .bind(to_json(&item.fallbacks)?)
                .bind(to_json(&item.references)?)
                .bind(item.hold.as_ref().map(to_json).transpose()?)
                .bind(to_text(&phase)?)
                .bind(outcome.as_ref().map(to_text).transpose()?)
                .bind(item.reason.as_ref().map(to_json).transpose()?)
                .bind(&at)
                .execute(&mut *conn)
                .await?;
            }
            load_record(conn, id).await?
        });
        Ok(record)
    }

    /// # Errors
    /// `NotFound` for an unknown transfer.
    pub async fn archive_record(&self, id: Uuid) -> Result<ArchiveRecord> {
        let mut conn = self.reader().await?;
        load_record(&mut conn, id).await
    }

    /// The transfers of `project` that started and have not settled: running
    /// now, or left running by an interrupted process.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn running_archive_transfers(&self, project: Uuid) -> Result<Vec<Uuid>> {
        let mut conn = self.reader().await?;
        let ids: Vec<String> = sqlx::query_scalar(
            "SELECT id FROM archive_transfers WHERE project_id = ?1 AND state = 'running' \
             ORDER BY created_at, id",
        )
        .bind(project.to_string())
        .fetch_all(&mut *conn)
        .await?;
        ids.iter().map(|id| parse_uuid(id)).collect()
    }

    /// Start a reviewed transfer: hold back the items the start-time checks
    /// refuse, and attach the journal operation that transfers the others,
    /// naming each item's journal seq. With nothing left to transfer the
    /// transfer settles.
    ///
    /// # Errors
    /// `InvalidInput` unless the transfer is reviewed, or for a seq that is
    /// not one of its open items.
    pub async fn start_archive_transfer(
        &self,
        id: Uuid,
        held: &[(u32, ArchiveHold, Option<ItemReason>)],
        operation: Option<(Uuid, &[(u32, u32)])>,
    ) -> Result<ArchiveRecord> {
        let record = write_txn!(self, |conn| {
            let state: ArchiveState = from_text(&transfer_state(conn, id).await?)?;
            if state != ArchiveState::Reviewed {
                return Err(invalid("only a reviewed transfer starts"));
            }
            let at = now()?;
            for (seq, hold, reason) in held {
                let changed = sqlx::query(
                    "UPDATE archive_items SET hold = ?3, phase = 'settled', outcome = 'blocked', \
                     reason = ?4, revision = revision + 1, updated_at = ?5 \
                     WHERE transfer_id = ?1 AND seq = ?2 AND outcome IS NULL",
                )
                .bind(id.to_string())
                .bind(i64::from(*seq))
                .bind(to_json(hold)?)
                .bind(reason.as_ref().map(to_json).transpose()?)
                .bind(&at)
                .execute(&mut *conn)
                .await?
                .rows_affected();
                if changed != 1 {
                    return Err(invalid("a held item is an open item of the transfer"));
                }
            }
            let next = match operation {
                Some((op_id, seqs)) => {
                    for (seq, journal_seq) in seqs {
                        let changed = sqlx::query(
                            "UPDATE archive_items SET journal_seq = ?3, updated_at = ?4 \
                             WHERE transfer_id = ?1 AND seq = ?2 AND outcome IS NULL",
                        )
                        .bind(id.to_string())
                        .bind(i64::from(*seq))
                        .bind(i64::from(*journal_seq))
                        .bind(&at)
                        .execute(&mut *conn)
                        .await?
                        .rows_affected();
                        if changed != 1 {
                            return Err(invalid(
                                "a journaled item is an open item of the transfer",
                            ));
                        }
                    }
                    sqlx::query("UPDATE archive_transfers SET storage_op_id = ?2 WHERE id = ?1")
                        .bind(id.to_string())
                        .bind(op_id.to_string())
                        .execute(&mut *conn)
                        .await?;
                    ArchiveState::Running
                }
                None => ArchiveState::Settled,
            };
            set_transfer_state(conn, id, next, &at).await?;
            load_record(conn, id).await?
        });
        Ok(record)
    }

    /// Record one item change of a running transfer by compare-and-swap.
    ///
    /// # Errors
    /// `Conflict` for a stale item revision; `InvalidInput` when the transfer
    /// is not running or the item is settled; `NotFound` for an unknown item.
    pub async fn advance_archive_item(
        &self,
        id: Uuid,
        seq: u32,
        expected: Revision,
        change: &ArchiveItemChange,
    ) -> Result<ArchiveRecord> {
        if (change.phase == ArchivePhase::Settled) != change.outcome.is_some() {
            return Err(invalid("an item settles exactly when it takes its outcome"));
        }
        let record = write_txn!(self, |conn| {
            require_running_item(conn, id, seq, expected).await?;
            sqlx::query(
                "UPDATE archive_items SET phase = ?3, outcome = ?4, reason = ?5, refs = ?6, \
                 revision = revision + 1, updated_at = ?7 WHERE transfer_id = ?1 AND seq = ?2",
            )
            .bind(id.to_string())
            .bind(i64::from(seq))
            .bind(to_text(&change.phase)?)
            .bind(change.outcome.as_ref().map(to_text).transpose()?)
            .bind(change.reason.as_ref().map(to_json).transpose()?)
            .bind(to_json(&change.references)?)
            .bind(now()?)
            .execute(&mut *conn)
            .await?;
            load_record(conn, id).await?
        });
        Ok(record)
    }

    /// Reference updated: in one transaction, move the frame's record to its
    /// verified destination copy, rebind the bases bound to the observation
    /// it left, record the prepared entries that now read the copy, and set
    /// the item Reference-updated with `references`.
    ///
    /// # Errors
    /// `IdentityConflict` when the record or an entry is no longer what the
    /// item reviewed, or the catalog records another frame at the
    /// destination; `Conflict` for a stale item revision; `InvalidInput` when
    /// the transfer is not running.
    pub async fn repoint_archive_item(
        &self,
        id: Uuid,
        seq: u32,
        expected: Revision,
        repoint: &ArchiveRepoint,
        references: &[ArchiveReference],
    ) -> Result<ArchiveRecord> {
        let record = write_txn!(self, |conn| {
            require_running_item(conn, id, seq, expected).await?;
            let asset = load_asset(conn, repoint.asset_id).await?;
            if asset.location_id != repoint.from_location_id
                || asset.relative_path != repoint.from_path
                || !fingerprint_matches(&asset.fingerprint, &repoint.from_fingerprint)
            {
                return Err(changed(format!(
                    "the catalog record of {} changed since the transfer reviewed it",
                    asset.relative_path.display()
                )));
            }
            let occupant: Option<String> = sqlx::query_scalar(
                "SELECT id FROM assets WHERE location_id = ?1 AND path_key = ?2",
            )
            .bind(repoint.to_location_id.to_string())
            .bind(path_key(&repoint.to_path))
            .fetch_optional(&mut *conn)
            .await?;
            if occupant.is_some() {
                return Err(changed(format!(
                    "the catalog records another frame at {}",
                    repoint.to_path.display()
                )));
            }
            let fingerprint = &repoint.to_fingerprint;
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
            .bind(repoint.to_location_id.to_string())
            .bind(path_key(&repoint.to_path))
            .bind(to_json(fingerprint)?)
            .bind(db_size(fingerprint.size_bytes)?)
            .bind(fingerprint.modified_ns.to_string())
            .bind(basis.as_ref().map(to_json).transpose()?)
            .bind(&at)
            .bind(asset.id.to_string())
            .execute(&mut *conn)
            .await?;
            let rebound =
                HashMap::from([(asset.id, (asset.fingerprint.clone(), fingerprint.clone()))]);
            rebind_association_bases(conn, &rebound).await?;
            for entry in &repoint.entries {
                repoint_entry(conn, entry, &at).await?;
            }
            sqlx::query(
                "UPDATE archive_items SET phase = 'reference_updated', refs = ?3, \
                 repointed_at = ?4, revision = revision + 1, updated_at = ?4 \
                 WHERE transfer_id = ?1 AND seq = ?2",
            )
            .bind(id.to_string())
            .bind(i64::from(seq))
            .bind(to_json(references)?)
            .bind(&at)
            .execute(&mut *conn)
            .await?;
            load_record(conn, id).await?
        });
        Ok(record)
    }

    /// Record prepared entries a failed or partial reference update rebuilt
    /// anyway, so each entry's record names what its path now holds.
    ///
    /// # Errors
    /// `IdentityConflict` when an entry no longer records its previous source.
    pub async fn record_entry_repoints(&self, entries: &[EntryRepoint]) -> Result<()> {
        if entries.is_empty() {
            return Ok(());
        }
        write_txn!(self, |conn| {
            let at = now()?;
            for entry in entries {
                repoint_entry(conn, entry, &at).await?;
            }
        });
        Ok(())
    }

    /// Settle a running transfer once every item carries an outcome.
    ///
    /// # Errors
    /// `InvalidInput` while an item is open or the transfer never started.
    pub async fn settle_archive_transfer(&self, id: Uuid) -> Result<ArchiveRecord> {
        let record = write_txn!(self, |conn| {
            match from_text::<ArchiveState>(&transfer_state(conn, id).await?)? {
                ArchiveState::Running => {}
                ArchiveState::Settled => return load_record(conn, id).await,
                ArchiveState::Reviewed => {
                    return Err(invalid("a transfer that never started cannot settle"))
                }
            }
            let open: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM archive_items WHERE transfer_id = ?1 AND outcome IS NULL",
            )
            .bind(id.to_string())
            .fetch_one(&mut *conn)
            .await?;
            if open > 0 {
                return Err(invalid("a transfer item has no outcome yet"));
            }
            set_transfer_state(conn, id, ArchiveState::Settled, &now()?).await?;
            load_record(conn, id).await?
        });
        Ok(record)
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
            let session_id = session_of(&mut conn, asset.id).await?;
            let target: Option<String> = sqlx::query_scalar(
                "SELECT t.designation FROM associations a JOIN targets t ON t.id = a.target_id \
                 WHERE a.session_id = ?1 AND a.kind = 'target' AND a.state = 'confirmed'",
            )
            .bind(session_id.to_string())
            .fetch_optional(&mut *conn)
            .await?;
            assets.push(ArchiveAsset { session_id, asset, target });
        }
        Ok(assets)
    }

    /// Whether the catalog records any frame, in any state, at `path` below
    /// `location`.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn asset_recorded_at(
        &self,
        location: Uuid,
        path: &NativePath,
    ) -> Result<Option<Uuid>> {
        let mut conn = self.reader().await?;
        let id: Option<String> =
            sqlx::query_scalar("SELECT id FROM assets WHERE location_id = ?1 AND path_key = ?2")
                .bind(location.to_string())
                .bind(path_key(path))
                .fetch_optional(&mut *conn)
                .await?;
        id.as_deref().map(parse_uuid).transpose()
    }

    /// Every prepared entry, of any run in any Project, that reads one of
    /// `assets`.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn entry_references(&self, assets: &BTreeSet<Uuid>) -> Result<Vec<EntryReference>> {
        if assets.is_empty() {
            return Ok(Vec::new());
        }
        let mut conn = self.reader().await?;
        let rows =
            sqlx::query(ENTRY_REFERENCES).bind(json_ids(assets)?).fetch_all(&mut *conn).await?;
        rows.iter().map(entry_reference).collect()
    }

    /// The live frame copies of `sessions`, each with the repointed archive
    /// item that last moved its record.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn session_frames(&self, sessions: &BTreeSet<Uuid>) -> Result<Vec<SessionFrame>> {
        let assets = self.archive_assets(sessions).await?;
        let ids: BTreeSet<Uuid> = assets.iter().map(|asset| asset.asset.id).collect();
        let mut conn = self.reader().await?;
        let rows = sqlx::query(LATEST_REPOINTS).bind(json_ids(&ids)?).fetch_all(&mut *conn).await?;
        let mut latest: HashMap<Uuid, LatestRepoint> = HashMap::new();
        for row in &rows {
            let asset_id = parse_uuid(&row.try_get::<String, _>("asset_id")?)?;
            latest.insert(asset_id, latest_repoint(row)?);
        }
        Ok(assets
            .into_iter()
            .map(|asset| SessionFrame {
                repoint: latest.remove(&asset.asset.id),
                session_id: asset.session_id,
                asset: asset.asset,
            })
            .collect())
    }
}

fn invalid(message: &str) -> LibraryError {
    LibraryError::InvalidInput(message.into())
}

fn changed(detail: String) -> LibraryError {
    LibraryError::IdentityConflict(detail)
}

async fn session_of(conn: &mut SqliteConnection, asset: Uuid) -> Result<Uuid> {
    let session: Option<String> = sqlx::query_scalar("SELECT session_id FROM assets WHERE id = ?1")
        .bind(asset.to_string())
        .fetch_one(&mut *conn)
        .await?;
    session
        .as_deref()
        .map(parse_uuid)
        .transpose()?
        .ok_or_else(|| LibraryError::PersistenceFailure(format!("asset {asset} is in no session")))
}

async fn transfer_state(conn: &mut SqliteConnection, id: Uuid) -> Result<String> {
    sqlx::query_scalar("SELECT state FROM archive_transfers WHERE id = ?1")
        .bind(id.to_string())
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| LibraryError::NotFound(format!("archive transfer {id}")))
}

async fn set_transfer_state(
    conn: &mut SqliteConnection,
    id: Uuid,
    state: ArchiveState,
    at: &str,
) -> Result<()> {
    sqlx::query("UPDATE archive_transfers SET state = ?2, updated_at = ?3 WHERE id = ?1")
        .bind(id.to_string())
        .bind(to_text(&state)?)
        .bind(at)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

async fn require_running_item(
    conn: &mut SqliteConnection,
    id: Uuid,
    seq: u32,
    expected: Revision,
) -> Result<()> {
    if from_text::<ArchiveState>(&transfer_state(conn, id).await?)? != ArchiveState::Running {
        return Err(invalid("only a running transfer records item progress"));
    }
    let row = sqlx::query(
        "SELECT outcome, revision FROM archive_items WHERE transfer_id = ?1 AND seq = ?2",
    )
    .bind(id.to_string())
    .bind(i64::from(seq))
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| LibraryError::NotFound(format!("archive item {seq} of {id}")))?;
    if row.try_get::<Option<String>, _>("outcome")?.is_some() {
        return Err(invalid("a settled transfer item does not change again"));
    }
    let current = revision(row.try_get("revision")?)?;
    if current != expected {
        return Err(conflict(id, current));
    }
    Ok(())
}

/// Record that a prepared entry now reads the destination copy, only while
/// it still records the source it was reviewed with.
async fn repoint_entry(conn: &mut SqliteConnection, entry: &EntryRepoint, at: &str) -> Result<()> {
    let recorded: Option<String> =
        sqlx::query_scalar("SELECT source FROM prepared_entries WHERE prep_id = ?1 AND seq = ?2")
            .bind(entry.preparation_id.to_string())
            .bind(i64::from(entry.seq))
            .fetch_optional(&mut *conn)
            .await?
            .flatten();
    let recorded: Option<NativePath> = recorded.as_deref().map(from_json).transpose()?;
    if recorded.as_ref() != Some(&entry.previous_source) {
        return Err(changed(format!(
            "prepared entry {} of preparation {} no longer reads {}",
            entry.seq,
            entry.preparation_id,
            entry.previous_source.display()
        )));
    }
    sqlx::query(
        "UPDATE prepared_entries SET source = ?3, source_evidence = ?4, \
         entry_identity = coalesce(?5, entry_identity), updated_at = ?6 \
         WHERE prep_id = ?1 AND seq = ?2",
    )
    .bind(entry.preparation_id.to_string())
    .bind(i64::from(entry.seq))
    .bind(to_json(&entry.source)?)
    .bind(to_json(&entry.source_evidence)?)
    .bind(entry.entry_identity.as_ref().map(to_json).transpose()?)
    .bind(at)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

fn entry_reference(row: &SqliteRow) -> Result<EntryReference> {
    let source: Option<String> = row.try_get("source")?;
    let identity: Option<String> = row.try_get("entry_identity")?;
    let n: i64 = row.try_get("n")?;
    let seq: i64 = row.try_get("seq")?;
    Ok(EntryReference {
        asset_id: parse_uuid(&row.try_get::<String, _>("asset_id")?)?,
        run: OfferRun {
            view_id: parse_uuid(&row.try_get::<String, _>("view_id")?)?,
            name: row.try_get::<Option<String>, _>("run_name")?.unwrap_or_default(),
            project_id: parse_uuid(&row.try_get::<String, _>("project_id")?)?,
            project_name: row.try_get("project_name")?,
            stage: from_text(&row.try_get::<String, _>("stage")?)?,
        },
        preparation_id: parse_uuid(&row.try_get::<String, _>("prep_id")?)?,
        preparation: u32::try_from(n).map_err(|_| corrupt("preparation number"))?,
        seq: u32::try_from(seq).map_err(|_| corrupt("entry seq"))?,
        kind: from_text(&row.try_get::<String, _>("kind")?)?,
        path: from_json(&row.try_get::<String, _>("path")?)?,
        source: source.as_deref().map(from_json).transpose()?,
        entry_identity: identity.as_deref().map(from_json).transpose()?,
        state: from_text(&row.try_get::<String, _>("state")?)?,
    })
}

fn latest_repoint(row: &SqliteRow) -> Result<LatestRepoint> {
    Ok(LatestRepoint {
        transfer_id: parse_uuid(&row.try_get::<String, _>("transfer_id")?)?,
        kind: from_text(&row.try_get::<String, _>("kind")?)?,
        project: ProjectName {
            id: parse_uuid(&row.try_get::<String, _>("project_id")?)?,
            name: row.try_get("project_name")?,
        },
        source_location_id: parse_uuid(&row.try_get::<String, _>("source_location_id")?)?,
        source_path: from_json(&row.try_get::<String, _>("source_path")?)?,
        destination_location_id: parse_uuid(&row.try_get::<String, _>("destination_location_id")?)?,
        destination_path: from_json(&row.try_get::<String, _>("destination_path")?)?,
        repointed_at: row.try_get("repointed_at")?,
    })
}

fn corrupt(what: &str) -> LibraryError {
    LibraryError::PersistenceFailure(format!("corrupt {what}"))
}

async fn load_record(conn: &mut SqliteConnection, id: Uuid) -> Result<ArchiveRecord> {
    let row = sqlx::query(
        "SELECT t.*, p.name AS project_name FROM archive_transfers t \
         JOIN projects p ON p.id = t.project_id WHERE t.id = ?1",
    )
    .bind(id.to_string())
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| LibraryError::NotFound(format!("archive transfer {id}")))?;
    let rows = sqlx::query("SELECT * FROM archive_items WHERE transfer_id = ?1 ORDER BY seq")
        .bind(id.to_string())
        .fetch_all(&mut *conn)
        .await?;
    let mut items = Vec::with_capacity(rows.len());
    let mut states = Vec::with_capacity(rows.len());
    for item in &rows {
        let (view, state) = item_row(item)?;
        items.push(view);
        states.push(state);
    }
    let reclaim: i64 = row.try_get("expected_reclaim_bytes")?;
    let storage: Option<String> = row.try_get("storage_op_id")?;
    let transfer = ArchiveTransfer {
        id,
        kind: from_text(&row.try_get::<String, _>("kind")?)?,
        project: ProjectName {
            id: parse_uuid(&row.try_get::<String, _>("project_id")?)?,
            name: row.try_get("project_name")?,
        },
        project_revision: revision(row.try_get("project_revision")?)?,
        state: from_text(&row.try_get::<String, _>("state")?)?,
        destinations: from_json(&row.try_get::<String, _>("destinations")?)?,
        kept: from_json(&row.try_get::<String, _>("kept")?)?,
        items,
        expected_reclaim_bytes: u64::try_from(reclaim).map_err(|_| corrupt("reclaim"))?,
        storage_operation_id: storage.as_deref().map(parse_uuid).transpose()?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    };
    Ok(ArchiveRecord { transfer, states })
}

fn item_row(row: &SqliteRow) -> Result<(ArchiveItem, ArchiveItemState)> {
    let seq: i64 = row.try_get("seq")?;
    let size: i64 = row.try_get("size_bytes")?;
    let evidence: Option<EntryEvidence> =
        row.try_get::<Option<String>, _>("evidence")?.as_deref().map(from_json).transpose()?;
    let journal: Option<i64> = row.try_get("journal_seq")?;
    let outcome: Option<String> = row.try_get("outcome")?;
    let item = ArchiveItem {
        seq: u32::try_from(seq).map_err(|_| corrupt("item seq"))?,
        session_id: parse_uuid(&row.try_get::<String, _>("session_id")?)?,
        asset_id: parse_uuid(&row.try_get::<String, _>("asset_id")?)?,
        source_location_id: parse_uuid(&row.try_get::<String, _>("source_location_id")?)?,
        source_path: from_json(&row.try_get::<String, _>("source_path")?)?,
        destination_location_id: parse_uuid(&row.try_get::<String, _>("destination_location_id")?)?,
        destination_path: from_json(&row.try_get::<String, _>("destination_path")?)?,
        size_bytes: u64::try_from(size).map_err(|_| corrupt("item size"))?,
        sha256: evidence.as_ref().and_then(|evidence| evidence.sha256.clone()),
        fallbacks: from_json(&row.try_get::<String, _>("fallbacks")?)?,
        references: from_json(&row.try_get::<String, _>("refs")?)?,
        hold: row.try_get::<Option<String>, _>("hold")?.as_deref().map(from_json).transpose()?,
        phase: from_text(&row.try_get::<String, _>("phase")?)?,
        outcome: outcome.as_deref().map(from_text).transpose()?,
        reason: row
            .try_get::<Option<String>, _>("reason")?
            .as_deref()
            .map(from_json)
            .transpose()?,
        repointed: row.try_get::<Option<String>, _>("repointed_at")?.is_some(),
    };
    let state = ArchiveItemState {
        evidence,
        journal_seq: journal.map(u32::try_from).transpose().map_err(|_| corrupt("journal seq"))?,
        revision: revision(row.try_get("revision")?)?,
    };
    Ok((item, state))
}
