// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Observing plans (spec 072): saved sites and the default site, the Planned
//! mark, reminder subscriptions and delivery records, computed observing windows
//! and calendar snapshots.
//!
//! Suitability is astronomical only: no type here carries weather, equipment,
//! availability or processing readiness, and none asks for a provider account.
//! Windows, upcoming reminders and calendar snapshots are computed on read and
//! never stored. No delivery state claims that a user saw a notification.

use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use time::{Date, OffsetDateTime, PrimitiveDateTime, UtcOffset};
use uuid::Uuid;

use crate::{ChecklistProgress, LibraryError, NativePath, Revision, TargetCoverage, TargetRecord};

/// Most nights one window request covers.
pub const MAX_NIGHTS: u32 = 366;
/// Longest minimum window duration and longest reminder lead time, in minutes.
pub const MAX_MINUTES: u32 = 1440;

fn invalid(message: String) -> LibraryError {
    LibraryError::InvalidInput(message)
}

time::serde::format_description!(iso_date, Date, "[year]-[month]-[day]");

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------

/// A saved observing site as the user enters it. The time zone is an IANA name
/// the user chooses; it is never derived from the coordinates.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteInput {
    pub name: String,
    pub latitude_deg: f64,
    /// East-positive.
    pub longitude_deg: f64,
    #[serde(default)]
    pub elevation_m: Option<f64>,
    pub time_zone: String,
}

impl SiteInput {
    /// Validate the fields the model can check. The zone name is checked
    /// against the bundled time-zone database by the windows module.
    ///
    /// # Errors
    /// `InvalidInput` naming the field for a blank name, a latitude outside
    /// [-90, 90], a longitude outside [-180, 180], a non-finite value or an
    /// empty zone name.
    pub fn validate(&self) -> Result<(), LibraryError> {
        if self.name.trim().is_empty() {
            return Err(invalid("name: a site needs a non-empty name".into()));
        }
        if !self.latitude_deg.is_finite() || !(-90.0..=90.0).contains(&self.latitude_deg) {
            return Err(invalid(format!(
                "latitudeDeg {} is not a finite angle in [-90, 90]",
                self.latitude_deg
            )));
        }
        if !self.longitude_deg.is_finite() || !(-180.0..=180.0).contains(&self.longitude_deg) {
            return Err(invalid(format!(
                "longitudeDeg {} is not a finite east-positive angle in [-180, 180]",
                self.longitude_deg
            )));
        }
        if let Some(elevation) = self.elevation_m.filter(|value| !value.is_finite()) {
            return Err(invalid(format!("elevationM {elevation} is not a finite height")));
        }
        if self.time_zone.trim().is_empty() {
            return Err(invalid("timeZone: a site needs an IANA time-zone name".into()));
        }
        Ok(())
    }
}

/// A saved site with its own decision revision, starting at 1.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservingSite {
    pub id: Uuid,
    pub name: String,
    pub latitude_deg: f64,
    pub longitude_deg: f64,
    pub elevation_m: Option<f64>,
    pub time_zone: String,
    pub revision: Revision,
    pub created_at: String,
    pub updated_at: String,
}

impl ObservingSite {
    /// The site as a computation basis names it.
    #[must_use]
    pub fn basis(&self) -> SiteBasis {
        SiteBasis {
            id: self.id,
            name: self.name.clone(),
            revision: self.revision,
            latitude_deg: self.latitude_deg,
            longitude_deg: self.longitude_deg,
            elevation_m: self.elevation_m,
        }
    }
}

/// The site a window set, review or calendar snapshot was computed for.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteBasis {
    pub id: Uuid,
    pub name: String,
    pub revision: Revision,
    pub latitude_deg: f64,
    pub longitude_deg: f64,
    pub elevation_m: Option<f64>,
}

/// The one stored planning setting: the default site, or explicitly none. A
/// catalog that never saved it reads no default at revision 0.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanningSettings {
    pub default_site_id: Option<Uuid>,
    pub revision: Revision,
}

/// Every saved site with the default site and the settings revision.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanningSites {
    pub sites: Vec<ObservingSite>,
    pub default_site_id: Option<Uuid>,
    pub settings_revision: Revision,
}

/// A committed site save and the Targets whose subscriptions it moved to
/// `needs_reconfirmation` in the same transaction.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteSaved {
    pub site: ObservingSite,
    pub needs_reconfirmation: Vec<Uuid>,
}

