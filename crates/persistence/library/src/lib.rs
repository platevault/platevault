// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Clean durable `SQLite` library catalog: the sanctioned library schema and sole writer.
//!
//! One serialized writer connection commits every mutation inside `BEGIN IMMEDIATE`
//! and reports success only after `COMMIT`; readers use separate read-only
//! connections. Decision revisions are per record and independent of scan
//! observation sequences. Source files are only ever opened for reading: content
//! digests are computed lazily for reviewed decisions and verified remaps, and the
//! digest lives in the fingerprint it was computed for, so a changed observation
//! invalidates it.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, UNIX_EPOCH};

use platevault_model::{
    logical_quality, ApplicableQuality, Asset, AssetReference, Association, AssociationKind,
    AssociationState, Availability, CaptureKey, CaptureMetadata, CorrectionInput,
    CoverageContribution, DigestEvidence, Equipment, EvidenceItem, ExpectedAsset, ExpectedSession,
    FileIdentity, GroupingResult, LibraryError, Location, LocationLifecycle, LocationRole,
    NativePath, ObservationFingerprint, PathSensitivity, Provenance, Quality, ReferenceKind,
    RemapBlock, RemapBlockReason, RemapItem, RemapReview, RetireAsset, RetireReview, RetireSession,
    Revision, ScanBatch, ScanFile, ScanIssue, ScanObservation, ScanOperation, ScanProgress,
    ScanState, Session, SessionCandidate, SessionLineage, TargetCandidate, TargetCone,
    TargetCoverage, TargetRecord, VolumeIdentity,
};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::sqlite::{
    SqliteConnectOptions, SqliteConnection, SqliteJournalMode, SqlitePool, SqlitePoolOptions,
    SqliteRow, SqliteSynchronous,
};
use sqlx::{Connection, Row};
use tokio::sync::Mutex;
use uuid::Uuid;

type Result<T, E = LibraryError> = std::result::Result<T, E>;

const SCHEMA: &str = include_str!("schema.sql");
const SCHEMA_VERSION: i64 = 5;
const BUSY_TIMEOUT: Duration = Duration::from_secs(10);
const READER_CONNECTIONS: u32 = 4;
const MAX_PAGE: u32 = 1000;
const HASH_BUFFER: usize = 1 << 20;

/// Run one writer transaction: `BEGIN IMMEDIATE`, body, `COMMIT`. An early `?`
/// drops the transaction, which rolls back before the writer is reused.
macro_rules! write_txn {
    ($catalog:expr, |$conn:ident| $body:expr) => {{
        let mut writer = $catalog.writer.lock().await;
        let mut txn = writer.begin_with("BEGIN IMMEDIATE").await?;
        let $conn: &mut SqliteConnection = &mut txn;
        let value = $body;
        txn.commit().await?;
        drop(writer);
        value
    }};
}

macro_rules! asset_sql {
    ($tail:literal) => {
        concat!(
            "SELECT a.id, a.location_id, a.path_key, a.fingerprint, a.format, a.availability, ",
            "a.observed, a.effective, a.observation_revision, a.decision_revision, a.quality, ",
            "a.quality_basis, a.verification_pending, a.last_observed_at, ",
            "l.availability AS location_availability, l.lifecycle AS location_lifecycle ",
            "FROM assets a JOIN locations l ON l.id = a.location_id ",
            $tail
        )
    };
}

/// Actual writer-connection settings read back with `PRAGMA` after open.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriterSettings {
    pub journal_mode: String,
    /// `SQLite` synchronous level; 2 is FULL.
    pub synchronous: i64,
    pub foreign_keys: bool,
    pub fullfsync: bool,
    pub checkpoint_fullfsync: bool,
}

impl WriterSettings {
    fn require_durable(&self) -> Result<()> {
        let platform = !cfg!(target_os = "macos") || (self.fullfsync && self.checkpoint_fullfsync);
        if self.journal_mode == "wal" && self.synchronous == 2 && self.foreign_keys && platform {
            Ok(())
        } else {
            Err(LibraryError::PersistenceFailure(format!(
                "writer durability settings were not applied: {self:?}"
            )))
        }
    }
}

/// Read-only access intent for a user-selected root; registration scans nothing.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocationRegistration {
    pub name: String,
    pub path: NativePath,
    pub role: LocationRole,
    /// Observed volume and root-folder identity of `path`.
    pub identity: FileIdentity,
}

/// Last recorded access failure of a location, kept until access is restored.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocationFailure {
    pub availability: Availability,
    pub reason: String,
    pub recorded_at: String,
}

/// References to one location's copies, read outside the catalog from the
/// features that hold asset ids (Views, Projects, Results).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocationReferences {
    /// The location's assets the references were read for.
    pub assets: BTreeSet<Uuid>,
    pub references: Vec<AssetReference>,
    /// Reference kinds whose records were read.
    pub consulted: Vec<ReferenceKind>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionQuery {
    pub location_id: Option<Uuid>,
    pub include_superseded: bool,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub session: Session,
    pub location_ids: Vec<Uuid>,
    pub asset_count: u64,
    /// Logical captures: content-identical copies in different locations count once.
    pub capture_count: u64,
    pub availability: Availability,
    /// Last recorded observation; never a claim about current live bytes.
    pub last_observed_at: Option<String>,
    pub provisional: bool,
    /// Successor sessions when this record was superseded by a regroup.
    pub successors: Vec<Uuid>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDetail {
    pub summary: SessionSummary,
    pub assets: Vec<Asset>,
    /// Each logical capture once, naming every physical copy (D16).
    pub members: Vec<SessionMember>,
    pub associations: Vec<Association>,
    pub lineage: Vec<SessionLineage>,
}

/// One logical capture of a session (D16): every recorded physical copy joined by
/// equal SHA-256 across registered locations or by a recorded copy link, Missing
/// ones included, listed once. An asset without such a copy is its own member.
/// Every copy stays registered and protected; each copy's availability is on its
/// asset.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMember {
    pub copies: Vec<Uuid>,
    pub content_sha256: Option<String>,
    pub applicable_quality: ApplicableQuality,
    /// Unhashed and matching a copy in another location by size, capture key and a
    /// known start time; totals stay provisional until it is hashed.
    pub duplicate_candidate: bool,
}

/// Result of applying (or proposing) catalog corrections plus their regroup.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CorrectionOutcome {
    pub correction_id: Uuid,
    pub assets: Vec<Asset>,
    /// Current sessions holding the corrected assets after the change.
    pub sessions: Vec<Session>,
    /// Superseded session records, preserved unchanged for traceability.
    pub predecessors: Vec<Session>,
    pub lineage: Option<SessionLineage>,
}

/// Durable reviewed correction plan; confirming it re-validates every input.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CorrectionPreview {
    pub id: Uuid,
    pub expected: Vec<ExpectedAsset>,
    pub corrections: Vec<CorrectionInput>,
    /// Proposed outcome computed in a rolled-back transaction; its ids are provisional.
    pub proposal: CorrectionOutcome,
    pub confirmed_correction: Option<Uuid>,
    pub created_at: String,
}

/// Automatic association evidence; never a confirmation.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestedAssociation {
    pub session_id: Uuid,
    pub grouping_revision: Revision,
    pub kind: AssociationKind,
    pub subject_id: Option<Uuid>,
    pub state: AssociationState,
    pub evidence: Vec<EvidenceItem>,
    pub provenance: Provenance,
    /// Exact current member observations the evidence was assessed against,
    /// copied from `SessionDetail.assets` (asset id → fingerprint).
    pub expected_observations: BTreeMap<Uuid, ObservationFingerprint>,
    /// Asset id → `decision_revision` (catalog corrections and decisions).
    pub expected_decisions: BTreeMap<Uuid, Revision>,
    /// Asset id → `observation_revision` (recorded header evidence sequence).
    pub expected_observation_revisions: BTreeMap<Uuid, Revision>,
}

/// Read-only source probing supplied by the inventory owner.
///
/// The catalog adds its own no-follow ancestor and open-handle checks below the
/// root and hashes the bytes itself; it never writes to sources.
pub trait SourceProbe: Send + Sync + 'static {
    /// No-follow fingerprint of a regular file, without a content digest.
    ///
    /// # Errors
    /// Source access errors; `InvalidInput` for directories, links and junctions.
    fn fingerprint(&self, path: &Path) -> Result<ObservationFingerprint>;
    /// No-follow revalidation of the location's registered volume and root folder.
    ///
    /// # Errors
    /// Source access errors or `IdentityConflict` when the root cannot be qualified.
    fn root_identity(&self, location: &Location) -> Result<FileIdentity>;
}

pub struct Catalog {
    writer: Mutex<SqliteConnection>,
    readers: SqlitePool,
    /// Test-only call made on the search thread before each stale-root search.
    #[cfg(test)]
    stale_search_hook: Arc<Mutex<Option<Box<dyn FnMut() + Send>>>>,
}

#[derive(Clone, Copy)]
enum Cause {
    Correction(Uuid),
    Scan(Uuid),
}

impl Cause {
    const fn id(self) -> Uuid {
        match self {
            Self::Correction(id) | Self::Scan(id) => id,
        }
    }
    const fn label(self) -> &'static str {
        match self {
            Self::Correction(_) => "correction",
            Self::Scan(_) => "scan",
        }
    }
}

struct OperationRow {
    id: Uuid,
    location_id: Uuid,
    scope: NativePath,
    state: ScanState,
    root_identity: FileIdentity,
    location_revision: Revision,
    progress: ScanProgress,
    complete: Vec<NativePath>,
    incomplete: Vec<NativePath>,
    identity_verified: bool,
    revision: Revision,
    started_at: String,
    finished_at: Option<String>,
}

struct SessionRow {
    session: Session,
    superseded_by: Option<i64>,
}

struct PriorSession {
    key: CaptureKey,
    members: BTreeSet<Uuid>,
}

#[derive(Default)]
struct GroupPlan {
    kept: Vec<(Uuid, SessionCandidate, BTreeSet<Uuid>)>,
    created: Vec<SessionCandidate>,
    superseded: BTreeSet<Uuid>,
}

type DigestMap = HashMap<Vec<u8>, Result<String>>;
type AssociationIndex = HashMap<(Uuid, &'static str), Association>;

impl Catalog {
    /// Open or create a clean catalog file with one durable writer and separate readers.
    ///
    /// Interrupted Running scans are recorded Partial with their scope incomplete.
    ///
    /// # Errors
    /// `PersistenceFailure` when the file cannot be opened or WAL/FULL/foreign-key
    /// (and macOS fullfsync) settings are not in effect; `InvalidInput` for a foreign
    /// or legacy database.
    pub async fn open(path: &Path) -> Result<Self> {
        let base = SqliteConnectOptions::new().filename(path).busy_timeout(BUSY_TIMEOUT);
        let writer_options = durable(
            base.clone()
                .create_if_missing(true)
                .journal_mode(SqliteJournalMode::Wal)
                .synchronous(SqliteSynchronous::Full)
                .foreign_keys(true),
        );
        let mut writer = SqliteConnection::connect_with(&writer_options).await?;
        read_settings(&mut writer).await?.require_durable()?;
        install_schema(&mut writer).await?;
        recover_interrupted(&mut writer).await?;
        let readers = SqlitePoolOptions::new()
            .max_connections(READER_CONNECTIONS)
            .connect_with(base.read_only(true))
            .await?;
        Ok(Self {
            writer: Mutex::new(writer),
            readers,
            #[cfg(test)]
            stale_search_hook: Arc::default(),
        })
    }

    /// Close readers and the writer, flushing the WAL connection cleanly.
    ///
    /// # Errors
    /// `PersistenceFailure` when the writer cannot be closed.
    pub async fn close(self) -> Result<()> {
        self.readers.close().await;
        self.writer.into_inner().close().await?;
        Ok(())
    }

    /// Read back the settings actually applied to the writer connection.
    ///
    /// # Errors
    /// `PersistenceFailure` when a `PRAGMA` cannot be read.
    pub async fn writer_settings(&self) -> Result<WriterSettings> {
        let mut writer = self.writer.lock().await;
        let settings = read_settings(&mut writer).await;
        drop(writer);
        settings
    }

    async fn reader(&self) -> Result<sqlx::pool::PoolConnection<sqlx::Sqlite>> {
        Ok(self.readers.acquire().await?)
    }

    /// Restrict the writer's database size so the next growth fails with `SQLITE_FULL`.
    ///
    /// # Errors
    /// `PersistenceFailure` when the limit cannot be applied.
    #[cfg(test)]
    pub async fn limit_writer_pages_for_test(&self) -> Result<i64> {
        let mut writer = self.writer.lock().await;
        let pages: i64 = sqlx::query_scalar("PRAGMA page_count").fetch_one(&mut *writer).await?;
        let limit: i64 =
            sqlx::query_scalar(sqlx::AssertSqlSafe(format!("PRAGMA max_page_count = {pages}")))
                .fetch_one(&mut *writer)
                .await?;
        drop(writer);
        Ok(limit)
    }
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

impl Catalog {
    /// Register a root for read-only indexing; nothing is scanned or modified.
    ///
    /// A registered root on the volume that no longer resolves is searched for in
    /// the folder before the writer lock is taken, so the search delays no write.
    ///
    /// # Errors
    /// `InvalidInput` for an empty name or relative path; `IdentityConflict` for an
    /// unqualified volume/root identity, a same/ancestor/descendant root already
    /// registered on the same volume, or a registered root there that no longer
    /// resolves and is not proven absent from the folder; `Conflict` on such a root
    /// when roots kept changing while the folder was searched.
    pub async fn register_location(&self, input: &LocationRegistration) -> Result<Location> {
        let name = valid_name(&input.name)?;
        require_absolute(&input.path)?;
        require_root_identity(&input.identity)?;
        let id = Uuid::new_v4();
        let mut attempt = 1;
        loop {
            let searched = self.search_stale_roots(None, &input.path, &input.identity).await?;
            let registered = write_txn!(self, |conn| {
                if let Some(stale) =
                    recheck_overlap(conn, None, &input.path, &input.identity, &searched).await?
                {
                    Err(stale)
                } else {
                    insert_location(conn, id, name, input).await?;
                    Ok(load_location(conn, id).await?)
                }
            });
            match registered {
                Ok(location) => return Ok(location),
                Err(stale) => search_again(&mut attempt, &stale)?,
            }
        }
    }

    /// Rename a location with a decision-revision check.
    ///
    /// # Errors
    /// `Conflict` with the current revision when `expected_revision` is stale.
    pub async fn update_location(
        &self,
        id: Uuid,
        expected_revision: Revision,
        name: &str,
    ) -> Result<Location> {
        let name = valid_name(name)?;
        let location = write_txn!(self, |conn| {
            let current = load_location(conn, id).await?;
            require_revision(id, current.decision_revision, expected_revision)?;
            sqlx::query(
                "UPDATE locations SET name = ?1, decision_revision = decision_revision + 1 \
                 WHERE id = ?2",
            )
            .bind(name)
            .bind(id.to_string())
            .execute(&mut *conn)
            .await?;
            load_location(conn, id).await?
        });
        Ok(location)
    }

    /// Restore access through a re-chosen path that proves the same volume and root.
    ///
    /// # Errors
    /// `Conflict` for a stale revision; `IdentityConflict` when the folder is not the
    /// registered root (a remap review is required) or overlaps another location;
    /// `InvalidInput` for a retired location.
    pub async fn reselect_location(
        &self,
        id: Uuid,
        expected_revision: Revision,
        path: &NativePath,
        identity: &FileIdentity,
    ) -> Result<Location> {
        require_absolute(path)?;
        require_root_identity(identity)?;
        let location = write_txn!(self, |conn| {
            let current = load_location(conn, id).await?;
            require_active(&current, "reselected")?;
            require_revision(id, current.decision_revision, expected_revision)?;
            if !same_root(&current.identity, identity) {
                return Err(scoped(
                    LibraryError::IdentityConflict(
                        "chosen folder is not the registered volume and root; review a remap"
                            .into(),
                    ),
                    path.clone(),
                    Some(id),
                ));
            }
            plan_overlap(conn, Some(id), path, identity, StaleRoots::Compare).await?;
            sqlx::query(
                "UPDATE locations SET path_key = ?1, availability = 'available', \
                 unavailable_reason = NULL, unavailable_at = NULL, \
                 decision_revision = decision_revision + 1 WHERE id = ?2",
            )
            .bind(path_key(path))
            .bind(id.to_string())
            .execute(&mut *conn)
            .await?;
            load_location(conn, id).await?
        });
        Ok(location)
    }

    /// Record that a location is offline, unreadable or a different identity.
    ///
    /// Assets keep last-observed metadata and decisions. A Running scan of the
    /// location records the same reason as an issue at its root scope.
    ///
    /// # Errors
    /// `InvalidInput` for an Available/Missing state, an empty reason or a retired
    /// location, which keeps the last-observed state it was retired with.
    pub async fn mark_location_unavailable(
        &self,
        id: Uuid,
        availability: Availability,
        reason: &str,
    ) -> Result<Location> {
        if !matches!(
            availability,
            Availability::Offline | Availability::Unreadable | Availability::IdentityConflict
        ) {
            return Err(LibraryError::InvalidInput(
                "location unavailability must be Offline, Unreadable or IdentityConflict".into(),
            ));
        }
        let reason = valid_reason(reason)?;
        let location = write_txn!(self, |conn| {
            let current = load_location(conn, id).await?;
            require_active(&current, "marked unavailable")?;
            set_location_unavailable(conn, id, availability, reason).await?;
            if let Some(operation) = running_operation(conn, id).await? {
                let op = load_operation_row(conn, operation).await?;
                let root = root_scope(&current.path);
                add_issue(conn, op.id, &root, reason, availability).await?;
                mark_scope_incomplete(conn, op.id, &root).await?;
            }
            load_location(conn, id).await?
        });
        Ok(location)
    }

    /// Last recorded access failure, or `None` while the location is available.
    ///
    /// # Errors
    /// `NotFound` for an unknown location.
    pub async fn location_failure(&self, id: Uuid) -> Result<Option<LocationFailure>> {
        let mut conn = self.reader().await?;
        let row = sqlx::query(
            "SELECT availability, unavailable_reason, unavailable_at FROM locations WHERE id = ?1",
        )
        .bind(id.to_string())
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| LibraryError::NotFound(format!("location {id}")))?;
        let availability: Availability = from_text(&row.try_get::<String, _>("availability")?)?;
        let reason: Option<String> = row.try_get("unavailable_reason")?;
        let recorded_at: Option<String> = row.try_get("unavailable_at")?;
        Ok(match (availability, reason, recorded_at) {
            (Availability::Available, _, _) | (_, None, _) | (_, _, None) => None,
            (availability, Some(reason), Some(recorded_at)) => {
                Some(LocationFailure { availability, reason, recorded_at })
            }
        })
    }

    /// # Errors
    /// `NotFound` for an unknown location.
    pub async fn location(&self, id: Uuid) -> Result<Location> {
        let mut conn = self.reader().await?;
        load_location(&mut conn, id).await
    }

    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn list_locations(&self) -> Result<Vec<Location>> {
        let mut conn = self.reader().await?;
        let rows = sqlx::query("SELECT * FROM locations ORDER BY created_at, id")
            .fetch_all(&mut *conn)
            .await?;
        rows.iter().map(location_from_row).collect()
    }
}

// ---------------------------------------------------------------------------
// Scans
// ---------------------------------------------------------------------------

impl Catalog {
    /// Record a Running scan of the location (or a relative subtree).
    ///
    /// # Errors
    /// `InvalidInput` for an escaping scope, a retired location or when a scan is
    /// already running.
    pub async fn begin_scan(
        &self,
        location_id: Uuid,
        scope: Option<NativePath>,
    ) -> Result<ScanOperation> {
        let id = Uuid::new_v4();
        let operation = write_txn!(self, |conn| {
            let location = load_location(conn, location_id).await?;
            require_active(&location, "rescanned")?;
            let scope = scope.unwrap_or_else(|| root_scope(&location.path));
            scope
                .relative_path()
                .map_err(|error| scoped(error, scope.clone(), Some(location_id)))?;
            if running_operation(conn, location_id).await?.is_some() {
                return Err(LibraryError::InvalidInput(
                    "a scan is already running for this location".into(),
                ));
            }
            insert_operation(conn, id, &location, &scope).await?;
            load_operation(conn, id).await?
        });
        Ok(operation)
    }

    /// Record a new scan of a failed subtree; uncertain scopes never imply Missing.
    ///
    /// # Errors
    /// `InvalidInput` for the root scope or an escaping path.
    pub async fn retry_scope(&self, location_id: Uuid, scope: NativePath) -> Result<ScanOperation> {
        if components(&scope).is_empty() {
            return Err(LibraryError::InvalidInput(
                "retry needs a subtree; scan the whole location instead".into(),
            ));
        }
        self.begin_scan(location_id, Some(scope)).await
    }

    /// Persist one progressive scan batch and regroup the touched assets.
    ///
    /// `root_identity` is observed immediately before this call; it is compared in
    /// the transaction with the location record and the scan's begin snapshot, and
    /// never written back. A mismatch commits only the downgrade (incomplete scope,
    /// issue, location availability) and refuses the batch.
    ///
    /// # Errors
    /// `IdentityConflict`/`SourceUnavailable` with location context on a root mismatch;
    /// `InvalidInput` for files outside the operation scope or invalid issues.
    pub async fn apply_scan_batch<G>(
        &self,
        operation_id: Uuid,
        root_identity: &FileIdentity,
        batch: &ScanBatch,
        mut grouping: G,
    ) -> Result<ScanOperation>
    where
        G: FnMut(&[Asset]) -> GroupingResult,
    {
        let files: Vec<&ScanFile> = batch.files.iter().collect();
        let issues: Vec<&ScanIssue> = batch.issues.iter().collect();
        let digests = self.decided_digests(operation_id, &files).await?;
        let mut writer = self.writer.lock().await;
        let mut txn = writer.begin_with("BEGIN IMMEDIATE").await?;
        let op = load_operation_row(&mut txn, operation_id).await?;
        require_running(&op)?;
        let location = load_location(&mut txn, op.location_id).await?;
        if let Err(error) = verify_root(&location, &op, root_identity) {
            downgrade(&mut txn, &op, &location, &error).await?;
            txn.commit().await?;
            drop(writer);
            return Err(scoped(error, location.path, Some(location.id)));
        }
        arm_verification(&mut txn, &op).await?;
        let changed = observe_batch(&mut txn, &op, &location, &files, &issues, &digests).await?;
        sqlx::query(
            "UPDATE scan_operations SET progress = ?1, revision = revision + 1 WHERE id = ?2",
        )
        .bind(to_json(&batch.progress)?)
        .bind(op.id.to_string())
        .execute(&mut *txn)
        .await?;
        regroup(&mut txn, &changed.regroup, &mut grouping, Cause::Scan(op.id)).await?;
        invalidate_inferences(&mut txn, &changed.evidence).await?;
        mark_location_observed(&mut txn, location.id).await?;
        let status = load_operation(&mut txn, op.id).await?;
        txn.commit().await?;
        drop(writer);
        Ok(status)
    }

    /// Persist the terminal observation and reconcile provable absence.
    ///
    /// `root_check` revalidates the root inside this transaction. Missing is recorded
    /// only for Completed/Partial observations whose identity was verified for every
    /// batch, under a complete scope and outside every incomplete or issue scope.
    /// Files and issues this operation's batches already applied are not read,
    /// hashed or recorded again; the batch proof stands for this scan.
    ///
    /// # Errors
    /// Root mismatch errors after committing the downgrade; `InvalidInput` for a
    /// Running observation or another location's observation.
    pub async fn finish_scan<R, G>(
        &self,
        operation_id: Uuid,
        observation: &ScanObservation,
        mut root_check: R,
        mut grouping: G,
    ) -> Result<ScanOperation>
    where
        R: FnMut(&Location) -> Result<FileIdentity>,
        G: FnMut(&[Asset]) -> GroupingResult,
    {
        if observation.state == ScanState::Running {
            return Err(LibraryError::InvalidInput("final observation must be terminal".into()));
        }
        let pending = self.unapplied(operation_id, observation).await?;
        let digests = self.decided_digests(operation_id, &pending.files).await?;
        let mut writer = self.writer.lock().await;
        let mut txn = writer.begin_with("BEGIN IMMEDIATE").await?;
        let op = load_operation_row(&mut txn, operation_id).await?;
        require_running(&op)?;
        if observation.location_id != op.location_id {
            return Err(LibraryError::InvalidInput(
                "observation belongs to another location".into(),
            ));
        }
        let location = load_location(&mut txn, op.location_id).await?;
        let verified = root_check(&location).and_then(|current| {
            verify_root(&location, &op, &current)?;
            verify_root(&location, &op, &observation.root_identity)?;
            Ok(root_proven(&location.identity, &current)
                && root_proven(&location.identity, &observation.root_identity))
        });
        let outcome = match verified {
            Ok(proven) => {
                let finish =
                    FinishInput { observation, pending: &pending, digests: &digests, proven };
                finish_verified(&mut txn, &op, &location, finish, &mut grouping).await?;
                Ok(())
            }
            Err(error) => {
                downgrade(&mut txn, &op, &location, &error).await?;
                finish_unverified(&mut txn, &op, observation).await?;
                Err(scoped(error, location.path.clone(), Some(location.id)))
            }
        };
        let status = load_operation(&mut txn, op.id).await?;
        txn.commit().await?;
        drop(writer);
        outcome.map(|()| status)
    }

    /// Terminate a Running scan as Failed or Canceled with a durable reason.
    ///
    /// The reason is recorded on the operation scope only; the location and its
    /// assets keep their state. A Failed scope on an available location reads as
    /// Unreadable, a known location failure (Offline, `IdentityConflict`) is kept,
    /// and a cancellation makes no availability claim about its scope.
    ///
    /// # Errors
    /// `InvalidInput` for another state, an empty reason or a finished scan.
    pub async fn abort_scan(
        &self,
        operation_id: Uuid,
        state: ScanState,
        reason: &str,
    ) -> Result<ScanOperation> {
        if !matches!(state, ScanState::Failed | ScanState::Canceled) {
            return Err(LibraryError::InvalidInput(
                "abort state must be Failed or Canceled".into(),
            ));
        }
        let reason = valid_reason(reason)?;
        let operation = write_txn!(self, |conn| {
            let op = load_operation_row(conn, operation_id).await?;
            require_running(&op)?;
            let location = load_location(conn, op.location_id).await?;
            let availability = match (state, location.availability) {
                (ScanState::Failed, Availability::Available) => Availability::Unreadable,
                (_, availability) => availability,
            };
            add_issue(conn, op.id, &op.scope, reason, availability).await?;
            let mut incomplete = op.incomplete.clone();
            push_unique(&mut incomplete, op.scope.clone());
            finalize_operation(conn, op.id, state, &op.progress, &[], &incomplete).await?;
            load_operation(conn, op.id).await?
        });
        Ok(operation)
    }

    /// # Errors
    /// `NotFound` for an unknown operation.
    pub async fn scan_status(&self, operation_id: Uuid) -> Result<ScanOperation> {
        let mut conn = self.reader().await?;
        load_operation(&mut conn, operation_id).await
    }

    /// Durable Activity operations, newest first, including interrupted scans.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn list_operations(
        &self,
        location_id: Option<Uuid>,
        offset: u32,
        limit: u32,
    ) -> Result<Vec<ScanOperation>> {
        let mut conn = self.reader().await?;
        let ids: Vec<String> = sqlx::query_scalar(
            "SELECT id FROM scan_operations WHERE (?1 IS NULL OR location_id = ?1) \
             ORDER BY sequence DESC LIMIT ?2 OFFSET ?3",
        )
        .bind(location_id.map(|id| id.to_string()))
        .bind(i64::from(limit.min(MAX_PAGE)))
        .bind(i64::from(offset))
        .fetch_all(&mut *conn)
        .await?;
        let mut operations = Vec::with_capacity(ids.len());
        for id in ids {
            operations.push(load_operation(&mut conn, parse_uuid(&id)?).await?);
        }
        Ok(operations)
    }

    /// Hash reviewed frames of a batch off the writer lock, bound to their observation,
    /// plus Unreviewed copies whose recorded digest carries a decided copy's decision
    /// in another location (D16): their bytes decide whether that decision applies.
    ///
    /// The reviewed asset is found exactly as the transaction will find it, including
    /// a single case/normalization variant on insensitive volumes; the live observed
    /// path is hashed. Ambiguous variants are refused in the transaction instead.
    async fn decided_digests(&self, operation_id: Uuid, files: &[&ScanFile]) -> Result<DigestMap> {
        let mut conn = self.reader().await?;
        let op = load_operation_row(&mut conn, operation_id).await?;
        let location = load_location(&mut conn, op.location_id).await?;
        let mut work = Vec::new();
        for file in files.iter().copied() {
            let matched =
                find_asset(&mut conn, &location, &file.relative_path, &file.fingerprint, op.id)
                    .await?;
            let AssetMatch::Existing(asset) = &matched else {
                continue;
            };
            if asset.quality != Quality::Unreviewed || aliased_copy(&mut conn, asset).await? {
                let key = path_key(&file.relative_path);
                work.push((key, file.relative_path.clone(), file.fingerprint.clone()));
            }
        }
        drop(conn);
        if work.is_empty() {
            return Ok(HashMap::new());
        }
        let root = SourceRoot::new(location)?;
        blocking(move || {
            Ok(work
                .into_iter()
                .map(|(key, relative, fingerprint)| {
                    let digest = relative.relative_path().and_then(|relative| {
                        hash_contained(
                            &root,
                            &relative,
                            fingerprint.size_bytes,
                            fingerprint.modified_ns,
                        )
                    });
                    (key, digest)
                })
                .collect())
        })
        .await
    }

    /// The part of a terminal observation this operation's batches have not
    /// applied. A file is applied when its asset holds this operation's observation
    /// with the same fingerprint, format and metadata, or when the operation already
    /// recorded an issue at its exact path; an issue is applied when the operation
    /// already recorded it.
    async fn unapplied<'a>(
        &self,
        operation_id: Uuid,
        observation: &'a ScanObservation,
    ) -> Result<Pending<'a>> {
        let mut conn = self.reader().await?;
        let rows = sqlx::query(asset_sql!("WHERE a.last_operation_id = ?1"))
            .bind(operation_id.to_string())
            .fetch_all(&mut *conn)
            .await?;
        let mut applied = HashMap::with_capacity(rows.len());
        for row in &rows {
            let asset = asset_from_row(row)?;
            applied.insert(path_key(&asset.relative_path), asset);
        }
        let recorded = sqlx::query(
            "SELECT path_key, reason, availability FROM scan_issues WHERE operation_id = ?1",
        )
        .bind(operation_id.to_string())
        .fetch_all(&mut *conn)
        .await?;
        drop(conn);
        let mut issue_paths = HashSet::with_capacity(recorded.len());
        let mut recorded_issues = HashSet::with_capacity(recorded.len());
        for row in &recorded {
            let key: Vec<u8> = row.try_get("path_key")?;
            let reason: String = row.try_get("reason")?;
            let availability: String = row.try_get("availability")?;
            recorded_issues.insert((key.clone(), reason, availability));
            issue_paths.insert(key);
        }
        let files = observation
            .files
            .iter()
            .filter(|file| {
                let key = path_key(&file.relative_path);
                let proven = applied.get(&key).is_some_and(|asset| {
                    asset.format == file.format
                        && asset.observed == file.metadata
                        && fingerprint_matches(&asset.fingerprint, &file.fingerprint)
                });
                !proven && !issue_paths.contains(&key)
            })
            .collect();
        let mut issues = Vec::new();
        for issue in &observation.issues {
            let recorded = (
                path_key(&issue.relative_path),
                issue.reason.clone(),
                to_text(&issue.availability)?,
            );
            if !recorded_issues.contains(&recorded) {
                issues.push(issue);
            }
        }
        Ok(Pending { files, issues })
    }
}

