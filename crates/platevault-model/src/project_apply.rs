// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! What the Apply sheet reads and what one Apply reports (spec 066
//! VSEL-FR-14/20/21, 069 PREP-FR-03/06/08/09/15/18/19/20, 071 STO-FR-10;
//! D-W98 to D-W100, D-W110, D-W113, D-W114, D-W122, D-W123).
//!
//! The sheet is computed, never stored: the folder tree the next build
//! places, every reason Apply can't run now, the files `PlateVault` didn't
//! place with their tick boxes, the copies a tool changed and what
//! `View (previous)/` still holds. It records the Project revision and a
//! digest of the exact basis it showed; Apply refuses when either moved.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    ApplyOutcome, EntryEvidence, EntryPlacement, EntrySource, ForeignItem, InputKind, ItemReason,
    NativePath, PinHealth, PreviousItem, ProjectLifecycle, ProjectOperationKind, ReasonCode,
    Revision, ViewMode,
};

/// One reason Apply can't run now. The sheet lists every one; Apply refuses
/// while any holds and changes nothing.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "blocker", rename_all = "snake_case", rename_all_fields = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum ApplyBlocker {
    /// A Closing, Closed or Archived Project takes no Apply.
    ProjectLocked { lifecycle: ProjectLifecycle },
    /// One `PlateVault` operation per Project (PREP-FR-19).
    OperationRunning { operation_id: Uuid, kind: ProjectOperationKind },
    /// No processing location chosen yet; there is no assumed root.
    NoProcessingLocation,
    /// The chosen processing location is missing, not a real folder or not
    /// writable; another must be chosen, never substituted (PREP-AC-09).
    ProcessingLocationUnavailable { path: NativePath, detail: String },
    /// Before the first Apply the Project folder already holds something
    /// `PlateVault` didn't make (PREP-AC-02).
    ProjectFolderOccupied { path: NativePath },
    /// Symlinks mode where symlinks can't be made: on Windows, Developer
    /// Mode is off. Copies is offered for this Project (PREP-FR-15).
    SymlinksUnavailable { detail: String },
    /// An original the build needs is on a location that is offline now
    /// (VSEL-AC-31, STO-FR-08).
    OriginalOffline { path: NativePath, location_id: Uuid },
    /// A light original is missing or no longer matches its recorded basis.
    OriginalChanged { path: NativePath, detail: String },
    /// A pinned calibration file changed or went missing; the pin stays and
    /// the session links to Reassign (D-W113).
    PinDrift { session_id: Uuid, kind: InputKind, health: PinHealth },
    /// A held session's calibration is no longer settled.
    CalibrationUnsettled { session_id: Uuid, kinds: Vec<InputKind> },
    /// Two groups or two filter values would share one folder.
    FolderClash { detail: String },
    /// `View (previous)/` holds leftovers the user hasn't reviewed (D-W110).
    LeftoversPending { count: u64 },
    /// `View (previous)/` still holds kept files. What the next outgoing View
    /// does with them is open with the owner (decision record §9), so Apply
    /// refuses until they are moved or trashed.
    PreviousHoldsKeptFiles { paths: Vec<NativePath> },
    /// `View (building)/` holds files this Project's Apply didn't place.
    BuildingOccupied { path: NativePath },
    /// A held frame's recorded correction can't reach the application: no
    /// isolated patched copy of `path`, the original, can carry `field`
    /// (PREP-FR-03). Apply refuses before it builds rather than let the
    /// source value reach the tool.
    CorrectionUndeliverable {
        session_id: Uuid,
        path: NativePath,
        field: String,
        refusal: PatchRefusal,
    },
    /// An entry in `View/` or `View (previous)/`, or that folder itself,
    /// can't be read, or the folder is a link: the sheet can't account for
    /// it, so Apply refuses before it starts (VSEL-FR-20, STO-FR-05/16).
    ViewUnreadable { path: NativePath, reason: ReasonCode },
}

