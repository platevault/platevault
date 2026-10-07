// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Import (spec 071 STO-IMP-FR-01..06/08; LIB-FR-16, LIB-AC-17 import side).
//!
//! A preview lists every FITS/XISF frame below a mounted source folder and
//! writes nothing. A file is offered only once its size and modification time
//! stayed unchanged across two checks at least the settle interval apart; it
//! is then reviewed through custody (no-follow fingerprint and SHA-256) and its
//! header classifies it by IMAGETYP. Lights route to a Captures location and
//! every calibration frame to a Calibration location, under the paths the
//! naming templates resolve; files keep their basenames. A file whose SHA-256
//! matches a frame imported from the saved source, a library frame, an earlier
//! file of the import or the bytes already at its destination is a skipped
//! duplicate; different bytes at the destination block the item.
//!
//! Starting approves exactly the Ready items of the shown revision. Execution
//! runs them through the custody journal: Copy is a verified transfer, Move
//! also re-verifies the source against its snapshot immediately before the OS
//! Trash takes it, and a source the OS Trash cannot keep stays where it is.
//! When the source or a destination goes away the import is Interrupted:
//! verified items keep their state, the rest stay pending, and Retry resumes
//! from the recorded journal, never from file names. Landed copies are indexed
//! by a scan of their destination folder.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex, PoisonError};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use metadata_core::{FrameType, MetadataExtractor};
use metadata_fits::FitsExtractor;
use metadata_xisf::XisfExtractor;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::calibration::Rules;
use crate::custody::trash::OsTrash;
use crate::grouping::{group_assets, observing_night};
use crate::inventory;
use crate::library::{blocking, InventoryProbe, Library};
use crate::{
    Availability, CalibrationRules, CaptureMetadata, CorrectionInput, EntryKind, ExpectedAsset,
    FileIdentity, ImageTypeEvidence, ImportBlock, ImportChoice, ImportDestination, ImportDraft,
    ImportDuplicate, ImportItem, ImportItemPhase, ImportItemRecord, ImportMode, ImportOperation,
    ImportRecord, ImportRig, ImportSourceSpec, ImportState, ImportSummary, InputKind, ItemOutcome,
    ItemPhase, ItemReason, KeptCopy, LibraryError, Location, LocationLifecycle, LocationRole,
    NamingFrameType, NamingMetadata, NativePath, ObservationFingerprint, ReasonCode, RigFilters,
    SavedSource, SavedSourceView, ScanOperation, ScanState, SettleObservation, StorageItem,
    StorageItemDraft, StorageOperation, StorageOperationKind, StorageOperationState, StorageRef,
    TransferDestination, UnknownFilter, Writability,
};

/// How far apart the two settle checks of a source file are, at least.
pub const DEFAULT_SETTLE_INTERVAL: Duration = Duration::from_secs(2);

/// Scans of one destination folder attempted while other scans keep the
/// location busy.
const SCAN_ATTEMPTS: usize = 8;

const HASH_BUFFER: usize = 1 << 20;

/// How a preview or recheck observes the source.
#[derive(Clone, Copy, Debug)]
pub struct ImportCheck {
    /// Minimum time between the consecutive checks a file must pass unchanged.
    pub settle_interval: Duration,
}

impl Default for ImportCheck {
    fn default() -> Self {
        Self { settle_interval: DEFAULT_SETTLE_INTERVAL }
    }
}

/// Imports a runner of this process is executing right now.
static RUNNING: LazyLock<Mutex<HashSet<Uuid>>> = LazyLock::new(Mutex::default);

/// Exclusive claim on one import's execution; released on drop.
struct Runner(Uuid);

impl Runner {
    fn claim(id: Uuid) -> Result<Self, LibraryError> {
        let claimed = RUNNING.lock().unwrap_or_else(PoisonError::into_inner).insert(id);
        if !claimed {
            return Err(LibraryError::InvalidInput(format!("import {id} is already running")));
        }
        Ok(Self(id))
    }
}

impl Drop for Runner {
    fn drop(&mut self) {
        RUNNING.lock().unwrap_or_else(PoisonError::into_inner).remove(&self.0);
    }
}

impl Library {
    /// Save a mounted folder under a name, for Import new.
    ///
    /// # Errors
    /// `InvalidInput` for a blank name or a path that is not a real folder;
    /// `Conflict` when the folder is already saved.
    pub async fn save_import_source(
        &self,
        name: String,
        path: NativePath,
    ) -> Result<SavedSource, LibraryError> {
        let root = path.to_path_buf()?;
        let availability = blocking(move || Ok(folder_availability(&root))).await?;
        if availability != Availability::Available {
            return Err(LibraryError::InvalidInput(format!(
                "{} is not a readable folder ({availability:?})",
                path.display()
            )));
        }
        self.catalog().save_import_source(&name, &path).await
    }

    /// Every saved source with whether its folder can be read now.
    ///
    /// # Errors
    /// `PersistenceFailure` for an unreadable catalog.
    pub async fn import_sources(&self) -> Result<Vec<SavedSourceView>, LibraryError> {
        let sources = self.catalog().import_sources().await?;
        blocking(move || {
            Ok(sources
                .into_iter()
                .map(|source| {
                    let availability = source
                        .path
                        .to_path_buf()
                        .map_or(Availability::Unreadable, |root| folder_availability(&root));
                    SavedSourceView { source, availability }
                })
                .collect())
        })
        .await
    }

    /// Preview an import of every frame below a source folder. Nothing is
    /// written to any location; the preview is recorded for the user's
    /// choices and Start.
    ///
    /// # Errors
    /// `NotFound` for an unknown saved source; `SourceUnavailable` when the
    /// folder is not mounted or cannot be listed; catalog failures.
    pub async fn preview_import(
        &self,
        source: ImportSourceSpec,
        check: ImportCheck,
    ) -> Result<ImportOperation, LibraryError> {
        let (source_id, source_path) = match source {
            ImportSourceSpec::Saved { id } => {
                (Some(id), self.catalog().import_source(id).await?.path)
            }
            ImportSourceSpec::Folder { path } => (None, path),
        };
        let root = online_root(&source_path).await?;
        let mut items = self.settle_source(&root, Vec::new(), check).await?;
        self.route(source_id, Uuid::nil(), &[], &mut items).await?;
        let record =
            self.catalog().record_import(&ImportDraft { source_id, source_path, items }).await?;
        self.import_view(record).await
    }

    /// Check the source again: settling files that held still are offered,
    /// changed files settle again, new files are added, and every item is
    /// routed again (a saved naming template or a new location takes effect).
    ///
    /// # Errors
    /// `Conflict` for a stale revision; `InvalidInput` once started;
    /// `SourceUnavailable` while the source folder is offline.
    pub async fn recheck_import(
        &self,
        id: Uuid,
        expected_revision: u64,
        check: ImportCheck,
    ) -> Result<ImportOperation, LibraryError> {
        let record = self.preview_record(id, expected_revision).await?;
        let root = online_root(&record.source_path).await?;
        let mut items = self.settle_source(&root, record.items, check).await?;
        self.route(record.source_id, id, &record.choices, &mut items).await?;
        let record =
            self.catalog().revise_import(id, expected_revision, &record.choices, &items).await?;
        self.import_view(record).await
    }

    /// Set (or clear) the frame type of a preview item; an Unclassified frame
    /// is offered once it has one.
    ///
    /// # Errors
    /// `Conflict` for a stale revision; `NotFound` for an unknown item;
    /// `InvalidInput` once started.
    pub async fn set_import_type(
        &self,
        id: Uuid,
        expected_revision: u64,
        seq: u32,
        frame_type: Option<NamingFrameType>,
    ) -> Result<ImportOperation, LibraryError> {
        self.revise_preview(id, expected_revision, None, |items| {
            preview_item(items, id, seq)?.item.user_type = frame_type;
            Ok(())
        })
        .await
    }

