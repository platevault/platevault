// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! A Project's desired state (spec 065 PRJ-FR-05/08/27 to PRJ-FR-31, 066
//! VSEL-FR-12/15/16; D-W94 to D-W96, D-W100, D-W107, D-W109).
//!
//! The Project is the processing unit. It holds whole sessions the user
//! added, each in one group of one rig; groups follow framing, and the user
//! can create, split, rename and move them. For every session it holds the
//! exact logical captures (D16) and their copies as they were when added, so
//! a regroup, an availability change or an association edit never silently
//! replaces a chosen frame, and each capture is allocated once per Project.
//! A Project keeps no membership revisions: these records are the desired
//! state, the installed View manifest is the applied state, and a pending
//! change is a typed difference between them, labelled with its source. A
//! Project discards only its own edits; Library changes are fixed at their
//! source or by removing the session.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    comparison_key, validate_copies, AdmissionBasis, AdmissionBlocker, ApplicableQuality,
    FieldOfView, InputKind, LibraryError, NativePath, ObservationFingerprint, OpticsSignature,
    ProjectLifecycle, Revision, SessionFraming, SessionReadiness, SettledPin,
};

fn invalid(message: String) -> LibraryError {
    LibraryError::InvalidInput(message)
}

// ── View settings ────────────────────────────────────────────────────────────

/// How the View holds its inputs (PREP-FR-04, D-W81, D-W98). Copies are
/// clones wherever the volume supports them; switching goes through Apply.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum ViewMode {
    #[default]
    Symlinks,
    Copies,
}

/// A WBPP grouping keyword name such as GROUP or PANEL (PRJ-FR-28): ASCII
/// letters and digits, because WBPP reads `KEYWORD_value` folder names and an
/// underscore ends the keyword. NIGHT, GAIN and OFFSET are the View's own
/// keywords and never a group's.
#[derive(Clone, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct GroupKeyword(String);