/// Why no isolated patched copy can carry a recorded correction
/// (PREP-FR-03, PREP-FR-20; D-W123). `PlateVault` patches FITS and XISF
/// headers, writing each value to one fixed-format card it can hold.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum PatchRefusal {
    /// The input is neither FITS nor XISF.
    UnsupportedFormat,
    /// The file holds no header `PlateVault` can read.
    NoHeader,
    /// `PlateVault` writes no header keyword for the corrected field.
    NoKeyword,
    /// The correction clears the field, and a header card holds no empty
    /// value.
    NoValue,
    /// The value holds a character outside printable ASCII, which FITS
    /// can't hold.
    NotPrintableAscii,
    /// The field's keyword holds a number and the value isn't one.
    NotANumber,
    /// The value doesn't fit one 80-character card on its own; it is never
    /// continued on CONTINUE cards.
    TooLong,
    /// The FITS primary header holds `NAXIS = 0`: the image lies in an
    /// extension, whose header `PlateVault` doesn't patch.
    ImageInExtension,
    /// The FITS header holds a `HIERARCH` card naming an alias of the field
    /// (`TELESCOPE`, `INSTRUMENT`) in a spelling the header crate can't
    /// address, so the copy would keep the old value there.
    HierarchAlias,
    /// The XISF layout isn't one the in-place edit splices: no single
    /// `<Image>` with an attachment, a self-closing `<Image>` that would
    /// take an added keyword, or attachment blocks it can't move safely.
    XisfLayout,
}

impl PatchRefusal {
    /// An English diagnostic for logs and the sheet's one-line reason.
    #[must_use]
    pub const fn describe(self) -> &'static str {
        match self {
            Self::UnsupportedFormat => "PlateVault patches FITS and XISF headers only",
            Self::NoHeader => "it holds no header PlateVault can read",
            Self::NoKeyword => "PlateVault writes no header keyword for it",
            Self::NoValue => "the correction clears it, and a header card holds no empty value",
            Self::NotPrintableAscii => "the value is not printable ASCII, which a FITS card needs",
            Self::NotANumber => "the value is not the number its keyword holds",
            Self::TooLong => "the value does not fit one FITS header card",
            Self::ImageInExtension => {
                "its image lies in an extension, whose header PlateVault does not patch"
            }
            Self::HierarchAlias => {
                "its header holds a HIERARCH alias of the field in a spelling PlateVault can't \
                 patch"
            }
            Self::XisfLayout => "its XISF layout is not one PlateVault can patch",
        }
    }
}

impl ApplyBlocker {
    /// The sheet's one-line reason.
    #[must_use]
    pub fn describe(&self) -> String {
        match self {
            Self::ProjectLocked { lifecycle } => format!("a {lifecycle} Project takes no Apply"),
            Self::OperationRunning { operation_id, kind } => {
                format!("another operation ({kind:?}, {operation_id}) is running on this Project")
            }
            Self::NoProcessingLocation => "choose a processing location first".into(),
            Self::ProcessingLocationUnavailable { path, detail } => {
                format!("the processing location {} is unavailable: {detail}", path.display())
            }
            Self::ProjectFolderOccupied { path } => format!(
                "{} already holds files PlateVault didn't place; choose another name or location",
                path.display()
            ),
            Self::SymlinksUnavailable { detail } => {
                format!("Can't apply · symlinks need Windows Developer Mode ({detail})")
            }
            Self::OriginalOffline { path, .. } => format!("{} is offline", path.display()),
            Self::OriginalChanged { path, detail } => format!("{}: {detail}", path.display()),
            Self::PinDrift { session_id, kind, health } => {
                format!("session {session_id}: the pinned {kind:?} is {health:?}; reassign it")
            }
            Self::CalibrationUnsettled { session_id, kinds } => {
                format!("session {session_id}: choose its {kinds:?} first")
            }
            Self::FolderClash { detail } => detail.clone(),
            Self::LeftoversPending { count } => {
                format!("review the {count} file(s) left in View (previous)/ first")
            }
            Self::PreviousHoldsKeptFiles { paths } => format!(
                "View (previous)/ still holds {} kept file(s); move or trash them first",
                paths.len()
            ),
            Self::BuildingOccupied { path } => {
                format!("{} holds files PlateVault didn't place", path.display())
            }
            Self::CorrectionUndeliverable { session_id, path, field, refusal } => format!(
                "session {session_id}: the corrected {field} of {} can't be delivered: {}",
                path.display(),
                refusal.describe()
            ),
            Self::ViewUnreadable { path, .. } => {
                format!("{} can't be read, so Apply can't account for it", path.display())
            }
        }
    }
}

