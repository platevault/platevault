// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Frame review (spec 067): measurement runs, cached measurement records and
//! reviewed or confirmed `SubframeSelector` imports on the catalog's single
//! serialized writer. Every write is one `BEGIN IMMEDIATE` transaction that
//! touches only the measurement tables. Nothing here reads an image file or
//! changes an asset, digest, quality, session, association, correction, View
//! or Project row.

use std::collections::hash_map::Entry;
use std::collections::{BTreeMap, BTreeSet, HashMap};

use platevault_model::{
    Asset, Availability, ColumnClass, ConfirmedImport, Drift, ExportLayout, ImportBasis,
    ImportCandidate, ImportColumn, ImportFormat, ImportReview, ImportReviewState, ImportRow,
    ImportSource, ImportVerification, ImportedValue, LibraryError, Location, MeasurementMethod,
    MeasurementOutcome, MeasurementRecord, MeasurementRun, NativePath, ObservationFingerprint,
    PreambleEntry, RecordValidity, RowMatch, RowResolution, RunCounters, RunIssue, RunState, Units,
    ValueSource,
};
use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnection, SqliteRow};
use sqlx::{Connection, Row};
use uuid::Uuid;

use super::{
    conflict, fingerprint_matches, from_json, from_text, json_ids, load_asset, load_assets,
    load_location, now, parse_uuid, revision, to_json, to_text, Catalog, Result, MAX_PAGE,
};

/// The `ErrorResponse` kinds of issues the catalog records itself.
const CHANGED_ISSUE: &str = "identity_conflict";
const RETIRED_ISSUE: &str = "source_unavailable";

/// The label suffix of every imported value.
const IMPORTED_LABEL: &str = "SubframeSelector";

/// One asset with its latest record for a method name, that record's
/// validity (R12) and whether a Running run still holds it, read in one
/// reader snapshot.
#[derive(Clone, Debug)]
pub struct FrameRecordBasis {
    pub asset: Asset,
    pub record: Option<MeasurementRecord>,
    pub validity: RecordValidity,
    /// A Running run holds the asset unsettled in its queue.
    pub queued: bool,
}

/// A parsed and matched import, stored as a durable `reviewed` proposal.
#[derive(Clone, Debug)]
pub struct ImportReviewInput {
    pub format: ImportFormat,
    pub source: ImportSource,
    pub module_version: Option<String>,
    pub psf_type: Option<String>,
    pub preamble: Vec<PreambleEntry>,
    pub layout: ExportLayout,
    pub scope: Vec<Uuid>,
    pub columns: Vec<ImportColumn>,
    pub rows: Vec<ImportRow>,
    /// The fingerprint and digest each attached or candidate asset was
    /// reviewed against; every candidate of an ambiguous row needs one.
    pub bases: BTreeMap<Uuid, ImportBasis>,
}

/// The stored part of one confirmed value; its source, basis and drift come
/// from the import and its row at read.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredValue {
    column: String,
    label: String,
    value: Option<f64>,
    raw: String,
    reason: Option<String>,
    units: Option<Units>,
    units_basis: Vec<PreambleEntry>,
    warnings: Vec<String>,
    #[serde(rename = "match")]
    match_state: RowMatch,
}

macro_rules! value_sql {
    ($tail:literal) => {
        concat!(
            "SELECT v.import_id, v.position, v.asset_id, v.body, i.format, i.module_version, ",
            "i.psf_type, i.confirmed_at, json_extract(r.body, '$.basis') AS basis ",
            "FROM measurement_import_values v ",
            "JOIN measurement_imports i ON i.id = v.import_id ",
            "JOIN measurement_import_rows r ON r.import_id = v.import_id AND r.line = v.line ",
            $tail,
            " ORDER BY i.sequence DESC, v.line, v.position"
        )
    };
}

// ---------------------------------------------------------------------------
// Records and runs
// ---------------------------------------------------------------------------

impl Catalog {
    /// Each asset in request order with its latest record for `method.name`,
    /// the record's validity for `method` and whether a Running run holds it,
    /// decided in one reader snapshot. Starts no hash and writes nothing.
    ///
    /// # Errors
    /// `NotFound` for an unknown asset; `PersistenceFailure` for an unreadable
    /// catalog.
    pub async fn frame_records(
        &self,
        assets: &[Uuid],
        method: &MeasurementMethod,
    ) -> Result<Vec<FrameRecordBasis>> {
        let ids: BTreeSet<Uuid> = assets.iter().copied().collect();
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let loaded = load_assets(&mut snapshot, &ids).await?;
        let mut records = latest_records(&mut snapshot, &ids, &method.name).await?;
        let queued = queued_assets(&mut snapshot, &ids).await?;
        snapshot.rollback().await?;
        drop(conn);
        let mut by_id: HashMap<Uuid, Asset> =
            loaded.into_iter().map(|asset| (asset.id, asset)).collect();
        assets
            .iter()
            .map(|id| {
                let asset = by_id.remove(id).ok_or_else(|| {
                    LibraryError::InvalidInput(format!("asset {id} is listed twice"))
                })?;
                let record = records.remove(id);
                let validity = validity(&asset, record.as_ref(), method);
                Ok(FrameRecordBasis { queued: queued.contains(id), asset, record, validity })
            })
            .collect()
    }

    /// Start the catalog's one Running run with `queued` in queue order;
    /// `requested` counts the queued and the already cached frames.
    ///
    /// # Errors
    /// `Conflict` naming the Running run; `InvalidInput` for an asset listed
    /// twice or an invalid method; `NotFound` for an unknown asset.
    pub async fn begin_measurement_run(
        &self,
        method: &MeasurementMethod,
        queued: &[Uuid],
        already_cached: u64,
    ) -> Result<MeasurementRun> {
        validate_method(method)?;
        let ids = unique(queued)?;
        let requested = (queued.len() as u64)
            .checked_add(already_cached)
            .ok_or_else(|| LibraryError::InvalidInput("requested count out of range".into()))?;
        let run = write_txn!(self, |conn| {
            if let Some(running) = running_run(conn).await? {
                return Err(conflict(running.operation_id, running.revision));
            }
            load_assets(conn, &ids).await?;
            let id = Uuid::new_v4();
            let sequence: i64 =
                sqlx::query_scalar("SELECT COALESCE(MAX(sequence), 0) + 1 FROM measurement_runs")
                    .fetch_one(&mut *conn)
                    .await?;
            sqlx::query(
                "INSERT INTO measurement_runs (id, sequence, method_name, method_version, state, \
                 revision, requested, already_cached, started_at) \
                 VALUES (?1, ?2, ?3, ?4, 'running', 1, ?5, ?6, ?7)",
            )
            .bind(id.to_string())
            .bind(sequence)
            .bind(&method.name)
            .bind(i64::from(method.version))
            .bind(db_count(requested)?)
            .bind(db_count(already_cached)?)
            .bind(now()?)
            .execute(&mut *conn)
            .await?;
            enqueue(conn, id, queued).await?;
            load_run(conn, id).await?
        });
        Ok(run)
    }