/// A committed default-site change and the Targets whose subscriptions it moved
/// to `needs_reconfirmation` in the same transaction.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DefaultSiteSaved {
    pub settings: PlanningSettings,
    pub needs_reconfirmation: Vec<Uuid>,
}

/// The Planned mark of a saved Target. A Target without a stored mark reads not
/// Planned at revision 0. Writing it never changes the Target record.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetPlan {
    pub target_id: Uuid,
    pub planned: bool,
    pub revision: Revision,
    pub updated_at: Option<String>,
}

// ---------------------------------------------------------------------------
// Criteria and window queries
// ---------------------------------------------------------------------------

/// How dark the sky must be: the Sun below -6, -12 or -18 degrees.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Darkness {
    Civil,
    Nautical,
    Astronomical,
}

impl Darkness {
    /// The Sun's geometric altitude limit in degrees.
    #[must_use]
    pub const fn sun_altitude_deg(self) -> f64 {
        match self {
            Self::Civil => -6.0,
            Self::Nautical => -12.0,
            Self::Astronomical => -18.0,
        }
    }
}

/// The Moon limit: none, the Moon's center below the geometric horizon, or a
/// least separation whenever the Moon is up.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum MoonCriterion {
    None,
    BelowHorizon,
    MinSeparation { min_separation_deg: f64 },
}

/// Explicit astronomical criteria; every field is required and none defaults.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanCriteria {
    /// Geometric target altitude above a flat horizon, without refraction.
    pub min_altitude_deg: f64,
    pub darkness: Darkness,
    pub moon: MoonCriterion,
    /// Shortest window kept after inward rounding to whole minutes.
    pub min_duration_minutes: u32,
}

impl PlanCriteria {
    /// # Errors
    /// `InvalidInput` naming the field for an altitude outside [0, 90), a
    /// minimum duration outside 1 to 1440 minutes or a Moon separation outside
    /// (0, 180) degrees.
    pub fn validate(&self) -> Result<(), LibraryError> {
        if !self.min_altitude_deg.is_finite() || !(0.0..90.0).contains(&self.min_altitude_deg) {
            return Err(invalid(format!(
                "minAltitudeDeg {} is not a finite altitude in [0, 90)",
                self.min_altitude_deg
            )));
        }
        if !(1..=MAX_MINUTES).contains(&self.min_duration_minutes) {
            return Err(invalid(format!(
                "minDurationMinutes {} is not a whole number of minutes from 1 to {MAX_MINUTES}",
                self.min_duration_minutes
            )));
        }
        if let MoonCriterion::MinSeparation { min_separation_deg } = self.moon {
            if !min_separation_deg.is_finite()
                || min_separation_deg <= 0.0
                || min_separation_deg >= 180.0
            {
                return Err(invalid(format!(
                    "moon.minSeparationDeg {min_separation_deg} is not a finite angle in (0, 180)"
                )));
            }
        }
        Ok(())
    }
}

/// One window request: a saved Target, a planning site, the first night by its
/// site-local evening date, the number of nights and explicit criteria. The
/// planning site is a request parameter, never a stored record.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowQuery {
    pub target_id: Uuid,
    pub site_id: Uuid,
    #[serde(with = "iso_date")]
    pub first_night: Date,
    pub nights: u32,
    pub criteria: PlanCriteria,
}

impl WindowQuery {
    /// # Errors
    /// `InvalidInput` naming `nights` outside 1 to 366, or the invalid criterion.
    pub fn validate(&self) -> Result<(), LibraryError> {
        if !(1..=MAX_NIGHTS).contains(&self.nights) {
            return Err(invalid(format!(
                "nights {} is not a count from 1 to {MAX_NIGHTS}",
                self.nights
            )));
        }
        self.criteria.validate()
    }
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

/// The identity of one window: Target, site and UTC start at a whole minute.
/// Repeat suppression and calendar UIDs both use it. Its text form is
/// `<target>/<site>/<YYYY-MM-DDTHH:MMZ>`.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash)]
pub struct WindowKey {
    target_id: Uuid,
    site_id: Uuid,
    start_utc: OffsetDateTime,
}

impl WindowKey {
    /// # Errors
    /// `InvalidInput` naming `windowKey` when the start is not a whole minute.
    pub fn new(
        target_id: Uuid,
        site_id: Uuid,
        start: OffsetDateTime,
    ) -> Result<Self, LibraryError> {
        let start_utc = start.to_offset(UtcOffset::UTC);
        if start_utc.second() != 0 || start_utc.nanosecond() != 0 {
            return Err(invalid(format!("windowKey start {start_utc} is not a whole UTC minute")));
        }
        Ok(Self { target_id, site_id, start_utc })
    }

