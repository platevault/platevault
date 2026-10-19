// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! A Project's applied state: the one rebuilt View (spec 069 PREP-FR-06/09,
//! PREP-FR-16/19, 066 VSEL-FR-14/20/21, 071 STO-FR-10; D-W98 to D-W100,
//! D-W110, D-W113, D-W114).
//!
//! Apply builds a complete `View (building)/` from the originals only, checks
//! it, and swaps it in; the old View becomes `View (previous)/`. The
//! [`ViewManifest`] records what one build placed and the exact basis it was
//! built from: groups, sessions, captures and their settled calibration.
//! Manifests are internal compare-and-swap generations, never `(rev N)`
//! folders or a history the user sees. The [`ApplyJournal`] records the
//! durable phase of one Apply, so a restart reconciles by identity and phase
//! and never installs a partial View. An entry's name is reserved for life.
//! APPLY owns the build, the swap and retirement; these types are the
//! contract it writes.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use time::Date;
use uuid::Uuid;

use crate::{
    require_sha256, validate_copies, ApplicableQuality, CaptureInclusion, CopyBasis,
    CorrectedField, EntryEvidence, FileIdentity, FramingEvidence, GroupKeywords, GroupName,
    GroupOrigin, InputKind, LibraryError, NativePath, ObservationFingerprint, OpticsSignature,
    Revision, SessionPlacement, SettledCalibration, ViewMode,
};

fn invalid(message: String) -> LibraryError {
    LibraryError::InvalidInput(message)
}

// ── Basis ────────────────────────────────────────────────────────────────────

/// One capture of the basis, included or excluded, with its copy bases and
/// the Project's own choice the build saw. `included` is that choice
/// resolved against the live Library; keeping both tells a later pending
/// change apart: the Project's edit when the choice differs, the Library's
/// when only the Library moved (D-W109). `quality_when_added` is the held
/// record's, so discarding a removal restores the capture exactly.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct BasisCapture {
    pub capture_key: Uuid,
    pub included: bool,
    pub inclusion: CaptureInclusion,
    pub copies: Vec<CopyBasis>,
    pub quality_when_added: ApplicableQuality,
}

/// One session of the basis: its night and its settled calibration, with
/// the placement and joined Target the Project held it with, so discarding
/// a removal or a move restores it exactly.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct BasisSession {
    pub session_id: Uuid,
    #[cfg_attr(feature = "wire", specta(type = Option<String>), schemars(with = "Option<String>"))]
    #[serde(default, with = "crate::iso_date::option")]
    pub night: Option<Date>,
    pub placement: SessionPlacement,
    pub target_id: Uuid,
    pub captures: Vec<BasisCapture>,
    pub calibration: SettledCalibration,
}

/// One group of the basis, with everything a discard needs to bring it
/// back after the Project removed it: origin, optics, framing and position.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct BasisGroup {
    pub id: Uuid,
    pub name: GroupName,
    pub panel: bool,
    pub rig_id: Uuid,
    pub origin: GroupOrigin,
    pub optics: OpticsSignature,
    /// `None` reads "Framing unknown".
    pub framing: Option<FramingEvidence>,
    pub position: u32,
    pub sessions: Vec<BasisSession>,
}

/// The exact inputs a View was built from, or that a Closed Project froze:
/// groups with their names, sessions with their nights and calibration, and
/// each capture's choice and copies.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct ProjectBasis {
    pub mode: ViewMode,
    /// The keyword names in effect: the Project's, or the Settings defaults.
    pub keywords: GroupKeywords,
    pub groups: Vec<BasisGroup>,
}

impl ProjectBasis {
    /// Only a Project with several groups gets group folders, even when its
    /// one group is a mosaic panel (D-W114).
    #[must_use]
    pub fn has_group_folders(&self) -> bool {
        self.groups.len() > 1
    }

    /// Included capture keys with their copies' asset ids.
    #[must_use]
    pub fn included_captures(&self) -> BTreeMap<Uuid, BTreeSet<Uuid>> {
        self.captures()
            .filter(|capture| capture.included)
            .map(|capture| {
                (capture.capture_key, capture.copies.iter().map(|copy| copy.asset_id).collect())
            })
            .collect()
    }

