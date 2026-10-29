// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! A Project's `Output/` on the composed library (spec 070 RES-FR-01/02/06 to
//! RES-FR-08/11, CAL-FR-06; D-W93, D-W98).
//!
//! Every file in `<Project>/Output/` is a Result: tools never write there, so
//! nothing needs accepting and a tool rerun never changes one. [`OutputWatch`]
//! keeps each open Project's Output step current and finds the generated
//! masters in its `Processing/`; Copy to Output copies one file into
//! `Output/` with the storage journal's verified transfer. Nothing records
//! which inputs produced a Result or where a copy came from, and a Result is
//! never an input (D-W93).
//!
//! A walk never follows a link or junction and reads no file in `Output/`: a
//! file reads Settled once its no-follow fingerprint held across the
//! stable-size window ([`workflow_artifacts::watcher::check_stability`]), and
//! "Still being written" until then. What a walk cannot read keeps its record
//! as Unreadable; only a file a readable walk no longer finds leaves the
//! table. A file belongs to a panel only by lying in `Output/Panels/<folder>/`,
//! the folder token of the panel group (RES-FR-08); no header or name is read
//! for it.

mod watch;

pub use watch::{OutputWatch, OutputWatchSettings};

use std::collections::{BTreeSet, HashMap};
use std::ffi::OsStr;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use metadata_core::MetadataExtractor;
use metadata_fits::FitsExtractor;
use metadata_xisf::XisfExtractor;
use persistence_library::{OutputBasis, OutputCopy};
use uuid::Uuid;
use workflow_artifacts::watcher::{check_stability, FileSnapshot, StabilityStatus};

use crate::calibration::Rules;
use crate::custody::trash::{OsTrash, SystemTrash};
use crate::custody::{observe_entry, observe_source};
use crate::inventory::{self, VolumeCache};
use crate::layout::{self, OUTPUT_FOLDER, PROCESSING_FOLDER};
use crate::library::{blocking, Library};
use crate::{
    CalibrationRules, CaptureMetadata, Classification, EntryKind, ItemOutcome, ItemReason,
    LibraryError, LibraryErrorCode, MasterOfferState, NativePath, ObservationFingerprint,
    OutputObservation, OutputOrigin, OutputState, ProcessingMasterOffer, ReasonCode,
    TransferDestination, OUTPUT_PANELS,
};

fn invalid(message: impl Into<String>) -> LibraryError {
    LibraryError::InvalidInput(message.into())
}

// ── Place ────────────────────────────────────────────────────────────────────

/// Where one Project's folders are, as its record names them: the Project
/// folder in its processing location, and each panel group's folder token.
#[derive(Clone, Debug)]
struct Place {
    project: PathBuf,
    panels: Vec<(Uuid, String)>,
}

impl Place {
    /// `None` until the Project has a processing location (no assumed root).
    /// A panel group whose name leaves no folder token holds no file.
    fn of(basis: &OutputBasis) -> Result<Option<Self>, LibraryError> {
        let Some(parent) = &basis.parent else {
            return Ok(None);
        };
        let project = layout::project_folder(&parent.to_path_buf()?, &basis.name)?;
        let panels = basis
            .panels
            .iter()
            .filter_map(|panel| Some((panel.group_id, layout::folder_token(&panel.name).ok()?)))
            .collect();
        Ok(Some(Self { project, panels }))
    }

    fn output(&self) -> PathBuf {
        self.project.join(OUTPUT_FOLDER)
    }

    fn processing(&self) -> PathBuf {
        self.project.join(PROCESSING_FOLDER)
    }

    /// The panel group whose `Output/Panels/<folder>/` holds `relative`.
    fn panel_of(&self, relative: &Path) -> Option<Uuid> {
        let mut parts = relative.components();
        let (Some(Component::Normal(first)), Some(Component::Normal(folder)), Some(_)) =
            (parts.next(), parts.next(), parts.next())
        else {
            return None;
        };
        if first != OUTPUT_PANELS {
            return None;
        }
        self.panels.iter().find(|(_, token)| folder == token.as_str()).map(|(id, _)| *id)
    }
}