    /// Leave a preview item out of the import, or take it back in.
    ///
    /// # Errors
    /// As [`Self::set_import_type`].
    pub async fn set_import_excluded(
        &self,
        id: Uuid,
        expected_revision: u64,
        seq: u32,
        excluded: bool,
    ) -> Result<ImportOperation, LibraryError> {
        self.revise_preview(id, expected_revision, None, |items| {
            preview_item(items, id, seq)?.item.excluded = excluded;
            Ok(())
        })
        .await
    }

    /// Choose the location a role's items go to when the role has several.
    ///
    /// # Errors
    /// `InvalidInput` for a retired location, one of another role or the
    /// Results role; otherwise as [`Self::set_import_type`].
    pub async fn choose_import_location(
        &self,
        id: Uuid,
        expected_revision: u64,
        role: LocationRole,
        location_id: Uuid,
    ) -> Result<ImportOperation, LibraryError> {
        let location = self.catalog().location(location_id).await?;
        if role == LocationRole::Results
            || location.role != role
            || location.lifecycle != LocationLifecycle::Active
        {
            return Err(LibraryError::InvalidInput(format!(
                "{} is not an active {role:?} location",
                location.name
            )));
        }
        self.revise_preview(id, expected_revision, Some(ImportChoice { role, location_id }), |_| {
            Ok(())
        })
        .await
    }

    /// Start a previewed import: record Copy or Move and approve exactly the
    /// Ready items of `expected_revision`, each with its recorded identity and
    /// SHA-256. Nothing is written until [`Self::run_import`].
    ///
    /// # Errors
    /// `Conflict` when the preview changed since it was shown; `InvalidInput`
    /// once started or when nothing is Ready.
    pub async fn start_import(
        &self,
        id: Uuid,
        expected_revision: u64,
        mode: ImportMode,
    ) -> Result<ImportOperation, LibraryError> {
        let record = self.catalog().start_import(id, expected_revision, mode).await?;
        self.import_view(record).await
    }

    /// Execute or resume a started import until every approved item has an
    /// outcome, or until its source or a destination goes offline (the import
    /// is then Interrupted and this is its Retry). Landed copies are indexed.
    ///
    /// # Errors
    /// `InvalidInput` for a preview or while another call runs this import;
    /// journal, scan and catalog failures.
    pub async fn run_import(
        self: &Arc<Self>,
        id: Uuid,
        trash: Arc<dyn OsTrash>,
    ) -> Result<ImportOperation, LibraryError> {
        let _runner = Runner::claim(id)?;
        let record = self.catalog().import_record(id).await?;
        let mode = match (record.state, record.mode) {
            (ImportState::Previewed, _) => {
                return Err(LibraryError::InvalidInput(
                    "start the import before running it".into(),
                ));
            }
            (ImportState::Settled, _) => return self.import_view(record).await,
            (_, Some(mode)) => mode,
            (_, None) => {
                return Err(LibraryError::PersistenceFailure(format!(
                    "started import {id} records no mode"
                )));
            }
        };
        let roots = self.roots(&record).await?;
        if !roots.online(&record).await? {
            return self.interrupt(id).await;
        }
        if record.state == ImportState::Interrupted {
            self.catalog().set_import_state(id, ImportState::Running).await?;
        }
        loop {
            match self.advance_import(id, mode, &roots, &trash).await? {
                Advance::Continue => {}
                Advance::Offline => return self.interrupt(id).await,
                Advance::Done => break,
            }
        }
        self.index_landed(id, &roots).await?;
        let record = self.catalog().set_import_state(id, ImportState::Settled).await?;
        self.import_view(record).await
    }

    /// One durable step: take the journal's progress into the items, then
    /// step the open storage operation, or queue the next one.
    async fn advance_import(
        &self,
        id: Uuid,
        mode: ImportMode,
        roots: &Roots,
        trash: &Arc<dyn OsTrash>,
    ) -> Result<Advance, LibraryError> {
        let record = self.catalog().import_record(id).await?;
        let online = roots.online(&record).await?;
        if let Some(storage_id) = record.items.iter().find_map(|item| item.storage) {
            let operation = self.catalog().storage_operation(storage_id.operation_id).await?;
            let changes = journal_changes(&record, &operation, roots, online)?;
            if !changes.is_empty() {
                self.catalog().record_import_progress(id, &changes).await?;
            }
            if operation.state == StorageOperationState::Settled {
                return Ok(Advance::Continue);
            }
            if !online {
                return Ok(Advance::Offline);
            }
            self.step_storage_operation(storage_id.operation_id, Arc::clone(trash)).await?;
            return Ok(Advance::Continue);
        }
        let phase = |phase| move |item: &&ImportItemRecord| item.item.phase == phase;
        let transfers: Vec<&ImportItemRecord> =
            record.items.iter().filter(phase(ImportItemPhase::Pending)).collect();
        let retirements: Vec<&ImportItemRecord> =
            record.items.iter().filter(phase(ImportItemPhase::Landed)).collect();
        if transfers.is_empty() && retirements.is_empty() {
            return Ok(Advance::Done);
        }
        if !online {
            return Ok(Advance::Offline);
        }
        if transfers.is_empty() {
            self.queue_retirements(id, &retirements, roots).await?;
        } else {
            let kind = match mode {
                ImportMode::Copy => StorageOperationKind::Copy,
                ImportMode::Move => StorageOperationKind::Move,
            };
            let drafts = transfers
                .iter()
                .map(|item| transfer_draft(item, roots))
                .collect::<Result<Vec<_>, _>>()?;
            self.queue(id, kind, &transfers, &drafts).await?;
        }
        Ok(Advance::Continue)
    }

    /// An import as Import shows it.
    ///
    /// # Errors
    /// `NotFound` for an unknown import.
    pub async fn import_operation(&self, id: Uuid) -> Result<ImportOperation, LibraryError> {
        let record = self.catalog().import_record(id).await?;
        self.import_view(record).await
    }

    async fn preview_record(
        &self,
        id: Uuid,
        expected_revision: u64,
    ) -> Result<ImportRecord, LibraryError> {
        let record = self.catalog().import_record(id).await?;
        if record.revision != expected_revision {
            return Err(LibraryError::Conflict {
                id,
                current: record.revision,
                successors: Vec::new(),
            });
        }
        if record.state != ImportState::Previewed {
            return Err(LibraryError::InvalidInput(
                "an import that has started is no longer a preview".into(),
            ));
        }
        Ok(record)
    }

    async fn revise_preview(
        &self,
        id: Uuid,
        expected_revision: u64,
        choice: Option<ImportChoice>,
        change: impl FnOnce(&mut [ImportItemRecord]) -> Result<(), LibraryError>,
    ) -> Result<ImportOperation, LibraryError> {
        let mut record = self.preview_record(id, expected_revision).await?;
        change(&mut record.items)?;
        if let Some(choice) = choice {
            record.choices.retain(|chosen| chosen.role != choice.role);
            record.choices.push(choice);
        }
        self.route(record.source_id, id, &record.choices, &mut record.items).await?;
        let record = self
            .catalog()
            .revise_import(id, expected_revision, &record.choices, &record.items)
            .await?;
        self.import_view(record).await
    }

    // ── Settle checks ────────────────────────────────────────────────────────