    fn captures(&self) -> impl Iterator<Item = &BasisCapture> {
        self.groups.iter().flat_map(|group| &group.sessions).flat_map(|session| &session.captures)
    }

    /// Groups once by id and name, each session in one group, each capture
    /// and copy once, every pinned target valid.
    ///
    /// # Errors
    /// `InvalidInput` naming the broken invariant.
    pub fn validate(&self) -> Result<(), LibraryError> {
        let mut groups = BTreeSet::new();
        let mut names = BTreeSet::new();
        let mut sessions = BTreeSet::new();
        for group in &self.groups {
            if !groups.insert(group.id) {
                return Err(invalid(format!("group {} is listed twice", group.id)));
            }
            if !names.insert(group.name.key()) {
                return Err(invalid(format!("two groups are named {}", group.name.as_str())));
            }
            for session in &group.sessions {
                if !sessions.insert(session.session_id) {
                    return Err(invalid(format!(
                        "session {} sits in two groups",
                        session.session_id
                    )));
                }
                session.calibration.validate(session.session_id)?;
            }
        }
        let mut keys = BTreeSet::new();
        let mut copies = BTreeSet::new();
        for capture in self.captures() {
            validate_copies(capture.capture_key, &capture.copies)?;
            if !keys.insert(capture.capture_key) {
                return Err(invalid(format!("capture {} is listed twice", capture.capture_key)));
            }
            if let Some(copy) = capture.copies.iter().find(|copy| !copies.insert(copy.asset_id)) {
                return Err(invalid(format!("copy {} is allocated twice", copy.asset_id)));
            }
        }
        Ok(())
    }
}

// ── Manifest ─────────────────────────────────────────────────────────────────

/// A manifest's place in the View's life. At most one of a Project is
/// building, one installed (`View/`) and one previous (`View (previous)/`).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ManifestState {
    Building,
    Installed,
    Previous,
    /// Its files are gone; kept as a record of the generation.
    Retired,
    /// A build that never installed.
    Discarded,
}

impl ManifestState {
    #[must_use]
    pub const fn can_become(self, next: Self) -> bool {
        matches!(
            (self, next),
            (Self::Building, Self::Installed | Self::Discarded)
                | (Self::Installed, Self::Previous | Self::Retired)
                | (Self::Previous, Self::Retired)
        )
    }
}

/// What an entry places: a light capture's copy, a raw calibration frame or
/// an adopted master version.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(tag = "source", rename_all = "snake_case", rename_all_fields = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum EntrySource {
    Light { capture_key: Uuid, asset_id: Uuid },
    CalibrationFrame { kind: InputKind, session_id: Uuid, asset_id: Uuid },
    Master { kind: InputKind, master_id: Uuid, revision: Revision },
}

impl EntrySource {
    /// The calibration kind; `None` for a light.
    #[must_use]
    pub const fn calibration_kind(&self) -> Option<InputKind> {
        match self {
            Self::Light { .. } => None,
            Self::CalibrationFrame { kind, .. } | Self::Master { kind, .. } => Some(*kind),
        }
    }
}

/// How an entry is placed. Every Copies entry is its own file made from the
/// original, a clone or a copy; nothing is ever hard-linked, to an original
/// or between the View's own copies (D-W81, 063 FR-005).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum EntryPlacement {
    Symlink,
    Copy,
    Clone,
}

impl EntryPlacement {
    #[must_use]
    pub const fn fits(self, mode: ViewMode) -> bool {
        match mode {
            ViewMode::Symlinks => matches!(self, Self::Symlink),
            ViewMode::Copies => !matches!(self, Self::Symlink),
        }
    }
}

/// One entry of a View, relative to `View/`, with the source snapshot it
/// must match (D19) and, once written, the identity it was written with.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestEntry {
    pub seq: u32,
    pub path: NativePath,
    pub group_id: Option<Uuid>,
    #[serde(default, with = "crate::iso_date::option")]
    pub night: Option<Date>,
    pub source: EntrySource,
    pub placement: EntryPlacement,
    pub source_sha256: String,
    pub source_fingerprint: ObservationFingerprint,
    pub written: Option<FileIdentity>,
    /// The reviewed header change an isolated patched Copy carries
    /// (PREP-FR-03).
    #[serde(default)]
    pub header_patch: Vec<CorrectedField>,
    /// The SHA-256 the patched copy was proven to hold when it was written;
    /// `None` for a link or a plain copy, which holds `source_sha256`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub patched_sha256: Option<String>,
}

