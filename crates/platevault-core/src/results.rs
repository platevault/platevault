// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Results (spec 070 RES-FR-01..05/08/10, CAL-FR-06, VSEL-FR-05; D-W4, D-W51,
//! D-W55, D-W56, D-W67, D-W72, D-W73) on the composed library: discovery in
//! the recorded Results folder, Attach Result, Accept Result, accepted
//! products as inputs of another run, and the Result-input lifecycle guard.
//!
//! Discovery walks only the owner's recorded Results folder (PREP-FR-07) —
//! a run's or panel run's own, a run group's `Assembled/` — never following
//! a link and never entering a recorded prepared folder or another Results
//! folder. Per profile, a recognizer sets processing intermediates apart; a
//! file modified within [`SETTLE`] is Pending; every other file is a
//! candidate hashed at discovery, which is its inspection. A candidate of a
//! panel run is a Mosaic panel product and one of a run group an Assembled
//! mosaic by its folder alone, whatever its header says. A generated master
//! goes to CAL, which offers it once.
//!
//! Each discovered candidate records the prepared revision it came from by
//! the first evidence that holds (plan risk 9a): its own FITS or XISF header,
//! or a log in the folder that names the file, naming exactly one revision's
//! prepared folder (`<Run>`, `<Run> (rev N)`, `<Mosaic> (rev N)/Panel N`) as a
//! path; else the one revision whose window — from its preparation finishing
//! to the next revision starting — holds the file's modification time,
//! labelled as inference; else Unknown.
//!
//! Acceptance and reuse re-read the bytes (D19): Accept Result refuses a
//! product whose current SHA-256 is not the inspected one, and the input
//! picker rehashes every accepted product against its acceptance digest
//! before offering it; equal size and modification time never stand in.

use std::collections::BTreeSet;
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Weak};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use metadata_core::MetadataExtractor;
use metadata_fits::FitsExtractor;
use metadata_xisf::XisfExtractor;
use persistence_library::{
    DetectedMaster, NewAttachment, Observation, ResultsBasis, ResultsScan, ScannedResult,
    VerifiedAcceptance, VerifiedProduct,
};
use uuid::Uuid;

use crate::calibration::Rules;
use crate::custody::observe_entry;
use crate::inventory;
use crate::library::{blocking, Library};
use crate::run_lifecycle::{BlockersFuture, RunOperationGuard};
use crate::view_selection::ViewDetail;
use crate::{
    AcceptOutcome, AcceptRefusal, AcceptResult, Availability, CalibrationRules, CaptureMetadata,
    EntryKind, InputVerification, LibraryError, NativePath, NewView, ObservationFingerprint,
    PreparationRevision, PreparationState, ProductInput, ProfileKind, ResultInputOffer, ResultKind,
    ResultOwner, ResultRecord, ResultState, ResultsListing, RevisionAttribution, View,
};

/// A file modified this recently may still be being written: it reads
/// Pending and is neither hashed nor offered (RES-FR-01, RES-AC-01).
pub const SETTLE: Duration = Duration::from_secs(3);
/// The bytes of one log read for revision evidence.
const LOG_BYTES: u64 = 4 << 20;
/// The FITS header blocks read for revision evidence, as the header adapter.
const FITS_BLOCKS: usize = 32;
const FITS_BLOCK: usize = 2880;
/// The XISF header bytes read for revision evidence.
const XISF_HEADER_BYTES: u32 = 1 << 20;

// ── Recognizers ──────────────────────────────────────────────────────────────

/// What a profile's recognizer makes of one file below a Results folder.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Recognized {
    /// A product: an inspected candidate.
    Product,
    /// A processing intermediate, by label.
    Intermediate(&'static str),
    /// A processing log: an intermediate whose text may name the revision.
    Log,
}

/// Classify `relative`, a path below a Results folder, with the recognizer of
/// the owner's profile. The patterns follow each tool's documented output
/// layout and still need fixture qualification (plan risk 8), so only what a
/// pattern names is an intermediate: anything else stays a candidate and is
/// never cleared away as an intermediate. SETI Astro's and a generic
/// profile's layouts are unqualified: only their logs are recognized.
#[must_use]
pub fn recognize(profile: Option<ProfileKind>, relative: &Path) -> Recognized {
    let lower = |text: &std::ffi::OsStr| text.to_string_lossy().to_ascii_lowercase();
    let name = relative.file_name().map(lower).unwrap_or_default();
    let extension = relative.extension().map(lower);
    let folders: Vec<String> = relative
        .parent()
        .into_iter()
        .flat_map(Path::components)
        .filter_map(|part| match part {
            Component::Normal(part) => Some(lower(part)),
            _ => None,
        })
        .collect();
    if extension.as_deref() == Some("log") {
        return Recognized::Log;
    }
    match profile {
        Some(ProfileKind::Wbpp) => wbpp(&folders, extension.as_deref()),
        Some(ProfileKind::Siril) => siril(&folders, &name, extension.as_deref()),
        Some(ProfileKind::Seti | ProfileKind::Generic) | None => Recognized::Product,
    }
}

