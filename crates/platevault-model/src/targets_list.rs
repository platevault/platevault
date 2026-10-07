// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The Targets list (spec 072 PLAN-TGT-FR-01..05/07..10): My targets and Browse
//! catalogues, unified search, tonight's planning columns computed in Rust,
//! Sessions and Captured per channel over live frames, and the built-in and
//! saved presets. Nothing here performs I/O.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use time::Date;
use uuid::Uuid;

use crate::{
    Band, Catalogue, FieldOfView, LibraryError, NightMoon, PlanCriteria, Revision, SiteBasis,
    TargetCandidate,
};

time::serde::format_description!(iso_date, Date, "[year]-[month]-[day]");

/// Longest saved preset name, in characters.
pub const MAX_PRESET_NAME: usize = 80;

fn invalid(message: String) -> LibraryError {
    LibraryError::InvalidInput(message)
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/// What the Targets page lists: My targets (the default) or Browse catalogues.
#[derive(Clone, Copy, Debug, Default, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TargetsShow {
    #[default]
    MyTargets,
    Browse,
}

/// The built-in presets (PLAN-TGT-FR-09, PLAN-TGT-FR-12). The app offers no
/// "Avoid tonight".
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BuiltinPreset {
    BestTonightBroadband,
    NarrowbandMoonUp,
    EmissionNebulaeHa,
    GalaxiesDarkSky,
    PlanetaryNebulaeOiii,
    /// Offered only with a rig selected.
    MosaicCandidates,
    /// Offered only with a rig selected.
    FitsNicely,
}

impl BuiltinPreset {
    /// Every built-in preset, in menu order.
    pub const ALL: [Self; 7] = [
        Self::BestTonightBroadband,
        Self::NarrowbandMoonUp,
        Self::EmissionNebulaeHa,
        Self::GalaxiesDarkSky,
        Self::PlanetaryNebulaeOiii,
        Self::MosaicCandidates,
        Self::FitsNicely,
    ];

    /// Whether the preset is offered only with a rig selected (PLAN-TGT-FR-12).
    #[must_use]
    pub const fn needs_rig(self) -> bool {
        matches!(self, Self::MosaicCandidates | Self::FitsNicely)
    }

    /// Whether the preset is hidden when the selected rigs pass no Ha, SII or
    /// OIII (PLAN-TGT-FR-13).
    #[must_use]
    pub const fn needs_narrowband(self) -> bool {
        matches!(
            self,
            Self::NarrowbandMoonUp | Self::EmissionNebulaeHa | Self::PlanetaryNebulaeOiii
        )
    }

    /// Whether the preset is offered for the selected rigs and the bands they
    /// capture together. With no rig selected every preset except the
    /// rig-only ones is offered.
    #[must_use]
    pub fn offered(self, rig_selected: bool, bands: &[Band]) -> bool {
        if self.needs_rig() {
            return rig_selected;
        }
        !(rig_selected
            && self.needs_narrowband()
            && !bands.iter().any(|band| matches!(band, Band::Ha | Band::Sii | Band::Oiii)))
    }

    /// The menu name.
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::BestTonightBroadband => "Best tonight (broadband)",
            Self::NarrowbandMoonUp => "Narrowband (Moon up)",
            Self::EmissionNebulaeHa => "Emission nebulae Ha",
            Self::GalaxiesDarkSky => "Galaxies dark sky",
            Self::PlanetaryNebulaeOiii => "Planetary nebulae OIII",
            Self::MosaicCandidates => "Mosaic candidates",
            Self::FitsNicely => "Fits nicely",
        }
    }

    /// The definition shown with the preset.
    #[must_use]
    pub const fn definition(self) -> &'static str {
        match self {
            Self::BestTonightBroadband => {
                "Img time above zero with a broadband band viable, sorted by Img time descending."
            }
            Self::NarrowbandMoonUp => {
                "Img time above zero with Ha, SII or OIII viable while the Moon is up."
            }
            Self::EmissionNebulaeHa => "Emission nebulae with Ha viable.",
            Self::GalaxiesDarkSky => {
                "Galaxies with Img time above zero while the Moon is below the horizon."
            }
            Self::PlanetaryNebulaeOiii => "Planetary nebulae with OIII viable.",
            Self::MosaicCandidates => "Targets that need 2 or more panels on a selected rig.",
            Self::FitsNicely => "Targets covering 25% to 90% of a selected rig's field.",
        }
    }

    /// The sort the preset applies when the query names none.
    #[must_use]
    pub const fn sort(self) -> Option<TargetsSort> {
        match self {
            Self::BestTonightBroadband => {
                Some(TargetsSort { column: TargetsColumn::ImgTime, descending: true })
            }
            Self::NarrowbandMoonUp
            | Self::EmissionNebulaeHa
            | Self::GalaxiesDarkSky
            | Self::PlanetaryNebulaeOiii
            | Self::MosaicCandidates
            | Self::FitsNicely => None,
        }
    }
}