    /// List the source and run the settle checks: every file not proven
    /// unchanged by its recorded evidence is observed twice at least
    /// `settle_interval` apart, and reviewed only when both observations agree.
    async fn settle_source(
        &self,
        root: &Path,
        mut items: Vec<ImportItemRecord>,
        check: ImportCheck,
    ) -> Result<Vec<ImportItemRecord>, LibraryError> {
        let listing = root.to_path_buf();
        let listed = blocking(move || list_frames(&listing)).await?;
        let listed_paths: HashSet<NativePath> =
            listed.iter().map(|relative| NativePath::from_path(&root.join(relative))).collect();
        let known: HashSet<NativePath> =
            items.iter().map(|record| record.item.source_path.clone()).collect();
        for relative in &listed {
            let source_path = NativePath::from_path(&root.join(relative));
            if !known.contains(&source_path) {
                let seq = u32::try_from(items.len())
                    .map_err(|_| LibraryError::InvalidInput("too many source files".into()))?;
                items.push(new_record(seq, source_path, NativePath::from_path(relative)));
            }
        }
        let started = Instant::now();
        let mut second = Vec::new();
        for (index, record) in items.iter_mut().enumerate() {
            if !listed_paths.contains(&record.item.source_path) {
                forget_evidence(record);
                record.item.block = Some(ImportBlock::SourceMissing);
                continue;
            }
            if self.first_check(record, check).await? {
                second.push(index);
            }
        }
        if !second.is_empty() {
            tokio::time::sleep(check.settle_interval.saturating_sub(started.elapsed())).await;
        }
        for index in second {
            self.second_check(&mut items[index]).await?;
        }
        Ok(items)
    }

    /// Returns whether the file needs a second check in this call.
    async fn first_check(
        &self,
        record: &mut ImportItemRecord,
        check: ImportCheck,
    ) -> Result<bool, LibraryError> {
        let Some(observed) = probe(record).await? else { return Ok(false) };
        record.item.size_bytes = observed.size_bytes;
        let proven = record
            .evidence
            .as_ref()
            .is_some_and(|evidence| same_observation(&evidence.fingerprint, &observed));
        if proven && record.metadata.is_some() {
            record.item.block = None;
            return Ok(false);
        }
        forget_evidence(record);
        let interval = i64::try_from(check.settle_interval.as_millis()).unwrap_or(i64::MAX);
        let held = record
            .observation
            .as_ref()
            .filter(|previous| same_observation(&previous.fingerprint, &observed))
            .map(|previous| previous.checked_at_ms);
        match held {
            Some(since) if now_ms().saturating_sub(since) >= interval => {
                self.capture(record).await?;
                Ok(false)
            }
            Some(_) => Ok(true),
            None => {
                record.observation =
                    Some(SettleObservation { fingerprint: observed, checked_at_ms: now_ms() });
                Ok(true)
            }
        }
    }

    async fn second_check(&self, record: &mut ImportItemRecord) -> Result<(), LibraryError> {
        let Some(observed) = probe(record).await? else { return Ok(()) };
        let held = record
            .observation
            .as_ref()
            .is_some_and(|previous| same_observation(&previous.fingerprint, &observed));
        if held {
            self.capture(record).await
        } else {
            record.observation =
                Some(SettleObservation { fingerprint: observed, checked_at_ms: now_ms() });
            Ok(())
        }
    }

    /// Review a settled file (fingerprint and SHA-256 through custody) and
    /// read its header; any change while it was read leaves it settling.
    async fn capture(&self, record: &mut ImportItemRecord) -> Result<(), LibraryError> {
        let evidence = match self.review_storage_entry(record.item.source_path.clone()).await {
            Ok(evidence) => evidence,
            Err(error) => {
                intake_failure(record, &error);
                return Ok(());
            }
        };
        if evidence.kind != EntryKind::File {
            record.item.block =
                Some(ImportBlock::Unreadable { detail: "not a regular file".into() });
            return Ok(());
        }
        let settled = record
            .observation
            .as_ref()
            .is_some_and(|previous| same_observation(&previous.fingerprint, &evidence.fingerprint));
        if !settled {
            record.observation = Some(SettleObservation {
                fingerprint: evidence.fingerprint,
                checked_at_ms: now_ms(),
            });
            return Ok(());
        }
        let path = record.item.source_path.to_path_buf()?;
        let header = blocking(move || {
            let header = read_header(&path);
            Ok((header, inventory::probe_fingerprint(&path)))
        })
        .await?;
        let (header, after) = header;
        match after {
            Ok(after) if same_observation(&after, &evidence.fingerprint) => {}
            Ok(after) => {
                record.observation =
                    Some(SettleObservation { fingerprint: after, checked_at_ms: now_ms() });
                return Ok(());
            }
            Err(error) => {
                intake_failure(record, &error);
                return Ok(());
            }
        }
        let metadata = match header {
            Ok(metadata) => metadata,
            Err(detail) => {
                record.item.block = Some(ImportBlock::Unreadable { detail });
                return Ok(());
            }
        };
        record.item.size_bytes = evidence.fingerprint.size_bytes;
        record.item.sha256.clone_from(&evidence.sha256);
        record.item.image_type.clone_from(&metadata.image_type);
        record.item.classification = classify(&metadata, &record.item.relative_path);
        record.item.block = None;
        record.evidence = Some(evidence);
        record.metadata = Some(metadata);
        Ok(())
    }

    // ── Routing ──────────────────────────────────────────────────────────────

    /// Route every preview item from its recorded evidence: holds, duplicates,
    /// destination location and templated path, collisions, and the light's
    /// confirmed rig with any unknown FILTER value.
    async fn route(
        &self,
        source_id: Option<Uuid>,
        operation_id: Uuid,
        choices: &[ImportChoice],
        items: &mut [ImportItemRecord],
    ) -> Result<(), LibraryError> {
        let locations = self.active_locations().await?;
        let mut context = RouteContext {
            writable: destination_writability(&locations).await?,
            locations,
            imported: match source_id {
                Some(source) => self.catalog().imported_from_source(source, operation_id).await?,
                None => HashMap::new(),
            },
            choices,
            first_copy: HashMap::new(),
            claimed: HashMap::new(),
            rigs: HashMap::new(),
        };
        for record in items.iter_mut() {
            self.route_item(record, &mut context).await?;
        }
        Ok(())
    }

    async fn route_item(
        &self,
        record: &mut ImportItemRecord,
        context: &mut RouteContext<'_>,
    ) -> Result<(), LibraryError> {
        clear_route(&mut record.item);
        record.item.phase = if record.item.excluded {
            ImportItemPhase::Excluded
        } else if record.item.block.is_some() {
            ImportItemPhase::Blocked
        } else {
            ImportItemPhase::Settling
        };
        if record.item.phase != ImportItemPhase::Settling {
            return Ok(());
        }
        let (Some(evidence), Some(metadata)) = (&record.evidence, &record.metadata) else {
            return Ok(());
        };
        let Some(sha256) = evidence.sha256.clone() else { return Ok(()) };
        let size_bytes = evidence.fingerprint.size_bytes;
        if let Some(hold) = self.existing_copy(&record.item, &sha256, metadata, context).await? {
            hold.apply(&mut record.item);
            return Ok(());
        }
        let Some(frame_type) = record.item.frame_type() else {
            record.item.phase = ImportItemPhase::Unclassified;
            return Ok(());
        };
        if frame_type == NamingFrameType::Light {
            let (rig, unknown) = self.light_rig(metadata, &mut context.rigs).await?;
            record.item.rig = rig;
            record.item.unknown_filter = unknown;
        }
        let metadata = metadata.clone();
        match self
            .place(&mut record.item, frame_type, &metadata, size_bytes, &sha256, context)
            .await?
        {
            Some(hold) => hold.apply(&mut record.item),
            None => record.item.phase = ImportItemPhase::Ready,
        }
        Ok(())
    }