// ---------------------------------------------------------------------------
// Assets and sessions
// ---------------------------------------------------------------------------

impl Catalog {
    /// # Errors
    /// `NotFound` for an unknown asset.
    pub async fn asset(&self, id: Uuid) -> Result<Asset> {
        let mut conn = self.reader().await?;
        load_asset(&mut conn, id).await
    }

    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn location_assets(&self, location_id: Uuid) -> Result<Vec<Asset>> {
        let mut conn = self.reader().await?;
        location_assets(&mut conn, location_id).await
    }

    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn list_sessions(&self, query: &SessionQuery) -> Result<Vec<SessionSummary>> {
        let mut conn = self.reader().await?;
        let ids: Vec<String> = sqlx::query_scalar(
            "SELECT s.id FROM sessions s WHERE (?1 = 1 OR s.superseded_by IS NULL) \
             AND (?2 IS NULL OR EXISTS (SELECT 1 FROM session_members m \
             JOIN assets a ON a.id = m.asset_id WHERE m.session_id = s.id AND a.location_id = ?2)) \
             ORDER BY s.date_basis IS NULL, s.date_basis DESC, s.capture_key, s.id \
             LIMIT ?3 OFFSET ?4",
        )
        .bind(i64::from(query.include_superseded))
        .bind(query.location_id.map(|id| id.to_string()))
        .bind(i64::from(if query.limit == 0 { MAX_PAGE } else { query.limit.min(MAX_PAGE) }))
        .bind(i64::from(query.offset))
        .fetch_all(&mut *conn)
        .await?;
        let mut rows = Vec::with_capacity(ids.len());
        for id in ids {
            rows.push(load_session_row(&mut conn, parse_uuid(&id)?).await?);
        }
        summarize_rows(&mut conn, rows).await
    }

    /// # Errors
    /// `NotFound` for an unknown session.
    pub async fn session(&self, id: Uuid) -> Result<SessionDetail> {
        let mut conn = self.reader().await?;
        let row = load_session_row(&mut conn, id).await?;
        let ids: BTreeSet<Uuid> = row.session.asset_ids.iter().copied().collect();
        let assets = load_assets(&mut conn, &ids).await?;
        let view = CaptureView::read(&mut conn, &[id], &assets).await?;
        let members = view.members(&assets);
        let associations = load_associations(&mut conn, id).await?;
        let lineage = session_lineage(&mut conn, id).await?;
        let successors = successors_of(&mut conn, &row).await?;
        let summary = view.summary(row, &assets, successors);
        Ok(SessionDetail { summary, assets, members, associations, lineage })
    }

    /// # Errors
    /// `NotFound` for an unknown session.
    pub async fn associations(&self, session_id: Uuid) -> Result<Vec<Association>> {
        let mut conn = self.reader().await?;
        load_session_row(&mut conn, session_id).await?;
        load_associations(&mut conn, session_id).await
    }
}

// ---------------------------------------------------------------------------
// Metadata corrections
// ---------------------------------------------------------------------------

impl Catalog {
    /// Validate and durably record a correction plan with its proposed regroup.
    ///
    /// The proposal is computed against current evidence in a rolled-back
    /// transaction; only the plan record is committed. Source files are untouched.
    ///
    /// # Errors
    /// `Conflict` for a stale expected revision/fingerprint; `InvalidInput` for an
    /// unknown field, wrong value type or an invalid grouping result.
    pub async fn preview_correction<G>(
        &self,
        expected: &[ExpectedAsset],
        corrections: &[CorrectionInput],
        mut grouping: G,
    ) -> Result<CorrectionPreview>
    where
        G: FnMut(&[Asset]) -> GroupingResult,
    {
        validate_correction_request(expected, corrections)?;
        let proposal = {
            let mut writer = self.writer.lock().await;
            let mut txn = writer.begin_with("BEGIN IMMEDIATE").await?;
            let proposal =
                correct_in_txn(&mut txn, expected, corrections, &mut grouping, Uuid::new_v4())
                    .await?;
            txn.rollback().await?;
            drop(writer);
            proposal
        };
        let preview = CorrectionPreview {
            id: Uuid::new_v4(),
            expected: expected.to_vec(),
            corrections: corrections.to_vec(),
            proposal,
            confirmed_correction: None,
            created_at: now()?,
        };
        write_txn!(self, |conn| {
            sqlx::query(
                "INSERT INTO correction_previews (id, expected, corrections, proposal, state, \
                 created_at) VALUES (?1, ?2, ?3, ?4, 'pending', ?5)",
            )
            .bind(preview.id.to_string())
            .bind(to_json(&preview.expected)?)
            .bind(to_json(&preview.corrections)?)
            .bind(to_json(&preview.proposal)?)
            .bind(&preview.created_at)
            .execute(&mut *conn)
            .await?;
        });
        Ok(preview)
    }

    /// # Errors
    /// `NotFound` for an unknown preview.
    pub async fn correction_preview(&self, id: Uuid) -> Result<CorrectionPreview> {
        let mut conn = self.reader().await?;
        load_preview(&mut conn, id).await
    }

    /// Confirm a pending preview: the supplied expectations must equal the reviewed
    /// ones, then corrections, regroup and lineage commit in one transaction.
    ///
    /// # Errors
    /// `Conflict` for stale assets; `InvalidInput` when the preview was already
    /// confirmed or the expectations differ from the reviewed plan.
    pub async fn confirm_correction<G>(
        &self,
        preview_id: Uuid,
        expected: &[ExpectedAsset],
        mut grouping: G,
    ) -> Result<CorrectionOutcome>
    where
        G: FnMut(&[Asset]) -> GroupingResult,
    {
        let correction_id = Uuid::new_v4();
        let outcome = write_txn!(self, |conn| {
            let preview = load_preview(conn, preview_id).await?;
            if preview.confirmed_correction.is_some() {
                return Err(LibraryError::InvalidInput(
                    "correction preview already confirmed".into(),
                ));
            }
            if !same_expectations(&preview.expected, expected) {
                return Err(LibraryError::InvalidInput(
                    "confirmation expectations differ from the reviewed preview".into(),
                ));
            }
            let outcome =
                correct_in_txn(conn, expected, &preview.corrections, &mut grouping, correction_id)
                    .await?;
            sqlx::query(
                "UPDATE correction_previews SET state = 'confirmed', correction_id = ?1, \
                 confirmed_at = ?2 WHERE id = ?3 AND state = 'pending'",
            )
            .bind(correction_id.to_string())
            .bind(now()?)
            .bind(preview_id.to_string())
            .execute(&mut *conn)
            .await?;
            outcome
        });
        Ok(outcome)
    }

    /// Apply catalog corrections and the supplied pure grouping in one transaction.
    ///
    /// Every expected asset is compared with its current decision revision and
    /// observation fingerprint; any mismatch refuses the whole batch. Original
    /// observed evidence and fixed asset ids are preserved; regroup lineage is stored.
    ///
    /// # Errors
    /// `Conflict` for stale input; `InvalidInput` for an invalid correction or grouping.
    pub async fn apply_correction_and_regroup<G>(
        &self,
        expected: &[ExpectedAsset],
        corrections: &[CorrectionInput],
        mut grouping: G,
    ) -> Result<CorrectionOutcome>
    where
        G: FnMut(&[Asset]) -> GroupingResult,
    {
        validate_correction_request(expected, corrections)?;
        let correction_id = Uuid::new_v4();
        let outcome = write_txn!(self, |conn| {
            correct_in_txn(conn, expected, corrections, &mut grouping, correction_id).await?
        });
        Ok(outcome)
    }
}

// ---------------------------------------------------------------------------
// Quality and lazy byte proof
// ---------------------------------------------------------------------------

impl Catalog {
    /// Record a library quality decision bound to the reviewed content digest.
    ///
    /// Usable/Unusable decisions hash the current source (off the writer lock, read
    /// only) after `probe` revalidates the root and proves the file still matches
    /// the recorded observation; the decision basis carries that SHA-256.
    /// Unreviewed clears the basis.
    ///
    /// # Errors
    /// `Conflict` for stale input; source access errors with path context; and
    /// `IdentityConflict` when current bytes differ from the recorded observation.
    pub async fn set_quality<P>(
        &self,
        expected: &[ExpectedAsset],
        quality: Quality,
        probe: P,
    ) -> Result<Vec<Asset>>
    where
        P: SourceProbe,
    {
        require_unique_assets(expected)?;
        let digests = if quality == Quality::Unreviewed {
            HashMap::new()
        } else {
            self.current_digests(expected, probe).await?
        };
        let ids: BTreeSet<Uuid> = expected.iter().map(|item| item.asset_id).collect();
        let assets = write_txn!(self, |conn| {
            let assets = check_expected_assets(conn, expected).await?;
            let decided_at = now()?;
            for asset in &assets {
                decide_quality(conn, asset, quality, digests.get(&asset.id), &decided_at).await?;
            }
            load_assets(conn, &ids).await?
        });
        Ok(assets)
    }

    /// Hash one asset's current source and bind the digest to its observation.
    ///
    /// # Errors
    /// Source access errors; `IdentityConflict` when bytes changed since observation.
    pub async fn verify_digest<P>(&self, asset_id: Uuid, probe: P) -> Result<DigestEvidence>
    where
        P: SourceProbe,
    {
        let expected = {
            let mut conn = self.reader().await?;
            let asset = load_asset(&mut conn, asset_id).await?;
            ExpectedAsset {
                asset_id,
                decision_revision: asset.decision_revision,
                fingerprint: asset.fingerprint,
            }
        };
        let digests = self.current_digests(std::slice::from_ref(&expected), probe).await?;
        let evidence = write_txn!(self, |conn| {
            let asset = load_asset(conn, asset_id).await?;
            let (sha256, hashed) = digests
                .get(&asset_id)
                .cloned()
                .ok_or_else(|| LibraryError::NoByteProof(format!("asset {asset_id}")))?;
            if !fingerprint_matches(&asset.fingerprint, &hashed) {
                return Err(conflict(asset.id, asset.decision_revision));
            }
            let mut fingerprint = asset.fingerprint.clone();
            fingerprint.content_sha256 = Some(sha256.clone());
            sqlx::query("UPDATE assets SET fingerprint = ?1 WHERE id = ?2")
                .bind(to_json(&fingerprint)?)
                .bind(asset_id.to_string())
                .execute(&mut *conn)
                .await?;
            DigestEvidence { sha256, fingerprint }
        });
        Ok(evidence)
    }

    async fn current_digests<P>(
        &self,
        expected: &[ExpectedAsset],
        probe: P,
    ) -> Result<HashMap<Uuid, (String, ObservationFingerprint)>>
    where
        P: SourceProbe,
    {
        let mut conn = self.reader().await?;
        let mut work = Vec::with_capacity(expected.len());
        for item in expected {
            let asset = load_asset(&mut conn, item.asset_id).await?;
            let location = load_location(&mut conn, asset.location_id).await?;
            let relative = asset.relative_path.relative_path()?;
            work.push((asset.id, SourceRoot::new(location)?, relative, asset.fingerprint));
        }
        drop(conn);
        blocking(move || {
            verify_roots(work.iter().map(|(_, root, _, _)| root), &probe)?;
            let digests = work
                .iter()
                .map(|(id, root, relative, fingerprint)| {
                    current_digest(root, relative, fingerprint, &probe)
                        .map(|sha256| (*id, (sha256, fingerprint.clone())))
                        .map_err(|error| scoped(error, root.source(relative), Some(*id)))
                })
                .collect::<Result<HashMap<_, _>>>()?;
            verify_roots(work.iter().map(|(_, root, _, _)| root), &probe)?;
            Ok(digests)
        })
        .await
    }
}

// ---------------------------------------------------------------------------
// Targets, equipment and associations
// ---------------------------------------------------------------------------

impl Catalog {
    /// Save a user/provider target explicitly; `None` creates, `Some` updates by CAS.
    ///
    /// Alias keys are stored exactly as normalized by the shared target normalizer.
    ///
    /// # Errors
    /// `Conflict` when the id exists on create or the revision is stale; `NotFound`
    /// for an update of an unknown target; `InvalidInput` for invalid fields.
    pub async fn save_target(
        &self,
        candidate: &TargetCandidate,
        expected_revision: Option<Revision>,
    ) -> Result<TargetRecord> {
        validate_target(candidate)?;
        let record = write_txn!(self, |conn| {
            let current: Option<i64> =
                sqlx::query_scalar("SELECT decision_revision FROM targets WHERE id = ?1")
                    .bind(candidate.id.to_string())
                    .fetch_optional(&mut *conn)
                    .await?;
            let revision = next_revision(candidate.id, current, expected_revision, "target")?;
            upsert_target(conn, candidate, revision).await?;
            next_counter(conn, "target_generation").await?;
            load_target(conn, candidate.id).await?
        });
        Ok(record)
    }

    /// Durably record a bundled seed catalog fact without any user adoption.
    ///
    /// Only `Provenance::Seed` candidates are accepted and the stored record keeps
    /// that provenance. An identical stored fact is returned unchanged; a changed
    /// seed fact is refreshed with the next revision; a user, provider or other
    /// record with the same id is returned unchanged and never overwritten.
    ///
    /// # Errors
    /// `InvalidInput` for a non-seed candidate or invalid fields.
    pub async fn record_seed_target(&self, candidate: &TargetCandidate) -> Result<TargetRecord> {
        if !matches!(candidate.provenance, Provenance::Seed { .. }) {
            return Err(LibraryError::InvalidInput(
                "seed facts need seed provenance; user and provider targets use save_target".into(),
            ));
        }
        validate_target(candidate)?;
        let mut stored = candidate.clone();
        stored.designation = stored.designation.trim().to_owned();
        let record = write_txn!(self, |conn| {
            let existing = match load_target(conn, candidate.id).await {
                Ok(record) => Some(record),
                Err(LibraryError::NotFound(_)) => None,
                Err(error) => return Err(error),
            };
            match existing {
                Some(record)
                    if record.candidate == stored
                        || !matches!(record.candidate.provenance, Provenance::Seed { .. }) =>
                {
                    record
                }
                existing => {
                    let revision = existing.map_or(1, |record| record.decision_revision + 1);
                    upsert_target(conn, &stored, revision).await?;
                    next_counter(conn, "target_generation").await?;
                    load_target(conn, candidate.id).await?
                }
            }
        });
        Ok(record)
    }

    /// Monotonic generation of saved target records, advanced in the same
    /// transaction as every committed target write and unchanged by refusals or
    /// no-op seed facts. Callers may cache [`Self::list_targets`] pages against it.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn target_generation(&self) -> Result<u64> {
        let mut conn = self.reader().await?;
        let value: i64 =
            sqlx::query_scalar("SELECT value FROM catalog_meta WHERE key = 'target_generation'")
                .fetch_one(&mut *conn)
                .await?;
        revision(value)
    }

    /// # Errors
    /// `NotFound` for an unknown target.
    pub async fn target(&self, id: Uuid) -> Result<TargetRecord> {
        let mut conn = self.reader().await?;
        load_target(&mut conn, id).await
    }

    /// Saved targets matching every supplied filter: exact normalized alias keys
    /// and/or a sky cone (shared spherical separation). No filter lists all.
    ///
    /// # Errors
    /// `InvalidInput` for an invalid cone.
    pub async fn find_targets(
        &self,
        alias_keys: &[String],
        area: Option<TargetCone>,
        limit: u32,
    ) -> Result<Vec<TargetRecord>> {
        if let Some(area) = &area {
            area.validate()?;
        }
        let limit = usize::try_from(limit.min(MAX_PAGE)).unwrap_or(usize::MAX);
        let mut conn = self.reader().await?;
        let mut ids: Option<BTreeSet<Uuid>> = None;
        if !alias_keys.is_empty() {
            let rows: Vec<String> = sqlx::query_scalar(
                "SELECT DISTINCT target_id FROM target_aliases \
                 WHERE normalized IN (SELECT value FROM json_each(?1))",
            )
            .bind(to_json(&alias_keys)?)
            .fetch_all(&mut *conn)
            .await?;
            ids = Some(rows.iter().map(|id| parse_uuid(id)).collect::<Result<_>>()?);
        }
        if let Some(area) = area {
            let inside = targets_in_cone(&mut conn, &area).await?;
            ids = Some(match ids {
                Some(ids) => ids.intersection(&inside).copied().collect(),
                None => inside,
            });
        }
        let ids = if let Some(ids) = ids {
            ids
        } else {
            let rows: Vec<String> =
                sqlx::query_scalar("SELECT id FROM targets").fetch_all(&mut *conn).await?;
            rows.iter().map(|id| parse_uuid(id)).collect::<Result<_>>()?
        };
        let mut records = Vec::with_capacity(ids.len());
        for id in ids {
            records.push(load_target(&mut conn, id).await?);
        }
        records.sort_by(|a, b| {
            (&a.candidate.designation, a.candidate.id)
                .cmp(&(&b.candidate.designation, b.candidate.id))
        });
        records.truncate(limit);
        Ok(records)
    }

    /// Confirm a Target for sessions explicitly; capture identity is unchanged.
    ///
    /// # Errors
    /// `Conflict` (with successors for superseded sessions) for stale input.
    pub async fn associate_target(
        &self,
        expected: &[ExpectedSession],
        target_id: Uuid,
    ) -> Result<Vec<Association>> {
        self.confirm_association(expected, AssociationKind::Target, target_id).await
    }

    /// Save explicit camera/optical-train equipment; `None` creates, `Some` updates.
    ///
    /// # Errors
    /// `Conflict`/`NotFound`/`InvalidInput` as for [`Self::save_target`].
    pub async fn save_equipment(
        &self,
        equipment: &Equipment,
        expected_revision: Option<Revision>,
    ) -> Result<Equipment> {
        validate_equipment(equipment)?;
        let saved = write_txn!(self, |conn| {
            let current: Option<i64> =
                sqlx::query_scalar("SELECT decision_revision FROM equipment WHERE id = ?1")
                    .bind(equipment.id.to_string())
                    .fetch_optional(&mut *conn)
                    .await?;
            let revision = next_revision(equipment.id, current, expected_revision, "equipment")?;
            upsert_equipment(conn, equipment, revision).await?;
            load_equipment(conn, equipment.id).await?
        });
        Ok(saved)
    }

    /// # Errors
    /// `NotFound` for unknown equipment.
    pub async fn equipment(&self, id: Uuid) -> Result<Equipment> {
        let mut conn = self.reader().await?;
        load_equipment(&mut conn, id).await
    }

    /// Confirm equipment for sessions; grouping is not changed by confirmation.
    ///
    /// # Errors
    /// `Conflict` (with successors for superseded sessions) for stale input.
    pub async fn confirm_equipment(
        &self,
        expected: &[ExpectedSession],
        equipment_id: Uuid,
    ) -> Result<Vec<Association>> {
        self.confirm_association(expected, AssociationKind::Equipment, equipment_id).await
    }

    /// Record automatic association evidence. Confirmed associations and the
    /// regroup conflicts between confirmations that wait for the user's review are
    /// preserved: automatic suggestions replace only automatic rows.
    ///
    /// Each suggestion must name the exact current members and observation
    /// fingerprints it was assessed against; evidence computed from older
    /// observations of the same grouping revision is refused, never re-based.
    ///
    /// # Errors
    /// `InvalidInput` for a Confirmed suggestion or unknown subject; `Conflict` for a
    /// stale grouping revision, changed membership or observation, or a superseded
    /// session. All or nothing.
    pub async fn record_suggestions(
        &self,
        suggestions: &[SuggestedAssociation],
    ) -> Result<Vec<Association>> {
        if suggestions.iter().any(|item| item.state == AssociationState::Confirmed) {
            return Err(LibraryError::InvalidInput(
                "suggestions cannot confirm; use the explicit confirmation commands".into(),
            ));
        }
        let recorded = write_txn!(self, |conn| {
            let updated_at = now()?;
            let mut recorded = Vec::with_capacity(suggestions.len());
            for item in suggestions {
                recorded.push(record_suggestion(conn, item, &updated_at).await?);
            }
            recorded
        });
        Ok(recorded)
    }

    /// Record that a session's target assessment kept conflicting with concurrent
    /// changes, so no current assessment could be recorded: an automatic target
    /// row becomes fail-closed `NeedsReview` naming the conflict, on the current
    /// members. Confirmations and pending review conflicts stay untouched, and a
    /// superseded session is left to its successors. Returns the stored row.
    ///
    /// # Errors
    /// `NotFound` for an unknown session; `PersistenceFailure` otherwise.
    pub async fn mark_assessment_conflict(&self, session_id: Uuid) -> Result<Option<Association>> {
        let marked = write_txn!(self, |conn| {
            let row = load_session_row(conn, session_id).await?;
            let existing = load_association(conn, session_id, AssociationKind::Target).await?;
            if row.superseded_by.is_some() || existing.as_ref().is_some_and(user_owned) {
                existing
            } else {
                let association = Association {
                    session_id,
                    kind: AssociationKind::Target,
                    subject_id: None,
                    state: AssociationState::NeedsReview,
                    evidence: vec![EvidenceItem::Unknown {
                        field: "target assessment conflicted with concurrent changes; rescan"
                            .into(),
                    }],
                    provenance: Provenance::Inferred { rule: ASSESSMENT_CONFLICT_RULE.into() },
                    observation_basis: member_basis(conn, session_id).await?,
                    decision_revision: row.session.decision_revision,
                };
                upsert_association(conn, &association, &now()?).await?;
                Some(association)
            }
        });
        Ok(marked)
    }

    async fn confirm_association(
        &self,
        expected: &[ExpectedSession],
        kind: AssociationKind,
        subject: Uuid,
    ) -> Result<Vec<Association>> {
        let confirmed = write_txn!(self, |conn| {
            require_subject(conn, kind, subject).await?;
            let sessions = check_expected_sessions(conn, expected).await?;
            let updated_at = now()?;
            let mut confirmed = Vec::with_capacity(sessions.len());
            for session in &sessions {
                confirmed.push(confirm_one(conn, session, kind, subject, &updated_at).await?);
            }
            confirmed
        });
        Ok(confirmed)
    }
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

impl Catalog {
    /// Target coverage from recorded observations and library decisions.
    ///
    /// Counts Confirmed and evidence-qualified Suggested associations. Values are the
    /// last recorded evidence; offline contributions keep their last observation.
    ///
    /// # Errors
    /// `NotFound` for an unknown target.
    pub async fn target_coverage(&self, target_id: Uuid) -> Result<TargetCoverage> {
        let mut conn = self.reader().await?;
        load_target(&mut conn, target_id).await?;
        let rows = sqlx::query(
            "SELECT s.id, s.date_basis, a.state, a.evidence FROM associations a \
             JOIN sessions s ON s.id = a.session_id WHERE a.kind = 'target' \
             AND a.target_id = ?1 AND s.superseded_by IS NULL ORDER BY s.date_basis, s.id",
        )
        .bind(target_id.to_string())
        .fetch_all(&mut *conn)
        .await?;
        let mut counted = Vec::new();
        let mut sessions = Vec::new();
        for row in &rows {
            let state: AssociationState = from_text(&row.try_get::<String, _>("state")?)?;
            let evidence: Vec<EvidenceItem> = from_json(&row.try_get::<String, _>("evidence")?)?;
            if !counts_toward_coverage(&state, &evidence) {
                continue;
            }
            let session_id = parse_uuid(&row.try_get::<String, _>("id")?)?;
            let date_basis: Option<String> = row.try_get("date_basis")?;
            sessions.push(session_id);
            // Retired copies stay as history and count toward no total.
            for asset in current_member_assets(&mut conn, session_id).await? {
                if asset.availability != Availability::Retired {
                    counted.push((date_basis.clone(), session_id, asset));
                }
            }
        }
        let placement: HashMap<Uuid, (Option<String>, Uuid)> = counted
            .iter()
            .map(|(date, session, asset)| (asset.id, (date.clone(), *session)))
            .collect();
        let assets: Vec<Asset> = counted.into_iter().map(|(_, _, asset)| asset).collect();
        let view = CaptureView::read(&mut conn, &sessions, &assets).await?;
        let mut locations = BTreeSet::new();
        let mut by_session: BTreeMap<(Option<String>, Uuid), Vec<(Asset, ApplicableQuality)>> =
            BTreeMap::new();
        for (key, present) in view.group(&assets) {
            locations.extend(present.iter().map(|asset| asset.location_id));
            // Each logical capture counts once, on an available copy when there is one.
            let Some(primary) = present.iter().min_by_key(|asset| {
                (asset.availability != Availability::Available, asset.location_id, asset.id)
            }) else {
                continue;
            };
            let place = placement[&primary.id].clone();
            by_session.entry(place).or_default().push(((*primary).clone(), view.quality(&key)));
        }
        let mut contributions = Vec::new();
        for ((date_basis, session_id), entries) in &by_session {
            contributions.extend(contributions_for(
                *session_id,
                date_basis.as_ref(),
                entries,
                &view.candidates,
            ));
        }
        let provisional = locations.iter().any(|id| view.location_provisional(*id))
            || assets.iter().any(|asset| view.candidates.contains(&asset.id));
        Ok(TargetCoverage {
            target_id,
            covered_location_ids: locations.into_iter().collect(),
            provisional,
            contributions,
        })
    }
}

impl Catalog {
    /// Record the scan's duplicate-candidate verification work: the unhashed
    /// cross-location duplicate candidates involving the operation's location that
    /// are readable now. Their count goes into the scan's progress. Each
    /// unambiguous candidate pair (exactly one partner per other location on both
    /// sides) is recorded as one logical capture, so differing digests make it a
    /// pair of conflicting copies rather than two captures (D16).
    ///
    /// # Errors
    /// `InvalidInput` when the scan is not running; `PersistenceFailure` otherwise.
    pub async fn duplicate_verification_work(&self, operation_id: Uuid) -> Result<Vec<Uuid>> {
        let work = write_txn!(self, |conn| {
            let op = load_operation_row(conn, operation_id).await?;
            require_running(&op)?;
            let matches = matches_of_location(conn, op.location_id).await?;
            let mut ids = BTreeSet::new();
            for found in matches.iter().filter(|found| found.candidate) {
                ids.extend([found.id, found.partner]);
            }
            for (left, right) in unambiguous_candidates(&matches, op.location_id) {
                record_copy_link(conn, left, right, "candidate").await?;
            }
            let mut work = Vec::new();
            for id in ids {
                let asset = load_asset(conn, id).await?;
                if asset.fingerprint.content_sha256.is_none()
                    && asset.availability == Availability::Available
                {
                    work.push(id);
                }
            }
            let mut progress = op.progress.clone();
            progress.duplicate_candidates = u64::try_from(work.len()).unwrap_or(u64::MAX);
            progress.duplicates_verified = 0;
            record_progress(conn, op.id, &progress).await?;
            work
        });
        Ok(work)
    }

    /// Hash these duplicate candidates read-only and off the writer lock, stopping
    /// before the next file once `canceled` is set. Each digest is then bound to the
    /// exact observation it was taken from (CAS) and counted in the scan's progress,
    /// so completed work survives a later cancel or crash. A copy that cannot be
    /// read stays a candidate and keeps its totals provisional.
    ///
    /// # Errors
    /// `InvalidInput` when the scan is not running; `PersistenceFailure` otherwise.
    pub async fn verify_duplicate_candidates<P: SourceProbe>(
        &self,
        operation_id: Uuid,
        assets: &[Uuid],
        probe: P,
        canceled: Arc<AtomicBool>,
    ) -> Result<ScanOperation> {
        let mut conn = self.reader().await?;
        let mut work = Vec::with_capacity(assets.len());
        for id in assets {
            let asset = load_asset(&mut conn, *id).await?;
            if asset.fingerprint.content_sha256.is_none()
                && asset.availability == Availability::Available
            {
                let root = SourceRoot::new(load_location(&mut conn, asset.location_id).await?)?;
                work.push((
                    asset.id,
                    root,
                    asset.relative_path.relative_path()?,
                    asset.fingerprint,
                ));
            }
        }
        drop(conn);
        let hashed = blocking(move || {
            let mut hashed = Vec::with_capacity(work.len());
            for (id, root, relative, fingerprint) in work {
                if canceled.load(Ordering::Acquire) {
                    break;
                }
                if root.verify(&probe).is_err() {
                    continue;
                }
                if let Ok(sha256) = current_digest(&root, &relative, &fingerprint, &probe) {
                    hashed.push((id, sha256, fingerprint));
                }
            }
            Ok(hashed)
        })
        .await?;
        let status = write_txn!(self, |conn| {
            let op = load_operation_row(conn, operation_id).await?;
            require_running(&op)?;
            let mut bound = 0_u64;
            for (id, sha256, hashed) in &hashed {
                let asset = load_asset(conn, *id).await?;
                if asset.fingerprint.content_sha256.is_none()
                    && fingerprint_matches(&asset.fingerprint, hashed)
                {
                    let mut fingerprint = asset.fingerprint.clone();
                    fingerprint.content_sha256 = Some(sha256.clone());
                    sqlx::query("UPDATE assets SET fingerprint = ?1 WHERE id = ?2")
                        .bind(to_json(&fingerprint)?)
                        .bind(id.to_string())
                        .execute(&mut *conn)
                        .await?;
                    bound += 1;
                }
            }
            let mut progress = op.progress.clone();
            progress.duplicates_verified += bound;
            record_progress(conn, op.id, &progress).await?;
            load_operation(conn, op.id).await?
        });
        Ok(status)
    }
}

// ---------------------------------------------------------------------------
// Remap
// ---------------------------------------------------------------------------

