// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Tonight (spec 072 PLAN-FR-11, PLAN-AC-11/12, D-W39, D-W63, D-W89) on the
//! [`Library`] facade: Home's Tonight section at the default site under
//! Home's stored criteria ([`Library::home_criteria`]), the one source Home's
//! Tonight and calendar read. It holds every unfinished goal of an open
//! Project graded for tonight under its channel's Moon-avoidance curve
//! ([`crate::goal_grades`]), best first, with when they are next suited, and
//! the best window tonight of every Target in My targets, which are the ★
//! favourites and every subject of an open Project (D-W60), with the night's
//! Moon and darkness window. Every window comes from
//! [`planning::compute_windows`] for that one night, the computation behind
//! the Plan area, so it is the Plan area's window for the same site, night
//! and criteria (PV-PLAN-SC-04). A mosaic subject is planned at its subject
//! Target's position. Targets without a window tonight are left out.
//! Read-only.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::goal_grades::{
    grade_night, next_good_night, GoalGrade, HomePlanningUnavailable, NextGoodNight,
};
use crate::library::{blocking, Library};
use crate::planning::{self, NightContext};
use crate::{
    DarknessWindow, GoalProgress, LibraryError, NightMoon, ObservingSite, ObservingWindow,
    PlanCriteria, Project, ProjectBadge, SiteBasis, TargetRecord, WindowQuery,
};

time::serde::format_description!(iso_date, Date, "[year]-[month]-[day]");

/// What Home asks Tonight for: for a fixed night, its site-local evening
/// date; absent, the night that holds now at the default site. The criteria
/// are Home's stored ones.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct TonightQuery {
    #[cfg_attr(feature = "wire", specta(type = Option<String>), schemars(with = "Option<String>"))]
    #[serde(default, with = "iso_date::option")]
    pub night: Option<Date>,
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