impl ManifestEntry {
    /// The SHA-256 a Copy or Clone entry holds: its proven patched digest,
    /// else its original's.
    #[must_use]
    pub fn copy_sha256(&self) -> &str {
        self.patched_sha256.as_deref().unwrap_or(&self.source_sha256)
    }
}

/// What one Apply placed and the basis it was built from.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewManifest {
    pub project_id: Uuid,
    pub generation: Revision,
    pub state: ManifestState,
    /// The Apply that built it.
    pub operation_id: Uuid,
    /// The Project revision the build used.
    pub desired_revision: Revision,
    pub basis: ProjectBasis,
    pub entries: Vec<ManifestEntry>,
}

impl ViewManifest {
    /// A valid basis; each seq and path once; every placement fits the mode,
    /// a Symlinks View also holding the isolated patched copies of corrected
    /// frames (PREP-FR-04); a patch only on a Copy, which records the digest
    /// it was proven to hold once written; a light entry places a copy of an
    /// included capture.
    ///
    /// # Errors
    /// `InvalidInput` naming the entry.
    pub fn validate(&self) -> Result<(), LibraryError> {
        self.basis.validate()?;
        let included = self.basis.included_captures();
        let mut seqs = BTreeSet::new();
        let mut paths = BTreeSet::new();
        for entry in &self.entries {
            let seq = entry.seq;
            crate::relative_parts("an entry path", &entry.path)?;
            require_sha256("an entry's source digest", &entry.source_sha256)?;
            if !paths.insert(&entry.path) {
                return Err(invalid(format!(
                    "entry {seq}: {} is placed twice",
                    entry.path.display()
                )));
            }
            let patched = !entry.header_patch.is_empty();
            if patched && entry.placement != EntryPlacement::Copy {
                return Err(invalid(format!("entry {seq}: only a copy carries a patch")));
            }
            if !(entry.placement.fits(self.basis.mode) || patched) {
                return Err(invalid(format!(
                    "entry {seq}: Symlinks mode places links and patched copies only"
                )));
            }
            match (&entry.patched_sha256, patched) {
                (Some(digest), true) => require_sha256("a patched copy's digest", digest)?,
                (None, true) if entry.written.is_some() => {
                    return Err(invalid(format!(
                        "entry {seq}: a written patched copy records its digest"
                    )));
                }
                (Some(_), false) => {
                    return Err(invalid(format!(
                        "entry {seq}: only a patched copy records a patched digest"
                    )));
                }
                _ => {}
            }
            if let EntrySource::Light { capture_key, asset_id } = entry.source {
                if !included.get(&capture_key).is_some_and(|copies| copies.contains(&asset_id)) {
                    return Err(invalid(format!(
                        "entry {seq}: capture {capture_key} is not an included input"
                    )));
                }
            }
            if !seqs.insert(seq) {
                return Err(invalid(format!("entry {seq} is listed twice")));
            }
        }
        Ok(())
    }
}

// ── Entry names ──────────────────────────────────────────────────────────────

/// The input an entry name is reserved for.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
#[serde(tag = "input", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum EntryInput {
    Capture { capture_key: Uuid },
    CalibrationFrame { asset_id: Uuid },
    Master { master_id: Uuid },
}

/// An input's entry basename, fixed for life (PREP-FR-19, D-W114): a newcomer
/// whose name clashes takes a suffix, and the existing entry keeps its name.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryName {
    pub input: EntryInput,
    pub basename: String,
}

impl EntryName {
    /// # Errors
    /// `InvalidInput` for an empty name, `.` or `..`, a path separator or a
    /// control character.
    pub fn new(input: EntryInput, basename: &str) -> Result<Self, LibraryError> {
        let plain = !basename.is_empty()
            && basename != "."
            && basename != ".."
            && !basename.chars().any(|c| c == '/' || c == '\\' || c.is_control());
        if !plain {
            return Err(invalid(format!("{basename:?} is not a plain file name")));
        }
        Ok(Self { input, basename: basename.to_owned() })
    }
}