    /// Join more frames to the Running run; assets it already holds are not
    /// queued twice.
    ///
    /// # Errors
    /// `Conflict` when the run is not Running; `InvalidInput` for an asset
    /// listed twice; `NotFound` for an unknown run or asset.
    pub async fn extend_measurement_run(
        &self,
        run: Uuid,
        queued: &[Uuid],
        already_cached: u64,
    ) -> Result<MeasurementRun> {
        let ids = unique(queued)?;
        let run = write_txn!(self, |conn| {
            require_running(&load_run(conn, run).await?)?;
            load_assets(conn, &ids).await?;
            let held = run_assets(conn, run).await?;
            let fresh: Vec<Uuid> = queued.iter().copied().filter(|id| !held.contains(id)).collect();
            enqueue(conn, run, &fresh).await?;
            let added = (fresh.len() as u64)
                .checked_add(already_cached)
                .ok_or_else(|| LibraryError::InvalidInput("requested count out of range".into()))?;
            sqlx::query(
                "UPDATE measurement_runs SET requested = requested + ?2, \
                 already_cached = already_cached + ?3, revision = revision + 1 WHERE id = ?1",
            )
            .bind(run.to_string())
            .bind(db_count(added)?)
            .bind(db_count(already_cached)?)
            .execute(&mut *conn)
            .await?;
            load_run(conn, run).await?
        });
        Ok(run)
    }

    /// Settle one queued frame with its record, replacing the asset's previous
    /// record for the method name. When the asset is Retired or its current
    /// fingerprint no longer matches the record's basis, no record is stored
    /// and an issue is recorded instead. Counters and revision move with it.
    ///
    /// # Errors
    /// `Conflict` when the run is not Running or the frame is already settled;
    /// `InvalidInput` for a record of another run or method, or an asset the
    /// run does not hold; `NotFound` for an unknown run or asset.
    pub async fn record_measurement(
        &self,
        run: Uuid,
        record: &MeasurementRecord,
    ) -> Result<MeasurementRun> {
        if record.run_id != run {
            return Err(LibraryError::InvalidInput(format!(
                "measurement {} belongs to run {}, not {run}",
                record.id, record.run_id
            )));
        }
        let run = write_txn!(self, |conn| {
            let current = load_run(conn, run).await?;
            require_running(&current)?;
            if record.method != current.method {
                return Err(LibraryError::InvalidInput(format!(
                    "measurement method {} v{} differs from the run's {} v{}",
                    record.method.name,
                    record.method.version,
                    current.method.name,
                    current.method.version
                )));
            }
            require_unsettled(conn, &current, record.asset_id).await?;
            let asset = load_asset(conn, record.asset_id).await?;
            if asset.availability == Availability::Retired {
                let message = "the asset's location was retired before its record was stored";
                add_issue(conn, run, &issue(asset.id, RETIRED_ISSUE, message)).await?;
            } else if fingerprint_matches(&asset.fingerprint, &record.basis.fingerprint) {
                store_record(conn, record).await?;
            } else {
                let message = "the source changed after it was read; no record was stored";
                add_issue(conn, run, &issue(asset.id, CHANGED_ISSUE, message)).await?;
            }
            settle(conn, run, record.asset_id).await?;
            load_run(conn, run).await?
        });
        Ok(run)
    }

    /// Settle one queued frame with an issue: a source that was offline,
    /// unreadable, retired or changed while being read.
    ///
    /// # Errors
    /// `Conflict` when the run is not Running or the frame is already settled;
    /// `InvalidInput` for an empty kind or message, or an asset the run does
    /// not hold; `NotFound` for an unknown run.
    pub async fn record_run_issue(&self, run: Uuid, issue: &RunIssue) -> Result<MeasurementRun> {
        if issue.kind.trim().is_empty() || issue.message.trim().is_empty() {
            return Err(LibraryError::InvalidInput(
                "a run issue needs a kind and a message".into(),
            ));
        }
        let run = write_txn!(self, |conn| {
            let current = load_run(conn, run).await?;
            require_running(&current)?;
            require_unsettled(conn, &current, issue.asset_id).await?;
            add_issue(conn, run, issue).await?;
            settle(conn, run, issue.asset_id).await?;
            load_run(conn, run).await?
        });
        Ok(run)
    }

    /// End the Running run as Completed, Canceled or Failed.
    ///
    /// # Errors
    /// `InvalidInput` for another target state or for Completed while frames
    /// remain; `Conflict` when the run is not Running; `NotFound` for an
    /// unknown run.
    pub async fn finish_measurement_run(
        &self,
        run: Uuid,
        state: RunState,
    ) -> Result<MeasurementRun> {
        if !matches!(state, RunState::Completed | RunState::Canceled | RunState::Failed) {
            return Err(LibraryError::InvalidInput(format!(
                "a run finishes as completed, canceled or failed, not {}",
                to_text(&state)?
            )));
        }
        let run = write_txn!(self, |conn| {
            let current = load_run(conn, run).await?;
            require_running(&current)?;
            if state == RunState::Completed && current.counters.remaining > 0 {
                return Err(LibraryError::InvalidInput(format!(
                    "run {run} still has {} unsettled frames",
                    current.counters.remaining
                )));
            }
            sqlx::query(
                "UPDATE measurement_runs SET state = ?2, finished_at = ?3, revision = revision + 1 \
                 WHERE id = ?1",
            )
            .bind(run.to_string())
            .bind(to_text(&state)?)
            .bind(now()?)
            .execute(&mut *conn)
            .await?;
            load_run(conn, run).await?
        });
        Ok(run)
    }

    /// # Errors
    /// `NotFound` for an unknown run.
    pub async fn measurement_run(&self, run: Uuid) -> Result<MeasurementRun> {
        let mut conn = self.reader().await?;
        load_run(&mut conn, run).await
    }

    /// Runs newest first, including Interrupted runs after restart.
    ///
    /// # Errors
    /// `PersistenceFailure` for an unreadable catalog.
    pub async fn list_measurement_runs(
        &self,
        offset: u32,
        limit: u32,
    ) -> Result<Vec<MeasurementRun>> {
        let mut conn = self.reader().await?;
        let ids: Vec<String> = sqlx::query_scalar(
            "SELECT id FROM measurement_runs ORDER BY sequence DESC LIMIT ?1 OFFSET ?2",
        )
        .bind(i64::from(if limit == 0 { MAX_PAGE } else { limit.min(MAX_PAGE) }))
        .bind(i64::from(offset))
        .fetch_all(&mut *conn)
        .await?;
        let mut runs = Vec::with_capacity(ids.len());
        for id in ids {
            runs.push(load_run(&mut conn, parse_uuid(&id)?).await?);
        }
        Ok(runs)
    }

    /// # Errors
    /// `NotFound` for an unknown or replaced record.
    pub async fn measurement(&self, id: Uuid) -> Result<MeasurementRecord> {
        let mut conn = self.reader().await?;
        let record: Option<String> =
            sqlx::query_scalar("SELECT record FROM measurement_records WHERE id = ?1")
                .bind(id.to_string())
                .fetch_optional(&mut *conn)
                .await?;
        from_json(&record.ok_or_else(|| LibraryError::NotFound(format!("measurement {id}")))?)
    }
}

