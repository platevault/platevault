// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Per-goal night grades (spec 072 PLAN-FR-02, PLAN-FR-11, PLAN-FR-12,
//! PLAN-AC-11/14, PLAN-EQ-FR-02; D-W88, D-W89) for Home's Tonight and
//! calendar. Every unfinished integration or frame-count goal of an open
//! Project is graded good, marginal or poor for a night under its channel's
//! Moon-avoidance curve, by the rule of R10-MOON-MODEL.md §3, which
//! PLAN-FR-02 cites:
//!
//! - good: the curve leaves a window, and the longest keeps at least 75% of
//!   the longest window the Moon-free criteria leave;
//! - marginal: the curve leaves a window, but the Moon takes more than a
//!   quarter of that time;
//! - poor: the curve leaves no window.
//!
//! The windows are the Plan area's ([`planning::night_windows`], the
//! computation behind [`planning::compute_windows`]) over one shared night
//! context, with the Moon criterion set to the curve's separation at the
//! night's Moon age ([`planning::curve_criterion`]), the age the Targets
//! list grades its bands at. A channel is graded under the bands it captures
//! on the Project's rigs ([`rig_bands`]): a FILTER value passes the bands of
//! the filters it names, and frames without a FILTER capture R, G and B on a
//! one-shot-colour rig and nothing on a mono one. Of those bands the one that
//! needs the most separation that night grades it. A goal whose channel
//! captures no band, or whose Target has no usable position, is ungraded. A
//! panel group's goal is graded from its subject's window (provisional,
//! PLAN-FR-11). Read-only.

use std::collections::btree_map::Entry;
use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use time::Date;
use uuid::Uuid;

use crate::library::Library;
use crate::planning::{self, NightContext};
use crate::rig::rig_bands;
use crate::tonight::better;
use crate::{
    Band, BandGrade, GoalProgress, GoalShortfall, LibraryError, MoonAvoidance, MoonCriterion,
    ObservingSite, ObservingWindow, PlanCriteria, Project, ProjectQuery, Rig, TargetRecord,
    WindowUnavailableReason,
};

time::serde::format_description!(iso_date, Date, "[year]-[month]-[day]");

/// How many nights after tonight the next good night is searched for: the
/// five weeks Home's calendar spans (PLAN-FR-12). PLAN-FR-11 sets no span.
pub const NEXT_GOOD_NIGHT_SEARCH: u32 = 35;

/// Why Home's Tonight or calendar computes nothing.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum HomePlanningUnavailable {
    /// "Add an observing site in Settings".
    NoSite,
    /// Home's criteria are not set yet; Home asks for them.
    NoCriteria,
}

/// Why a goal has no grade.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum Ungraded {
    /// The channel captures no band on the Project's rigs: its FILTER value
    /// names no filter on them, or it has none and no rig is one-shot colour.
    NoBand,
    /// The subject Target has no usable position, so it has no window.
    NoPosition { reason: WindowUnavailableReason },
}

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
    /// The band whose curve grades the goal; absent when it is ungraded.
    pub band: Option<Band>,
    /// Absent exactly when `ungraded` is set.
    pub grade: Option<BandGrade>,
    pub ungraded: Option<Ungraded>,
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

/// When Tonight's goals are next suited.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", rename_all_fields = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum NextGoodNight {
    /// A goal suits tonight.
    Tonight,
    /// No goal can be graded: there is no unfinished goal, or none has a
    /// band and a Target with a usable position.
    NoGradableGoal,
    /// No goal suits tonight; this later night, by its site-local evening
    /// date, is the first that suits one.
    Night {
        #[cfg_attr(feature = "wire", specta(type = String), schemars(with = "String"))]
        #[serde(with = "iso_date")]
        night: Date,
    },
    /// No goal suits tonight or any of the next `nights` nights.
    NoneWithin { nights: u32 },
}

/// A goal graded for one night, and whether only the Moon keeps it poor:
/// the Moon-free criteria leave a window and the curve leaves none.
pub(crate) struct NightGrade {
    pub(crate) grade: GoalGrade,
    pub(crate) moon_ruled_out: bool,
}