/// The place of an open Project, or why its Output is not writable.
async fn open_place(
    library: &Library,
    project_id: Uuid,
) -> Result<(OutputBasis, Place), LibraryError> {
    let basis = library.catalog().output_basis(project_id).await?;
    if !basis.lifecycle.is_open() {
        return Err(invalid(format!("a {} Project's Output is read-only", basis.lifecycle)));
    }
    let place = Place::of(&basis)?
        .ok_or_else(|| invalid("choose the Project's processing location first"))?;
    Ok((basis, place))
}

// ── Walking and settling ─────────────────────────────────────────────────────

/// One regular file a walk found.
struct Found {
    path: PathBuf,
    size_bytes: u64,
    /// `None` while the file cannot be fingerprinted (held by its writer).
    fingerprint: Option<ObservationFingerprint>,
}

/// What one no-follow walk below a folder found.
#[derive(Default)]
struct Walked {
    files: Vec<Found>,
    /// Every real folder entered, the root included.
    folders: BTreeSet<PathBuf>,
    /// Folders and entries that could not be read.
    unreadable: Vec<PathBuf>,
}

enum Tree {
    Walked(Walked),
    /// The folder does not exist.
    Absent,
    /// The folder, or what holds it, cannot be read, or it is a link.
    Unreadable,
}

/// Folder clutter the operating system writes, and the partial files of a
/// copy in flight: never a Result.
fn clutter(name: &OsStr) -> bool {
    let name = name.to_string_lossy();
    name.starts_with('.')
        || name.eq_ignore_ascii_case("thumbs.db")
        || name.eq_ignore_ascii_case("desktop.ini")
}

/// Every regular file below `root`, of any kind, never following a link or
/// junction. A folder or entry that cannot be read is listed unreadable.
fn walk(root: &Path, volumes: &VolumeCache) -> Tree {
    match fs::symlink_metadata(root) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Tree::Absent,
        Err(_) => return Tree::Unreadable,
        Ok(metadata)
            if fs_pathsafe::is_link_or_junction_metadata(&metadata) || !metadata.is_dir() =>
        {
            return Tree::Unreadable;
        }
        Ok(_) => {}
    }
    let mut walked = Walked::default();
    walked.folders.insert(root.to_path_buf());
    let mut pending = vec![root.to_path_buf()];
    while let Some(folder) = pending.pop() {
        let entries = match fs::read_dir(&folder) {
            Ok(entries) => entries,
            Err(_) if folder == root => return Tree::Unreadable,
            Err(_) => {
                walked.unreadable.push(folder);
                continue;
            }
        };
        for entry in entries {
            let Ok(entry) = entry else {
                walked.unreadable.push(folder.clone());
                continue;
            };
            if clutter(&entry.file_name()) {
                continue;
            }
            let path = entry.path();
            let metadata = match fs::symlink_metadata(&path) {
                Ok(metadata) => metadata,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(_) => {
                    walked.unreadable.push(path);
                    continue;
                }
            };
            if fs_pathsafe::is_link_or_junction_metadata(&metadata) {
                continue;
            }
            if metadata.is_dir() {
                walked.folders.insert(path.clone());
                pending.push(path);
            } else if metadata.is_file() {
                let fingerprint = inventory::probe_fingerprint_in(&path, volumes).ok();
                walked.files.push(Found { path, size_bytes: metadata.len(), fingerprint });
            }
        }
    }
    walked.files.sort_by(|left, right| left.path.cmp(&right.path));
    Tree::Walked(walked)
}

