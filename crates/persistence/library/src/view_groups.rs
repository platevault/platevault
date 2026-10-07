// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Mosaic run groups (spec 066 VSEL-FR-18/19, D-W38, D-W73) in the clean
//! catalog. A run on a mosaic subject is a group of panel runs: creation
//! inserts one run per panel the user confirmed, each tied to that panel for
//! good, and no whole-mosaic run. Panel decisions are recorded per session: by
//! pointing, as the caller assessed it from a snapshot of the group's
//! candidates, or by the user. A panel run's candidates are the sessions
//! assigned to its panel, and a flagged or left-out session joins none. Every
//! write is one `BEGIN IMMEDIATE` transaction that checks the expected group
//! revision and session revisions first, so a refusal writes nothing.

use std::collections::{BTreeMap, BTreeSet};

use platevault_model::{
    Availability, CalibrationPolicy, Equipment, ExpectedSession, FramingTarget, GroupActionOutcome,
    GroupSetup, InputMode, LibraryError, NewViewGroup, PanelAssignment, PanelBasis, PanelChoice,
    PanelFlag, PanelOutcome, PanelResult, PointingAssessment, Revision, RunCompletion, RunStage,
    SelectionReason, SubjectPanel, View, ViewCriteria, ViewGroup, ViewGroupRecord,
};
use sqlx::sqlite::{SqliteConnection, SqliteRow};
use sqlx::{Connection, Row};
use uuid::Uuid;

use super::views::{
    assessed_members, begin_edit, candidate_capture, deselect_session, load_record, load_view,
    require_open, require_project_rig, run_subject, select_session, CandidateSession,
};
use super::{
    check_expected_sessions, conflict, current_member_assets, db_revision, from_json, from_text,
    load_equipment, load_session_row, load_target, now, parse_uuid, projects, require_revision,
    revision, to_json, to_text, CaptureView, Catalog, Members, Result,
};

fn invalid(message: String) -> LibraryError {
    LibraryError::InvalidInput(message)
}

/// Every candidate of a mosaic subject on one rig, whatever its panel, with
/// what panel assignment reads: the subject's Target, the rig and the panels
/// by number. Read from one snapshot; hashes, measures and writes nothing.
#[derive(Clone, Debug)]
pub struct GroupCandidates {
    pub subject_id: Uuid,
    pub framing: FramingTarget,
    pub rig: Equipment,
    pub panels: Vec<SubjectPanel>,
    pub sessions: Vec<CandidateSession>,
}

/// A run group with its candidates, read from one snapshot.
#[derive(Clone, Debug)]
pub struct ViewGroupBasis {
    pub record: ViewGroupRecord,
    pub candidates: GroupCandidates,
}

