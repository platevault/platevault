// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! What the Apply sheet reads and what one Apply reports (spec 066
//! VSEL-FR-14/20/21, 069 PREP-FR-06/08/09/15/18/19, 071 STO-FR-10; D-W98 to
//! D-W100, D-W110, D-W113, D-W114).
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
    NativePath, PinHealth, PreviousItem, ProjectLifecycle, ProjectOperationKind, Revision,
    ViewMode,
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
    pub error: Option<String>,
}