/// Mark every Running run Interrupted; called once at open after scan recovery.
pub async fn recover_interrupted(conn: &mut SqliteConnection) -> Result<()> {
    let mut txn = conn.begin_with("BEGIN IMMEDIATE").await?;
    sqlx::query(
        "UPDATE measurement_runs SET state = 'interrupted', revision = revision + 1, \
         finished_at = ?1 WHERE state = 'running'",
    )
    .bind(now()?)
    .execute(&mut *txn)
    .await?;
    txn.commit().await?;
    Ok(())
}

pub fn validity(
    asset: &Asset,
    record: Option<&MeasurementRecord>,
    method: &MeasurementMethod,
) -> RecordValidity {
    match record {
        None => RecordValidity::Absent,
        Some(record)
            if asset.availability != Availability::Retired
                && record.method == *method
                && fingerprint_matches(&asset.fingerprint, &record.basis.fingerprint) =>
        {
            RecordValidity::Valid
        }
        Some(_) => RecordValidity::Stale,
    }
}

fn validate_method(method: &MeasurementMethod) -> Result<()> {
    if method.name.trim().is_empty() || method.version == 0 {
        return Err(LibraryError::InvalidInput(
            "a measurement method needs a name and a version above 0".into(),
        ));
    }
    Ok(())
}

fn unique(ids: &[Uuid]) -> Result<BTreeSet<Uuid>> {
    let mut seen = BTreeSet::new();
    for id in ids {
        if !seen.insert(*id) {
            return Err(LibraryError::InvalidInput(format!("asset {id} is listed twice")));
        }
    }
    Ok(seen)
}

fn issue(asset_id: Uuid, kind: &str, message: &str) -> RunIssue {
    RunIssue { asset_id, kind: kind.into(), message: message.into() }
}

fn db_count(value: u64) -> Result<i64> {
    i64::try_from(value).map_err(|_| LibraryError::InvalidInput("count out of range".into()))
}

fn stored_count(value: i64) -> Result<u64> {
    u64::try_from(value)
        .map_err(|_| LibraryError::PersistenceFailure(format!("corrupt count {value}")))
}

const fn require_running(run: &MeasurementRun) -> Result<()> {
    if matches!(run.state, RunState::Running) {
        Ok(())
    } else {
        Err(conflict(run.operation_id, run.revision))
    }
}

async fn running_run(conn: &mut SqliteConnection) -> Result<Option<MeasurementRun>> {
    let id: Option<String> =
        sqlx::query_scalar("SELECT id FROM measurement_runs WHERE state = 'running'")
            .fetch_optional(&mut *conn)
            .await?;
    match id {
        Some(id) => Ok(Some(load_run(conn, parse_uuid(&id)?).await?)),
        None => Ok(None),
    }
}

async fn load_run(conn: &mut SqliteConnection, id: Uuid) -> Result<MeasurementRun> {
    let row = sqlx::query(
        "SELECT r.method_name, r.method_version, r.state, r.revision, r.requested, \
         r.already_cached, r.measured, r.failed, r.unavailable, r.started_at, r.finished_at, \
         (SELECT COUNT(*) FROM measurement_run_queue q WHERE q.run_id = r.id AND q.settled = 0) \
         AS remaining FROM measurement_runs r WHERE r.id = ?1",
    )
    .bind(id.to_string())
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| LibraryError::NotFound(format!("measurement run {id}")))?;
    let issues = sqlx::query(
        "SELECT asset_id, kind, message FROM measurement_run_issues WHERE run_id = ?1 \
         ORDER BY position",
    )
    .bind(id.to_string())
    .fetch_all(&mut *conn)
    .await?
    .iter()
    .map(|row| {
        Ok(RunIssue {
            asset_id: parse_uuid(&row.try_get::<String, _>("asset_id")?)?,
            kind: row.try_get("kind")?,
            message: row.try_get("message")?,
        })
    })
    .collect::<Result<Vec<_>>>()?;
    let version: i64 = row.try_get("method_version")?;
    Ok(MeasurementRun {
        operation_id: id,
        revision: revision(row.try_get("revision")?)?,
        state: from_text(&row.try_get::<String, _>("state")?)?,
        method: MeasurementMethod {
            name: row.try_get("method_name")?,
            version: u32::try_from(version).map_err(|_| {
                LibraryError::PersistenceFailure(format!("corrupt method version {version}"))
            })?,
        },
        counters: RunCounters {
            requested: stored_count(row.try_get("requested")?)?,
            already_cached: stored_count(row.try_get("already_cached")?)?,
            measured: stored_count(row.try_get("measured")?)?,
            failed: stored_count(row.try_get("failed")?)?,
            unavailable: stored_count(row.try_get("unavailable")?)?,
            remaining: stored_count(row.try_get("remaining")?)?,
        },
        issues,
        started_at: row.try_get("started_at")?,
        finished_at: row.try_get("finished_at")?,
    })
}