/// `PixInsight` WBPP writes each stage's frames into its own subfolder of the
/// output directory, its logs into `logs/`, local normalization (`.xnml`) and
/// drizzle (`.xdrz`) data beside the registered frames, and its integrated
/// masters into `master/`, which stay candidates.
fn wbpp(folders: &[String], extension: Option<&str>) -> Recognized {
    const STAGES: [(&str, &str); 5] = [
        ("calibrated", "WBPP calibrated frame"),
        ("cosmetized", "WBPP cosmetized frame"),
        ("debayered", "WBPP debayered frame"),
        ("registered", "WBPP registered frame"),
        ("fastintegration", "WBPP fast-integration frame"),
    ];
    match extension {
        Some("xnml") => return Recognized::Intermediate("WBPP local normalization data"),
        Some("xdrz") => return Recognized::Intermediate("WBPP drizzle data"),
        _ => {}
    }
    for folder in folders {
        if folder == "logs" {
            return Recognized::Log;
        }
        if let Some((_, label)) = STAGES.iter().find(|(stage, _)| folder == stage) {
            return Recognized::Intermediate(label);
        }
    }
    Recognized::Product
}

/// Siril scripts work in `process/`: converted, pre-processed, registered and
/// background-extracted frames and `.seq` sequences are intermediates; the
/// `*_stacked` masters and stacks there, and everything outside it, stay
/// candidates.
fn siril(folders: &[String], name: &str, extension: Option<&str>) -> Recognized {
    if extension == Some("seq") {
        return Recognized::Intermediate("Siril sequence");
    }
    if folders.iter().any(|folder| folder == "process") {
        let stem = name.rsplit_once('.').map_or(name, |(stem, _)| stem);
        if !stem.ends_with("_stacked") {
            return Recognized::Intermediate("Siril process frame");
        }
    }
    Recognized::Product
}

// ── Discovery ────────────────────────────────────────────────────────────────

/// What walking one Results folder found.
struct Walked {
    files: Vec<PathBuf>,
    unreadable: Vec<PathBuf>,
}

/// How a path that cannot be read reads.
fn io_availability(error: &std::io::Error) -> Availability {
    if error.kind() == std::io::ErrorKind::NotFound {
        Availability::Missing
    } else {
        Availability::Unreadable
    }
}

/// Folder clutter the operating system writes, never a Result.
fn clutter(name: &std::ffi::OsStr) -> bool {
    let name = name.to_string_lossy();
    name.starts_with('.')
        || name.eq_ignore_ascii_case("thumbs.db")
        || name.eq_ignore_ascii_case("desktop.ini")
}

/// Every regular file below `folder`, never following a link or junction and
/// never entering an `excluded` folder (a recorded prepared folder or another
/// Results folder). An entry that cannot be read is listed unreadable.
fn walk(folder: &Path, excluded: &[PathBuf]) -> Result<Walked, Availability> {
    let metadata = fs::symlink_metadata(folder).map_err(|error| io_availability(&error))?;
    if fs_pathsafe::is_link_or_junction_metadata(&metadata) || !metadata.is_dir() {
        return Err(Availability::Unreadable);
    }
    let mut walked = Walked { files: Vec::new(), unreadable: Vec::new() };
    let mut folders = vec![folder.to_path_buf()];
    while let Some(current) = folders.pop() {
        let entries = match fs::read_dir(&current) {
            Ok(entries) => entries,
            Err(error) if current == folder => return Err(io_availability(&error)),
            Err(_) => {
                walked.unreadable.push(current);
                continue;
            }
        };
        for entry in entries {
            let Ok(entry) = entry else {
                walked.unreadable.push(current.clone());
                continue;
            };
            if clutter(&entry.file_name()) {
                continue;
            }
            let path = entry.path();
            let Ok(metadata) = fs::symlink_metadata(&path) else {
                walked.unreadable.push(path);
                continue;
            };
            if fs_pathsafe::is_link_or_junction_metadata(&metadata) {
                continue;
            }
            if metadata.is_dir() {
                if !excluded.iter().any(|folder| path.starts_with(folder)) {
                    folders.push(path);
                }
            } else if metadata.is_file() {
                walked.files.push(path);
            }
        }
    }
    walked.files.sort();
    Ok(walked)
}

