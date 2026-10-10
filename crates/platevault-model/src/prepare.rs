// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Application preparation (spec 069 PREP-FR-01..14): profiles, input modes,
//! the run and Results folder layout, preparation revisions and their
//! entries, the outcome and Open, and a run group's Prepare all.
//!
//! A preparation revision materializes one committed membership revision of a
//! run in its own new folder, `<output>/<Project>/<Run>/` and then
//! `<Run> (rev N)/` beside it, with one shared `<Run> Results/` folder. Every
//! source is snapshotted (identity and SHA-256) while it is prepared and
//! re-verified immediately before terminal success and before every Open
//! (D19). A blocked item never counts as prepared, and launching an
//! application never marks the run Complete.

use std::collections::BTreeMap;
use std::fmt;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    CalibrationHandoff, CalibrationNeedsReview, CalibrationPolicy, EntryEvidence, InputKind,
    InputMode, ItemReason, LibraryError, NativePath, ObservationFingerprint, PanelOutcome,
    ResultKind, Revision, RunCompletion, RunStage, View, Writability, WrittenCopy,
};

fn invalid(message: impl Into<String>) -> LibraryError {
    LibraryError::InvalidInput(message.into())
}

// ---------------------------------------------------------------------------
// Profiles (PREP-FR-01, PREP-FR-02)
// ---------------------------------------------------------------------------

/// The application a profile hands a run to. `Generic` is Open in... with a
/// configured executable and arguments; it never claims a verified profile.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProfileKind {
    /// `PixInsight` with its Weighted Batch Preprocessing script.
    Wbpp,
    Siril,
    /// SETI Astro Suite Pro.
    Seti,
    Generic,
}

/// How the application treats the files it is given (D04). Only recorded
/// evidence makes it `ReadOnly`; until then it is `Unknown`.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InputBehavior {
    ReadOnly,
    /// The application may write to, rename or rewrite its inputs.
    WriteProne,
    #[default]
    Unknown,
}

impl fmt::Display for InputBehavior {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::ReadOnly => "read-only",
            Self::WriteProne => "write-prone",
            Self::Unknown => "unknown",
        })
    }
}

/// The capabilities D04 requires evidence for before a verified-profile claim.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Capability {
    /// What the application does to its input files.
    Input,
    /// The folder layout it loads.
    Layout,
    /// How it is configured: exact input lists passed at launch.
    Configuration,
    /// The accepted products (Results) it reads as inputs, by kind
    /// (RES-FR-05).
    ProductInput,
    /// Output it writes that RES recognizes.
    RecognizedOutput,
}

impl Capability {
    pub const ALL: [Self; 5] = [
        Self::Input,
        Self::Layout,
        Self::Configuration,
        Self::ProductInput,
        Self::RecognizedOutput,
    ];
}

impl fmt::Display for Capability {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Input => "input behaviour",
            Self::Layout => "folder layout",
            Self::Configuration => "input-list configuration",
            Self::ProductInput => "product inputs",
            Self::RecognizedOutput => "recognized output",
        })
    }
}

/// One recorded piece of capability evidence: what was observed, and where.
#[derive(Clone, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityProof {
    pub capability: Capability,
    pub evidence: String,
}

/// A profile's recorded capability evidence (D04). Nothing is claimed
/// without a proof: read-only input needs an `Input` proof, an input list a
/// `Configuration` proof, and product inputs a `ProductInput` proof.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityEvidence {
    #[serde(default)]
    pub input_behavior: InputBehavior,
    /// The application reads the exact input paths passed as `{inputs}`.
    #[serde(default)]
    pub input_list: bool,
    /// The kinds of accepted product the application reads as inputs; a
    /// product of any other kind is unsupported and never converted.
    #[serde(default)]
    pub product_kinds: Vec<ResultKind>,
    /// The application reads raw frames and products in one run; without
    /// it they are prepared in separate runs (RES-FR-05).
    #[serde(default)]
    pub mixed_inputs: bool,
    #[serde(default)]
    pub proofs: Vec<CapabilityProof>,
}