impl Catalog {
    /// Durably review moving a location to another verified copy. Writes no images.
    ///
    /// Readable originals and candidates are hashed; an offline original uses its
    /// fingerprint-bound digest or is blocked with `NoByteProof`.
    ///
    /// # Errors
    /// `Conflict` for a stale location revision; `InvalidInput` for a relative root
    /// or a retired location.
    pub async fn review_remap<P>(
        &self,
        location_id: Uuid,
        expected_revision: Revision,
        proposed_root: &NativePath,
        proposed_identity: &FileIdentity,
        probe: P,
    ) -> Result<RemapReview>
    where
        P: SourceProbe,
    {
        require_absolute(proposed_root)?;
        let (location, assets) = {
            let mut conn = self.reader().await?;
            let location = load_location(&mut conn, location_id).await?;
            require_active(&location, "remapped")?;
            require_revision(location_id, location.decision_revision, expected_revision)?;
            let assets = location_assets(&mut conn, location_id).await?;
            (location, assets)
        };
        let mut blocked = self.remap_root_blocks(&location, proposed_root, proposed_identity).await;
        let roots = RemapRoots::new(&location, proposed_root, proposed_identity)?;
        let (items, asset_blocks) =
            blocking(move || Ok(assess_remap(&roots, &assets, &probe))).await?;
        blocked.extend(asset_blocks);
        let review = RemapReview {
            id: Uuid::new_v4(),
            location_id,
            expected_revision,
            proposed_root: proposed_root.clone(),
            proposed_identity: proposed_identity.clone(),
            items,
            blocked,
        };
        write_txn!(self, |conn| insert_review(conn, &review).await?);
        Ok(review)
    }

    /// # Errors
    /// `NotFound` for an unknown review.
    pub async fn remap_review(&self, id: Uuid) -> Result<RemapReview> {
        let mut conn = self.reader().await?;
        Ok(load_review(&mut conn, id).await?.0)
    }

    /// Apply a clean review atomically: every asset is rehashed and revalidated, then
    /// the root and all fingerprints change together. Any refusal changes nothing.
    ///
    /// # Errors
    /// `NoByteProof`/`IdentityConflict` for blocked or drifted items; `Conflict` for a
    /// stale revision or changed asset set; `InvalidInput` for an applied review or a
    /// retired location.
    pub async fn apply_remap<P>(
        &self,
        review_id: Uuid,
        expected_revision: Revision,
        probe: P,
    ) -> Result<Location>
    where
        P: SourceProbe,
    {
        let (review, location, assets) = {
            let mut conn = self.reader().await?;
            let (review, state) = load_review(&mut conn, review_id).await?;
            require_reviewed(&state)?;
            let location = load_location(&mut conn, review.location_id).await?;
            require_active(&location, "remapped")?;
            let assets = location_assets(&mut conn, review.location_id).await?;
            (review, location, assets)
        };
        if !review.blocked.is_empty() {
            return Err(blocked_error(&review));
        }
        require_revision(location.id, review.expected_revision, expected_revision)?;
        require_revision(location.id, location.decision_revision, expected_revision)?;
        require_same_assets(&review, &assets)?;
        let roots = RemapRoots::new(&location, &review.proposed_root, &review.proposed_identity)?;
        let checked = review.items.clone();
        blocking(move || verify_remap(&roots, &checked, &assets, &probe)).await?;
        let new_root =
            RemapRoots::new(&location, &review.proposed_root, &review.proposed_identity)?.candidate;
        let mut attempt = 1;
        loop {
            let searched = self
                .search_stale_roots(
                    Some(location.id),
                    &review.proposed_root,
                    &review.proposed_identity,
                )
                .await?;
            let applied = write_txn!(self, |conn| {
                let current = load_location(conn, location.id).await?;
                require_active(&current, "remapped")?;
                require_revision(current.id, current.decision_revision, expected_revision)?;
                require_reviewed(&load_review(conn, review_id).await?.1)?;
                let assets = location_assets(conn, location.id).await?;
                require_same_assets(&review, &assets)?;
                if let Some(stale) = recheck_overlap(
                    conn,
                    Some(location.id),
                    &review.proposed_root,
                    &review.proposed_identity,
                    &searched,
                )
                .await?
                {
                    Err(stale)
                } else {
                    apply_remap_rows(conn, &review, &assets, &new_root).await?;
                    Ok(load_location(conn, location.id).await?)
                }
            });
            match applied {
                Ok(location) => return Ok(location),
                Err(stale) => search_again(&mut attempt, &stale)?,
            }
        }
    }

    /// Blocks on the proposed root itself: an unqualified identity, or overlap with
    /// another registered root, stale roots searched for off the writer lock.
    async fn remap_root_blocks(
        &self,
        location: &Location,
        proposed_root: &NativePath,
        proposed_identity: &FileIdentity,
    ) -> Vec<RemapBlock> {
        let (reason, error) = if let Err(error) = require_root_identity(proposed_identity) {
            (RemapBlockReason::IdentityConflict, error)
        } else if let Err(error) =
            self.search_stale_roots(Some(location.id), proposed_root, proposed_identity).await
        {
            (RemapBlockReason::Collision, error)
        } else {
            return Vec::new();
        };
        vec![RemapBlock { asset_id: None, reason, message: error.to_string() }]
    }
}

// ---------------------------------------------------------------------------
// Retire location
// ---------------------------------------------------------------------------

impl Catalog {
    /// Durably review Retire location: the location, its root and availability,
    /// its recorded copies, the current sessions holding them and the Views,
    /// Projects and Results `references` read for them. Only the review is written.
    ///
    /// # Errors
    /// `InvalidInput` for a retired location; `Conflict` with the location's current
    /// revision when its copies changed after `references` were read.
    pub async fn review_retire_location(
        &self,
        location_id: Uuid,
        references: &LocationReferences,
    ) -> Result<RetireReview> {
        let read = canonical_references(references);
        let review = write_txn!(self, |conn| {
            let location = load_location(conn, location_id).await?;
            require_active(&location, "retired again")?;
            let assets = location_assets(conn, location_id).await?;
            if assets.iter().map(|asset| asset.id).collect::<BTreeSet<_>>() != read.assets {
                return Err(conflict(location.id, location.decision_revision));
            }
            let review = RetireReview {
                id: Uuid::new_v4(),
                location_id,
                location_name: location.name.clone(),
                root: location.path.clone(),
                availability: location.availability,
                expected_revision: location.decision_revision,
                assets: retire_assets(&assets),
                sessions: retire_sessions(conn, location_id).await?,
                statement: retire_statement(&location, assets.len(), read.references.len()),
                references: read.references,
                consulted: read.consulted,
            };
            insert_retire_review(conn, &review).await?;
            review
        });
        Ok(review)
    }

    /// # Errors
    /// `NotFound` for an unknown review.
    pub async fn retire_review(&self, id: Uuid) -> Result<RetireReview> {
        let mut conn = self.reader().await?;
        Ok(load_retire_review(&mut conn, id).await?.0)
    }

    /// Confirm a reviewed Retire location. The location becomes Retired with its
    /// last-observed state; its copies read Retired, stay as history and leave every
    /// total; its root stops counting as an overlap. No file changes.
    ///
    /// The copies, the sessions holding them and `references`, read again by the
    /// caller, must still be exactly what the review named.
    ///
    /// # Errors
    /// `Conflict` naming the location for a stale revision or review, or naming the
    /// operation while a scan of the location is Running; `InvalidInput` for a
    /// review of another location, an applied review or a retired location.
    pub async fn retire_location(
        &self,
        review_id: Uuid,
        location_id: Uuid,
        expected_revision: Revision,
        references: &LocationReferences,
    ) -> Result<Location> {
        let read = canonical_references(references);
        let location = write_txn!(self, |conn| {
            let (review, state) = load_retire_review(conn, review_id).await?;
            if review.location_id != location_id {
                return Err(LibraryError::InvalidInput(format!(
                    "retire review {review_id} is for location {}",
                    review.location_id
                )));
            }
            if state != "reviewed" {
                return Err(LibraryError::InvalidInput(format!(
                    "retire review {review_id} was already confirmed"
                )));
            }
            let location = load_location(conn, location_id).await?;
            require_active(&location, "retired again")?;
            require_revision(location_id, review.expected_revision, expected_revision)?;
            require_revision(location_id, location.decision_revision, expected_revision)?;
            if let Some(operation) = running_operation(conn, location_id).await? {
                let op = load_operation_row(conn, operation).await?;
                return Err(conflict(op.id, op.revision));
            }
            let assets = location_assets(conn, location_id).await?;
            let unchanged = retire_assets(&assets) == review.assets
                && assets.iter().map(|asset| asset.id).collect::<BTreeSet<_>>() == read.assets
                && retire_sessions(conn, location_id).await? == review.sessions
                && read.references == review.references
                && read.consulted == review.consulted;
            if !unchanged {
                return Err(conflict(location_id, location.decision_revision));
            }
            sqlx::query(
                "UPDATE locations SET lifecycle = 'retired', \
                 decision_revision = decision_revision + 1 WHERE id = ?1",
            )
            .bind(location_id.to_string())
            .execute(&mut *conn)
            .await?;
            sqlx::query(
                "UPDATE retire_reviews SET state = 'applied', applied_at = ?1 WHERE id = ?2",
            )
            .bind(now()?)
            .bind(review_id.to_string())
            .execute(&mut *conn)
            .await?;
            load_location(conn, location_id).await?
        });
        Ok(location)
    }
}

// ---------------------------------------------------------------------------
// Schema, settings and recovery
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
fn durable(options: SqliteConnectOptions) -> SqliteConnectOptions {
    options.pragma("fullfsync", "ON").pragma("checkpoint_fullfsync", "ON")
}

#[cfg(not(target_os = "macos"))]
fn durable(options: SqliteConnectOptions) -> SqliteConnectOptions {
    options
}

async fn read_settings(conn: &mut SqliteConnection) -> Result<WriterSettings> {
    let journal_mode: String =
        sqlx::query_scalar("PRAGMA journal_mode").fetch_one(&mut *conn).await?;
    let synchronous: i64 = sqlx::query_scalar("PRAGMA synchronous").fetch_one(&mut *conn).await?;
    let foreign_keys: i64 = sqlx::query_scalar("PRAGMA foreign_keys").fetch_one(&mut *conn).await?;
    let fullfsync: i64 = sqlx::query_scalar("PRAGMA fullfsync").fetch_one(&mut *conn).await?;
    let checkpoint_fullfsync: i64 =
        sqlx::query_scalar("PRAGMA checkpoint_fullfsync").fetch_one(&mut *conn).await?;
    Ok(WriterSettings {
        journal_mode: journal_mode.to_ascii_lowercase(),
        synchronous,
        foreign_keys: foreign_keys == 1,
        fullfsync: fullfsync == 1,
        checkpoint_fullfsync: checkpoint_fullfsync == 1,
    })
}

async fn install_schema(conn: &mut SqliteConnection) -> Result<()> {
    let tables: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .fetch_all(&mut *conn)
    .await?;
    if !tables.is_empty() && !tables.iter().any(|name| name == "catalog_meta") {
        return Err(LibraryError::InvalidInput(
            "database is not a clean library catalog; legacy import is not supported".into(),
        ));
    }
    let mut txn = conn.begin_with("BEGIN IMMEDIATE").await?;
    // An older catalog is refused before any DDL of this version touches it.
    if !tables.is_empty() {
        let recorded: Option<i64> =
            sqlx::query_scalar("SELECT value FROM catalog_meta WHERE key = 'schema_version'")
                .fetch_optional(&mut *txn)
                .await?;
        if let Some(version) = recorded.filter(|version| *version != SCHEMA_VERSION) {
            return Err(LibraryError::InvalidInput(format!(
                "unsupported catalog schema version {version}"
            )));
        }
    }
    sqlx::raw_sql(SCHEMA).execute(&mut *txn).await?;
    let version: i64 =
        sqlx::query_scalar("SELECT value FROM catalog_meta WHERE key = 'schema_version'")
            .fetch_one(&mut *txn)
            .await?;
    if version != SCHEMA_VERSION {
        return Err(LibraryError::InvalidInput(format!(
            "unsupported catalog schema version {version}"
        )));
    }
    txn.commit().await?;
    Ok(())
}

async fn recover_interrupted(conn: &mut SqliteConnection) -> Result<()> {
    let mut txn = conn.begin_with("BEGIN IMMEDIATE").await?;
    let ids: Vec<String> =
        sqlx::query_scalar("SELECT id FROM scan_operations WHERE state = 'running'")
            .fetch_all(&mut *txn)
            .await?;
    for id in ids {
        let op = load_operation_row(&mut txn, parse_uuid(&id)?).await?;
        let location = load_location(&mut txn, op.location_id).await?;
        let reason = "interrupted before completion; rescan before absence reconciliation";
        add_issue(&mut txn, op.id, &op.scope, reason, location.availability).await?;
        let mut incomplete = op.incomplete.clone();
        push_unique(&mut incomplete, op.scope.clone());
        finalize_operation(&mut txn, op.id, ScanState::Partial, &op.progress, &[], &incomplete)
            .await?;
    }
    txn.commit().await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Location helpers
// ---------------------------------------------------------------------------

fn valid_name(name: &str) -> Result<&str> {
    let name = name.trim();
    if name.is_empty() {
        return Err(LibraryError::InvalidInput("display name is empty".into()));
    }
    Ok(name)
}

fn valid_reason(reason: &str) -> Result<&str> {
    let reason = reason.trim();
    if reason.is_empty() {
        return Err(LibraryError::InvalidInput("failure reason is empty".into()));
    }
    Ok(reason)
}

fn require_absolute(path: &NativePath) -> Result<PathBuf> {
    let native = path.to_path_buf().map_err(|error| scoped(error, path.clone(), None))?;
    if !native.is_absolute() {
        return Err(scoped(
            LibraryError::InvalidInput("location root must be absolute".into()),
            path.clone(),
            None,
        ));
    }
    Ok(native)
}

fn require_root_identity(identity: &FileIdentity) -> Result<()> {
    identity.volume.validate()?;
    if identity.volume.file_ids_stable && identity.file_id.as_deref().is_none_or(str::is_empty) {
        return Err(LibraryError::IdentityConflict(
            "root folder identity is missing on a volume with stable file ids".into(),
        ));
    }
    Ok(())
}

fn same_volume(left: &VolumeIdentity, right: &VolumeIdentity) -> bool {
    left.filesystem == right.filesystem
        && left.stable_id.is_some()
        && left.stable_id == right.stable_id
}

/// Remount-stable identity of the same root folder.
fn same_root(registered: &FileIdentity, observed: &FileIdentity) -> bool {
    same_volume(&registered.volume, &observed.volume)
        && match (&registered.file_id, &observed.file_id) {
            (Some(registered), Some(observed)) => registered == observed,
            (Some(_), None) => false,
            (None, _) => !registered.volume.file_ids_stable,
        }
}

/// Byte-free folder proof needed before absence: a remount-stable root file id.
fn root_proven(registered: &FileIdentity, observed: &FileIdentity) -> bool {
    same_volume(&registered.volume, &observed.volume)
        && registered.volume.file_ids_stable
        && registered.file_id.is_some()
        && registered.file_id == observed.file_id
}

fn require_revision(id: Uuid, current: Revision, expected: Revision) -> Result<()> {
    if current == expected {
        Ok(())
    } else {
        Err(conflict(id, current))
    }
}

const fn conflict(id: Uuid, current: Revision) -> LibraryError {
    LibraryError::Conflict { id, current, successors: Vec::new() }
}

fn scoped(error: LibraryError, scope: NativePath, identity: Option<Uuid>) -> LibraryError {
    if matches!(error, LibraryError::Context { .. } | LibraryError::Conflict { .. }) {
        return error;
    }
    LibraryError::Context { error: Box::new(error), scope, identity }
}

/// Refuse what a retired location never takes again, naming the location.
fn require_active(location: &Location, refused: &str) -> Result<()> {
    if location.lifecycle == LocationLifecycle::Active {
        return Ok(());
    }
    Err(scoped(
        LibraryError::InvalidInput(format!(
            "location {name:?} is retired and cannot be {refused}; register its folder again \
             as a new location",
            name = location.name
        )),
        location.path.clone(),
        Some(location.id),
    ))
}

/// One canonical form of references read for a location: each record names only
/// the location's assets it holds, sorted; records naming none are dropped.
fn canonical_references(read: &LocationReferences) -> LocationReferences {
    let mut references: Vec<AssetReference> = read
        .references
        .iter()
        .filter_map(|reference| {
            let held: BTreeSet<Uuid> =
                reference.asset_ids.iter().copied().filter(|id| read.assets.contains(id)).collect();
            (!held.is_empty()).then(|| AssetReference {
                kind: reference.kind,
                id: reference.id,
                name: reference.name.clone(),
                revision: reference.revision,
                asset_ids: held.into_iter().collect(),
            })
        })
        .collect();
    references.sort_by_key(|reference| (reference.kind, reference.id, reference.revision));
    references.dedup();
    let consulted: BTreeSet<ReferenceKind> = read.consulted.iter().copied().collect();
    LocationReferences {
        assets: read.assets.clone(),
        references,
        consulted: consulted.into_iter().collect(),
    }
}

fn retire_assets(assets: &[Asset]) -> Vec<RetireAsset> {
    assets
        .iter()
        .map(|asset| RetireAsset { asset_id: asset.id, relative_path: asset.relative_path.clone() })
        .collect()
}

/// Current sessions holding a location's copies, each naming those copies.
async fn retire_sessions(
    conn: &mut SqliteConnection,
    location_id: Uuid,
) -> Result<Vec<RetireSession>> {
    let rows = sqlx::query(
        "SELECT a.id AS asset_id, s.id AS session_id, s.grouping_revision FROM assets a \
         JOIN sessions s ON s.id = a.session_id WHERE a.location_id = ?1 \
         AND s.superseded_by IS NULL ORDER BY s.id, a.id",
    )
    .bind(location_id.to_string())
    .fetch_all(&mut *conn)
    .await?;
    let mut sessions: Vec<RetireSession> = Vec::new();
    for row in &rows {
        let session_id = parse_uuid(&row.try_get::<String, _>("session_id")?)?;
        let asset_id = parse_uuid(&row.try_get::<String, _>("asset_id")?)?;
        match sessions.last_mut() {
            Some(last) if last.session_id == session_id => last.asset_ids.push(asset_id),
            _ => sessions.push(RetireSession {
                session_id,
                grouping_revision: revision(row.try_get("grouping_revision")?)?,
                asset_ids: vec![asset_id],
            }),
        }
    }
    Ok(sessions)
}

fn retire_statement(location: &Location, copies: usize, references: usize) -> String {
    format!(
        "Retiring {name:?} at {root} deletes, moves or modifies no file. Its {copies} recorded \
         copies will read Retired and stay as history, leave captured, usable and Unreviewed \
         totals and Project progress, and stay named unresolved in the {references} Views, \
         Projects and Results that hold them. Its folder can then be registered again as a \
         new location; no decision transfers to it.",
        name = location.name,
        root = location.path.display(),
    )
}

async fn insert_retire_review(conn: &mut SqliteConnection, review: &RetireReview) -> Result<()> {
    sqlx::query(
        "INSERT INTO retire_reviews (id, location_id, expected_revision, review, state, \
         created_at) VALUES (?1, ?2, ?3, ?4, 'reviewed', ?5)",
    )
    .bind(review.id.to_string())
    .bind(review.location_id.to_string())
    .bind(db_revision(review.expected_revision)?)
    .bind(to_json(review)?)
    .bind(now()?)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

async fn load_retire_review(
    conn: &mut SqliteConnection,
    id: Uuid,
) -> Result<(RetireReview, String)> {
    let row = sqlx::query("SELECT review, state FROM retire_reviews WHERE id = ?1")
        .bind(id.to_string())
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| LibraryError::NotFound(format!("retire review {id}")))?;
    Ok((from_json(&row.try_get::<String, _>("review")?)?, row.try_get("state")?))
}

/// How a registered root that no longer resolves is treated by an overlap check.
#[derive(Clone, Copy, PartialEq, Eq)]
enum StaleRoots {
    /// Reselecting a location: `same_root` already proved the candidate is that
    /// location's recorded folder, so a stale sibling is compared on what the
    /// catalog recorded instead of blocking the recovery.
    Compare,
    /// Registration and remap: a stale root may sit at a new path below the
    /// candidate, so beyond that comparison it is collected for a search of the
    /// candidate's folders for its recorded folder identity. Without a stable folder
    /// identity the change is refused, naming the root and the way out.
    Search,
}

/// Limits of one search of a candidate's folders for stale registered roots. A
/// search that reaches either is incomplete, and the change is refused.
#[derive(Clone, Copy)]
#[cfg_attr(not(unix), allow(dead_code))]
struct SearchBounds {
    folders: usize,
    time: Duration,
}

const STALE_ROOT_SEARCH: SearchBounds =
    SearchBounds { folders: 100_000, time: Duration::from_secs(10) };

/// Searches made for one change before stale roots that keep changing under it are
/// refused with a `Conflict`, to be retried.
const STALE_ROOT_SEARCH_ATTEMPTS: usize = 3;

/// A registered root on the candidate's volume whose stored path no longer
/// resolves, with the `(device, inode)` its recorded folder would have there.
struct StaleRoot {
    location: Location,
    folder: (u64, u64),
    error: LibraryError,
}

/// The overlap of a candidate with the registered roots on its volume, short of
/// searching the candidate for the stale ones.
struct OverlapPlan {
    candidate: CanonicalRoot,
    stale: Vec<StaleRoot>,
}

/// A candidate folder as it was searched, with the recorded folders of the stale
/// roots the search proved absent from it.
struct Searched {
    candidate: CanonicalRoot,
    absent: Vec<(u64, u64)>,
}

/// A stale root the writer transaction found that the search did not cover.
struct Unsearched {
    id: Uuid,
    revision: Revision,
}

/// Refuse a root that is, contains or lies inside another registered root on the
/// same volume. Overlap is decided on canonical ancestry and folder identity, never
/// on the path text the user chose: links anywhere above either root (macOS
/// `/var` → `/private/var`, a linked home folder) resolve first. The candidate must
/// resolve. A registered root that no longer resolves (a renamed, moved or deleted
/// folder, a volume remounted under another name) is handled by `mode`; in `Search`
/// mode the ones the candidate must still be searched for are returned.
async fn plan_overlap(
    conn: &mut SqliteConnection,
    exclude: Option<Uuid>,
    path: &NativePath,
    identity: &FileIdentity,
    mode: StaleRoots,
) -> Result<OverlapPlan> {
    let rows = sqlx::query(
        "SELECT * FROM locations WHERE volume_filesystem = ?1 AND volume_stable_id = ?2 \
         AND lifecycle = 'active'",
    )
    .bind(identity.volume.filesystem.as_str())
    .bind(identity.volume.stable_id.as_deref())
    .fetch_all(&mut *conn)
    .await?;
    let candidate =
        CanonicalRoot::resolve(path).map_err(|error| scoped(error, path.clone(), None))?;
    let volume = &identity.volume;
    let mut stale = Vec::new();
    for row in &rows {
        let other = location_from_row(row)?;
        if Some(other.id) == exclude {
            continue;
        }
        let overlaps = same_root(&other.identity, identity)
            || match CanonicalRoot::resolve(&other.path) {
                Ok(resolved) => resolved.overlaps(&candidate, volume),
                Err(error) => {
                    let recorded = candidate.descends_from(&other.identity)
                        || roots_overlap(&other.path, path, volume)
                        || roots_overlap(&other.path, &candidate.path, volume);
                    if !recorded && mode == StaleRoots::Search {
                        let Some(folder) = candidate.recorded_folder(&other.identity) else {
                            return Err(unprovable_stale_root(&other, &error, path));
                        };
                        stale.push(StaleRoot { location: other, folder, error });
                        continue;
                    }
                    recorded
                }
            };
        if overlaps {
            return Err(scoped(
                LibraryError::IdentityConflict(format!(
                    "folder overlaps registered location {:?}",
                    other.name
                )),
                path.clone(),
                Some(other.id),
            ));
        }
    }
    Ok(OverlapPlan { candidate, stale })
}

/// Inside the writer transaction: repeat the overlap checks on the current catalog
/// and filesystem. Every stale root must be one `searched` proved absent from this
/// same candidate folder; the first that is not is returned, so the candidate is
/// searched again.
async fn recheck_overlap(
    conn: &mut SqliteConnection,
    exclude: Option<Uuid>,
    path: &NativePath,
    identity: &FileIdentity,
    searched: &Searched,
) -> Result<Option<Unsearched>> {
    let plan = plan_overlap(conn, exclude, path, identity, StaleRoots::Search).await?;
    let same_folder = plan.candidate == searched.candidate;
    Ok(plan
        .stale
        .iter()
        .find(|stale| !same_folder || !searched.absent.contains(&stale.folder))
        .map(|stale| Unsearched {
            id: stale.location.id,
            revision: stale.location.decision_revision,
        }))
}

impl Catalog {
    /// Plan a candidate's overlap on a reader snapshot, then search its folders for
    /// every stale root on the blocking pool without the writer lock, so a long walk
    /// delays no catalog write.
    async fn search_stale_roots(
        &self,
        exclude: Option<Uuid>,
        path: &NativePath,
        identity: &FileIdentity,
    ) -> Result<Searched> {
        let plan = {
            let mut conn = self.reader().await?;
            plan_overlap(&mut conn, exclude, path, identity, StaleRoots::Search).await?
        };
        let absent: Vec<(u64, u64)> = plan.stale.iter().map(|stale| stale.folder).collect();
        if !absent.is_empty() {
            let root = plan.candidate.path.to_path_buf()?;
            let wanted = absent.clone();
            #[cfg(test)]
            let hook = Arc::clone(&self.stale_search_hook);
            let search = blocking(move || {
                #[cfg(test)]
                if let Some(hook) = hook.blocking_lock().as_mut() {
                    hook();
                }
                Ok(search_folders(&root, &wanted, STALE_ROOT_SEARCH))
            })
            .await?;
            refuse_held_stale_roots(&search, &plan.stale, path)?;
        }
        Ok(Searched { candidate: plan.candidate, absent })
    }

    /// Run `hook` on the search thread before each stale-root search.
    #[cfg(test)]
    async fn set_stale_search_hook(&self, hook: impl FnMut() + Send + 'static) {
        *self.stale_search_hook.lock().await = Some(Box::new(hook));
    }
}

/// After a writer transaction found a stale root the last search did not cover,
/// count another search, or refuse with a `Conflict` on that root, to be retried,
/// once `STALE_ROOT_SEARCH_ATTEMPTS` searches were made.
fn search_again(attempt: &mut usize, stale: &Unsearched) -> Result<()> {
    if *attempt >= STALE_ROOT_SEARCH_ATTEMPTS {
        return Err(conflict(stale.id, stale.revision));
    }
    *attempt += 1;
    Ok(())
}

/// A root resolved through every link to its canonical folder. On Unix it also
/// carries the `(device, inode)` of that folder and of each folder above it; other
/// hosts have no stable folder identity here, so they compare canonical paths only.
#[derive(PartialEq, Eq)]
struct CanonicalRoot {
    path: NativePath,
    ancestry: Option<Vec<(u64, u64)>>,
}

impl CanonicalRoot {
    fn resolve(root: &NativePath) -> Result<Self> {
        let given = root.to_path_buf()?;
        let canonical =
            std::fs::canonicalize(&given).map_err(|error| LibraryError::from_io(&given, &error))?;
        let ancestry = folder_ancestry(&canonical)?;
        Ok(Self { path: NativePath::from_path(&canonical), ancestry })
    }

    /// Same folder, ancestor or descendant, by folder identity or canonical path.
    fn overlaps(&self, other: &Self, volume: &VolumeIdentity) -> bool {
        let by_identity = match (&self.ancestry, &other.ancestry) {
            (Some(own), Some(theirs)) => match (own.first(), theirs.first()) {
                (Some(root), Some(their_root)) => theirs.contains(root) || own.contains(their_root),
                _ => true,
            },
            _ => false,
        };
        by_identity || roots_overlap(&self.path, &other.path, volume)
    }

    /// The recorded root folder is this root or one of its ancestors on its volume.
    fn descends_from(&self, recorded: &FileIdentity) -> bool {
        match (&self.ancestry, self.recorded_folder(recorded)) {
            (Some(ancestry), Some(folder)) => ancestry.contains(&folder),
            _ => false,
        }
    }

    /// The `(device, inode)` the recorded root folder has on this root's device, when
    /// this host carries folder identity and the recorded id is remount-stable.
    fn recorded_folder(&self, recorded: &FileIdentity) -> Option<(u64, u64)> {
        let &(device, _) = self.ancestry.as_ref()?.first()?;
        if !recorded.volume.file_ids_stable {
            return None;
        }
        Some((device, recorded.file_id.as_deref()?.parse().ok()?))
    }
}

#[cfg(unix)]
fn folder_ancestry(canonical: &Path) -> Result<Option<Vec<(u64, u64)>>> {
    let mut ancestry = Vec::new();
    for folder in canonical.ancestors() {
        ancestry.push(stamp_of(&real_directory(folder)?));
    }
    Ok(Some(ancestry))
}

// Creation times are not identity: copies and extraction preserve them, FAT/exFAT
// round them and some filesystems report none. Canonicalization already resolved
// junctions and links, so the canonical path is the comparison.
#[cfg(not(unix))]
fn folder_ancestry(canonical: &Path) -> Result<Option<Vec<(u64, u64)>>> {
    real_directory(canonical)?;
    Ok(None)
}

/// A stale root on a volume or host without stable folder identity: nothing proves
/// the candidate does not hold it at a new path. The ways out are reselecting it
/// where it now is, or a reviewed Retire location when it was deleted or cannot be
/// verified again; a folder made at its stored path would let a renamed or moved
/// root be registered a second time where it now is.
fn unprovable_stale_root(
    stale: &Location,
    error: &LibraryError,
    path: &NativePath,
) -> LibraryError {
    scoped(
        LibraryError::IdentityConflict(format!(
            "registered location {name:?} at {stored} no longer resolves ({error}), and without \
             a stable folder identity this folder cannot be proven not to hold it; reselect \
             {name:?} at its current folder (where it was renamed or moved to, or where its \
             volume is now mounted), or, if it was deleted or will not be verified again, \
             review and confirm Retire location for {name:?}, then try again",
            name = stale.name,
            stored = stale.path.display(),
        )),
        path.clone(),
        Some(stale.id),
    )
}

/// Refuse a candidate whose folders hold a stale root's recorded folder, naming
/// both, or whose folders could not all be searched for it.
fn refuse_held_stale_roots(
    search: &FolderSearch,
    stale: &[StaleRoot],
    path: &NativePath,
) -> Result<()> {
    let (held, message) = match search {
        FolderSearch::Absent => return Ok(()),
        FolderSearch::Found { index, path: found } => {
            let held = &stale[*index];
            let message = format!(
                "registered location {name:?} at {stored} no longer resolves ({error}); its \
                 folder is now {found}, inside this folder, so reselect it there first",
                name = held.location.name,
                stored = held.location.path.display(),
                error = held.error,
                found = NativePath::from_path(found).display(),
            );
            (held, message)
        }
        FolderSearch::Incomplete(reason) => {
            let held = &stale[0];
            let message = format!(
                "registered location {name:?} at {stored} no longer resolves ({error}), and this \
                 folder cannot be searched for it: {reason}; reselect {name:?} at its current \
                 folder first, review and confirm Retire location for {name:?} if it was \
                 deleted, or choose a folder that can be searched completely",
                name = held.location.name,
                stored = held.location.path.display(),
                error = held.error,
            );
            (held, message)
        }
    };
    Err(scoped(LibraryError::IdentityConflict(message), path.clone(), Some(held.location.id)))
}

/// Outcome of searching a root's folders for recorded folder identities.
#[cfg_attr(not(unix), allow(dead_code))]
enum FolderSearch {
    Absent,
    /// `index` is the position of the matched identity in the search.
    Found {
        index: usize,
        path: PathBuf,
    },
    Incomplete(String),
}

/// Search `root` and the real folders below it on its own device for any `wanted`
/// `(device, inode)`, reading at most `bounds.folders` folders within `bounds.time`.
/// Links are never followed, folders on another device are not entered, and a
/// folder that cannot be read leaves the search incomplete rather than skipped.
#[cfg(unix)]
fn search_folders(root: &Path, wanted: &[(u64, u64)], bounds: SearchBounds) -> FolderSearch {
    let deadline = std::time::Instant::now() + bounds.time;
    let too_slow = || {
        (std::time::Instant::now() >= deadline).then(|| {
            FolderSearch::Incomplete(format!(
                "it took longer than {} s to search, and the search can be retried",
                bounds.time.as_secs()
            ))
        })
    };
    let unreadable = |folder: &Path, error: &dyn std::fmt::Display| {
        FolderSearch::Incomplete(format!("{} cannot be read ({error})", folder.display()))
    };
    let metadata = match real_directory(root) {
        Ok(metadata) => metadata,
        Err(error) => return unreadable(root, &error),
    };
    let device = device_of(&metadata);
    if let Some(index) = wanted.iter().position(|folder| *folder == stamp_of(&metadata)) {
        return FolderSearch::Found { index, path: root.to_path_buf() };
    }
    let mut pending = vec![root.to_path_buf()];
    let mut read = 0_usize;
    while let Some(folder) = pending.pop() {
        read += 1;
        if read > bounds.folders {
            return FolderSearch::Incomplete(format!(
                "it holds more than {} folders",
                bounds.folders
            ));
        }
        if let Some(incomplete) = too_slow() {
            return incomplete;
        }
        let entries = match std::fs::read_dir(&folder) {
            Ok(entries) => entries,
            Err(error) => return unreadable(&folder, &error),
        };
        for entry in entries {
            if let Some(incomplete) = too_slow() {
                return incomplete;
            }
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => return unreadable(&folder, &error),
            };
            // The entry's own type: a link to a folder is a link, never followed.
            match entry.file_type() {
                Ok(kind) if kind.is_dir() => {}
                Ok(_) => continue,
                Err(error) => return unreadable(&entry.path(), &error),
            }
            let path = entry.path();
            let metadata = match lstat(&path) {
                Ok(metadata) => metadata,
                Err(error) => return unreadable(&path, &error),
            };
            if fs_pathsafe::is_link_or_junction_metadata(&metadata) || !metadata.is_dir() {
                continue;
            }
            if let Some(index) = wanted.iter().position(|folder| *folder == stamp_of(&metadata)) {
                return FolderSearch::Found { index, path };
            }
            if device_of(&metadata) == device {
                pending.push(path);
            }
        }
    }
    FolderSearch::Absent
}