/// Signed nanoseconds since the Unix epoch.
fn nanos(time: SystemTime) -> i128 {
    match time.duration_since(UNIX_EPOCH) {
        Ok(after) => i128::try_from(after.as_nanos()).unwrap_or(i128::MAX),
        Err(before) => i128::try_from(before.duration().as_nanos()).map_or(i128::MIN, |n| -n),
    }
}

fn parse_nanos(text: &str) -> Option<i128> {
    time::OffsetDateTime::parse(text, &time::format_description::well_known::Rfc3339)
        .ok()
        .map(time::OffsetDateTime::unix_timestamp_nanos)
}

/// The header text of a FITS or XISF file: the cards up to `END`, or the
/// XISF XML header. Other formats carry none.
fn header_text(path: &Path) -> Option<String> {
    let extension = path.extension()?.to_string_lossy().to_ascii_lowercase();
    let mut file = fs::File::open(path).ok()?;
    let bytes = match extension.as_str() {
        "fits" | "fit" | "fts" => {
            let mut bytes = Vec::new();
            let mut block = [0_u8; FITS_BLOCK];
            for _ in 0..FITS_BLOCKS {
                if file.read_exact(&mut block).is_err() {
                    break;
                }
                bytes.extend_from_slice(&block);
                let end = block
                    .chunks(80)
                    .any(|card| card.starts_with(b"END") && card[3..].iter().all(|b| *b == b' '));
                if end {
                    break;
                }
            }
            bytes
        }
        "xisf" => {
            let mut head = [0_u8; 16];
            file.read_exact(&mut head).ok()?;
            if &head[..8] != b"XISF0100" {
                return None;
            }
            let length = u32::from_le_bytes([head[8], head[9], head[10], head[11]]);
            let mut xml = vec![0_u8; usize::try_from(length.min(XISF_HEADER_BYTES)).ok()?];
            file.read_exact(&mut xml).ok()?;
            xml
        }
        _ => return None,
    };
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

/// The capture metadata the header adapters read, for master detection.
fn header_metadata(path: &Path) -> Option<CaptureMetadata> {
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

fn log_text(path: &Path) -> Option<String> {
    let mut text = Vec::new();
    fs::File::open(path).ok()?.take(LOG_BYTES).read_to_end(&mut text).ok()?;
    Some(String::from_utf8_lossy(&text).into_owned())
}

/// The path a revision's prepared folder is named by below its Project
/// folder: `<Run>`, `<Run> (rev N)` or `<Mosaic> (rev N)/Panel N`.
fn revision_tail(revision: &PreparationRevision) -> Option<String> {
    let folder = revision.folder.to_path_buf().ok()?;
    let output = revision.output.to_path_buf().ok()?;
    let below: Vec<String> = match folder.strip_prefix(&output) {
        Ok(below) => below
            .components()
            .skip(1)
            .map(|part| part.as_os_str().to_string_lossy().into_owned())
            .collect(),
        Err(_) => vec![folder.file_name()?.to_string_lossy().into_owned()],
    };
    (!below.is_empty()).then(|| below.join("/"))
}

/// Whether `text` names the folder `tail` as a path: `tail` starts the text
/// or follows a separator, quote, `=`, `:` or whitespace, and is followed by
/// a separator. So `<Run>` never matches inside `<Run> (rev 2)/` or
/// `<Run> Results/`.
fn names_folder(text: &str, tail: &str) -> bool {
    text.match_indices(tail).any(|(at, _)| {
        let before = text[..at].chars().next_back();
        let after = text[at + tail.len()..].chars().next();
        before.is_none_or(|c| matches!(c, '/' | '\'' | '"' | '=' | ':') || c.is_whitespace())
            && after == Some('/')
    })
}

/// The one revision whose prepared folder `text` names; none when it names
/// several or none.
fn named_revision<'a>(
    text: &str,
    revisions: &'a [(PreparationRevision, Option<String>)],
) -> Option<&'a PreparationRevision> {
    let text = text.replace('\\', "/");
    let mut named = revisions
        .iter()
        .filter(|(_, tail)| tail.as_deref().is_some_and(|tail| names_folder(&text, tail)))
        .map(|(revision, _)| revision);
    let first = named.next()?;
    named.next().is_none().then_some(first)
}

