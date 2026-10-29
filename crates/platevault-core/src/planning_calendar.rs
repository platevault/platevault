// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Home's calendar (spec 072 PLAN-FR-12, PLAN-AC-14; D-W88, D-W89) on the
//! [`Library`] facade: a run of nights at the default site under Home's
//! stored criteria, each with the Moon's illumination, phase, rise and set,
//! its darkness window and dark time, the unfinished goals it suits, best
//! first, and the goals only the Moon rules out, graded as Tonight grades
//! them ([`crate::goal_grades`]). Home asks for five weeks from the start of
//! the request's week. Read-only.
//!
//! The Targets in each night's plan are not listed: a night's plan (D-W151,
//! PLAN-TGT-FR-18) has no storage yet, and a Target's Planned mark is not a
//! night's plan. Bead astro-plan-wre19.14 adds per-night plans, and with them
//! this field.

use serde::{Deserialize, Serialize};
use time::Date;

use crate::goal_grades::{grade_night, GoalGrade, HomePlanningUnavailable, NightGrade};
use crate::library::{blocking, Library};
use crate::planning::{self, NightContext};
use crate::{
    DarknessWindow, GoalProgress, LibraryError, NightMoon, ObservingSite, PlanCriteria, Project,
    SiteBasis, MAX_NIGHTS,
};

time::serde::format_description!(iso_date, Date, "[year]-[month]-[day]");

/// What Home asks the calendar for: the first night by its site-local
/// evening date and the number of nights, five weeks from the start of the
/// request's week on Home.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct CalendarQuery {
    #[cfg_attr(feature = "wire", specta(type = String), schemars(with = "String"))]
    #[serde(with = "iso_date")]
    pub first_night: Date,
    pub nights: u32,
}

/// One night of Home's calendar.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct CalendarNight {
    /// The site-local evening date.
    #[cfg_attr(feature = "wire", specta(type = String), schemars(with = "String"))]
    #[serde(with = "iso_date")]
    pub night: Date,
    pub moon: NightMoon,
    /// Absent on a night never dark at the criteria's level.
    pub darkness: Option<DarknessWindow>,
    /// Seconds of darkness at the criteria's level.
    pub dark_seconds: u32,
    /// The unfinished goals the night suits (good or marginal), best first.
    pub suited_goals: Vec<GoalGrade>,
    /// The goals graded poor that the Moon-free criteria would leave a
    /// window: only the Moon rules them out.
    pub moon_ruled_out_goals: Vec<GoalGrade>,
}

/// Home's calendar at the default site under Home's criteria. Without
/// either nothing is computed: `nights` is empty and `unavailableReason`
/// names what is missing, the site first.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct PlanningCalendar {
    pub site: Option<SiteBasis>,
    pub time_zone: Option<String>,
    pub criteria: Option<PlanCriteria>,
    pub nights: Vec<CalendarNight>,
    pub method: String,
    pub unavailable_reason: Option<HomePlanningUnavailable>,
}

impl Library {
    /// Home's calendar: `query.nights` nights from `query.first_night` at
    /// the default site under Home's stored criteria. Read-only.
    ///
    /// # Errors
    /// `InvalidInput` for `nights` outside 1 to [`MAX_NIGHTS`] or a night
    /// outside the supported calendar; `PersistenceFailure` when the catalog
    /// cannot be read.
    pub async fn planning_calendar(
        &self,
        query: &CalendarQuery,
    ) -> Result<PlanningCalendar, LibraryError> {
        let CalendarQuery { first_night, nights } = *query;
        if !(1..=MAX_NIGHTS).contains(&nights) {
            return Err(LibraryError::InvalidInput(format!(
                "nights {nights} is not a whole number of nights from 1 to {MAX_NIGHTS}"
            )));
        }
        let unavailable = |reason, criteria| PlanningCalendar {
            site: None,
            time_zone: None,
            criteria,
            nights: Vec::new(),
            method: planning::METHOD.into(),
            unavailable_reason: Some(reason),
        };
        let Some(site) = self.catalog().list_sites().await?.default_site_id else {
            let criteria = self.home_criteria().await?.criteria;
            return Ok(unavailable(HomePlanningUnavailable::NoSite, criteria));
        };
        let site = self.catalog().site(site).await?;
        let Some(criteria) = self.home_criteria().await?.criteria else {
            return Ok(PlanningCalendar {
                site: Some(site.basis()),
                time_zone: Some(site.time_zone),
                ..unavailable(HomePlanningUnavailable::NoCriteria, None)
            });
        };
        let projects = self.open_project_goals().await?;
        let projects: Vec<(&Project, &[GoalProgress])> =
            projects.iter().map(|(project, goals)| (project, goals.as_slice())).collect();
        let goals = self.unfinished_goals(&projects).await?;
        let avoidance = self.catalog().workflow_settings().await?.0.moon_avoidance;
        let basis = (site.basis(), site.time_zone.clone());
        let nights = blocking(move || {
            let mut listed = Vec::new();
            let mut night = first_night;
            for index in 0..nights {
                if index > 0 {
                    night = next_night(night)?;
                }
                let context = NightContext::new(&site, night, &criteria)?;
                let graded = grade_night(&goals, &site, &context, &avoidance)?;
                listed.push(calendar_night(&site, &context, night, criteria, graded)?);
            }
            Ok(listed)
        })
        .await?;
        Ok(PlanningCalendar {
            site: Some(basis.0),
            time_zone: Some(basis.1),
            criteria: Some(criteria),
            nights,
            method: planning::METHOD.into(),
            unavailable_reason: None,
        })
    }
}

fn next_night(night: Date) -> Result<Date, LibraryError> {
    night.next_day().ok_or_else(|| {
        LibraryError::InvalidInput(format!("night after {night} is outside the supported calendar"))
    })
}

fn calendar_night(
    site: &ObservingSite,
    context: &NightContext,
    night: Date,
    criteria: PlanCriteria,
    graded: Vec<NightGrade>,
) -> Result<CalendarNight, LibraryError> {
    let sky = planning::night_sky(site, night, criteria.darkness)?;
    let dark_seconds = context.dark_seconds();
    let mut suited_goals = Vec::new();
    let mut moon_ruled_out_goals = Vec::new();
    for graded in graded {
        if graded.grade.suits() {
            suited_goals.push(graded.grade);
        } else if graded.moon_ruled_out {
            moon_ruled_out_goals.push(graded.grade);
        }
    }
    Ok(CalendarNight {
        night,
        moon: sky.moon,
        darkness: sky.darkness,
        dark_seconds,
        suited_goals,
        moon_ruled_out_goals,
    })
}