/// A sortable column; ★ is not sortable.
#[derive(Clone, Copy, Debug, Default, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TargetsColumn {
    #[default]
    Designation,
    Type,
    MaxAlt,
    Lunar,
    ImgTime,
    Filters,
    Opposition,
    Sessions,
    Captured,
}

/// The sort; the default is Designation ascending. Unknown values sort last
/// in either direction.
#[derive(Clone, Copy, Debug, Default, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetsSort {
    pub column: TargetsColumn,
    #[serde(default)]
    pub descending: bool,
}

/// One Targets list request: the Show mode, the chosen catalogues and preset,
/// the planning site (absent: the default site), the night by its site-local
/// evening date (absent: tonight), the planning criteria, the sort (absent: the
/// preset's sort, else Designation ascending) and an optional page.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetsQuery {
    #[serde(default)]
    pub show: TargetsShow,
    #[serde(default)]
    pub catalogues: Vec<Catalogue>,
    #[serde(default)]
    pub preset: Option<BuiltinPreset>,
    #[serde(default)]
    pub site_id: Option<Uuid>,
    #[serde(default, with = "iso_date::option")]
    pub night: Option<Date>,
    pub criteria: PlanCriteria,
    #[serde(default)]
    pub sort: Option<TargetsSort>,
    #[serde(default)]
    pub offset: u32,
    /// Rows after `offset`; absent lists every remaining row.
    #[serde(default)]
    pub limit: Option<u32>,
    /// The rigs Fit and the Filters strip are for (absent: no rig).
    #[serde(default)]
    pub rigs: RigSelection,
}

/// The toolbar's rig selector (PLAN-TGT-FR-11): no rig (the default), one rig
/// from Settings > Equipment, or "this Project's rigs" in a Project's context.
#[derive(Clone, Copy, Debug, Default, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum RigSelection {
    #[default]
    None,
    Rig {
        equipment_id: Uuid,
    },
    Project {
        project_id: Uuid,
    },
}

impl TargetsQuery {
    /// # Errors
    /// `InvalidInput` for invalid criteria or a zero limit.
    pub fn validate(&self) -> Result<(), LibraryError> {
        if self.limit == Some(0) {
            return Err(invalid("limit must be at least 1 when given".into()));
        }
        self.criteria.validate()
    }

    /// The sort in effect.
    #[must_use]
    pub fn effective_sort(&self) -> TargetsSort {
        self.sort.or_else(|| self.preset.and_then(BuiltinPreset::sort)).unwrap_or_default()
    }
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/// The open Project a My targets subject belongs to (D-W60).
#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectBadge {
    pub project_id: Uuid,
    pub name: String,
}

/// The ★ favourites and the open-Project subjects with their badges: together
/// they make My targets.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MyTargetMarks {
    pub favourites: BTreeSet<Uuid>,
    /// Open Projects by subject Target, in Project name order.
    pub badges: BTreeMap<Uuid, Vec<ProjectBadge>>,
}

impl MyTargetMarks {
    /// Whether the Target is in My targets.
    #[must_use]
    pub fn contains(&self, id: Uuid) -> bool {
        self.favourites.contains(&id) || self.badges.contains_key(&id)
    }

    /// Every Target in My targets.
    #[must_use]
    pub fn ids(&self) -> BTreeSet<Uuid> {
        self.favourites.iter().chain(self.badges.keys()).copied().collect()
    }
}

/// Why a row's planning columns read "-".
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanningUnknownReason {
    /// "Add an observing site in Settings".
    NoSite,
    /// "This target has no catalogued coordinates, so visibility can't be computed."
    TargetCoordinatesUnknown,
    UnsupportedCoordinateFrame,
}

/// Why tonight's Img time is zero (PLAN-TGT-FR-05).
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImgTimeZeroReason {
    /// The Target does not clear the altitude criterion long enough in darkness.
    Altitude,
    /// The Moon criterion excludes the time the Target is up in darkness.
    Moon,
    /// The night is never dark enough, or not for long enough.
    Darkness,
}

/// One band of the Filters strip: viable tonight, or limited by the Moon.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BandState {
    pub band: Band,
    pub viable: bool,
}

