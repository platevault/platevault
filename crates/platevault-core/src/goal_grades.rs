// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Per-goal night grades (spec 072 PLAN-FR-02, PLAN-FR-11, PLAN-FR-12,
//! PLAN-AC-11/14; D-W88, D-W89) for Home's Tonight and calendar. Every
//! unfinished integration or frame-count goal of an open Project is graded
//! good, marginal or poor for a night under its channel's Moon-avoidance
//! curve, by the rule of R10-MOON-MODEL.md §3, which PLAN-FR-02 cites:
//!
//! - good: the curve leaves a window, and the longest keeps at least 75% of
//!   the longest window the Moon-free criteria leave;
//! - marginal: the curve leaves a window, but the Moon takes more than a
//!   quarter of that time;
//! - poor: the curve leaves no window.
//!
//! The windows are [`planning::compute_windows`]'s, the Plan area's, with the
//! Moon criterion set to the curve's separation at the night's Moon age
//! ([`planning::curve_criterion`]), the age the Targets list grades its bands
//! at. A channel is graded under the bands its filters pass on the Project's
//! rigs, and frames without a FILTER are one-shot colour (R, G and B); of
//! those bands the one that needs the most separation that night grades it.
//! A panel group's goal is graded from its subject's window (provisional,
//! PLAN-FR-11). Read-only.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use time::Date;
use uuid::Uuid;

use crate::library::Library;
use crate::planning::{self, NightContext};
use crate::tonight::better;
use crate::{
    Band, BandGrade, GoalShortfall, LibraryError, MoonAvoidance, MoonCriterion, ObservingSite,
    ObservingWindow, PlanCriteria, ProjectQuery, RigFilter, TargetRecord, WindowQuery,
};

/// How many nights after tonight the next good night is searched for: the
/// five weeks Home's calendar spans (PLAN-FR-12). PLAN-FR-11 sets no span.
pub const NEXT_GOOD_NIGHT_SEARCH: u32 = 35;

/// One unfinished goal graded for one night.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct GoalGrade {
    pub project_id: Uuid,
    pub project_name: String,
    pub goal_id: Uuid,
    pub subject_id: Uuid,
    /// The mosaic panel group of a panel goal.
    pub group_id: Option<Uuid>,
    pub target_id: Uuid,
    pub designation: String,
    /// The goal's trimmed channel; `None` for frames without a FILTER.
    pub channel: Option<String>,
    /// The band whose curve grades the goal; absent when the channel names
    /// no filter on the Project's rigs, so no curve applies.
    pub band: Option<Band>,
    /// Absent exactly when `band` is.
    pub grade: Option<BandGrade>,
    /// The best window under the band's curve, as the Plan area lists it;
    /// absent when the goal is not good or marginal.
    pub window: Option<ObservingWindow>,
}

impl GoalGrade {
    /// Whether the night suits the goal: good or marginal, as Suitable
    /// filters admits a band (PLAN-TGT-FR-15).
    #[must_use]
    pub fn suits(&self) -> bool {
        matches!(self.grade, Some(BandGrade::Good | BandGrade::Marginal))
    }
}

/// A goal graded for one night, and whether only the Moon keeps it poor:
/// the Moon-free criteria leave a window and the curve leaves none.
pub(crate) struct NightGrade {
    pub(crate) grade: GoalGrade,
    pub(crate) moon_ruled_out: bool,
}

/// An unfinished goal with what grading it needs.
#[derive(Clone)]
pub(crate) struct UnfinishedGoal {
    project_id: Uuid,
    project_name: String,
    goal_id: Uuid,
    subject_id: Uuid,
    group_id: Option<Uuid>,
    target: TargetRecord,
    channel: Option<String>,
    /// The bands the channel's filters pass, in band order.
    bands: Vec<Band>,
}