/// Append `assets` to the run's queue after its last position.
async fn enqueue(conn: &mut SqliteConnection, run: Uuid, assets: &[Uuid]) -> Result<()> {
    let last: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(position), 0) FROM measurement_run_queue WHERE run_id = ?1",
    )
    .bind(run.to_string())
    .fetch_one(&mut *conn)
    .await?;
    for (offset, asset) in (1_i64..).zip(assets) {
        sqlx::query(
            "INSERT INTO measurement_run_queue (run_id, asset_id, position) VALUES (?1, ?2, ?3)",
        )
        .bind(run.to_string())
        .bind(asset.to_string())
        .bind(last + offset)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

async fn run_assets(conn: &mut SqliteConnection, run: Uuid) -> Result<BTreeSet<Uuid>> {
    let ids: Vec<String> =
        sqlx::query_scalar("SELECT asset_id FROM measurement_run_queue WHERE run_id = ?1")
            .bind(run.to_string())
            .fetch_all(&mut *conn)
            .await?;
    ids.iter().map(|id| parse_uuid(id)).collect()
}

async fn require_unsettled(
    conn: &mut SqliteConnection,
    run: &MeasurementRun,
    asset: Uuid,
) -> Result<()> {
    let settled: Option<i64> = sqlx::query_scalar(
        "SELECT settled FROM measurement_run_queue WHERE run_id = ?1 AND asset_id = ?2",
    )
    .bind(run.operation_id.to_string())
    .bind(asset.to_string())
    .fetch_optional(&mut *conn)
    .await?;
    match settled {
        None => Err(LibraryError::InvalidInput(format!(
            "run {} does not hold asset {asset}",
            run.operation_id
        ))),
        Some(0) => Ok(()),
        Some(_) => Err(conflict(run.operation_id, run.revision)),
    }
}

/// Settle the frame and add one to the run's revision.
async fn settle(conn: &mut SqliteConnection, run: Uuid, asset: Uuid) -> Result<()> {
    sqlx::query("UPDATE measurement_run_queue SET settled = 1 WHERE run_id = ?1 AND asset_id = ?2")
        .bind(run.to_string())
        .bind(asset.to_string())
        .execute(&mut *conn)
        .await?;
    sqlx::query("UPDATE measurement_runs SET revision = revision + 1 WHERE id = ?1")
        .bind(run.to_string())
        .execute(&mut *conn)
        .await?;
    Ok(())
}

async fn add_issue(conn: &mut SqliteConnection, run: Uuid, issue: &RunIssue) -> Result<()> {
    sqlx::query(
        "INSERT INTO measurement_run_issues (run_id, position, asset_id, kind, message) \
         VALUES (?1, (SELECT COALESCE(MAX(position), 0) + 1 FROM measurement_run_issues \
         WHERE run_id = ?1), ?2, ?3, ?4)",
    )
    .bind(run.to_string())
    .bind(issue.asset_id.to_string())
    .bind(&issue.kind)
    .bind(&issue.message)
    .execute(&mut *conn)
    .await?;
    sqlx::query("UPDATE measurement_runs SET unavailable = unavailable + 1 WHERE id = ?1")
        .bind(run.to_string())
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// Replace the asset's record for the method name and count its outcome.
async fn store_record(conn: &mut SqliteConnection, record: &MeasurementRecord) -> Result<()> {
    sqlx::query("DELETE FROM measurement_records WHERE asset_id = ?1 AND method_name = ?2")
        .bind(record.asset_id.to_string())
        .bind(&record.method.name)
        .execute(&mut *conn)
        .await?;
    let outcome = match record.outcome {
        MeasurementOutcome::Measured { .. } => "measured",
        MeasurementOutcome::Failed { .. } => "failed",
    };
    sqlx::query(
        "INSERT INTO measurement_records (id, asset_id, run_id, method_name, method_version, \
         outcome, content_sha256, record, measured_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
    )
    .bind(record.id.to_string())
    .bind(record.asset_id.to_string())
    .bind(record.run_id.to_string())
    .bind(&record.method.name)
    .bind(i64::from(record.method.version))
    .bind(outcome)
    .bind(record.basis.sha256())
    .bind(to_json(record)?)
    .bind(&record.measured_at)
    .execute(&mut *conn)
    .await?;
    let counted = match record.outcome {
        MeasurementOutcome::Measured { .. } => {
            "UPDATE measurement_runs SET measured = measured + 1 WHERE id = ?1"
        }
        MeasurementOutcome::Failed { .. } => {
            "UPDATE measurement_runs SET failed = failed + 1 WHERE id = ?1"
        }
    };
    sqlx::query(counted).bind(record.run_id.to_string()).execute(&mut *conn).await?;
    Ok(())
}

pub async fn latest_records(
    conn: &mut SqliteConnection,
    ids: &BTreeSet<Uuid>,
    method_name: &str,
) -> Result<HashMap<Uuid, MeasurementRecord>> {
    let rows: Vec<String> = sqlx::query_scalar(
        "SELECT record FROM measurement_records WHERE method_name = ?1 \
         AND asset_id IN (SELECT value FROM json_each(?2))",
    )
    .bind(method_name)
    .bind(json_ids(ids)?)
    .fetch_all(&mut *conn)
    .await?;
    rows.iter()
        .map(|text| from_json::<MeasurementRecord>(text).map(|record| (record.asset_id, record)))
        .collect()
}

async fn queued_assets(
    conn: &mut SqliteConnection,
    ids: &BTreeSet<Uuid>,
) -> Result<BTreeSet<Uuid>> {
    let rows: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT q.asset_id FROM measurement_run_queue q \
         JOIN measurement_runs r ON r.id = q.run_id \
         WHERE r.state = 'running' AND q.settled = 0 \
         AND q.asset_id IN (SELECT value FROM json_each(?1))",
    )
    .bind(json_ids(ids)?)
    .fetch_all(&mut *conn)
    .await?;
    rows.iter().map(|id| parse_uuid(id)).collect()
}

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

impl Catalog {
    /// Each non-Retired scope asset in scope order with its absolute native
    /// path, path text, basename, fingerprint and a SHA-256 already recorded
    /// for that fingerprint by the library or a measurement.
    ///
    /// # Errors
    /// `NotFound` for an unknown asset; `InvalidInput` for a path of another
    /// operating system.
    pub async fn import_candidates(&self, scope: &[Uuid]) -> Result<Vec<ImportCandidate>> {
        let ids: BTreeSet<Uuid> = scope.iter().copied().collect();
        let mut conn = self.reader().await?;
        let assets: HashMap<Uuid, Asset> = load_assets(&mut conn, &ids)
            .await?
            .into_iter()
            .map(|asset| (asset.id, asset))
            .collect();
        let recorded = recorded_digests(&mut conn, &ids).await?;
        let mut locations: HashMap<Uuid, Location> = HashMap::new();
        let mut seen = BTreeSet::new();
        let mut candidates = Vec::with_capacity(ids.len());
        for id in scope {
            let asset = &assets[id];
            if !seen.insert(*id) || asset.availability == Availability::Retired {
                continue;
            }
            if let Entry::Vacant(slot) = locations.entry(asset.location_id) {
                slot.insert(load_location(&mut conn, asset.location_id).await?);
            }
            let root = locations[&asset.location_id].path.to_path_buf()?;
            let path = root.join(asset.relative_path.relative_path()?);
            let sha256 = asset.fingerprint.content_sha256.clone().or_else(|| {
                recorded.get(id).and_then(|digests| {
                    digests
                        .iter()
                        .find(|(fingerprint, _)| {
                            fingerprint_matches(&asset.fingerprint, fingerprint)
                        })
                        .map(|(_, sha256)| sha256.clone())
                })
            });
            candidates.push(ImportCandidate {
                asset_id: *id,
                path: NativePath::from_path(&path),
                path_text: path.to_str().map(str::to_owned),
                basename: path.file_name().and_then(|name| name.to_str()).map(str::to_owned),
                fingerprint: asset.fingerprint.clone(),
                sha256,
            });
        }
        Ok(candidates)
    }

    /// Store a parsed and matched import as a durable `reviewed` proposal at
    /// revision 1. Attaches no value.
    ///
    /// # Errors
    /// `InvalidInput` for an inconsistent review: an empty or repeated scope,
    /// a candidate outside the scope, a matched row without its asset and
    /// basis, an unmatched row with one, a resolved row, a repeated line or
    /// index, a cell outside the columns or a non-finite value; `NotFound` for
    /// an unknown scope asset.
    pub async fn create_import_review(&self, review: &ImportReviewInput) -> Result<ImportReview> {
        let scope = validate_review(review)?;
        let stored = write_txn!(self, |conn| {
            load_assets(conn, &scope).await?;
            let id = Uuid::new_v4();
            let sequence: i64 = sqlx::query_scalar(
                "SELECT COALESCE(MAX(sequence), 0) + 1 FROM measurement_imports",
            )
            .fetch_one(&mut *conn)
            .await?;
            sqlx::query(
                "INSERT INTO measurement_imports (id, sequence, format, state, revision, source, \
                 module_version, psf_type, preamble, layout, scope, reviewed_at) \
                 VALUES (?1, ?2, ?3, 'reviewed', 1, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            )
            .bind(id.to_string())
            .bind(sequence)
            .bind(to_text(&review.format)?)
            .bind(to_json(&review.source)?)
            .bind(&review.module_version)
            .bind(&review.psf_type)
            .bind(to_json(&review.preamble)?)
            .bind(to_text(&review.layout)?)
            .bind(to_json(&review.scope)?)
            .bind(now()?)
            .execute(&mut *conn)
            .await?;
            for column in &review.columns {
                sqlx::query(
                    "INSERT INTO measurement_import_columns (import_id, position, body) \
                     VALUES (?1, ?2, ?3)",
                )
                .bind(id.to_string())
                .bind(i64::from(column.position))
                .bind(to_json(column)?)
                .execute(&mut *conn)
                .await?;
            }
            for row in &review.rows {
                write_row(conn, id, row, true).await?;
            }
            for (asset, basis) in &review.bases {
                sqlx::query(
                    "INSERT INTO measurement_import_bases (import_id, asset_id, basis) \
                     VALUES (?1, ?2, ?3)",
                )
                .bind(id.to_string())
                .bind(asset.to_string())
                .bind(to_json(basis)?)
                .execute(&mut *conn)
                .await?;
            }
            load_review(conn, id).await?
        });
        Ok(stored)
    }

    /// # Errors
    /// `NotFound` for an unknown review.
    pub async fn import_review(&self, id: Uuid) -> Result<ImportReview> {
        let mut conn = self.reader().await?;
        load_review(&mut conn, id).await
    }

    /// Confirm a reviewed import once: resolve ambiguous rows to listed
    /// candidates, require every attached asset to still match its review
    /// basis, then commit the state, the resolutions and the values of mapped
    /// columns together. Nothing is written on refusal.
    ///
    /// # Errors
    /// `Conflict` naming the review when it is already confirmed, or naming
    /// an attached asset that changed or was retired since review;
    /// `InvalidInput` for a resolution of a row that is not ambiguous, an asset
    /// outside the row's candidates, a row resolved twice or one asset on two
    /// rows; `NotFound` for an unknown review.
    pub async fn confirm_import(
        &self,
        id: Uuid,
        resolutions: &[RowResolution],
    ) -> Result<ConfirmedImport> {
        let confirmed = write_txn!(self, |conn| {
            let review = load_review(conn, id).await?;
            if review.state == ImportReviewState::Confirmed {
                return Err(conflict(id, review.revision));
            }
            let reviewed_bases = load_bases(conn, id).await?;
            let rows = resolve_rows(&review.rows, &reviewed_bases, resolutions)?;
            let attached: BTreeSet<Uuid> = rows.iter().filter_map(|row| row.asset_id).collect();
            let assets: HashMap<Uuid, Asset> = load_assets(conn, &attached)
                .await?
                .into_iter()
                .map(|asset| (asset.id, asset))
                .collect();
            for row in &rows {
                let (Some(asset_id), Some(basis)) = (row.asset_id, row.basis.as_ref()) else {
                    continue;
                };
                let asset = &assets[&asset_id];
                if asset.availability == Availability::Retired
                    || !fingerprint_matches(&asset.fingerprint, &reviewed_fingerprint(basis))
                {
                    return Err(conflict(asset.id, asset.observation_revision));
                }
            }
            let mapped: BTreeMap<u32, &ImportColumn> = review
                .columns
                .iter()
                .filter(|column| column.class == ColumnClass::Mapped)
                .map(|column| (column.position, column))
                .collect();
            for (row, reviewed) in rows.iter().zip(&review.rows) {
                if row.match_state != reviewed.match_state {
                    write_row(conn, id, row, false).await?;
                }
                let Some(asset_id) = row.asset_id else { continue };
                for cell in &row.values {
                    let Some(column) = mapped.get(&cell.position) else { continue };
                    let stored = StoredValue {
                        column: column.header.clone(),
                        label: format!("{} ({IMPORTED_LABEL})", column.header),
                        value: cell.value,
                        raw: cell.raw.clone(),
                        reason: cell.reason.clone(),
                        units: column.units,
                        units_basis: column.units_basis.clone(),
                        warnings: column.warnings.clone(),
                        match_state: row.match_state,
                    };
                    sqlx::query(
                        "INSERT INTO measurement_import_values \
                         (import_id, line, position, asset_id, body) VALUES (?1, ?2, ?3, ?4, ?5)",
                    )
                    .bind(id.to_string())
                    .bind(db_count(row.line)?)
                    .bind(i64::from(cell.position))
                    .bind(asset_id.to_string())
                    .bind(to_json(&stored)?)
                    .execute(&mut *conn)
                    .await?;
                }
            }
            sqlx::query(
                "UPDATE measurement_imports SET state = 'confirmed', confirmed_at = ?2, \
                 revision = revision + 1 WHERE id = ?1",
            )
            .bind(id.to_string())
            .bind(now()?)
            .execute(&mut *conn)
            .await?;
            let review = load_review(conn, id).await?;
            let rows = sqlx::query(value_sql!("WHERE v.import_id = ?1"))
                .bind(id.to_string())
                .fetch_all(&mut *conn)
                .await?;
            let values = imported_rows(&rows, &assets)?;
            let (attached, unattached) =
                review.rows.iter().cloned().partition(|row| row.asset_id.is_some());
            ConfirmedImport { review, attached, unattached, values }
        });
        Ok(confirmed)
    }

    /// Confirmed imported values of `assets`, newest import first. Each reads
    /// `unverified`; its drift is derived from the asset's current evidence
    /// against the import basis without rehashing.
    ///
    /// # Errors
    /// `NotFound` for an unknown asset.
    pub async fn imported_values(&self, assets: &[Uuid]) -> Result<Vec<ImportedValue>> {
        let ids: BTreeSet<Uuid> = assets.iter().copied().collect();
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let loaded: HashMap<Uuid, Asset> = load_assets(&mut snapshot, &ids)
            .await?
            .into_iter()
            .map(|asset| (asset.id, asset))
            .collect();
        let rows = sqlx::query(value_sql!("WHERE v.asset_id IN (SELECT value FROM json_each(?1))"))
            .bind(json_ids(&ids)?)
            .fetch_all(&mut *snapshot)
            .await?;
        snapshot.rollback().await?;
        imported_rows(&rows, &loaded)
    }
}

fn validate_review(review: &ImportReviewInput) -> Result<BTreeSet<Uuid>> {
    let invalid = |message: String| Err(LibraryError::InvalidInput(message));
    if review.scope.is_empty() {
        return invalid("an import review needs a scope".into());
    }
    let scope = unique(&review.scope)?;
    if review.source.sha256.trim().is_empty() {
        return invalid("the import source needs its SHA-256".into());
    }
    let mut positions = BTreeSet::new();
    for column in &review.columns {
        if !positions.insert(column.position) {
            return invalid(format!("column position {} is listed twice", column.position));
        }
    }
    for asset in review.bases.keys() {
        if !scope.contains(asset) {
            return invalid(format!("basis asset {asset} is outside the import scope"));
        }
    }
    let mut lines = BTreeSet::new();
    let mut indexes = BTreeSet::new();
    for row in &review.rows {
        if !lines.insert(row.line) {
            return invalid(format!("line {} is listed twice", row.line));
        }
        if let Some(index) = row.index {
            if !indexes.insert(index) {
                return invalid(format!("row index {index} is listed twice"));
            }
        }
        validate_row(row, &scope, &review.bases, &positions)?;
    }
    Ok(scope)
}

fn validate_row(
    row: &ImportRow,
    scope: &BTreeSet<Uuid>,
    bases: &BTreeMap<Uuid, ImportBasis>,
    positions: &BTreeSet<u32>,
) -> Result<()> {
    let line = row.line;
    let invalid = |message: String| Err(LibraryError::InvalidInput(message));
    if let Some(outside) = row.candidates.iter().find(|candidate| !scope.contains(candidate)) {
        return invalid(format!("line {line} lists candidate {outside} outside the import scope"));
    }
    match row.match_state {
        RowMatch::MatchedPath | RowMatch::MatchedName => {
            let attached = row.asset_id.filter(|asset| row.candidates.contains(asset));
            if attached.is_none() || row.basis.is_none() {
                return invalid(format!("matched line {line} needs its candidate asset and basis"));
            }
        }
        RowMatch::Ambiguous | RowMatch::Unmatched | RowMatch::Unparsed => {
            if row.asset_id.is_some() || row.basis.is_some() {
                return invalid(format!("line {line} is not matched and attaches no asset"));
            }
            if let Some(missing) = row.candidates.iter().find(|candidate| {
                row.match_state == RowMatch::Ambiguous && !bases.contains_key(candidate)
            }) {
                return invalid(format!("candidate {missing} of line {line} has no review basis"));
            }
        }
        RowMatch::Resolved => {
            return invalid(format!("line {line} cannot be resolved before confirmation"));
        }
    }
    for cell in &row.values {
        if !positions.contains(&cell.position) {
            return invalid(format!("line {line} has a cell at unknown column {}", cell.position));
        }
        if cell.value.is_some_and(|value| !value.is_finite()) {
            return invalid(format!("line {line} column {} is not a finite number", cell.position));
        }
    }
    Ok(())
}

/// Apply the resolutions to a review's rows; one asset per row.
fn resolve_rows(
    reviewed: &[ImportRow],
    review_bases: &BTreeMap<Uuid, ImportBasis>,
    resolutions: &[RowResolution],
) -> Result<Vec<ImportRow>> {
    let mut rows = reviewed.to_vec();
    let mut resolved = BTreeSet::new();
    for resolution in resolutions {
        let index = resolution.index;
        if !resolved.insert(index) {
            return Err(LibraryError::InvalidInput(format!("row index {index} is resolved twice")));
        }
        let row = rows
            .iter_mut()
            .find(|row| row.index == Some(index))
            .ok_or_else(|| LibraryError::InvalidInput(format!("no row has index {index}")))?;
        if row.match_state != RowMatch::Ambiguous {
            return Err(LibraryError::InvalidInput(format!(
                "row index {index} is {}; only an ambiguous row is resolved",
                to_text(&row.match_state)?
            )));
        }
        if !row.candidates.contains(&resolution.asset_id) {
            return Err(LibraryError::InvalidInput(format!(
                "asset {} is not a listed candidate of row index {index}",
                resolution.asset_id
            )));
        }
        let basis = review_bases.get(&resolution.asset_id).cloned().ok_or_else(|| {
            LibraryError::InvalidInput(format!("asset {} has no review basis", resolution.asset_id))
        })?;
        row.match_state = RowMatch::Resolved;
        row.asset_id = Some(resolution.asset_id);
        row.basis = Some(basis);
    }
    let mut attached = BTreeSet::new();
    for row in &rows {
        if let Some(asset) = row.asset_id {
            if !attached.insert(asset) {
                return Err(LibraryError::InvalidInput(format!(
                    "asset {asset} would be attached to more than one row"
                )));
            }
        }
    }
    Ok(rows)
}

/// The reviewed fingerprint with the review's digest when it records none.
fn reviewed_fingerprint(basis: &ImportBasis) -> ObservationFingerprint {
    let mut fingerprint = basis.fingerprint.clone();
    if fingerprint.content_sha256.is_none() {
        fingerprint.content_sha256.clone_from(&basis.sha256);
    }
    fingerprint
}

/// `unknown` for an unavailable asset or when neither side has a digest;
/// `differs` when the fingerprint or a recorded digest differs.
fn drift(asset: &Asset, basis: Option<&ImportBasis>) -> Drift {
    let Some(basis) = basis else { return Drift::Unknown };
    if asset.availability != Availability::Available {
        return Drift::Unknown;
    }
    let reviewed = reviewed_fingerprint(basis);
    if !fingerprint_matches(&asset.fingerprint, &reviewed) {
        Drift::Differs
    } else if reviewed.content_sha256.is_none() && asset.fingerprint.content_sha256.is_none() {
        Drift::Unknown
    } else {
        Drift::Matches
    }
}

async fn write_row(
    conn: &mut SqliteConnection,
    import: Uuid,
    row: &ImportRow,
    insert: bool,
) -> Result<()> {
    let sql = if insert {
        "INSERT INTO measurement_import_rows (import_id, line, match_state, asset_id, body) \
         VALUES (?1, ?2, ?3, ?4, ?5)"
    } else {
        "UPDATE measurement_import_rows SET match_state = ?3, asset_id = ?4, body = ?5 \
         WHERE import_id = ?1 AND line = ?2"
    };
    sqlx::query(sql)
        .bind(import.to_string())
        .bind(db_count(row.line)?)
        .bind(to_text(&row.match_state)?)
        .bind(row.asset_id.map(|id| id.to_string()))
        .bind(to_json(row)?)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

async fn load_review(conn: &mut SqliteConnection, id: Uuid) -> Result<ImportReview> {
    let row = sqlx::query(
        "SELECT state, revision, format, source, module_version, psf_type, preamble, layout, \
         scope, reviewed_at, confirmed_at FROM measurement_imports WHERE id = ?1",
    )
    .bind(id.to_string())
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| LibraryError::NotFound(format!("import review {id}")))?;
    let columns: Vec<String> = sqlx::query_scalar(
        "SELECT body FROM measurement_import_columns WHERE import_id = ?1 ORDER BY position",
    )
    .bind(id.to_string())
    .fetch_all(&mut *conn)
    .await?;
    let rows: Vec<String> = sqlx::query_scalar(
        "SELECT body FROM measurement_import_rows WHERE import_id = ?1 ORDER BY line",
    )
    .bind(id.to_string())
    .fetch_all(&mut *conn)
    .await?;
    Ok(ImportReview {
        review_id: id,
        revision: revision(row.try_get("revision")?)?,
        state: from_text(&row.try_get::<String, _>("state")?)?,
        format: from_text(&row.try_get::<String, _>("format")?)?,
        source: from_json(&row.try_get::<String, _>("source")?)?,
        module_version: row.try_get("module_version")?,
        psf_type: row.try_get("psf_type")?,
        preamble: from_json(&row.try_get::<String, _>("preamble")?)?,
        layout: from_text(&row.try_get::<String, _>("layout")?)?,
        scope: from_json(&row.try_get::<String, _>("scope")?)?,
        columns: columns.iter().map(|body| from_json(body)).collect::<Result<_>>()?,
        rows: rows.iter().map(|body| from_json(body)).collect::<Result<_>>()?,
        reviewed_at: row.try_get("reviewed_at")?,
        confirmed_at: row.try_get("confirmed_at")?,
    })
}

async fn load_bases(conn: &mut SqliteConnection, id: Uuid) -> Result<BTreeMap<Uuid, ImportBasis>> {
    sqlx::query("SELECT asset_id, basis FROM measurement_import_bases WHERE import_id = ?1")
        .bind(id.to_string())
        .fetch_all(&mut *conn)
        .await?
        .iter()
        .map(|row| {
            Ok((
                parse_uuid(&row.try_get::<String, _>("asset_id")?)?,
                from_json(&row.try_get::<String, _>("basis")?)?,
            ))
        })
        .collect()
}

/// Digests recorded by measurements, each with the fingerprint it was
/// measured on.
async fn recorded_digests(
    conn: &mut SqliteConnection,
    ids: &BTreeSet<Uuid>,
) -> Result<HashMap<Uuid, Vec<(ObservationFingerprint, String)>>> {
    let rows = sqlx::query(
        "SELECT asset_id, content_sha256, json_extract(record, '$.basis.fingerprint') AS basis \
         FROM measurement_records WHERE content_sha256 IS NOT NULL \
         AND asset_id IN (SELECT value FROM json_each(?1))",
    )
    .bind(json_ids(ids)?)
    .fetch_all(&mut *conn)
    .await?;
    let mut digests: HashMap<Uuid, Vec<(ObservationFingerprint, String)>> = HashMap::new();
    for row in &rows {
        let asset = parse_uuid(&row.try_get::<String, _>("asset_id")?)?;
        let fingerprint = from_json(&row.try_get::<String, _>("basis")?)?;
        digests.entry(asset).or_default().push((fingerprint, row.try_get("content_sha256")?));
    }
    Ok(digests)
}

fn imported_rows(rows: &[SqliteRow], assets: &HashMap<Uuid, Asset>) -> Result<Vec<ImportedValue>> {
    rows.iter()
        .map(|row| {
            let asset_id = parse_uuid(&row.try_get::<String, _>("asset_id")?)?;
            let stored: StoredValue = from_json(&row.try_get::<String, _>("body")?)?;
            let basis: Option<ImportBasis> =
                row.try_get::<Option<String>, _>("basis")?.as_deref().map(from_json).transpose()?;
            let asset = assets.get(&asset_id).ok_or_else(|| {
                LibraryError::PersistenceFailure(format!(
                    "imported value of unloaded asset {asset_id}"
                ))
            })?;
            let position: i64 = row.try_get("position")?;
            Ok(ImportedValue {
                import_id: parse_uuid(&row.try_get::<String, _>("import_id")?)?,
                asset_id,
                column: stored.column,
                position: u32::try_from(position).map_err(|_| {
                    LibraryError::PersistenceFailure(format!("corrupt column position {position}"))
                })?,
                label: stored.label,
                value: stored.value,
                raw: stored.raw,
                reason: stored.reason,
                units: stored.units,
                units_basis: stored.units_basis,
                warnings: stored.warnings,
                source: ValueSource::Imported {
                    format: from_text(&row.try_get::<String, _>("format")?)?,
                    module_version: row.try_get("module_version")?,
                    psf_type: row.try_get("psf_type")?,
                },
                match_state: stored.match_state,
                verification: ImportVerification::Unverified,
                drift: drift(asset, basis.as_ref()),
                imported_at: row.try_get::<Option<String>, _>("confirmed_at")?.ok_or_else(
                    || {
                        LibraryError::PersistenceFailure(format!(
                            "imported value of asset {asset_id} has an unconfirmed import"
                        ))
                    },
                )?,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use platevault_model::{
        CaptureKey, CaptureMetadata, DecodedBasis, FileIdentity, GroupingResult, ImageFormat,
        ImportCell, InputBasis, LocationRole, MaskCounts, MetricId, MetricValue, PathSensitivity,
        PlaneBasis, SampleFormat, SaturationBasis, SaturationSource, Scaling, ScanBatch, ScanFile,
        SessionCandidate, StarModel, StarRecord, StarState, VolumeIdentity,
    };

    use super::*;
    use crate::LocationRegistration;

    const FRAMES: u32 = 300;
    const MAPPED: u32 = 10;

    fn method() -> MeasurementMethod {
        MeasurementMethod::new("platevault.stars", 1)
    }

    /// One location with `FRAMES` scanned light frames on a synthetic volume.
    async fn indexed(dir: &Path) -> (Catalog, Vec<Asset>) {
        let catalog = Catalog::open(&dir.join("catalog.sqlite")).await.unwrap();
        let root = dir.join("root");
        std::fs::create_dir(&root).unwrap();
        let identity = FileIdentity {
            volume: VolumeIdentity {
                filesystem: "apfs".into(),
                stable_id: Some("vol-measurements".into()),
                file_ids_stable: false,
                case: PathSensitivity::Sensitive,
                normalization: PathSensitivity::Sensitive,
            },
            file_id: None,
        };
        let location = catalog
            .register_location(&LocationRegistration {
                name: "root".into(),
                path: NativePath::from_path(&root),
                role: LocationRole::Captures,
                identity: identity.clone(),
                volume_kind: platevault_model::VolumeKind::Local,
            })
            .await
            .unwrap();
        let files = (0..FRAMES)
            .map(|frame| ScanFile {
                relative_path: NativePath::from_path(Path::new(&format!("f{frame:03}.fits"))),
                fingerprint: ObservationFingerprint {
                    identity: identity.clone(),
                    size_bytes: 2880,
                    modified_ns: i128::from(frame) + 1,
                    content_sha256: None,
                },
                format: ImageFormat::Fits,
                metadata: CaptureMetadata {
                    image_type: Some("LIGHT".into()),
                    filter: Some("Ha".into()),
                    exposure_seconds: Some(60.0),
                    ..CaptureMetadata::default()
                },
            })
            .collect();
        let operation = catalog.begin_scan(location.id, None).await.unwrap();
        let batch = ScanBatch { files, ..ScanBatch::default() };
        catalog
            .apply_scan_batch(operation.id, &identity, &batch, |assets: &[Asset]| GroupingResult {
                sessions: vec![SessionCandidate {
                    key: CaptureKey("Ha".into()),
                    asset_ids: assets.iter().map(|asset| asset.id).collect(),
                    provisional: Vec::new(),
                    date_basis: None,
                }],
            })
            .await
            .unwrap();
        let assets = catalog.location_assets(location.id).await.unwrap();
        (catalog, assets)
    }

    /// A measured record with 2000 fitted stars.
    fn large_record(asset: &Asset, run: Uuid) -> MeasurementRecord {
        let method = method();
        let mut fingerprint = asset.fingerprint.clone();
        fingerprint.content_sha256 = Some("ab".repeat(32));
        let stars = (0..2000_u32)
            .map(|index| StarRecord {
                index,
                x: f64::from(index % 100) + 0.25,
                y: f64::from(index / 100) + 0.75,
                state: StarState::Fitted,
                reasons: Vec::new(),
                warnings: Vec::new(),
                peak: 1200.5,
                flux: 15_000.25,
                local_background: 1000.125,
                box_radius: 8,
                model: Some(StarModel::EllipticalGaussian),
                fwhm_major_px: Some(3.25),
                fwhm_minor_px: Some(3.0),
                fwhm_px: Some(3.122),
                eccentricity: Some(0.384),
                position_angle_deg: Some(42.5),
                hfr_px: Some(1.875),
            })
            .collect();
        MeasurementRecord {
            id: Uuid::new_v4(),
            asset_id: asset.id,
            run_id: run,
            method: method.clone(),
            dequeue_sequence: 1,
            basis: InputBasis {
                fingerprint,
                container: ImageFormat::Fits,
                decoded: Some(DecodedBasis {
                    plane: PlaneBasis::Mono,
                    plane_count: 1,
                    sample_format: SampleFormat::Uint16,
                    scaling: Scaling { zero: 0.0, scale: 1.0 },
                    blank: None,
                    width: 1000,
                    height: 1000,
                    saturation: SaturationBasis {
                        level: Some(65535.0),
                        source: SaturationSource::TypeMaximum,
                    },
                }),
            },
            outcome: MeasurementOutcome::Measured {
                metrics: vec![MetricValue::measured(MetricId::FwhmMedian, Units::Px, 3.1, &method)],
                stars,
                masks: MaskCounts::default(),
                truncated: true,
            },
            measured_at: "2026-10-05T10:00:00Z".into(),
        }
    }

    /// Every asset matched by path with `MAPPED` mapped cells: 3000 values.
    fn review(assets: &[Asset]) -> ImportReviewInput {
        let mut columns = vec![identity_column("Index", 0), identity_column("File", 1)];
        columns.extend((0..MAPPED).map(|offset| ImportColumn {
            header: format!("Metric {offset}"),
            position: offset + 2,
            class: ColumnClass::Mapped,
            units: Some(Units::Px),
            units_basis: vec![PreambleEntry { key: "Scale Unit".into(), value: "px".into() }],
            reason: None,
            warnings: Vec::new(),
        }));
        let rows = (1_u64..)
            .zip(assets)
            .map(|(index, asset)| ImportRow {
                line: index + 1,
                index: Some(index),
                file: format!("/elsewhere/{}", asset.relative_path.display()),
                match_state: RowMatch::MatchedName,
                reason: None,
                candidates: vec![asset.id],
                asset_id: Some(asset.id),
                basis: Some(ImportBasis { fingerprint: asset.fingerprint.clone(), sha256: None }),
                values: (0..MAPPED)
                    .map(|offset| ImportCell {
                        position: offset + 2,
                        raw: format!("{offset}.5"),
                        value: Some(f64::from(offset) + 0.5),
                        reason: None,
                    })
                    .collect(),
            })
            .collect();
        ImportReviewInput {
            format: ImportFormat::SubframeSelectorCsv,
            source: ImportSource {
                path: NativePath::from_path(Path::new("/elsewhere/measurements.csv")),
                size_bytes: 4096,
                sha256: "cd".repeat(32),
            },
            module_version: Some("1.9.3".into()),
            psf_type: Some("Moffat4".into()),
            preamble: vec![PreambleEntry { key: "Scale Unit".into(), value: "px".into() }],
            layout: ExportLayout::Columns30,
            scope: assets.iter().map(|asset| asset.id).collect(),
            columns,
            rows,
            bases: BTreeMap::new(),
        }
    }

    fn identity_column(header: &str, position: u32) -> ImportColumn {
        ImportColumn {
            header: header.into(),
            position,
            class: ColumnClass::Identity,
            units: None,
            units_basis: Vec::new(),
            reason: None,
            warnings: Vec::new(),
        }
    }

    fn kind(error: &LibraryError) -> String {
        error.response(None, None).kind
    }

    /// A disposable `max_page_count` catalog: each write reports
    /// `PersistenceFailure` for `SQLITE_FULL`, nothing persists after reopen
    /// and an unlimited retry succeeds. Each write runs on its own limited
    /// open: `SQLite` may roll an `SQLITE_FULL` transaction back itself, and
    /// the writer then refuses further transactions until it is reopened.
    #[tokio::test]
    async fn sqlite_full_fails_measurement_and_confirmation_writes_with_nothing_persisted() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("catalog.sqlite");
        let (catalog, assets) = indexed(dir.path()).await;
        let ids: Vec<Uuid> = assets.iter().map(|asset| asset.id).collect();
        let run = catalog.begin_measurement_run(&method(), &ids[..1], 0).await.unwrap();
        let reviewed = catalog.create_import_review(&review(&assets)).await.unwrap();
        let record = large_record(&assets[0], run.operation_id);
        catalog.limit_writer_pages_for_test().await.unwrap();
        let error = catalog.record_measurement(run.operation_id, &record).await.unwrap_err();
        assert_eq!(kind(&error), "persistence_failure", "{error}");
        assert!(error.to_string().contains("full"), "{error}");
        let running = catalog.measurement_run(run.operation_id).await.unwrap();
        assert_eq!((running.state, running.revision), (RunState::Running, run.revision));
        assert_eq!(running.counters.remaining, 1);
        catalog.close().await.unwrap();

        let limited = Catalog::open(&path).await.unwrap();
        limited.limit_writer_pages_for_test().await.unwrap();
        let error = limited.confirm_import(reviewed.review_id, &[]).await.unwrap_err();
        assert_eq!(kind(&error), "persistence_failure", "{error}");
        assert!(error.to_string().contains("full"), "{error}");
        assert_eq!(limited.import_review(reviewed.review_id).await.unwrap(), reviewed);
        limited.close().await.unwrap();

        let reopened = Catalog::open(&path).await.unwrap();
        assert_eq!(kind(&reopened.measurement(record.id).await.unwrap_err()), "not_found");
        let interrupted = reopened.measurement_run(run.operation_id).await.unwrap();
        assert_eq!(interrupted.state, RunState::Interrupted);
        assert_eq!(interrupted.counters.measured, 0);
        assert_eq!(reopened.import_review(reviewed.review_id).await.unwrap(), reviewed);
        assert!(reopened.imported_values(&ids).await.unwrap().is_empty());
        let records = reopened.frame_records(&ids[..1], &method()).await.unwrap();
        assert!(records[0].record.is_none());

        let retry = reopened.begin_measurement_run(&method(), &ids[..1], 0).await.unwrap();
        let record = large_record(&assets[0], retry.operation_id);
        let retried = reopened.record_measurement(retry.operation_id, &record).await.unwrap();
        assert_eq!((retried.counters.measured, retried.counters.remaining), (1, 0));
        assert_eq!(reopened.measurement(record.id).await.unwrap(), record);
        let confirmed = reopened.confirm_import(reviewed.review_id, &[]).await.unwrap();
        assert_eq!(confirmed.review.state, ImportReviewState::Confirmed);
        assert_eq!(confirmed.values.len(), (FRAMES * MAPPED) as usize);
    }
}