impl CapabilityEvidence {
    fn proves(&self, capability: Capability) -> bool {
        self.proofs.iter().any(|proof| proof.capability == capability)
    }

    /// Every capability without recorded evidence, named in the review.
    #[must_use]
    pub fn unproven(&self) -> Vec<Capability> {
        Capability::ALL.into_iter().filter(|capability| !self.proves(*capability)).collect()
    }

    /// Whether the application reads an accepted product of `kind` as an
    /// input (D04, RES-FR-05): the kind is claimed with its proof.
    #[must_use]
    pub fn reads_product(&self, kind: &ResultKind) -> bool {
        self.proves(Capability::ProductInput) && self.product_kinds.contains(kind)
    }

    /// Whether the application reads raw frames and products in one run.
    #[must_use]
    pub fn reads_mixed_inputs(&self) -> bool {
        self.proves(Capability::ProductInput) && self.mixed_inputs
    }

    /// # Errors
    /// `InvalidInput` for blank evidence, or a claim without its proof.
    pub fn validate(&self) -> Result<(), LibraryError> {
        if self.proofs.iter().any(|proof| proof.evidence.trim().is_empty()) {
            return Err(invalid("capability evidence names what was observed"));
        }
        if self.input_behavior == InputBehavior::ReadOnly && !self.proves(Capability::Input) {
            return Err(invalid("read-only input needs recorded input-behaviour evidence"));
        }
        if self.input_list && !self.proves(Capability::Configuration) {
            return Err(invalid("an input list needs recorded configuration evidence"));
        }
        if (self.mixed_inputs || !self.product_kinds.is_empty())
            && !self.proves(Capability::ProductInput)
        {
            return Err(invalid("product inputs need recorded product-input evidence"));
        }
        Ok(())
    }
}

/// The argument placeholders a profile's launch arguments may hold.
pub const PROFILE_PLACEHOLDERS: [&str; 3] = ["{folder}", "{results}", "{inputs}"];

/// What the user enters for a profile.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileInput {
    pub name: String,
    pub kind: ProfileKind,
    /// Configured or located by the user; none is assumed.
    pub executable: Option<NativePath>,
    /// Launch arguments; `{folder}`, `{results}` and `{inputs}` are expanded.
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub capability_evidence: CapabilityEvidence,
}

impl ProfileInput {
    /// # Errors
    /// `InvalidInput` for a blank name, an unknown `{placeholder}`, or
    /// capability evidence [`CapabilityEvidence::validate`] refuses.
    pub fn validate(&self) -> Result<(), LibraryError> {
        if self.name.trim().is_empty() {
            return Err(invalid("a profile needs a name"));
        }
        for arg in &self.args {
            let mut rest = arg.as_str();
            while let Some(start) = rest.find('{') {
                let tail = &rest[start..];
                let end =
                    tail.find('}').ok_or_else(|| invalid(format!("unclosed '{{' in {arg}")))?;
                if !PROFILE_PLACEHOLDERS.contains(&&tail[..=end]) {
                    return Err(invalid(format!(
                        "{} is not a placeholder; use {}",
                        &tail[..=end],
                        PROFILE_PLACEHOLDERS.join(", ")
                    )));
                }
                rest = &tail[end + 1..];
            }
        }
        if self.args.iter().any(|arg| arg.contains("{inputs}") && arg != "{inputs}") {
            return Err(invalid("{inputs} stands alone: it expands to one argument per input"));
        }
        self.capability_evidence.validate()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: Uuid,
    pub name: String,
    pub kind: ProfileKind,
    pub executable: Option<NativePath>,
    pub args: Vec<String>,
    pub capability_evidence: CapabilityEvidence,
    pub revision: Revision,
    pub created_at: String,
    pub updated_at: String,
}

impl Profile {
    /// A verified-profile claim (D04): a named application with evidence for
    /// every capability. Generic Open in... never claims one.
    #[must_use]
    pub fn verified(&self) -> bool {
        self.kind != ProfileKind::Generic && self.capability_evidence.unproven().is_empty()
    }