impl Catalog {
    /// The candidates of mosaic subject `subject` on rig `rig` of Project
    /// `project`: what assignment reads before a run group exists.
    ///
    /// # Errors
    /// `NotFound` for an unknown Project or a subject that is not the
    /// Project's; `InvalidInput` for a single-Target subject or a rig that is
    /// not one of the Project's rigs.
    pub async fn view_group_candidates(
        &self,
        project: Uuid,
        subject: Uuid,
        rig: Uuid,
    ) -> Result<GroupCandidates> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let candidates = read_candidates(&mut snapshot, project, subject, rig).await?;
        snapshot.rollback().await?;
        Ok(candidates)
    }

    /// A run group and every candidate of its subject on its rig, from one
    /// snapshot. The panels are the group's, each with its current centre and
    /// rotation; a panel added to the subject later has no run in the group.
    ///
    /// # Errors
    /// `NotFound` for an unknown run group.
    pub async fn view_group_basis(&self, id: Uuid) -> Result<ViewGroupBasis> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let record = load_group_record(&mut snapshot, id).await?;
        let group = &record.group;
        let mut candidates =
            read_candidates(&mut snapshot, group.project_id, group.subject_id, group.rig_id)
                .await?;
        snapshot.rollback().await?;
        let runs: BTreeSet<Option<Uuid>> =
            record.runs.iter().map(|run| run.view.panel_id).collect();
        candidates.panels.retain(|panel| runs.contains(&Some(panel.id)));
        Ok(ViewGroupBasis { record, candidates })
    }

    /// Create a run group: one panel run per confirmed panel, each at
    /// revision 0 with a draft, and no whole-mosaic run (VSEL-FR-18). Each
    /// session of `assessments` gets its pointing decision; one assigned to a
    /// panel joins that panel run's draft with its pointing as the reason when
    /// it has an available capture, and a flagged one joins none. The group
    /// starts with automatic calibration and no profile or input mode.
    ///
    /// # Errors
    /// `InvalidInput` for a blank name, a single-Target subject, a mosaic
    /// without panels, a rig that is not one of the Project's rigs, or an
    /// assessment that is not a candidate's or names no known panel;
    /// `Conflict` carrying the Project revision when `panels` differs from the
    /// subject's panels, or carrying a session's revision when it changed;
    /// `NotFound` for an unknown Project or subject.
    pub async fn create_view_group(
        &self,
        input: &NewViewGroup,
        assessments: &[PointingAssessment],
    ) -> Result<ViewGroupRecord> {
        input.validate()?;
        write_txn!(self, |conn| {
            let target_id = run_subject(conn, input.project_id, input.subject_id, true).await?;
            require_project_rig(conn, input.project_id, input.rig_id).await?;
            let panels = subject_panels(conn, input.subject_id).await?;
            if panels.is_empty() {
                return Err(invalid(format!(
                    "mosaic subject {} has no panels; add them before starting a run group",
                    input.subject_id
                )));
            }
            if panels != input.panels {
                let current = projects::require_project(conn, input.project_id).await?;
                return Err(conflict(input.project_id, current));
            }
            let panel_ids: BTreeSet<Uuid> = panels.iter().map(|panel| panel.id).collect();
            check_assessments(conn, input, assessments, &panel_ids).await?;
            let id = Uuid::new_v4();
            let at = now()?;
            let name = input.name.trim();
            sqlx::query(
                "INSERT INTO view_groups (id, project_id, subject_id, rig_id, name, \
                 calibration_policy, revision, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?7)",
            )
            .bind(id.to_string())
            .bind(input.project_id.to_string())
            .bind(input.subject_id.to_string())
            .bind(input.rig_id.to_string())
            .bind(name)
            .bind(to_text(&CalibrationPolicy::Automatic)?)
            .bind(&at)
            .execute(&mut *conn)
            .await?;
            let mut drafts = BTreeMap::new();
            for panel in &panels {
                let row = insert_panel_run(conn, input, id, target_id, panel, &at).await?;
                drafts.insert(panel.id, row);
            }
            for assessment in assessments {
                write_assignment(conn, id, assessment, PanelBasis::Pointing, assessment.panel_id)
                    .await?;
                let Some(panel_id) = assessment.panel_id else {
                    continue;
                };
                let session = assessment.session.session_id;
                let assets = current_member_assets(conn, session).await?;
                if !assets.iter().any(|asset| asset.availability == Availability::Available) {
                    continue;
                }
                let reason = SelectionReason::PanelPointing {
                    target_id,
                    rig_id: input.rig_id,
                    panel_id,
                    separation_deg: assigned_separation(assessment, panel_id)?,
                };
                let session = load_session_row(conn, session).await?.session;
                select_session(conn, drafts[&panel_id], &session, &reason, None).await?;
            }
            load_group_record(conn, id).await
        })
    }

    /// Record the user's panel for each session of `decisions`, each with its
    /// pointing assessed now (VSEL-FR-18). A session given a panel joins that
    /// panel run's draft as a manual choice unless its membership already
    /// selects it; a session moved off a panel or left out leaves the panel
    /// run holding it. Every touched panel run must be open.
    ///
    /// # Errors
    /// `Conflict` for a stale `expected` group revision or a changed session;
    /// `InvalidInput` for no or repeated decisions, a session that is not a
    /// candidate, a panel outside the group, or a touched panel run that is
    /// Complete or in the Project's Trash; `NotFound` for an unknown group.
    pub async fn decide_view_group_panels(
        &self,
        id: Uuid,
        expected: Revision,
        decisions: &[(PointingAssessment, PanelChoice)],
    ) -> Result<ViewGroupRecord> {
        write_txn!(self, |conn| {
            let group = load_group(conn, id).await?;
            require_revision(id, group.revision, expected)?;
            if decisions.is_empty() {
                return Err(invalid("panel decisions must not be empty".into()));
            }
            let runs: BTreeMap<Uuid, View> = group_runs(conn, id)
                .await?
                .into_iter()
                .map(|run| (run.panel_id, run.view))
                .collect();
            let panel_ids: BTreeSet<Uuid> = runs.keys().copied().collect();
            let assessments: Vec<PointingAssessment> =
                decisions.iter().map(|(assessment, _)| assessment.clone()).collect();
            let scope = GroupScope {
                project: group.project_id,
                subject: group.subject_id,
                rig: group.rig_id,
            };
            check_scope_assessments(conn, &scope, &assessments, &panel_ids).await?;
            for (assessment, choice) in decisions {
                let new_panel = match *choice {
                    PanelChoice::Panel { panel_id } if !panel_ids.contains(&panel_id) => {
                        return Err(invalid(format!(
                            "panel {panel_id} is not a panel of run group {id}"
                        )));
                    }
                    PanelChoice::Panel { panel_id } => Some(panel_id),
                    PanelChoice::LeftOut => None,
                };
                move_session(conn, id, &runs, assessment.session.session_id, new_panel).await?;
                let basis =
                    if new_panel.is_some() { PanelBasis::User } else { PanelBasis::LeftOut };
                write_assignment(conn, id, assessment, basis, new_panel).await?;
            }
            bump_group(conn, id, group.revision).await?;
            load_group_record(conn, id).await
        })
    }

    /// Set the shared setup of run group `id` (VSEL-FR-18, VSEL-AC-22): the
    /// group takes it, and so does every panel run outside the Project's
    /// Trash that is not Complete. A panel run in the Trash or Complete keeps
    /// its own setup and calibration plan and is reported refused, as its own
    /// calibration writes are; no panel's outcome changes another panel or
    /// any status. A policy change moves each changed panel's calibration
    /// plan revision in the same transaction.
    ///
    /// # Errors
    /// `Conflict` for a stale `expected` revision; `NotFound` for an unknown
    /// run group.
    pub async fn set_view_group_setup(
        &self,
        id: Uuid,
        expected: Revision,
        setup: &GroupSetup,
    ) -> Result<GroupActionOutcome> {
        write_txn!(self, |conn| {
            let group = load_group(conn, id).await?;
            require_revision(id, group.revision, expected)?;
            let at = now()?;
            let changed = group.setup != *setup;
            sqlx::query(
                "UPDATE view_groups SET profile_id = ?2, input_mode = ?3, calibration_policy = ?4 \
                 WHERE id = ?1",
            )
            .bind(id.to_string())
            .bind(setup.profile_id.map(|profile| profile.to_string()))
            .bind(setup.input_mode.as_ref().map(to_text).transpose()?)
            .bind(to_text(&setup.calibration_policy)?)
            .execute(&mut *conn)
            .await?;
            let mut panels = Vec::new();
            for PanelRun { number, panel_id, view } in group_runs(conn, id).await? {
                let takes = view.profile_id == setup.profile_id
                    && view.calibration_policy == setup.calibration_policy;
                let result = if view.trashed_at.is_some() {
                    PanelResult::Refused {
                        reason: format!(
                            "Panel {number} is in the Project's Trash and keeps its setup; \
                             restore it first"
                        ),
                    }
                } else if view.completion == RunCompletion::Complete {
                    PanelResult::Refused {
                        reason: format!(
                            "Panel {number} is Complete and keeps its setup; reopen it first"
                        ),
                    }
                } else if takes && !changed {
                    PanelResult::Unchanged
                } else {
                    if !takes {
                        sqlx::query(
                            "UPDATE views SET profile_id = ?2, calibration_policy = ?3, \
                             updated_at = ?4 WHERE id = ?1",
                        )
                        .bind(view.id.to_string())
                        .bind(setup.profile_id.map(|profile| profile.to_string()))
                        .bind(to_text(&setup.calibration_policy)?)
                        .bind(&at)
                        .execute(&mut *conn)
                        .await?;
                        // U22: the shared policy moves the panel's calibration plan (CAL-FR-11).
                        if view.calibration_policy != setup.calibration_policy {
                            crate::calibration::group_policy_changed(conn, &view, &at).await?;
                        }
                    }
                    PanelResult::Applied
                };
                panels.push(PanelOutcome { panel_id, number, view_id: view.id, result });
            }
            bump_group(conn, id, group.revision).await?;
            Ok(GroupActionOutcome { group: load_group(conn, id).await?, panels })
        })
    }
}

