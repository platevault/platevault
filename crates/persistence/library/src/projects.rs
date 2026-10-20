// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Project records (spec 065) on the catalog's single serialized writer. Every
//! Project write is one `BEGIN IMMEDIATE` transaction that checks the expected
//! Project revision and every record it names, writes only the Project tables
//! and adds one to the revision. Suggestions (candidates) are derived on read
//! over `live_assets`; the sessions a Project holds are its inputs
//! (`project_inputs`). Nothing here reads or writes an image file or changes a
//! library record.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use platevault_model::{
    builtin_goal_templates, validate_goals, validate_project_name, validate_rigs,
    validate_subjects, ApplicableQuality, Asset, AssetReference, Availability, CaptureInclusion,
    CaptureMetadata, DuplicateRequest, ExclusionBasis, GoalIdentity, GoalInput, GoalProgress,
    GoalSpec, GoalTally, GoalTemplate, GoalTemplateInput, InclusionBasis, LibraryError,
    MeasurementMethod, MeasurementOutcome, MeasurementRecord, MetricId, MetricState, MetricValue,
    Microseconds, Project, ProjectCandidate, ProjectDesired, ProjectGoal, ProjectInput,
    ProjectQuery, ProjectSubject, ProjectSummary, ProjectViewSettings, QualityCriterion,
    RecordValidity, ReferenceKind, Revision, SubjectInput, Units,
};
use sqlx::sqlite::{SqliteConnection, SqliteRow};
use sqlx::{Connection, Row};
use target_match::{Field, Optics};
use uuid::Uuid;

use super::admission;
use super::project_inputs::{self, NewGroup};
use super::{
    capture_quality, db_revision, from_json, from_text, json_ids, load_assets, load_equipment,
    load_target, measurements, next_revision, now, parse_uuid, require_revision, revision, to_json,
    to_text, CaptureView, Catalog, Result, MAX_PAGE,
};

impl Catalog {
    /// Create an open Project at revision 1 with its subjects, rigs and goals.
    /// Writes only Project rows.
    ///
    /// # Errors
    /// `InvalidInput` for invalid fields or goal scope; `NotFound` for an unsaved
    /// Target, unknown equipment, or a goal naming a Target or panel the input
    /// does not list.
    pub async fn create_project(&self, input: &ProjectInput) -> Result<Project> {
        input.validate()?;
        let project = write_txn!(self, |conn| {
            let id = Uuid::new_v4();
            let at = now()?;
            sqlx::query(
                "INSERT INTO projects (id, name, notes, revision, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, 1, ?4, ?4)",
            )
            .bind(id.to_string())
            .bind(input.name.trim())
            .bind(notes(input.notes.as_deref()))
            .bind(&at)
            .execute(&mut *conn)
            .await?;
            write_subjects(conn, id, &input.subjects).await?;
            write_rigs(conn, id, &input.rig_ids).await?;
            write_goals(conn, id, &input.goals).await?;
            load_project(conn, id).await?
        });
        Ok(project)
    }

    /// Replace a Project's name and notes; blank notes are no notes.
    ///
    /// # Errors
    /// `Conflict` for a stale revision; `NotFound` for an unknown Project;
    /// `InvalidInput` for a blank name.
    pub async fn update_project(
        &self,
        id: Uuid,
        expected: Revision,
        name: &str,
        notes_text: Option<&str>,
    ) -> Result<Project> {
        validate_project_name(name)?;
        let project = write_txn!(self, |conn| {
            let next = next_project_revision(conn, id, expected).await?;
            sqlx::query("UPDATE projects SET name = ?2, notes = ?3 WHERE id = ?1")
                .bind(id.to_string())
                .bind(name.trim())
                .bind(notes(notes_text))
                .execute(&mut *conn)
                .await?;
            commit_revision(conn, id, next).await?;
            load_project(conn, id).await?
        });
        Ok(project)
    }

    /// Replace the subject list. A listed Target keeps its subject; an
    /// omitted subject is removed and its goals kept hidden, counted nowhere,
    /// until its Target is a subject again (D-W128). Suggestions follow at
    /// once; no held session changes.
    ///
    /// # Errors
    /// `Conflict` for a stale revision; `NotFound` for an unknown Project or an
    /// unsaved Target; `InvalidInput` for an invalid subject list or for
    /// removing a subject a held session joined on.
    pub async fn set_project_subjects(
        &self,
        id: Uuid,
        expected: Revision,
        subjects: &[SubjectInput],
    ) -> Result<Project> {
        validate_subjects(subjects)?;
        let project = write_txn!(self, |conn| {
            let next = next_project_revision(conn, id, expected).await?;
            write_subjects(conn, id, subjects).await?;
            commit_revision(conn, id, next).await?;
            load_project(conn, id).await?
        });
        Ok(project)
    }

    /// Replace the rig list. Adding a rig adds its confirmed sessions to the
    /// suggestions and removing one takes them out; no held session changes.
    ///
    /// # Errors
    /// `Conflict` for a stale revision; `NotFound` for an unknown Project or
    /// equipment; `InvalidInput` for an empty or repeated rig list, or for
    /// removing a rig a group of the Project is on.
    pub async fn set_project_rigs(
        &self,
        id: Uuid,
        expected: Revision,
        rig_ids: &[Uuid],
    ) -> Result<Project> {
        validate_rigs(rig_ids)?;
        let project = write_txn!(self, |conn| {
            let next = next_project_revision(conn, id, expected).await?;
            write_rigs(conn, id, rig_ids).await?;
            commit_revision(conn, id, next).await?;
            load_project(conn, id).await?
        });
        Ok(project)
    }

    /// Replace the goal list. A goal keeps its id while its subject, panel
    /// group, kind and channel (or criterion) stay.
    ///
    /// # Errors
    /// `Conflict` for a stale revision; `NotFound` for an unknown Project, a
    /// goal naming a Target that is no subject or an unknown group;
    /// `InvalidInput` for an invalid value, a repeated goal or a group that is
    /// not a mosaic panel.
    pub async fn set_project_goals(
        &self,
        id: Uuid,
        expected: Revision,
        goals: &[GoalInput],
    ) -> Result<Project> {
        validate_goals(goals)?;
        let project = write_txn!(self, |conn| {
            let next = next_project_revision(conn, id, expected).await?;
            write_goals(conn, id, goals).await?;
            commit_revision(conn, id, next).await?;
            load_project(conn, id).await?
        });
        Ok(project)
    }

    /// Copy a built-in or user template's values into the goals of one
    /// subject: of the mosaic panel group `group_id`, or the subject's own
    /// goals when `None`. A copied value replaces the same goal's value and
    /// adds the others; the Project keeps no link to the template. Templates
    /// are never filtered by rig.
    ///
    /// # Errors
    /// `Conflict` for a stale revision; `NotFound` for an unknown Project,
    /// template or group, or a Target that is no subject; `InvalidInput` for
    /// a group that is not a mosaic panel.
    pub async fn apply_goal_template(
        &self,
        id: Uuid,
        expected: Revision,
        template_id: Uuid,
        target_id: Uuid,
        group_id: Option<Uuid>,
    ) -> Result<Project> {
        let project = write_txn!(self, |conn| {
            let next = next_project_revision(conn, id, expected).await?;
            let template = load_template(conn, template_id).await?;
            if !subject_ids(conn, id).await?.contains_key(&target_id) {
                return Err(not_a_subject(id, target_id));
            }
            let mut goals = goal_inputs(conn, id).await?;
            for goal in &template.goals {
                let item = GoalInput { target_id, group_id, goal: goal.normalized() };
                let same = |existing: &GoalInput| {
                    existing.target_id == target_id
                        && existing.group_id == group_id
                        && existing.goal.identity() == goal.identity()
                };
                match goals.iter_mut().find(|existing| same(existing)) {
                    Some(existing) => *existing = item,
                    None => goals.push(item),
                }
            }
            validate_goals(&goals)?;
            write_goals(conn, id, &goals).await?;
            commit_revision(conn, id, next).await?;
            load_project(conn, id).await?
        });
        Ok(project)
    }