/// `Output/` as one pass reads it: unreadable while its Project folder is
/// (an offline volume), so nothing recorded is taken for removed.
fn walk_output(place: &Place, volumes: &VolumeCache) -> Tree {
    match fs::symlink_metadata(&place.project) {
        Ok(metadata)
            if metadata.is_dir() && !fs_pathsafe::is_link_or_junction_metadata(&metadata) =>
        {
            walk(&place.output(), volumes)
        }
        _ => Tree::Unreadable,
    }
}

/// One file's fingerprint and since when it held.
struct Seen {
    fingerprint: ObservationFingerprint,
    since: FileSnapshot,
    settled: bool,
}

/// The stable-size memory of one folder's files across passes.
#[derive(Default)]
struct Settler {
    seen: HashMap<PathBuf, Seen>,
}

impl Settler {
    /// Settled once `found` kept one fingerprint across `window`; a file
    /// recorded Settled with this fingerprint (before a restart) stays so.
    fn state(
        &mut self,
        found: &Found,
        recorded_settled: bool,
        now: Instant,
        window: Duration,
    ) -> OutputState {
        let Some(fingerprint) = &found.fingerprint else {
            self.seen.remove(&found.path);
            return OutputState::Settling;
        };
        if let Some(seen) = self.seen.get_mut(&found.path) {
            if seen.fingerprint == *fingerprint {
                if !seen.settled {
                    let size = fingerprint.size_bytes;
                    seen.settled = matches!(
                        check_stability(&found.path, &seen.since, now, window, |_| Some(size)),
                        StabilityStatus::Stable { .. }
                    );
                }
                return if seen.settled { OutputState::Settled } else { OutputState::Settling };
            }
        }
        let since = FileSnapshot { size_bytes: fingerprint.size_bytes, arrived_at: now };
        self.seen.insert(
            found.path.clone(),
            Seen { fingerprint: fingerprint.clone(), since, settled: recorded_settled },
        );
        if recorded_settled {
            OutputState::Settled
        } else {
            OutputState::Settling
        }
    }

    /// Forget every file a pass no longer found.
    fn keep(&mut self, found: &[Found]) {
        let present: BTreeSet<&Path> = found.iter().map(|found| found.path.as_path()).collect();
        self.seen.retain(|path, _| present.contains(path.as_path()));
    }
}

// ── Masters in Processing/ ───────────────────────────────────────────────────

/// Whether a header adapter reads the file: the only files a master can be.
fn header_readable(path: &Path) -> bool {
    path.extension().is_some_and(|extension| {
        let extension = extension.to_string_lossy().to_ascii_lowercase();
        FitsExtractor.supports_extension(&extension) || XisfExtractor.supports_extension(&extension)
    })
}

/// The capture metadata the header adapters read.
pub(crate) fn header_metadata(path: &Path) -> Option<CaptureMetadata> {
    let extension = path.extension()?.to_string_lossy().to_ascii_lowercase();
    let raw = if FitsExtractor.supports_extension(&extension) {
        FitsExtractor.extract(path)
    } else if XisfExtractor.supports_extension(&extension) {
        XisfExtractor.extract(path)
    } else {
        return None;
    };
    raw.ok().flatten().map(|raw| CaptureMetadata::from(&raw))
}

/// A generated calibration master by CAL's classification of its header and
/// name (CAL-FR-06), with the header it read: only a master, never a raw
/// calibration frame.
pub(crate) fn master_classification(
    path: &Path,
    relative: &Path,
) -> Option<(Classification, CaptureMetadata)> {
    let observed = header_metadata(path).unwrap_or_default();
    let classification = Rules.classify(&observed, &NativePath::from_path(relative))?;
    classification.master.is_some().then_some((classification, observed))
}

/// A settled file of `Processing/` a pass reads as a possible master.
struct MasterCandidate {
    path: PathBuf,
    relative: PathBuf,
    fingerprint: ObservationFingerprint,
}

/// What reading one candidate found: a master hashed at the fingerprint it
/// settled with, or no master.
struct Classified {
    candidate: MasterCandidate,
    master: Option<(Classification, String)>,
}