    #[must_use]
    pub const fn target_id(&self) -> Uuid {
        self.target_id
    }

    #[must_use]
    pub const fn site_id(&self) -> Uuid {
        self.site_id
    }

    #[must_use]
    pub const fn start_utc(&self) -> OffsetDateTime {
        self.start_utc
    }
}

impl fmt::Display for WindowKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let start = self.start_utc;
        write!(
            f,
            "{}/{}/{:04}-{:02}-{:02}T{:02}:{:02}Z",
            self.target_id,
            self.site_id,
            start.year(),
            u8::from(start.month()),
            start.day(),
            start.hour(),
            start.minute()
        )
    }
}

impl FromStr for WindowKey {
    type Err = LibraryError;

    fn from_str(text: &str) -> Result<Self, Self::Err> {
        let malformed = || invalid(format!("windowKey {text:?} is not <target>/<site>/<start>"));
        let mut parts = text.split('/');
        let (Some(target), Some(site), Some(start), None) =
            (parts.next(), parts.next(), parts.next(), parts.next())
        else {
            return Err(malformed());
        };
        let target = Uuid::parse_str(target).map_err(|_| malformed())?;
        let site = Uuid::parse_str(site).map_err(|_| malformed())?;
        let start = PrimitiveDateTime::parse(
            start,
            time::macros::format_description!("[year]-[month]-[day]T[hour]:[minute]Z"),
        )
        .map_err(|_| malformed())?;
        Self::new(target, site, start.assume_utc())
    }
}

impl Serialize for WindowKey {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_str(self)
    }
}

impl<'de> Deserialize<'de> for WindowKey {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let text = String::deserialize(deserializer)?;
        text.parse().map_err(serde::de::Error::custom)
    }
}

/// One observing window. Every listed minute meets the criteria; local times
/// carry the site zone's offset at each boundary.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservingWindow {
    pub key: WindowKey,
    #[serde(with = "time::serde::rfc3339")]
    pub start_utc: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub end_utc: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub start_local: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub end_local: OffsetDateTime,
    pub time_zone: String,
    pub duration_minutes: u32,
    #[serde(with = "iso_date")]
    pub night: Date,
    pub site_name: String,
}

/// Why a night has no window.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NoWindowReason {
    NeverDark,
    TargetNeverAbove,
    MoonExcluded,
    ShorterThanMinimum,
    NoOverlap,
}

/// Why a Target yields no nights at all. Unknown coordinates never become a
/// zero position.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WindowUnavailableReason {
    TargetCoordinatesUnknown,
    UnsupportedCoordinateFrame,
}

/// One night, labeled by the site-local date of its evening: its windows, or the
/// reason it has none.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NightPlan {
    #[serde(with = "iso_date")]
    pub night: Date,
    pub windows: Vec<ObservingWindow>,
    pub no_window_reason: Option<NoWindowReason>,
}

/// What a window set was computed from.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowBasis {
    pub target_id: Uuid,
    pub target_revision: Revision,
    pub designation: String,
    pub site: SiteBasis,
    pub time_zone: String,
    pub criteria: PlanCriteria,
    pub method: String,
}

/// Windows for one Target and site, one entry per night.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowSet {
    pub basis: WindowBasis,
    pub nights: Vec<NightPlan>,
    pub unavailable_reason: Option<WindowUnavailableReason>,
}

impl WindowSet {
    /// Every window of every night in time order.
    pub fn windows(&self) -> impl Iterator<Item = &ObservingWindow> {
        self.nights.iter().flat_map(|night| night.windows.iter())
    }
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

/// What a reminder review or activation names explicitly: the Target, the
/// criteria and the lead time. The site is always the default site.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderInput {
    pub target_id: Uuid,
    pub criteria: PlanCriteria,
    pub lead_minutes: u32,
}

impl ReminderInput {
    /// # Errors
    /// `InvalidInput` naming `leadMinutes` outside 1 to 1440, or the invalid
    /// criterion.
    pub fn validate(&self) -> Result<(), LibraryError> {
        if !(1..=MAX_MINUTES).contains(&self.lead_minutes) {
            return Err(invalid(format!(
                "leadMinutes {} is not a whole number of minutes from 1 to {MAX_MINUTES}",
                self.lead_minutes
            )));
        }
        self.criteria.validate()
    }
}