// Only reached through a recorded folder identity, which this host never carries.
#[cfg(not(unix))]
fn search_folders(_root: &Path, _wanted: &[(u64, u64)], _bounds: SearchBounds) -> FolderSearch {
    FolderSearch::Incomplete("this host has no folder identity".into())
}

async fn insert_location(
    conn: &mut SqliteConnection,
    id: Uuid,
    name: &str,
    input: &LocationRegistration,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO locations (id, name, path_key, role, identity, volume_filesystem, \
         volume_stable_id, decision_revision, availability, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, 'available', ?8)",
    )
    .bind(id.to_string())
    .bind(name)
    .bind(path_key(&input.path))
    .bind(to_text(&input.role)?)
    .bind(to_json(&input.identity)?)
    .bind(input.identity.volume.filesystem.as_str())
    .bind(input.identity.volume.stable_id.as_deref())
    .bind(now()?)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

async fn set_location_unavailable(
    conn: &mut SqliteConnection,
    id: Uuid,
    availability: Availability,
    reason: &str,
) -> Result<()> {
    sqlx::query(
        "UPDATE locations SET availability = ?1, unavailable_reason = ?2, unavailable_at = ?3 \
         WHERE id = ?4",
    )
    .bind(to_text(&availability)?)
    .bind(reason)
    .bind(now()?)
    .bind(id.to_string())
    .execute(&mut *conn)
    .await?;
    Ok(())
}

async fn mark_location_observed(conn: &mut SqliteConnection, id: Uuid) -> Result<()> {
    sqlx::query(
        "UPDATE locations SET availability = 'available', unavailable_reason = NULL, \
         unavailable_at = NULL, last_observed_at = ?1 WHERE id = ?2",
    )
    .bind(now()?)
    .bind(id.to_string())
    .execute(&mut *conn)
    .await?;
    Ok(())
}

async fn load_location(conn: &mut SqliteConnection, id: Uuid) -> Result<Location> {
    let row = sqlx::query("SELECT * FROM locations WHERE id = ?1")
        .bind(id.to_string())
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| LibraryError::NotFound(format!("location {id}")))?;
    location_from_row(&row)
}

fn location_from_row(row: &SqliteRow) -> Result<Location> {
    Ok(Location {
        id: parse_uuid(&row.try_get::<String, _>("id")?)?,
        name: row.try_get("name")?,
        path: path_from_key(&row.try_get::<Vec<u8>, _>("path_key")?)?,
        role: from_text(&row.try_get::<String, _>("role")?)?,
        identity: from_json(&row.try_get::<String, _>("identity")?)?,
        decision_revision: revision(row.try_get("decision_revision")?)?,
        availability: from_text(&row.try_get::<String, _>("availability")?)?,
        last_observed_at: row.try_get("last_observed_at")?,
        lifecycle: from_text(&row.try_get::<String, _>("lifecycle")?)?,
    })
}

/// Provisional until the latest scan completed and every decided asset it covered
/// finished its rehash. Two indexed lookups; duplicate candidates are judged per
/// read request over the assets it reports.
async fn location_provisional(conn: &mut SqliteConnection, id: Uuid) -> Result<bool> {
    count_read("location_provisional");
    let state: Option<String> = sqlx::query_scalar(
        "SELECT state FROM scan_operations WHERE location_id = ?1 ORDER BY sequence DESC LIMIT 1",
    )
    .bind(id.to_string())
    .fetch_optional(&mut *conn)
    .await?;
    let pending: bool =
        sqlx::query_scalar(PENDING_IN_LOCATION).bind(id.to_string()).fetch_one(&mut *conn).await?;
    Ok(state.as_deref() != Some("completed") || pending)
}

/// The first readable pass of an operation (its first verified batch, or its
/// terminal pass) marks every decided asset in its scope verification pending,
/// and every copy whose recorded digest carries a decided copy's decision in
/// another location. Each successful rehash in this operation clears the mark; a
/// canceled scan or a failed rehash leaves it. Offline scans never get here, so
/// offline inputs keep their last-observed quality.
async fn arm_verification(conn: &mut SqliteConnection, op: &OperationRow) -> Result<()> {
    let armed = sqlx::query(
        "UPDATE scan_operations SET verification_armed = 1 WHERE id = ?1 AND verification_armed = 0",
    )
    .bind(op.id.to_string())
    .execute(&mut *conn)
    .await?
    .rows_affected();
    if armed == 0 {
        return Ok(());
    }
    let key = path_key(&op.scope);
    let rows = sqlx::query(
        "SELECT a.id, a.path_key FROM assets a WHERE a.location_id = ?1 \
         AND a.availability <> 'missing' AND substr(a.path_key, 1, ?2) = ?3 \
         AND (a.quality <> 'unreviewed' OR (a.content_sha256 IS NOT NULL AND (EXISTS ( \
             SELECT 1 FROM assets d WHERE d.content_sha256 = a.content_sha256 \
             AND d.location_id <> a.location_id) \
             OR EXISTS (SELECT 1 FROM copy_links WHERE left_id = a.id) \
             OR EXISTS (SELECT 1 FROM copy_links WHERE right_id = a.id))))",
    )
    .bind(op.location_id.to_string())
    .bind(i64::try_from(key.len()).map_err(|_| LibraryError::InvalidInput("path too long".into()))?)
    .bind(key)
    .fetch_all(&mut *conn)
    .await?;
    for row in &rows {
        if within(&path_from_key(&row.try_get::<Vec<u8>, _>("path_key")?)?, &op.scope) {
            sqlx::query("UPDATE assets SET verification_pending = 1 WHERE id = ?1")
                .bind(row.try_get::<String, _>("id")?)
                .execute(&mut *conn)
                .await?;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Scan helpers
// ---------------------------------------------------------------------------
impl Catalog {
    /// Saved targets in stable order for merged ranking with the seed index.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn list_targets(&self, offset: u32, limit: u32) -> Result<Vec<TargetRecord>> {
        let mut conn = self.reader().await?;
        let ids: Vec<String> = sqlx::query_scalar(
            "SELECT id FROM targets ORDER BY designation, id LIMIT ?1 OFFSET ?2",
        )
        .bind(i64::from(if limit == 0 { MAX_PAGE } else { limit.min(MAX_PAGE) }))
        .bind(i64::from(offset))
        .fetch_all(&mut *conn)
        .await?;
        let mut records = Vec::with_capacity(ids.len());
        for id in ids {
            records.push(load_target(&mut conn, parse_uuid(&id)?).await?);
        }
        Ok(records)
    }
}

struct FinishInput<'a> {
    observation: &'a ScanObservation,
    /// The observation's files and issues no batch of this operation applied.
    pending: &'a Pending<'a>,
    digests: &'a DigestMap,
    /// Root folder identity proven by a remount-stable file id.
    proven: bool,
}

struct Pending<'a> {
    files: Vec<&'a ScanFile>,
    issues: Vec<&'a ScanIssue>,
}

fn require_running(op: &OperationRow) -> Result<()> {
    if op.state == ScanState::Running {
        Ok(())
    } else {
        Err(LibraryError::InvalidInput(format!("scan {} is not running", op.id)))
    }
}

fn verify_root(location: &Location, op: &OperationRow, observed: &FileIdentity) -> Result<()> {
    observed.volume.validate()?;
    if location.decision_revision != op.location_revision || location.identity != op.root_identity {
        return Err(LibraryError::IdentityConflict(
            "location was reselected or remapped during this scan".into(),
        ));
    }
    if !same_root(&location.identity, observed) {
        return Err(LibraryError::IdentityConflict(
            "root volume or folder identity differs from the registered location".into(),
        ));
    }
    Ok(())
}

fn unavailable_for(error: &LibraryError) -> Availability {
    match error.response(None, None).kind.as_str() {
        "access_denied" => Availability::Unreadable,
        "identity_conflict" => Availability::IdentityConflict,
        _ => Availability::Offline,
    }
}

async fn downgrade(
    conn: &mut SqliteConnection,
    op: &OperationRow,
    location: &Location,
    error: &LibraryError,
) -> Result<()> {
    let availability = unavailable_for(error);
    let reason = error.to_string();
    sqlx::query(
        "UPDATE scan_operations SET identity_verified = 0, revision = revision + 1 WHERE id = ?1",
    )
    .bind(op.id.to_string())
    .execute(&mut *conn)
    .await?;
    add_issue(conn, op.id, &op.scope, &reason, availability).await?;
    mark_scope_incomplete(conn, op.id, &op.scope).await?;
    set_location_unavailable(conn, location.id, availability, &reason).await
}

async fn finish_verified<G>(
    conn: &mut SqliteConnection,
    op: &OperationRow,
    location: &Location,
    input: FinishInput<'_>,
    grouping: &mut G,
) -> Result<()>
where
    G: FnMut(&[Asset]) -> GroupingResult,
{
    let observation = input.observation;
    arm_verification(conn, op).await?;
    let changed = observe_batch(
        conn,
        op,
        location,
        &input.pending.files,
        &input.pending.issues,
        input.digests,
    )
    .await?;
    regroup(conn, &changed.regroup, grouping, Cause::Scan(op.id)).await?;
    invalidate_inferences(conn, &changed.evidence).await?;
    mark_location_observed(conn, location.id).await?;
    let op = load_operation_row(conn, op.id).await?;
    let mut incomplete = op.incomplete.clone();
    for scope in &observation.incomplete_scopes {
        scope
            .relative_path()
            .map_err(|error| scoped(error, scope.clone(), Some(op.location_id)))?;
        push_unique(&mut incomplete, scope.clone());
    }
    let terminal = matches!(observation.state, ScanState::Completed | ScanState::Partial);
    if !terminal {
        push_unique(&mut incomplete, op.scope.clone());
    }
    let mut complete = Vec::new();
    if terminal && !input.proven {
        push_unique(&mut incomplete, op.scope.clone());
    }
    if terminal && op.identity_verified && input.proven {
        for scope in &observation.complete_scopes {
            scope
                .relative_path()
                .map_err(|error| scoped(error, scope.clone(), Some(op.location_id)))?;
            if within(scope, &op.scope) {
                push_unique(&mut complete, scope.clone());
            }
        }
    }
    if !complete.is_empty() {
        reconcile_absence(conn, &op, &complete, &incomplete).await?;
    }
    let issues = load_issue_paths(conn, op.id).await?;
    let state = match observation.state {
        ScanState::Completed
            if !incomplete.is_empty() || !issues.is_empty() || complete.is_empty() =>
        {
            ScanState::Partial
        }
        other => other,
    };
    let progress = terminal_progress(&op, &observation.progress);
    finalize_operation(conn, op.id, state, &progress, &complete, &incomplete).await
}

async fn finish_unverified(
    conn: &mut SqliteConnection,
    op: &OperationRow,
    observation: &ScanObservation,
) -> Result<()> {
    let op = load_operation_row(conn, op.id).await?;
    let mut incomplete = op.incomplete.clone();
    push_unique(&mut incomplete, op.scope.clone());
    for scope in &observation.incomplete_scopes {
        push_unique(&mut incomplete, scope.clone());
    }
    let state = match observation.state {
        ScanState::Completed | ScanState::Partial => ScanState::Partial,
        other => other,
    };
    let progress = terminal_progress(&op, &observation.progress);
    finalize_operation(conn, op.id, state, &progress, &[], &incomplete).await
}

/// The walk's terminal counts plus the duplicate verification this scan recorded.
fn terminal_progress(op: &OperationRow, walked: &ScanProgress) -> ScanProgress {
    ScanProgress {
        duplicate_candidates: op.progress.duplicate_candidates,
        duplicates_verified: op.progress.duplicates_verified,
        ..walked.clone()
    }
}

async fn reconcile_absence(
    conn: &mut SqliteConnection,
    op: &OperationRow,
    complete: &[NativePath],
    incomplete: &[NativePath],
) -> Result<()> {
    let issues = load_issue_paths(conn, op.id).await?;
    let rows = sqlx::query(
        "SELECT id, path_key FROM assets WHERE location_id = ?1 AND availability <> 'missing' \
         AND (last_operation_id IS NULL OR last_operation_id <> ?2)",
    )
    .bind(op.location_id.to_string())
    .bind(op.id.to_string())
    .fetch_all(&mut *conn)
    .await?;
    for row in &rows {
        let path = path_from_key(&row.try_get::<Vec<u8>, _>("path_key")?)?;
        let uncertain = incomplete.iter().chain(&issues).any(|scope| within(&path, scope));
        if within(&path, &op.scope)
            && complete.iter().any(|scope| within(&path, scope))
            && !uncertain
        {
            sqlx::query(
                "UPDATE assets SET availability = 'missing', verification_pending = 0 WHERE id = ?1",
            )
                .bind(row.try_get::<String, _>("id")?)
                .execute(&mut *conn)
                .await?;
        }
    }
    Ok(())
}

async fn observe_batch(
    conn: &mut SqliteConnection,
    op: &OperationRow,
    location: &Location,
    files: &[&ScanFile],
    issues: &[&ScanIssue],
    digests: &DigestMap,
) -> Result<BatchChanges> {
    let observed_at = now()?;
    let mut changed = BatchChanges::default();
    for file in files.iter().copied() {
        match digests.get(&path_key(&file.relative_path)) {
            Some(Err(error)) => {
                let issue = ScanIssue {
                    relative_path: file.relative_path.clone(),
                    reason: format!("reviewed frame could not be content-verified: {error}"),
                    availability: Availability::Unreadable,
                };
                record_issue(conn, op, &issue).await?;
            }
            digest => {
                let digest = digest.and_then(|digest| digest.as_ref().ok()).cloned();
                let observed = ObservedFile { file, digest };
                match observe_file(conn, op, location, observed, &observed_at).await? {
                    Change::Unchanged => {}
                    Change::Inserted(id) => {
                        changed.regroup.insert(id);
                        changed.evidence.insert(id);
                    }
                    Change::Refreshed { id, regroup } => {
                        if regroup {
                            changed.regroup.insert(id);
                        }
                        changed.evidence.insert(id);
                    }
                }
            }
        }
    }
    for issue in issues.iter().copied() {
        validate_issue(issue)?;
        record_issue(conn, op, issue).await?;
    }
    Ok(changed)
}

struct ObservedFile<'a> {
    file: &'a ScanFile,
    digest: Option<String>,
}

enum Change {
    Unchanged,
    Inserted(Uuid),
    /// Recorded evidence (fingerprint, format or observed metadata) changed.
    Refreshed {
        id: Uuid,
        regroup: bool,
    },
}

/// Assets a batch changed: `regroup` need capture regrouping; `evidence` are new
/// members or had their recorded observation replaced, so any inference about
/// the sessions now holding them was made without their current evidence.
#[derive(Default)]
struct BatchChanges {
    regroup: BTreeSet<Uuid>,
    evidence: BTreeSet<Uuid>,
}

async fn observe_file(
    conn: &mut SqliteConnection,
    op: &OperationRow,
    location: &Location,
    observed: ObservedFile<'_>,
    observed_at: &str,
) -> Result<Change> {
    let file = observed.file;
    file.relative_path
        .relative_path()
        .map_err(|error| scoped(error, file.relative_path.clone(), Some(location.id)))?;
    if !within(&file.relative_path, &op.scope) {
        return Err(scoped(
            LibraryError::InvalidInput("observed file is outside the scan scope".into()),
            file.relative_path.clone(),
            Some(location.id),
        ));
    }
    if !same_volume(&file.fingerprint.identity.volume, &location.identity.volume) {
        let issue = ScanIssue {
            relative_path: file.relative_path.clone(),
            reason: "file is on another volume; boundary scope excluded".into(),
            availability: Availability::IdentityConflict,
        };
        record_issue(conn, op, &issue).await?;
        return Ok(Change::Unchanged);
    }
    let mut fingerprint = file.fingerprint.clone();
    fingerprint.content_sha256 = observed.digest;
    match find_asset(conn, location, &file.relative_path, &fingerprint, op.id).await? {
        AssetMatch::Existing(stored)
            if stored.quality != Quality::Unreviewed && fingerprint.content_sha256.is_none() =>
        {
            let issue = ScanIssue {
                relative_path: file.relative_path.clone(),
                reason: "reviewed frame was not content-verified in this scan".into(),
                availability: Availability::Unreadable,
            };
            record_issue(conn, op, &issue).await?;
            Ok(Change::Unchanged)
        }
        AssetMatch::Existing(stored) => {
            refresh_asset(conn, op, &stored, file, fingerprint, observed_at).await
        }
        AssetMatch::Unproven(candidates) => {
            let reason = "path is a case/normalization variant of a catalog record \
                          without qualified file identity";
            let paths = candidates.into_iter().map(|asset| asset.relative_path);
            for relative_path in std::iter::once(file.relative_path.clone()).chain(paths) {
                let issue = ScanIssue {
                    relative_path,
                    reason: reason.into(),
                    availability: Availability::IdentityConflict,
                };
                record_issue(conn, op, &issue).await?;
            }
            Ok(Change::Unchanged)
        }
        AssetMatch::Distinct(variants) => {
            // Proven different files: the variant records stay unchanged and are
            // excluded from this scan's absence reconciliation.
            for variant in &variants {
                mark_scope_incomplete(conn, op.id, variant).await?;
            }
            insert_asset(conn, op, location, file, &fingerprint, observed_at)
                .await
                .map(Change::Inserted)
        }
        AssetMatch::New => insert_asset(conn, op, location, file, &fingerprint, observed_at)
            .await
            .map(Change::Inserted),
    }
}

enum AssetMatch {
    New,
    Existing(Box<Asset>),
    /// Name variants whose qualified file identity differs from the observed file.
    Distinct(Vec<NativePath>),
    /// Name variants that cannot be told apart without qualified file identity.
    Unproven(Vec<Asset>),
}

/// Exact path, or on a case/normalization-insensitive volume the name variant
/// with identical size, nanosecond mtime and qualified stable file id, not yet
/// seen by this scan. Path equivalence alone never adopts another record.
async fn find_asset(
    conn: &mut SqliteConnection,
    location: &Location,
    path: &NativePath,
    fingerprint: &ObservationFingerprint,
    operation_id: Uuid,
) -> Result<AssetMatch> {
    let exact = sqlx::query(asset_sql!("WHERE a.location_id = ?1 AND a.path_key = ?2"))
        .bind(location.id.to_string())
        .bind(path_key(path))
        .fetch_optional(&mut *conn)
        .await?;
    if let Some(row) = exact {
        return asset_from_row(&row).map(|asset| AssetMatch::Existing(Box::new(asset)));
    }
    let volume = &location.identity.volume;
    if volume.case != PathSensitivity::Insensitive
        && volume.normalization != PathSensitivity::Insensitive
    {
        return Ok(AssetMatch::New);
    }
    let rows = sqlx::query(asset_sql!(
        "WHERE a.location_id = ?1 AND a.size_bytes = ?2 AND a.modified_ns = ?3 \
         AND (a.last_operation_id IS NULL OR a.last_operation_id <> ?4)"
    ))
    .bind(location.id.to_string())
    .bind(db_size(fingerprint.size_bytes)?)
    .bind(fingerprint.modified_ns.to_string())
    .bind(operation_id.to_string())
    .fetch_all(&mut *conn)
    .await?;
    let mut variants = Vec::new();
    for row in &rows {
        let asset = asset_from_row(row)?;
        if asset.relative_path.same_on(path, volume) {
            variants.push(asset);
        }
    }
    if variants.is_empty() {
        return Ok(AssetMatch::New);
    }
    let observed_id = fingerprint.identity.file_id.as_deref().filter(|_| volume.file_ids_stable);
    let qualified =
        |asset: &Asset| observed_id.is_some() && asset.fingerprint.identity.file_id.is_some();
    if let Some(index) = variants.iter().position(|asset| {
        qualified(asset) && asset.fingerprint.identity.file_id.as_deref() == observed_id
    }) {
        return Ok(AssetMatch::Existing(Box::new(variants.swap_remove(index))));
    }
    Ok(if variants.iter().all(qualified) {
        AssetMatch::Distinct(variants.into_iter().map(|asset| asset.relative_path).collect())
    } else {
        AssetMatch::Unproven(variants)
    })
}

async fn refresh_asset(
    conn: &mut SqliteConnection,
    op: &OperationRow,
    stored: &Asset,
    file: &ScanFile,
    fingerprint: ObservationFingerprint,
    observed_at: &str,
) -> Result<Change> {
    let unchanged = fingerprint_matches(&stored.fingerprint, &fingerprint)
        && stored.format == file.format
        && stored.observed == file.metadata;
    if unchanged {
        clear_verified(conn, stored.id, &fingerprint).await?;
        let mut retained = stored.fingerprint.clone();
        if retained.content_sha256.is_none() {
            retained.content_sha256 = fingerprint.content_sha256;
        }
        sqlx::query(
            "UPDATE assets SET path_key = ?1, fingerprint = ?2, availability = 'available', \
             last_observed_at = ?3, last_operation_id = ?4 WHERE id = ?5",
        )
        .bind(path_key(&file.relative_path))
        .bind(to_json(&retained)?)
        .bind(observed_at)
        .bind(op.id.to_string())
        .bind(stored.id.to_string())
        .execute(&mut *conn)
        .await?;
        return Ok(Change::Unchanged);
    }
    if let Some(previous) = stored.fingerprint.content_sha256.as_deref() {
        if fingerprint.content_sha256.as_deref() != Some(previous) {
            // The copy diverges from the bytes it shared with copies elsewhere: record
            // that they were one capture before the digest is replaced (D16).
            sqlx::query(LINK_IDENTICAL_COPIES)
                .bind(stored.id.to_string())
                .bind(previous)
                .bind(stored.location_id.to_string())
                .execute(&mut *conn)
                .await?;
        }
    }
    let sequence = stored.observation_revision + 1;
    let effective = effective_metadata(conn, stored.id, &file.metadata).await?;
    sqlx::query(
        "UPDATE assets SET path_key = ?1, fingerprint = ?2, size_bytes = ?3, modified_ns = ?4, \
         format = ?5, availability = 'available', observed = ?6, effective = ?7, \
         observation_revision = ?8, last_observed_at = ?9, last_operation_id = ?10 WHERE id = ?11",
    )
    .bind(path_key(&file.relative_path))
    .bind(to_json(&fingerprint)?)
    .bind(db_size(fingerprint.size_bytes)?)
    .bind(fingerprint.modified_ns.to_string())
    .bind(to_text(&file.format)?)
    .bind(to_json(&file.metadata)?)
    .bind(to_json(&effective)?)
    .bind(db_revision(sequence)?)
    .bind(observed_at)
    .bind(op.id.to_string())
    .bind(stored.id.to_string())
    .execute(&mut *conn)
    .await?;
    insert_observation(conn, stored.id, op.id, sequence, &fingerprint, file, observed_at).await?;
    clear_verified(conn, stored.id, &fingerprint).await?;
    Ok(Change::Refreshed { id: stored.id, regroup: effective != stored.effective })
}

/// A content digest taken in this scan finishes the asset's pending rehash.
async fn clear_verified(
    conn: &mut SqliteConnection,
    id: Uuid,
    fingerprint: &ObservationFingerprint,
) -> Result<()> {
    if fingerprint.content_sha256.is_some() {
        sqlx::query("UPDATE assets SET verification_pending = 0 WHERE id = ?1")
            .bind(id.to_string())
            .execute(&mut *conn)
            .await?;
    }
    Ok(())
}

async fn insert_asset(
    conn: &mut SqliteConnection,
    op: &OperationRow,
    location: &Location,
    file: &ScanFile,
    fingerprint: &ObservationFingerprint,
    observed_at: &str,
) -> Result<Uuid> {
    let id = Uuid::new_v4();
    let metadata = to_json(&file.metadata)?;
    sqlx::query(
        "INSERT INTO assets (id, location_id, path_key, fingerprint, size_bytes, modified_ns, \
         format, availability, observed, effective, observation_revision, decision_revision, \
         quality, last_observed_at, last_operation_id) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'available', ?8, ?8, 1, 0, 'unreviewed', ?9, ?10)",
    )
    .bind(id.to_string())
    .bind(location.id.to_string())
    .bind(path_key(&file.relative_path))
    .bind(to_json(fingerprint)?)
    .bind(db_size(fingerprint.size_bytes)?)
    .bind(fingerprint.modified_ns.to_string())
    .bind(to_text(&file.format)?)
    .bind(metadata)
    .bind(observed_at)
    .bind(op.id.to_string())
    .execute(&mut *conn)
    .await?;
    insert_observation(conn, id, op.id, 1, fingerprint, file, observed_at).await?;
    Ok(id)
}

async fn insert_observation(
    conn: &mut SqliteConnection,
    asset_id: Uuid,
    operation_id: Uuid,
    sequence: Revision,
    fingerprint: &ObservationFingerprint,
    file: &ScanFile,
    observed_at: &str,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO observations (asset_id, operation_id, sequence, fingerprint, format, \
         metadata, observed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    )
    .bind(asset_id.to_string())
    .bind(operation_id.to_string())
    .bind(db_revision(sequence)?)
    .bind(to_json(fingerprint)?)
    .bind(to_text(&file.format)?)
    .bind(to_json(&file.metadata)?)
    .bind(observed_at)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

fn validate_issue(issue: &ScanIssue) -> Result<()> {
    issue
        .relative_path
        .relative_path()
        .map_err(|error| scoped(error, issue.relative_path.clone(), None))?;
    if matches!(issue.availability, Availability::Available | Availability::Missing) {
        return Err(scoped(
            LibraryError::InvalidInput("scan issues cannot assert Available or Missing".into()),
            issue.relative_path.clone(),
            None,
        ));
    }
    Ok(())
}

/// Record a scan issue under its reported path, and apply it to the part of the
/// location this operation covers. A failure at or above the operation's scope
/// (root continuity loss during a subtree retry) marks only that scope incomplete
/// and changes availability only for assets inside it.
async fn record_issue(
    conn: &mut SqliteConnection,
    op: &OperationRow,
    issue: &ScanIssue,
) -> Result<()> {
    let scope = if within(&issue.relative_path, &op.scope) {
        issue.relative_path.clone()
    } else if within(&op.scope, &issue.relative_path) {
        op.scope.clone()
    } else {
        return Err(scoped(
            LibraryError::InvalidInput("scan issue is outside the scan scope".into()),
            issue.relative_path.clone(),
            Some(op.location_id),
        ));
    };
    add_issue(conn, op.id, &issue.relative_path, &issue.reason, issue.availability).await?;
    mark_scope_incomplete(conn, op.id, &scope).await?;
    let key = path_key(&scope);
    let rows = sqlx::query(
        "SELECT id, path_key FROM assets WHERE location_id = ?1 AND substr(path_key, 1, ?2) = ?3",
    )
    .bind(op.location_id.to_string())
    .bind(i64::try_from(key.len()).map_err(|_| LibraryError::InvalidInput("path too long".into()))?)
    .bind(key)
    .fetch_all(&mut *conn)
    .await?;
    let availability = to_text(&issue.availability)?;
    for row in &rows {
        let path = path_from_key(&row.try_get::<Vec<u8>, _>("path_key")?)?;
        if within(&path, &scope) {
            sqlx::query("UPDATE assets SET availability = ?1 WHERE id = ?2")
                .bind(availability.as_str())
                .bind(row.try_get::<String, _>("id")?)
                .execute(&mut *conn)
                .await?;
        }
    }
    Ok(())
}

async fn add_issue(
    conn: &mut SqliteConnection,
    operation_id: Uuid,
    path: &NativePath,
    reason: &str,
    availability: Availability,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO scan_issues (operation_id, path_key, reason, availability) \
         VALUES (?1, ?2, ?3, ?4)",
    )
    .bind(operation_id.to_string())
    .bind(path_key(path))
    .bind(reason)
    .bind(to_text(&availability)?)
    .execute(&mut *conn)
    .await?;
    sqlx::query("UPDATE scan_operations SET revision = revision + 1 WHERE id = ?1")
        .bind(operation_id.to_string())
        .execute(&mut *conn)
        .await?;
    Ok(())
}