/// The revision a discovered candidate came from, by the evidence order of
/// the module documentation.
fn attribute(
    path: &Path,
    modified_ns: i128,
    logs: &[(PathBuf, String)],
    revisions: &[(PreparationRevision, Option<String>)],
) -> RevisionAttribution {
    let tool = |revision: &PreparationRevision, source: &Path| RevisionAttribution::ToolEvidence {
        revision_id: revision.id,
        n: revision.n,
        source: NativePath::from_path(source),
    };
    if let Some(revision) = header_text(path).and_then(|text| named_revision(&text, revisions)) {
        return tool(revision, path);
    }
    if let Some(name) = path.file_name().map(|name| name.to_string_lossy().into_owned()) {
        let mut named =
            logs.iter().filter(|(_, text)| text.contains(&name)).filter_map(|(log, text)| {
                named_revision(text, revisions).map(|revision| (log, revision))
            });
        if let Some((log, revision)) = named.next() {
            if named.all(|(_, other)| other.id == revision.id) {
                return tool(revision, log);
            }
        }
    }
    let mut windows: Vec<(&PreparationRevision, i128, i128)> = revisions
        .iter()
        .map(|(revision, _)| revision)
        .filter(|revision| {
            matches!(revision.state, PreparationState::Prepared | PreparationState::Partial)
        })
        .filter_map(|revision| {
            let finished = parse_nanos(revision.finished_at.as_deref()?)?;
            Some((revision, parse_nanos(&revision.started_at)?, finished))
        })
        .collect();
    windows.sort_by_key(|(revision, ..)| revision.n);
    for (index, (revision, _, finished)) in windows.iter().enumerate() {
        let next = windows.get(index + 1).map_or(i128::MAX, |(_, started, _)| *started);
        if modified_ns >= *finished && modified_ns < next {
            return RevisionAttribution::TimeWindow { revision_id: revision.id, n: revision.n };
        }
    }
    RevisionAttribution::Unknown
}

/// What reading one Result at its own path found now.
fn observe_path(path: &NativePath) -> Observation {
    let Ok(path) = path.to_path_buf() else {
        return Observation::Unavailable(Availability::Unreadable);
    };
    if let Err(error) = fs::symlink_metadata(&path) {
        return Observation::Unavailable(io_availability(&error));
    }
    match observe_entry(&path) {
        Ok(evidence) if evidence.kind == EntryKind::File => {
            Observation::Present { fingerprint: evidence.fingerprint, sha256: evidence.sha256 }
        }
        Ok(_) | Err(_) => Observation::Unavailable(Availability::Unreadable),
    }
}

/// A settled product file just inspected.
struct Candidate<'a> {
    path: &'a Path,
    relative: &'a Path,
    evidence: crate::EntryEvidence,
}

impl Candidate<'_> {
    /// The candidate with its kind (a detected master's, else the owner's
    /// folder kind) and the revision it came from.
    fn scanned(
        self,
        owner: ResultOwner,
        default_kind: Option<&ResultKind>,
        logs: &[(PathBuf, String)],
        revisions: &[(PreparationRevision, Option<String>)],
    ) -> ScannedResult {
        let master = matches!(owner, ResultOwner::Run { .. })
            .then(|| detect_master(self.path, self.relative))
            .flatten();
        let kind = master.as_ref().map_or_else(
            || default_kind.cloned(),
            |master| Some(ResultKind::CalibrationMaster { input: master.classification.kind }),
        );
        let modified_ns = self.evidence.fingerprint.modified_ns;
        ScannedResult {
            path: NativePath::from_path(self.path),
            state: ResultState::Candidate,
            kind,
            fingerprint: self.evidence.fingerprint,
            sha256: self.evidence.sha256,
            attribution: attribute(self.path, modified_ns, logs, revisions),
            master,
        }
    }
}

