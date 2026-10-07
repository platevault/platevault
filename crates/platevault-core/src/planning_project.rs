// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Project planning (spec 072 PLAN-FR-02/09/10, PLAN-AC-10; spec 065 D-W36)
//! on the [`Library`] facade. A Project owns no windows: its page lists the
//! windows of its own subjects, each from the same Target planning as the
//! Plan area at the active planning site, with each subject's per-channel
//! goal gap and, for a mosaic, each panel with its own gap. It also names the
//! "Open in Planner" context: the Targets page limited to the Project's
//! subjects with the rig selector on "this Project's rigs". A Target's Plan
//! area reads the same gaps for every open Project that has the Target as a
//! subject. Each gap names its "in project" and "captured" amounts with those
//! labels, read from the Project's goal progress (PRJ-FR-04). Read-only.

use std::collections::BTreeMap;

use platevault_pixels::measure;
use serde::{Deserialize, Serialize};
use time::Date;
use uuid::Uuid;

use crate::library::{blocking, Library};
use crate::planning;
use crate::{
    GoalProgress, GoalSpec, GoalTally, LibraryError, MeasurementMethod, Microseconds,
    ObservingSite, PlanCriteria, PlanningUnknownReason, Project, ProjectGoal, ProjectQuery,
    ProjectState, ProjectSubject, Revision, SiteBasis, WindowQuery, WindowSet,
};

time::serde::format_description!(iso_date, Date, "[year]-[month]-[day]");

/// What a Project page plans: the Project, the planning site (absent, the
/// default site), the first night by its site-local evening date, the number
/// of nights and explicit criteria, as in a Plan area window query.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPlanningQuery {
    pub project_id: Uuid,
    #[serde(default)]
    pub site_id: Option<Uuid>,
    #[serde(with = "iso_date")]
    pub first_night: Date,
    pub nights: u32,
    pub criteria: PlanCriteria,
}

/// The label a gap amount carries (D-W36). The UI never says "not in a run".
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
pub enum GapLabel {
    /// The frames of the Project's runs: they count toward the goal.
    #[serde(rename = "in project")]
    InProject,
    /// Every candidate frame plus the run members.
    #[serde(rename = "captured")]
    Captured,
}

impl GapLabel {
    /// The label's text.
    #[must_use]
    pub const fn text(self) -> &'static str {
        match self {
            Self::InProject => "in project",
            Self::Captured => "captured",
        }
    }
}

/// One labelled amount of a goal.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GapAmount {
    pub label: GapLabel,
    pub tally: GoalTally,
}

/// What a goal still needs beyond "in project": integration time or frames,
/// zero once the goal is met.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum GapRemaining {
    Integration { seconds: Microseconds },
    FrameCount { frames: u64 },
}

/// One integration or frame-count goal's gap on one channel (PLAN-FR-02).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalGap {
    pub goal: ProjectGoal,
    pub in_project: GapAmount,
    pub captured: GapAmount,
    pub remaining: GapRemaining,
    /// Read from "in project" only.
    pub met: bool,
}

/// A mosaic panel by its centre and rotation, with its own goals' gaps.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelGaps {
    pub panel_id: Uuid,
    pub number: u32,
    pub ra_deg: f64,
    pub dec_deg: f64,
    pub rotation_deg: Option<f64>,
    pub gaps: Vec<GoalGap>,
}

/// One subject's gaps: the subject-level goals and, for a mosaic, every
/// panel by number, each with its panel goals.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubjectGaps {
    pub subject_id: Uuid,
    pub target_id: Uuid,
    pub designation: String,
    pub name: Option<String>,
    pub mosaic: bool,
    pub gaps: Vec<GoalGap>,
    pub panels: Vec<PanelGaps>,
}

/// One subject on a Project page: its gaps and the subject Target's windows,
/// exactly as the Plan area computes them; absent without a planning site.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubjectPlanning {
    #[serde(flatten)]
    pub subject: SubjectGaps,
    pub windows: Option<WindowSet>,
}