/// One entry the next build places, relative to `View/`.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct ViewPlanEntry {
    pub path: NativePath,
    pub source: EntrySource,
    /// Copies may become clones as they are built.
    pub placement: EntryPlacement,
    pub size_bytes: u64,
}

/// A file in the current View that `PlateVault` didn't place (VSEL-FR-20),
/// offered with a tick box.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct ForeignFile {
    /// Relative to `View/`.
    pub path: NativePath,
    pub evidence: EntryEvidence,
}

/// The Apply sheet's backend part, read-only.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct ApplyPreview {
    pub project_id: Uuid,
    /// The Project revision the sheet shows (VSEL-FR-21).
    pub desired_revision: Revision,
    /// The installed View's manifest generation; `None` before the first Apply.
    pub applied_generation: Option<Revision>,
    /// SHA-256 of the exact basis shown; Apply refuses once it differs.
    pub basis_digest: String,
    /// `<Processing location>/<Project>/`, once a location is chosen.
    pub project_folder: Option<NativePath>,
    pub mode: ViewMode,
    /// The new View as a folder tree, in path order.
    pub entries: Vec<ViewPlanEntry>,
    /// Bytes the Copies build writes (clones may take less). The old View
    /// stays until the swap, so Copies needs room for both.
    pub copy_bytes: u64,
    pub foreign: Vec<ForeignFile>,
    /// Copies in the current View that differ from what `PlateVault`
    /// placed; they stay in `View (previous)/` (VSEL-AC-28).
    pub changed_copies: Vec<NativePath>,
    /// What `View (previous)/` still holds, with its review.
    pub leftovers: Vec<PreviousItem>,
    pub blockers: Vec<ApplyBlocker>,
}

/// What the user confirmed in the sheet.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct ApplyRequest {
    pub project_id: Uuid,
    pub desired_revision: Revision,
    pub basis_digest: String,
    /// The foreign files, relative to `View/`, that move into the new View.
    #[serde(default)]
    pub ticked: Vec<NativePath>,
}

/// One input the build could not place.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct ApplyFailure {
    /// The original, or the entry relative to `View/`.
    pub path: NativePath,
    pub reason: ItemReason,
}

/// How one Apply ended, or where it stopped when `PlateVault` closed during
/// it (`outcome` `None`; the next start finishes or rolls it back).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct ApplyReport {
    pub project_id: Uuid,
    pub operation_id: Uuid,
    pub generation: Revision,
    pub outcome: Option<ApplyOutcome>,
    pub failures: Vec<ApplyFailure>,
    pub foreign: Vec<ForeignItem>,
    /// What `View (previous)/` still holds for review.
    pub leftovers: Vec<PreviousItem>,
    /// "N corrected values written to patched copies" (PREP-FR-03, D-W122):
    /// the corrected fields of the held sessions, one per session and
    /// field, that the installed View's patched copies carry; 0 unless
    /// Applied. It claims nothing about what an application reads from
    /// them: per-tool delivery evidence is open (D-W123, J23 G10).
    pub corrected_values: u64,
    /// The isolated patched copies the installed View holds, one per held
    /// frame with a recorded correction; 0 unless Applied. Each was re-read
    /// to differ from its original only by its corrected header.
    pub patched_copies: u64,
    pub error: Option<String>,
}