// ---------------------------------------------------------------------------
// Panel runs
// ---------------------------------------------------------------------------

/// The candidates of run `view` among `candidates`: a panel run keeps the
/// sessions its group assigned to its panel; any other run keeps them all.
pub async fn panel_candidates(
    conn: &mut SqliteConnection,
    view: &View,
    candidates: Vec<Uuid>,
) -> Result<Vec<Uuid>> {
    let (Some(group), Some(panel)) = (view.group_id, view.panel_id) else {
        return Ok(candidates);
    };
    let assigned: Vec<String> = sqlx::query_scalar(
        "SELECT session_id FROM view_panel_assignments WHERE group_id = ?1 AND panel_id = ?2",
    )
    .bind(group.to_string())
    .bind(panel.to_string())
    .fetch_all(&mut *conn)
    .await?;
    let assigned = assigned.iter().map(|id| parse_uuid(id)).collect::<Result<BTreeSet<_>>>()?;
    Ok(candidates.into_iter().filter(|session| assigned.contains(session)).collect())
}

async fn insert_panel_run(
    conn: &mut SqliteConnection,
    input: &NewViewGroup,
    group: Uuid,
    target_id: Uuid,
    panel: &SubjectPanel,
    at: &str,
) -> Result<i64> {
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO views (id, project_id, subject_id, rig_id, group_id, panel_id, stage, \
         completion, calibration_policy, revision, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, ?10, ?10)",
    )
    .bind(id.to_string())
    .bind(input.project_id.to_string())
    .bind(input.subject_id.to_string())
    .bind(input.rig_id.to_string())
    .bind(group.to_string())
    .bind(panel.id.to_string())
    .bind(to_text(&RunStage::Select)?)
    .bind(to_text(&RunCompletion::Open)?)
    .bind(to_text(&CalibrationPolicy::Automatic)?)
    .bind(at)
    .execute(&mut *conn)
    .await?;
    let criteria = ViewCriteria { target_id, rig_id: input.rig_id, panel_id: Some(panel.id) };
    Ok(sqlx::query(
        "INSERT INTO view_revisions (view_id, state, draft_revision, base_revision, name, \
         criteria, updated_at) VALUES (?1, 'draft', 1, 0, ?2, ?3, ?4)",
    )
    .bind(id.to_string())
    .bind(format!("{} Panel {}", input.name.trim(), panel.number))
    .bind(to_json(&criteria)?)
    .bind(at)
    .execute(&mut *conn)
    .await?
    .last_insert_rowid())
}