/// An unfinished goal with what grading it needs.
pub(crate) struct UnfinishedGoal {
    project_id: Uuid,
    project_name: String,
    goal_id: Uuid,
    subject_id: Uuid,
    group_id: Option<Uuid>,
    target: TargetRecord,
    channel: Option<String>,
    /// The bands the channel captures on the Project's rigs, in band order.
    bands: Vec<Band>,
}

impl UnfinishedGoal {
    /// Why the goal cannot be graded on any night; `None` when it can.
    fn ungraded(&self) -> Option<Ungraded> {
        if self.bands.is_empty() {
            return Some(Ungraded::NoBand);
        }
        planning::position_unavailable(&self.target).map(|reason| Ungraded::NoPosition { reason })
    }

    fn graded(
        &self,
        band: Option<Band>,
        grade: Result<BandGrade, Ungraded>,
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
            grade: grade.ok(),
            ungraded: grade.err(),
            window,
        }
    }
}

impl Library {
    /// Every open Project with its goal progress, in Project name order.
    pub(crate) async fn open_project_goals(
        &self,
    ) -> Result<Vec<(Project, Vec<GoalProgress>)>, LibraryError> {
        let mut projects = Vec::new();
        for summary in self.catalog().list_projects(&ProjectQuery::default()).await? {
            let project = self.catalog().project(summary.id).await?;
            let goals = self.project_progress(summary.id).await?.goals;
            projects.push((project, goals));
        }
        Ok(projects)
    }

    /// The unfinished integration or frame-count goals of `projects`, each
    /// open Project with its goal progress, in Project, then goal order.
    pub(crate) async fn unfinished_goals(
        &self,
        projects: &[(&Project, &[GoalProgress])],
    ) -> Result<Vec<UnfinishedGoal>, LibraryError> {
        let mut rigs: BTreeMap<Uuid, Rig> = BTreeMap::new();
        let mut targets: BTreeMap<Uuid, TargetRecord> = BTreeMap::new();
        let mut goals = Vec::new();
        for (project, project_progress) in projects {
            for id in &project.rig_ids {
                if let Entry::Vacant(entry) = rigs.entry(*id) {
                    entry.insert(self.rig(*id).await?);
                }
            }
            let project_rigs: Vec<&Rig> = project.rig_ids.iter().map(|id| &rigs[id]).collect();
            for progress in *project_progress {
                if GoalShortfall::of(progress).is_none() {
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
                    let target = self.catalog().target(subject.target_id).await?;
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
                    bands: captured_bands(channel.as_deref(), &project_rigs),
                    channel,
                });
            }
        }
        Ok(goals)
    }
}

/// The bands a channel captures on `rigs`, by [`rig_bands`]: a FILTER value
/// passes the bands of every filter it names; without one, a one-shot-colour
/// rig captures R, G and B and a mono rig nothing.
fn captured_bands(channel: Option<&str>, rigs: &[&Rig]) -> Vec<Band> {
    let mut bands: Vec<Band> = rigs
        .iter()
        .flat_map(|rig| match channel {
            Some(channel) => {
                let named: Vec<_> = rig
                    .filters
                    .filters
                    .iter()
                    .filter(|filter| filter.matches(channel))
                    .cloned()
                    .collect();
                rig_bands(None, &named)
            }
            None => rig_bands(rig.equipment.color_kind, &[]),
        })
        .collect();
    bands.sort_unstable();
    bands.dedup();
    bands
}