    /// # Errors
    /// `NotFound` for an unknown Project.
    pub async fn project(&self, id: Uuid) -> Result<Project> {
        let mut conn = self.reader().await?;
        load_project(&mut conn, id).await
    }

    /// Project summaries by name, optionally only those with `target_id` as a
    /// subject. The Projects Wrap up closed (Closing, Closed, Archived) are
    /// listed only with `include_closed` (PRJ-FR-32). No suggestion or
    /// progress is computed.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn list_projects(&self, query: &ProjectQuery) -> Result<Vec<ProjectSummary>> {
        let mut conn = self.reader().await?;
        let rows = sqlx::query(
            "SELECT p.id, p.name, p.lifecycle, p.revision, \
             (SELECT count(*) FROM project_rigs r WHERE r.project_id = p.id) AS rigs, \
             (SELECT count(*) FROM project_goals g WHERE g.project_id = p.id) AS goals \
             FROM projects p WHERE (?1 IS NULL OR EXISTS (SELECT 1 FROM project_subjects s \
             WHERE s.project_id = p.id AND s.target_id = ?1)) AND (?4 OR p.lifecycle = 'open') \
             ORDER BY p.name, p.id LIMIT ?2 OFFSET ?3",
        )
        .bind(query.target_id.map(|id| id.to_string()))
        .bind(i64::from(if query.limit == 0 { MAX_PAGE } else { query.limit.min(MAX_PAGE) }))
        .bind(i64::from(query.offset))
        .bind(query.include_closed)
        .fetch_all(&mut *conn)
        .await?;
        let mut summaries = Vec::with_capacity(rows.len());
        for row in &rows {
            let id = parse_uuid(&row.try_get::<String, _>("id")?)?;
            let subjects: Vec<String> = sqlx::query_scalar(
                "SELECT coalesce(s.name, t.designation) FROM project_subjects s \
                 JOIN targets t ON t.id = s.target_id WHERE s.project_id = ?1 ORDER BY s.position",
            )
            .bind(id.to_string())
            .fetch_all(&mut *conn)
            .await?;
            summaries.push(ProjectSummary {
                id,
                name: row.try_get("name")?,
                lifecycle: from_text(&row.try_get::<String, _>("lifecycle")?)?,
                revision: revision(row.try_get("revision")?)?,
                subjects,
                rig_count: count(row, "rigs")?,
                goal_count: count(row, "goals")?,
            });
        }
        Ok(summaries)
    }

    /// The Project's candidates, derived now: every current session whose
    /// confirmed Target is a subject's Target and whose confirmed rig is a
    /// Project rig, with its frames outside the Trash, whether the Project
    /// holds it or not. An OBJECT header or a suggestion confirms nothing. In
    /// subject, rig and session order.
    ///
    /// # Errors
    /// `NotFound` for an unknown Project.
    pub async fn project_candidates(&self, id: Uuid) -> Result<Vec<ProjectCandidate>> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        require_project(&mut snapshot, id).await?;
        let found = candidates(&mut snapshot, id).await?;
        snapshot.rollback().await?;
        Ok(found)
    }

    /// The Projects holding any of `assets` as a copy of a capture they hold
    /// (`project_capture_copies`), each naming the asked assets it holds, at
    /// its Project revision. Suggestions are derived and hold nothing.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn project_references(&self, assets: &BTreeSet<Uuid>) -> Result<Vec<AssetReference>> {
        if assets.is_empty() {
            return Ok(Vec::new());
        }
        let mut conn = self.reader().await?;
        let rows = sqlx::query(
            "SELECT p.id AS project_id, p.name, p.revision, c.asset_id \
             FROM project_capture_copies c JOIN projects p ON p.id = c.project_id \
             WHERE c.asset_id IN (SELECT value FROM json_each(?1)) \
             ORDER BY p.id, c.asset_id",
        )
        .bind(json_ids(assets)?)
        .fetch_all(&mut *conn)
        .await?;
        let mut references: BTreeMap<Uuid, AssetReference> = BTreeMap::new();
        for row in &rows {
            let id = parse_uuid(&row.try_get::<String, _>("project_id")?)?;
            let asset = parse_uuid(&row.try_get::<String, _>("asset_id")?)?;
            if let Some(reference) = references.get_mut(&id) {
                reference.asset_ids.push(asset);
            } else {
                references.insert(
                    id,
                    AssetReference {
                        kind: ReferenceKind::Project,
                        id,
                        name: row.try_get("name")?,
                        revision: revision(row.try_get("revision")?)?,
                        asset_ids: vec![asset],
                    },
                );
            }
        }
        Ok(references.into_values().collect())
    }

    /// The built-in templates in display order, then the user templates by name.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn goal_templates(&self) -> Result<Vec<GoalTemplate>> {
        let mut conn = self.reader().await?;
        let rows =
            sqlx::query("SELECT id, name, goals, revision FROM goal_templates ORDER BY name, id")
                .fetch_all(&mut *conn)
                .await?;
        let mut templates = builtin_goal_templates();
        for row in &rows {
            templates.push(template_from_row(row)?);
        }
        Ok(templates)
    }

    /// Save a user template: `None` creates it at revision 1, `Some` updates it by
    /// CAS. No Project changes.
    ///
    /// # Errors
    /// `InvalidInput` for invalid fields or a built-in id; `NotFound` for an
    /// unknown id; `Conflict` for a stale revision.
    pub async fn save_goal_template(
        &self,
        input: &GoalTemplateInput,
        expected: Option<Revision>,
    ) -> Result<GoalTemplate> {
        input.validate()?;
        let id = input.id.unwrap_or_else(Uuid::new_v4);
        require_user_template(id)?;
        let goals: Vec<GoalSpec> = input.goals.iter().map(GoalSpec::normalized).collect();
        let saved = write_txn!(self, |conn| {
            let current: Option<i64> =
                sqlx::query_scalar("SELECT revision FROM goal_templates WHERE id = ?1")
                    .bind(id.to_string())
                    .fetch_optional(&mut *conn)
                    .await?;
            let next = match (input.id, current) {
                (None, _) => 1,
                (Some(_), current) => next_revision(id, current, expected, "goal template")?,
            };
            sqlx::query(
                "INSERT INTO goal_templates (id, name, goals, revision, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (id) DO UPDATE SET name = excluded.name, \
                 goals = excluded.goals, revision = excluded.revision, \
                 updated_at = excluded.updated_at",
            )
            .bind(id.to_string())
            .bind(input.name.trim())
            .bind(to_json(&goals)?)
            .bind(db_revision(next)?)
            .bind(now()?)
            .execute(&mut *conn)
            .await?;
            load_template(conn, id).await?
        });
        Ok(saved)
    }

    /// Delete a user template. Projects keep the values copied from it.
    ///
    /// # Errors
    /// `InvalidInput` for a built-in id; `NotFound` for an unknown id; `Conflict`
    /// for a stale revision.
    pub async fn delete_goal_template(&self, id: Uuid, expected: Revision) -> Result<()> {
        require_user_template(id)?;
        write_txn!(self, |conn| {
            let current: Option<i64> =
                sqlx::query_scalar("SELECT revision FROM goal_templates WHERE id = ?1")
                    .bind(id.to_string())
                    .fetch_optional(&mut *conn)
                    .await?;
            let current = current
                .map(revision)
                .transpose()?
                .ok_or_else(|| LibraryError::NotFound(format!("goal template {id}")))?;
            require_revision(id, current, expected)?;
            sqlx::query("DELETE FROM goal_templates WHERE id = ?1")
                .bind(id.to_string())
                .execute(&mut *conn)
                .await?;
        });
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/// Notes as given; blank notes are no notes.
fn notes(text: Option<&str>) -> Option<&str> {
    text.filter(|notes| !notes.trim().is_empty())
}

fn count(row: &SqliteRow, column: &str) -> Result<u64> {
    let value: i64 = row.try_get(column)?;
    u64::try_from(value)
        .map_err(|_| LibraryError::PersistenceFailure(format!("corrupt {column} count {value}")))
}

fn not_a_subject(project: Uuid, target: Uuid) -> LibraryError {
    LibraryError::NotFound(format!("Target {target} is not a subject of project {project}"))
}

pub async fn require_project(conn: &mut SqliteConnection, id: Uuid) -> Result<Revision> {
    let current: Option<i64> = sqlx::query_scalar("SELECT revision FROM projects WHERE id = ?1")
        .bind(id.to_string())
        .fetch_optional(&mut *conn)
        .await?;
    current
        .map(revision)
        .transpose()?
        .ok_or_else(|| LibraryError::NotFound(format!("project {id}")))
}

/// The revision a write of Project `id` commits, after checking `expected`.
pub async fn next_project_revision(
    conn: &mut SqliteConnection,
    id: Uuid,
    expected: Revision,
) -> Result<Revision> {
    let current = require_project(conn, id).await?;
    require_revision(id, current, expected)?;
    Ok(current + 1)
}

pub async fn commit_revision(conn: &mut SqliteConnection, id: Uuid, next: Revision) -> Result<()> {
    sqlx::query("UPDATE projects SET revision = ?2, updated_at = ?3 WHERE id = ?1")
        .bind(id.to_string())
        .bind(db_revision(next)?)
        .bind(now()?)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// The Project's subjects by Target: each one's id.
async fn subject_ids(conn: &mut SqliteConnection, project: Uuid) -> Result<HashMap<Uuid, Uuid>> {
    let rows: Vec<(String, String)> =
        sqlx::query_as("SELECT target_id, id FROM project_subjects WHERE project_id = ?1")
            .bind(project.to_string())
            .fetch_all(&mut *conn)
            .await?;
    rows.iter().map(|(target, id)| Ok((parse_uuid(target)?, parse_uuid(id)?))).collect()
}

/// Keep each listed Target's subject and remove the rest, keeping their goals
/// hidden; a Target listed again gets its hidden goals back (D-W128). A
/// subject a held session joined on is never removed: the session's joined
/// Target is fixed and its goals keep counting it (PRJ-AC-26).
async fn write_subjects(
    conn: &mut SqliteConnection,
    project: Uuid,
    subjects: &[SubjectInput],
) -> Result<()> {
    for subject in subjects {
        load_target(conn, subject.target_id).await?;
    }
    let stored = subject_ids(conn, project).await?;
    let listed: BTreeSet<Uuid> = subjects.iter().map(|subject| subject.target_id).collect();
    for (target, removed) in stored.iter().filter(|(target, _)| !listed.contains(target)) {
        let held: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM project_sessions WHERE project_id = ?1 AND target_id = ?2",
        )
        .bind(project.to_string())
        .bind(target.to_string())
        .fetch_one(&mut *conn)
        .await?;
        if held > 0 {
            let designation = load_target(conn, *target).await?.candidate.designation;
            return Err(LibraryError::InvalidInput(format!(
                "subject {designation} holds {held} session{} of this Project; remove them \
                 from the Project first",
                if held == 1 { "" } else { "s" }
            )));
        }
        hide_goals(conn, *removed, *target).await?;
        sqlx::query("DELETE FROM project_subjects WHERE id = ?1")
            .bind(removed.to_string())
            .execute(&mut *conn)
            .await?;
    }
    for (position, subject) in (0_i64..).zip(subjects) {
        let id = stored.get(&subject.target_id).copied().unwrap_or_else(Uuid::new_v4);
        sqlx::query(
            "INSERT INTO project_subjects (id, project_id, target_id, name, position) \
             VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (id) DO UPDATE SET \
             name = excluded.name, position = excluded.position",
        )
        .bind(id.to_string())
        .bind(project.to_string())
        .bind(subject.target_id.to_string())
        .bind(subject.label())
        .bind(position)
        .execute(&mut *conn)
        .await?;
        if !stored.contains_key(&subject.target_id) {
            restore_hidden_goals(conn, project, subject.target_id).await?;
        }
    }
    Ok(())
}

/// Move the goals of `subject`, the subject of `target`, into the Project's
/// hidden goals with their ids (D-W128): no read counts or shows them.
async fn hide_goals(conn: &mut SqliteConnection, subject: Uuid, target: Uuid) -> Result<()> {
    sqlx::query(
        "INSERT INTO project_hidden_goals (id, project_id, target_id, group_id, kind, channel, \
         goal_seconds, goal_frames, criterion, position) \
         SELECT id, project_id, ?2, group_id, kind, channel, goal_seconds, goal_frames, \
         criterion, position FROM project_goals WHERE subject_id = ?1",
    )
    .bind(subject.to_string())
    .bind(target.to_string())
    .execute(&mut *conn)
    .await?;
    sqlx::query("DELETE FROM project_goals WHERE subject_id = ?1")
        .bind(subject.to_string())
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// Give `target`'s subject, just added to `project`, the goals it had when it
/// was removed, with their ids, after the Project's goals and in their order
/// (D-W128). A panel goal whose group is gone or no longer a panel is
/// dropped: no group is left for it.
pub async fn restore_hidden_goals(
    conn: &mut SqliteConnection,
    project: Uuid,
    target: Uuid,
) -> Result<()> {
    let next: i64 = sqlx::query_scalar(
        "SELECT coalesce(max(position) + 1, 0) FROM project_goals WHERE project_id = ?1",
    )
    .bind(project.to_string())
    .fetch_one(&mut *conn)
    .await?;
    sqlx::query(
        "INSERT INTO project_goals (id, project_id, subject_id, group_id, kind, channel, \
         goal_seconds, goal_frames, criterion, position) \
         SELECT h.id, h.project_id, s.id, h.group_id, h.kind, h.channel, h.goal_seconds, \
         h.goal_frames, h.criterion, ?3 + h.position FROM project_hidden_goals h \
         JOIN project_subjects s ON s.project_id = h.project_id AND s.target_id = h.target_id \
         WHERE h.project_id = ?1 AND h.target_id = ?2 AND (h.group_id IS NULL OR EXISTS \
         (SELECT 1 FROM project_groups g WHERE g.project_id = h.project_id \
         AND g.id = h.group_id AND g.panel = 1)) ORDER BY h.position",
    )
    .bind(project.to_string())
    .bind(target.to_string())
    .bind(next)
    .execute(&mut *conn)
    .await?;
    sqlx::query("DELETE FROM project_hidden_goals WHERE project_id = ?1 AND target_id = ?2")
        .bind(project.to_string())
        .bind(target.to_string())
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// Replace the rig list in order. A rig a group of the Project is on is
/// never removed: groups follow rigs (PRJ-FR-31), and a group is removed only
/// once it holds nothing.
async fn write_rigs(conn: &mut SqliteConnection, project: Uuid, rig_ids: &[Uuid]) -> Result<()> {
    for rig in rig_ids {
        load_equipment(conn, *rig).await?;
    }
    let stored: Vec<String> =
        sqlx::query_scalar("SELECT equipment_id FROM project_rigs WHERE project_id = ?1")
            .bind(project.to_string())
            .fetch_all(&mut *conn)
            .await?;
    let listed: BTreeSet<Uuid> = rig_ids.iter().copied().collect();
    let mut removed = Vec::new();
    for rig in &stored {
        let rig = parse_uuid(rig)?;
        if listed.contains(&rig) {
            continue;
        }
        let groups: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM project_groups WHERE project_id = ?1 AND rig_id = ?2 \
             ORDER BY position",
        )
        .bind(project.to_string())
        .bind(rig.to_string())
        .fetch_all(&mut *conn)
        .await?;
        if !groups.is_empty() {
            return Err(LibraryError::InvalidInput(format!(
                "rig {} has groups in this Project ({}); remove them first",
                load_equipment(conn, rig).await?.name,
                groups.join(", ")
            )));
        }
        removed.push(rig);
    }
    for rig in removed {
        sqlx::query("DELETE FROM project_rigs WHERE project_id = ?1 AND equipment_id = ?2")
            .bind(project.to_string())
            .bind(rig.to_string())
            .execute(&mut *conn)
            .await?;
    }
    for (position, rig) in (0_i64..).zip(rig_ids) {
        sqlx::query(
            "INSERT INTO project_rigs (project_id, equipment_id, position) VALUES (?1, ?2, ?3) \
             ON CONFLICT (project_id, equipment_id) DO UPDATE SET position = excluded.position",
        )
        .bind(project.to_string())
        .bind(rig.to_string())
        .bind(position)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

/// A goal's stored scope (subject, panel group) and identity.
type GoalKey = (Uuid, Option<Uuid>, GoalIdentity);

/// Replace the goal list, resolving each goal's Target to its subject and its
/// group to a mosaic panel group of the Project, and keeping the id of each
/// goal whose key stays.
async fn write_goals(
    conn: &mut SqliteConnection,
    project: Uuid,
    goals: &[GoalInput],
) -> Result<()> {
    let subjects = subject_ids(conn, project).await?;
    let mut stored: HashMap<GoalKey, Uuid> = HashMap::new();
    for row in goal_rows(conn, project).await? {
        let goal = &row.goal;
        stored.insert((goal.subject_id, goal.group_id, goal.goal.identity()), goal.id);
    }
    let mut resolved = Vec::with_capacity(goals.len());
    for item in goals {
        let subject_id =
            *subjects.get(&item.target_id).ok_or_else(|| not_a_subject(project, item.target_id))?;
        if let Some(group) = item.group_id {
            require_panel_group(conn, project, group).await?;
        }
        let goal = item.goal.normalized();
        let key = (subject_id, item.group_id, goal.identity());
        let id = stored.get(&key).copied().unwrap_or_else(Uuid::new_v4);
        resolved.push(ProjectGoal { id, subject_id, group_id: item.group_id, goal });
    }
    sqlx::query("DELETE FROM project_goals WHERE project_id = ?1")
        .bind(project.to_string())
        .execute(&mut *conn)
        .await?;
    for (position, goal) in (0_i64..).zip(&resolved) {
        let (seconds, frames, criterion) = match &goal.goal {
            GoalSpec::Integration { goal_seconds, .. } => {
                (Some(db_count(*goal_seconds)?), None, None)
            }
            GoalSpec::FrameCount { goal_frames, .. } => (None, Some(db_count(*goal_frames)?), None),
            GoalSpec::QualityBar { criterion } => (None, None, Some(to_json(criterion)?)),
        };
        sqlx::query(
            "INSERT INTO project_goals (id, project_id, subject_id, group_id, kind, channel, \
             goal_seconds, goal_frames, criterion, position) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        )
        .bind(goal.id.to_string())
        .bind(project.to_string())
        .bind(goal.subject_id.to_string())
        .bind(goal.group_id.map(|id| id.to_string()))
        .bind(goal.goal.kind_name())
        .bind(goal.goal.channel())
        .bind(seconds)
        .bind(frames)
        .bind(criterion)
        .bind(position)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

fn db_count(value: u64) -> Result<i64> {
    i64::try_from(value)
        .map_err(|_| LibraryError::InvalidInput(format!("goal {value} out of range")))
}

/// A goal's group must be a mosaic panel group of the Project (PRJ-FR-03,
/// PRJ-FR-29).
async fn require_panel_group(
    conn: &mut SqliteConnection,
    project: Uuid,
    group: Uuid,
) -> Result<()> {
    let panel: Option<i64> =
        sqlx::query_scalar("SELECT panel FROM project_groups WHERE id = ?1 AND project_id = ?2")
            .bind(group.to_string())
            .bind(project.to_string())
            .fetch_optional(&mut *conn)
            .await?;
    match panel {
        None => Err(LibraryError::NotFound(format!("group {group} of project {project}"))),
        Some(1) => Ok(()),
        Some(_) => Err(LibraryError::InvalidInput(format!(
            "group {group} is not a mosaic panel; only a panel group has its own goals"
        ))),
    }
}

fn require_user_template(id: Uuid) -> Result<()> {
    if builtin_goal_templates().iter().any(|template| template.id == id) {
        return Err(LibraryError::InvalidInput(format!(
            "built-in goal template {id} is read-only"
        )));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async fn load_template(conn: &mut SqliteConnection, id: Uuid) -> Result<GoalTemplate> {
    if let Some(builtin) = builtin_goal_templates().into_iter().find(|template| template.id == id) {
        return Ok(builtin);
    }
    let row = sqlx::query("SELECT id, name, goals, revision FROM goal_templates WHERE id = ?1")
        .bind(id.to_string())
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| LibraryError::NotFound(format!("goal template {id}")))?;
    template_from_row(&row)
}

fn template_from_row(row: &SqliteRow) -> Result<GoalTemplate> {
    Ok(GoalTemplate {
        id: parse_uuid(&row.try_get::<String, _>("id")?)?,
        name: row.try_get("name")?,
        builtin: false,
        revision: revision(row.try_get("revision")?)?,
        goals: from_json(&row.try_get::<String, _>("goals")?)?,
    })
}

pub async fn load_project(conn: &mut SqliteConnection, id: Uuid) -> Result<Project> {
    let row = sqlx::query(
        "SELECT name, notes, lifecycle, closed_at, revision, created_at, updated_at FROM projects \
         WHERE id = ?1",
    )
    .bind(id.to_string())
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| LibraryError::NotFound(format!("project {id}")))?;
    let rig_ids: Vec<String> = sqlx::query_scalar(
        "SELECT equipment_id FROM project_rigs WHERE project_id = ?1 ORDER BY position",
    )
    .bind(id.to_string())
    .fetch_all(&mut *conn)
    .await?;
    Ok(Project {
        id,
        name: row.try_get("name")?,
        notes: row.try_get("notes")?,
        lifecycle: from_text(&row.try_get::<String, _>("lifecycle")?)?,
        closed_at: row.try_get("closed_at")?,
        revision: revision(row.try_get("revision")?)?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
        subjects: load_subjects(conn, id).await?,
        rig_ids: rig_ids.iter().map(|rig| parse_uuid(rig)).collect::<Result<_>>()?,
        goals: goal_rows(conn, id).await?.into_iter().map(|row| row.goal).collect(),
    })
}

async fn load_subjects(conn: &mut SqliteConnection, project: Uuid) -> Result<Vec<ProjectSubject>> {
    let rows = sqlx::query(
        "SELECT s.id, s.target_id, t.designation, s.name FROM project_subjects s \
         JOIN targets t ON t.id = s.target_id WHERE s.project_id = ?1 ORDER BY s.position",
    )
    .bind(project.to_string())
    .fetch_all(&mut *conn)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(ProjectSubject {
                id: parse_uuid(&row.try_get::<String, _>("id")?)?,
                target_id: parse_uuid(&row.try_get::<String, _>("target_id")?)?,
                designation: row.try_get("designation")?,
                name: row.try_get("name")?,
            })
        })
        .collect()
}

/// A stored goal with the Target that names it in inputs.
struct GoalRow {
    goal: ProjectGoal,
    target_id: Uuid,
}

async fn goal_rows(conn: &mut SqliteConnection, project: Uuid) -> Result<Vec<GoalRow>> {
    let rows = sqlx::query(
        "SELECT g.id, g.subject_id, g.group_id, g.kind, g.channel, g.goal_seconds, \
         g.goal_frames, g.criterion, s.target_id FROM project_goals g \
         JOIN project_subjects s ON s.id = g.subject_id \
         WHERE g.project_id = ?1 ORDER BY g.position",
    )
    .bind(project.to_string())
    .fetch_all(&mut *conn)
    .await?;
    rows.iter()
        .map(|row| {
            let channel: Option<String> = row.try_get("channel")?;
            let stored_count = |column: &str| -> Result<u64> {
                let value: Option<i64> = row.try_get(column)?;
                value.and_then(|value| u64::try_from(value).ok()).ok_or_else(|| {
                    LibraryError::PersistenceFailure(format!("corrupt goal {column}"))
                })
            };
            let kind: String = row.try_get("kind")?;
            let goal = match kind.as_str() {
                "integration" => {
                    GoalSpec::Integration { channel, goal_seconds: stored_count("goal_seconds")? }
                }
                "frame_count" => {
                    GoalSpec::FrameCount { channel, goal_frames: stored_count("goal_frames")? }
                }
                "quality_bar" => GoalSpec::QualityBar {
                    criterion: from_json(&row.try_get::<String, _>("criterion")?)?,
                },
                other => {
                    return Err(LibraryError::PersistenceFailure(format!(
                        "corrupt goal kind {other}"
                    )));
                }
            };
            let group_id: Option<String> = row.try_get("group_id")?;
            Ok(GoalRow {
                goal: ProjectGoal {
                    id: parse_uuid(&row.try_get::<String, _>("id")?)?,
                    subject_id: parse_uuid(&row.try_get::<String, _>("subject_id")?)?,
                    group_id: group_id.as_deref().map(parse_uuid).transpose()?,
                    goal,
                },
                target_id: parse_uuid(&row.try_get::<String, _>("target_id")?)?,
            })
        })
        .collect()
}

/// The stored goals as inputs, in order.
async fn goal_inputs(conn: &mut SqliteConnection, project: Uuid) -> Result<Vec<GoalInput>> {
    Ok(goal_rows(conn, project)
        .await?
        .into_iter()
        .map(|row| GoalInput {
            target_id: row.target_id,
            group_id: row.goal.group_id,
            goal: row.goal.goal,
        })
        .collect())
}

/// The Project's candidates on `conn`'s snapshot: current sessions with a
/// confirmed subject Target and a confirmed Project rig that hold a frame
/// outside the Trash, each with only those frames.
pub async fn candidates(
    conn: &mut SqliteConnection,
    project: Uuid,
) -> Result<Vec<ProjectCandidate>> {
    let rows = sqlx::query(
        "SELECT s.id AS session_id, s.grouping_revision, s.decision_revision, s.date_basis, \
         ps.id AS subject_id, ea.equipment_id AS rig_id, \
         (SELECT json_group_array(a.id) FROM live_assets a WHERE a.session_id = s.id) AS asset_ids \
         FROM project_subjects ps \
         JOIN associations ta ON ta.kind = 'target' AND ta.state = 'confirmed' \
         AND ta.target_id = ps.target_id \
         JOIN sessions s ON s.id = ta.session_id AND s.superseded_by IS NULL \
         JOIN associations ea ON ea.session_id = s.id AND ea.kind = 'equipment' \
         AND ea.state = 'confirmed' \
         JOIN project_rigs pr ON pr.project_id = ps.project_id AND pr.equipment_id = ea.equipment_id \
         WHERE ps.project_id = ?1 AND EXISTS (SELECT 1 FROM live_assets a WHERE a.session_id = s.id) \
         ORDER BY ps.position, pr.position, s.date_basis, s.id",
    )
    .bind(project.to_string())
    .fetch_all(&mut *conn)
    .await?;
    rows.iter()
        .map(|row| {
            let ids: Vec<String> = from_json(&row.try_get::<String, _>("asset_ids")?)?;
            let mut asset_ids = ids.iter().map(|id| parse_uuid(id)).collect::<Result<Vec<_>>>()?;
            asset_ids.sort_unstable();
            Ok(ProjectCandidate {
                session_id: parse_uuid(&row.try_get::<String, _>("session_id")?)?,
                grouping_revision: revision(row.try_get("grouping_revision")?)?,
                decision_revision: revision(row.try_get("decision_revision")?)?,
                date_basis: row.try_get("date_basis")?,
                subject_id: parse_uuid(&row.try_get::<String, _>("subject_id")?)?,
                rig_id: parse_uuid(&row.try_get::<String, _>("rig_id")?)?,
                asset_ids,
            })
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Progress (PRJ-FR-03, PRJ-FR-04, PRJ-FR-29, D-W36, D-W43, D-W66, D-W96)
// ---------------------------------------------------------------------------

/// A Project's goal progress, read from one catalog snapshot at the
/// Project's revision.
#[derive(Clone, Debug)]
pub struct ProgressBasis {
    pub project_id: Uuid,
    pub revision: Revision,
    /// One row per integration or frame-count goal, in goal order.
    pub goals: Vec<GoalProgress>,
}

impl Catalog {
    /// Goal progress of Project `id` (PRJ-FR-04) from one catalog snapshot.
    /// "in project" counts the frames of the Project's own sessions that its
    /// next View places, each content-identical frame once; "captured" adds
    /// its excluded frames and the frames of its suggestions. Each Project
    /// counts its own sessions, so a session two Projects hold counts in
    /// each. A median-FWHM bar reads the latest `method` record valid for the
    /// frame's current bytes (PIX R12). Hashes, measures and writes nothing.
    ///
    /// # Errors
    /// `NotFound` for an unknown Project; `PersistenceFailure` when the
    /// catalog cannot be read.
    pub async fn project_progress_basis(
        &self,
        id: Uuid,
        method: &MeasurementMethod,
    ) -> Result<ProgressBasis> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let basis = progress_basis(&mut snapshot, id, method).await?;
        snapshot.rollback().await?;
        Ok(basis)
    }
}

/// Where the Project holds a frame: the subject of its session's confirmed
/// Target and its group.
struct Holding {
    subject_id: Option<Uuid>,
    group_id: Uuid,
    /// The next build places it: its inclusion admits its live quality
    /// (VSEL-FR-15), so it counts in project.
    counts: bool,
}

/// One content-identical frame: its logical captures (D16) joined by equal
/// SHA-256, with the facts its goals read from its counted copies.
struct Frame {
    light: Option<bool>,
    channel: Option<String>,
    exposure: Option<Microseconds>,
    quality: ApplicableQuality,
    /// The median FWHM in arcseconds; `None` without a valid measured value
    /// or the frame's pixel scale.
    fwhm_arcsec: Option<f64>,
    /// The subjects whose suggestions hold it.
    candidate_of: BTreeSet<Uuid>,
    holdings: Vec<Holding>,
}

/// Trashed copies and copies of retired locations count toward no total.
const fn counted(asset: &Asset) -> bool {
    !matches!(asset.availability, Availability::Trashed | Availability::Retired)
}

pub async fn progress_basis(
    conn: &mut SqliteConnection,
    id: Uuid,
    method: &MeasurementMethod,
) -> Result<ProgressBasis> {
    let project = load_project(conn, id).await?;
    let suggested = project_inputs::suggested(conn, id).await?;
    let held = project_inputs::held_captures(conn, id).await?;
    let mut ids: BTreeSet<Uuid> =
        suggested.iter().flat_map(|(candidate, _)| candidate.asset_ids.iter().copied()).collect();
    ids.extend(held.iter().flat_map(|held| held.capture.copies.iter().map(|c| c.asset_id)));
    let assets: Vec<Asset> = load_assets(conn, &ids).await?.into_iter().filter(counted).collect();
    let live: HashMap<Uuid, &Asset> = assets.iter().map(|asset| (asset.id, asset)).collect();
    let captures = CaptureView::read(conn, &[], &assets).await?;
    let (of_asset, copies) = content_frames(&captures, &assets);
    let copy_ids: BTreeSet<Uuid> = copies.iter().flatten().map(|copy| copy.id).collect();
    let mut records = measurements::latest_records(conn, &copy_ids, &method.name).await?;
    let mut frames: Vec<Frame> =
        copies.iter().map(|copies| frame_of(copies, &mut records, method)).collect();
    for held in held {
        let capture = &held.capture;
        let live_copies: Vec<&Asset> =
            capture.copies.iter().filter_map(|copy| live.get(&copy.asset_id).copied()).collect();
        // A capture with no counted copy left leaves both numbers.
        let Some(index) = std::iter::once(capture.capture_key)
            .chain(capture.copies.iter().map(|copy| copy.asset_id))
            .find_map(|asset| of_asset.get(&asset).copied())
        else {
            continue;
        };
        let counts = capture.inclusion.admits(project_inputs::live_quality(&live_copies));
        frames[index].holdings.push(Holding {
            subject_id: held.subject_id,
            group_id: held.group_id,
            counts,
        });
    }
    for (candidate, _) in &suggested {
        for asset in &candidate.asset_ids {
            let Some(&index) = of_asset.get(asset) else { continue };
            frames[index].candidate_of.insert(candidate.subject_id);
        }
    }
    let goals = project
        .goals
        .iter()
        .filter(|goal| goal.goal.counts_frames())
        .map(|goal| goal_progress(&project.goals, goal, &frames))
        .collect();
    Ok(ProgressBasis { project_id: project.id, revision: project.revision, goals })
}

/// Group counted copies into content-identical frames: logical captures (D16)
/// joined when any of their copies record the same SHA-256, so a byte-identical
/// duplicate in one location is one frame too. Returns each asset's frame and
/// each frame's counted copies in id order.
fn content_frames(
    captures: &CaptureView,
    assets: &[Asset],
) -> (HashMap<Uuid, usize>, Vec<Vec<Asset>>) {
    let mut copies_of: BTreeMap<String, BTreeMap<Uuid, Asset>> = BTreeMap::new();
    for asset in assets {
        let copies = copies_of.entry(captures.key(asset).to_owned()).or_default();
        copies.insert(asset.id, asset.clone());
        for copy in captures.copies_of(captures.key(asset)) {
            if counted(copy) {
                copies.insert(copy.id, copy.clone());
            }
        }
    }
    let mut parent: HashMap<String, String> = HashMap::new();
    let mut by_digest: HashMap<String, String> = HashMap::new();
    for (key, copies) in &copies_of {
        for copy in copies.values() {
            let Some(digest) = copy.fingerprint.content_sha256.as_deref() else { continue };
            match by_digest.get(digest) {
                Some(first) => {
                    let (left, right) = (root(&parent, key), root(&parent, first));
                    if left != right {
                        let (low, high) = if left < right { (left, right) } else { (right, left) };
                        parent.insert(high, low);
                    }
                }
                None => {
                    by_digest.insert(digest.to_owned(), key.clone());
                }
            }
        }
    }
    let mut joined: BTreeMap<String, BTreeMap<Uuid, Asset>> = BTreeMap::new();
    for (key, copies) in copies_of {
        joined.entry(root(&parent, &key)).or_default().extend(copies);
    }
    let mut of_asset = HashMap::new();
    let frames = joined
        .into_values()
        .enumerate()
        .map(|(index, copies)| {
            of_asset.extend(copies.keys().map(|id| (*id, index)));
            copies.into_values().collect()
        })
        .collect();
    (of_asset, frames)
}

/// The root of `key`'s set; a key without a parent is its own root.
fn root(parent: &HashMap<String, String>, key: &str) -> String {
    let mut key = key;
    while let Some(next) = parent.get(key) {
        key = next;
    }
    key.to_owned()
}

/// A frame's facts from its counted copies: image type, channel and exposure
/// from its primary copy (Available first), applicable quality over every
/// copy, and the median FWHM in arcseconds of the first copy with a valid
/// measured record and a known pixel scale.
fn frame_of(
    copies: &[Asset],
    records: &mut HashMap<Uuid, MeasurementRecord>,
    method: &MeasurementMethod,
) -> Frame {
    let primary = copies
        .iter()
        .min_by_key(|copy| {
            (copy.availability != Availability::Available, copy.location_id, copy.id)
        })
        .expect("a frame holds at least one copy");
    let effective = &primary.effective;
    let fwhm_arcsec = copies.iter().find_map(|copy| {
        let record = records.remove(&copy.id)?;
        if measurements::validity(copy, Some(&record), method) != RecordValidity::Valid {
            return None;
        }
        let MeasurementOutcome::Measured { metrics, .. } = record.outcome else { return None };
        metrics
            .into_iter()
            .find(|value| {
                value.metric == MetricId::FwhmMedian && value.state == MetricState::Measured
            })
            .and_then(|value| fwhm_in_arcsec(&value, &copy.effective))
    });
    Frame {
        light: effective.is_light(),
        channel: effective
            .filter
            .as_deref()
            .map(str::trim)
            .filter(|filter| !filter.is_empty())
            .map(str::to_owned),
        exposure: effective.exposure_seconds.and_then(Microseconds::from_seconds),
        quality: capture_quality(&copies.iter().collect::<Vec<_>>()),
        fwhm_arcsec,
        candidate_of: BTreeSet::new(),
        holdings: Vec::new(),
    }
}

/// A median FWHM in arcseconds: an arcsecond value as recorded, a pixel value
/// through the frame's pixel scale, and `None` for another unit, no value or
/// an unknown scale (PRJ-FR-03).
fn fwhm_in_arcsec(value: &MetricValue, frame: &CaptureMetadata) -> Option<f64> {
    let fwhm = value.value?;
    match value.units {
        Units::Arcsec => Some(fwhm),
        Units::Px => Some(fwhm * pixel_scale_arcsec(frame)?),
        _ => None,
    }
}

/// Arcseconds per pixel from the frame's FOCALLEN and XPIXSZ; `None` when
/// either, or the frame size `target_match` completes the field with, is
/// unknown. XPIXSZ already includes binning ("physical X dimension of the
/// sensor's pixels in microns … Includes binning", the `MaxIm DL` FITS File
/// Header Definitions,
/// <https://cdn.diffractionlimited.com/help/maximdl/FITS_File_Header_Definitions.htm>),
/// as N.I.N.A. writes it too, so binning stays 1×1 here.
fn pixel_scale_arcsec(frame: &CaptureMetadata) -> Option<f64> {
    let pixel = frame.pixel_size_um?;
    let field = Field::from_optics(Optics {
        focal_mm: frame.focal_length_mm?,
        pixel_um: (pixel, pixel),
        binning: (1, 1),
        pixels: (frame.width?, frame.height?),
    })
    .ok()?;
    field.pixel_scale().map(|(x, _)| x)
}

/// One goal's two numbers over `frames`, each counted once. A frame is
/// captured when the Project holds it in a session on the goal's subject (in
/// the goal's panel group, for a panel goal), whether it is placed or not,
/// or when a suggestion on the subject holds it; it is in project when the
/// Project holds it there, its next View places it and every bar admits it.
/// Panel goals take held frames only: a suggestion is in no group.
fn goal_progress(goals: &[ProjectGoal], goal: &ProjectGoal, frames: &[Frame]) -> GoalProgress {
    let scoped = |scope: Option<Uuid>, of: Option<Uuid>| scope.is_none() || scope == of;
    let quality_bars: Vec<QualityCriterion> = goals
        .iter()
        .filter(|bar| bar.subject_id == goal.subject_id && scoped(bar.group_id, goal.group_id))
        .filter_map(|bar| match &bar.goal {
            GoalSpec::QualityBar { criterion } => Some(criterion.clone()),
            _ => None,
        })
        .collect();
    let mut progress = GoalProgress {
        goal: goal.clone(),
        in_project: GoalTally::default(),
        captured: GoalTally::default(),
        met: false,
        quality_bars,
        unknown_for_bar: 0,
    };
    let channel = goal.goal.channel();
    for frame in frames {
        if frame.light == Some(false) || frame.channel.as_deref() != channel {
            continue;
        }
        let mut held = frame.holdings.iter().filter(|holding| {
            holding.subject_id == Some(goal.subject_id)
                && scoped(goal.group_id, Some(holding.group_id))
        });
        let member = held.clone().next().is_some();
        let counts = held.any(|holding| holding.counts);
        let candidate = goal.group_id.is_none() && frame.candidate_of.contains(&goal.subject_id);
        if !member && !candidate {
            continue;
        }
        progress.captured.count(frame.light, frame.exposure);
        if !counts {
            continue;
        }
        match admits(&progress.quality_bars, frame) {
            Some(true) => progress.in_project.count(frame.light, frame.exposure),
            Some(false) => {}
            None => progress.unknown_for_bar += 1,
        }
    }
    progress.met = goal.goal.met_by(&progress.in_project);
    progress
}

/// Whether every bar admits `frame`; `None` when none refuses it and one cannot
/// judge it because the measurement it needs is missing (PRJ-FR-03).
fn admits(bars: &[QualityCriterion], frame: &Frame) -> Option<bool> {
    let mut unknown = false;
    for bar in bars {
        match bar {
            QualityCriterion::UsableOnly => {
                if frame.quality != ApplicableQuality::Usable {
                    return Some(false);
                }
            }
            QualityCriterion::MaxFwhmMedian { max_arcsec } => match frame.fwhm_arcsec {
                Some(value) if value <= *max_arcsec => {}
                Some(_) => return Some(false),
                None => unknown = true,
            },
        }
    }
    (!unknown).then_some(true)
}

// ---------------------------------------------------------------------------
// Duplicate (PRJ-FR-30; D-W96, D-W112). Closing is Wrap up's
// (`project_wrap_up`); there is no Reopen (PRJ-FR-32).
// ---------------------------------------------------------------------------

impl Catalog {
    /// Duplicate… (PRJ-FR-30; D-W96, D-W112): a new open Project at revision
    /// 1 with the source's subjects and rigs, the chosen `sessions` in copies
    /// of their groups with their placement, joined Target and frame
    /// overrides, and, as ticked, its goals, notes and View settings. Each
    /// session joins through the admission rule on its current calibration
    /// pins, never the source's Close snapshot. No file is copied: the
    /// duplicate has no View until its first Apply, and nothing links it to
    /// the source, which stays unchanged. Open, Closed and Archived Projects
    /// duplicate alike.
    ///
    /// # Errors
    /// `InvalidInput` for a blank name, a session the source doesn't hold,
    /// or one the admission rule refuses now, naming its blockers;
    /// `Conflict` for a session regrouped since; `NotFound` for an unknown
    /// Project.
    pub async fn duplicate_project(&self, request: &DuplicateRequest) -> Result<Project> {
        validate_project_name(&request.name)?;
        let project = write_txn!(self, |conn| {
            let source = load_project(conn, request.project_id).await?;
            let desired = project_inputs::read_desired(conn, request.project_id).await?;
            let chosen: BTreeSet<Uuid> = request.sessions.iter().copied().collect();
            if let Some(stray) = chosen
                .iter()
                .find(|session| desired.sessions.iter().all(|held| held.session_id != **session))
            {
                return Err(LibraryError::InvalidInput(format!(
                    "session {stray} is not in Project '{}'",
                    source.name
                )));
            }
            let id = Uuid::new_v4();
            let at = now()?;
            sqlx::query(
                "INSERT INTO projects (id, name, notes, revision, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, 1, ?4, ?4)",
            )
            .bind(id.to_string())
            .bind(request.name.trim())
            .bind(if request.notes { notes(source.notes.as_deref()) } else { None })
            .bind(&at)
            .execute(&mut *conn)
            .await?;
            if request.settings {
                copy_view_settings(conn, id, &desired.settings).await?;
            }
            write_subjects(conn, id, &subject_inputs(&source)).await?;
            write_rigs(conn, id, &source.rig_ids).await?;
            let goal_groups: BTreeSet<Uuid> = if request.goals {
                source.goals.iter().filter_map(|goal| goal.group_id).collect()
            } else {
                BTreeSet::new()
            };
            let groups = copy_groups(conn, id, &desired, &chosen, &goal_groups).await?;
            copy_sessions(conn, id, &desired, &chosen, &groups).await?;
            if request.goals {
                let mut goals = goal_inputs(conn, request.project_id).await?;
                for goal in &mut goals {
                    goal.group_id = goal.group_id.and_then(|group| groups.get(&group).copied());
                }
                write_goals(conn, id, &goals).await?;
            }
            load_project(conn, id).await?
        });
        Ok(project)
    }
}

/// Copy the source's groups that hold a chosen session or carry a goal the
/// duplicate keeps, with fresh ids; returns the source id → copy id map.
async fn copy_groups(
    conn: &mut SqliteConnection,
    id: Uuid,
    desired: &ProjectDesired,
    chosen: &BTreeSet<Uuid>,
    goal_groups: &BTreeSet<Uuid>,
) -> Result<HashMap<Uuid, Uuid>> {
    let mut groups = HashMap::new();
    for group in &desired.groups {
        let holds = desired
            .sessions
            .iter()
            .any(|held| held.group_id == group.id && chosen.contains(&held.session_id));
        if !holds && !goal_groups.contains(&group.id) {
            continue;
        }
        let copy = NewGroup {
            id: Uuid::new_v4(),
            rig_id: group.rig_id,
            name: group.name.clone(),
            origin: group.origin,
            optics: group.optics.clone(),
            framing: group.framing,
        };
        project_inputs::insert_group(conn, id, &copy).await?;
        if group.panel {
            sqlx::query("UPDATE project_groups SET panel = 1 WHERE id = ?1")
                .bind(copy.id.to_string())
                .execute(&mut *conn)
                .await?;
        }
        groups.insert(group.id, copy.id);
    }
    Ok(groups)
}

/// Add each chosen session to its group's copy through the admission rule
/// (its current pins), on the Target it joined the source on, with its live
/// captures; the user's own frame choices carry over, every other capture
/// follows the Library as it stands now.
async fn copy_sessions(
    conn: &mut SqliteConnection,
    id: Uuid,
    desired: &ProjectDesired,
    chosen: &BTreeSet<Uuid>,
    groups: &HashMap<Uuid, Uuid>,
) -> Result<()> {
    let overrides: HashMap<Uuid, CaptureInclusion> = desired
        .captures
        .iter()
        .filter(|capture| {
            matches!(
                capture.inclusion,
                CaptureInclusion::Included { basis: InclusionBasis::Explicit }
                    | CaptureInclusion::Excluded { basis: ExclusionBasis::User }
            )
        })
        .flat_map(|capture| capture.copies.iter().map(|copy| (copy.asset_id, capture.inclusion)))
        .collect();
    for held in desired.sessions.iter().filter(|held| chosen.contains(&held.session_id)) {
        let group = groups[&held.group_id];
        let basis = admission::require_admission(conn, id, group, held.session_id, None).await?;
        project_inputs::insert_member(
            conn,
            id,
            held.session_id,
            group,
            held.placement,
            held.target_id,
            &basis,
        )
        .await?;
        for capture in project_inputs::session_captures(conn, held.session_id).await? {
            let inclusion = capture
                .copies
                .iter()
                .find_map(|copy| overrides.get(&copy.asset_id).copied())
                .unwrap_or(capture.inclusion);
            project_inputs::insert_capture(
                conn,
                id,
                capture.session_id,
                capture.capture_key,
                &capture.copies,
                inclusion,
                capture.quality_when_added,
            )
            .await?;
        }
    }
    Ok(())
}

/// The source Project's subjects as they are written for a duplicate.
fn subject_inputs(source: &Project) -> Vec<SubjectInput> {
    source
        .subjects
        .iter()
        .map(|subject| SubjectInput { target_id: subject.target_id, name: subject.name.clone() })
        .collect()
}

/// Copy the source's View settings onto the duplicate: mode, keywords,
/// profile and processing location.
async fn copy_view_settings(
    conn: &mut SqliteConnection,
    id: Uuid,
    settings: &ProjectViewSettings,
) -> Result<()> {
    sqlx::query(
        "UPDATE projects SET view_mode = ?2, group_keyword = ?3, panel_keyword = ?4, \
         profile_id = ?5, processing_parent = ?6 WHERE id = ?1",
    )
    .bind(id.to_string())
    .bind(to_text(&settings.mode)?)
    .bind(settings.keywords.as_ref().map(|keywords| keywords.group().as_str().to_owned()))
    .bind(settings.keywords.as_ref().map(|keywords| keywords.panel().as_str().to_owned()))
    .bind(settings.profile_id.map(|id| id.to_string()))
    .bind(settings.parent.as_ref().map(to_json).transpose()?)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use platevault_model::{
        AssociationState, Equipment, ProjectInput, ProjectQuery, Provenance, SubjectInput,
        TargetCandidate,
    };
    use uuid::Uuid;

    use super::Catalog;

    fn target() -> TargetCandidate {
        TargetCandidate {
            id: Uuid::new_v4(),
            designation: "NGC 7000".into(),
            aliases: Vec::new(),
            common_name: None,
            object_type: "nebula".into(),
            coordinates: None,
            provenance: Provenance::User,
            provider_id: None,
            angular_size: None,
            catalogues: Vec::new(),
        }
    }

    fn rig() -> Equipment {
        Equipment {
            id: Uuid::new_v4(),
            name: "RedCat 51".into(),
            camera: None,
            telescope: None,
            focal_length_mm: None,
            pixel_size_um: None,
            sensor_width_px: None,
            sensor_height_px: None,
            color_kind: None,
            decision_revision: 0,
            state: AssociationState::Confirmed,
            provenance: Provenance::User,
        }
    }

    /// A disposable `max_page_count` catalog forces `SQLITE_FULL` on a Project
    /// write: it reports `PersistenceFailure`, and nothing of it persists.
    #[tokio::test]
    async fn sqlite_full_on_a_project_write_reports_persistence_failure_and_persists_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("catalog.sqlite");
        let catalog = Catalog::open(&path).await.unwrap();
        let target = catalog.save_target(&target(), None).await.unwrap();
        let rig = catalog.save_equipment(&rig(), None).await.unwrap();
        let subject = SubjectInput { target_id: target.candidate.id, name: None };
        let input = ProjectInput {
            name: "NGC 7000 HOO".into(),
            notes: Some("x".repeat(400_000)),
            subjects: vec![subject],
            rig_ids: vec![rig.id],
            goals: Vec::new(),
        };
        catalog.limit_writer_pages_for_test().await.unwrap();
        let error = catalog.create_project(&input).await.unwrap_err();
        assert_eq!(error.code().as_str(), "persistence_failure");
        assert!(error.to_string().contains("full"), "{error}");
        catalog.close().await.unwrap();

        let reopened = Catalog::open(&path).await.unwrap();
        let none = reopened.list_projects(&ProjectQuery::default()).await.unwrap();
        assert!(none.is_empty(), "no Project row persisted");
        let saved = reopened.create_project(&input).await.unwrap();
        assert_eq!(reopened.project(saved.id).await.unwrap(), saved, "an unlimited writer saves");
        reopened.close().await.unwrap();
    }
}