    /// A copy of these bytes the library or this import already has: a frame
    /// imported from the saved source, a library frame, or an earlier file.
    async fn existing_copy(
        &self,
        item: &ImportItem,
        sha256: &str,
        metadata: &CaptureMetadata,
        context: &mut RouteContext<'_>,
    ) -> Result<Option<Hold>, LibraryError> {
        if let Some(operation_id) = context.imported.get(sha256) {
            return Ok(Some(Hold::Duplicate(ImportDuplicate::SameSource {
                operation_id: *operation_id,
            })));
        }
        match self.indexed_copy(sha256, item.size_bytes, metadata).await? {
            IndexedCopy::Found(asset_id) => {
                return Ok(Some(Hold::Duplicate(ImportDuplicate::IndexedFrame { asset_id })));
            }
            IndexedCopy::Unproven(asset_id, detail) => {
                return Ok(Some(Hold::Block(ImportBlock::DuplicateUnproven { asset_id, detail })));
            }
            IndexedCopy::None => {}
        }
        if let Some((seq, source_path)) = context.first_copy.get(sha256) {
            let duplicate =
                ImportDuplicate::SameImport { seq: *seq, source_path: source_path.clone() };
            return Ok(Some(Hold::Duplicate(duplicate)));
        }
        context.first_copy.insert(sha256.to_owned(), (item.seq, item.source_path.clone()));
        Ok(None)
    }

    /// Route a typed item to its role's location and templated path, held
    /// when the location is missing, unchosen or unwritable, the template
    /// refuses it, or its destination is taken.
    async fn place(
        &self,
        item: &mut ImportItem,
        frame_type: NamingFrameType,
        metadata: &CaptureMetadata,
        size_bytes: u64,
        sha256: &str,
        context: &mut RouteContext<'_>,
    ) -> Result<Option<Hold>, LibraryError> {
        let role = role_of(frame_type);
        item.role = Some(role);
        let location = match chosen_location(&context.locations, context.choices, role) {
            Ok(location) => location.clone(),
            Err(block) => return Ok(Some(Hold::Block(block))),
        };
        item.destination_location_id = Some(location.id);
        if let Some(Writability::NotWritable { detail }) = context.writable.get(&location.id) {
            let detail = detail.clone();
            let block = ImportBlock::DestinationUnwritable { location_id: location.id, detail };
            return Ok(Some(Hold::Block(block)));
        }
        let resolution =
            match self.resolve_naming(frame_type, &naming_metadata(metadata, frame_type)).await {
                Ok(resolution) => resolution,
                Err(LibraryError::InvalidInput(detail)) => {
                    return Ok(Some(Hold::Block(ImportBlock::Naming { detail })));
                }
                Err(error) => return Err(error),
            };
        let source = item.source_path.to_path_buf()?;
        let name = source.file_name().ok_or_else(|| {
            LibraryError::InvalidInput(format!("{} names no file", source.display()))
        })?;
        let mut relative = PathBuf::new();
        for segment in resolution.relative_path.split('/').filter(|part| !part.is_empty()) {
            relative.push(segment);
        }
        relative.push(name);
        item.destination_path = Some(NativePath::from_path(&relative));
        item.fallbacks = resolution.fallbacks;
        let destination = location.path.to_path_buf()?.join(&relative);
        if let Some(seq) = context.claimed.get(&destination) {
            return Ok(Some(Hold::Block(ImportBlock::CollidesWithItem { seq: *seq })));
        }
        let (probe_path, digest) = (destination.clone(), sha256.to_owned());
        let path = NativePath::from_path(&destination);
        match blocking(move || Ok(occupant(&probe_path, size_bytes, &digest))).await? {
            Occupant::Vacant => {
                context.claimed.insert(destination, item.seq);
                Ok(None)
            }
            Occupant::Same => Ok(Some(Hold::Duplicate(ImportDuplicate::AtDestination { path }))),
            Occupant::Different => Ok(Some(Hold::Block(ImportBlock::Collision { path }))),
        }
    }

    /// Whether a library frame holds these bytes. A recorded digest decides;
    /// an unhashed frame of the same size and DATE-OBS is hashed (and its
    /// digest bound) to prove it either way.
    async fn indexed_copy(
        &self,
        sha256: &str,
        size_bytes: u64,
        metadata: &CaptureMetadata,
    ) -> Result<IndexedCopy, LibraryError> {
        let candidates = self
            .catalog()
            .content_candidates(sha256, size_bytes, metadata.date_obs.as_deref())
            .await?;
        let mut unproven = None;
        for (asset_id, digest) in candidates {
            match digest {
                Some(digest) if digest == sha256 => return Ok(IndexedCopy::Found(asset_id)),
                Some(_) => {}
                None => match self.catalog().verify_digest(asset_id, InventoryProbe).await {
                    Ok(evidence) if evidence.sha256 == sha256 => {
                        return Ok(IndexedCopy::Found(asset_id));
                    }
                    Ok(_) => {}
                    Err(error) => {
                        unproven = unproven.or_else(|| Some((asset_id, error.to_string())));
                    }
                },
            }
        }
        Ok(unproven.map_or(IndexedCopy::None, |(asset_id, detail)| {
            IndexedCopy::Unproven(asset_id, detail)
        }))
    }

    /// The light's confirmed rig, when its camera and telescope name exactly
    /// one, and its FILTER value when no filter on that rig matches it.
    async fn light_rig(
        &self,
        metadata: &CaptureMetadata,
        rigs: &mut HashMap<(String, Option<String>), Option<(ImportRig, RigFilters)>>,
    ) -> Result<(Option<ImportRig>, Option<UnknownFilter>), LibraryError> {
        let Some(camera) = trimmed(metadata.camera.as_deref()) else { return Ok((None, None)) };
        let key = (camera, trimmed(metadata.telescope.as_deref()));
        if !rigs.contains_key(&key) {
            let confirmed = self.catalog().confirmed_rigs_for(&key.0, key.1.as_deref()).await?;
            let rig = match confirmed.as_slice() {
                [(equipment_id, name)] => {
                    let filters = self.catalog().rig_filters(*equipment_id).await?;
                    Some((ImportRig { equipment_id: *equipment_id, name: name.clone() }, filters))
                }
                _ => None,
            };
            rigs.insert(key.clone(), rig);
        }
        let Some((rig, filters)) = rigs.get(&key).cloned().flatten() else {
            return Ok((None, None));
        };
        let unknown = trimmed(metadata.filter.as_deref())
            .filter(|value| !filters.filters.iter().any(|filter| filter.matches(value)))
            .map(|value| UnknownFilter {
                equipment_id: rig.equipment_id,
                rig_name: rig.name.clone(),
                value,
            });
        Ok((Some(rig), unknown))
    }

    async fn active_locations(&self) -> Result<Vec<Location>, LibraryError> {
        let mut locations = self.catalog().list_locations().await?;
        locations.retain(|location| {
            location.lifecycle == LocationLifecycle::Active
                && location.role != LocationRole::Results
        });
        Ok(locations)
    }

    // ── Execution ────────────────────────────────────────────────────────────

    async fn roots(&self, record: &ImportRecord) -> Result<Roots, LibraryError> {
        let mut destinations = HashMap::new();
        for item in &record.items {
            if let Some(location_id) = item.item.destination_location_id {
                if let std::collections::hash_map::Entry::Vacant(entry) =
                    destinations.entry(location_id)
                {
                    let location = self.catalog().location(location_id).await?;
                    entry.insert(location.path);
                }
            }
        }
        Ok(Roots { source: record.source_path.to_path_buf()?, destinations })
    }

    async fn interrupt(self: &Arc<Self>, id: Uuid) -> Result<ImportOperation, LibraryError> {
        let record = self.catalog().import_record(id).await?;
        let roots = self.roots(&record).await?;
        self.index_landed(id, &roots).await?;
        let record = self.catalog().set_import_state(id, ImportState::Interrupted).await?;
        self.import_view(record).await
    }