/// Activation repeats the reviewed values: the default site and its revision,
/// and the settings revision, which must still match when it commits.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnableReminders {
    pub reminder: ReminderInput,
    pub site_id: Uuid,
    pub site_revision: Revision,
    pub settings_revision: Revision,
    /// The subscription revision the user saw; none when there is none yet.
    #[serde(default)]
    pub expected_revision: Option<Revision>,
}

/// Why notification permission is unavailable.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnavailableReason {
    /// macOS authorizes only a process with a bundle identifier.
    UnbundledProcess,
    /// No qualified notification adapter exists for this platform.
    PlatformNotQualified,
    /// Provisional or ephemeral authorization, which is not full permission.
    LimitedAuthorization,
    /// The application attached no notification adapter.
    NotifierNotAttached,
}

/// OS notification permission as the notification adapter reports it. Only
/// `granted` lets a reminder be submitted.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum PermissionState {
    Granted,
    Denied,
    NotDetermined,
    Unavailable { reason: UnavailableReason },
}

impl PermissionState {
    /// Why this permission blocks a subscription; `None` when granted.
    #[must_use]
    pub const fn block_reason(&self) -> Option<BlockReason> {
        match self {
            Self::Granted => None,
            Self::Denied => Some(BlockReason::PermissionDenied),
            Self::NotDetermined => Some(BlockReason::PermissionNotDetermined),
            Self::Unavailable { reason } => Some(match reason {
                UnavailableReason::UnbundledProcess => BlockReason::UnbundledProcess,
                UnavailableReason::PlatformNotQualified => BlockReason::PlatformNotQualified,
                UnavailableReason::LimitedAuthorization => BlockReason::LimitedAuthorization,
                UnavailableReason::NotifierNotAttached => BlockReason::NotifierNotAttached,
            }),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SubscriptionState {
    /// Activated with granted permission; the only state that schedules.
    Enabled,
    /// Permission was not granted at activation or before a submission.
    Blocked,
    /// The default site changed or was cleared, or the subscribed site was edited.
    NeedsReconfirmation,
    /// Explicitly disabled.
    Disabled,
}

/// Why a subscription is blocked.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BlockReason {
    PermissionDenied,
    PermissionNotDetermined,
    UnbundledProcess,
    PlatformNotQualified,
    LimitedAuthorization,
    NotifierNotAttached,
}

/// What a blocked subscription offers.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecoveryAction {
    /// Open the platform notification settings.
    Settings,
    /// Repeat activation with the shown values.
    Retry,
}

impl BlockReason {
    /// A denial offers Settings and Retry; every other reason offers Retry.
    #[must_use]
    pub fn actions(self) -> Vec<RecoveryAction> {
        match self {
            Self::PermissionDenied => vec![RecoveryAction::Settings, RecoveryAction::Retry],
            _ => vec![RecoveryAction::Retry],
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AppClosedReason {
    NoInstalledScheduler,
}

/// Whether reminders can arrive while the application is closed. No installed,
/// tested scheduler exists, so this is always unavailable.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppClosedDelivery {
    pub available: bool,
    pub reason: AppClosedReason,
}

impl AppClosedDelivery {
    pub const UNAVAILABLE: Self =
        Self { available: false, reason: AppClosedReason::NoInstalledScheduler };
}

/// A per-Target reminder subscription with the values confirmed at activation.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderSubscription {
    pub target_id: Uuid,
    pub site_id: Uuid,
    pub site_name: String,
    pub site_revision: Revision,
    pub settings_revision: Revision,
    pub criteria: PlanCriteria,
    pub lead_minutes: u32,
    pub state: SubscriptionState,
    pub block_reason: Option<BlockReason>,
    /// What a blocked subscription offers; empty in every other state.
    pub actions: Vec<RecoveryAction>,
    pub revision: Revision,
    pub activated_at: String,
    pub updated_at: String,
}

/// A reminder computed on read: due from window start minus the lead time
/// until window start.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpcomingReminder {
    pub target_id: Uuid,
    pub designation: String,
    pub site_id: Uuid,
    pub site_name: String,
    pub window_key: WindowKey,
    #[serde(with = "time::serde::rfc3339")]
    pub due_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub start_utc: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub end_utc: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub start_local: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub end_local: OffsetDateTime,
    pub time_zone: String,
    #[serde(with = "iso_date")]
    pub night: Date,
    pub lead_minutes: u32,
}

/// What became of a claimed window identity. No state says delivered: an OS
/// acceptance does not prove the user saw the notice.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryState {
    /// Committed before submission; the identity is taken.
    Sending,
    /// The OS notification center accepted the request.
    Submitted,
    /// The adapter refused or returned an error.
    Failed,
    /// Left `sending` by an interrupted run; never sent again.
    Uncertain,
}

