// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Tonight (spec 072 PLAN-FR-11, PLAN-AC-11/12, D-W39, D-W63, D-W89) on the
//! [`Library`] facade: Home's Tonight section at the default site. It holds
//! every unfinished goal of an open Project graded for tonight under its
//! channel's Moon-avoidance curve ([`crate::goal_grades`]), best first, with
//! the next good night when none suits tonight, and the best window tonight
//! of every Target in My targets, which are the ★ favourites and every
//! subject of an open Project (D-W60), with the night's Moon and darkness
//! window. Every window comes from [`planning::compute_windows`] for that one
//! night, the computation behind the Plan area, so it is the Plan area's
//! window for the same site, night and criteria (PV-PLAN-SC-04). A mosaic
//! subject is planned at its subject Target's position. Targets without a
//! window tonight are left out. Read-only.

use serde::{Deserialize, Serialize};
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::goal_grades::{grade_night, next_good_night, GoalGrade};
use crate::library::{blocking, Library};
use crate::planning;
use crate::{
    DarknessWindow, LibraryError, NightMoon, ObservingSite, ObservingWindow, PlanCriteria,
    PlanningUnknownReason, ProjectBadge, SiteBasis, TargetRecord, WindowQuery,
};

time::serde::format_description!(iso_date, Date, "[year]-[month]-[day]");

/// What Home asks Tonight for: explicit criteria and, for a fixed night, its
/// site-local evening date; absent, the night that holds now at the default
/// site.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct TonightQuery {
    #[cfg_attr(feature = "wire", specta(type = Option<String>), schemars(with = "Option<String>"))]
    #[serde(default, with = "iso_date::option")]
    pub night: Option<Date>,
    pub criteria: PlanCriteria,
}

/// One Target's best window tonight, with why it is in My targets.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct TonightWindow {
    pub target_id: Uuid,
    pub designation: String,
    /// Marked ★.
    pub favourite: bool,
    /// The open Projects that have the Target as a subject, in name order.
    pub projects: Vec<ProjectBadge>,
    /// Start, end, peak altitude, duration, site name and time zone, exactly
    /// as the Plan area lists the window.
    pub window: ObservingWindow,
}

/// Home's Tonight section. Without a default site nothing is computed:
/// `site`, `night`, `moon`, `darkness` and `nextGoodNight` are absent,
/// `goals` and `windows` are empty and `unavailableReason` reads "Add an
/// observing site in Settings".
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct Tonight {
    pub site: Option<SiteBasis>,
    pub time_zone: Option<String>,
    #[cfg_attr(feature = "wire", specta(type = Option<String>), schemars(with = "Option<String>"))]
    #[serde(default, with = "iso_date::option")]
    pub night: Option<Date>,
    pub criteria: PlanCriteria,
    /// Every unfinished goal of an open Project graded for tonight, best
    /// first; the criteria's Moon limit gives way to each band's curve.
    pub goals: Vec<GoalGrade>,
    /// When no goal suits tonight, the first of the next
    /// [`crate::goal_grades::NEXT_GOOD_NIGHT_SEARCH`] nights that suits one;
    /// absent when a goal suits tonight, there is no unfinished goal, or no
    /// night in that span suits one.
    #[cfg_attr(feature = "wire", specta(type = Option<String>), schemars(with = "Option<String>"))]
    #[serde(default, with = "iso_date::option")]
    pub next_good_night: Option<Date>,
    /// One per Target with a window tonight, by start, then designation.
    pub windows: Vec<TonightWindow>,
    pub moon: Option<NightMoon>,
    /// Tonight's darkness at the criteria's level; absent on a night that is
    /// never that dark.
    pub darkness: Option<DarknessWindow>,
    pub method: String,
    pub unavailable_reason: Option<PlanningUnknownReason>,
}

impl Tonight {
    /// Whether the Target has a window tonight: Home's Next rule 3 input
    /// (PRJ-FR-18).
    #[must_use]
    pub fn has_window(&self, target_id: Uuid) -> bool {
        self.windows.iter().any(|window| window.target_id == target_id)
    }
}