async fn mark_scope_incomplete(
    conn: &mut SqliteConnection,
    operation_id: Uuid,
    scope: &NativePath,
) -> Result<()> {
    let stored: String =
        sqlx::query_scalar("SELECT incomplete_scopes FROM scan_operations WHERE id = ?1")
            .bind(operation_id.to_string())
            .fetch_one(&mut *conn)
            .await?;
    let mut scopes: Vec<NativePath> = from_json(&stored)?;
    if push_unique(&mut scopes, scope.clone()) {
        sqlx::query("UPDATE scan_operations SET incomplete_scopes = ?1 WHERE id = ?2")
            .bind(to_json(&scopes)?)
            .bind(operation_id.to_string())
            .execute(&mut *conn)
            .await?;
    }
    Ok(())
}

fn push_unique(paths: &mut Vec<NativePath>, path: NativePath) -> bool {
    if paths.contains(&path) {
        false
    } else {
        paths.push(path);
        true
    }
}

async fn running_operation(conn: &mut SqliteConnection, location_id: Uuid) -> Result<Option<Uuid>> {
    let id: Option<String> = sqlx::query_scalar(
        "SELECT id FROM scan_operations WHERE location_id = ?1 AND state = 'running'",
    )
    .bind(location_id.to_string())
    .fetch_optional(&mut *conn)
    .await?;
    id.as_deref().map(parse_uuid).transpose()
}

async fn insert_operation(
    conn: &mut SqliteConnection,
    id: Uuid,
    location: &Location,
    scope: &NativePath,
) -> Result<()> {
    let sequence = next_counter(conn, "scan_sequence").await?;
    sqlx::query(
        "INSERT INTO scan_operations (id, location_id, scope_key, state, root_identity, \
         location_revision, progress, complete_scopes, incomplete_scopes, identity_verified, \
         sequence, started_at) VALUES (?1, ?2, ?3, 'running', ?4, ?5, ?6, '[]', '[]', 1, ?7, ?8)",
    )
    .bind(id.to_string())
    .bind(location.id.to_string())
    .bind(path_key(scope))
    .bind(to_json(&location.identity)?)
    .bind(db_revision(location.decision_revision)?)
    .bind(to_json(&ScanProgress::default())?)
    .bind(db_revision(sequence)?)
    .bind(now()?)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

async fn finalize_operation(
    conn: &mut SqliteConnection,
    id: Uuid,
    state: ScanState,
    progress: &ScanProgress,
    complete: &[NativePath],
    incomplete: &[NativePath],
) -> Result<()> {
    sqlx::query(
        "UPDATE scan_operations SET state = ?1, progress = ?2, complete_scopes = ?3, \
         incomplete_scopes = ?4, finished_at = ?5, revision = revision + 1 WHERE id = ?6",
    )
    .bind(to_text(&state)?)
    .bind(to_json(progress)?)
    .bind(to_json(&complete)?)
    .bind(to_json(&incomplete)?)
    .bind(now()?)
    .bind(id.to_string())
    .execute(&mut *conn)
    .await?;
    Ok(())
}

async fn load_operation_row(conn: &mut SqliteConnection, id: Uuid) -> Result<OperationRow> {
    let row = sqlx::query("SELECT * FROM scan_operations WHERE id = ?1")
        .bind(id.to_string())
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| LibraryError::NotFound(format!("scan operation {id}")))?;
    Ok(OperationRow {
        id,
        location_id: parse_uuid(&row.try_get::<String, _>("location_id")?)?,
        scope: path_from_key(&row.try_get::<Vec<u8>, _>("scope_key")?)?,
        state: from_text(&row.try_get::<String, _>("state")?)?,
        root_identity: from_json(&row.try_get::<String, _>("root_identity")?)?,
        location_revision: revision(row.try_get("location_revision")?)?,
        progress: from_json(&row.try_get::<String, _>("progress")?)?,
        complete: from_json(&row.try_get::<String, _>("complete_scopes")?)?,
        incomplete: from_json(&row.try_get::<String, _>("incomplete_scopes")?)?,
        identity_verified: row.try_get::<i64, _>("identity_verified")? == 1,
        revision: revision(row.try_get("revision")?)?,
        started_at: row.try_get("started_at")?,
        finished_at: row.try_get("finished_at")?,
    })
}

async fn load_operation(conn: &mut SqliteConnection, id: Uuid) -> Result<ScanOperation> {
    let row = load_operation_row(conn, id).await?;
    let rows = sqlx::query(
        "SELECT path_key, reason, availability FROM scan_issues WHERE operation_id = ?1 ORDER BY id",
    )
    .bind(id.to_string())
    .fetch_all(&mut *conn)
    .await?;
    let issues = rows
        .iter()
        .map(|issue| {
            Ok(ScanIssue {
                relative_path: path_from_key(&issue.try_get::<Vec<u8>, _>("path_key")?)?,
                reason: issue.try_get("reason")?,
                availability: from_text(&issue.try_get::<String, _>("availability")?)?,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(ScanOperation {
        id: row.id,
        location_id: row.location_id,
        state: row.state,
        revision: row.revision,
        progress: row.progress,
        issues,
        complete_scopes: row.complete,
        incomplete_scopes: row.incomplete,
        started_at: row.started_at,
        finished_at: row.finished_at,
    })
}

async fn load_issue_paths(
    conn: &mut SqliteConnection,
    operation_id: Uuid,
) -> Result<Vec<NativePath>> {
    let keys: Vec<Vec<u8>> =
        sqlx::query_scalar("SELECT path_key FROM scan_issues WHERE operation_id = ?1")
            .bind(operation_id.to_string())
            .fetch_all(&mut *conn)
            .await?;
    keys.iter().map(|key| path_from_key(key)).collect()
}

async fn next_counter(conn: &mut SqliteConnection, key: &'static str) -> Result<Revision> {
    let value: i64 = sqlx::query_scalar(
        "UPDATE catalog_meta SET value = value + 1 WHERE key = ?1 RETURNING value",
    )
    .bind(key)
    .fetch_one(&mut *conn)
    .await?;
    revision(value)
}

// ---------------------------------------------------------------------------
// Grouping: supplied pure callback inside the current transaction
// ---------------------------------------------------------------------------

async fn regroup<G>(
    conn: &mut SqliteConnection,
    changed: &BTreeSet<Uuid>,
    grouping: &mut G,
    cause: Cause,
) -> Result<Option<SessionLineage>>
where
    G: FnMut(&[Asset]) -> GroupingResult,
{
    if changed.is_empty() {
        return Ok(None);
    }
    let changed_assets = load_assets(conn, changed).await?;
    let first = checked_grouping(grouping(&changed_assets), changed)?;
    let mut affected: BTreeSet<Uuid> =
        current_session_of(conn, changed).await?.into_values().collect();
    for candidate in &first.sessions {
        affected.extend(current_sessions_with_key(conn, &candidate.key).await?);
    }
    let mut prior = BTreeMap::new();
    let mut closure = changed.clone();
    for id in &affected {
        let row = load_session_row(conn, *id).await?;
        let members = current_members(conn, *id).await?;
        closure.extend(members.iter().copied());
        prior.insert(*id, PriorSession { key: row.session.key, members });
    }
    let closure_assets = load_assets(conn, &closure).await?;
    let result = checked_grouping(grouping(&closure_assets), &closure)?;
    let old_session_of = current_session_of(conn, &closure).await?;
    let plan = plan_grouping(&prior, &old_session_of, result);
    let context =
        GroupContext { prior: &prior, old_session_of: &old_session_of, assets: &closure_assets };
    commit_plan(conn, plan, &context, cause).await
}

/// Every input asset must belong to exactly one candidate and nothing else.
fn checked_grouping(result: GroupingResult, expected: &BTreeSet<Uuid>) -> Result<GroupingResult> {
    let mut seen = BTreeSet::new();
    for candidate in &result.sessions {
        if candidate.key.0.is_empty() || candidate.asset_ids.is_empty() {
            return Err(LibraryError::InvalidInput("grouping returned an empty session".into()));
        }
        for id in &candidate.asset_ids {
            if !expected.contains(id) || !seen.insert(*id) {
                return Err(LibraryError::InvalidInput(format!(
                    "grouping returned asset {id} outside its input or twice"
                )));
            }
        }
    }
    if seen.len() != expected.len() {
        return Err(LibraryError::InvalidInput("grouping omitted input assets".into()));
    }
    Ok(result)
}

/// Keep a session id only when identical capture evidence adds previously
/// ungrouped assets; every other membership change creates successor records.
fn plan_grouping(
    prior: &BTreeMap<Uuid, PriorSession>,
    old_session_of: &HashMap<Uuid, Uuid>,
    result: GroupingResult,
) -> GroupPlan {
    let mut plan = GroupPlan::default();
    let mut kept = BTreeSet::new();
    for candidate in result.sessions {
        let members: BTreeSet<Uuid> = candidate.asset_ids.iter().copied().collect();
        let keeper = prior.iter().find(|(id, session)| {
            !kept.contains(*id)
                && session.key == candidate.key
                && !session.members.is_empty()
                && session.members.is_subset(&members)
                && members
                    .difference(&session.members)
                    .all(|asset| !old_session_of.contains_key(asset))
        });
        match keeper {
            Some((id, session)) => {
                let added = members.difference(&session.members).copied().collect();
                kept.insert(*id);
                plan.kept.push((*id, candidate, added));
            }
            None => plan.created.push(candidate),
        }
    }
    plan.superseded = prior.keys().filter(|id| !kept.contains(*id)).copied().collect();
    plan
}

struct GroupContext<'a> {
    prior: &'a BTreeMap<Uuid, PriorSession>,
    old_session_of: &'a HashMap<Uuid, Uuid>,
    assets: &'a [Asset],
}

async fn commit_plan(
    conn: &mut SqliteConnection,
    plan: GroupPlan,
    context: &GroupContext<'_>,
    cause: Cause,
) -> Result<Option<SessionLineage>> {
    for (id, candidate, _) in &plan.kept {
        sqlx::query("UPDATE sessions SET provisional = ?1, date_basis = ?2 WHERE id = ?3")
            .bind(to_json(&candidate.provisional)?)
            .bind(candidate.date_basis.as_deref())
            .bind(id.to_string())
            .execute(&mut *conn)
            .await?;
    }
    let grew = plan.kept.iter().any(|(_, _, added)| !added.is_empty());
    if plan.created.is_empty() && plan.superseded.is_empty() && !grew {
        return Ok(None);
    }
    let created_at = now()?;
    let grouping_revision = next_counter(conn, "grouping_revision").await?;
    let prior_associations = associations_of(conn, &plan.superseded).await?;
    let mut successors = Vec::new();
    let mut moved = BTreeSet::new();
    for candidate in &plan.created {
        let id = Uuid::new_v4();
        let members: BTreeSet<Uuid> = candidate.asset_ids.iter().copied().collect();
        insert_session(conn, id, candidate, grouping_revision, &created_at).await?;
        attach_members(conn, id, &members).await?;
        let mut successor = false;
        for asset in &members {
            if let Some(old) = context.old_session_of.get(asset) {
                successor |= plan.superseded.contains(old);
                if context.prior.get(old).is_some_and(|prior| prior.key != candidate.key) {
                    moved.insert(*asset);
                }
            }
        }
        if successor {
            successors.push(id);
        }
        let inherit = Inheritance { session_id: id, members: &members, prior: &prior_associations };
        for association in inherit.associations(context) {
            upsert_association(conn, &association, &created_at).await?;
        }
    }
    for (id, _, added) in &plan.kept {
        if !added.is_empty() {
            attach_members(conn, *id, added).await?;
            sqlx::query("UPDATE sessions SET grouping_revision = ?1 WHERE id = ?2")
                .bind(db_revision(grouping_revision)?)
                .bind(id.to_string())
                .execute(&mut *conn)
                .await?;
        }
    }
    if plan.superseded.is_empty() {
        return Ok(None);
    }
    let lineage = SessionLineage {
        correction_id: cause.id(),
        predecessors: plan.superseded.iter().copied().collect(),
        successors,
        moved_assets: moved.into_iter().collect(),
        grouping_revision,
    };
    insert_lineage(conn, &lineage, cause, &created_at).await?;
    Ok(Some(lineage))
}

struct Inheritance<'a> {
    session_id: Uuid,
    members: &'a BTreeSet<Uuid>,
    prior: &'a AssociationIndex,
}

impl Inheritance<'_> {
    /// A successor inherits a confirmation only when every asset shared it.
    fn associations(&self, context: &GroupContext<'_>) -> Vec<Association> {
        let basis: BTreeMap<Uuid, ObservationFingerprint> = context
            .assets
            .iter()
            .filter(|asset| self.members.contains(&asset.id))
            .map(|asset| (asset.id, asset.fingerprint.clone()))
            .collect();
        [AssociationKind::Target, AssociationKind::Equipment]
            .into_iter()
            .filter_map(|kind| self.inherited(kind, context.old_session_of, basis.clone()))
            .collect()
    }

    fn inherited(
        &self,
        kind: AssociationKind,
        old_session_of: &HashMap<Uuid, Uuid>,
        observation_basis: BTreeMap<Uuid, ObservationFingerprint>,
    ) -> Option<Association> {
        let mut first: Option<&Association> = None;
        let mut shared = true;
        let mut user_decided = false;
        let mut values = BTreeSet::new();
        for asset in self.members {
            let prior = old_session_of
                .get(asset)
                .and_then(|session| self.prior.get(&(*session, kind_text(kind))));
            match prior {
                Some(association) if association.state == AssociationState::Confirmed => {
                    user_decided = true;
                    values.insert(
                        association
                            .subject_id
                            .map_or_else(|| "none".to_owned(), |id| id.to_string()),
                    );
                    let first = *first.get_or_insert(association);
                    shared &= association.subject_id == first.subject_id;
                }
                // A conflict still waiting for the user's review is carried
                // forward with its values; it never dissolves into a fresh guess.
                Some(association) if pending_inheritance(association) => {
                    user_decided = true;
                    shared = false;
                    for item in &association.evidence {
                        if let EvidenceItem::Conflict { values: pending, .. } = item {
                            values.extend(pending.iter().cloned());
                        }
                    }
                }
                _ => {
                    shared = false;
                    values.insert("unconfirmed".to_owned());
                }
            }
        }
        if !user_decided {
            return None;
        }
        if shared {
            let first = first?;
            return Some(Association {
                session_id: self.session_id,
                observation_basis,
                decision_revision: 0,
                ..first.clone()
            });
        }
        Some(Association {
            session_id: self.session_id,
            kind,
            subject_id: None,
            state: AssociationState::NeedsReview,
            evidence: vec![EvidenceItem::Conflict {
                field: kind_text(kind).to_owned(),
                values: values.into_iter().collect(),
            }],
            provenance: Provenance::Inferred { rule: INHERITANCE_RULE.into() },
            observation_basis,
            decision_revision: 0,
        })
    }
}

const INHERITANCE_RULE: &str = "regroup-confirmation-inheritance";
const ASSESSMENT_CONFLICT_RULE: &str = "assessment-conflict";

/// A regroup conflict between user confirmations, waiting for the user's review.
fn pending_inheritance(association: &Association) -> bool {
    association.state == AssociationState::NeedsReview
        && matches!(&association.provenance, Provenance::Inferred { rule } if rule == INHERITANCE_RULE)
}

/// Rows only an explicit confirmation may replace: user confirmations and the
/// review conflicts they produced. Automatic assessments replace only automatic rows.
fn user_owned(association: &Association) -> bool {
    association.state == AssociationState::Confirmed || pending_inheritance(association)
}

async fn insert_session(
    conn: &mut SqliteConnection,
    id: Uuid,
    candidate: &SessionCandidate,
    grouping_revision: Revision,
    created_at: &str,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO sessions (id, capture_key, grouping_revision, decision_revision, \
         provisional, date_basis, created_at) VALUES (?1, ?2, ?3, 0, ?4, ?5, ?6)",
    )
    .bind(id.to_string())
    .bind(candidate.key.0.as_str())
    .bind(db_revision(grouping_revision)?)
    .bind(to_json(&candidate.provisional)?)
    .bind(candidate.date_basis.as_deref())
    .bind(created_at)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

async fn attach_members(
    conn: &mut SqliteConnection,
    session_id: Uuid,
    members: &BTreeSet<Uuid>,
) -> Result<()> {
    for asset in members {
        sqlx::query("INSERT OR IGNORE INTO session_members (session_id, asset_id) VALUES (?1, ?2)")
            .bind(session_id.to_string())
            .bind(asset.to_string())
            .execute(&mut *conn)
            .await?;
        sqlx::query("UPDATE assets SET session_id = ?1 WHERE id = ?2")
            .bind(session_id.to_string())
            .bind(asset.to_string())
            .execute(&mut *conn)
            .await?;
    }
    Ok(())
}

async fn insert_lineage(
    conn: &mut SqliteConnection,
    lineage: &SessionLineage,
    cause: Cause,
    created_at: &str,
) -> Result<()> {
    let lineage_id: i64 = sqlx::query_scalar(
        "INSERT INTO session_lineage (correction_id, cause, grouping_revision, predecessors, \
         successors, moved_assets, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id",
    )
    .bind(lineage.correction_id.to_string())
    .bind(cause.label())
    .bind(db_revision(lineage.grouping_revision)?)
    .bind(to_json(&lineage.predecessors)?)
    .bind(to_json(&lineage.successors)?)
    .bind(to_json(&lineage.moved_assets)?)
    .bind(created_at)
    .fetch_one(&mut *conn)
    .await?;
    let roles = [("predecessor", &lineage.predecessors), ("successor", &lineage.successors)];
    for (role, ids) in roles {
        for id in ids {
            sqlx::query(
                "INSERT INTO lineage_sessions (lineage_id, session_id, role) VALUES (?1, ?2, ?3)",
            )
            .bind(lineage_id)
            .bind(id.to_string())
            .bind(role)
            .execute(&mut *conn)
            .await?;
        }
    }
    for id in &lineage.predecessors {
        sqlx::query("UPDATE sessions SET superseded_by = ?1 WHERE id = ?2")
            .bind(lineage_id)
            .bind(id.to_string())
            .execute(&mut *conn)
            .await?;
    }
    Ok(())
}

async fn current_session_of(
    conn: &mut SqliteConnection,
    ids: &BTreeSet<Uuid>,
) -> Result<HashMap<Uuid, Uuid>> {
    let rows = sqlx::query(
        "SELECT id, session_id FROM assets WHERE session_id IS NOT NULL \
         AND id IN (SELECT value FROM json_each(?1))",
    )
    .bind(json_ids(ids)?)
    .fetch_all(&mut *conn)
    .await?;
    rows.iter()
        .map(|row| {
            Ok((
                parse_uuid(&row.try_get::<String, _>("id")?)?,
                parse_uuid(&row.try_get::<String, _>("session_id")?)?,
            ))
        })
        .collect()
}

async fn current_sessions_with_key(
    conn: &mut SqliteConnection,
    key: &CaptureKey,
) -> Result<Vec<Uuid>> {
    let ids: Vec<String> = sqlx::query_scalar(
        "SELECT id FROM sessions WHERE capture_key = ?1 AND superseded_by IS NULL",
    )
    .bind(key.0.as_str())
    .fetch_all(&mut *conn)
    .await?;
    ids.iter().map(|id| parse_uuid(id)).collect()
}

async fn current_members(conn: &mut SqliteConnection, session_id: Uuid) -> Result<BTreeSet<Uuid>> {
    let ids: Vec<String> = sqlx::query_scalar("SELECT id FROM assets WHERE session_id = ?1")
        .bind(session_id.to_string())
        .fetch_all(&mut *conn)
        .await?;
    ids.iter().map(|id| parse_uuid(id)).collect()
}

async fn current_member_assets(
    conn: &mut SqliteConnection,
    session_id: Uuid,
) -> Result<Vec<Asset>> {
    let members = current_members(conn, session_id).await?;
    load_assets(conn, &members).await
}

async fn load_session_row(conn: &mut SqliteConnection, id: Uuid) -> Result<SessionRow> {
    let row = sqlx::query(
        "SELECT id, capture_key, grouping_revision, decision_revision, provisional, date_basis, \
         superseded_by FROM sessions WHERE id = ?1",
    )
    .bind(id.to_string())
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| LibraryError::NotFound(format!("session {id}")))?;
    let members: Vec<String> = sqlx::query_scalar(
        "SELECT asset_id FROM session_members WHERE session_id = ?1 ORDER BY asset_id",
    )
    .bind(id.to_string())
    .fetch_all(&mut *conn)
    .await?;
    let mut asset_ids = members.iter().map(|id| parse_uuid(id)).collect::<Result<Vec<_>>>()?;
    asset_ids.sort_unstable();
    Ok(SessionRow {
        session: Session {
            id,
            key: CaptureKey(row.try_get("capture_key")?),
            grouping_revision: revision(row.try_get("grouping_revision")?)?,
            decision_revision: revision(row.try_get("decision_revision")?)?,
            asset_ids,
            provisional: from_json(&row.try_get::<String, _>("provisional")?)?,
            date_basis: row.try_get("date_basis")?,
        },
        superseded_by: row.try_get("superseded_by")?,
    })
}

async fn load_sessions(conn: &mut SqliteConnection, ids: &[Uuid]) -> Result<Vec<Session>> {
    let mut sessions = Vec::with_capacity(ids.len());
    for id in ids {
        sessions.push(load_session_row(conn, *id).await?.session);
    }
    Ok(sessions)
}

async fn lineage_successors(conn: &mut SqliteConnection, lineage_id: i64) -> Result<Vec<Uuid>> {
    let successors: String =
        sqlx::query_scalar("SELECT successors FROM session_lineage WHERE id = ?1")
            .bind(lineage_id)
            .fetch_one(&mut *conn)
            .await?;
    from_json(&successors)
}

async fn session_lineage(
    conn: &mut SqliteConnection,
    session_id: Uuid,
) -> Result<Vec<SessionLineage>> {
    let rows = sqlx::query(
        "SELECT DISTINCT l.id, l.correction_id, l.grouping_revision, l.predecessors, \
         l.successors, l.moved_assets FROM session_lineage l \
         JOIN lineage_sessions ls ON ls.lineage_id = l.id WHERE ls.session_id = ?1 ORDER BY l.id",
    )
    .bind(session_id.to_string())
    .fetch_all(&mut *conn)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(SessionLineage {
                correction_id: parse_uuid(&row.try_get::<String, _>("correction_id")?)?,
                predecessors: from_json(&row.try_get::<String, _>("predecessors")?)?,
                successors: from_json(&row.try_get::<String, _>("successors")?)?,
                moved_assets: from_json(&row.try_get::<String, _>("moved_assets")?)?,
                grouping_revision: revision(row.try_get("grouping_revision")?)?,
            })
        })
        .collect()
}

async fn successors_of(conn: &mut SqliteConnection, row: &SessionRow) -> Result<Vec<Uuid>> {
    match row.superseded_by {
        Some(lineage) => lineage_successors(conn, lineage).await,
        None => Ok(Vec::new()),
    }
}

/// Summaries of these sessions with one D16 view for the whole request.
async fn summarize_rows(
    conn: &mut SqliteConnection,
    rows: Vec<SessionRow>,
) -> Result<Vec<SessionSummary>> {
    let mut members = Vec::with_capacity(rows.len());
    let mut all = Vec::new();
    for row in &rows {
        let ids: BTreeSet<Uuid> = row.session.asset_ids.iter().copied().collect();
        let assets = load_assets(conn, &ids).await?;
        all.extend(assets.iter().cloned());
        members.push(assets);
    }
    let sessions: Vec<Uuid> = rows.iter().map(|row| row.session.id).collect();
    let view = CaptureView::read(conn, &sessions, &all).await?;
    let mut summaries = Vec::with_capacity(rows.len());
    for (row, assets) in rows.into_iter().zip(members) {
        let successors = successors_of(conn, &row).await?;
        summaries.push(view.summary(row, &assets, successors));
    }
    Ok(summaries)
}

/// The worst availability among a session's copies that are not retired; Retired
/// only when every copy is.
fn session_availability(assets: &[Asset]) -> Availability {
    let live: Vec<&Asset> =
        assets.iter().filter(|asset| asset.availability != Availability::Retired).collect();
    if live.is_empty() && !assets.is_empty() {
        return Availability::Retired;
    }
    [
        Availability::Offline,
        Availability::IdentityConflict,
        Availability::Unreadable,
        Availability::Missing,
    ]
    .into_iter()
    .find(|state| live.iter().any(|asset| asset.availability == *state))
    .unwrap_or(Availability::Available)
}

// ---------------------------------------------------------------------------
// Asset rows and corrections
// ---------------------------------------------------------------------------

async fn load_asset(conn: &mut SqliteConnection, id: Uuid) -> Result<Asset> {
    let row = sqlx::query(asset_sql!("WHERE a.id = ?1"))
        .bind(id.to_string())
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| LibraryError::NotFound(format!("asset {id}")))?;
    asset_from_row(&row)
}

async fn load_assets(conn: &mut SqliteConnection, ids: &BTreeSet<Uuid>) -> Result<Vec<Asset>> {
    let rows =
        sqlx::query(asset_sql!("WHERE a.id IN (SELECT value FROM json_each(?1)) ORDER BY a.id"))
            .bind(json_ids(ids)?)
            .fetch_all(&mut *conn)
            .await?;
    if rows.len() != ids.len() {
        return Err(LibraryError::NotFound("one or more assets".into()));
    }
    rows.iter().map(asset_from_row).collect()
}

async fn location_assets(conn: &mut SqliteConnection, location_id: Uuid) -> Result<Vec<Asset>> {
    let rows = sqlx::query(asset_sql!("WHERE a.location_id = ?1 ORDER BY a.path_key"))
        .bind(location_id.to_string())
        .fetch_all(&mut *conn)
        .await?;
    rows.iter().map(asset_from_row).collect()
}

fn asset_from_row(row: &SqliteRow) -> Result<Asset> {
    let stored: Availability = from_text(&row.try_get::<String, _>("availability")?)?;
    let location: Availability = from_text(&row.try_get::<String, _>("location_availability")?)?;
    let lifecycle: LocationLifecycle = from_text(&row.try_get::<String, _>("location_lifecycle")?)?;
    // A retired location's copies read Retired, never Missing; the stored state
    // stays as their last observation.
    let availability = match (lifecycle, location, stored) {
        (LocationLifecycle::Retired, _, _) => Availability::Retired,
        (_, Availability::Available, stored) | (_, _, stored @ Availability::Missing) => stored,
        (_, location, _) => location,
    };
    let quality_basis: Option<String> = row.try_get("quality_basis")?;
    Ok(Asset {
        id: parse_uuid(&row.try_get::<String, _>("id")?)?,
        location_id: parse_uuid(&row.try_get::<String, _>("location_id")?)?,
        relative_path: path_from_key(&row.try_get::<Vec<u8>, _>("path_key")?)?,
        fingerprint: from_json(&row.try_get::<String, _>("fingerprint")?)?,
        observation_revision: revision(row.try_get("observation_revision")?)?,
        decision_revision: revision(row.try_get("decision_revision")?)?,
        format: from_text(&row.try_get::<String, _>("format")?)?,
        availability,
        observed: from_json(&row.try_get::<String, _>("observed")?)?,
        effective: from_json(&row.try_get::<String, _>("effective")?)?,
        quality: from_text(&row.try_get::<String, _>("quality")?)?,
        quality_basis: quality_basis.as_deref().map(from_json).transpose()?,
        verification_pending: row.try_get::<i64, _>("verification_pending")? == 1,
        last_observed_at: row.try_get("last_observed_at")?,
    })
}

/// Compare observations; an expectation without a digest accepts the recorded
/// digest of otherwise identical evidence, but differing digests never match.
fn fingerprint_matches(
    current: &ObservationFingerprint,
    expected: &ObservationFingerprint,
) -> bool {
    if expected.content_sha256.is_none() && current.content_sha256.is_some() {
        let mut enriched = expected.clone();
        enriched.content_sha256.clone_from(&current.content_sha256);
        return current.equivalent(&enriched);
    }
    if current.content_sha256.is_none() && expected.content_sha256.is_some() {
        let mut enriched = current.clone();
        enriched.content_sha256.clone_from(&expected.content_sha256);
        return enriched.equivalent(expected);
    }
    current.equivalent(expected)
}

fn require_unique_assets(expected: &[ExpectedAsset]) -> Result<()> {
    let mut seen = BTreeSet::new();
    if expected.is_empty() || !expected.iter().all(|item| seen.insert(item.asset_id)) {
        return Err(LibraryError::InvalidInput(
            "expected assets must be unique and non-empty".into(),
        ));
    }
    Ok(())
}

async fn check_expected_assets(
    conn: &mut SqliteConnection,
    expected: &[ExpectedAsset],
) -> Result<Vec<Asset>> {
    require_unique_assets(expected)?;
    let mut assets = Vec::with_capacity(expected.len());
    for item in expected {
        let asset = load_asset(conn, item.asset_id).await?;
        if asset.availability == Availability::Retired {
            return Err(scoped(
                LibraryError::InvalidInput(format!(
                    "asset {} is a copy of a retired location and takes no new decision",
                    asset.id
                )),
                asset.relative_path,
                Some(asset.id),
            ));
        }
        if asset.decision_revision != item.decision_revision
            || !fingerprint_matches(&asset.fingerprint, &item.fingerprint)
        {
            return Err(conflict(asset.id, asset.decision_revision));
        }
        assets.push(asset);
    }
    Ok(assets)
}

fn capture_fields() -> Result<BTreeSet<String>> {
    let value = serde_json::to_value(CaptureMetadata::default())?;
    Ok(value
        .as_object()
        .map(|object| object.keys().filter(|key| *key != "raw").cloned().collect())
        .unwrap_or_default())
}

fn validate_correction_request(
    expected: &[ExpectedAsset],
    corrections: &[CorrectionInput],
) -> Result<()> {
    require_unique_assets(expected)?;
    if corrections.is_empty() {
        return Err(LibraryError::InvalidInput("no corrections supplied".into()));
    }
    let fields = capture_fields()?;
    let ids: BTreeSet<Uuid> = expected.iter().map(|item| item.asset_id).collect();
    let mut targets = BTreeSet::new();
    for correction in corrections {
        if !fields.contains(&correction.field) {
            return Err(LibraryError::InvalidInput(format!(
                "{} is not a correctable capture field",
                correction.field
            )));
        }
        if !ids.contains(&correction.asset_id) {
            return Err(LibraryError::InvalidInput(format!(
                "correction for asset {} lacks an expected revision",
                correction.asset_id
            )));
        }
        if !targets.insert((correction.asset_id, correction.field.as_str())) {
            return Err(LibraryError::InvalidInput("duplicate correction field".into()));
        }
    }
    Ok(())
}