/// The Filters strip's recommendation label.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Recommendation {
    BroadbandOk,
    NarrowbandOnly,
    AvoidTonight,
}

/// Captured integration of one channel: the FILTER value, absent when the
/// frames name none.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelIntegration {
    pub channel: Option<String>,
    pub seconds: f64,
    pub frames: u32,
}

/// Sessions and Captured of one Target: current sessions whose confirmed
/// Target it is, over frames outside the Trash, whatever their quality.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetActivity {
    pub sessions: u32,
    /// By channel, unnamed channel first.
    pub captured: Vec<ChannelIntegration>,
}

impl TargetActivity {
    /// Total captured seconds over every channel.
    #[must_use]
    pub fn captured_seconds(&self) -> f64 {
        self.captured.iter().map(|channel| channel.seconds).sum()
    }
}

/// One Targets list row. The planning values are for the page's night, site
/// and criteria; each is absent with `unknownReason` when it cannot be
/// computed. Img time equals the total of the Plan area windows for the night.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetRow {
    pub target: TargetCandidate,
    /// Whether the Target is a saved library record.
    pub saved: bool,
    pub favourite: bool,
    /// Open Projects that have the Target as a subject.
    pub projects: Vec<ProjectBadge>,
    /// Peak geometric altitude within tonight's dark interval.
    pub max_altitude_deg: Option<f64>,
    /// Separation from the Moon at the night's midpoint.
    pub lunar_separation_deg: Option<f64>,
    pub img_time_minutes: Option<u32>,
    pub img_time_zero_reason: Option<ImgTimeZeroReason>,
    /// The Filters strip's bands (the page's `bands`); empty when unknown.
    pub bands: Vec<BandState>,
    pub recommendation: Option<Recommendation>,
    #[serde(with = "iso_date::option")]
    pub next_opposition: Option<Date>,
    pub unknown_reason: Option<PlanningUnknownReason>,
    pub sessions: u32,
    pub captured: Vec<ChannelIntegration>,
    /// One Fit per selected rig, in the page's `rigs` order; empty with no rig.
    pub fit: Vec<RigFit>,
}

// ---------------------------------------------------------------------------
// Rigs and Fit
// ---------------------------------------------------------------------------

/// Coverage at or above which a Target that fits one field reads "fits".
pub const FIT_MIN_COVERAGE: f64 = 0.25;
/// Coverage at or below which a fitting Target fits nicely.
pub const FITS_NICELY_MAX_COVERAGE: f64 = 0.90;

/// A selected rig as the Targets page plans for it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetsRig {
    pub equipment_id: Uuid,
    pub name: String,
    /// Bands the rig captures, in [`Band`] order.
    pub bands: Vec<Band>,
    /// `None` when the sensor size, pixel size or focal length is unknown.
    pub field_of_view: Option<FieldOfView>,
}

/// Why Fit reads "-".
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FitUnknownReason {
    /// The Target has no catalogued angular size.
    SizeUnknown,
    /// The rig's field of view is unknown.
    FieldOfViewUnknown,
}

impl FitUnknownReason {
    /// The reason shown beside "-".
    #[must_use]
    pub const fn text(self) -> &'static str {
        match self {
            Self::SizeUnknown => "Size unknown",
            Self::FieldOfViewUnknown => "Field of view unknown",
        }
    }
}

/// A Target's fit in one rig's field (PLAN-TGT-FR-11). `coverage` is the
/// Target's major axis as a share of the field's shorter side.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum Fit {
    /// Fits one field with coverage of at least 25%.
    Fits { coverage: f64 },
    /// Needs a grid of `panels` fields, at least 2.
    Panels { coverage: f64, panels: u32 },
    /// Fits one field with coverage below 25%.
    Tiny { coverage: f64 },
    /// Reads "-" with the reason.
    Unknown { reason: FitUnknownReason },
}

impl Fit {
    /// What the Fit column reads: "fits", "N panels", "tiny" or "-".
    #[must_use]
    pub fn label(&self) -> String {
        match self {
            Self::Fits { .. } => "fits".into(),
            Self::Panels { panels, .. } => format!("{panels} panels"),
            Self::Tiny { .. } => "tiny".into(),
            Self::Unknown { .. } => "-".into(),
        }
    }

    /// The reason shown beside "-"; `None` for a known fit.
    #[must_use]
    pub const fn reason(&self) -> Option<FitUnknownReason> {
        match self {
            Self::Unknown { reason } => Some(*reason),
            Self::Fits { .. } | Self::Panels { .. } | Self::Tiny { .. } => None,
        }
    }