    /// Whether Linked View and Direct source may hand it library originals:
    /// only read-only input with recorded evidence does (D04).
    #[must_use]
    pub fn reads_only(&self) -> bool {
        self.capability_evidence.input_behavior == InputBehavior::ReadOnly
    }
}

// ---------------------------------------------------------------------------
// Request, layout and review (PREP-FR-04..08)
// ---------------------------------------------------------------------------

/// The concrete link a Linked View entry is. Hardlinks are an explicit
/// choice and need the source's volume.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LinkKind {
    #[default]
    Symlink,
    Hardlink,
}

/// What Prepare is asked to do.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareRequest {
    pub profile_id: Uuid,
    pub mode: InputMode,
    /// Linked View only; symlinks unless hardlinks are chosen explicitly.
    #[serde(default)]
    pub link: Option<LinkKind>,
    /// The parent folder; `None` takes the last chosen one. There is no
    /// assumed root on first use.
    #[serde(default)]
    pub output: Option<NativePath>,
    /// Another name for the `<Run>` folder when the proposed one exists. On
    /// the first revision it also names the Results folder `<name> Results`.
    #[serde(default)]
    pub folder_name: Option<String>,
    /// How each corrected input's catalog correction reaches the application
    /// (PREP-FR-03), by asset. Prepare is refused while one has no choice.
    #[serde(default)]
    pub corrections: BTreeMap<Uuid, CorrectionChoice>,
}

/// How a confirmed catalog correction of an input reaches the application
/// (PREP-FR-03, D15).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CorrectionChoice {
    /// An isolated Copy or Clone carries the catalog value in its header;
    /// the source is never written.
    Patch,
    /// The application reads the source's header value: the correction is
    /// not delivered.
    AcceptSource,
    /// The input is left out of this preparation.
    Exclude,
}

/// One corrected field of an input: the catalog value next to the header
/// value the application reads unless a patched copy carries the catalog one.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CorrectedField {
    /// The capture field as the catalog names it, such as `filter`.
    pub field: String,
    /// The FITS keywords a patched copy writes; empty when `PlateVault`
    /// patches no keyword for this field.
    pub keywords: Vec<String>,
    /// The value the source header holds.
    pub header: Option<String>,
    /// The confirmed catalog value.
    pub catalog: Option<String>,
}

/// One choice for a corrected input, with why it is refused.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CorrectionOption {
    pub choice: CorrectionChoice,
    /// `None` when offered.
    pub refusal: Option<String>,
}

/// One input with confirmed catalog corrections, as review shows it
/// (PREP-FR-03, PREP-AC-06). Links and Direct-source originals are never
/// patched: in those modes the correction is not delivered.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedCorrection {
    pub member_key: Option<Uuid>,
    pub asset_id: Uuid,
    pub input: PreparedInput,
    pub source: NativePath,
    pub fields: Vec<CorrectedField>,
    pub options: Vec<CorrectionOption>,
    /// The user's choice; `None` until one is made.
    pub choice: Option<CorrectionChoice>,
    /// The application reads the catalog values: an offered patch is chosen.
    /// Otherwise it reads the header values.
    pub delivered: bool,
}

/// What an input's snapshot was planned against (D19).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BasisOrigin {
    /// The confirmed membership's copy.
    Membership,
    /// The calibration assignment's input and digest.
    CalibrationAssignment,
    /// An accepted product's acceptance digest, as its rehash read it
    /// (RES-FR-05).
    ProductAcceptance,
}

impl fmt::Display for BasisOrigin {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Membership => "the confirmed membership",
            Self::CalibrationAssignment => "its calibration assignment",
            Self::ProductAcceptance => "its acceptance",
        })
    }
}

/// The basis an input's snapshot must match (D19): identity, size,
/// modification time and digest as review planned the entry. Retry verifies
/// against it, never against a basis rebuilt later.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceBasis {
    pub fingerprint: ObservationFingerprint,
    pub origin: BasisOrigin,
}