/// Walk and inspect the owner's Results folder (blocking).
fn discover(
    basis: &ResultsBasis,
    folder: NativePath,
    revisions: Vec<PreparationRevision>,
    excluded: &[PathBuf],
) -> ResultsScan {
    let linked = basis
        .records
        .iter()
        .filter(|record| record.association == crate::ResultAssociation::UserLinked)
        .map(|record| (record.id, observe_path(&record.path)))
        .collect();
    let mut scan = ResultsScan {
        owner: basis.owner,
        folder,
        folder_availability: Availability::Available,
        files: Vec::new(),
        unreadable: Vec::new(),
        linked,
    };
    let walked = match scan.folder.to_path_buf() {
        Ok(root) => walk(&root, excluded).map(|walked| (root, walked)),
        Err(_) => Err(Availability::Unreadable),
    };
    let (root, walked) = match walked {
        Ok(found) => found,
        Err(availability) => {
            scan.folder_availability = availability;
            return scan;
        }
    };
    scan.unreadable.extend(walked.unreadable.iter().map(|path| NativePath::from_path(path)));
    let default_kind = match basis.owner {
        ResultOwner::Group { .. } => Some(ResultKind::AssembledMosaic),
        ResultOwner::Run { .. } if basis.panel_run => Some(ResultKind::MosaicPanel),
        ResultOwner::Run { .. } => None,
    };
    let recognized: Vec<(PathBuf, PathBuf, Recognized)> = walked
        .files
        .into_iter()
        .map(|path| {
            let relative = path.strip_prefix(&root).map(Path::to_path_buf).unwrap_or_default();
            let recognized = recognize(basis.profile, &relative);
            (path, relative, recognized)
        })
        .collect();
    let logs: Vec<(PathBuf, String)> = recognized
        .iter()
        .filter(|(_, _, recognized)| *recognized == Recognized::Log)
        .filter_map(|(path, ..)| log_text(path).map(|text| (path.clone(), text)))
        .collect();
    let revisions: Vec<(PreparationRevision, Option<String>)> = revisions
        .into_iter()
        .map(|revision| {
            let tail = revision_tail(&revision);
            (revision, tail)
        })
        .collect();
    let settled_before = nanos(SystemTime::now()) - i128::try_from(SETTLE.as_nanos()).unwrap_or(0);
    for (path, relative, recognized) in recognized {
        let Ok(fingerprint) = inventory::probe_fingerprint(&path) else {
            scan.unreadable.push(NativePath::from_path(&path));
            continue;
        };
        let file = match recognized {
            Recognized::Intermediate(label) => intermediate(&path, fingerprint, label.to_owned()),
            Recognized::Log => intermediate(&path, fingerprint, "processing log".to_owned()),
            Recognized::Product if fingerprint.modified_ns >= settled_before => {
                pending(&path, fingerprint)
            }
            Recognized::Product => match observe_entry(&path) {
                Ok(evidence) if evidence.kind == EntryKind::File => {
                    let candidate = Candidate { path: &path, relative: &relative, evidence };
                    candidate.scanned(basis.owner, default_kind.as_ref(), &logs, &revisions)
                }
                // Changed while it was read: still being written.
                Err(LibraryError::Context { error, .. })
                    if matches!(*error, LibraryError::IdentityConflict(_)) =>
                {
                    pending(&path, fingerprint)
                }
                Ok(_) | Err(_) => {
                    scan.unreadable.push(NativePath::from_path(&path));
                    continue;
                }
            },
        };
        scan.files.push(file);
    }
    scan
}

fn intermediate(path: &Path, fingerprint: ObservationFingerprint, label: String) -> ScannedResult {
    ScannedResult {
        path: NativePath::from_path(path),
        state: ResultState::Intermediate,
        kind: Some(ResultKind::Intermediate { label }),
        fingerprint,
        sha256: None,
        attribution: RevisionAttribution::Unknown,
        master: None,
    }
}

fn pending(path: &Path, fingerprint: ObservationFingerprint) -> ScannedResult {
    ScannedResult {
        path: NativePath::from_path(path),
        state: ResultState::Pending,
        kind: None,
        fingerprint,
        sha256: None,
        attribution: RevisionAttribution::Unknown,
        master: None,
    }
}

/// A generated calibration master by the CAL classification of its header
/// and name (CAL-FR-06): only a master, never a raw calibration frame.
fn detect_master(path: &Path, relative: &Path) -> Option<DetectedMaster> {
    let observed = header_metadata(path).unwrap_or_default();
    let classification = Rules.classify(&observed, &NativePath::from_path(relative))?;
    classification.master.is_some().then_some(DetectedMaster { classification, observed })
}

/// The rehash of an accepted product against its acceptance digest, with
/// what it read (RES-FR-05).
fn verify(record: &ResultRecord) -> (InputVerification, Observation) {
    let observation = observe_path(&record.path);
    let verification = match (&observation, &record.accepted) {
        (Observation::Present { sha256: Some(current), .. }, Some(accepted)) => {
            if *current == accepted.sha256 {
                InputVerification::Verified
            } else {
                InputVerification::Drifted { current_sha256: current.clone() }
            }
        }
        (Observation::Unavailable(availability), _) => InputVerification::Unavailable {
            availability: *availability,
            reason: format!("{} cannot be read now", record.path.display()),
        },
        (Observation::Present { .. }, _) => InputVerification::Unavailable {
            availability: Availability::Unreadable,
            reason: format!("{} is not an accepted product", record.path.display()),
        },
    };
    (verification, observation)
}

/// The record as the rehash just read it.
fn reread(record: &mut ResultRecord, observation: &Observation) {
    match observation {
        Observation::Present { fingerprint, sha256 } => {
            record.availability = Availability::Available;
            record.fingerprint = Some(fingerprint.clone());
            if sha256.is_some() {
                record.sha256.clone_from(sha256);
            }
            record.drifted = record
                .accepted
                .as_ref()
                .is_some_and(|accepted| record.sha256.as_ref() != Some(&accepted.sha256));
        }
        Observation::Unavailable(availability) => record.availability = *availability,
    }
}