/// "Open in Planner" (PLAN-FR-10): the Targets page limited to these subject
/// Targets with the rig selector on "this Project's rigs". Clearing the
/// context returns the page to My targets.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannerContext {
    pub project_id: Uuid,
    pub project_name: String,
    /// The subjects' Targets in subject order.
    pub target_ids: Vec<Uuid>,
    /// This Project's rigs in order.
    pub rig_ids: Vec<Uuid>,
}

/// A Project page's planning: only the Project's own subjects. Without a
/// planning site no window is computed and `unavailableReason` reads "Add an
/// observing site in Settings"; the gaps are listed either way.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPlanning {
    pub project_id: Uuid,
    pub project_name: String,
    pub revision: Revision,
    pub site: Option<SiteBasis>,
    pub time_zone: Option<String>,
    pub unavailable_reason: Option<PlanningUnknownReason>,
    /// In subject order.
    pub subjects: Vec<SubjectPlanning>,
    pub planner: PlannerContext,
}

/// One open Project's gaps for a Target in its Plan area.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGaps {
    pub project_id: Uuid,
    pub project_name: String,
    pub revision: Revision,
    #[serde(flatten)]
    pub subject: SubjectGaps,
}

impl Library {
    /// The planning of Project `query.project_id`: every subject's windows at
    /// the planning site, its gaps and the "Open in Planner" context.
    /// Read-only.
    ///
    /// # Errors
    /// `InvalidInput` for an invalid query; `NotFound` for an unknown Project
    /// or site; `Conflict` when the Project changed between its reads.
    pub async fn project_planning(
        &self,
        query: &ProjectPlanningQuery,
    ) -> Result<ProjectPlanning, LibraryError> {
        let probe = WindowQuery {
            target_id: Uuid::nil(),
            site_id: Uuid::nil(),
            first_night: query.first_night,
            nights: query.nights,
            criteria: query.criteria,
        };
        probe.validate()?;
        let site = match query.site_id {
            Some(id) => Some(self.catalog().site(id).await?),
            None => match self.catalog().list_sites().await?.default_site_id {
                Some(id) => Some(self.catalog().site(id).await?),
                None => None,
            },
        };
        let (project, subjects) = self.project_gaps(query.project_id).await?;
        let mut targets = Vec::with_capacity(project.subjects.len());
        for subject in &project.subjects {
            targets.push(self.catalog().target(subject.target_id).await?);
        }
        let windows = match &site {
            Some(site) => {
                let (site, query) = (site.clone(), query.clone());
                Some(blocking(move || subject_windows(&targets, &site, &query)).await?)
            }
            None => None,
        };
        let mut windows = windows.map(Vec::into_iter);
        let subjects = subjects
            .into_iter()
            .map(|subject| SubjectPlanning {
                subject,
                windows: windows.as_mut().and_then(Iterator::next),
            })
            .collect();
        Ok(ProjectPlanning {
            project_id: project.id,
            project_name: project.name.clone(),
            revision: project.revision,
            unavailable_reason: site.is_none().then_some(PlanningUnknownReason::NoSite),
            site: site.as_ref().map(ObservingSite::basis),
            time_zone: site.map(|site| site.time_zone),
            subjects,
            planner: PlannerContext {
                project_id: project.id,
                project_name: project.name,
                target_ids: project.subjects.iter().map(|subject| subject.target_id).collect(),
                rig_ids: project.rig_ids,
            },
        })
    }

    /// The gaps a Target's Plan area shows: one entry per open Project that
    /// has the Target as a subject, in Project name order. Read-only.
    ///
    /// # Errors
    /// `NotFound` for an unknown Target; `Conflict` when a Project changed
    /// between its reads.
    pub async fn target_project_gaps(
        &self,
        target_id: Uuid,
    ) -> Result<Vec<ProjectGaps>, LibraryError> {
        self.catalog().target(target_id).await?;
        let query = ProjectQuery { target_id: Some(target_id), offset: 0, limit: 0 };
        let mut found = Vec::new();
        for summary in self.catalog().list_projects(&query).await? {
            if summary.state != ProjectState::Open {
                continue;
            }
            let (project, subjects) = self.project_gaps(summary.id).await?;
            found.extend(
                subjects.into_iter().filter(|subject| subject.target_id == target_id).map(
                    |subject| ProjectGaps {
                        project_id: project.id,
                        project_name: project.name.clone(),
                        revision: project.revision,
                        subject,
                    },
                ),
            );
        }
        Ok(found)
    }