    async fn queue(
        &self,
        id: Uuid,
        kind: StorageOperationKind,
        items: &[&ImportItemRecord],
        drafts: &[StorageItemDraft],
    ) -> Result<(), LibraryError> {
        let operation = self.catalog().record_storage_operation(kind, drafts).await?;
        let attached = items
            .iter()
            .zip(&operation.items)
            .map(|(record, storage)| ImportItemRecord {
                storage: Some(StorageRef { operation_id: operation.id, seq: storage.seq }),
                ..(*record).clone()
            })
            .collect::<Vec<_>>();
        self.catalog().record_import_progress(id, &attached).await?;
        Ok(())
    }

    /// Move items whose destination verified but whose source could not yet
    /// go to the OS Trash: each source relies on its verified copy, which is
    /// re-verified (D19) together with the source before the move.
    async fn queue_retirements(
        &self,
        id: Uuid,
        items: &[&ImportItemRecord],
        roots: &Roots,
    ) -> Result<(), LibraryError> {
        let mut queued = Vec::new();
        let mut drafts = Vec::new();
        let mut kept = Vec::new();
        for record in items {
            let destination = roots.destination_of(&record.item)?;
            let probe_path = destination.clone();
            let observed =
                blocking(move || Ok(inventory::probe_fingerprint(&probe_path).ok())).await?;
            let copy = match (observed, &record.written, &record.item.sha256) {
                (Some(fingerprint), Some(written), Some(sha256))
                    if same_identity(&fingerprint.identity, written) =>
                {
                    KeptCopy {
                        path: NativePath::from_path(&destination),
                        fingerprint,
                        sha256: sha256.clone(),
                    }
                }
                _ => {
                    let mut next = (*record).clone();
                    next.item.phase = ImportItemPhase::SourceKept;
                    next.item.reason = Some(ItemReason::new(
                        ReasonCode::KeptCopyUnproven,
                        format!(
                            "{} no longer holds the verified copy; the source stays in place",
                            destination.display()
                        ),
                    ));
                    kept.push(next);
                    continue;
                }
            };
            let source = record.evidence.clone().ok_or_else(|| missing_evidence(&record.item))?;
            drafts.push(StorageItemDraft { source, relied_on: vec![copy], destination: None });
            queued.push(*record);
        }
        if !kept.is_empty() {
            self.catalog().record_import_progress(id, &kept).await?;
        }
        if !drafts.is_empty() {
            self.queue(id, StorageOperationKind::Trash, &queued, &drafts).await?;
        }
        Ok(())
    }

    /// Index every landed, unindexed copy: one scan per destination folder,
    /// then each copy counts as indexed once the catalog holds a frame at its
    /// path with the identity the transfer wrote. A frame type the user set is
    /// recorded as the frame's IMAGETYP correction.
    async fn index_landed(self: &Arc<Self>, id: Uuid, roots: &Roots) -> Result<(), LibraryError> {
        let record = self.catalog().import_record(id).await?;
        let landed: Vec<&ImportItemRecord> =
            record.items.iter().filter(|item| item.item.landed && !item.item.indexed).collect();
        let mut scopes: Vec<(Uuid, PathBuf)> = Vec::new();
        for record in &landed {
            let (Some(location_id), Some(path)) =
                (record.item.destination_location_id, &record.item.destination_path)
            else {
                continue;
            };
            let folder = path.relative_path()?.parent().map(Path::to_path_buf).unwrap_or_default();
            if !scopes.contains(&(location_id, folder.clone())) {
                scopes.push((location_id, folder));
            }
        }
        for (location_id, folder) in scopes {
            if roots.destination_online(location_id).await? {
                self.scan_scope(location_id, &folder).await?;
            }
        }
        let mut indexed = Vec::new();
        for record in landed {
            let (Some(location_id), Some(path), Some(written)) = (
                record.item.destination_location_id,
                &record.item.destination_path,
                &record.written,
            ) else {
                continue;
            };
            let Some((asset_id, identity)) =
                self.catalog().live_asset_at(location_id, path).await?
            else {
                continue;
            };
            if !same_identity(&identity, written) {
                continue;
            }
            if let Some(frame_type) =
                record.item.user_type.filter(|typed| Some(*typed) != record.item.classification)
            {
                self.record_frame_type(asset_id, frame_type).await?;
            }
            let mut next = record.clone();
            next.item.indexed = true;
            indexed.push(next);
        }
        if !indexed.is_empty() {
            self.catalog().record_import_progress(id, &indexed).await?;
        }
        Ok(())
    }

    /// Record the type the user gave an untyped frame as its IMAGETYP
    /// correction; the header bytes are untouched.
    async fn record_frame_type(
        &self,
        asset_id: Uuid,
        frame_type: NamingFrameType,
    ) -> Result<(), LibraryError> {
        let asset = self.catalog().asset(asset_id).await?;
        let expected = [ExpectedAsset {
            asset_id,
            decision_revision: asset.decision_revision,
            fingerprint: asset.fingerprint,
        }];
        let corrections = [CorrectionInput {
            asset_id,
            field: "imageType".into(),
            value: serde_json::Value::String(image_type_text(frame_type).into()),
        }];
        let preview =
            self.catalog().preview_correction(&expected, &corrections, group_assets).await?;
        self.confirm_correction(preview.id, &expected).await?;
        Ok(())
    }

    /// Scan one destination folder and wait for the scan to end. A scan
    /// already running on the location is waited for first.
    async fn scan_scope(
        self: &Arc<Self>,
        location_id: Uuid,
        folder: &Path,
    ) -> Result<ScanOperation, LibraryError> {
        for _ in 0..SCAN_ATTEMPTS {
            let mut progress = self.subscribe_scan_progress();
            let running = self
                .catalog()
                .list_operations(Some(location_id), 0, 1)
                .await?
                .into_iter()
                .find(|operation| operation.state == ScanState::Running);
            if let Some(running) = running {
                self.scan_finished(&mut progress, running.id).await?;
                continue;
            }
            let started = if folder.as_os_str().is_empty() {
                self.start_scan(location_id, None).await
            } else {
                self.retry_scope(location_id, NativePath::from_path(folder)).await
            };
            match started {
                Ok(operation) => return self.scan_finished(&mut progress, operation.id).await,
                // Another scan began between the check and this one.
                Err(LibraryError::InvalidInput(_)) => {}
                Err(error) => return Err(error),
            }
        }
        Err(LibraryError::SourceUnavailable(format!(
            "location {location_id} kept scanning; the landed copies are indexed on Retry"
        )))
    }

    async fn scan_finished(
        &self,
        progress: &mut tokio::sync::broadcast::Receiver<ScanOperation>,
        id: Uuid,
    ) -> Result<ScanOperation, LibraryError> {
        let current = self.catalog().scan_status(id).await?;
        if current.state != ScanState::Running {
            return Ok(current);
        }
        loop {
            match progress.recv().await {
                Ok(operation) if operation.id == id && operation.state != ScanState::Running => {
                    return Ok(operation);
                }
                Ok(_) => {}
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    let current = self.catalog().scan_status(id).await?;
                    if current.state != ScanState::Running {
                        return Ok(current);
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    return Err(LibraryError::SourceUnavailable(
                        "scan progress closed before the scan ended".into(),
                    ));
                }
            }
        }
    }

    // ── View ─────────────────────────────────────────────────────────────────