/// Where a preparation revision goes (PREP-FR-06/07).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunLocation {
    pub output: NativePath,
    pub folder: NativePath,
    /// Shared by every revision of the run.
    pub results: NativePath,
}

/// Whether the proposed location can take the revision.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum LocationCheck {
    Ready,
    /// No parent was chosen yet: there is no assumed root.
    ChooseParent,
    /// The chosen parent is unavailable: another must be chosen explicitly.
    ParentUnavailable {
        detail: String,
    },
    /// The parent lies inside a prepared or Results folder.
    InsidePreparedFolder {
        folder: NativePath,
    },
    /// The proposed folder already exists: choose another name or location.
    FolderExists {
        folder: NativePath,
    },
    NotWritable {
        detail: String,
    },
}

/// What a preparation entry presents to the application.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PreparedEntryKind {
    Symlink,
    Hardlink,
    Copy,
    Clone,
    /// The original path itself: nothing is created.
    DirectSource,
}

impl PreparedEntryKind {
    /// Whether the preparation created the entry, so Clean up lists it
    /// (PREP-FR-14): links, clones and copies, never a Direct-source path.
    #[must_use]
    pub const fn created(self) -> bool {
        !matches!(self, Self::DirectSource)
    }
}

/// The input an entry carries.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PreparedInput {
    Light,
    Bias,
    Dark,
    Flat,
    /// An accepted product of another run, a product input (RES-FR-05).
    Product,
}

impl From<InputKind> for PreparedInput {
    fn from(kind: InputKind) -> Self {
        match kind {
            InputKind::Bias => Self::Bias,
            InputKind::Dark => Self::Dark,
            InputKind::Flat => Self::Flat,
        }
    }
}

/// One input as review plans it.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedEntry {
    pub member_key: Option<Uuid>,
    pub asset_id: Option<Uuid>,
    pub master_id: Option<Uuid>,
    pub input: PreparedInput,
    pub kind: PreparedEntryKind,
    /// Absolute source path.
    pub source: NativePath,
    /// Absolute entry path; the source itself for Direct source.
    pub path: NativePath,
    pub size_bytes: u64,
}

/// An input that cannot be prepared as reviewed; it never counts as prepared.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockedInput {
    pub member_key: Option<Uuid>,
    pub input: PreparedInput,
    pub source: Option<NativePath>,
    /// The entry path it would have; `None` while it has no source.
    pub path: Option<NativePath>,
    pub size_bytes: u64,
    pub reason: ItemReason,
}

/// One input mode as review offers it.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModeOption {
    pub mode: InputMode,
    pub link: Option<LinkKind>,
    pub semantics: String,
    /// Why the mode is refused for this run and profile; `None` when offered.
    pub refusal: Option<String>,
}

/// Review preparation (PREP-FR-08): read-only, and nothing is applied until
/// the user chooses.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparationReview {
    pub view_id: Uuid,
    /// The immutable committed selection Prepare uses.
    pub membership_revision: Revision,
    /// An unsaved draft exists: its selection is not what Prepare uses until saved.
    pub draft_unsaved: bool,
    pub project_name: String,
    pub subject_name: String,
    pub run_name: String,
    pub profile: Profile,
    pub verified_profile: bool,
    /// The capabilities without evidence: an unsupported configuration is named.
    pub unproven: Vec<Capability>,
    pub suggested_mode: InputMode,
    pub mode: InputMode,
    pub link: Option<LinkKind>,
    pub modes: Vec<ModeOption>,
    /// The revision number Prepare writes: 1, then 2 for `<Run> (rev 2)/`.
    pub preparation_number: u32,
    pub location: Option<RunLocation>,
    pub location_check: LocationCheck,
    pub entries: Vec<PlannedEntry>,
    pub blocked: Vec<BlockedInput>,
    pub excluded: u64,
    /// Every input with confirmed catalog corrections, with its choices.
    pub corrections: Vec<PlannedCorrection>,
    pub calibration: CalibrationHandoff,
    pub operations: u64,
    pub footprint_bytes: u64,
    pub free_bytes: Option<u64>,
    pub writability: Option<Writability>,
    /// Why Prepare is refused as reviewed; empty when it may run.
    pub refusals: Vec<String>,
}