impl Library {
    /// Every unfinished integration or frame-count goal of every open
    /// Project, in Project, then goal order.
    pub(crate) async fn unfinished_goals(&self) -> Result<Vec<UnfinishedGoal>, LibraryError> {
        let catalog = self.catalog();
        let mut filters: BTreeMap<Uuid, Vec<RigFilter>> = BTreeMap::new();
        let mut targets: BTreeMap<Uuid, TargetRecord> = BTreeMap::new();
        let mut goals = Vec::new();
        for summary in catalog.list_projects(&ProjectQuery::default()).await? {
            let project = catalog.project(summary.id).await?;
            let mut rig_filters = Vec::new();
            for rig in &project.rig_ids {
                let listed = if let Some(listed) = filters.get(rig) {
                    listed.clone()
                } else {
                    let listed = catalog.rig_filters(*rig).await?.filters;
                    filters.insert(*rig, listed.clone());
                    listed
                };
                rig_filters.extend(listed);
            }
            for progress in self.project_progress(project.id).await?.goals {
                if GoalShortfall::of(&progress).is_none() {
                    continue;
                }
                let Some(subject) =
                    project.subjects.iter().find(|subject| subject.id == progress.goal.subject_id)
                else {
                    continue;
                };
                let target = if let Some(target) = targets.get(&subject.target_id) {
                    target.clone()
                } else {
                    let target = catalog.target(subject.target_id).await?;
                    targets.insert(subject.target_id, target.clone());
                    target
                };
                let channel = progress.goal.goal.channel().map(str::to_owned);
                goals.push(UnfinishedGoal {
                    project_id: project.id,
                    project_name: project.name.clone(),
                    goal_id: progress.goal.id,
                    subject_id: subject.id,
                    group_id: progress.goal.group_id,
                    target,
                    bands: bands_of(channel.as_deref(), &rig_filters),
                    channel,
                });
            }
        }
        Ok(goals)
    }
}

/// The bands a channel's filters pass: frames without a FILTER are one-shot
/// colour, so R, G and B; a FILTER value passes the bands of every filter on
/// the Project's rigs it names.
fn bands_of(channel: Option<&str>, filters: &[RigFilter]) -> Vec<Band> {
    let Some(channel) = channel else {
        return vec![Band::R, Band::G, Band::B];
    };
    let mut bands: Vec<Band> = filters
        .iter()
        .filter(|filter| filter.matches(channel))
        .flat_map(|filter| filter.bands.iter().copied())
        .collect();
    bands.sort_unstable();
    bands.dedup();
    bands
}

/// Each goal graded for `night` at `site` under `criteria`, whose Moon
/// criterion the curves replace, best first: good, then marginal, poor and
/// ungraded, each by the longer window, then Project name, designation,
/// channel and goal. Blocking.
///
/// # Errors
/// `InvalidInput` for invalid criteria, an unbundled zone or a night outside
/// the supported calendar.
pub(crate) fn grade_night(
    goals: &[UnfinishedGoal],
    site: &ObservingSite,
    night: Date,
    criteria: PlanCriteria,
    avoidance: &MoonAvoidance,
) -> Result<Vec<NightGrade>, LibraryError> {
    let age = NightContext::new(site, night, &criteria)?.moon_age_days();
    let mut best: BTreeMap<(Uuid, MoonKey), Option<ObservingWindow>> = BTreeMap::new();
    let mut graded = Vec::with_capacity(goals.len());
    for goal in goals {
        let Some(band) = strictest_band(goal, avoidance, age) else {
            graded.push(NightGrade { grade: goal.graded(None, None, None), moon_ruled_out: false });
            continue;
        };
        let moon = planning::curve_criterion(avoidance.curve(band), age);
        let mut window = |moon: MoonCriterion| -> Result<Option<ObservingWindow>, LibraryError> {
            let key = (goal.target.candidate.id, MoonKey::of(moon));
            if let Some(found) = best.get(&key) {
                return Ok(found.clone());
            }
            let found = best_window(&goal.target, site, night, PlanCriteria { moon, ..criteria })?;
            best.insert(key, found.clone());
            Ok(found)
        };
        let curved = window(moon)?;
        let free = window(MoonCriterion::None)?;
        let grade = match (&curved, &free) {
            (None, _) => BandGrade::Poor,
            (Some(curved), Some(free))
                if 4 * u64::from(curved.duration_minutes)
                    < 3 * u64::from(free.duration_minutes) =>
            {
                BandGrade::Marginal
            }
            (Some(_), _) => BandGrade::Good,
        };
        let moon_ruled_out = curved.is_none() && free.is_some();
        graded.push(NightGrade {
            grade: goal.graded(Some(band), Some(grade), curved),
            moon_ruled_out,
        });
    }
    graded.sort_by(|first, second| order(&first.grade, &second.grade));
    Ok(graded)
}