/// Each goal graded for the context's night at `site`, whose Moon criterion
/// the curves replace, best first: good, then marginal, poor and ungraded,
/// each by the longer window, then Project name, designation, channel and
/// goal. Blocking.
///
/// # Errors
/// `InvalidInput` for a night outside the supported calendar.
pub(crate) fn grade_night(
    goals: &[UnfinishedGoal],
    site: &ObservingSite,
    context: &NightContext,
    avoidance: &MoonAvoidance,
) -> Result<Vec<NightGrade>, LibraryError> {
    let age = context.moon_age_days();
    let mut best: BTreeMap<(Uuid, MoonKey), Option<ObservingWindow>> = BTreeMap::new();
    let mut graded = Vec::with_capacity(goals.len());
    for goal in goals {
        let ungraded = goal.ungraded();
        let (Some(band), None) = (strictest_band(goal, avoidance, age), ungraded) else {
            let ungraded = ungraded.unwrap_or(Ungraded::NoBand);
            graded.push(NightGrade {
                grade: goal.graded(None, Err(ungraded), None),
                moon_ruled_out: false,
            });
            continue;
        };
        let mut window = |moon: MoonCriterion| -> Result<Option<ObservingWindow>, LibraryError> {
            let key = (goal.target.candidate.id, MoonKey::of(moon));
            if let Some(found) = best.get(&key) {
                return Ok(found.clone());
            }
            let found = best_window(&context.with_moon(moon), &goal.target, site)?;
            best.insert(key, found.clone());
            Ok(found)
        };
        let curved = window(planning::curve_criterion(avoidance.curve(band), age))?;
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
        graded
            .push(NightGrade { grade: goal.graded(Some(band), Ok(grade), curved), moon_ruled_out });
    }
    graded.sort_by(|first, second| order(&first.grade, &second.grade));
    Ok(graded)
}

/// The band of `goal`'s channel that needs the most separation from a Moon
/// `age` days from full, the earlier in band order on a tie; `None` when the
/// channel captures no band.
fn strictest_band(goal: &UnfinishedGoal, avoidance: &MoonAvoidance, age: f64) -> Option<Band> {
    let separation = |band: Band| avoidance.curve(band).min_separation_deg(age);
    goal.bands.iter().copied().max_by(|first, second| {
        separation(*first).total_cmp(&separation(*second)).then(second.cmp(first))
    })
}

/// When `goals` are next suited after `night`, which none suits: the first
/// of the next [`NEXT_GOOD_NIGHT_SEARCH`] nights whose curve leaves a
/// gradable goal a window, so [`grade_night`] grades it good or marginal;
/// [`NextGoodNight::NoGradableGoal`] when no goal can be graded, and
/// [`NextGoodNight::NoneWithin`] when no night in the span suits one. A
/// night without darkness at the criteria's level suits none and is
/// skipped. Blocking.
///
/// # Errors
/// `InvalidInput` for a night outside the supported calendar.
pub(crate) fn next_good_night(
    goals: &[UnfinishedGoal],
    site: &ObservingSite,
    night: Date,
    criteria: &PlanCriteria,
    avoidance: &MoonAvoidance,
) -> Result<NextGoodNight, LibraryError> {
    let gradable: Vec<&UnfinishedGoal> =
        goals.iter().filter(|goal| goal.ungraded().is_none()).collect();
    if gradable.is_empty() {
        return Ok(NextGoodNight::NoGradableGoal);
    }
    let mut candidate = night;
    for _ in 0..NEXT_GOOD_NIGHT_SEARCH {
        candidate = candidate.next_day().ok_or_else(|| {
            LibraryError::InvalidInput(format!(
                "night after {candidate} is outside the supported calendar"
            ))
        })?;
        let context = NightContext::new(site, candidate, criteria)?;
        if context.dark_seconds() == 0 {
            continue;
        }
        let age = context.moon_age_days();
        let mut tried = Vec::new();
        for goal in &gradable {
            let Some(band) = strictest_band(goal, avoidance, age) else { continue };
            let moon = planning::curve_criterion(avoidance.curve(band), age);
            let key = (goal.target.candidate.id, MoonKey::of(moon));
            if tried.contains(&key) {
                continue;
            }
            tried.push(key);
            if best_window(&context.with_moon(moon), &goal.target, site)?.is_some() {
                return Ok(NextGoodNight::Night { night: candidate });
            }
        }
    }
    Ok(NextGoodNight::NoneWithin { nights: NEXT_GOOD_NIGHT_SEARCH })
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

/// The Target's best window of the context's night, by [`better`]; `None`
/// without a window or a usable position.
fn best_window(
    context: &NightContext,
    target: &TargetRecord,
    site: &ObservingSite,
) -> Result<Option<ObservingWindow>, LibraryError> {
    Ok(planning::night_windows(context, target, site)?
        .ok()
        .and_then(|windows| windows.into_iter().reduce(better)))
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