impl Library {
    /// Tonight at the default site: the best window of each Target in My
    /// targets that has one, the Moon and the darkness window. Read-only.
    ///
    /// # Errors
    /// `InvalidInput` for invalid criteria, an unbundled zone or a night
    /// outside the supported calendar; `PersistenceFailure` when the catalog
    /// cannot be read.
    pub async fn tonight(&self, query: &TonightQuery) -> Result<Tonight, LibraryError> {
        query.criteria.validate()?;
        let sites = self.catalog().list_sites().await?;
        let Some(site) = sites.default_site_id else {
            return Ok(Tonight {
                site: None,
                time_zone: None,
                night: None,
                criteria: query.criteria,
                goals: Vec::new(),
                next_good_night: None,
                windows: Vec::new(),
                moon: None,
                darkness: None,
                method: planning::METHOD.into(),
                unavailable_reason: Some(PlanningUnknownReason::NoSite),
            });
        };
        let site = self.catalog().site(site).await?;
        let marks = self.catalog().my_target_marks().await?;
        let mut records = Vec::new();
        for id in marks.ids() {
            records.push(self.catalog().target(id).await?);
        }
        let goals = self.unfinished_goals().await?;
        let avoidance = self.catalog().workflow_settings().await?.0.moon_avoidance;
        let (criteria, night) = (query.criteria, query.night);
        let (night, sky, best, graded, next) = blocking(move || {
            let night = match night {
                Some(night) => night,
                None => planning::night_of(OffsetDateTime::now_utc(), &site)?,
            };
            let sky = planning::night_sky(&site, night, criteria.darkness)?;
            let best = best_windows(records, &site, night, criteria)?;
            let graded: Vec<GoalGrade> = grade_night(&goals, &site, night, criteria, &avoidance)?
                .into_iter()
                .map(|graded| graded.grade)
                .collect();
            let next = if goals.is_empty() || graded.iter().any(GoalGrade::suits) {
                None
            } else {
                next_good_night(&goals, &site, night, criteria, &avoidance)?
            };
            Ok((night, sky, best, graded, next))
        })
        .await?;
        let mut windows: Vec<TonightWindow> = best
            .into_iter()
            .map(|(record, window)| {
                let id = record.candidate.id;
                TonightWindow {
                    target_id: id,
                    designation: record.candidate.designation,
                    favourite: marks.favourites.contains(&id),
                    projects: marks.badges.get(&id).cloned().unwrap_or_default(),
                    window,
                }
            })
            .collect();
        windows.sort_by(|first, second| {
            first
                .window
                .start_utc
                .cmp(&second.window.start_utc)
                .then_with(|| first.designation.cmp(&second.designation))
                .then_with(|| first.target_id.cmp(&second.target_id))
        });
        Ok(Tonight {
            site: Some(sky.site),
            time_zone: Some(sky.time_zone),
            night: Some(night),
            criteria,
            goals: graded,
            next_good_night: next,
            windows,
            moon: Some(sky.moon),
            darkness: sky.darkness,
            method: sky.method,
            unavailable_reason: None,
        })
    }
}

/// Each record's best window of `night`; a record without a usable position
/// or without a window that night is left out.
fn best_windows(
    records: Vec<TargetRecord>,
    site: &ObservingSite,
    night: Date,
    criteria: PlanCriteria,
) -> Result<Vec<(TargetRecord, ObservingWindow)>, LibraryError> {
    let mut best = Vec::with_capacity(records.len());
    for record in records {
        let query = WindowQuery {
            target_id: record.candidate.id,
            site_id: site.id,
            first_night: night,
            nights: 1,
            criteria,
        };
        let set = planning::compute_windows(&record, site, &query)?;
        if let Some(window) = set.nights.into_iter().flat_map(|night| night.windows).reduce(better)
        {
            best.push((record, window));
        }
    }
    Ok(best)
}

/// The better of two windows of one night: the longer, then the one with the
/// higher peak altitude, then the earlier.
pub(crate) fn better(first: ObservingWindow, second: ObservingWindow) -> ObservingWindow {
    let order = first
        .duration_minutes
        .cmp(&second.duration_minutes)
        .then_with(|| first.peak_altitude_deg.total_cmp(&second.peak_altitude_deg))
        .then_with(|| second.start_utc.cmp(&first.start_utc));
    if order.is_lt() {
        second
    } else {
        first
    }
}