/// The band of `goal`'s channel that needs the most separation from a Moon
/// `age` days from full, the earlier in band order on a tie; `None` when the
/// channel passes no band.
fn strictest_band(goal: &UnfinishedGoal, avoidance: &MoonAvoidance, age: f64) -> Option<Band> {
    let separation = |band: Band| avoidance.curve(band).min_separation_deg(age);
    goal.bands.iter().copied().max_by(|first, second| {
        separation(*first).total_cmp(&separation(*second)).then(second.cmp(first))
    })
}

/// The first of the [`NEXT_GOOD_NIGHT_SEARCH`] nights after `night` that
/// suits one of `goals`: its band's curve leaves the goal a window, so
/// [`grade_night`] grades it good or marginal. `None` when none does.
/// Blocking.
///
/// # Errors
/// As [`grade_night`].
pub(crate) fn next_good_night(
    goals: &[UnfinishedGoal],
    site: &ObservingSite,
    night: Date,
    criteria: PlanCriteria,
    avoidance: &MoonAvoidance,
) -> Result<Option<Date>, LibraryError> {
    let mut candidate = night;
    for _ in 0..NEXT_GOOD_NIGHT_SEARCH {
        candidate = candidate.next_day().ok_or_else(|| {
            LibraryError::InvalidInput(format!(
                "night after {candidate} is outside the supported calendar"
            ))
        })?;
        let age = NightContext::new(site, candidate, &criteria)?.moon_age_days();
        let mut tried = Vec::new();
        for goal in goals {
            let Some(band) = strictest_band(goal, avoidance, age) else { continue };
            let moon = planning::curve_criterion(avoidance.curve(band), age);
            let key = (goal.target.candidate.id, MoonKey::of(moon));
            if tried.contains(&key) {
                continue;
            }
            tried.push(key);
            let curved = PlanCriteria { moon, ..criteria };
            if best_window(&goal.target, site, candidate, curved)?.is_some() {
                return Ok(Some(candidate));
            }
        }
    }
    Ok(None)
}

impl UnfinishedGoal {
    fn graded(
        &self,
        band: Option<Band>,
        grade: Option<BandGrade>,
        window: Option<ObservingWindow>,
    ) -> GoalGrade {
        GoalGrade {
            project_id: self.project_id,
            project_name: self.project_name.clone(),
            goal_id: self.goal_id,
            subject_id: self.subject_id,
            group_id: self.group_id,
            target_id: self.target.candidate.id,
            designation: self.target.candidate.designation.clone(),
            channel: self.channel.clone(),
            band,
            grade,
            window,
        }
    }
}

/// A Moon criterion as a map key: the separation by its bits.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
enum MoonKey {
    None,
    BelowHorizon,
    MinSeparation(u64),
}

impl MoonKey {
    fn of(moon: MoonCriterion) -> Self {
        match moon {
            MoonCriterion::None => Self::None,
            MoonCriterion::BelowHorizon => Self::BelowHorizon,
            MoonCriterion::MinSeparation { min_separation_deg } => {
                Self::MinSeparation(min_separation_deg.to_bits())
            }
        }
    }
}

/// The Target's best window of `night` under `criteria`, by
/// [`better`]; `None` without a usable position or a window.
fn best_window(
    target: &TargetRecord,
    site: &ObservingSite,
    night: Date,
    criteria: PlanCriteria,
) -> Result<Option<ObservingWindow>, LibraryError> {
    let query = WindowQuery {
        target_id: target.candidate.id,
        site_id: site.id,
        first_night: night,
        nights: 1,
        criteria,
    };
    let set = planning::compute_windows(target, site, &query)?;
    Ok(set.nights.into_iter().flat_map(|night| night.windows).reduce(better))
}

fn rank(grade: Option<BandGrade>) -> u8 {
    match grade {
        Some(BandGrade::Good) => 0,
        Some(BandGrade::Marginal) => 1,
        Some(BandGrade::Poor) => 2,
        None => 3,
    }
}

fn order(first: &GoalGrade, second: &GoalGrade) -> std::cmp::Ordering {
    let minutes = |grade: &GoalGrade| grade.window.as_ref().map_or(0, |w| w.duration_minutes);
    rank(first.grade)
        .cmp(&rank(second.grade))
        .then_with(|| minutes(second).cmp(&minutes(first)))
        .then_with(|| first.project_name.cmp(&second.project_name))
        .then_with(|| first.designation.cmp(&second.designation))
        .then_with(|| first.channel.cmp(&second.channel))
        .then_with(|| first.goal_id.cmp(&second.goal_id))
}