/// Classify each candidate and hash each master (blocking). A file that
/// changed while it was read is left for the next pass.
fn classify(candidates: Vec<MasterCandidate>) -> Vec<Classified> {
    candidates
        .into_iter()
        .filter_map(|candidate| {
            let Some((classification, _)) =
                master_classification(&candidate.path, &candidate.relative)
            else {
                return Some(Classified { candidate, master: None });
            };
            let evidence = observe_entry(&candidate.path).ok()?;
            let sha256 =
                evidence.sha256.filter(|_| evidence.fingerprint == candidate.fingerprint)?;
            Some(Classified { candidate, master: Some((classification, sha256)) })
        })
        .collect()
}

// ── Hide and Restore on a Processing master offer ────────────────────────────

impl Library {
    /// Hide on a generated master offer in a Project's Output step
    /// (RES-FR-11, CAL-FR-06): the decline for the bytes with
    /// `expected_sha256`, the digest the step showed. The master stays a
    /// candidate in Calibration; no file is touched.
    ///
    /// # Errors
    /// `NotFound` for an unknown offer; `InvalidInput` for a digest the offer
    /// does not have or an adopted master.
    pub async fn dismiss_processing_master(
        &self,
        offer_id: Uuid,
        expected_sha256: &str,
    ) -> Result<ProcessingMasterOffer, LibraryError> {
        self.catalog().dismiss_processing_master(offer_id, expected_sha256).await
    }

    /// Restore on a hidden generated master offer: offer it again, provided
    /// its source in the Project's `Processing/` still holds the bytes the
    /// offer names (`expected_sha256`). Only the catalog changes; changed
    /// bytes are offered afresh by the next pass.
    ///
    /// # Errors
    /// `NotFound` for an unknown offer or Project; `InvalidInput` for a digest
    /// the offer does not have, an offer that is not hidden, an adopted
    /// master, a Project with no processing location, or a source that changed
    /// or is gone; access errors reading the source.
    pub async fn restore_processing_master(
        &self,
        offer_id: Uuid,
        expected_sha256: &str,
    ) -> Result<ProcessingMasterOffer, LibraryError> {
        let offer = self.catalog().processing_master_offer(offer_id).await?;
        restorable(&offer, expected_sha256)?;
        let basis = self.catalog().output_basis(offer.project_id).await?;
        let place = Place::of(&basis)?
            .ok_or_else(|| invalid("choose the Project's processing location first"))?;
        let processing = place.processing();
        let source = processing.join(offer.path.relative_path()?);
        let shown = source.display().to_string();
        let unchanged = blocking(move || match observe_source(&processing, &source) {
            Ok(evidence) => Ok(evidence.kind == EntryKind::File
                && evidence.sha256.as_deref() == Some(offer.sha256.as_str())),
            // Gone, or no longer reached the same way from `Processing/`.
            Err(error)
                if matches!(
                    error.code(),
                    LibraryErrorCode::NotFound | LibraryErrorCode::IdentityConflict
                ) =>
            {
                Ok(false)
            }
            Err(error) => Err(error),
        })
        .await?;
        if !unchanged {
            return Err(invalid(format!(
                "{shown} no longer holds the hidden master's bytes, so it can't be restored"
            )));
        }
        // The transaction checks the digest and the state again.
        self.catalog().restore_processing_master(offer_id, expected_sha256).await
    }
}

/// Whether Restore may answer `offer`, read before its source is hashed: the
/// digest the caller saw, and a hidden offer.
fn restorable(offer: &ProcessingMasterOffer, expected_sha256: &str) -> Result<(), LibraryError> {
    if offer.sha256 != expected_sha256 {
        return Err(invalid(format!("offer {} changed; refresh the Output step", offer.id)));
    }
    match offer.state {
        MasterOfferState::Dismissed => Ok(()),
        MasterOfferState::Offered => Err(invalid(format!("offer {} is not hidden", offer.id))),
        MasterOfferState::Adopted => {
            Err(invalid(format!("offer {} was adopted into the calibration library", offer.id)))
        }
    }
}