/// A group's run with its panel.
pub struct PanelRun {
    pub number: u32,
    pub panel_id: Uuid,
    pub view: View,
}

/// The group's panel runs by panel number.
pub async fn group_runs(conn: &mut SqliteConnection, group: Uuid) -> Result<Vec<PanelRun>> {
    let rows = sqlx::query(
        "SELECT v.id, p.id AS panel_id, p.number FROM views v \
         JOIN subject_panels p ON p.id = v.panel_id WHERE v.group_id = ?1 ORDER BY p.number",
    )
    .bind(group.to_string())
    .fetch_all(&mut *conn)
    .await?;
    let mut runs = Vec::with_capacity(rows.len());
    for row in &rows {
        runs.push(PanelRun {
            number: panel_number(row.try_get("number")?)?,
            panel_id: parse_uuid(&row.try_get::<String, _>("panel_id")?)?,
            view: load_view(conn, parse_uuid(&row.try_get::<String, _>("id")?)?).await?,
        });
    }
    Ok(runs)
}

/// The row a run's membership reads now with the draft revision an edit
/// expects: the draft at its draft revision, else the latest committed
/// revision at 0, else nothing for a run without either.
async fn current_row(conn: &mut SqliteConnection, view: &View) -> Result<Option<(i64, Revision)>> {
    let draft = sqlx::query(
        "SELECT id, draft_revision FROM view_revisions WHERE view_id = ?1 AND state = 'draft'",
    )
    .bind(view.id.to_string())
    .fetch_optional(&mut *conn)
    .await?;
    if let Some(draft) = draft {
        return Ok(Some((draft.try_get("id")?, revision(draft.try_get("draft_revision")?)?)));
    }
    if view.revision == 0 {
        return Ok(None);
    }
    let row: i64 =
        sqlx::query_scalar("SELECT id FROM view_revisions WHERE view_id = ?1 AND revision = ?2")
            .bind(view.id.to_string())
            .bind(db_revision(view.revision)?)
            .fetch_one(&mut *conn)
            .await?;
    Ok(Some((row, 0)))
}