fn short(sha256: &str) -> &str {
    sha256.get(..12).unwrap_or(sha256)
}

impl Library {
    /// Rescan the owner's recorded Results folder (RES-FR-01, RES-FR-08):
    /// what the Results step reads when it opens.
    ///
    /// # Errors
    /// `InvalidInput` for an owner without a recorded Results folder (it is
    /// not prepared yet) or a run in the Project's Trash; `NotFound` for an
    /// unknown owner; catalog errors.
    pub async fn rescan_results(&self, owner: ResultOwner) -> Result<ResultsListing, LibraryError> {
        let basis = self.catalog().results_basis(owner).await?;
        let Some(folder) = basis.folder.clone() else {
            return Err(LibraryError::InvalidInput(format!(
                "{owner} has no recorded Results folder until it is prepared"
            )));
        };
        let revisions = match owner {
            ResultOwner::Run { view_id } => self.catalog().view_preparations(view_id).await?,
            ResultOwner::Group { .. } => Vec::new(),
        };
        let recorded = self.catalog().recorded_preparation_folders().await?;
        // The walk starts at the chosen form, so it meets the other folders
        // in theirs.
        let excluded = recorded
            .prepared
            .iter()
            .chain(recorded.results.iter().filter(|recorded| recorded.path != folder))
            .map(|recorded| recorded.path.to_path_buf())
            .collect::<Result<Vec<_>, _>>()?;
        let scan = blocking(move || Ok(discover(&basis, folder, revisions, &excluded))).await?;
        self.catalog().record_results_scan(&scan).await
    }

    /// Attach Result (RES-FR-02/03): hash a file saved outside the Results
    /// folder and attach it to a run or run group with `kind`. It is listed
    /// as attached, User-linked, with Unknown lineage.
    ///
    /// # Errors
    /// `InvalidInput` for a relative path, a link or anything but a regular
    /// file, and as [`persistence_library::Catalog::attach_result`]; access
    /// and identity errors reading the file.
    pub async fn attach_result(
        &self,
        owner: ResultOwner,
        path: NativePath,
        kind: ResultKind,
    ) -> Result<ResultRecord, LibraryError> {
        let file = path.to_path_buf()?;
        let evidence = blocking(move || observe_entry(&file)).await?;
        let (EntryKind::File, Some(sha256)) = (&evidence.kind, evidence.sha256) else {
            return Err(LibraryError::InvalidInput(format!(
                "{} is not a regular file; links are not followed",
                path.display()
            )));
        };
        let attachment =
            NewAttachment { owner, path, kind, fingerprint: evidence.fingerprint, sha256 };
        self.catalog().attach_result(&attachment).await
    }

    /// Accept Result (RES-FR-04): each product's current bytes are re-read
    /// and must hash to its inspected SHA-256; a product changed since its
    /// inspection is refused with the change named and needs a rescan, while
    /// the others are accepted.
    ///
    /// # Errors
    /// `NotFound` for an unknown Result; catalog errors.
    pub async fn accept_results(
        &self,
        items: &[AcceptResult],
    ) -> Result<AcceptOutcome, LibraryError> {
        let mut refused = Vec::new();
        let mut verified = Vec::new();
        for item in items {
            let record = self.catalog().result(item.result_id).await?;
            let name = record.name();
            let refuse = |reason: String| AcceptRefusal { result_id: record.id, reason };
            let Some(inspected) = record.sha256.clone() else {
                refused.push(refuse(match record.state {
                    ResultState::Intermediate => {
                        format!("'{name}' is a processing intermediate, not a product")
                    }
                    ResultState::Pending => {
                        format!("'{name}' is still being written; rescan once it settles")
                    }
                    _ => format!("'{name}' has not been inspected; rescan it"),
                }));
                continue;
            };
            match blocking({
                let record = record.clone();
                move || Ok(observe_path(&record.path))
            })
            .await?
            {
                Observation::Present { fingerprint, sha256: Some(current) }
                    if current == inspected =>
                {
                    verified.push(VerifiedAcceptance {
                        result_id: record.id,
                        sha256: current,
                        fingerprint,
                        kind: item.kind.clone(),
                    });
                }
                Observation::Present { sha256: Some(current), .. } => {
                    refused.push(refuse(format!(
                    "'{name}' changed since it was inspected: it was {}, now it is {}; rescan to \
                     inspect it again",
                    short(&inspected),
                    short(&current)
                )));
                }
                Observation::Present { sha256: None, .. } | Observation::Unavailable(_) => {
                    refused.push(refuse(format!("'{name}' cannot be read now")));
                }
            }
        }
        let mut outcome = if verified.is_empty() {
            AcceptOutcome::default()
        } else {
            self.catalog().accept_results(&verified).await?
        };
        outcome.refused.extend(refused);
        Ok(outcome)
    }