    /// Mosaic candidates: 2 or more panels.
    #[must_use]
    pub const fn is_mosaic_candidate(&self) -> bool {
        matches!(self, Self::Panels { .. })
    }

    /// Fits nicely: coverage of 25% to 90%.
    #[must_use]
    pub fn fits_nicely(&self) -> bool {
        matches!(self, Self::Fits { coverage } if *coverage <= FITS_NICELY_MAX_COVERAGE)
    }
}

/// One rig's Fit for a row, labeled with the rig name.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RigFit {
    pub equipment_id: Uuid,
    pub rig_name: String,
    pub fit: Fit,
}

/// What a page's planning values were computed for.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetsBasis {
    pub site: SiteBasis,
    pub time_zone: String,
    #[serde(with = "iso_date")]
    pub night: Date,
    pub criteria: PlanCriteria,
    pub method: String,
}

/// One Targets list page. The Moon appears here once, for the toolbar, and in
/// no row. With no planning site, `basis` and `moon` are absent and
/// `planningUnavailable` names the reason.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetsPage {
    pub basis: Option<TargetsBasis>,
    pub moon: Option<NightMoon>,
    pub planning_unavailable: Option<PlanningUnknownReason>,
    /// Browse catalogues with neither a catalogue nor a preset: no rows.
    pub needs_catalogue_or_preset: bool,
    /// Rows before paging.
    pub total: u32,
    pub rows: Vec<TargetRow>,
    /// The selected rigs, in selector order; empty with no rig.
    pub rigs: Vec<TargetsRig>,
    /// The Filters strip: all seven bands with no rig, else the union of the
    /// bands the selected rigs capture, in [`Band`] order.
    pub bands: Vec<Band>,
}

// ---------------------------------------------------------------------------
// Search and Add to targets
// ---------------------------------------------------------------------------

/// Where a search result comes from.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TargetsSearchSource {
    MyTargets,
    /// A saved library Target outside My targets.
    Library,
    /// A bundled catalogue.
    Catalogue,
    Simbad,
}

/// One search result. A result outside My targets offers "Add to targets".
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetsSearchResult {
    pub target: TargetCandidate,
    pub source: TargetsSearchSource,
    pub in_my_targets: bool,
    pub matched_alias: Option<String>,
}

/// Whether SIMBAD was searched.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum SimbadSearch {
    Searched,
    NotSearched { reason: String },
}

/// Search results over My targets, the bundled catalogues and SIMBAD.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetsSearchResults {
    pub results: Vec<TargetsSearchResult>,
    pub simbad: SimbadSearch,
}

/// The Target "Add to targets" writes into the library and My targets.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "source", rename_all = "snake_case")]
pub enum AddTarget {
    /// A saved library Target.
    Saved { id: Uuid },
    /// A bundled catalogue object.
    Seed { id: Uuid },
    /// A SIMBAD result, resolved again from its query.
    Simbad { query: String },
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/// The filters a saved preset restores.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetFilters {
    #[serde(default)]
    pub show: TargetsShow,
    #[serde(default)]
    pub catalogues: Vec<Catalogue>,
    #[serde(default)]
    pub preset: Option<BuiltinPreset>,
    #[serde(default)]
    pub sort: TargetsSort,
}

/// A built-in preset with its name and definition.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuiltinPresetInfo {
    pub preset: BuiltinPreset,
    pub name: String,
    pub definition: String,
}

/// A saved preset at its revision, starting at 1.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedPreset {
    pub id: Uuid,
    pub name: String,
    pub filters: PresetFilters,
    pub revision: Revision,
}

/// The built-ins, then the saved presets by name.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetsPresets {
    pub builtin: Vec<BuiltinPresetInfo>,
    pub saved: Vec<SavedPreset>,
}

/// A preset a rename or delete names.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PresetRef {
    Builtin { preset: BuiltinPreset },
    Saved { id: Uuid },
}

/// Refuse a blank or overlong saved preset name, or one a built-in uses.
///
/// # Errors
/// `InvalidInput` naming `name`.
pub fn validate_preset_name(name: &str) -> Result<(), LibraryError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(invalid("name: a preset needs a name".into()));
    }
    if name.chars().count() > MAX_PRESET_NAME {
        return Err(invalid(format!(
            "name: a preset name has at most {MAX_PRESET_NAME} characters"
        )));
    }
    if BuiltinPreset::ALL.iter().any(|preset| preset.name().eq_ignore_ascii_case(name)) {
        return Err(invalid(format!("name: {name:?} is a built-in preset")));
    }
    Ok(())
}