// ── Apply journal ────────────────────────────────────────────────────────────

/// The durable phases of one Apply, in order. Each is recorded before the
/// effect it names, so a restart restores the old View or installs the
/// verified new one, never a partial one. Phases may be skipped (the first
/// Apply moves no old View, a build with no held file waits for nothing).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApplyPhase {
    Reserved,
    SourcesVerified,
    Building,
    BuildVerified,
    /// Windows: a tool holds a file in View; Apply continues once released.
    WaitingForRelease,
    OldMoved,
    NewInstalled,
    ManifestCommitted,
    ForeignTransferred,
    RetiringPrevious,
    Settled,
}

impl ApplyPhase {
    pub const ORDER: [Self; 11] = [
        Self::Reserved,
        Self::SourcesVerified,
        Self::Building,
        Self::BuildVerified,
        Self::WaitingForRelease,
        Self::OldMoved,
        Self::NewInstalled,
        Self::ManifestCommitted,
        Self::ForeignTransferred,
        Self::RetiringPrevious,
        Self::Settled,
    ];

    #[must_use]
    pub const fn rank(self) -> u8 {
        self as u8
    }

    /// Phases only move forward.
    #[must_use]
    pub const fn can_advance_to(self, next: Self) -> bool {
        next.rank() > self.rank()
    }
}

/// How an Apply ended (PREP-FR-09). Canceled and Failed keep the old View
/// and are true only before the new one is installed; once installed, Apply
/// finishes committing its manifest and ends Applied, even when moving
/// ticked files is left unfinished.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum ApplyOutcome {
    Applied,
    Failed,
    Canceled,
}

/// The folder identities an Apply expects, recorded before any effect: the
/// Project folder and its `View/`, `View (building)/` and `View (previous)/`.
/// An orphan name alone is never proof of ownership.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpectedTree {
    pub root: NativePath,
    pub root_identity: FileIdentity,
    pub view: Option<FileIdentity>,
    pub building: Option<FileIdentity>,
    pub previous: Option<FileIdentity>,
}

/// One Apply's durable journal, keyed by its Project operation.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyJournal {
    pub operation_id: Uuid,
    pub project_id: Uuid,
    /// The manifest generation it builds.
    pub generation: Revision,
    pub phase: ApplyPhase,
    /// The phase it settled from; set exactly when settled.
    pub settled_from: Option<ApplyPhase>,
    pub outcome: Option<ApplyOutcome>,
    pub expected: ExpectedTree,
    pub error: Option<String>,
}

const fn outcome_fits(outcome: ApplyOutcome, from: ApplyPhase) -> bool {
    match outcome {
        ApplyOutcome::Applied => from.rank() >= ApplyPhase::ManifestCommitted.rank(),
        ApplyOutcome::Failed | ApplyOutcome::Canceled => {
            from.rank() < ApplyPhase::NewInstalled.rank()
        }
    }
}

impl ApplyJournal {
    /// Record the next phase before its effect.
    ///
    /// # Errors
    /// `InvalidInput` for a backward phase, a settled journal, or `Settled`
    /// itself, which only [`Self::settle`] records.
    pub fn advance(&mut self, next: ApplyPhase) -> Result<(), LibraryError> {
        if self.phase == ApplyPhase::Settled || next == ApplyPhase::Settled {
            return Err(invalid("settling an Apply names its outcome".into()));
        }
        if !self.phase.can_advance_to(next) {
            return Err(invalid(format!("an Apply in {:?} never returns to {next:?}", self.phase)));
        }
        self.phase = next;
        Ok(())
    }