// ── Copy to Output ───────────────────────────────────────────────────────────

impl Library {
    /// Copy to Output… (RES-FR-02, RES-AC-02/25): copy the regular file at
    /// `source` into the Project's `Output/` as `name`, a path relative to it,
    /// under the Project's Copy to Output operation. The copy goes through the
    /// storage journal's verified transfer: the source is hashed now, re-read
    /// against that digest as it is copied, and the copy is re-read and
    /// compared before it is listed as Copied with the digest. The source stays
    /// where it is, unchanged, and nothing at the destination is ever
    /// replaced. A copy of a master the Project offered is prefilled as that
    /// calibration master.
    ///
    /// # Errors
    /// `InvalidInput` for a Project that is not open, has no processing
    /// location or runs another operation; for a name that is absolute,
    /// empty or leaves `Output/`; for a source in `Output/` or one that is
    /// not a regular file; for a name `Output/` already holds (choose another
    /// name); and naming why a copy that started did not verify, which lists
    /// nothing. Access, identity and catalog errors.
    pub async fn copy_to_output(
        &self,
        project_id: Uuid,
        source: &NativePath,
        name: &NativePath,
    ) -> Result<OutputObservation, LibraryError> {
        let (_, place) = open_place(self, project_id).await?;
        let relative = name.relative_path()?;
        if relative.as_os_str().is_empty() {
            return Err(invalid("name the copy in Output/"));
        }
        let source_path = source.to_path_buf()?;
        let output = place.output();
        if layout::inside(&source_path, &output) {
            return Err(invalid(format!("{} is already in Output/", source_path.display())));
        }
        let destination_file = output.join(&relative);
        let shown = relative.display().to_string();
        let evidence = blocking(move || {
            match fs::symlink_metadata(&destination_file) {
                Ok(_) => {
                    return Err(invalid(format!(
                        "Output/{shown} already exists; choose another name"
                    )))
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(LibraryError::from_io(&destination_file, &error)),
            }
            let evidence = observe_entry(&source_path)?;
            if evidence.kind != EntryKind::File {
                return Err(invalid(format!(
                    "{} is not a regular file; links are not followed",
                    source_path.display()
                )));
            }
            Ok(evidence)
        })
        .await?;
        let planned = OutputObservation {
            path: name.clone(),
            kind: None,
            channel: None,
            panel_group_id: place.panel_of(&relative),
            state: OutputState::Settled,
            size_bytes: evidence.fingerprint.size_bytes,
            fingerprint: None,
            sha256: evidence.sha256.clone(),
            origin: OutputOrigin::Copied,
        };
        let destination = TransferDestination {
            root: NativePath::from_path(&place.project),
            relative: NativePath::from_path(&Path::new(OUTPUT_FOLDER).join(&relative)),
        };
        let copy =
            self.catalog().begin_output_copy(project_id, &evidence, &destination, &planned).await?;
        self.settle_output_copy(&copy).await?.map_err(|reason| invalid(reason.detail))
    }

    /// Finish every Copy to Output an earlier process left unsettled: each
    /// resumes from its recorded phase, and a verified one is listed. Returns
    /// what was listed; a blocked one lists nothing and releases its Project.
    ///
    /// # Errors
    /// Catalog errors.
    pub async fn resume_output_copies(&self) -> Result<Vec<OutputObservation>, LibraryError> {
        let mut listed = Vec::new();
        for copy in self.catalog().unfinished_output_copies().await? {
            if let Ok(observation) = self.settle_output_copy(&copy).await? {
                listed.push(observation);
            }
        }
        Ok(listed)
    }

    /// Run the copy's storage operation to its outcome and settle the copy:
    /// listed when it verified, else why not.
    async fn settle_output_copy(
        &self,
        copy: &OutputCopy,
    ) -> Result<Result<OutputObservation, ItemReason>, LibraryError> {
        let trash: Arc<dyn OsTrash> = Arc::new(SystemTrash::default());
        let operation = self.run_storage_operation(copy.storage_operation_id, trash).await?;
        let item = operation.items.first().ok_or_else(|| {
            LibraryError::PersistenceFailure(format!(
                "Copy to Output {} names no storage item",
                copy.operation_id
            ))
        })?;
        if item.outcome != Some(ItemOutcome::Copied) {
            self.catalog().finish_output_copy(copy.operation_id, None).await?;
            return Ok(Err(item.reason.clone().unwrap_or_else(|| {
                ItemReason::new(ReasonCode::Interrupted, "the copy did not verify")
            })));
        }
        let destination = item.destination.clone().ok_or_else(|| {
            LibraryError::PersistenceFailure(format!(
                "Copy to Output {} has no destination",
                copy.operation_id
            ))
        })?;
        let file = destination.root.to_path_buf()?.join(destination.relative.relative_path()?);
        let installed = blocking(move || inventory::probe_fingerprint(&file)).await?;
        let listed = self.catalog().finish_output_copy(copy.operation_id, Some(&installed)).await?;
        listed.map(Ok).ok_or_else(|| {
            LibraryError::PersistenceFailure(format!(
                "verified Copy to Output {} was not listed",
                copy.operation_id
            ))
        })
    }

    /// What Wrap up's Clean up and Trash, and Close, never take from the
    /// Project's folder (RES-FR-06, CAL-FR-06).
    ///
    /// # Errors
    /// `NotFound` for an unknown Project; catalog errors.
    pub async fn output_protection(
        &self,
        project_id: Uuid,
    ) -> Result<OutputProtection, LibraryError> {
        let basis = self.catalog().output_basis(project_id).await?;
        let Some(place) = Place::of(&basis)? else {
            return Ok(OutputProtection {
                output: None,
                masters: Vec::new(),
                adopted_sources: Vec::new(),
            });
        };
        let processing = place.processing();
        let offers = self.catalog().processing_master_offers(project_id).await?;
        let masters = offers
            .iter()
            .filter(|offer| offer.state != MasterOfferState::Adopted)
            .map(|offer| Ok(processing.join(offer.path.relative_path()?)))
            .collect::<Result<Vec<_>, LibraryError>>()?;
        let adopted_sources = offers
            .into_iter()
            .filter(|offer| offer.state == MasterOfferState::Adopted)
            .map(|offer| Ok((processing.join(offer.path.relative_path()?), offer.sha256)))
            .collect::<Result<Vec<_>, LibraryError>>()?;
        Ok(OutputProtection { output: Some(place.output()), masters, adopted_sources })
    }
}

/// The Project's protected files: everything in its `Output/`, and each
/// master its `Processing/` offered that wasn't adopted (a dismissed one
/// stays a candidate in Calibration). An adopted master's generated source
/// is not kept: it is a duplicate of the library's copy (PRJ-AC-28).
#[derive(Clone, Debug)]
pub struct OutputProtection {
    output: Option<PathBuf>,
    masters: Vec<PathBuf>,
    adopted_sources: Vec<(PathBuf, String)>,
}

impl OutputProtection {
    /// Whether `path`, an absolute path below the Project folder, must stay.
    #[must_use]
    pub fn protects(&self, path: &Path) -> bool {
        self.output.as_deref().is_some_and(|output| layout::inside(path, output))
            || self.masters.iter().any(|master| master == path)
    }

    /// The digest the offer recorded for the adopted master generated at
    /// `path`, an absolute path below the Project's `Processing/`.
    pub(crate) fn adopted_source_digest(&self, path: &Path) -> Option<&str> {
        self.adopted_sources
            .iter()
            .find(|(source, _)| source == path)
            .map(|(_, digest)| digest.as_str())
    }
}