    async fn import_view(&self, record: ImportRecord) -> Result<ImportOperation, LibraryError> {
        let locations = self.active_locations().await?;
        let source = record.source_path.to_path_buf();
        let probes = locations
            .iter()
            .map(|location| (location.id, location.path.to_path_buf()))
            .collect::<Vec<_>>();
        let (source_availability, volumes) = blocking(move || {
            let availability =
                source.map_or(Availability::Unreadable, |root| folder_availability(&root));
            let volumes = probes
                .into_iter()
                .map(|(id, root)| match root {
                    Ok(root) => (id, fs4::available_space(&root).ok(), writability(&root)),
                    Err(error) => {
                        (id, None, Writability::NotWritable { detail: error.to_string() })
                    }
                })
                .collect::<Vec<_>>();
            Ok((availability, volumes))
        })
        .await?;
        let items: Vec<ImportItem> = record.items.into_iter().map(|record| record.item).collect();
        let destinations = locations
            .iter()
            .zip(volumes)
            .map(|(location, (_, free_bytes, writability))| {
                let routed = items.iter().filter(|item| {
                    item.destination_location_id == Some(location.id) && counts_toward(item.phase)
                });
                let (count, bytes) = routed.fold((0_u64, 0_u64), |(count, bytes), item| {
                    (count + 1, bytes + item.size_bytes)
                });
                ImportDestination {
                    role: location.role,
                    location_id: location.id,
                    name: location.name.clone(),
                    path: location.path.clone(),
                    chosen: chosen_location(&locations, &record.choices, location.role)
                        .is_ok_and(|chosen| chosen.id == location.id),
                    items: count,
                    bytes,
                    free_bytes,
                    writability,
                }
            })
            .collect();
        Ok(ImportOperation {
            id: record.id,
            source_id: record.source_id,
            source_path: record.source_path,
            source_availability,
            mode: record.mode,
            state: record.state,
            revision: record.revision,
            summary: summarize(&items),
            items,
            destinations,
            created_at: record.created_at,
            updated_at: record.updated_at,
            settled_at: record.settled_at,
        })
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// The roots an import reads from and writes to.
struct Roots {
    source: PathBuf,
    destinations: HashMap<Uuid, NativePath>,
}

impl Roots {
    fn destination_of(&self, item: &ImportItem) -> Result<PathBuf, LibraryError> {
        let (Some(location_id), Some(path)) =
            (item.destination_location_id, &item.destination_path)
        else {
            return Err(LibraryError::PersistenceFailure(format!(
                "import item {} has no destination",
                item.seq
            )));
        };
        let root = self.destinations.get(&location_id).ok_or_else(|| {
            LibraryError::PersistenceFailure(format!("location {location_id} is not loaded"))
        })?;
        Ok(root.to_path_buf()?.join(path.relative_path()?))
    }

    fn destination_root(&self, location_id: Uuid) -> Result<PathBuf, LibraryError> {
        self.destinations
            .get(&location_id)
            .ok_or_else(|| {
                LibraryError::PersistenceFailure(format!("location {location_id} is not loaded"))
            })?
            .to_path_buf()
    }

    async fn destination_online(&self, location_id: Uuid) -> Result<bool, LibraryError> {
        let root = self.destination_root(location_id)?;
        blocking(move || Ok(folder_availability(&root) == Availability::Available)).await
    }

    /// The source folder and the destination of every unsettled approved
    /// item are mounted.
    async fn online(&self, record: &ImportRecord) -> Result<bool, LibraryError> {
        let mut folders = vec![self.source.clone()];
        for item in &record.items {
            if matches!(item.item.phase, ImportItemPhase::Pending | ImportItemPhase::Landed) {
                if let Some(location_id) = item.item.destination_location_id {
                    let root = self.destination_root(location_id)?;
                    if !folders.contains(&root) {
                        folders.push(root);
                    }
                }
            }
        }
        blocking(move || {
            Ok(folders.iter().all(|folder| folder_availability(folder) == Availability::Available))
        })
        .await
    }
}

/// What one execution step left to do.
enum Advance {
    Continue,
    /// The source or a destination is offline: interrupt, keeping state.
    Offline,
    /// Every approved item has an outcome.
    Done,
}

enum IndexedCopy {
    None,
    Found(Uuid),
    Unproven(Uuid, String),
}

enum Occupant {
    Vacant,
    Same,
    Different,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| i64::try_from(since.as_millis()).unwrap_or(i64::MAX))
}

fn same_observation(left: &ObservationFingerprint, right: &ObservationFingerprint) -> bool {
    left.identity == right.identity
        && left.size_bytes == right.size_bytes
        && left.modified_ns == right.modified_ns
}

/// Same volume, and the same file ID where the volume's IDs are stable.
fn same_identity(observed: &FileIdentity, recorded: &FileIdentity) -> bool {
    observed.volume == recorded.volume
        && (!recorded.volume.file_ids_stable || observed.file_id == recorded.file_id)
}

fn trimmed(value: Option<&str>) -> Option<String> {
    value.map(str::trim).filter(|value| !value.is_empty()).map(str::to_owned)
}

fn new_record(seq: u32, source_path: NativePath, relative_path: NativePath) -> ImportItemRecord {
    ImportItemRecord {
        item: ImportItem {
            seq,
            source_path,
            relative_path,
            size_bytes: 0,
            sha256: None,
            image_type: None,
            classification: None,
            user_type: None,
            excluded: false,
            role: None,
            destination_location_id: None,
            destination_path: None,
            fallbacks: Vec::new(),
            rig: None,
            unknown_filter: None,
            phase: ImportItemPhase::Settling,
            duplicate: None,
            block: None,
            reason: None,
            landed: false,
            indexed: false,
        },
        observation: None,
        evidence: None,
        metadata: None,
        storage: None,
        written: None,
    }
}

/// Drop what a file's earlier review established; it settles again.
fn forget_evidence(record: &mut ImportItemRecord) {
    record.evidence = None;
    record.metadata = None;
    record.item.sha256 = None;
    record.item.image_type = None;
    record.item.classification = None;
    record.item.block = None;
}

fn intake_failure(record: &mut ImportItemRecord, error: &LibraryError) {
    forget_evidence(record);
    let mut inner = error;
    while let LibraryError::Context { error, .. } = inner {
        inner = error;
    }
    record.item.block = Some(match inner {
        LibraryError::NotFound(_) => ImportBlock::SourceMissing,
        // Changed while it was read: it settles again.
        LibraryError::IdentityConflict(_) => {
            record.observation = None;
            return;
        }
        other => ImportBlock::Unreadable { detail: other.to_string() },
    });
}

/// Observe a listed file; a failure is recorded on the item.
async fn probe(
    record: &mut ImportItemRecord,
) -> Result<Option<ObservationFingerprint>, LibraryError> {
    let path = record.item.source_path.to_path_buf()?;
    let probed = blocking(move || Ok(inventory::probe_fingerprint(&path))).await?;
    match probed {
        Ok(observed) => {
            record.item.block = None;
            Ok(Some(observed))
        }
        Err(error) => {
            intake_failure(record, &error);
            Ok(None)
        }
    }
}

fn preview_item(
    items: &mut [ImportItemRecord],
    id: Uuid,
    seq: u32,
) -> Result<&mut ImportItemRecord, LibraryError> {
    items
        .iter_mut()
        .find(|record| record.item.seq == seq)
        .ok_or_else(|| LibraryError::NotFound(format!("import {id} item {seq}")))
}

fn clear_route(item: &mut ImportItem) {
    item.role = None;
    item.destination_location_id = None;
    item.destination_path = None;
    item.fallbacks = Vec::new();
    item.rig = None;
    item.unknown_filter = None;
    item.duplicate = None;
    if !matches!(item.block, Some(ImportBlock::SourceMissing | ImportBlock::Unreadable { .. })) {
        item.block = None;
    }
}

/// Why a routed item is not Ready.
enum Hold {
    Duplicate(ImportDuplicate),
    Block(ImportBlock),
}

impl Hold {
    fn apply(self, item: &mut ImportItem) {
        match self {
            Self::Duplicate(duplicate) => {
                item.duplicate = Some(duplicate);
                item.phase = ImportItemPhase::Duplicate;
            }
            Self::Block(block) => {
                item.block = Some(block);
                item.phase = ImportItemPhase::Blocked;
            }
        }
    }
}

/// What routing one preview reads once and accumulates item by item.
struct RouteContext<'a> {
    locations: Vec<Location>,
    writable: HashMap<Uuid, Writability>,
    imported: HashMap<String, Uuid>,
    choices: &'a [ImportChoice],
    /// The first item of each SHA-256 in this import.
    first_copy: HashMap<String, (u32, NativePath)>,
    /// Destinations claimed by earlier items of this import.
    claimed: HashMap<PathBuf, u32>,
    rigs: HashMap<(String, Option<String>), Option<(ImportRig, RigFilters)>>,
}