    /// The Results input filter of a run, or of a run being created when
    /// `view` is `None` (RES-FR-05, VSEL-FR-05): accepted products of runs
    /// in any Project and on any rig outside the Project's Trash, each
    /// rehashed against its acceptance digest. Only verified ones are
    /// offered; a drifted one reads drifted and is recorded so. The run's own
    /// Results and its current product inputs are left out.
    ///
    /// # Errors
    /// `NotFound` for an unknown run; catalog errors.
    pub async fn result_inputs(
        &self,
        view: Option<Uuid>,
    ) -> Result<Vec<ResultInputOffer>, LibraryError> {
        let mut accepted = self.catalog().accepted_results(None, None).await?;
        if let Some(view) = view {
            let inputs: BTreeSet<Uuid> = self
                .catalog()
                .view_product_inputs(view)
                .await?
                .into_iter()
                .map(|input| input.result.id)
                .collect();
            accepted.retain(|accepted| {
                accepted.result.owner != (ResultOwner::Run { view_id: view })
                    && !inputs.contains(&accepted.result.id)
            });
        }
        let checked = blocking(move || {
            Ok(accepted
                .into_iter()
                .map(|accepted| {
                    let (verification, observation) = verify(&accepted.result);
                    (accepted, verification, observation)
                })
                .collect::<Vec<_>>())
        })
        .await?;
        let observations: Vec<(Uuid, Observation)> = checked
            .iter()
            .map(|(accepted, _, observation)| (accepted.result.id, observation.clone()))
            .collect();
        self.catalog().record_result_observations(&observations).await?;
        Ok(checked
            .into_iter()
            .map(|(mut accepted, verification, observation)| {
                reread(&mut accepted.result, &observation);
                ResultInputOffer { result: accepted.result, origin: accepted.origin, verification }
            })
            .collect())
    }

    /// Create a run whose Results input filter picked `products` (D-W4,
    /// RES-FR-05): each is rehashed against its acceptance digest first and
    /// recorded as a product input with its originating run; it adds no
    /// members and no integration.
    ///
    /// # Errors
    /// `InvalidInput` for a product that drifted or cannot be read, and as
    /// [`persistence_library::Catalog::create_view_with_products`].
    pub async fn create_view_with_products(
        &self,
        input: &NewView,
        products: &[Uuid],
    ) -> Result<ViewDetail, LibraryError> {
        let verified = self.verify_products(products).await?;
        let record = self.catalog().create_view_with_products(input, &verified).await?;
        self.view_detail(record.view.id).await
    }

    /// Add accepted results to an open run's inputs, each rehashed first.
    ///
    /// # Errors
    /// As [`Self::create_view_with_products`], and as
    /// [`persistence_library::Catalog::add_view_product_inputs`].
    pub async fn add_view_product_inputs(
        &self,
        view: Uuid,
        products: &[Uuid],
    ) -> Result<Vec<ProductInput>, LibraryError> {
        let verified = self.verify_products(products).await?;
        self.catalog().add_view_product_inputs(view, &verified).await
    }

    /// Rehash each accepted product before it is added; any drift or unread
    /// file refuses, naming the product, and the drift is recorded.
    async fn verify_products(&self, ids: &[Uuid]) -> Result<Vec<VerifiedProduct>, LibraryError> {
        let mut records = Vec::with_capacity(ids.len());
        for id in ids {
            records.push(self.catalog().result(*id).await?);
        }
        let checked = blocking(move || {
            Ok(records
                .into_iter()
                .map(|record| {
                    let (verification, observation) = verify(&record);
                    (record, verification, observation)
                })
                .collect::<Vec<_>>())
        })
        .await?;
        let observations: Vec<(Uuid, Observation)> = checked
            .iter()
            .filter(|(record, ..)| record.accepted.is_some())
            .map(|(record, _, observation)| (record.id, observation.clone()))
            .collect();
        self.catalog().record_result_observations(&observations).await?;
        checked
            .into_iter()
            .map(|(record, verification, _)| {
                let name = record.name();
                match (verification, record.accepted) {
                    (InputVerification::Verified, Some(accepted)) => {
                        Ok(VerifiedProduct { result_id: record.id, sha256: accepted.sha256 })
                    }
                    (_, None) => {
                        Err(LibraryError::InvalidInput(format!("Result '{name}' is not accepted")))
                    }
                    (InputVerification::Drifted { current_sha256 }, Some(accepted)) => {
                        Err(LibraryError::InvalidInput(format!(
                            "Result '{name}' drifted: it hashes to {}, not its accepted {}; review \
                             it before reuse",
                            short(&current_sha256),
                            short(&accepted.sha256)
                        )))
                    }
                    (InputVerification::Unavailable { reason, .. }, Some(_)) => {
                        Err(LibraryError::InvalidInput(format!("Result '{name}': {reason}")))
                    }
                }
            })
            .collect()
    }
}