fn same_expectations(reviewed: &[ExpectedAsset], supplied: &[ExpectedAsset]) -> bool {
    let index = |items: &[ExpectedAsset]| -> BTreeMap<Uuid, (Revision, ObservationFingerprint)> {
        items
            .iter()
            .map(|item| (item.asset_id, (item.decision_revision, item.fingerprint.clone())))
            .collect()
    };
    let (reviewed, supplied) = (index(reviewed), index(supplied));
    reviewed.len() == supplied.len()
        && reviewed.iter().all(|(id, (revision, fingerprint))| {
            supplied.get(id).is_some_and(|(other, expected)| {
                other == revision && fingerprint_matches(fingerprint, expected)
            })
        })
}

fn apply_corrections(
    observed: &CaptureMetadata,
    corrections: &[(String, serde_json::Value)],
) -> Result<CaptureMetadata> {
    if corrections.is_empty() {
        return Ok(observed.clone());
    }
    let mut value = serde_json::to_value(observed)?;
    let object = value.as_object_mut().ok_or_else(|| {
        LibraryError::PersistenceFailure("capture metadata is not an object".into())
    })?;
    for (field, corrected) in corrections {
        if field == "raw" || !object.contains_key(field) {
            return Err(LibraryError::InvalidInput(format!("{field} is not a correctable field")));
        }
        object.insert(field.clone(), corrected.clone());
    }
    let effective: CaptureMetadata = serde_json::from_value(value)
        .map_err(|error| LibraryError::InvalidInput(format!("correction value type: {error}")))?;
    if effective.exposure_seconds.is_some_and(|seconds| seconds < 0.0) {
        return Err(LibraryError::InvalidInput("exposure cannot be negative".into()));
    }
    Ok(effective)
}

async fn effective_metadata(
    conn: &mut SqliteConnection,
    asset_id: Uuid,
    observed: &CaptureMetadata,
) -> Result<CaptureMetadata> {
    let rows = sqlx::query(
        "SELECT field, value FROM corrections c WHERE c.asset_id = ?1 AND c.id = \
         (SELECT MAX(id) FROM corrections WHERE asset_id = c.asset_id AND field = c.field) \
         ORDER BY field",
    )
    .bind(asset_id.to_string())
    .fetch_all(&mut *conn)
    .await?;
    let corrections = rows
        .iter()
        .map(|row| {
            Ok((
                row.try_get::<String, _>("field")?,
                from_json(&row.try_get::<String, _>("value")?)?,
            ))
        })
        .collect::<Result<Vec<_>>>()?;
    apply_corrections(observed, &corrections)
}

async fn correct_in_txn<G>(
    conn: &mut SqliteConnection,
    expected: &[ExpectedAsset],
    corrections: &[CorrectionInput],
    grouping: &mut G,
    correction_id: Uuid,
) -> Result<CorrectionOutcome>
where
    G: FnMut(&[Asset]) -> GroupingResult,
{
    check_expected_assets(conn, expected).await?;
    let created_at = now()?;
    let mut by_asset: BTreeMap<Uuid, Vec<&CorrectionInput>> = BTreeMap::new();
    for correction in corrections {
        by_asset.entry(correction.asset_id).or_default().push(correction);
    }
    let mut changed = BTreeSet::new();
    for (asset_id, items) in &by_asset {
        let asset = load_asset(conn, *asset_id).await?;
        let decision_revision = asset.decision_revision + 1;
        for item in items {
            sqlx::query(
                "INSERT INTO corrections (correction_id, asset_id, field, value, \
                 decision_revision, observation_basis, created_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            )
            .bind(correction_id.to_string())
            .bind(asset_id.to_string())
            .bind(item.field.as_str())
            .bind(to_json(&item.value)?)
            .bind(db_revision(decision_revision)?)
            .bind(to_json(&asset.fingerprint)?)
            .bind(created_at.as_str())
            .execute(&mut *conn)
            .await?;
        }
        let effective = effective_metadata(conn, *asset_id, &asset.observed).await?;
        sqlx::query("UPDATE assets SET effective = ?1, decision_revision = ?2 WHERE id = ?3")
            .bind(to_json(&effective)?)
            .bind(db_revision(decision_revision)?)
            .bind(asset_id.to_string())
            .execute(&mut *conn)
            .await?;
        if effective != asset.effective {
            changed.insert(*asset_id);
        }
    }
    let lineage = regroup(conn, &changed, grouping, Cause::Correction(correction_id)).await?;
    invalidate_inferences(conn, &changed).await?;
    let ids: BTreeSet<Uuid> = by_asset.keys().copied().collect();
    let assets = load_assets(conn, &ids).await?;
    let current: BTreeSet<Uuid> = current_session_of(conn, &ids).await?.into_values().collect();
    let current: Vec<Uuid> = current.into_iter().collect();
    let sessions = load_sessions(conn, &current).await?;
    let predecessors = match &lineage {
        Some(lineage) => load_sessions(conn, &lineage.predecessors).await?,
        None => Vec::new(),
    };
    Ok(CorrectionOutcome { correction_id, assets, sessions, predecessors, lineage })
}

/// Inferred (non-Confirmed) associations of the current sessions holding changed
/// assets were assessed on other evidence; they are marked `NeedsReview` in the
/// same transaction so coverage never counts them. Their recorded basis stays
/// the historical one they were assessed against until a fresh assessment is
/// recorded. Confirmed and already invalidated associations are left untouched.
async fn invalidate_inferences(
    conn: &mut SqliteConnection,
    changed: &BTreeSet<Uuid>,
) -> Result<()> {
    if changed.is_empty() {
        return Ok(());
    }
    let sessions: BTreeSet<Uuid> = current_session_of(conn, changed).await?.into_values().collect();
    let updated_at = now()?;
    for session in sessions {
        for mut association in load_associations(conn, session).await? {
            if matches!(
                association.state,
                AssociationState::Confirmed | AssociationState::NeedsReview
            ) {
                continue;
            }
            association.state = AssociationState::NeedsReview;
            upsert_association(conn, &association, &updated_at).await?;
        }
    }
    Ok(())
}

async fn load_preview(conn: &mut SqliteConnection, id: Uuid) -> Result<CorrectionPreview> {
    let row = sqlx::query("SELECT * FROM correction_previews WHERE id = ?1")
        .bind(id.to_string())
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| LibraryError::NotFound(format!("correction preview {id}")))?;
    let confirmed: Option<String> = row.try_get("correction_id")?;
    Ok(CorrectionPreview {
        id,
        expected: from_json(&row.try_get::<String, _>("expected")?)?,
        corrections: from_json(&row.try_get::<String, _>("corrections")?)?,
        proposal: from_json(&row.try_get::<String, _>("proposal")?)?,
        confirmed_correction: confirmed.as_deref().map(parse_uuid).transpose()?,
        created_at: row.try_get("created_at")?,
    })
}

async fn decide_quality(
    conn: &mut SqliteConnection,
    asset: &Asset,
    quality: Quality,
    digest: Option<&(String, ObservationFingerprint)>,
    decided_at: &str,
) -> Result<()> {
    let decision_revision = asset.decision_revision + 1;
    let (fingerprint, basis) = if quality == Quality::Unreviewed {
        (asset.fingerprint.clone(), None)
    } else {
        let (sha256, hashed) = digest.ok_or_else(|| {
            LibraryError::NoByteProof("a reviewed decision needs a current content digest".into())
        })?;
        if !fingerprint_matches(&asset.fingerprint, hashed) {
            return Err(conflict(asset.id, asset.decision_revision));
        }
        let root = SourceRoot::new(load_location(conn, asset.location_id).await?)?;
        require_unchanged_contained(
            &root,
            &asset.relative_path.relative_path()?,
            &asset.fingerprint,
        )?;
        let mut bound = asset.fingerprint.clone();
        bound.content_sha256 = Some(sha256.clone());
        (bound.clone(), Some(bound))
    };
    let basis = basis.as_ref().map(to_json).transpose()?;
    sqlx::query(
        "UPDATE assets SET fingerprint = ?1, quality = ?2, quality_basis = ?3, \
         decision_revision = ?4, verification_pending = 0 WHERE id = ?5",
    )
    .bind(to_json(&fingerprint)?)
    .bind(to_text(&quality)?)
    .bind(basis.as_deref())
    .bind(db_revision(decision_revision)?)
    .bind(asset.id.to_string())
    .execute(&mut *conn)
    .await?;
    sqlx::query(
        "INSERT INTO quality_decisions (asset_id, quality, basis, decision_revision, decided_at) \
         VALUES (?1, ?2, ?3, ?4, ?5)",
    )
    .bind(asset.id.to_string())
    .bind(to_text(&quality)?)
    .bind(basis.as_deref())
    .bind(db_revision(decision_revision)?)
    .bind(decided_at)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Targets, equipment and associations helpers
// ---------------------------------------------------------------------------

fn next_revision(
    id: Uuid,
    current: Option<i64>,
    expected: Option<Revision>,
    what: &str,
) -> Result<Revision> {
    match (current.map(revision).transpose()?, expected) {
        (None, None) => Ok(1),
        (None, Some(_)) => Err(LibraryError::NotFound(format!("{what} {id}"))),
        (Some(current), Some(expected)) if current == expected => Ok(current + 1),
        (Some(current), _) => Err(conflict(id, current)),
    }
}

fn validate_target(candidate: &TargetCandidate) -> Result<()> {
    if candidate.designation.trim().is_empty() {
        return Err(LibraryError::InvalidInput("target designation is empty".into()));
    }
    if let Some(coordinates) = &candidate.coordinates {
        let valid = (0.0..360.0).contains(&coordinates.ra_deg)
            && (-90.0..=90.0).contains(&coordinates.dec_deg)
            && !coordinates.frame.trim().is_empty();
        if !valid {
            return Err(LibraryError::InvalidInput("invalid target coordinates".into()));
        }
    }
    let mut keys = BTreeSet::new();
    for alias in &candidate.aliases {
        if alias.normalized.is_empty() || !keys.insert(alias.normalized.as_str()) {
            return Err(LibraryError::InvalidInput(
                "alias keys must be non-empty and unique".into(),
            ));
        }
    }
    Ok(())
}

async fn upsert_target(
    conn: &mut SqliteConnection,
    candidate: &TargetCandidate,
    decision_revision: Revision,
) -> Result<()> {
    let coordinates = candidate.coordinates.as_ref();
    sqlx::query(
        "INSERT INTO targets (id, designation, common_name, object_type, ra_deg, dec_deg, frame, \
         provenance, provider_id, decision_revision, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) ON CONFLICT (id) DO UPDATE SET \
         designation = excluded.designation, common_name = excluded.common_name, \
         object_type = excluded.object_type, ra_deg = excluded.ra_deg, dec_deg = excluded.dec_deg, \
         frame = excluded.frame, provenance = excluded.provenance, \
         provider_id = excluded.provider_id, decision_revision = excluded.decision_revision, \
         updated_at = excluded.updated_at",
    )
    .bind(candidate.id.to_string())
    .bind(candidate.designation.trim())
    .bind(candidate.common_name.as_deref())
    .bind(candidate.object_type.as_str())
    .bind(coordinates.map(|value| value.ra_deg))
    .bind(coordinates.map(|value| value.dec_deg))
    .bind(coordinates.map(|value| value.frame.as_str()))
    .bind(to_json(&candidate.provenance)?)
    .bind(candidate.provider_id.as_deref())
    .bind(db_revision(decision_revision)?)
    .bind(now()?)
    .execute(&mut *conn)
    .await?;
    sqlx::query("DELETE FROM target_aliases WHERE target_id = ?1")
        .bind(candidate.id.to_string())
        .execute(&mut *conn)
        .await?;
    for (position, alias) in (0_i64..).zip(&candidate.aliases) {
        sqlx::query(
            "INSERT INTO target_aliases (target_id, normalized, text, kind, provenance, position) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .bind(candidate.id.to_string())
        .bind(alias.normalized.as_str())
        .bind(alias.text.as_str())
        .bind(alias.kind.as_str())
        .bind(to_json(&alias.provenance)?)
        .bind(position)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

async fn load_target(conn: &mut SqliteConnection, id: Uuid) -> Result<TargetRecord> {
    let row = sqlx::query("SELECT * FROM targets WHERE id = ?1")
        .bind(id.to_string())
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| LibraryError::NotFound(format!("target {id}")))?;
    let aliases = sqlx::query(
        "SELECT text, normalized, kind, provenance FROM target_aliases WHERE target_id = ?1 \
         ORDER BY position",
    )
    .bind(id.to_string())
    .fetch_all(&mut *conn)
    .await?
    .iter()
    .map(|alias| {
        Ok(platevault_model::TargetAlias {
            text: alias.try_get("text")?,
            normalized: alias.try_get("normalized")?,
            kind: alias.try_get("kind")?,
            provenance: from_json(&alias.try_get::<String, _>("provenance")?)?,
        })
    })
    .collect::<Result<Vec<_>>>()?;
    let ra: Option<f64> = row.try_get("ra_deg")?;
    let dec: Option<f64> = row.try_get("dec_deg")?;
    let frame: Option<String> = row.try_get("frame")?;
    let coordinates = match (ra, dec, frame) {
        (Some(ra_deg), Some(dec_deg), Some(frame)) => {
            Some(platevault_model::SkyCoordinates { ra_deg, dec_deg, frame })
        }
        _ => None,
    };
    Ok(TargetRecord {
        candidate: TargetCandidate {
            id,
            designation: row.try_get("designation")?,
            aliases,
            common_name: row.try_get("common_name")?,
            object_type: row.try_get("object_type")?,
            coordinates,
            provenance: from_json(&row.try_get::<String, _>("provenance")?)?,
            provider_id: row.try_get("provider_id")?,
        },
        decision_revision: revision(row.try_get("decision_revision")?)?,
    })
}

async fn targets_in_cone(db: &mut SqliteConnection, cone: &TargetCone) -> Result<BTreeSet<Uuid>> {
    let rows = sqlx::query(
        "SELECT id, ra_deg, dec_deg FROM targets WHERE ra_deg IS NOT NULL \
         AND dec_deg BETWEEN ?1 AND ?2",
    )
    .bind(cone.dec_deg - cone.radius_deg)
    .bind(cone.dec_deg + cone.radius_deg)
    .fetch_all(&mut *db)
    .await?;
    let mut inside = BTreeSet::new();
    for row in &rows {
        let (ra, dec): (f64, f64) = (row.try_get("ra_deg")?, row.try_get("dec_deg")?);
        if within_cone(cone, ra, dec) {
            inside.insert(parse_uuid(&row.try_get::<String, _>("id")?)?);
        }
    }
    Ok(inside)
}

fn within_cone(cone: &TargetCone, ra_deg: f64, dec_deg: f64) -> bool {
    use skymath::{separation, Angle, Equatorial};
    let center =
        Equatorial::j2000(Angle::from_degrees(cone.ra_deg), Angle::from_degrees(cone.dec_deg));
    let point = Equatorial::j2000(Angle::from_degrees(ra_deg), Angle::from_degrees(dec_deg));
    match (center, point) {
        (Ok(center), Ok(point)) => separation(center, point).degrees() <= cone.radius_deg,
        _ => false,
    }
}

fn validate_equipment(equipment: &Equipment) -> Result<()> {
    if equipment.name.trim().is_empty() {
        return Err(LibraryError::InvalidInput("equipment name is empty".into()));
    }
    let positive = |value: Option<f64>| value.is_none_or(|value| value.is_finite() && value > 0.0);
    if !positive(equipment.focal_length_mm) || !positive(equipment.pixel_size_um) {
        return Err(LibraryError::InvalidInput("equipment dimensions must be positive".into()));
    }
    Ok(())
}

async fn upsert_equipment(
    conn: &mut SqliteConnection,
    equipment: &Equipment,
    decision_revision: Revision,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO equipment (id, name, camera, telescope, focal_length_mm, pixel_size_um, \
         state, provenance, decision_revision, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) ON CONFLICT (id) DO UPDATE SET \
         name = excluded.name, camera = excluded.camera, telescope = excluded.telescope, \
         focal_length_mm = excluded.focal_length_mm, pixel_size_um = excluded.pixel_size_um, \
         state = excluded.state, provenance = excluded.provenance, \
         decision_revision = excluded.decision_revision, updated_at = excluded.updated_at",
    )
    .bind(equipment.id.to_string())
    .bind(equipment.name.trim())
    .bind(equipment.camera.as_deref())
    .bind(equipment.telescope.as_deref())
    .bind(equipment.focal_length_mm)
    .bind(equipment.pixel_size_um)
    .bind(to_text(&equipment.state)?)
    .bind(to_json(&equipment.provenance)?)
    .bind(db_revision(decision_revision)?)
    .bind(now()?)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

async fn load_equipment(conn: &mut SqliteConnection, id: Uuid) -> Result<Equipment> {
    let row = sqlx::query("SELECT * FROM equipment WHERE id = ?1")
        .bind(id.to_string())
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| LibraryError::NotFound(format!("equipment {id}")))?;
    Ok(Equipment {
        id,
        name: row.try_get("name")?,
        camera: row.try_get("camera")?,
        telescope: row.try_get("telescope")?,
        focal_length_mm: row.try_get("focal_length_mm")?,
        pixel_size_um: row.try_get("pixel_size_um")?,
        decision_revision: revision(row.try_get("decision_revision")?)?,
        state: from_text(&row.try_get::<String, _>("state")?)?,
        provenance: from_json(&row.try_get::<String, _>("provenance")?)?,
    })
}

const fn kind_text(kind: AssociationKind) -> &'static str {
    match kind {
        AssociationKind::Target => "target",
        AssociationKind::Equipment => "equipment",
    }
}

async fn require_subject(
    conn: &mut SqliteConnection,
    kind: AssociationKind,
    subject: Uuid,
) -> Result<()> {
    match kind {
        AssociationKind::Target => load_target(conn, subject).await.map(drop),
        AssociationKind::Equipment => load_equipment(conn, subject).await.map(drop),
    }
}

async fn check_expected_sessions(
    conn: &mut SqliteConnection,
    expected: &[ExpectedSession],
) -> Result<Vec<Session>> {
    let mut seen = BTreeSet::new();
    if expected.is_empty() || !expected.iter().all(|item| seen.insert(item.session_id)) {
        return Err(LibraryError::InvalidInput(
            "expected sessions must be unique and non-empty".into(),
        ));
    }
    let mut sessions = Vec::with_capacity(expected.len());
    for item in expected {
        let row = load_session_row(conn, item.session_id).await?;
        if let Some(lineage) = row.superseded_by {
            return Err(LibraryError::Conflict {
                id: item.session_id,
                current: row.session.grouping_revision,
                successors: lineage_successors(conn, lineage).await?,
            });
        }
        if row.session.grouping_revision != item.grouping_revision
            || row.session.decision_revision != item.decision_revision
        {
            return Err(conflict(item.session_id, row.session.decision_revision));
        }
        sessions.push(row.session);
    }
    Ok(sessions)
}

async fn member_basis(
    conn: &mut SqliteConnection,
    session_id: Uuid,
) -> Result<BTreeMap<Uuid, ObservationFingerprint>> {
    Ok(current_member_assets(conn, session_id)
        .await?
        .into_iter()
        .map(|asset| (asset.id, asset.fingerprint))
        .collect())
}

async fn confirm_one(
    conn: &mut SqliteConnection,
    session: &Session,
    kind: AssociationKind,
    subject: Uuid,
    updated_at: &str,
) -> Result<Association> {
    let decision_revision = session.decision_revision + 1;
    let evidence = load_association(conn, session.id, kind)
        .await?
        .filter(|prior| prior.subject_id == Some(subject))
        .map(|prior| prior.evidence)
        .unwrap_or_default();
    let association = Association {
        session_id: session.id,
        kind,
        subject_id: Some(subject),
        state: AssociationState::Confirmed,
        evidence,
        provenance: Provenance::User,
        observation_basis: member_basis(conn, session.id).await?,
        decision_revision,
    };
    upsert_association(conn, &association, updated_at).await?;
    sqlx::query("UPDATE sessions SET decision_revision = ?1 WHERE id = ?2")
        .bind(db_revision(decision_revision)?)
        .bind(session.id.to_string())
        .execute(&mut *conn)
        .await?;
    Ok(association)
}

/// The suggestion names exactly the current members with their current
/// observation, observation sequence and decision revision.
fn assessed_current(item: &SuggestedAssociation, members: &[Asset]) -> bool {
    let count = members.len();
    count == item.expected_observations.len()
        && count == item.expected_decisions.len()
        && count == item.expected_observation_revisions.len()
        && members.iter().all(|asset| {
            item.expected_observations
                .get(&asset.id)
                .is_some_and(|expected| fingerprint_matches(&asset.fingerprint, expected))
                && item.expected_decisions.get(&asset.id) == Some(&asset.decision_revision)
                && item.expected_observation_revisions.get(&asset.id)
                    == Some(&asset.observation_revision)
        })
}

async fn record_suggestion(
    conn: &mut SqliteConnection,
    item: &SuggestedAssociation,
    updated_at: &str,
) -> Result<Association> {
    let row = load_session_row(conn, item.session_id).await?;
    if let Some(lineage) = row.superseded_by {
        return Err(LibraryError::Conflict {
            id: item.session_id,
            current: row.session.grouping_revision,
            successors: lineage_successors(conn, lineage).await?,
        });
    }
    if row.session.grouping_revision != item.grouping_revision {
        return Err(conflict(item.session_id, row.session.grouping_revision));
    }
    let members = current_member_assets(conn, item.session_id).await?;
    if !assessed_current(item, &members) {
        return Err(conflict(item.session_id, row.session.grouping_revision));
    }
    let basis: BTreeMap<Uuid, ObservationFingerprint> =
        members.into_iter().map(|asset| (asset.id, asset.fingerprint)).collect();
    if let Some(subject) = item.subject_id {
        require_subject(conn, item.kind, subject).await?;
    }
    if let Some(existing) = load_association(conn, item.session_id, item.kind).await? {
        if user_owned(&existing) {
            return Ok(existing);
        }
    }
    let association = Association {
        session_id: item.session_id,
        kind: item.kind,
        subject_id: item.subject_id,
        state: item.state.clone(),
        evidence: item.evidence.clone(),
        provenance: item.provenance.clone(),
        observation_basis: basis,
        decision_revision: row.session.decision_revision,
    };
    upsert_association(conn, &association, updated_at).await?;
    Ok(association)
}

async fn upsert_association(
    conn: &mut SqliteConnection,
    association: &Association,
    updated_at: &str,
) -> Result<()> {
    let subject = association.subject_id.map(|id| id.to_string());
    let (target, equipment) = match association.kind {
        AssociationKind::Target => (subject, None),
        AssociationKind::Equipment => (None, subject),
    };
    sqlx::query(
        "INSERT INTO associations (session_id, kind, target_id, equipment_id, state, evidence, \
         provenance, observation_basis, decision_revision, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) ON CONFLICT (session_id, kind) DO UPDATE \
         SET target_id = excluded.target_id, equipment_id = excluded.equipment_id, \
         state = excluded.state, evidence = excluded.evidence, provenance = excluded.provenance, \
         observation_basis = excluded.observation_basis, \
         decision_revision = excluded.decision_revision, updated_at = excluded.updated_at",
    )
    .bind(association.session_id.to_string())
    .bind(kind_text(association.kind))
    .bind(target)
    .bind(equipment)
    .bind(to_text(&association.state)?)
    .bind(to_json(&association.evidence)?)
    .bind(to_json(&association.provenance)?)
    .bind(to_json(&association.observation_basis)?)
    .bind(db_revision(association.decision_revision)?)
    .bind(updated_at)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

fn association_from_row(row: &SqliteRow) -> Result<Association> {
    let kind: AssociationKind = from_text(&row.try_get::<String, _>("kind")?)?;
    let subject: Option<String> = match kind {
        AssociationKind::Target => row.try_get("target_id")?,
        AssociationKind::Equipment => row.try_get("equipment_id")?,
    };
    Ok(Association {
        session_id: parse_uuid(&row.try_get::<String, _>("session_id")?)?,
        kind,
        subject_id: subject.as_deref().map(parse_uuid).transpose()?,
        state: from_text(&row.try_get::<String, _>("state")?)?,
        evidence: from_json(&row.try_get::<String, _>("evidence")?)?,
        provenance: from_json(&row.try_get::<String, _>("provenance")?)?,
        observation_basis: from_json(&row.try_get::<String, _>("observation_basis")?)?,
        decision_revision: revision(row.try_get("decision_revision")?)?,
    })
}

async fn load_association(
    conn: &mut SqliteConnection,
    session_id: Uuid,
    kind: AssociationKind,
) -> Result<Option<Association>> {
    sqlx::query("SELECT * FROM associations WHERE session_id = ?1 AND kind = ?2")
        .bind(session_id.to_string())
        .bind(kind_text(kind))
        .fetch_optional(&mut *conn)
        .await?
        .as_ref()
        .map(association_from_row)
        .transpose()
}

async fn load_associations(
    conn: &mut SqliteConnection,
    session_id: Uuid,
) -> Result<Vec<Association>> {
    let rows = sqlx::query("SELECT * FROM associations WHERE session_id = ?1 ORDER BY kind")
        .bind(session_id.to_string())
        .fetch_all(&mut *conn)
        .await?;
    rows.iter().map(association_from_row).collect()
}

async fn associations_of(
    conn: &mut SqliteConnection,
    sessions: &BTreeSet<Uuid>,
) -> Result<AssociationIndex> {
    let mut index = HashMap::new();
    for session in sessions {
        for association in load_associations(conn, *session).await? {
            index.insert((*session, kind_text(association.kind)), association);
        }
    }
    Ok(index)
}

// ---------------------------------------------------------------------------
// Coverage helpers
// ---------------------------------------------------------------------------

fn counts_toward_coverage(state: &AssociationState, evidence: &[EvidenceItem]) -> bool {
    match state {
        AssociationState::Confirmed => true,
        AssociationState::Suggested => {
            let alias = evidence
                .iter()
                .any(|item| matches!(item, EvidenceItem::Alias { agrees: true, .. }));
            let geometry = evidence.iter().any(|item| {
                matches!(
                    item,
                    EvidenceItem::Coordinates { qualified: true, .. }
                        | EvidenceItem::Footprint { qualified: true, .. }
                )
            });
            let conflicting =
                evidence.iter().any(|item| matches!(item, EvidenceItem::Conflict { .. }));
            alias && geometry && !conflicting
        }
        AssociationState::Unresolved | AssociationState::NeedsReview => false,
    }
}

/// Light status from the effective frame type; `None` when unknown.
fn is_light(metadata: &CaptureMetadata) -> Option<bool> {
    let image_type = metadata.image_type.as_deref()?.trim().trim_matches('\'').trim();
    if image_type.is_empty() {
        return None;
    }
    Some(image_type.to_ascii_lowercase().contains("light"))
}

/// D16 state of one read request: logical captures of its assets, their
/// duplicate candidates and the provisional state of their locations, each read
/// with one indexed query (location state once per location).
struct CaptureView {
    /// Asset id → capture key: the capture's smallest asset id.
    key_of: HashMap<Uuid, String>,
    /// Capture key → every recorded copy, including Missing ones.
    copies: HashMap<String, Vec<Asset>>,
    candidates: BTreeSet<Uuid>,
    provisional: HashMap<Uuid, bool>,
}

impl CaptureView {
    async fn read(
        conn: &mut SqliteConnection,
        sessions: &[Uuid],
        assets: &[Asset],
    ) -> Result<Self> {
        let candidates = candidates_in_sessions(conn, sessions).await?;
        let (key_of, copies) = logical_captures(conn, assets).await?;
        // A retired location is never scanned again, so it keeps no scope provisional.
        let locations: BTreeMap<Uuid, bool> = assets
            .iter()
            .map(|asset| (asset.location_id, asset.availability == Availability::Retired))
            .collect();
        let mut provisional = HashMap::with_capacity(locations.len());
        for (id, retired) in locations {
            provisional.insert(id, !retired && location_provisional(conn, id).await?);
        }
        Ok(Self { key_of, copies, candidates, provisional })
    }

    fn key<'a>(&'a self, asset: &'a Asset) -> &'a str {
        self.key_of.get(&asset.id).map_or("", String::as_str)
    }

    fn location_provisional(&self, id: Uuid) -> bool {
        self.provisional.get(&id).copied().unwrap_or(true)
    }

    /// These assets grouped by logical capture.
    fn group<'a>(&self, assets: &'a [Asset]) -> BTreeMap<String, Vec<&'a Asset>> {
        let mut groups: BTreeMap<String, Vec<&Asset>> = BTreeMap::new();
        for asset in assets {
            groups.entry(self.key(asset).to_owned()).or_default().push(asset);
        }
        groups
    }

    fn copies_of(&self, key: &str) -> Vec<&Asset> {
        self.copies.get(key).map(|copies| copies.iter().collect()).unwrap_or_default()
    }

    fn quality(&self, key: &str) -> ApplicableQuality {
        capture_quality(&self.copies_of(key))
    }

    fn members(&self, assets: &[Asset]) -> Vec<SessionMember> {
        self.group(assets)
            .into_iter()
            .map(|(key, present)| {
                let copies = self.copies_of(&key);
                let digests = digests_of(&copies);
                SessionMember {
                    copies: copies.iter().map(|copy| copy.id).collect(),
                    content_sha256: (digests.len() == 1)
                        .then(|| digests.first().map(|digest| (*digest).to_owned()))
                        .flatten(),
                    applicable_quality: capture_quality(&copies),
                    duplicate_candidate: present
                        .iter()
                        .any(|asset| self.candidates.contains(&asset.id)),
                }
            })
            .collect()
    }

    fn summary(&self, row: SessionRow, assets: &[Asset], successors: Vec<Uuid>) -> SessionSummary {
        let location_ids: BTreeSet<Uuid> = assets.iter().map(|asset| asset.location_id).collect();
        let provisional = location_ids.iter().any(|id| self.location_provisional(*id))
            || assets.iter().any(|asset| self.candidates.contains(&asset.id));
        let captures: BTreeSet<&str> = assets
            .iter()
            .filter(|asset| asset.availability != Availability::Retired)
            .map(|asset| self.key(asset))
            .collect();
        SessionSummary {
            asset_count: u64::try_from(assets.len()).unwrap_or(u64::MAX),
            capture_count: u64::try_from(captures.len()).unwrap_or(u64::MAX),
            availability: session_availability(assets),
            last_observed_at: assets.iter().map(|asset| asset.last_observed_at.clone()).max(),
            provisional,
            successors,
            location_ids: location_ids.into_iter().collect(),
            session: row.session,
        }
    }
}