    /// Settle with `outcome` where it is true.
    ///
    /// # Errors
    /// `InvalidInput` when already settled, Applied before the manifest is
    /// committed, or Failed or Canceled once the new View is installed.
    pub fn settle(&mut self, outcome: ApplyOutcome) -> Result<(), LibraryError> {
        if self.phase == ApplyPhase::Settled {
            return Err(invalid("an Apply settles once".into()));
        }
        if !outcome_fits(outcome, self.phase) {
            return Err(invalid(format!("an Apply in {:?} can't end {outcome:?}", self.phase)));
        }
        self.settled_from = Some(self.phase);
        self.phase = ApplyPhase::Settled;
        self.outcome = Some(outcome);
        Ok(())
    }

    /// # Errors
    /// `InvalidInput` unless the outcome and settled phase are set exactly
    /// when settled, and the outcome fits the phase it settled from.
    pub fn validate(&self) -> Result<(), LibraryError> {
        let settled = self.phase == ApplyPhase::Settled;
        match (settled, self.outcome, self.settled_from) {
            (false, None, None) => Ok(()),
            (true, Some(outcome), Some(from))
                if from != ApplyPhase::Settled && outcome_fits(outcome, from) =>
            {
                Ok(())
            }
            _ => Err(invalid(format!(
                "Apply {}: phase, outcome and settled phase disagree",
                self.operation_id
            ))),
        }
    }
}

/// What became of a file `PlateVault` didn't place, listed in the Apply sheet.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum ForeignItemState {
    Pending,
    /// Ticked and moved into the new View after the swap.
    Moved,
    /// Left in `View (previous)/`.
    Stayed,
    Failed,
}

/// A file in the View that `PlateVault` didn't place (VSEL-FR-20), with the
/// user's consent. Only a ticked file moves, and only after the swap.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct ForeignItem {
    pub seq: u32,
    /// Relative to `View/`.
    pub path: NativePath,
    pub evidence: EntryEvidence,
    pub ticked: bool,
    pub state: ForeignItemState,
    pub reason: Option<String>,
}

impl ForeignItem {
    /// # Errors
    /// `InvalidInput` for an unticked file that moved, or a failure without
    /// its reason.
    pub fn validate(&self) -> Result<(), LibraryError> {
        crate::relative_parts("a foreign file's path", &self.path)?;
        if self.state == ForeignItemState::Moved && !self.ticked {
            return Err(invalid(format!("{} moved without its tick", self.path.display())));
        }
        if (self.state == ForeignItemState::Failed) != self.reason.is_some() {
            return Err(invalid(format!("{}: a failure names its reason", self.path.display())));
        }
        Ok(())
    }
}

/// Why a file stayed in `View (previous)/` after the swap (STO-FR-10).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum PreviousItemReason {
    /// A copy that differs from what `PlateVault` placed.
    ChangedCopy,
    /// A copy whose original couldn't be verified against its digest.
    UnverifiedCopy,
    /// A file `PlateVault` didn't place that the user left unticked.
    UntickedFile,
    /// A link that failed the no-follow check.
    UnverifiedLink,
}

/// The user's review of a leftover (D-W110). A kept file is not asked about
/// again (decision record §9): the decision is recorded, and the file may
/// still be moved or trashed later, such as by Wrap up's Clean up.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum PreviousItemReview {
    Pending,
    Kept,
    Moved,
    Trashed,
}

impl PreviousItemReview {
    /// A pending leftover takes any review; a kept one may still be moved or
    /// trashed but is never pending again; a moved or trashed one is gone.
    #[must_use]
    pub const fn can_become(self, next: Self) -> bool {
        matches!(
            (self, next),
            (Self::Pending, _) | (Self::Kept, Self::Kept | Self::Moved | Self::Trashed)
        )
    }
}

/// One leftover of an Apply with its recorded review. The path is relative to
/// the Project folder (`<Project>/`): today the file sits in
/// `View (previous)/`, and where kept files go when the next outgoing View
/// arrives is still open with the owner (decision record §9).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct PreviousItem {
    pub path: NativePath,
    pub reason: PreviousItemReason,
    pub evidence: EntryEvidence,
    pub review: PreviousItemReview,
}

impl PreviousItem {
    /// Apply waits until every leftover is reviewed: keep, move or Trash.
    /// There are no numbered generations of `View (previous)/`.
    #[must_use]
    pub fn blocks_apply(items: &[Self]) -> bool {
        items.iter().any(|item| item.review == PreviousItemReview::Pending)
    }
}