// ---------------------------------------------------------------------------
// Preparation revisions, entries and outcomes (PREP-FR-09..11, PREP-FR-14)
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PreparationState {
    Running,
    Prepared,
    Partial,
    Failed,
    Canceled,
    /// Stopped where safe, by the user or because `PlateVault` closed; Retry continues.
    Paused,
}

impl fmt::Display for PreparationState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Running => "Running",
            Self::Prepared => "Prepared",
            Self::Partial => "Partial",
            Self::Failed => "Failed",
            Self::Canceled => "Canceled",
            Self::Paused => "Paused",
        })
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EntryState {
    Pending,
    Prepared,
    Blocked,
    /// Prepared, then found changed by a later re-verification (Open).
    Drifted,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparationRevision {
    pub id: Uuid,
    pub view_id: Uuid,
    pub n: u32,
    pub membership_revision: Revision,
    pub profile_id: Uuid,
    pub mode: InputMode,
    pub link: Option<LinkKind>,
    pub output: NativePath,
    pub folder: NativePath,
    pub results_folder: NativePath,
    pub state: PreparationState,
    pub reason: Option<String>,
    pub group_preparation_id: Option<Uuid>,
    pub started_at: String,
    pub finished_at: Option<String>,
}

impl PreparationRevision {
    /// `<Run>` or `<Run> (rev N)`: the folder's own name.
    #[must_use]
    pub fn name(&self) -> String {
        self.folder
            .to_path_buf()
            .ok()
            .and_then(|path| path.file_name().map(|name| name.to_string_lossy().into_owned()))
            .unwrap_or_else(|| self.folder.display())
    }
}

/// One entry of a preparation revision.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedEntry {
    pub seq: u32,
    pub member_key: Option<Uuid>,
    pub asset_id: Option<Uuid>,
    pub master_id: Option<Uuid>,
    pub input: PreparedInput,
    pub kind: PreparedEntryKind,
    pub path: NativePath,
    pub source: Option<NativePath>,
    pub size_bytes: u64,
    /// What its snapshot must match, recorded when Prepare planned it (D19).
    #[serde(default)]
    pub basis: Option<SourceBasis>,
    /// The reviewed header change an isolated patched Copy or Clone carries;
    /// empty for every other entry (PREP-FR-03).
    #[serde(default)]
    pub header_changes: Vec<CorrectedField>,
    /// The source snapshot taken while it was prepared (D19).
    pub source_evidence: Option<EntryEvidence>,
    pub source_sha256: Option<String>,
    /// The entry as written: a link by its own identity and target, a copy
    /// or clone by its identity and SHA-256.
    pub entry_identity: Option<EntryEvidence>,
    /// A copy's partial file while it is being written.
    pub written: Option<WrittenCopy>,
    pub state: EntryState,
    pub reason: Option<ItemReason>,
    pub updated_at: String,
}

/// What an outcome offers next (PREP-FR-10).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PreparationOffer {
    /// Verified success only: Open in the chosen application.
    Open,
    RevealFolder,
    Details,
    /// Partial or Paused: re-attempt the blocked or pending items.
    Retry,
}

/// The outcome of a preparation revision: what was prepared and what was
/// blocked, read from the catalog (Running shows progress the same way).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparationOutcome {
    pub revision: PreparationRevision,
    pub stage: RunStage,
    pub prepared: Vec<PreparedEntry>,
    pub blocked: Vec<PreparedEntry>,
    pub pending: Vec<PreparedEntry>,
    /// Entries Open found changed: the run reads unverified until they return.
    pub drifted: Vec<PreparedEntry>,
    pub offers: Vec<PreparationOffer>,
}