fn digests_of<'a>(copies: &[&'a Asset]) -> Vec<&'a str> {
    let digests: BTreeSet<&str> =
        copies.iter().filter_map(|copy| copy.fingerprint.content_sha256.as_deref()).collect();
    digests.into_iter().collect()
}

/// Applicable quality of one logical capture (D16). Copies whose SHA-256 differ
/// are conflicting copies: neither substitutes for the other. A decision speaks for
/// the capture only once every readable copy carries the proven digest.
fn capture_quality(copies: &[&Asset]) -> ApplicableQuality {
    if digests_of(copies).len() > 1 {
        return ApplicableQuality::ConflictingCopies;
    }
    let unproven = copies.len() > 1
        && copies.iter().any(|copy| {
            copy.fingerprint.content_sha256.is_none() && copy.availability != Availability::Missing
        });
    match logical_quality(copies) {
        ApplicableQuality::Usable if unproven => {
            ApplicableQuality::VerificationPending { previous: Quality::Usable }
        }
        ApplicableQuality::Unusable if unproven => {
            ApplicableQuality::VerificationPending { previous: Quality::Unusable }
        }
        quality => quality,
    }
}

/// Every recorded copy, Missing included, of the given digests in Active
/// locations: a retired copy is never joined to another (no decision transfers).
const COPIES_BY_DIGEST: &str = asset_sql!(
    "WHERE a.content_sha256 IN (SELECT value FROM json_each(?1)) \
     AND a.session_id IS NOT NULL AND l.lifecycle = 'active' ORDER BY a.location_id, a.id"
);

const ASSETS_BY_IDS: &str = asset_sql!("WHERE a.id IN (SELECT value FROM json_each(?1))");

/// Recorded copy links touching any of the given assets, between copies of
/// Active locations only.
const LINKS_OF_ASSETS: &str = "SELECT k.left_id, k.right_id FROM copy_links k \
     WHERE k.left_id IN (SELECT value FROM json_each(?1)) AND NOT EXISTS (SELECT 1 \
     FROM assets r JOIN locations l ON l.id = r.location_id \
     WHERE r.id IN (k.left_id, k.right_id) AND l.lifecycle = 'retired') \
     UNION SELECT k.left_id, k.right_id FROM copy_links k \
     WHERE k.right_id IN (SELECT value FROM json_each(?1)) AND NOT EXISTS (SELECT 1 \
     FROM assets r JOIN locations l ON l.id = r.location_id \
     WHERE r.id IN (k.left_id, k.right_id) AND l.lifecycle = 'retired')";

/// Assets of the request's sessions with a duplicate candidate: an asset in the
/// same session (equal capture key) in another location with equal size and an
/// equal, known capture start that has a time of day, where either side has no
/// content digest and both can still be read. Unknown or date-only starts never
/// match. Copies of retired locations are never candidates.
const CANDIDATES_IN_SESSIONS: &str = "SELECT DISTINCT a.id FROM assets a CROSS JOIN assets b \
     ON b.session_id = a.session_id AND b.size_bytes = a.size_bytes \
     AND b.capture_start = a.capture_start \
     AND b.location_id IN (SELECT l.id FROM locations l WHERE l.id <> a.location_id \
     AND l.lifecycle = 'active') \
     WHERE a.session_id IN (SELECT value FROM json_each(?1)) \
     AND a.location_id IN (SELECT l.id FROM locations l WHERE l.lifecycle = 'active') \
     AND instr(a.capture_start, ':') > 0 \
     AND a.availability <> 'missing' AND b.availability <> 'missing' \
     AND (a.content_sha256 IS NULL OR b.content_sha256 IS NULL)";

/// The same matches driven from one location's assets, hashed or not, with each
/// partner's location; `candidate` marks the duplicate-candidate pairs. Partners
/// in retired locations never match.
const MATCHES_OF_LOCATION: &str = "SELECT a.id AS id, b.id AS partner, \
     b.location_id AS partner_location, \
     (a.content_sha256 IS NULL OR b.content_sha256 IS NULL) AS candidate \
     FROM assets a CROSS JOIN assets b ON b.session_id = a.session_id \
     AND b.size_bytes = a.size_bytes AND b.capture_start = a.capture_start \
     AND b.location_id IN (SELECT l.id FROM locations l WHERE l.id <> a.location_id \
     AND l.lifecycle = 'active') \
     WHERE a.location_id = ?1 AND a.session_id IS NOT NULL \
     AND instr(a.capture_start, ':') > 0 \
     AND a.availability <> 'missing' AND b.availability <> 'missing'";

const PENDING_IN_LOCATION: &str =
    "SELECT EXISTS (SELECT 1 FROM assets WHERE location_id = ?1 AND verification_pending = 1)";

/// A hashed asset that is a copy of a logical capture: its digest is recorded in
/// another Active location, or a recorded link joins it to a copy there.
const IS_ALIASED_COPY: &str = "SELECT EXISTS (SELECT 1 FROM assets d \
     JOIN locations l ON l.id = d.location_id \
     WHERE d.content_sha256 = ?1 AND d.location_id <> ?2 AND l.lifecycle = 'active') \
     OR EXISTS (SELECT 1 FROM copy_links k JOIN assets r ON r.id = k.right_id \
     JOIN locations l ON l.id = r.location_id WHERE k.left_id = ?3 AND l.lifecycle = 'active') \
     OR EXISTS (SELECT 1 FROM copy_links k JOIN assets r ON r.id = k.left_id \
     JOIN locations l ON l.id = r.location_id WHERE k.right_id = ?3 AND l.lifecycle = 'active')";

/// Record that an asset whose digest is about to change was byte-identical to its
/// copies in other Active locations, so the pair stays one capture once they diverge.
const LINK_IDENTICAL_COPIES: &str = "INSERT OR IGNORE INTO copy_links (left_id, right_id, cause) \
     SELECT min(?1, d.id), max(?1, d.id), 'identical' FROM assets d \
     JOIN locations l ON l.id = d.location_id \
     WHERE d.content_sha256 = ?2 AND d.location_id <> ?3 AND l.lifecycle = 'active'";

fn find_root(parent: &HashMap<Uuid, Uuid>, id: Uuid) -> Uuid {
    let mut root = id;
    while let Some(&next) = parent.get(&root) {
        root = next;
    }
    root
}

fn join_copies(parent: &mut HashMap<Uuid, Uuid>, left: Uuid, right: Uuid) {
    let (left, right) = (find_root(parent, left), find_root(parent, right));
    if left != right {
        parent.insert(left.max(right), left.min(right));
    }
}

/// Group assets into logical captures (D16). Copies are joined only when their
/// digest is recorded in at least two registered locations (Missing copies
/// included) or a recorded link proves the pair: once byte-identical, or an
/// unambiguous duplicate-candidate pair. A size/start match alone never joins. Any
/// other asset, and every copy of a retired location, is its own capture. Linked
/// copies and their digest copies are followed until the capture is closed, so
/// every entry point sees the same copies.
async fn logical_captures(
    conn: &mut SqliteConnection,
    assets: &[Asset],
) -> Result<(HashMap<Uuid, String>, HashMap<String, Vec<Asset>>)> {
    count_read("logical_captures");
    let mut nodes: HashMap<Uuid, Asset> = HashMap::new();
    let mut parent = HashMap::new();
    let mut fresh: Vec<Asset> = assets.to_vec();
    let mut seen_digests: BTreeSet<String> = BTreeSet::new();
    while !fresh.is_empty() {
        let mut digests = BTreeSet::new();
        let mut ids = BTreeSet::new();
        for asset in fresh.drain(..) {
            if nodes.contains_key(&asset.id) {
                continue;
            }
            if asset.availability == Availability::Retired {
                nodes.insert(asset.id, asset);
                continue;
            }
            if let Some(digest) = &asset.fingerprint.content_sha256 {
                if seen_digests.insert(digest.clone()) {
                    digests.insert(digest.clone());
                }
            }
            ids.insert(asset.id);
            nodes.insert(asset.id, asset);
        }
        let mut found = copies_by_digest(conn, &digests, &mut parent).await?;
        found.extend(linked_copies(conn, &ids, &nodes, &mut parent).await?);
        fresh = found.into_iter().filter(|copy| !nodes.contains_key(&copy.id)).collect();
    }
    let mut components: HashMap<Uuid, Vec<Asset>> = HashMap::new();
    for (id, asset) in nodes {
        components.entry(find_root(&parent, id)).or_default().push(asset);
    }
    let mut key_of = HashMap::with_capacity(assets.len());
    let mut copies = HashMap::new();
    for asset in assets {
        let root = find_root(&parent, asset.id);
        let key = root.to_string();
        if !copies.contains_key(&key) {
            let mut group = components.get(&root).cloned().unwrap_or_default();
            group.sort_by_key(|copy| (copy.location_id, copy.id));
            copies.insert(key.clone(), group);
        }
        key_of.insert(asset.id, key);
    }
    Ok((key_of, copies))
}

/// Every copy of these digests that spans two or more locations, joined.
async fn copies_by_digest(
    conn: &mut SqliteConnection,
    digests: &BTreeSet<String>,
    parent: &mut HashMap<Uuid, Uuid>,
) -> Result<Vec<Asset>> {
    let mut found = Vec::new();
    if digests.is_empty() {
        return Ok(found);
    }
    let rows = sqlx::query(COPIES_BY_DIGEST).bind(to_json(digests)?).fetch_all(&mut *conn).await?;
    let mut by_digest: BTreeMap<String, Vec<Asset>> = BTreeMap::new();
    for row in &rows {
        let copy = asset_from_row(row)?;
        if let Some(digest) = copy.fingerprint.content_sha256.clone() {
            by_digest.entry(digest).or_default().push(copy);
        }
    }
    for group in by_digest.into_values() {
        if group.iter().map(|copy| copy.location_id).collect::<BTreeSet<_>>().len() > 1 {
            for pair in group.windows(2) {
                join_copies(parent, pair[0].id, pair[1].id);
            }
            found.extend(group);
        }
    }
    Ok(found)
}

/// The copies recorded links join to these assets, joined; returns those not yet seen.
async fn linked_copies(
    conn: &mut SqliteConnection,
    ids: &BTreeSet<Uuid>,
    nodes: &HashMap<Uuid, Asset>,
    parent: &mut HashMap<Uuid, Uuid>,
) -> Result<Vec<Asset>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let rows = sqlx::query(LINKS_OF_ASSETS).bind(json_ids(ids)?).fetch_all(&mut *conn).await?;
    let mut linked = BTreeSet::new();
    for row in &rows {
        let left = parse_uuid(&row.try_get::<String, _>("left_id")?)?;
        let right = parse_uuid(&row.try_get::<String, _>("right_id")?)?;
        join_copies(parent, left, right);
        linked.extend([left, right].into_iter().filter(|id| !nodes.contains_key(id)));
    }
    if linked.is_empty() {
        return Ok(Vec::new());
    }
    let rows = sqlx::query(ASSETS_BY_IDS).bind(json_ids(&linked)?).fetch_all(&mut *conn).await?;
    rows.iter().map(asset_from_row).collect()
}

/// Assets of these sessions with a duplicate candidate, in one query.
async fn candidates_in_sessions(
    conn: &mut SqliteConnection,
    sessions: &[Uuid],
) -> Result<BTreeSet<Uuid>> {
    if sessions.is_empty() {
        return Ok(BTreeSet::new());
    }
    count_read("candidates");
    let ids: Vec<String> = sqlx::query_scalar(CANDIDATES_IN_SESSIONS)
        .bind(json_ids(&sessions.iter().copied().collect())?)
        .fetch_all(&mut *conn)
        .await?;
    ids.iter().map(|id| parse_uuid(id)).collect()
}

/// One known-start match between an asset of the scanned location and a copy in
/// another location.
struct CopyMatch {
    id: Uuid,
    partner: Uuid,
    partner_location: Uuid,
    candidate: bool,
}

async fn matches_of_location(
    conn: &mut SqliteConnection,
    location: Uuid,
) -> Result<Vec<CopyMatch>> {
    let rows =
        sqlx::query(MATCHES_OF_LOCATION).bind(location.to_string()).fetch_all(&mut *conn).await?;
    rows.iter()
        .map(|row| {
            Ok(CopyMatch {
                id: parse_uuid(&row.try_get::<String, _>("id")?)?,
                partner: parse_uuid(&row.try_get::<String, _>("partner")?)?,
                partner_location: parse_uuid(&row.try_get::<String, _>("partner_location")?)?,
                candidate: row.try_get("candidate")?,
            })
        })
        .collect()
}

/// Candidate pairs where each side has exactly one match in the other's location;
/// several same-size frames with one start time are ambiguous and never paired.
fn unambiguous_candidates(matches: &[CopyMatch], location: Uuid) -> Vec<(Uuid, Uuid)> {
    let mut ours: HashMap<(Uuid, Uuid), usize> = HashMap::new();
    let mut theirs: HashMap<Uuid, usize> = HashMap::new();
    for found in matches {
        *ours.entry((found.id, found.partner_location)).or_default() += 1;
        *theirs.entry(found.partner).or_default() += 1;
    }
    matches
        .iter()
        .filter(|found| {
            found.candidate
                && found.partner_location != location
                && ours[&(found.id, found.partner_location)] == 1
                && theirs[&found.partner] == 1
        })
        .map(|found| (found.id.min(found.partner), found.id.max(found.partner)))
        .collect()
}