/// Home's Tonight section. Without a default site, or with one but without
/// Home's criteria, nothing is computed: `night`, `moon`, `darkness` and
/// `nextGoodNight` are absent, `goals` and `windows` are empty and
/// `unavailableReason` names what is missing, the site first; `site` and
/// `timeZone` name the default site when there is one.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct Tonight {
    pub site: Option<SiteBasis>,
    pub time_zone: Option<String>,
    #[cfg_attr(feature = "wire", specta(type = Option<String>), schemars(with = "Option<String>"))]
    #[serde(default, with = "iso_date::option")]
    pub night: Option<Date>,
    /// Home's stored criteria, as computed under.
    pub criteria: Option<PlanCriteria>,
    /// Every unfinished goal of an open Project graded for tonight, best
    /// first; the criteria's Moon limit gives way to each band's curve.
    pub goals: Vec<GoalGrade>,
    /// Whether a goal suits tonight and, when none does, the next night
    /// that suits one, no gradable goal, or none in the searched span.
    pub next_good_night: Option<NextGoodNight>,
    /// One per Target with a window tonight, by start, then designation.
    pub windows: Vec<TonightWindow>,
    pub moon: Option<NightMoon>,
    /// Tonight's darkness at the criteria's level; absent on a night that is
    /// never that dark.
    pub darkness: Option<DarknessWindow>,
    pub method: String,
    pub unavailable_reason: Option<HomePlanningUnavailable>,
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
    /// Tonight at the default site under Home's stored criteria: every
    /// unfinished goal of an open Project graded for tonight with when they
    /// are next suited, the best window of each Target in My targets that
    /// has one, the Moon and the darkness window. Read-only.
    ///
    /// # Errors
    /// `InvalidInput` for an unbundled zone or a night outside the supported
    /// calendar; `PersistenceFailure` when the catalog or Home's recorded
    /// criteria cannot be read.
    pub async fn tonight(&self, query: &TonightQuery) -> Result<Tonight, LibraryError> {
        let projects = self.open_project_goals().await?;
        let projects: Vec<(&Project, &[GoalProgress])> =
            projects.iter().map(|(project, goals)| (project, goals.as_slice())).collect();
        self.tonight_of(query, &projects).await
    }

    /// [`Self::tonight`] for `projects`, every open Project with its goal
    /// progress, which Home has already read.
    pub(crate) async fn tonight_of(
        &self,
        query: &TonightQuery,
        projects: &[(&Project, &[GoalProgress])],
    ) -> Result<Tonight, LibraryError> {
        let unavailable = |reason, site: Option<&ObservingSite>| Tonight {
            site: site.map(ObservingSite::basis),
            time_zone: site.map(|site| site.time_zone.clone()),
            night: None,
            criteria: None,
            goals: Vec::new(),
            next_good_night: None,
            windows: Vec::new(),
            moon: None,
            darkness: None,
            method: planning::METHOD.into(),
            unavailable_reason: Some(reason),
        };
        let (site, criteria) = match self.home_planning().await? {
            HomePlanning::Ready(site, criteria) => (site, criteria),
            HomePlanning::Unavailable(reason, site) => {
                return Ok(unavailable(reason, site.as_ref()))
            }
        };
        let marks = self.catalog().my_target_marks().await?;
        let mut records = Vec::new();
        for id in marks.ids() {
            records.push(self.catalog().target(id).await?);
        }
        let goals = self.unfinished_goals(projects).await?;
        let avoidance = self.catalog().workflow_settings().await?.0.moon_avoidance;
        let night = query.night;
        let (night, sky, best, graded, next) = blocking(move || {
            let night = night_at(night, &site)?;
            let sky = planning::night_sky(&site, night, criteria.darkness)?;
            let best = best_windows(records, &site, night, criteria)?;
            let context = NightContext::new(&site, night, &criteria)?;
            let graded: Vec<GoalGrade> = grade_night(&goals, &site, &context, &avoidance)?
                .into_iter()
                .map(|graded| graded.grade)
                .collect();
            let next = if graded.iter().any(GoalGrade::suits) {
                NextGoodNight::Tonight
            } else {
                next_good_night(&goals, &site, night, &criteria, &avoidance)?
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
            criteria: Some(criteria),
            goals: graded,
            next_good_night: Some(next),
            windows,
            moon: Some(sky.moon),
            darkness: sky.darkness,
            method: sky.method,
            unavailable_reason: None,
        })
    }

    /// Which of `targets` have a window tonight at the default site under
    /// Home's stored criteria: [`Tonight::has_window`] for these Targets
    /// alone, without grading a goal or searching for the next good night.
    /// None without a default site or criteria, where Tonight has no window.
    ///
    /// # Errors
    /// As [`Self::tonight`].
    pub(crate) async fn tonight_window_targets(
        &self,
        query: &TonightQuery,
        targets: &BTreeSet<Uuid>,
    ) -> Result<BTreeSet<Uuid>, LibraryError> {
        if targets.is_empty() {
            return Ok(BTreeSet::new());
        }
        let HomePlanning::Ready(site, criteria) = self.home_planning().await? else {
            return Ok(BTreeSet::new());
        };
        let mut records = Vec::with_capacity(targets.len());
        for id in targets {
            records.push(self.catalog().target(*id).await?);
        }
        let night = query.night;
        let best =
            blocking(move || best_windows(records, &site, night_at(night, &site)?, criteria))
                .await?;
        Ok(best.into_iter().map(|(record, _)| record.candidate.id).collect())
    }

    /// The default site and Home's stored criteria Tonight is computed
    /// under, or what is missing, the site first.
    async fn home_planning(&self) -> Result<HomePlanning, LibraryError> {
        let Some(site) = self.catalog().list_sites().await?.default_site_id else {
            return Ok(HomePlanning::Unavailable(HomePlanningUnavailable::NoSite, None));
        };
        let site = self.catalog().site(site).await?;
        Ok(match self.home_criteria().await?.criteria {
            Some(criteria) => HomePlanning::Ready(site, criteria),
            None => HomePlanning::Unavailable(HomePlanningUnavailable::NoCriteria, Some(site)),
        })
    }
}

/// What Tonight is computed under: the default site and Home's criteria,
/// or why it has none, with the default site when there is one.
enum HomePlanning {
    Ready(ObservingSite, PlanCriteria),
    Unavailable(HomePlanningUnavailable, Option<ObservingSite>),
}

/// `night`, or the night that holds now at `site`.
fn night_at(night: Option<Date>, site: &ObservingSite) -> Result<Date, LibraryError> {
    match night {
        Some(night) => Ok(night),
        None => planning::night_of(OffsetDateTime::now_utc(), site),
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