const fn role_of(frame_type: NamingFrameType) -> LocationRole {
    match frame_type {
        NamingFrameType::Light => LocationRole::Captures,
        _ => LocationRole::Calibration,
    }
}

/// The location a role's items go to: the user's choice, else the only one.
fn chosen_location<'a>(
    locations: &'a [Location],
    choices: &[ImportChoice],
    role: LocationRole,
) -> Result<&'a Location, ImportBlock> {
    let mut of_role = locations.iter().filter(|location| location.role == role);
    if let Some(choice) = choices.iter().find(|choice| choice.role == role) {
        if let Some(location) = of_role.clone().find(|location| location.id == choice.location_id) {
            return Ok(location);
        }
    }
    match (of_role.next(), of_role.next()) {
        (None, _) => Err(ImportBlock::MissingRole { role }),
        (Some(only), None) => Ok(only),
        (Some(_), Some(_)) => Err(ImportBlock::LocationNotChosen { role }),
    }
}

async fn destination_writability(
    locations: &[Location],
) -> Result<HashMap<Uuid, Writability>, LibraryError> {
    let roots = locations
        .iter()
        .map(|location| (location.id, location.path.to_path_buf()))
        .collect::<Vec<_>>();
    blocking(move || {
        Ok(roots
            .into_iter()
            .map(|(id, root)| {
                let state = match root {
                    Ok(root) => writability(&root),
                    Err(error) => Writability::NotWritable { detail: error.to_string() },
                };
                (id, state)
            })
            .collect())
    })
    .await
}

/// The header frame type: a calibration frame or master by the calibration
/// rules (IMAGETYP, stack count, then a labelled name inference), else a
/// single light by IMAGETYP. Anything else is Unclassified.
fn classify(metadata: &CaptureMetadata, relative_path: &NativePath) -> Option<NamingFrameType> {
    if let Some(found) = Rules.classify(metadata, relative_path) {
        let master = found.master.is_some();
        return Some(match (found.kind, master) {
            (InputKind::Bias, false) => NamingFrameType::Bias,
            (InputKind::Dark, false) => NamingFrameType::Dark,
            (InputKind::Flat, false) => NamingFrameType::Flat,
            (InputKind::Bias, true) => NamingFrameType::MasterBias,
            (InputKind::Dark, true) => NamingFrameType::MasterDark,
            (InputKind::Flat, true) => NamingFrameType::MasterFlat,
        });
    }
    let single = metadata.stack_count.is_none_or(|count| count <= 1);
    (matches!(metadata.image_type_evidence(), ImageTypeEvidence::Known(FrameType::Light)) && single)
        .then_some(NamingFrameType::Light)
}

/// The IMAGETYP text a user-set frame type is recorded as.
const fn image_type_text(frame_type: NamingFrameType) -> &'static str {
    match frame_type {
        NamingFrameType::Light => "Light",
        NamingFrameType::Flat => "Flat",
        NamingFrameType::Dark => "Dark",
        NamingFrameType::Bias => "Bias",
        NamingFrameType::MasterFlat => "Master Flat",
        NamingFrameType::MasterDark => "Master Dark",
        NamingFrameType::MasterBias => "Master Bias",
    }
}

/// What the nine naming tokens resolve from; absent values take fallbacks.
fn naming_metadata(metadata: &CaptureMetadata, frame_type: NamingFrameType) -> NamingMetadata {
    let number = |value: Option<f64>| {
        value.filter(|value| value.is_finite()).map(|value| (value + 0.0).to_string())
    };
    NamingMetadata {
        target: trimmed(metadata.object.as_deref()),
        filter: trimmed(metadata.filter.as_deref()),
        date: observing_night(metadata).map(|night| night.to_string()),
        frame_type: Some(frame_type.as_str().to_owned()),
        camera: trimmed(metadata.camera.as_deref()),
        exposure: number(metadata.exposure_seconds),
        gain: number(metadata.gain),
        binning: match (metadata.binning_x, metadata.binning_y) {
            (Some(x), Some(y)) => Some(format!("{x}x{y}")),
            _ => None,
        },
        set_temp: number(metadata.set_temperature_c),
    }
}

fn is_link(metadata: &fs::Metadata) -> bool {
    fs_pathsafe::is_link_or_junction_metadata(metadata)
}

/// Whether a source or location folder is mounted and readable.
fn folder_availability(root: &Path) -> Availability {
    match fs::symlink_metadata(root) {
        Ok(metadata) if metadata.is_dir() && !is_link(&metadata) => Availability::Available,
        Ok(_) => Availability::Unreadable,
        Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
            Availability::Unreadable
        }
        Err(_) => Availability::Offline,
    }
}

async fn online_root(path: &NativePath) -> Result<PathBuf, LibraryError> {
    let root = path.to_path_buf()?;
    if !root.is_absolute() {
        return Err(LibraryError::InvalidInput("an import source path is absolute".into()));
    }
    let probe = root.clone();
    match blocking(move || Ok(folder_availability(&probe))).await? {
        Availability::Available => Ok(root),
        availability => Err(LibraryError::Context {
            error: Box::new(LibraryError::SourceUnavailable(format!(
                "the import source is {availability:?}; PlateVault mounts nothing"
            ))),
            scope: path.clone(),
            identity: None,
        }),
    }
}

/// Whether a folder can take new files, checked without writing anything.
fn writability(root: &Path) -> Writability {
    match fs::symlink_metadata(root) {
        Ok(metadata) if metadata.is_dir() && !is_link(&metadata) => platform_writability(root),
        Ok(_) => {
            Writability::NotWritable { detail: format!("{} is not a real folder", root.display()) }
        }
        Err(error) => Writability::NotWritable { detail: format!("{}: {error}", root.display()) },
    }
}

#[cfg(unix)]
fn platform_writability(root: &Path) -> Writability {
    match rustix::fs::access(root, rustix::fs::Access::WRITE_OK) {
        Ok(()) => Writability::Writable,
        Err(error) => Writability::NotWritable { detail: format!("{}: {error}", root.display()) },
    }
}

#[cfg(not(unix))]
fn platform_writability(root: &Path) -> Writability {
    Writability::Unknown {
        detail: format!(
            "{} cannot be proven writable without writing to it on this platform",
            root.display()
        ),
    }
}

/// Every FITS/XISF frame below `root`, relative and sorted. Links are not
/// followed and dot-files (such as macOS `._` companion files) are skipped.
fn list_frames(root: &Path) -> Result<Vec<PathBuf>, LibraryError> {
    let mut frames = Vec::new();
    let mut folders = vec![PathBuf::new()];
    while let Some(relative) = folders.pop() {
        let folder = root.join(&relative);
        let entries =
            fs::read_dir(&folder).map_err(|error| LibraryError::from_io(&folder, &error))?;
        for entry in entries {
            let entry = entry.map_err(|error| LibraryError::from_io(&folder, &error))?;
            let name = entry.file_name();
            if name.as_encoded_bytes().first() == Some(&b'.') {
                continue;
            }
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path)
                .map_err(|error| LibraryError::from_io(&path, &error))?;
            if is_link(&metadata) {
                continue;
            }
            if metadata.is_dir() {
                folders.push(relative.join(&name));
            } else if metadata.is_file() && extractor_for(&path).is_some() {
                frames.push(relative.join(&name));
            }
        }
    }
    frames.sort();
    Ok(frames)
}