// ── Lifecycle guard ──────────────────────────────────────────────────────────

/// RES's lifecycle source (RES-FR-10): each run using one of a run's
/// Results as an input blocks Move run to Trash, and never Mark Complete.
struct ResultSources {
    library: Weak<Library>,
}

impl RunOperationGuard for ResultSources {
    fn blockers<'a>(&'a self, view: &'a View) -> BlockersFuture<'a> {
        Box::pin(async move {
            let library = self
                .library
                .upgrade()
                .ok_or_else(|| LibraryError::PersistenceFailure("the library is closed".into()))?;
            library.catalog().result_input_blockers(view.id).await
        })
    }
}

/// Register RES's Result-input guard.
pub(crate) async fn register(library: &Arc<Library>) {
    library.register_run_guard(Arc::new(ResultSources { library: Arc::downgrade(library) })).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn recognized(profile: ProfileKind, path: &str) -> Recognized {
        recognize(Some(profile), Path::new(path))
    }

    #[test]
    fn wbpp_stage_folders_and_data_are_intermediates_masters_are_not() {
        let wbpp = ProfileKind::Wbpp;
        assert_eq!(
            recognized(wbpp, "registered/Ha/light_001_c_r.xisf"),
            Recognized::Intermediate("WBPP registered frame")
        );
        assert_eq!(
            recognized(wbpp, "calibrated/light_001_c.xisf"),
            Recognized::Intermediate("WBPP calibrated frame")
        );
        assert_eq!(
            recognized(wbpp, "registered/light_001_c_r.xdrz"),
            Recognized::Intermediate("WBPP drizzle data")
        );
        assert_eq!(recognized(wbpp, "logs/20261008.txt"), Recognized::Log);
        assert_eq!(recognized(wbpp, "master/masterLight_FILTER-Ha.xisf"), Recognized::Product);
        assert_eq!(recognized(wbpp, "master/masterDark_EXPTIME-300.xisf"), Recognized::Product);
    }

    #[test]
    fn siril_process_frames_are_intermediates_stacks_are_not() {
        let siril = ProfileKind::Siril;
        assert_eq!(
            recognized(siril, "process/r_pp_light_00001.fit"),
            Recognized::Intermediate("Siril process frame")
        );
        assert_eq!(
            recognized(siril, "process/light_.seq"),
            Recognized::Intermediate("Siril sequence")
        );
        assert_eq!(recognized(siril, "process/pp_flat_stacked.fit"), Recognized::Product);
        assert_eq!(recognized(siril, "result.fit"), Recognized::Product);
        // WBPP's layout means nothing to Siril's recognizer.
        assert_eq!(recognized(siril, "registered/light_001_c_r.xisf"), Recognized::Product);
    }

    #[test]
    fn unqualified_layouts_recognize_only_logs() {
        for profile in [ProfileKind::Seti, ProfileKind::Generic] {
            assert_eq!(recognized(profile, "process/r_pp_light_00001.fit"), Recognized::Product);
            assert_eq!(recognized(profile, "run.log"), Recognized::Log);
        }
        assert_eq!(recognize(None, Path::new("registered/x.xisf")), Recognized::Product);
    }

    #[test]
    fn a_revision_folder_is_named_only_as_a_path() {
        let rev2 = "NGC7000-HOO-Siril (rev 2)";
        let rev1 = "NGC7000-HOO-Siril";
        let text = "HISTORY = 'input /w/NGC 7000 HOO/NGC7000-HOO-Siril (rev 2)/Lights/Ha_001.fits'";
        assert!(names_folder(text, rev2));
        assert!(!names_folder(text, rev1), "rev 1 never matches inside rev 2's folder name");
        assert!(!names_folder("/w/NGC7000-HOO-Siril Results/x.fit", rev1));
        assert!(names_folder("../NGC7000-HOO-Siril/Lights/a.fit", rev1));
        assert!(!names_folder("XNGC7000-HOO-Siril/Lights/a.fit", rev1));
        assert!(names_folder("Cygnus Wall (rev 2)/Panel 2/Lights", "Cygnus Wall (rev 2)/Panel 2"));
    }
}