impl PreparationOutcome {
    /// Offers by state: Open only for a Prepared revision with nothing drifted.
    #[must_use]
    pub fn offers_for(state: PreparationState, drifted: bool) -> Vec<PreparationOffer> {
        match state {
            PreparationState::Prepared if !drifted => vec![
                PreparationOffer::Open,
                PreparationOffer::RevealFolder,
                PreparationOffer::Details,
            ],
            PreparationState::Partial | PreparationState::Paused => vec![
                PreparationOffer::Retry,
                PreparationOffer::RevealFolder,
                PreparationOffer::Details,
            ],
            PreparationState::Running => vec![PreparationOffer::Details],
            _ => vec![PreparationOffer::RevealFolder, PreparationOffer::Details],
        }
    }

    /// The run blocker PREP feeds (Home's blocked run): the latest revision
    /// failed, is Partial, or has entries Open found changed.
    #[must_use]
    pub fn failed_blocker(&self) -> Option<PreparationFailed> {
        let failed =
            matches!(self.revision.state, PreparationState::Failed | PreparationState::Partial);
        if !failed && self.drifted.is_empty() {
            return None;
        }
        Some(PreparationFailed {
            view_id: self.revision.view_id,
            preparation_id: self.revision.id,
            preparation_number: self.revision.n,
            state: self.revision.state,
            blocked: u64::try_from(self.blocked.len()).unwrap_or(u64::MAX),
            drifted: u64::try_from(self.drifted.len()).unwrap_or(u64::MAX),
        })
    }
}

/// The run blocker preparation feeds (Home's blocked run, PRJ-AC-23).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparationFailed {
    pub view_id: Uuid,
    pub preparation_id: Uuid,
    pub preparation_number: u32,
    pub state: PreparationState,
    pub blocked: u64,
    pub drifted: u64,
}

/// What Open did (PREP-FR-10). Launching is never processing completion.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum OpenOutcome {
    Launched {
        process_id: u32,
        folder: NativePath,
    },
    /// Re-verification found changed entries: nothing was launched.
    Refused {
        drifted: Vec<PreparedEntry>,
    },
    /// The executable is missing: Choose application or Reveal run folder.
    ChooseApplication {
        folder: NativePath,
        detail: String,
    },
    /// The launch failed; the run and its decisions are kept.
    LaunchFailed {
        folder: NativePath,
        detail: String,
    },
}

/// Asked between entries while a revision is Running (PREP-FR-09).
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PrepareStep {
    #[default]
    Continue,
    Cancel,
    Pause,
}

// ---------------------------------------------------------------------------
// Run group: Prepare all (PREP-FR-07/12/13, D-W38, D-W73)
// ---------------------------------------------------------------------------

/// Where one panel run of a group preparation revision goes.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelLocation {
    pub number: u32,
    pub view_id: Uuid,
    /// `Panel N/` inside the group folder.
    pub folder: NativePath,
    /// `<Mosaic> Results/Panel N/`, shared by every group revision, so a
    /// Result's panel is known from where it was written.
    pub results: NativePath,
}

/// Where a group preparation revision goes. The group folder holds only the
/// `Panel N/` folders; every Results folder lies outside every group folder.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupLocation {
    pub output: NativePath,
    /// `<output>/<Project>/<Mosaic>/` first, then `<Mosaic> (rev N)/`.
    pub folder: NativePath,
    /// By panel number.
    pub panels: Vec<PanelLocation>,
    /// `<Mosaic> Results/Assembled/`: the group Result, the assembled mosaic.
    pub assembled: NativePath,
}

/// A panel run's committed membership revision as a Prepare all review read it.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelMembership {
    pub view_id: Uuid,
    pub membership_revision: Revision,
}

/// The selection a Prepare all review showed: Prepare all refuses another.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupPrepareBasis {
    pub group_revision: Revision,
    /// By panel number.
    pub panels: Vec<PanelMembership>,
}