async fn record_copy_link(
    conn: &mut SqliteConnection,
    left: Uuid,
    right: Uuid,
    cause: &str,
) -> Result<()> {
    let (left, right) = (left.min(right), left.max(right));
    sqlx::query("INSERT OR IGNORE INTO copy_links (left_id, right_id, cause) VALUES (?1, ?2, ?3)")
        .bind(left.to_string())
        .bind(right.to_string())
        .bind(cause)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// A copy of a logical capture (D19): readable rescans rehash it even when its
/// stats match, because its bytes decide what the capture counts as.
async fn aliased_copy(conn: &mut SqliteConnection, asset: &Asset) -> Result<bool> {
    let Some(digest) = asset.fingerprint.content_sha256.as_deref() else {
        return Ok(false);
    };
    Ok(sqlx::query_scalar(IS_ALIASED_COPY)
        .bind(digest)
        .bind(asset.location_id.to_string())
        .bind(asset.id.to_string())
        .fetch_one(&mut *conn)
        .await?)
}

async fn record_progress(
    conn: &mut SqliteConnection,
    operation_id: Uuid,
    progress: &ScanProgress,
) -> Result<()> {
    sqlx::query("UPDATE scan_operations SET progress = ?1, revision = revision + 1 WHERE id = ?2")
        .bind(to_json(progress)?)
        .bind(operation_id.to_string())
        .execute(&mut *conn)
        .await?;
    Ok(())
}

#[cfg(test)]
thread_local! {
    static READS: std::cell::RefCell<HashMap<&'static str, usize>> =
        std::cell::RefCell::new(HashMap::new());
}

/// Test-only count of the D16 and provisional reads issued on this thread.
#[cfg(test)]
fn count_read(name: &'static str) {
    READS.with(|reads| *reads.borrow_mut().entry(name).or_default() += 1);
}

#[cfg(not(test))]
const fn count_read(_name: &'static str) {}

fn contributions_for(
    session_id: Uuid,
    date_basis: Option<&String>,
    entries: &[(Asset, ApplicableQuality)],
    candidates: &BTreeSet<Uuid>,
) -> Vec<CoverageContribution> {
    let mut groups: BTreeMap<(Uuid, String, Option<String>), CoverageContribution> =
        BTreeMap::new();
    for (asset, quality) in entries {
        let quality = *quality;
        let light = is_light(&asset.effective);
        if light == Some(false) {
            continue;
        }
        let channel = asset.effective.filter.clone();
        let availability = format!("{:?}", asset.availability);
        let entry = groups
            .entry((asset.location_id, availability, channel.clone()))
            .or_insert_with(|| CoverageContribution {
                session_id,
                location_id: asset.location_id,
                date_basis: date_basis.cloned(),
                channel,
                captured_seconds: 0.0,
                usable_seconds: 0.0,
                unreviewed_seconds: 0.0,
                unknown_exposure_count: 0,
                drifted_decisions: 0,
                verification_pending: 0,
                duplicate_candidates: 0,
                conflicting_decisions: 0,
                conflicting_copies: 0,
                availability: asset.availability,
                last_observed_at: asset.last_observed_at.clone(),
            });
        if asset.last_observed_at > entry.last_observed_at {
            entry.last_observed_at.clone_from(&asset.last_observed_at);
        }
        match quality {
            ApplicableQuality::ChangedContent { .. } => entry.drifted_decisions += 1,
            ApplicableQuality::VerificationPending { .. } => entry.verification_pending += 1,
            ApplicableQuality::Conflicting => entry.conflicting_decisions += 1,
            ApplicableQuality::ConflictingCopies => entry.conflicting_copies += 1,
            _ => {}
        }
        if candidates.contains(&asset.id) {
            entry.duplicate_candidates += 1;
        }
        match (light, asset.effective.exposure_seconds) {
            (Some(true), Some(exposure)) => {
                entry.captured_seconds += exposure;
                match quality {
                    ApplicableQuality::Usable => entry.usable_seconds += exposure,
                    ApplicableQuality::Unreviewed => entry.unreviewed_seconds += exposure,
                    ApplicableQuality::Unusable
                    | ApplicableQuality::ChangedContent { .. }
                    | ApplicableQuality::VerificationPending { .. }
                    | ApplicableQuality::Conflicting
                    | ApplicableQuality::ConflictingCopies => {}
                }
            }
            _ => entry.unknown_exposure_count += 1,
        }
    }
    groups.into_values().collect()
}

// ---------------------------------------------------------------------------
// Remap helpers
// ---------------------------------------------------------------------------

fn block(asset_id: Uuid, reason: RemapBlockReason, message: String) -> RemapBlock {
    RemapBlock { asset_id: Some(asset_id), reason, message }
}

/// Registered original root and the proposed candidate root of a remap.
struct RemapRoots {
    original: SourceRoot,
    candidate: SourceRoot,
}

impl RemapRoots {
    fn new(
        location: &Location,
        proposed_root: &NativePath,
        proposed_identity: &FileIdentity,
    ) -> Result<Self> {
        let candidate = Location {
            path: proposed_root.clone(),
            identity: proposed_identity.clone(),
            ..location.clone()
        };
        Ok(Self {
            original: SourceRoot::new(location.clone())?,
            candidate: SourceRoot::new(candidate)?,
        })
    }
}

fn root_block(error: &LibraryError) -> RemapBlock {
    RemapBlock {
        asset_id: None,
        reason: RemapBlockReason::IdentityConflict,
        message: error.to_string(),
    }
}

fn assess_remap<P: SourceProbe>(
    roots: &RemapRoots,
    assets: &[Asset],
    probe: &P,
) -> (Vec<RemapItem>, Vec<RemapBlock>) {
    if let Err(error) = roots.candidate.verify(probe) {
        return (Vec::new(), vec![root_block(&error)]);
    }
    let online = roots.original.verify(probe).is_ok();
    let mut items = Vec::new();
    let mut blocked = Vec::new();
    for asset in assets {
        match assess_asset(roots, online, asset, probe) {
            Ok(item) => items.push(item),
            Err(refusal) => blocked.push(refusal),
        }
    }
    if let Err(error) = roots.candidate.verify(probe) {
        blocked.push(root_block(&error));
    }
    (items, blocked)
}

fn assess_asset<P: SourceProbe>(
    roots: &RemapRoots,
    online: bool,
    asset: &Asset,
    probe: &P,
) -> Result<RemapItem, RemapBlock> {
    let relative = asset
        .relative_path
        .relative_path()
        .map_err(|error| block(asset.id, RemapBlockReason::IdentityConflict, error.to_string()))?;
    let original_digest = original_digest(&roots.original, online, &relative, asset, probe)?;
    let candidate = &roots.candidate;
    let mismatch = |message: String| block(asset.id, RemapBlockReason::Mismatch, message);
    let mut candidate_fingerprint = probe
        .fingerprint(&candidate.path.join(&relative))
        .map_err(|error| mismatch(format!("candidate unavailable: {error}")))?;
    if !same_volume(&candidate_fingerprint.identity.volume, &candidate.location.identity.volume) {
        return Err(block(
            asset.id,
            RemapBlockReason::IdentityConflict,
            "candidate is not on the proposed volume".into(),
        ));
    }
    let candidate_sha256 = hash_contained(
        candidate,
        &relative,
        candidate_fingerprint.size_bytes,
        candidate_fingerprint.modified_ns,
    )
    .map_err(|error| mismatch(format!("candidate could not be hashed: {error}")))?;
    if candidate_sha256 != original_digest.sha256 {
        return Err(mismatch("candidate bytes differ from the original".into()));
    }
    candidate_fingerprint.content_sha256 = Some(candidate_sha256.clone());
    Ok(RemapItem {
        asset_id: asset.id,
        original_digest,
        candidate_path: asset.relative_path.clone(),
        candidate_fingerprint,
        candidate_sha256,
    })
}

/// Rehash a readable original; an unavailable one needs a fingerprint-bound digest.
fn original_digest<P: SourceProbe>(
    root: &SourceRoot,
    online: bool,
    relative: &Path,
    asset: &Asset,
    probe: &P,
) -> Result<DigestEvidence, RemapBlock> {
    if !online || probe.fingerprint(&root.path.join(relative)).is_err() {
        return asset
            .fingerprint
            .content_sha256
            .clone()
            .map(|sha256| DigestEvidence { sha256, fingerprint: asset.fingerprint.clone() })
            .ok_or_else(|| {
                block(
                    asset.id,
                    RemapBlockReason::NoByteProof,
                    "original is unavailable and has no fingerprint-bound digest".into(),
                )
            });
    }
    let sha256 = current_digest(root, relative, &asset.fingerprint, probe)
        .map_err(|error| block(asset.id, RemapBlockReason::Drift, error.to_string()))?;
    let mut fingerprint = asset.fingerprint.clone();
    fingerprint.content_sha256 = Some(sha256.clone());
    Ok(DigestEvidence { sha256, fingerprint })
}

fn verify_remap<P: SourceProbe>(
    roots: &RemapRoots,
    items: &[RemapItem],
    assets: &[Asset],
    probe: &P,
) -> Result<()> {
    roots.candidate.verify(probe)?;
    let online = roots.original.verify(probe).is_ok();
    let by_id: HashMap<Uuid, &Asset> = assets.iter().map(|asset| (asset.id, asset)).collect();
    for item in items {
        let asset = by_id
            .get(&item.asset_id)
            .ok_or_else(|| LibraryError::NotFound(format!("asset {}", item.asset_id)))?;
        let relative = asset.relative_path.relative_path()?;
        let original = original_digest(&roots.original, online, &relative, asset, probe)
            .map_err(|refusal| remap_refusal(&refusal))?;
        if original.sha256 != item.original_digest.sha256 {
            return Err(scoped(
                LibraryError::IdentityConflict("original bytes changed since review".into()),
                asset.relative_path.clone(),
                Some(asset.id),
            ));
        }
        let candidate = &roots.candidate;
        let current = probe.fingerprint(&candidate.path.join(&relative))?;
        if !fingerprint_matches(&item.candidate_fingerprint, &current)
            || hash_contained(candidate, &relative, current.size_bytes, current.modified_ns)?
                != item.candidate_sha256
        {
            return Err(scoped(
                LibraryError::IdentityConflict("candidate changed since review".into()),
                item.candidate_path.clone(),
                Some(asset.id),
            ));
        }
    }
    roots.candidate.verify(probe)
}

fn remap_refusal(refusal: &RemapBlock) -> LibraryError {
    match refusal.reason {
        RemapBlockReason::NoByteProof => LibraryError::NoByteProof(refusal.message.clone()),
        _ => LibraryError::IdentityConflict(refusal.message.clone()),
    }
}

fn blocked_error(review: &RemapReview) -> LibraryError {
    let messages: Vec<&str> = review.blocked.iter().map(|item| item.message.as_str()).collect();
    let message = format!("remap review {} is blocked: {}", review.id, messages.join("; "));
    if review.blocked.iter().any(|item| item.reason == RemapBlockReason::NoByteProof) {
        LibraryError::NoByteProof(message)
    } else {
        LibraryError::IdentityConflict(message)
    }
}

fn require_reviewed(state: &str) -> Result<()> {
    if state == "reviewed" {
        Ok(())
    } else {
        Err(LibraryError::InvalidInput("remap review was already applied".into()))
    }
}

fn require_same_assets(review: &RemapReview, assets: &[Asset]) -> Result<()> {
    let reviewed: BTreeMap<Uuid, &RemapItem> =
        review.items.iter().map(|item| (item.asset_id, item)).collect();
    let unchanged = reviewed.len() == assets.len()
        && assets.iter().all(|asset| {
            reviewed.get(&asset.id).is_some_and(|item| {
                fingerprint_matches(&asset.fingerprint, &item.original_digest.fingerprint)
            })
        });
    if unchanged {
        Ok(())
    } else {
        Err(conflict(review.location_id, review.expected_revision))
    }
}

async fn insert_review(conn: &mut SqliteConnection, review: &RemapReview) -> Result<()> {
    sqlx::query(
        "INSERT INTO remap_reviews (id, location_id, expected_revision, proposed_root, \
         proposed_identity, items, blocked, state, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'reviewed', ?8)",
    )
    .bind(review.id.to_string())
    .bind(review.location_id.to_string())
    .bind(db_revision(review.expected_revision)?)
    .bind(path_key(&review.proposed_root))
    .bind(to_json(&review.proposed_identity)?)
    .bind(to_json(&review.items)?)
    .bind(to_json(&review.blocked)?)
    .bind(now()?)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

async fn load_review(conn: &mut SqliteConnection, id: Uuid) -> Result<(RemapReview, String)> {
    let row = sqlx::query("SELECT * FROM remap_reviews WHERE id = ?1")
        .bind(id.to_string())
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| LibraryError::NotFound(format!("remap review {id}")))?;
    let review = RemapReview {
        id,
        location_id: parse_uuid(&row.try_get::<String, _>("location_id")?)?,
        expected_revision: revision(row.try_get("expected_revision")?)?,
        proposed_root: path_from_key(&row.try_get::<Vec<u8>, _>("proposed_root")?)?,
        proposed_identity: from_json(&row.try_get::<String, _>("proposed_identity")?)?,
        items: from_json(&row.try_get::<String, _>("items")?)?,
        blocked: from_json(&row.try_get::<String, _>("blocked")?)?,
    };
    Ok((review, row.try_get("state")?))
}

async fn apply_remap_rows(
    conn: &mut SqliteConnection,
    review: &RemapReview,
    assets: &[Asset],
    new_root: &SourceRoot,
) -> Result<()> {
    let by_id: HashMap<Uuid, &Asset> = assets.iter().map(|asset| (asset.id, asset)).collect();
    for item in &review.items {
        let relative = item.candidate_path.relative_path()?;
        require_unchanged_contained(new_root, &relative, &item.candidate_fingerprint)?;
    }
    sqlx::query(
        "UPDATE locations SET path_key = ?1, identity = ?2, volume_filesystem = ?3, \
         volume_stable_id = ?4, availability = 'available', unavailable_reason = NULL, \
         unavailable_at = NULL, decision_revision = decision_revision + 1 WHERE id = ?5",
    )
    .bind(path_key(&review.proposed_root))
    .bind(to_json(&review.proposed_identity)?)
    .bind(review.proposed_identity.volume.filesystem.as_str())
    .bind(review.proposed_identity.volume.stable_id.as_deref())
    .bind(review.location_id.to_string())
    .execute(&mut *conn)
    .await?;
    let mut rebound = HashMap::new();
    for item in &review.items {
        let asset = by_id
            .get(&item.asset_id)
            .ok_or_else(|| LibraryError::NotFound(format!("asset {}", item.asset_id)))?;
        let fingerprint = item.candidate_fingerprint.clone();
        let basis = asset.quality_basis.as_ref().map(|basis| {
            if basis.equivalent(&item.original_digest.fingerprint)
                || basis.equivalent(&asset.fingerprint)
            {
                fingerprint.clone()
            } else {
                basis.clone()
            }
        });
        sqlx::query(
            "UPDATE assets SET fingerprint = ?1, size_bytes = ?2, modified_ns = ?3, \
             availability = 'available', quality_basis = ?4 WHERE id = ?5",
        )
        .bind(to_json(&fingerprint)?)
        .bind(db_size(fingerprint.size_bytes)?)
        .bind(fingerprint.modified_ns.to_string())
        .bind(basis.as_ref().map(to_json).transpose()?)
        .bind(asset.id.to_string())
        .execute(&mut *conn)
        .await?;
        rebound.insert(asset.id, (asset.fingerprint.clone(), fingerprint));
    }
    rebind_association_bases(conn, &rebound).await?;
    sqlx::query("UPDATE remap_reviews SET state = 'applied', applied_at = ?1 WHERE id = ?2")
        .bind(now()?)
        .bind(review.id.to_string())
        .execute(&mut *conn)
        .await?;
    Ok(())
}

async fn rebind_association_bases(
    conn: &mut SqliteConnection,
    rebound: &HashMap<Uuid, (ObservationFingerprint, ObservationFingerprint)>,
) -> Result<()> {
    let ids: BTreeSet<Uuid> = rebound.keys().copied().collect();
    let sessions: BTreeSet<Uuid> = current_session_of(conn, &ids).await?.into_values().collect();
    for session in sessions {
        for mut association in load_associations(conn, session).await? {
            let mut touched = false;
            for (asset, basis) in &mut association.observation_basis {
                if let Some((old, new)) = rebound.get(asset) {
                    if fingerprint_matches(old, basis) {
                        *basis = new.clone();
                        touched = true;
                    }
                }
            }
            if touched {
                sqlx::query(
                    "UPDATE associations SET observation_basis = ?1 WHERE session_id = ?2 AND kind = ?3",
                )
                .bind(to_json(&association.observation_basis)?)
                .bind(session.to_string())
                .bind(kind_text(association.kind))
                .execute(&mut *conn)
                .await?;
            }
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Source hashing (read-only)
// ---------------------------------------------------------------------------

async fn blocking<T, F>(work: F) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T> + Send + 'static,
{
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|error| LibraryError::SourceUnavailable(format!("hashing task failed: {error}")))?
}

/// A location root revalidated around every source read.
#[derive(Clone)]
struct SourceRoot {
    location: Location,
    path: PathBuf,
}

impl SourceRoot {
    fn new(location: Location) -> Result<Self> {
        let path = location.path.to_path_buf()?;
        Ok(Self { location, path })
    }

    fn verify<P: SourceProbe>(&self, probe: &P) -> Result<()> {
        let observed = probe.root_identity(&self.location)?;
        if same_root(&self.location.identity, &observed) {
            Ok(())
        } else {
            Err(scoped(
                LibraryError::IdentityConflict(
                    "root volume or folder identity differs from the registered location".into(),
                ),
                self.location.path.clone(),
                Some(self.location.id),
            ))
        }
    }

    fn source(&self, relative: &Path) -> NativePath {
        NativePath::from_path(&self.path.join(relative))
    }
}

/// Revalidate each distinct location root once.
fn verify_roots<'a, P: SourceProbe>(
    roots: impl Iterator<Item = &'a SourceRoot>,
    probe: &P,
) -> Result<()> {
    let mut verified = BTreeSet::new();
    for root in roots {
        if verified.insert(root.location.id) {
            root.verify(probe)?;
        }
    }
    Ok(())
}

/// Probe, hash and re-probe a source that must still match its recorded observation.
fn current_digest<P: SourceProbe>(
    root: &SourceRoot,
    relative: &Path,
    recorded: &ObservationFingerprint,
    probe: &P,
) -> Result<String> {
    let path = root.path.join(relative);
    let changed = || {
        scoped(
            LibraryError::IdentityConflict("source differs from its recorded observation".into()),
            root.source(relative),
            None,
        )
    };
    if !fingerprint_matches(recorded, &probe.fingerprint(&path)?) {
        return Err(changed());
    }
    let sha256 = hash_contained(root, relative, recorded.size_bytes, recorded.modified_ns)?;
    if !fingerprint_matches(recorded, &probe.fingerprint(&path)?) {
        return Err(changed());
    }
    if recorded.content_sha256.as_ref().is_some_and(|prior| *prior != sha256) {
        return Err(changed());
    }
    Ok(sha256)
}

/// SHA-256 of a regular file below `root`, opened without following links at any
/// level, whose size and nanosecond mtime equal the observation before and after
/// reading. The file is opened read-only and never modified.
fn hash_contained(
    root: &SourceRoot,
    relative: &Path,
    size_bytes: u64,
    modified_ns: i128,
) -> Result<String> {
    let (mut file, chain) = open_contained(root, relative)?;
    let path = root.path.join(relative);
    let io = |error: std::io::Error| LibraryError::from_io(&path, &error);
    if !stat_matches(&file.metadata().map_err(io)?, size_bytes, modified_ns) {
        return Err(changed_source(root, relative));
    }
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; HASH_BUFFER];
    loop {
        let read = file.read(&mut buffer).map_err(io)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    if !stat_matches(&file.metadata().map_err(io)?, size_bytes, modified_ns) {
        return Err(changed_source(root, relative));
    }
    chain.verify_unchanged()?;
    Ok(hex::encode(hasher.finalize()))
}

/// In-transaction recheck that a contained source still has its verified stats.
fn require_unchanged_contained(
    root: &SourceRoot,
    relative: &Path,
    fingerprint: &ObservationFingerprint,
) -> Result<()> {
    let (file, chain) = open_contained(root, relative)?;
    let metadata = file
        .metadata()
        .map_err(|error| LibraryError::from_io(&root.path.join(relative), &error))?;
    chain.verify_unchanged()?;
    if stat_matches(&metadata, fingerprint.size_bytes, fingerprint.modified_ns) {
        Ok(())
    } else {
        Err(changed_source(root, relative))
    }
}

fn changed_source(root: &SourceRoot, relative: &Path) -> LibraryError {
    scoped(
        LibraryError::IdentityConflict("file changed relative to its observation".into()),
        root.source(relative),
        None,
    )
}

/// Folders from the root to the source with their identity stamps at open time.
struct OpenedChain {
    folders: Vec<(PathBuf, Stamp)>,
}

impl OpenedChain {
    fn verify_unchanged(&self) -> Result<()> {
        for (path, stamp) in &self.folders {
            let metadata = real_directory(path)?;
            if stamp_of(&metadata) != *stamp {
                return Err(scoped(
                    LibraryError::IdentityConflict(
                        "a folder above the source changed while it was read".into(),
                    ),
                    NativePath::from_path(path),
                    None,
                ));
            }
        }
        Ok(())
    }
}

/// Open `root/relative` read-only after proving every folder from the root down
/// is a real directory on the root's device and the leaf is a regular file, then
/// prove the opened handle is the inspected leaf and no folder was swapped.
fn open_contained(root: &SourceRoot, relative: &Path) -> Result<(std::fs::File, OpenedChain)> {
    let parts = relative
        .components()
        .map(|part| match part {
            Component::Normal(name) => Ok(name),
            _ => Err(LibraryError::InvalidInput("relative path escapes its location".into())),
        })
        .collect::<Result<Vec<_>>>()?;
    let Some((leaf, folders)) = parts.split_last() else {
        return Err(LibraryError::InvalidInput("source path names the location root".into()));
    };
    let mut current = root.path.clone();
    let root_metadata = real_directory(&current)?;
    if !root_stamp_matches(&root.location.identity, &root_metadata) {
        return Err(scoped(
            LibraryError::IdentityConflict("root folder is not the registered folder".into()),
            root.location.path.clone(),
            Some(root.location.id),
        ));
    }
    let device = device_of(&root_metadata);
    let mut chain = OpenedChain { folders: vec![(current.clone(), stamp_of(&root_metadata))] };
    for folder in folders {
        current.push(folder);
        let metadata = real_directory(&current)?;
        if device_of(&metadata) != device {
            return Err(scoped(
                LibraryError::IdentityConflict("source lies below a nested volume boundary".into()),
                NativePath::from_path(&current),
                None,
            ));
        }
        chain.folders.push((current.clone(), stamp_of(&metadata)));
    }
    current.push(leaf);
    let leaf_metadata = lstat(&current)?;
    if fs_pathsafe::is_link_or_junction_metadata(&leaf_metadata) || !leaf_metadata.is_file() {
        return Err(scoped(
            LibraryError::SourceUnavailable("source is not a regular file".into()),
            NativePath::from_path(&current),
            None,
        ));
    }
    let file =
        std::fs::File::open(&current).map_err(|error| LibraryError::from_io(&current, &error))?;
    let handle = file.metadata().map_err(|error| LibraryError::from_io(&current, &error))?;
    if stamp_of(&handle) != stamp_of(&leaf_metadata) || device_of(&handle) != device {
        return Err(scoped(
            LibraryError::IdentityConflict("source was replaced while it was opened".into()),
            NativePath::from_path(&current),
            None,
        ));
    }
    chain.verify_unchanged()?;
    Ok((file, chain))
}

fn lstat(path: &Path) -> Result<std::fs::Metadata> {
    std::fs::symlink_metadata(path).map_err(|error| LibraryError::from_io(path, &error))
}

fn real_directory(path: &Path) -> Result<std::fs::Metadata> {
    let metadata = lstat(path)?;
    if fs_pathsafe::is_link_or_junction_metadata(&metadata) || !metadata.is_dir() {
        return Err(scoped(
            LibraryError::IdentityConflict(
                "a folder on the source path is a link or not a directory".into(),
            ),
            NativePath::from_path(path),
            None,
        ));
    }
    Ok(metadata)
}

#[cfg(unix)]
type Stamp = (u64, u64);

#[cfg(unix)]
fn stamp_of(metadata: &std::fs::Metadata) -> Stamp {
    use std::os::unix::fs::MetadataExt;
    (metadata.dev(), metadata.ino())
}

#[cfg(unix)]
fn device_of(metadata: &std::fs::Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt;
    metadata.dev()
}

/// Unix file ids are recorded as decimal `st_ino` on remount-stable volumes.
#[cfg(unix)]
fn root_stamp_matches(identity: &FileIdentity, metadata: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    !identity.volume.file_ids_stable
        || identity.file_id.as_deref() == Some(metadata.ino().to_string().as_str())
}

// Without stable std handle identity, non-unix hosts rely on the probe's root and
// leaf identity checks; this stamp still detects replaced folders by creation time.
#[cfg(not(unix))]
type Stamp = (bool, Option<std::time::SystemTime>);

#[cfg(not(unix))]
fn stamp_of(metadata: &std::fs::Metadata) -> Stamp {
    (metadata.is_dir(), metadata.created().ok())
}

#[cfg(not(unix))]
const fn device_of(_metadata: &std::fs::Metadata) -> u64 {
    0
}

#[cfg(not(unix))]
const fn root_stamp_matches(_identity: &FileIdentity, _metadata: &std::fs::Metadata) -> bool {
    true
}

fn stat_matches(metadata: &std::fs::Metadata, size_bytes: u64, modified_ns: i128) -> bool {
    metadata.len() == size_bytes && modified_nanos(metadata) == Some(modified_ns)
}

fn modified_nanos(metadata: &std::fs::Metadata) -> Option<i128> {
    let modified = metadata.modified().ok()?;
    match modified.duration_since(UNIX_EPOCH) {
        Ok(after) => i128::try_from(after.as_nanos()).ok(),
        Err(before) => i128::try_from(before.duration().as_nanos()).ok().map(|nanos| -nanos),
    }
}

// ---------------------------------------------------------------------------
// Native paths
// ---------------------------------------------------------------------------

/// Lossless storage key: encoding tag byte followed by the native payload.
fn path_key(path: &NativePath) -> Vec<u8> {
    match path {
        NativePath::UnixBytes(bytes) => {
            let mut key = Vec::with_capacity(bytes.len() + 1);
            key.push(0);
            key.extend_from_slice(bytes);
            key
        }
        NativePath::WindowsUtf16(units) => {
            let mut key = Vec::with_capacity(units.len() * 2 + 1);
            key.push(1);
            for unit in units {
                key.extend_from_slice(&unit.to_le_bytes());
            }
            key
        }
    }
}

fn path_from_key(key: &[u8]) -> Result<NativePath> {
    match key.split_first() {
        Some((0, bytes)) => Ok(NativePath::UnixBytes(bytes.to_vec())),
        Some((1, bytes)) if bytes.len() % 2 == 0 => Ok(NativePath::WindowsUtf16(
            bytes.as_chunks::<2>().0.iter().map(|pair| u16::from_le_bytes(*pair)).collect(),
        )),
        _ => Err(LibraryError::PersistenceFailure("corrupt native path key".into())),
    }
}

const fn root_scope(location_path: &NativePath) -> NativePath {
    match location_path {
        NativePath::UnixBytes(_) => NativePath::UnixBytes(Vec::new()),
        NativePath::WindowsUtf16(_) => NativePath::WindowsUtf16(Vec::new()),
    }
}

fn components(path: &NativePath) -> Vec<NativePath> {
    match path {
        NativePath::UnixBytes(bytes) => bytes
            .split(|byte| *byte == b'/')
            .filter(|part| !part.is_empty() && *part != b".")
            .map(|part| NativePath::UnixBytes(part.to_vec()))
            .collect(),
        NativePath::WindowsUtf16(units) => units
            .split(|unit| *unit == 0x2f || *unit == 0x5c)
            .filter(|part| !part.is_empty() && *part != [0x2e])
            .map(|part| NativePath::WindowsUtf16(part.to_vec()))
            .collect(),
    }
}

/// Exact component containment of scan paths (same scanner encoding).
fn within(path: &NativePath, scope: &NativePath) -> bool {
    let (path, scope) = (components(path), components(scope));
    scope.len() <= path.len() && path.iter().zip(&scope).all(|(left, right)| left == right)
}

/// Same, ancestor or descendant roots using the volume's case/normalization rules.
fn roots_overlap(left: &NativePath, right: &NativePath, volume: &VolumeIdentity) -> bool {
    let (left, right) = (components(left), components(right));
    left.iter().zip(&right).all(|(a, b)| a.same_on(b, volume))
}

// ---------------------------------------------------------------------------
// Codecs
// ---------------------------------------------------------------------------

fn now() -> Result<String> {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|error| LibraryError::PersistenceFailure(error.to_string()))
}

fn parse_uuid(text: &str) -> Result<Uuid> {
    Uuid::parse_str(text).map_err(|error| {
        LibraryError::PersistenceFailure(format!("corrupt identity {text}: {error}"))
    })
}

fn json_ids(ids: &BTreeSet<Uuid>) -> Result<String> {
    to_json(&ids.iter().map(ToString::to_string).collect::<Vec<_>>())
}

fn revision(value: i64) -> Result<Revision> {
    Revision::try_from(value)
        .map_err(|_| LibraryError::PersistenceFailure(format!("corrupt revision {value}")))
}

fn db_revision(value: Revision) -> Result<i64> {
    i64::try_from(value).map_err(|_| LibraryError::InvalidInput("revision out of range".into()))
}

fn db_size(value: u64) -> Result<i64> {
    i64::try_from(value).map_err(|_| LibraryError::InvalidInput("file size out of range".into()))
}

fn to_json<T: Serialize + ?Sized>(value: &T) -> Result<String> {
    serde_json::to_string(value)
        .map_err(|error| LibraryError::PersistenceFailure(format!("encode catalog value: {error}")))
}

fn from_json<T: DeserializeOwned>(text: &str) -> Result<T> {
    serde_json::from_str(text).map_err(|error| {
        LibraryError::PersistenceFailure(format!("corrupt catalog record: {error}"))
    })
}

fn to_text<T: Serialize>(value: &T) -> Result<String> {
    match serde_json::to_value(value).map_err(|error| {
        LibraryError::PersistenceFailure(format!("encode catalog value: {error}"))
    })? {
        serde_json::Value::String(text) => Ok(text),
        other => Ok(other.to_string()),
    }
}

fn from_text<T: DeserializeOwned>(text: &str) -> Result<T> {
    serde_json::from_value(serde_json::Value::String(text.to_owned())).map_err(|error| {
        LibraryError::PersistenceFailure(format!("corrupt catalog value {text}: {error}"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn large_target() -> TargetCandidate {
        TargetCandidate {
            id: Uuid::new_v4(),
            designation: "NGC 7000".into(),
            aliases: (0..2000)
                .map(|index| platevault_model::TargetAlias {
                    text: format!("alias {index}"),
                    normalized: format!("alias {index} {}", "x".repeat(400)),
                    kind: "test".into(),
                    provenance: Provenance::User,
                })
                .collect(),
            common_name: None,
            object_type: "nebula".into(),
            coordinates: None,
            provenance: Provenance::User,
            provider_id: None,
        }
    }

    /// A disposable `max_page_count` fixture forces `SQLITE_FULL` on the writer.
    #[tokio::test]
    async fn sqlite_full_reports_persistence_failure_and_restart_has_no_saved_record() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("catalog.sqlite");
        let catalog = Catalog::open(&path).await.unwrap();
        catalog.limit_writer_pages_for_test().await.unwrap();
        let candidate = large_target();
        let error = catalog.save_target(&candidate, None).await.unwrap_err();
        assert_eq!(error.response(None, None).kind, "persistence_failure");
        assert!(error.to_string().contains("full"), "{error}");
        assert_eq!(
            catalog.target(candidate.id).await.unwrap_err().response(None, None).kind,
            "not_found"
        );
        catalog.close().await.unwrap();

        let reopened = Catalog::open(&path).await.unwrap();
        assert_eq!(
            reopened.target(candidate.id).await.unwrap_err().response(None, None).kind,
            "not_found"
        );
        assert!(reopened.list_targets(0, 10).await.unwrap().is_empty());
        assert!(reopened.save_target(&candidate, None).await.is_ok(), "unlimited writer saves");
    }

    use platevault_model::ImageFormat;

    fn plan_volume(stable_id: &str) -> VolumeIdentity {
        VolumeIdentity {
            filesystem: "apfs".into(),
            stable_id: Some(stable_id.into()),
            file_ids_stable: false,
            case: PathSensitivity::Sensitive,
            normalization: PathSensitivity::Sensitive,
        }
    }

    /// Two locations on their own volumes with `sessions` single-frame sessions each.
    async fn indexed_catalog(dir: &Path, sessions: usize) -> Catalog {
        let catalog = Catalog::open(&dir.join("catalog.sqlite")).await.unwrap();
        for index in 0..2 {
            let root = dir.join(format!("root{index}"));
            std::fs::create_dir(&root).unwrap();
            let identity =
                FileIdentity { volume: plan_volume(&format!("vol-{index}")), file_id: None };
            let location = catalog
                .register_location(&LocationRegistration {
                    name: format!("root{index}"),
                    path: NativePath::from_path(&root),
                    role: LocationRole::Captures,
                    identity: identity.clone(),
                })
                .await
                .unwrap();
            let files = (0..sessions)
                .map(|frame| ScanFile {
                    relative_path: NativePath::from_path(Path::new(&format!("f{frame}.fits"))),
                    fingerprint: ObservationFingerprint {
                        identity: identity.clone(),
                        size_bytes: 2880,
                        modified_ns: 1,
                        content_sha256: None,
                    },
                    format: ImageFormat::Fits,
                    metadata: CaptureMetadata {
                        image_type: Some("LIGHT".into()),
                        filter: Some(format!("F{frame}")),
                        exposure_seconds: Some(60.0),
                        date_obs: Some("2026-09-18T22:00:00".into()),
                        ..CaptureMetadata::default()
                    },
                })
                .collect();
            let operation = catalog.begin_scan(location.id, None).await.unwrap();
            let batch = ScanBatch { files, ..ScanBatch::default() };
            catalog
                .apply_scan_batch(operation.id, &identity, &batch, |assets: &[Asset]| {
                    let mut by_filter: BTreeMap<String, Vec<Uuid>> = BTreeMap::new();
                    for asset in assets {
                        let key = format!("{:?}", asset.effective.filter);
                        by_filter.entry(key).or_default().push(asset.id);
                    }
                    GroupingResult {
                        sessions: by_filter
                            .into_iter()
                            .map(|(key, asset_ids)| SessionCandidate {
                                key: CaptureKey(key),
                                asset_ids,
                                provisional: Vec::new(),
                                date_basis: None,
                            })
                            .collect(),
                    }
                })
                .await
                .unwrap();
        }
        catalog
    }

    fn reads(name: &'static str) -> usize {
        READS.with(|reads| reads.borrow().get(name).copied().unwrap_or(0))
    }

    /// The D16 and provisional reads of one request do not grow with its sessions.
    #[tokio::test]
    async fn session_reads_compute_d16_and_provisional_state_once_per_request() {
        let dir = tempfile::tempdir().unwrap();
        let catalog = indexed_catalog(dir.path(), 20).await;
        READS.with(|reads| reads.borrow_mut().clear());
        let sessions = catalog.list_sessions(&SessionQuery::default()).await.unwrap();
        assert_eq!(sessions.len(), 20, "each filter is one session across both locations");
        assert!(sessions.iter().all(|s| s.provisional && s.asset_count == 2), "unhashed pairs");
        assert_eq!(reads("location_provisional"), 2, "once per location, not per session");
        assert_eq!(reads("candidates"), 1, "one candidate query for the request");
        READS.with(|reads| reads.borrow_mut().clear());
        let detail = catalog.session(sessions[0].session.id).await.unwrap();
        assert!(detail.members.iter().all(|member| member.duplicate_candidate));
        assert_eq!((reads("location_provisional"), reads("candidates")), (2, 1));
    }

    /// Every D16 read is driven by an index; none scans the assets or link tables,
    /// and the copy-pair queries seek the session/size/start index.
    #[tokio::test]
    async fn d16_queries_use_indexes_and_scan_no_asset_table() {
        let dir = tempfile::tempdir().unwrap();
        let catalog = indexed_catalog(dir.path(), 3).await;
        let mut conn = catalog.reader().await.unwrap();
        let ids = r#"["00000000-0000-0000-0000-000000000000"]"#;
        for (sql, binds, pair) in [
            (CANDIDATES_IN_SESSIONS, vec![ids], true),
            (MATCHES_OF_LOCATION, vec!["location"], true),
            (COPIES_BY_DIGEST, vec![r#"["digest"]"#], false),
            (ASSETS_BY_IDS, vec![ids], false),
            (LINKS_OF_ASSETS, vec![ids], false),
            (PENDING_IN_LOCATION, vec!["location"], false),
            (IS_ALIASED_COPY, vec!["digest", "location", "asset"], false),
        ] {
            let explain = format!("EXPLAIN QUERY PLAN {sql}");
            let mut query = sqlx::query(sqlx::AssertSqlSafe(explain));
            for bind in binds {
                query = query.bind(bind);
            }
            let plan: Vec<String> = query
                .fetch_all(&mut *conn)
                .await
                .unwrap()
                .iter()
                .map(|row| row.try_get::<String, _>("detail").unwrap())
                .collect();
            let scanned = plan.iter().any(|detail| {
                ["SCAN a", "SCAN b", "SCAN d", "SCAN assets", "SCAN copy_links"]
                    .iter()
                    .any(|scan| detail == scan || detail.starts_with(&format!("{scan} ")))
            });
            assert!(!scanned, "{sql}\n{plan:#?}");
            assert!(plan.iter().any(|detail| detail.contains("USING")), "{plan:#?}");
            if pair {
                let seek = "USING INDEX assets_session_size_start \
                            (session_id=? AND size_bytes=? AND capture_start=? AND location_id=?)";
                assert!(plan.iter().any(|detail| detail.contains(seek)), "{sql}\n{plan:#?}");
            }
        }
    }

    /// An older catalog is refused with the documented error before any DDL of
    /// this version runs against it, and the file is left as it was.
    #[tokio::test]
    async fn an_older_catalog_is_refused_as_an_unsupported_schema_version() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("catalog.sqlite");
        let options = SqliteConnectOptions::new().filename(&path).create_if_missing(true);
        let mut conn = SqliteConnection::connect_with(&options).await.unwrap();
        // The v2 shape: version 2 recorded, assets without the derived digest column.
        sqlx::raw_sql(
            "CREATE TABLE catalog_meta (key TEXT PRIMARY KEY NOT NULL, value INTEGER NOT NULL) \
             STRICT; INSERT INTO catalog_meta VALUES ('schema_version', 2); \
             CREATE TABLE assets (id TEXT PRIMARY KEY NOT NULL, fingerprint TEXT NOT NULL) STRICT;",
        )
        .execute(&mut conn)
        .await
        .unwrap();
        conn.close().await.unwrap();
        let error = Catalog::open(&path).await.err().expect("an older catalog is refused");
        assert_eq!(error.response(None, None).kind, "invalid_input", "{error}");
        assert_eq!(error.to_string(), "invalid input: unsupported catalog schema version 2");
        let mut conn = SqliteConnection::connect_with(&options).await.unwrap();
        let tables: Vec<String> =
            sqlx::query_scalar("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
                .fetch_all(&mut conn)
                .await
                .unwrap();
        assert_eq!(tables, ["assets", "catalog_meta"], "no DDL of this version was applied");
    }

    /// Without folder identity (non-Unix hosts) roots compare by canonical path only.
    #[test]
    fn roots_without_folder_identity_overlap_only_by_canonical_path() {
        let volume = plan_volume("vol");
        let root = |path: &str| CanonicalRoot {
            path: NativePath::from_path(Path::new(path)),
            ancestry: None,
        };
        assert!(!root("/D/Backup/2024").overlaps(&root("/D/Astro/2024"), &volume));
        assert!(root("/D/Astro").overlaps(&root("/D/Astro/2024"), &volume));
        assert!(root("/D/Astro/2024").overlaps(&root("/D/Astro"), &volume));
        let unix = CanonicalRoot {
            path: NativePath::from_path(Path::new("/D/x")),
            ancestry: Some(vec![(1, 2)]),
        };
        assert!(!unix.overlaps(&root("/D/y"), &volume), "identity needs it on both sides");
        let recorded = FileIdentity {
            volume: VolumeIdentity { file_ids_stable: true, ..volume },
            file_id: Some("2".into()),
        };
        assert!(!root("/D/x").descends_from(&recorded), "no ancestry, no identity claim");
        assert!(unix.descends_from(&recorded));
    }

    /// A real folder registered on a volume with remount-stable folder ids.
    #[cfg(unix)]
    fn stable_registration(path: &Path) -> LocationRegistration {
        use std::os::unix::fs::MetadataExt;
        let inode = std::fs::symlink_metadata(path).unwrap().ino();
        LocationRegistration {
            name: path.file_name().unwrap().to_string_lossy().into_owned(),
            path: NativePath::from_path(path),
            role: LocationRole::Captures,
            identity: FileIdentity {
                volume: VolumeIdentity { file_ids_stable: true, ..plan_volume("search-vol") },
                file_id: Some(inode.to_string()),
            },
        }
    }

    #[cfg(unix)]
    fn digest_of(path: &Path) -> String {
        hex::encode(Sha256::digest(std::fs::read(path).unwrap()))
    }

    /// The stale-root search runs off the writer lock: while it is held, a target save
    /// commits, and the registration commits once the search finishes.
    #[cfg(unix)]
    #[tokio::test]
    async fn a_slow_stale_root_search_never_blocks_catalog_writes() {
        let dir = tempfile::tempdir().unwrap();
        let catalog = Arc::new(Catalog::open(&dir.path().join("catalog.sqlite")).await.unwrap());
        let (test, flats) = (dir.path().join("Test"), dir.path().join("Flats"));
        std::fs::create_dir_all(&test).unwrap();
        std::fs::create_dir_all(&flats).unwrap();
        std::fs::write(flats.join("Flat_001.fits"), b"flat frame bytes").unwrap();
        let original = digest_of(&flats.join("Flat_001.fits"));
        catalog.register_location(&stable_registration(&test)).await.unwrap();
        std::fs::remove_dir_all(&test).unwrap();

        // The search signals that it started, then waits until it is released.
        let (started, searching) = tokio::sync::oneshot::channel::<()>();
        let (release, released) = std::sync::mpsc::channel::<()>();
        let mut started = Some(started);
        catalog
            .set_stale_search_hook(move || {
                if let Some(started) = started.take() {
                    let _ = started.send(());
                }
                let _ = released.recv();
            })
            .await;
        let registering = tokio::spawn({
            let catalog = Arc::clone(&catalog);
            let registration = stable_registration(&flats);
            async move { catalog.register_location(&registration).await }
        });
        tokio::time::timeout(Duration::from_secs(20), searching).await.unwrap().unwrap();

        let target = TargetCandidate { aliases: Vec::new(), ..large_target() };
        let saved =
            tokio::time::timeout(Duration::from_secs(5), catalog.save_target(&target, None)).await;
        assert!(saved.is_ok(), "a target save waited for the stale-root search");
        saved.unwrap().unwrap();
        release.send(()).unwrap();
        let registered = tokio::time::timeout(Duration::from_secs(20), registering)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(registered.path, NativePath::from_path(&flats));
        assert_eq!(catalog.list_locations().await.unwrap().len(), 2);
        assert_eq!(digest_of(&flats.join("Flat_001.fits")), original, "originals unchanged");
    }

    /// Install a hook that runs `change` on the `n`th stale-root search (from 0) and
    /// counts the searches.
    #[cfg(unix)]
    async fn change_during_searches(
        catalog: &Catalog,
        mut change: impl FnMut(usize) + Send + 'static,
    ) -> Arc<std::sync::atomic::AtomicUsize> {
        let searches = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counted = Arc::clone(&searches);
        catalog.set_stale_search_hook(move || change(counted.fetch_add(1, Ordering::SeqCst))).await;
        searches
    }

    /// Roots that change while the candidate is searched are searched again before the
    /// change commits: a root moved into the candidate during the first search is found
    /// by the second, and stale roots that keep changing end in a retryable conflict.
    #[cfg(unix)]
    #[tokio::test]
    async fn roots_that_change_during_the_search_are_searched_again_before_commit() {
        let dir = tempfile::tempdir().unwrap();
        let catalog = Catalog::open(&dir.path().join("catalog.sqlite")).await.unwrap();
        let folder = |name: &str| {
            let path = dir.path().join(name);
            std::fs::create_dir_all(&path).unwrap();
            path
        };
        let (test, darks, archive) = (folder("Test"), folder("Darks"), folder("Archive"));
        std::fs::write(darks.join("Dark_001.fits"), b"dark frame bytes").unwrap();
        let original = digest_of(&darks.join("Dark_001.fits"));
        catalog.register_location(&stable_registration(&test)).await.unwrap();
        catalog.register_location(&stable_registration(&darks)).await.unwrap();
        std::fs::remove_dir_all(&test).unwrap();

        // Darks moves into the candidate while the first search runs.
        let moved = archive.join("Darks");
        let searches = change_during_searches(&catalog, {
            let (darks, moved) = (darks.clone(), moved.clone());
            move |search| {
                if search == 0 {
                    std::fs::rename(&darks, &moved).unwrap();
                }
            }
        })
        .await;
        let error = catalog.register_location(&stable_registration(&archive)).await.unwrap_err();
        assert_eq!(searches.load(Ordering::SeqCst), 2, "searched again for the moved root");
        assert_eq!(error.response(None, None).kind, "identity_conflict");
        let found = std::fs::canonicalize(&moved).unwrap().display().to_string();
        let message = error.to_string();
        assert!(message.contains("\"Darks\"") && message.contains(&found), "{message}");
        assert_eq!(catalog.list_locations().await.unwrap().len(), 2, "refusals write nothing");

        // Each search, one more registered root stops resolving: after the bounded
        // searches the change is refused as a conflict on the last of them.
        let mut others = Vec::new();
        for name in ["R1", "R2", "R3"] {
            others.push(
                catalog.register_location(&stable_registration(&folder(name))).await.unwrap(),
            );
        }
        let gone: Vec<PathBuf> =
            others.iter().map(|other| other.path.to_path_buf().unwrap()).collect();
        let searches = change_during_searches(&catalog, move |search| {
            if let Some(path) = gone.get(search) {
                std::fs::remove_dir(path).unwrap();
            }
        })
        .await;
        let flats = folder("Flats");
        let error = catalog.register_location(&stable_registration(&flats)).await.unwrap_err();
        assert_eq!(searches.load(Ordering::SeqCst), STALE_ROOT_SEARCH_ATTEMPTS);
        let response = error.response(None, None);
        assert_eq!((response.kind.as_str(), response.identity), ("conflict", Some(others[2].id)));
        assert_eq!(catalog.list_locations().await.unwrap().len(), 5, "refusals write nothing");
        assert_eq!(digest_of(&moved.join("Dark_001.fits")), original, "originals unchanged");
    }

    /// A search stops at its folder or time bound and is then incomplete, never
    /// absent. A search stopped by the time bound says it can be retried.
    #[cfg(unix)]
    #[test]
    fn the_stale_root_search_is_bounded_by_folders_and_time() {
        let dir = tempfile::tempdir().unwrap();
        for folder in ["a/b", "c"] {
            std::fs::create_dir_all(dir.path().join(folder)).unwrap();
        }
        let wanted = [(0, 0)];
        let bounds =
            |folders, seconds| SearchBounds { folders, time: Duration::from_secs(seconds) };
        let search = |bounds| search_folders(dir.path(), &wanted, bounds);
        assert!(matches!(search(STALE_ROOT_SEARCH), FolderSearch::Absent));
        let FolderSearch::Incomplete(reason) = search(bounds(2, 10)) else {
            panic!("the folder bound was not applied");
        };
        assert!(reason.contains("more than 2 folders"), "{reason}");
        let FolderSearch::Incomplete(reason) = search(bounds(100, 0)) else {
            panic!("the time bound was not applied");
        };
        assert!(
            reason.contains("longer than 0 s") && reason.contains("can be retried"),
            "{reason}"
        );
    }
}