fn extractor_for(path: &Path) -> Option<&'static dyn MetadataExtractor> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    if FitsExtractor.supports_extension(&extension) {
        Some(&FitsExtractor)
    } else if XisfExtractor.supports_extension(&extension) {
        Some(&XisfExtractor)
    } else {
        None
    }
}

fn read_header(path: &Path) -> Result<CaptureMetadata, String> {
    let extractor = extractor_for(path).ok_or_else(|| "not a FITS or XISF frame".to_owned())?;
    match extractor.extract(path) {
        Ok(Some(raw)) => Ok(CaptureMetadata::from(&raw)),
        Ok(None) => Err("metadata unreadable: the adapter declined the file".into()),
        Err(error) => Err(format!("header unreadable: {error}")),
    }
}

/// What a templated destination already holds, compared without following a
/// link: these exact bytes, different ones, or nothing.
fn occupant(path: &Path, size_bytes: u64, sha256: &str) -> Occupant {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Occupant::Vacant,
        Ok(metadata) if metadata.is_file() && !is_link(&metadata) => {
            if metadata.len() == size_bytes
                && sha256_of(path).is_some_and(|digest| digest == sha256)
            {
                Occupant::Same
            } else {
                Occupant::Different
            }
        }
        _ => Occupant::Different,
    }
}

fn sha256_of(path: &Path) -> Option<String> {
    let mut file = fs::File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0; HASH_BUFFER];
    loop {
        let read = file.read(&mut buffer).ok()?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Some(hex::encode(hasher.finalize()))
}

fn missing_evidence(item: &ImportItem) -> LibraryError {
    LibraryError::PersistenceFailure(format!(
        "approved import item {} has no reviewed evidence",
        item.seq
    ))
}

fn transfer_draft(
    record: &ImportItemRecord,
    roots: &Roots,
) -> Result<StorageItemDraft, LibraryError> {
    let source = record.evidence.clone().ok_or_else(|| missing_evidence(&record.item))?;
    let (Some(location_id), Some(relative)) =
        (record.item.destination_location_id, record.item.destination_path.clone())
    else {
        return Err(LibraryError::PersistenceFailure(format!(
            "approved import item {} has no destination",
            record.item.seq
        )));
    };
    let root = roots.destinations.get(&location_id).cloned().ok_or_else(|| {
        LibraryError::PersistenceFailure(format!("location {location_id} is not loaded"))
    })?;
    Ok(StorageItemDraft {
        source,
        relied_on: Vec::new(),
        destination: Some(TransferDestination { root, relative }),
    })
}

/// Import item changes the journal's recorded progress implies: a copy that
/// verified is landed, a settled item takes its outcome, and an item stopped
/// because its source or destination went offline stays pending for Retry.
fn journal_changes(
    record: &ImportRecord,
    operation: &StorageOperation,
    roots: &Roots,
    online: bool,
) -> Result<Vec<ImportItemRecord>, LibraryError> {
    let mut changes = Vec::new();
    for current in &record.items {
        let Some(storage) = current.storage.filter(|storage| storage.operation_id == operation.id)
        else {
            continue;
        };
        let journal =
            operation.items.iter().find(|item| item.seq == storage.seq).ok_or_else(|| {
                LibraryError::PersistenceFailure(format!(
                    "storage operation {} has no item {} for import item {}",
                    operation.id, storage.seq, current.item.seq
                ))
            })?;
        let next = settle_from_journal(current, journal, operation.kind, roots, online);
        if next.item != current.item
            || next.storage != current.storage
            || next.written != current.written
        {
            changes.push(next);
        }
    }
    Ok(changes)
}

fn settle_from_journal(
    current: &ImportItemRecord,
    journal: &StorageItem,
    kind: StorageOperationKind,
    roots: &Roots,
    online: bool,
) -> ImportItemRecord {
    let mut next = current.clone();
    let verified = matches!(journal.phase, ItemPhase::DestinationVerified | ItemPhase::Retiring);
    if verified
        || matches!(
            journal.outcome,
            Some(ItemOutcome::Copied | ItemOutcome::Moved | ItemOutcome::SourceKept)
        )
    {
        mark_landed(&mut next, journal);
    }
    let Some(outcome) = journal.outcome else { return next };
    next.storage = None;
    next.item.reason.clone_from(&journal.reason);
    let offline = !online
        || next
            .item
            .destination_location_id
            .and_then(|location_id| roots.destination_root(location_id).ok())
            .is_some_and(|root| folder_availability(&root) != Availability::Available);
    let stopped_by_unmount = outcome == ItemOutcome::Blocked
        && offline
        && journal.reason.as_ref().is_some_and(|reason| {
            matches!(
                reason.code,
                ReasonCode::SourceUnavailable
                    | ReasonCode::WriteFailed
                    | ReasonCode::DestinationChanged
            )
        });
    next.item.phase = match outcome {
        _ if stopped_by_unmount && next.item.landed => ImportItemPhase::Landed,
        _ if stopped_by_unmount => ImportItemPhase::Pending,
        ItemOutcome::Copied => ImportItemPhase::Copied,
        ItemOutcome::Moved | ItemOutcome::Trashed => ImportItemPhase::Moved,
        ItemOutcome::SourceKept => ImportItemPhase::SourceKept,
        ItemOutcome::Blocked if next.item.landed => ImportItemPhase::SourceKept,
        ItemOutcome::Blocked => ImportItemPhase::Failed,
        ItemOutcome::Uncertain => ImportItemPhase::Uncertain,
    };
    if kind == StorageOperationKind::Trash && outcome == ItemOutcome::Trashed {
        next.item.reason = None;
    }
    next
}

fn mark_landed(next: &mut ImportItemRecord, journal: &StorageItem) {
    next.item.landed = true;
    if next.written.is_none() {
        next.written = journal.written.as_ref().map(|written| written.identity.clone());
    }
}

/// Phases whose items occupy their destination's count and bytes.
const fn counts_toward(phase: ImportItemPhase) -> bool {
    matches!(
        phase,
        ImportItemPhase::Ready
            | ImportItemPhase::Pending
            | ImportItemPhase::Landed
            | ImportItemPhase::Copied
            | ImportItemPhase::Moved
            | ImportItemPhase::SourceKept
    )
}

fn summarize(items: &[ImportItem]) -> ImportSummary {
    let mut summary = ImportSummary::default();
    for item in items {
        if item.landed {
            summary.imported += 1;
        }
        let count = match item.phase {
            ImportItemPhase::Ready => &mut summary.ready,
            ImportItemPhase::Unclassified => &mut summary.unclassified,
            ImportItemPhase::Settling => &mut summary.settling,
            ImportItemPhase::Duplicate => &mut summary.duplicates,
            ImportItemPhase::Blocked => &mut summary.blocked,
            ImportItemPhase::Excluded => &mut summary.excluded,
            ImportItemPhase::Pending | ImportItemPhase::Landed => &mut summary.pending,
            ImportItemPhase::Moved => &mut summary.sources_trashed,
            ImportItemPhase::SourceKept => &mut summary.sources_kept,
            ImportItemPhase::Failed => &mut summary.failed,
            ImportItemPhase::Uncertain => &mut summary.uncertain,
            ImportItemPhase::Copied => continue,
        };
        *count += 1;
        let verification = item.reason.as_ref().is_some_and(|reason| {
            matches!(
                reason.code,
                ReasonCode::DestinationMismatch
                    | ReasonCode::DestinationChanged
                    | ReasonCode::SourceDrift
                    | ReasonCode::KeptCopyUnproven
            )
        });
        if verification
            && matches!(item.phase, ImportItemPhase::SourceKept | ImportItemPhase::Failed)
        {
            summary.failed_verification += 1;
        }
    }
    summary
}