async fn selected_in(conn: &mut SqliteConnection, row: i64, session: Uuid) -> Result<bool> {
    let selected: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM view_session_choices \
         WHERE revision_row = ?1 AND session_id = ?2 AND state = 'selected'",
    )
    .bind(row)
    .bind(session.to_string())
    .fetch_optional(&mut *conn)
    .await?;
    Ok(selected.is_some())
}

/// Move `session` onto `panel` of group `group`, or off every panel for
/// `None`: the panel run that held it under its earlier decision lets it go,
/// and the new panel's run selects it as a manual choice unless its
/// membership already does. Each run touched must be open.
async fn move_session(
    conn: &mut SqliteConnection,
    group: Uuid,
    runs: &BTreeMap<Uuid, View>,
    session: Uuid,
    panel: Option<Uuid>,
) -> Result<()> {
    let old = assigned_panel(conn, group, session).await?;
    if let Some(view) = old.filter(|old| Some(*old) != panel).map(|old| &runs[&old]) {
        if let Some((row, draft)) = current_row(conn, view).await? {
            if selected_in(conn, row, session).await? {
                require_open(view)?;
                let row = begin_edit(conn, view, draft).await?;
                deselect_session(conn, row, session).await?;
            }
        }
    }
    let Some(view) = panel.map(|panel| &runs[&panel]) else {
        return Ok(());
    };
    let current = current_row(conn, view).await?;
    if let Some((row, _)) = current {
        if selected_in(conn, row, session).await? {
            return Ok(());
        }
    }
    require_open(view)?;
    let row = begin_edit(conn, view, current.map_or(0, |(_, draft)| draft)).await?;
    let session = load_session_row(conn, session).await?.session;
    select_session(conn, row, &session, &SelectionReason::Manual, None).await
}

// ---------------------------------------------------------------------------
// Candidates and assessments
// ---------------------------------------------------------------------------

/// The Project, mosaic subject and rig a group's sessions are candidates of.
struct GroupScope {
    project: Uuid,
    subject: Uuid,
    rig: Uuid,
}

async fn subject_panels(conn: &mut SqliteConnection, subject: Uuid) -> Result<Vec<SubjectPanel>> {
    sqlx::query(
        "SELECT id, number, ra_deg, dec_deg, rotation_deg FROM subject_panels \
         WHERE subject_id = ?1 ORDER BY number",
    )
    .bind(subject.to_string())
    .fetch_all(&mut *conn)
    .await?
    .iter()
    .map(|panel| {
        Ok(SubjectPanel {
            id: parse_uuid(&panel.try_get::<String, _>("id")?)?,
            number: panel_number(panel.try_get("number")?)?,
            ra_deg: panel.try_get("ra_deg")?,
            dec_deg: panel.try_get("dec_deg")?,
            rotation_deg: panel.try_get("rotation_deg")?,
        })
    })
    .collect()
}

fn panel_number(value: i64) -> Result<u32> {
    u32::try_from(value)
        .map_err(|_| LibraryError::PersistenceFailure(format!("corrupt panel number {value}")))
}

/// The Project's candidates on the subject's Target and the rig, in
/// candidate order.
async fn scope_candidates(conn: &mut SqliteConnection, scope: &GroupScope) -> Result<Vec<Uuid>> {
    Ok(projects::candidates(conn, scope.project)
        .await?
        .into_iter()
        .filter(|candidate| candidate.subject_id == scope.subject && candidate.rig_id == scope.rig)
        .map(|candidate| candidate.session_id)
        .collect())
}