    /// Project `id` and each subject's gaps, from its goal progress at the
    /// Project's revision.
    async fn project_gaps(&self, id: Uuid) -> Result<(Project, Vec<SubjectGaps>), LibraryError> {
        let project = self.catalog().project(id).await?;
        let method = MeasurementMethod::new(measure::METHOD.name, measure::METHOD.version);
        let basis = self.catalog().project_progress_basis(id, &method).await?;
        if basis.revision != project.revision {
            return Err(LibraryError::Conflict {
                id,
                current: basis.revision,
                successors: Vec::new(),
            });
        }
        let mut by_owner: BTreeMap<(Uuid, Option<Uuid>), Vec<GoalGap>> = BTreeMap::new();
        for progress in basis.goals {
            let owner = (progress.goal.subject_id, progress.goal.panel_id);
            if let Some(gap) = gap(progress) {
                by_owner.entry(owner).or_default().push(gap);
            }
        }
        let subjects =
            project.subjects.iter().map(|subject| subject_gaps(subject, &mut by_owner)).collect();
        Ok((project, subjects))
    }
}

fn subject_gaps(
    subject: &ProjectSubject,
    by_owner: &mut BTreeMap<(Uuid, Option<Uuid>), Vec<GoalGap>>,
) -> SubjectGaps {
    let panels = if subject.mosaic { subject.panels.as_slice() } else { &[] };
    SubjectGaps {
        subject_id: subject.id,
        target_id: subject.target_id,
        designation: subject.designation.clone(),
        name: subject.name.clone(),
        mosaic: subject.mosaic,
        gaps: by_owner.remove(&(subject.id, None)).unwrap_or_default(),
        panels: panels
            .iter()
            .map(|panel| PanelGaps {
                panel_id: panel.id,
                number: panel.number,
                ra_deg: panel.ra_deg,
                dec_deg: panel.dec_deg,
                rotation_deg: panel.rotation_deg,
                gaps: by_owner.remove(&(subject.id, Some(panel.id))).unwrap_or_default(),
            })
            .collect(),
    }
}

/// The gap of an integration or frame-count goal; a quality bar is no gap.
fn gap(progress: GoalProgress) -> Option<GoalGap> {
    let remaining = match progress.goal.goal {
        GoalSpec::Integration { goal_seconds, .. } => {
            let goal = Microseconds::from_whole_seconds(goal_seconds)?;
            GapRemaining::Integration {
                seconds: Microseconds(goal.0.saturating_sub(progress.in_project.seconds.0)),
            }
        }
        GoalSpec::FrameCount { goal_frames, .. } => GapRemaining::FrameCount {
            frames: goal_frames.saturating_sub(progress.in_project.frames),
        },
        GoalSpec::QualityBar { .. } => return None,
    };
    Some(GoalGap {
        goal: progress.goal,
        in_project: GapAmount { label: GapLabel::InProject, tally: progress.in_project },
        captured: GapAmount { label: GapLabel::Captured, tally: progress.captured },
        remaining,
        met: progress.met,
    })
}

/// Each subject Target's windows at `site`, in subject order.
fn subject_windows(
    targets: &[crate::TargetRecord],
    site: &ObservingSite,
    query: &ProjectPlanningQuery,
) -> Result<Vec<WindowSet>, LibraryError> {
    targets
        .iter()
        .map(|target| {
            let query = WindowQuery {
                target_id: target.candidate.id,
                site_id: site.id,
                first_night: query.first_night,
                nights: query.nights,
                criteria: query.criteria,
            };
            planning::compute_windows(target, site, &query)
        })
        .collect()
}