impl GroupKeyword {
    pub const RESERVED: [&'static str; 3] = ["NIGHT", "GAIN", "OFFSET"];

    /// # Errors
    /// `InvalidInput` for an empty name, any character other than an ASCII
    /// letter or digit, or a reserved keyword in any case.
    pub fn new(name: &str) -> Result<Self, LibraryError> {
        if name.is_empty() || !name.bytes().all(|byte| byte.is_ascii_alphanumeric()) {
            return Err(invalid(format!(
                "keyword {name:?} must be ASCII letters and digits, with no underscore"
            )));
        }
        if Self::RESERVED.iter().any(|reserved| reserved.eq_ignore_ascii_case(name)) {
            return Err(invalid(format!("keyword {name} is reserved for the View")));
        }
        Ok(Self(name.to_owned()))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for GroupKeyword {
    type Error = LibraryError;
    fn try_from(name: String) -> Result<Self, Self::Error> {
        Self::new(&name)
    }
}

impl From<GroupKeyword> for String {
    fn from(keyword: GroupKeyword) -> Self {
        keyword.0
    }
}

/// The two group keyword names, distinct in any case.
#[derive(Clone, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(try_from = "KeywordNames")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct GroupKeywords {
    group: GroupKeyword,
    panel: GroupKeyword,
}

#[derive(Deserialize)]
#[cfg_attr(feature = "wire", derive(schemars::JsonSchema))]
struct KeywordNames {
    group: GroupKeyword,
    panel: GroupKeyword,
}

impl TryFrom<KeywordNames> for GroupKeywords {
    type Error = LibraryError;
    fn try_from(names: KeywordNames) -> Result<Self, Self::Error> {
        Self::from_keywords(names.group, names.panel)
    }
}

impl Default for GroupKeywords {
    fn default() -> Self {
        Self { group: GroupKeyword("GROUP".into()), panel: GroupKeyword("PANEL".into()) }
    }
}

impl GroupKeywords {
    /// # Errors
    /// `InvalidInput` for an invalid keyword or two that read the same.
    pub fn new(group: &str, panel: &str) -> Result<Self, LibraryError> {
        Self::from_keywords(GroupKeyword::new(group)?, GroupKeyword::new(panel)?)
    }

    fn from_keywords(group: GroupKeyword, panel: GroupKeyword) -> Result<Self, LibraryError> {
        if group.as_str().eq_ignore_ascii_case(panel.as_str()) {
            return Err(invalid(format!("GROUP and PANEL keywords both read {}", group.as_str())));
        }
        Ok(Self { group, panel })
    }

    #[must_use]
    pub const fn group(&self) -> &GroupKeyword {
        &self.group
    }

    #[must_use]
    pub const fn panel(&self) -> &GroupKeyword {
        &self.panel
    }
}

/// The View step's settings (VSEL-FR-16, PREP-FR-06).
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct ProjectViewSettings {
    pub mode: ViewMode,
    /// This Project's keyword names; `None` uses the Settings defaults.
    #[serde(default)]
    pub keywords: Option<GroupKeywords>,
    /// The application the View is handed to.
    #[serde(default)]
    pub profile_id: Option<Uuid>,
    /// The processing location `<Project>/` is created in: the last chosen
    /// parent. `None` until the user chooses one; there is no assumed root.
    #[serde(default)]
    pub parent: Option<NativePath>,
}

// ── Groups ───────────────────────────────────────────────────────────────────

/// A group's display name: trimmed, non-blank text with no control
/// character. Two groups of a Project never share its comparison key. The
/// folder token derived from it (spaces as hyphens, WBPP-safe characters) is
/// the layout's, and a rename changes the folder only on the next Apply.
#[derive(Clone, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct GroupName(String);

impl GroupName {
    /// # Errors
    /// `InvalidInput` for a blank name or a control character.
    pub fn new(name: &str) -> Result<Self, LibraryError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(invalid("a group name is blank".into()));
        }
        if name.chars().any(char::is_control) {
            return Err(invalid(format!("group name {name:?} holds a control character")));
        }
        Ok(Self(name.to_owned()))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// The comparison key that keeps two group names of a Project apart.
    #[must_use]
    pub fn key(&self) -> String {
        comparison_key(&self.0)
    }
}

impl TryFrom<String> for GroupName {
    type Error = LibraryError;
    fn try_from(name: String) -> Result<Self, Self::Error> {
        Self::new(&name)
    }
}

impl From<GroupName> for String {
    fn from(name: GroupName) -> Self {
        name.0
    }
}

/// Whether framing made a group or the user did (create or split). Framing
/// recomputation never changes a user group.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum GroupOrigin {
    Framing,
    User,
}

/// A group's framing: its anchor session's ICRS centre, rotations and field
/// (D-W107). The mechanical rotator angle (ROTATANG) and the sky angle stay
/// apart because they compare differently: ROTATANG modulo 360°, the sky
/// angle modulo 180°. A missing angle is unknown, never zero.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct FramingEvidence {
    pub ra_deg: f64,
    pub dec_deg: f64,
    #[serde(default)]
    pub rotator_deg: Option<f64>,
    #[serde(default)]
    pub sky_angle_deg: Option<f64>,
    #[serde(default)]
    pub field: Option<FieldOfView>,
}

impl FramingEvidence {
    /// # Errors
    /// `InvalidInput` for an angle outside its range or a field that is not
    /// positive.
    pub fn validate(&self) -> Result<(), LibraryError> {
        let (ra, dec) = (self.ra_deg, self.dec_deg);
        if !(ra.is_finite() && (0.0..360.0).contains(&ra)) {
            return Err(invalid(format!("framing raDeg {ra} must be in [0, 360)")));
        }
        if !(dec.is_finite() && (-90.0..=90.0).contains(&dec)) {
            return Err(invalid(format!("framing decDeg {dec} must be in [-90, 90]")));
        }
        for (name, angle) in [("rotatorDeg", self.rotator_deg), ("skyAngleDeg", self.sky_angle_deg)]
        {
            if let Some(angle) = angle {
                if !(angle.is_finite() && (0.0..360.0).contains(&angle)) {
                    return Err(invalid(format!("framing {name} {angle} must be in [0, 360)")));
                }
            }
        }
        if let Some(field) = self.field {
            let positive = |value: f64| value.is_finite() && value > 0.0;
            if !positive(field.width_deg) || !positive(field.height_deg) {
                return Err(invalid("a framing field must be positive".into()));
            }
        }
        Ok(())
    }
}