/// One panel run in the Prepare all review, with its own entries and
/// calibration choices.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelPreparationReview {
    pub number: u32,
    pub panel_id: Uuid,
    pub view_id: Uuid,
    pub run_name: String,
    /// The immutable committed selection Prepare all uses.
    pub membership_revision: Revision,
    pub draft_unsaved: bool,
    /// The committed membership moved past the panel run's latest
    /// preparation; repreparing it proposes a new group folder.
    pub membership_changed: bool,
    /// The panel run's own preparation revision number.
    pub preparation_number: u32,
    pub entries: Vec<PlannedEntry>,
    pub blocked: Vec<BlockedInput>,
    pub excluded: u64,
    /// Every input of the panel run with confirmed catalog corrections, with
    /// its choices (PREP-FR-03); the group's request carries the choices.
    pub corrections: Vec<PlannedCorrection>,
    /// The panel run's own calibration choices; `None` until it is first
    /// saved, as nothing is matched yet.
    pub calibration: Option<CalibrationHandoff>,
    /// Set when the panel run's calibration needs review (CAL-FR-11).
    pub calibration_review: Option<CalibrationNeedsReview>,
    pub operations: u64,
    pub footprint_bytes: u64,
    /// Why this panel run refuses Prepare all as reviewed.
    pub refusals: Vec<String>,
}

/// Review of Prepare all (PREP-FR-08/12, PREP-AC-16): one review over every
/// panel run, the shared profile, input mode and calibration policy once,
/// and one total footprint and free space. Read-only.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupPreparationReview {
    pub group_id: Uuid,
    pub group_revision: Revision,
    pub project_name: String,
    pub subject_name: String,
    /// The `<Mosaic>` of the group and Results folders.
    pub mosaic_name: String,
    pub profile: Profile,
    pub verified_profile: bool,
    pub unproven: Vec<Capability>,
    pub suggested_mode: InputMode,
    pub mode: InputMode,
    pub link: Option<LinkKind>,
    pub modes: Vec<ModeOption>,
    pub calibration_policy: CalibrationPolicy,
    /// The group revision Prepare all writes: 1, then 2 for `<Mosaic> (rev 2)/`.
    pub preparation_number: u32,
    pub location: Option<GroupLocation>,
    pub location_check: LocationCheck,
    /// The panel runs Prepare all prepares, by panel number.
    pub panels: Vec<PanelPreparationReview>,
    /// Panel runs in the Project's Trash: listed, and skipped.
    pub skipped: Vec<PanelOutcome>,
    pub operations: u64,
    pub footprint_bytes: u64,
    pub free_bytes: Option<u64>,
    pub writability: Option<Writability>,
    /// Why Prepare all is refused as reviewed, the group's and every panel
    /// run's; empty when it may run.
    pub refusals: Vec<String>,
}

impl GroupPreparationReview {
    /// The selection this review showed, for Prepare all.
    #[must_use]
    pub fn basis(&self) -> GroupPrepareBasis {
        GroupPrepareBasis {
            group_revision: self.group_revision,
            panels: self
                .panels
                .iter()
                .map(|panel| PanelMembership {
                    view_id: panel.view_id,
                    membership_revision: panel.membership_revision,
                })
                .collect(),
        }
    }
}

/// A run group's Prepare all revision. Each panel run's own revision names it.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupPreparation {
    pub id: Uuid,
    pub group_id: Uuid,
    pub n: u32,
    pub profile_id: Uuid,
    pub output: NativePath,
    pub folder: NativePath,
    pub outcome: PreparationState,
    pub started_at: String,
    pub finished_at: Option<String>,
}

impl GroupPreparation {
    /// `<Mosaic>` or `<Mosaic> (rev N)`: the group folder's own name.
    #[must_use]
    pub fn name(&self) -> String {
        self.folder
            .to_path_buf()
            .ok()
            .and_then(|path| path.file_name().map(|name| name.to_string_lossy().into_owned()))
            .unwrap_or_else(|| self.folder.display())
    }