/// Every candidate of the mosaic subject on the rig, read like a run's picker
/// reads its candidates: sessions holding a light or unknown-type capture
/// outside the Trash, each logical capture once with its copies.
async fn read_candidates(
    conn: &mut SqliteConnection,
    project: Uuid,
    subject: Uuid,
    rig: Uuid,
) -> Result<GroupCandidates> {
    let target_id = run_subject(conn, project, subject, true).await?;
    require_project_rig(conn, project, rig).await?;
    let target = load_target(conn, target_id).await?;
    let framing = FramingTarget {
        target_id,
        designation: target.candidate.designation.clone(),
        coordinates: target.candidate.coordinates.clone(),
    };
    let equipment = load_equipment(conn, rig).await?;
    let panels = subject_panels(conn, subject).await?;
    let scope = GroupScope { project, subject, rig };
    let mut rows = Vec::new();
    let mut members = Vec::new();
    let mut all = Vec::new();
    for session in scope_candidates(conn, &scope).await? {
        let assets = current_member_assets(conn, session).await?;
        if !assets.iter().any(|asset| asset.effective.is_light() != Some(false)) {
            continue;
        }
        rows.push(load_session_row(conn, session).await?);
        all.extend(assets.iter().cloned());
        members.push(assets);
    }
    let session_ids: Vec<Uuid> = rows.iter().map(|row| row.session.id).collect();
    let captures_of = CaptureView::read(conn, &session_ids, &all).await?;
    let mut sessions = Vec::with_capacity(rows.len());
    for (row, assets) in rows.into_iter().zip(members) {
        let captures = captures_of
            .group(&assets)
            .into_iter()
            .filter_map(|(key, present)| candidate_capture(&captures_of, &key, &present))
            .collect();
        sessions.push(CandidateSession {
            captures,
            assessed: assessed_members(&assets),
            summary: captures_of.summary(row, &assets, Vec::new(), Members::Live),
        });
    }
    Ok(GroupCandidates { subject_id: subject, framing, rig: equipment, panels, sessions })
}

/// [`check_scope_assessments`] for a new group; a mosaic without candidates
/// has no assessment to check.
async fn check_assessments(
    conn: &mut SqliteConnection,
    input: &NewViewGroup,
    assessments: &[PointingAssessment],
    panels: &BTreeSet<Uuid>,
) -> Result<()> {
    if assessments.is_empty() {
        return Ok(());
    }
    let scope =
        GroupScope { project: input.project_id, subject: input.subject_id, rig: input.rig_id };
    check_scope_assessments(conn, &scope, assessments, panels).await
}

/// Each assessment is a current candidate's at its expected revisions, names
/// a panel of `panels` or a flag (never both), and an assigned one carries
/// that panel's separation.
async fn check_scope_assessments(
    conn: &mut SqliteConnection,
    scope: &GroupScope,
    assessments: &[PointingAssessment],
    panels: &BTreeSet<Uuid>,
) -> Result<()> {
    let candidates: BTreeSet<Uuid> = scope_candidates(conn, scope).await?.into_iter().collect();
    let expected: Vec<ExpectedSession> =
        assessments.iter().map(|assessment| assessment.session.clone()).collect();
    check_expected_sessions(conn, &expected).await?;
    for assessment in assessments {
        let session = assessment.session.session_id;
        if !candidates.contains(&session) {
            return Err(invalid(format!(
                "session {session} is not a candidate of mosaic subject {} on rig {}",
                scope.subject, scope.rig
            )));
        }
        match (assessment.panel_id, assessment.flag) {
            (Some(panel), None) => {
                if !panels.contains(&panel) {
                    return Err(invalid(format!("panel {panel} is not a panel of the mosaic")));
                }
                assigned_separation(assessment, panel)?;
            }
            (None, Some(_)) => {}
            _ => {
                return Err(invalid(format!(
                    "the assessment of session {session} must name either a panel or a flag"
                )))
            }
        }
    }
    Ok(())
}