impl From<&SessionFraming> for FramingEvidence {
    fn from(framing: &SessionFraming) -> Self {
        Self {
            ra_deg: framing.ra_deg,
            dec_deg: framing.dec_deg,
            rotator_deg: framing.rotator_deg,
            sky_angle_deg: framing.sky_angle_deg,
            field: framing.field,
        }
    }
}

/// One group of a Project: one rig and one optical setup, named by the user.
/// A panel group carries only the PANEL token and its own goals.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct ProjectGroup {
    pub id: Uuid,
    pub rig_id: Uuid,
    pub name: GroupName,
    pub panel: bool,
    pub origin: GroupOrigin,
    pub optics: OpticsSignature,
    /// `None` reads "Framing unknown".
    pub framing: Option<FramingEvidence>,
    pub position: u32,
}

impl ProjectGroup {
    /// # Errors
    /// `InvalidInput` for invalid optics or framing.
    pub fn validate(&self) -> Result<(), LibraryError> {
        self.optics.validate()?;
        self.framing.as_ref().map_or(Ok(()), FramingEvidence::validate)
    }
}

// ── Membership ───────────────────────────────────────────────────────────────

/// Why a session sits in its group; a user move survives recomputation.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum SessionPlacement {
    Framing,
    User,
    /// No pointing evidence: in its rig's group, flagged "Framing unknown"
    /// until the user moves it.
    FramingUnknown,
}

/// One whole session the Project holds, with the admission basis it was
/// added on and the confirmed Target it joined on: the session keeps
/// counting toward that Target's subject after the Library re-confirms it as
/// a Target the Project lacks (PRJ-AC-26).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct ProjectSessionMember {
    pub session_id: Uuid,
    pub group_id: Uuid,
    pub placement: SessionPlacement,
    pub target_id: Uuid,
    pub grouping_revision: Revision,
    pub calibration_generation: Revision,
    pub added_at: String,
}

/// One copy of a held capture with its decision revision and observation
/// when it was chosen (D19): a later change shows as drift, never silently.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct CopyBasis {
    pub asset_id: Uuid,
    pub decision_revision: Revision,
    pub fingerprint: ObservationFingerprint,
}

/// Why an included capture is included (VSEL-FR-15).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum InclusionBasis {
    /// Usable when the session was added.
    Usable,
    /// The user included it although the Library had it Unusable.
    Explicit,
}

/// Why an excluded capture is excluded.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum ExclusionBasis {
    /// Library-Unusable when the session was added.
    Unusable,
    /// The user excluded it, in this Project only.
    User,
}

/// The Project's own choice for one capture. A later Library rejection is
/// not recorded here: it reads as a pending removal from the Library.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", rename_all_fields = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum CaptureInclusion {
    Included { basis: InclusionBasis },
    Excluded { basis: ExclusionBasis },
}

impl CaptureInclusion {
    #[must_use]
    pub const fn is_included(self) -> bool {
        matches!(self, Self::Included { .. })
    }

    /// A capture as its session joins: Usable frames are included, and
    /// every other one starts visibly excluded until the user includes it
    /// (VSEL-FR-15).
    #[must_use]
    pub fn on_add(quality: ApplicableQuality) -> Self {
        if quality == ApplicableQuality::Usable {
            Self::Included { basis: InclusionBasis::Usable }
        } else {
            Self::Excluded { basis: ExclusionBasis::Unusable }
        }
    }

    /// The user's choice for a capture whose live quality is `quality`.
    #[must_use]
    pub fn chosen(choice: FrameChoice, quality: ApplicableQuality) -> Self {
        match choice {
            FrameChoice::Exclude => Self::Excluded { basis: ExclusionBasis::User },
            FrameChoice::Include => Self::Included { basis: InclusionBasis::Explicit },
            FrameChoice::FollowLibrary => Self::on_add(quality),
        }
    }