/// The durable record of one window identity's reminder.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderDelivery {
    pub window_key: WindowKey,
    pub target_id: Uuid,
    pub site_id: Uuid,
    pub site_name: String,
    #[serde(with = "time::serde::rfc3339")]
    pub window_start_utc: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub window_end_utc: OffsetDateTime,
    #[serde(with = "iso_date")]
    pub night: Date,
    #[serde(with = "time::serde::rfc3339")]
    pub due_at: OffsetDateTime,
    pub state: DeliveryState,
    pub reason: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// A read-only review of reminder activation against the default site.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderReview {
    pub target_id: Uuid,
    pub designation: String,
    pub site: SiteBasis,
    pub time_zone: String,
    pub settings_revision: Revision,
    pub criteria: PlanCriteria,
    pub lead_minutes: u32,
    pub permission: PermissionState,
    pub app_closed_delivery: AppClosedDelivery,
    /// The Target's current subscription revision, when one exists.
    pub subscription_revision: Option<Revision>,
    pub upcoming: Vec<UpcomingReminder>,
}

/// Reminder state read in one call; reading it writes nothing.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderStatus {
    pub scheduler_running: bool,
    pub permission: PermissionState,
    pub app_closed_delivery: AppClosedDelivery,
    pub subscriptions: Vec<ReminderSubscription>,
    pub upcoming: Vec<UpcomingReminder>,
    /// Newest first.
    pub deliveries: Vec<ReminderDelivery>,
}

// ---------------------------------------------------------------------------
// Calendar export
// ---------------------------------------------------------------------------

/// The windows a calendar export confirms, by key, from one window query.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSelection {
    pub query: WindowQuery,
    pub window_keys: Vec<WindowKey>,
}

impl ExportSelection {
    /// # Errors
    /// `InvalidInput` naming `windowKeys` when it is empty, or the invalid query.
    pub fn validate(&self) -> Result<(), LibraryError> {
        if self.window_keys.is_empty() {
            return Err(invalid("windowKeys: a calendar export needs at least one window".into()));
        }
        self.query.validate()
    }
}

/// A one-time calendar snapshot: the selected windows in time order with the
/// site, zone, night range and criteria they were computed for. It is never
/// stored; the saved file is the snapshot.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarSnapshot {
    pub target_id: Uuid,
    pub target_revision: Revision,
    pub designation: String,
    pub site: SiteBasis,
    pub time_zone: String,
    #[serde(with = "iso_date")]
    pub first_night: Date,
    #[serde(with = "iso_date")]
    pub last_night: Date,
    pub criteria: PlanCriteria,
    pub windows: Vec<ObservingWindow>,
}

/// A read-only export review; export repeats the request with its digest.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarExportReview {
    #[serde(flatten)]
    pub snapshot: CalendarSnapshot,
    pub snapshot_digest: String,
    pub suggested_file_name: String,
}

/// The synced calendar file an export wrote.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarFile {
    pub path: NativePath,
    pub byte_count: u64,
    pub sha256: String,
    pub window_count: u32,
}

/// `{saved: false}` when the save dialog was canceled and nothing was written,
/// else `{saved: true, path, byteCount, sha256, windowCount}`.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarExportOutcome {
    pub saved: bool,
    #[serde(flatten)]
    pub file: Option<CalendarFile>,
}

impl CalendarExportOutcome {
    #[must_use]
    pub const fn canceled() -> Self {
        Self { saved: false, file: None }
    }

    #[must_use]
    pub const fn saved(file: CalendarFile) -> Self {
        Self { saved: true, file: Some(file) }
    }
}

// ---------------------------------------------------------------------------
// Target overview
// ---------------------------------------------------------------------------

/// A Project framing the Target with the checklist items its progress reports
/// unmet or unknown, copied without recomputation.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGap {
    pub project_id: Uuid,
    pub name: String,
    pub revision: Revision,
    pub items: Vec<ChecklistProgress>,
}

/// The Plan area's read of one Target. It holds no window: windows need an
/// explicit site and criteria.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanTargetOverview {
    pub target: TargetRecord,
    pub plan: TargetPlan,
    pub sites: Vec<ObservingSite>,
    pub default_site_id: Option<Uuid>,
    pub settings_revision: Revision,
    pub subscription: Option<ReminderSubscription>,
    pub coverage: TargetCoverage,
    pub project_gaps: Vec<ProjectGap>,
}