/// The separation from `panel`'s centre an assignment by pointing names.
fn assigned_separation(assessment: &PointingAssessment, panel: Uuid) -> Result<f64> {
    assessment
        .evidence
        .checks
        .iter()
        .find(|check| check.panel_id == panel)
        .and_then(|check| check.separation_deg)
        .ok_or_else(|| {
            invalid(format!(
                "session {} is assigned to panel {panel} without pointing evidence",
                assessment.session.session_id
            ))
        })
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

async fn write_assignment(
    conn: &mut SqliteConnection,
    group: Uuid,
    assessment: &PointingAssessment,
    basis: PanelBasis,
    panel: Option<Uuid>,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO view_panel_assignments (group_id, session_id, grouping_revision, panel_id, \
         basis, flag, evidence, decided_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) \
         ON CONFLICT (group_id, session_id) DO UPDATE SET \
         grouping_revision = excluded.grouping_revision, panel_id = excluded.panel_id, \
         basis = excluded.basis, flag = excluded.flag, evidence = excluded.evidence, \
         decided_at = excluded.decided_at",
    )
    .bind(group.to_string())
    .bind(assessment.session.session_id.to_string())
    .bind(db_revision(assessment.session.grouping_revision)?)
    .bind(panel.map(|panel| panel.to_string()))
    .bind(to_text(&basis)?)
    .bind(assessment.flag.as_ref().map(to_text).transpose()?)
    .bind(to_json(&assessment.evidence)?)
    .bind(now()?)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

async fn assigned_panel(
    conn: &mut SqliteConnection,
    group: Uuid,
    session: Uuid,
) -> Result<Option<Uuid>> {
    let panel: Option<Option<String>> = sqlx::query_scalar(
        "SELECT panel_id FROM view_panel_assignments WHERE group_id = ?1 AND session_id = ?2",
    )
    .bind(group.to_string())
    .bind(session.to_string())
    .fetch_optional(&mut *conn)
    .await?;
    panel.flatten().as_deref().map(parse_uuid).transpose()
}

async fn bump_group(conn: &mut SqliteConnection, id: Uuid, current: Revision) -> Result<()> {
    sqlx::query("UPDATE view_groups SET revision = ?2, updated_at = ?3 WHERE id = ?1")
        .bind(id.to_string())
        .bind(db_revision(current + 1)?)
        .bind(now()?)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

fn group_from_row(row: &SqliteRow) -> Result<ViewGroup> {
    let input_mode: Option<String> = row.try_get("input_mode")?;
    let profile: Option<String> = row.try_get("profile_id")?;
    Ok(ViewGroup {
        id: parse_uuid(&row.try_get::<String, _>("id")?)?,
        project_id: parse_uuid(&row.try_get::<String, _>("project_id")?)?,
        subject_id: parse_uuid(&row.try_get::<String, _>("subject_id")?)?,
        rig_id: parse_uuid(&row.try_get::<String, _>("rig_id")?)?,
        name: row.try_get("name")?,
        setup: GroupSetup {
            profile_id: profile.as_deref().map(parse_uuid).transpose()?,
            input_mode: input_mode.as_deref().map(from_text::<InputMode>).transpose()?,
            calibration_policy: from_text(&row.try_get::<String, _>("calibration_policy")?)?,
        },
        revision: revision(row.try_get("revision")?)?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

pub async fn load_group(conn: &mut SqliteConnection, id: Uuid) -> Result<ViewGroup> {
    let row = sqlx::query("SELECT * FROM view_groups WHERE id = ?1")
        .bind(id.to_string())
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| LibraryError::NotFound(format!("run group {id}")))?;
    group_from_row(&row)
}

async fn load_group_record(conn: &mut SqliteConnection, id: Uuid) -> Result<ViewGroupRecord> {
    let group = load_group(conn, id).await?;
    let mut runs = Vec::new();
    for run in group_runs(conn, id).await? {
        runs.push(load_record(conn, run.view.id).await?);
    }
    let rows =
        sqlx::query("SELECT * FROM view_panel_assignments WHERE group_id = ?1 ORDER BY session_id")
            .bind(id.to_string())
            .fetch_all(&mut *conn)
            .await?;
    let assignments = rows
        .iter()
        .map(|row| {
            let panel: Option<String> = row.try_get("panel_id")?;
            let flag: Option<String> = row.try_get("flag")?;
            Ok(PanelAssignment {
                session_id: parse_uuid(&row.try_get::<String, _>("session_id")?)?,
                grouping_revision: revision(row.try_get("grouping_revision")?)?,
                panel_id: panel.as_deref().map(parse_uuid).transpose()?,
                basis: from_text(&row.try_get::<String, _>("basis")?)?,
                flag: flag.as_deref().map(from_text::<PanelFlag>).transpose()?,
                evidence: from_json(&row.try_get::<String, _>("evidence")?)?,
                decided_at: row.try_get("decided_at")?,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(ViewGroupRecord { group, runs, assignments })
}