    /// Whether the next build places the capture, with `live` its live
    /// logical quality (`None` when no copy is live). An explicit choice
    /// holds either way; a capture that follows the Library is in only while
    /// it is Usable, so a later Library rejection removes it and a
    /// restoration adds it back; a capture with no live copy is never placed
    /// (VSEL-FR-15, D-W109).
    #[must_use]
    pub fn admits(self, live: Option<ApplicableQuality>) -> bool {
        match (self, live) {
            (_, None) | (Self::Excluded { basis: ExclusionBasis::User }, _) => false,
            (Self::Included { basis: InclusionBasis::Explicit }, Some(_)) => true,
            (_, Some(quality)) => quality == ApplicableQuality::Usable,
        }
    }
}

/// What the user chooses for held frames (VSEL-FR-10, VSEL-FR-15). Files
/// stay on disk and library quality is untouched.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum FrameChoice {
    /// Exclude from this Project only.
    Exclude,
    /// Include whatever the Library says, Unusable frames too.
    Include,
    /// Follow the Library again: Usable frames in, the others out.
    FollowLibrary,
}

/// One logical capture (D16) the Project holds, keyed by its smallest copy's
/// asset id, with every copy once in id order.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct ProjectCapture {
    pub capture_key: Uuid,
    pub session_id: Uuid,
    pub copies: Vec<CopyBasis>,
    pub inclusion: CaptureInclusion,
    pub quality_when_added: ApplicableQuality,
}

impl ProjectCapture {
    /// The capture of `copies`, keyed by the smallest.
    ///
    /// # Errors
    /// `InvalidInput` for no copy or a copy named twice.
    pub fn new(
        session_id: Uuid,
        mut copies: Vec<CopyBasis>,
        inclusion: CaptureInclusion,
        quality_when_added: ApplicableQuality,
    ) -> Result<Self, LibraryError> {
        copies.sort_by_key(|copy| copy.asset_id);
        let capture_key = copies.first().map(|copy| copy.asset_id).unwrap_or_default();
        let capture = Self { capture_key, session_id, copies, inclusion, quality_when_added };
        capture.validate()?;
        Ok(capture)
    }

    /// # Errors
    /// `InvalidInput` unless the key is the smallest of copies listed once.
    pub fn validate(&self) -> Result<(), LibraryError> {
        validate_copies(self.capture_key, &self.copies)
    }
}

/// Everything a Project holds as its intent, read in one snapshot.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct ProjectDesired {
    pub project_id: Uuid,
    /// The Project revision every desired-state edit advances; an Apply sheet
    /// records the one it was built from.
    pub revision: Revision,
    pub lifecycle: ProjectLifecycle,
    pub settings: ProjectViewSettings,
    pub groups: Vec<ProjectGroup>,
    pub sessions: Vec<ProjectSessionMember>,
    pub captures: Vec<ProjectCapture>,
}

impl ProjectDesired {
    /// Groups once by id and name; each session once, in one of the
    /// Project's groups; each capture once, of a held session; each copy
    /// allocated once.
    ///
    /// # Errors
    /// `InvalidInput` naming the broken invariant.
    pub fn validate(&self) -> Result<(), LibraryError> {
        let mut groups = BTreeSet::new();
        let mut names = BTreeSet::new();
        for group in &self.groups {
            group.validate()?;
            if !groups.insert(group.id) {
                return Err(invalid(format!("group {} is listed twice", group.id)));
            }
            if !names.insert(group.name.key()) {
                return Err(invalid(format!("two groups are named {}", group.name.as_str())));
            }
        }
        let mut sessions = BTreeMap::new();
        for member in &self.sessions {
            if !groups.contains(&member.group_id) {
                return Err(invalid(format!(
                    "session {} sits in group {}, which the Project lacks",
                    member.session_id, member.group_id
                )));
            }
            if sessions.insert(member.session_id, member.group_id).is_some() {
                return Err(invalid(format!("session {} is held twice", member.session_id)));
            }
        }
        let mut keys = BTreeSet::new();
        let mut copies = BTreeSet::new();
        for capture in &self.captures {
            capture.validate()?;
            if !sessions.contains_key(&capture.session_id) {
                return Err(invalid(format!(
                    "capture {} belongs to session {}, which the Project doesn't hold",
                    capture.capture_key, capture.session_id
                )));
            }
            if !keys.insert(capture.capture_key) {
                return Err(invalid(format!("capture {} is held twice", capture.capture_key)));
            }
            if let Some(copy) = capture.copies.iter().find(|copy| !copies.insert(copy.asset_id)) {
                return Err(invalid(format!("copy {} is allocated twice", copy.asset_id)));
            }
        }
        Ok(())
    }
}