    /// The group outcome (PREP-FR-12): Prepared when every panel run is
    /// Prepared, else Canceled or Paused when that is the `stop` the user made
    /// on Prepare all, else Failed when every panel run Failed, and Partial
    /// otherwise. Canceled and Paused come only from `stop`: a panel run
    /// canceled, paused or being retried on its own counts as neither
    /// prepared nor failed. A `stop` other than Canceled or Paused is none.
    #[must_use]
    pub fn outcome_for(
        stop: Option<PreparationState>,
        panels: impl IntoIterator<Item = PreparationState>,
    ) -> PreparationState {
        let (mut any, mut prepared, mut failed) = (false, true, true);
        for state in panels {
            any = true;
            prepared &= state == PreparationState::Prepared;
            failed &= state == PreparationState::Failed;
        }
        let stop = stop
            .filter(|stop| matches!(stop, PreparationState::Canceled | PreparationState::Paused));
        match stop {
            _ if any && prepared => PreparationState::Prepared,
            Some(stop) => stop,
            None if failed => PreparationState::Failed,
            None => PreparationState::Partial,
        }
    }

    /// What Retry of a Prepare all does with Panel `number`, whose revision
    /// reads `state`, of run `run` (D-W75, PREP-FR-12): a Partial or Paused
    /// revision resumes unless its run is in the Project's Trash or Complete,
    /// which Retry skips and names; any other revision has nothing to retry.
    #[must_use]
    pub fn panel_retry(number: u32, state: PreparationState, run: &View) -> PanelRetry {
        if !matches!(state, PreparationState::Partial | PreparationState::Paused) {
            return PanelRetry::Nothing;
        }
        if run.trashed_at.is_some() {
            PanelRetry::Skipped(format!("Panel {number} is in the Project's Trash; Retry skips it"))
        } else if run.completion == RunCompletion::Complete {
            PanelRetry::Skipped(format!("Panel {number} is Complete; Retry skips it"))
        } else {
            PanelRetry::Resumes
        }
    }
}

/// What Retry of a Prepare all does with one panel run (PREP-FR-12).
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PanelRetry {
    /// Its Partial or Paused revision runs again.
    Resumes,
    /// Partial or Paused, but its run is in the Project's Trash or Complete:
    /// why Retry skips it.
    Skipped(String),
    /// Its revision is neither Partial nor Paused: nothing to retry.
    Nothing,
}

/// One panel run's outcome of a group preparation revision.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelPreparationOutcome {
    pub number: u32,
    pub panel_id: Uuid,
    /// Its own outcome and offers: Open on a verified panel run stays
    /// available whatever the group reads.
    pub outcome: PreparationOutcome,
}

/// The outcome of a group preparation revision: each panel run's outcome and
/// what the group offers. Open on the group is offered only when every panel
/// run is verified (PREP-FR-13).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupPreparationOutcome {
    pub preparation: GroupPreparation,
    /// By panel number.
    pub panels: Vec<PanelPreparationOutcome>,
    /// `<Mosaic> Results/Assembled/`, where the assembled mosaic is saved.
    pub assembled: NativePath,
    pub offers: Vec<PreparationOffer>,
    /// The panel runs the Prepare all or Retry that ended here skipped, each
    /// with why: in the Project's Trash (D-W75) or, on Retry, Complete. By
    /// panel number; empty when this outcome is read later.
    pub skipped: Vec<PanelOutcome>,
}

impl GroupPreparationOutcome {
    /// Whether every panel run is verified: Prepared with nothing Open found
    /// changed.
    #[must_use]
    pub fn every_panel_verified(panels: &[PanelPreparationOutcome]) -> bool {
        !panels.is_empty()
            && panels.iter().all(|panel| panel.outcome.offers.contains(&PreparationOffer::Open))
    }

    /// What a Prepare all in `outcome` offers (PREP-FR-12/13): Open only when
    /// every panel run is `verified`, and Retry only when a panel run
    /// `resumes` ([`PanelRetry::Resumes`]); with none, a new Prepare all is
    /// the way on, never a Retry that is refused.
    #[must_use]
    pub fn offers_for(
        outcome: PreparationState,
        verified: bool,
        resumes: bool,
    ) -> Vec<PreparationOffer> {
        let mut offers = PreparationOutcome::offers_for(outcome, !verified);
        if !resumes {
            offers.retain(|offer| *offer != PreparationOffer::Retry);
        }
        offers
    }
}