/// A Ready session a Project suggests and doesn't hold (PRJ-FR-09): its
/// confirmed Target is one of the Project's subjects and its confirmed rig is
/// on the Project's rig list. A suggestion is never added by itself.
/// `blockers` names what keeps it out for now, such as calibration that isn't
/// settled ("Choose its flats first"); with none it can be added at `basis`.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct ProjectSuggestion {
    pub session_id: Uuid,
    pub subject_id: Uuid,
    pub rig_id: Uuid,
    pub basis: AdmissionBasis,
    pub blockers: Vec<AdmissionBlocker>,
}

// ── Pending changes ──────────────────────────────────────────────────────────

/// Where a pending change came from (VSEL-FR-12).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChangeSource {
    /// The Project's own edit: it can be discarded.
    Project,
    /// A Library change, such as a rejected frame or calibration reassigned
    /// on a session: fixed at its source, or by removing the session.
    Library,
}

/// One difference between a Project's desired state and its applied View,
/// computed on read and never stored. A Closed Project has none.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "change", rename_all = "snake_case", rename_all_fields = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum PendingChange {
    SessionAdded {
        session_id: Uuid,
        group_id: Uuid,
    },
    SessionRemoved {
        session_id: Uuid,
        group_id: Uuid,
    },
    SessionMoved {
        session_id: Uuid,
        from_group: Uuid,
        to_group: Uuid,
    },
    FramesIncluded {
        session_id: Uuid,
        capture_keys: Vec<Uuid>,
    },
    FramesExcluded {
        session_id: Uuid,
        capture_keys: Vec<Uuid>,
    },
    GroupAdded {
        group_id: Uuid,
        name: GroupName,
    },
    GroupRemoved {
        group_id: Uuid,
        name: GroupName,
    },
    GroupRenamed {
        group_id: Uuid,
        from: GroupName,
        to: GroupName,
    },
    GroupPanelChanged {
        group_id: Uuid,
        panel: bool,
    },
    ModeSwitched {
        from: ViewMode,
        to: ViewMode,
    },
    KeywordsChanged {
        from: GroupKeywords,
        to: GroupKeywords,
    },
    /// Frames the Library rejected, or whose every copy left the Library
    /// (Trashed), since the View was applied: a pending removal.
    LibraryRejected {
        session_id: Uuid,
        capture_keys: Vec<Uuid>,
    },
    /// Frames the Library made Usable again: a pending addition.
    LibraryRestored {
        session_id: Uuid,
        capture_keys: Vec<Uuid>,
    },
    /// A session's calibration reassigned since the View was applied; `None`
    /// when the kind needs calibration again, which Apply refuses.
    CalibrationChanged {
        session_id: Uuid,
        kind: InputKind,
        from: SettledPin,
        to: Option<SettledPin>,
    },
    /// A held session is no longer Ready in the Library: its review was
    /// reopened, or its Target or rig association changed (LIB-FR-20,
    /// VSEL-FR-12). The Project keeps it; the marks a reopened review
    /// changes arrive as [`Self::LibraryRejected`] and
    /// [`Self::LibraryRestored`].
    SessionNotReady {
        session_id: Uuid,
        readiness: SessionReadiness,
    },
    /// A regroup in the Library replaced a held session. The Project keeps
    /// the session and the exact frames it chose and never moves to the
    /// successors by itself; the user removes it and adds a successor.
    SessionRegrouped {
        session_id: Uuid,
        successors: Vec<Uuid>,
    },
}

impl PendingChange {
    #[must_use]
    pub const fn source(&self) -> ChangeSource {
        match self {
            Self::LibraryRejected { .. }
            | Self::LibraryRestored { .. }
            | Self::CalibrationChanged { .. }
            | Self::SessionNotReady { .. }
            | Self::SessionRegrouped { .. } => ChangeSource::Library,
            _ => ChangeSource::Project,
        }
    }

    /// Only the Project's own edits can be discarded on the Project (D-W109).
    #[must_use]
    pub const fn discardable(&self) -> bool {
        matches!(self.source(), ChangeSource::Project)
    }
}
