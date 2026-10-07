// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Project records (spec 065, amended D-W1..D-W74) on the catalog's single
//! serialized writer. Every Project write is one `BEGIN IMMEDIATE` transaction
//! that checks the expected Project revision and every record it names, writes
//! only the Project tables and adds one to the revision. A Project-only reject
//! checks only its own asset's latest decision and leaves the Project revision
//! alone, so rapid marks never chain. Candidates are derived on read over
//! `live_assets`. Nothing here reads or writes an image file or changes a
//! library record.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use platevault_model::{
    builtin_goal_templates, validate_goals, validate_project_name, validate_rigs,
    validate_subjects, AssetReference, Availability, GoalIdentity, GoalInput, GoalSpec,
    GoalTemplate, GoalTemplateInput, LibraryError, PanelInput, Project, ProjectCandidate,
    ProjectDetail, ProjectGoal, ProjectInput, ProjectQuery, ProjectRejection, ProjectState,
    ProjectSubject, ProjectSummary, ReferenceKind, RejectionMark, Revision, SubjectInput,
    SubjectPanel,
};
use sqlx::sqlite::{SqliteConnection, SqliteRow};
use sqlx::{Connection, Row};
use uuid::Uuid;

use super::{
    conflict, db_revision, fingerprint_matches, from_json, from_text, json_ids, load_asset,
    load_equipment, load_target, next_revision, now, parse_uuid, require_decidable,
    require_revision, revision, to_json, to_text, Catalog, Result, MAX_PAGE,
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
                "INSERT INTO projects (id, name, notes, state, revision, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)",
            )
            .bind(id.to_string())
            .bind(input.name.trim())
            .bind(notes(input.notes.as_deref()))
            .bind(to_text(&ProjectState::Open)?)
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

    /// Replace the subject list. A listed Target keeps its subject and a listed
    /// panel number keeps its panel; an omitted subject or panel is removed with
    /// its goals, and so is each goal its subject's new kind no longer takes.
    /// Candidates follow at once; no run membership changes.
    ///
    /// # Errors
    /// `Conflict` for a stale revision; `NotFound` for an unknown Project or an
    /// unsaved Target; `InvalidInput` for an invalid subject list.
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
    /// candidates and removing one takes them out; no run membership changes.
    ///
    /// # Errors
    /// `Conflict` for a stale revision; `NotFound` for an unknown Project or
    /// equipment; `InvalidInput` for an empty or repeated rig list.
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

    /// Replace the goal list. A goal keeps its id while its subject, panel, kind
    /// and channel (or criterion) stay.
    ///
    /// # Errors
    /// `Conflict` for a stale revision; `NotFound` for an unknown Project or a
    /// goal naming a Target that is no subject or an unknown panel;
    /// `InvalidInput` for an invalid value, a repeated goal or a panel scope the
    /// subject does not take.
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

    /// Copy a built-in or user template's values into the goals of one subject:
    /// of `panel` on a mosaic subject, or of every panel when `panel` is `None`.
    /// A copied value replaces the same goal's value and adds the others; the
    /// Project keeps no link to the template. Templates are never filtered by rig.
    ///
    /// # Errors
    /// `Conflict` for a stale revision; `NotFound` for an unknown Project,
    /// template or panel, or a Target that is no subject; `InvalidInput` for a
    /// panel on a single-Target subject.
    pub async fn apply_goal_template(
        &self,
        id: Uuid,
        expected: Revision,
        template_id: Uuid,
        target_id: Uuid,
        panel: Option<u32>,
    ) -> Result<Project> {
        let project = write_txn!(self, |conn| {
            let next = next_project_revision(conn, id, expected).await?;
            let template = load_template(conn, template_id).await?;
            let subjects = subject_rows(conn, id).await?;
            let subject = subjects.get(&target_id).ok_or_else(|| not_a_subject(id, target_id))?;
            let panels: Vec<Option<u32>> = match panel {
                None if subject.mosaic => subject.panels.keys().copied().map(Some).collect(),
                panel => vec![panel],
            };
            let mut goals = goal_inputs(conn, id).await?;
            for panel in panels {
                for goal in &template.goals {
                    let item = GoalInput { target_id, panel, goal: goal.normalized() };
                    let same = |existing: &GoalInput| {
                        existing.target_id == target_id
                            && existing.panel == panel
                            && existing.goal.identity() == goal.identity()
                    };
                    match goals.iter_mut().find(|existing| same(existing)) {
                        Some(existing) => *existing = item,
                        None => goals.push(item),
                    }
                }
            }
            validate_goals(&goals)?;
            write_goals(conn, id, &goals).await?;
            commit_revision(conn, id, next).await?;
            load_project(conn, id).await?
        });
        Ok(project)
    }

    /// Record one Project-only decision per asset, all or nothing. Each mark is
    /// checked against its own asset's latest decision and the observation the
    /// user reviewed; the Project revision, library quality, candidates and every
    /// other Project stay unchanged and nothing is rehashed.
    ///
    /// # Errors
    /// See [`write_rejections`].
    pub async fn set_project_rejection(
        &self,
        id: Uuid,
        marks: &[RejectionMark],
    ) -> Result<Vec<ProjectRejection>> {
        let decided = write_txn!(self, |conn| write_rejections(conn, id, marks).await?);
        Ok(decided)
    }

    /// # Errors
    /// `NotFound` for an unknown Project.
    pub async fn project(&self, id: Uuid) -> Result<Project> {
        let mut conn = self.reader().await?;
        load_project(&mut conn, id).await
    }

    /// Project summaries by name, optionally only those with `target_id` as a
    /// subject. No candidate or progress is computed.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn list_projects(&self, query: &ProjectQuery) -> Result<Vec<ProjectSummary>> {
        let mut conn = self.reader().await?;
        let rows = sqlx::query(
            "SELECT p.id, p.name, p.state, p.revision, \
             (SELECT count(*) FROM project_rigs r WHERE r.project_id = p.id) AS rigs, \
             (SELECT count(*) FROM project_goals g WHERE g.project_id = p.id) AS goals \
             FROM projects p WHERE ?1 IS NULL OR EXISTS (SELECT 1 FROM project_subjects s \
             WHERE s.project_id = p.id AND s.target_id = ?1) \
             ORDER BY p.name, p.id LIMIT ?2 OFFSET ?3",
        )
        .bind(query.target_id.map(|id| id.to_string()))
        .bind(i64::from(if query.limit == 0 { MAX_PAGE } else { query.limit.min(MAX_PAGE) }))
        .bind(i64::from(query.offset))
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
                state: from_text(&row.try_get::<String, _>("state")?)?,
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
    /// Project rig, with its frames outside the Trash. An OBJECT header or a
    /// suggestion confirms nothing. In subject, rig and session order.
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

    /// The Project, its candidates and the latest Project-only decision of each
    /// asset outside the Trash, from one catalog snapshot. Read-only.
    ///
    /// # Errors
    /// `NotFound` for an unknown Project.
    pub async fn project_detail(&self, id: Uuid) -> Result<ProjectDetail> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let project = load_project(&mut snapshot, id).await?;
        let candidates = candidates(&mut snapshot, id).await?;
        let rejections = latest_rejections(&mut snapshot, id).await?;
        snapshot.rollback().await?;
        Ok(ProjectDetail { project, candidates, rejections })
    }

    /// The Projects holding any of `assets` through an effective Project-only
    /// reject, each naming the asked assets it holds, at its Project revision.
    /// Candidates are derived and hold nothing.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn project_references(&self, assets: &BTreeSet<Uuid>) -> Result<Vec<AssetReference>> {
        if assets.is_empty() {
            return Ok(Vec::new());
        }
        let mut conn = self.reader().await?;
        let rows = sqlx::query(
            "SELECT p.id AS project_id, p.name, p.revision, r.asset_id FROM project_rejections r \
             JOIN projects p ON p.id = r.project_id \
             WHERE r.asset_id IN (SELECT value FROM json_each(?1)) AND r.rejected = 1 \
             AND r.revision = (SELECT max(x.revision) FROM project_rejections x \
             WHERE x.project_id = r.project_id AND x.asset_id = r.asset_id) \
             ORDER BY p.id, r.asset_id",
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

async fn require_project(conn: &mut SqliteConnection, id: Uuid) -> Result<Revision> {
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
async fn next_project_revision(
    conn: &mut SqliteConnection,
    id: Uuid,
    expected: Revision,
) -> Result<Revision> {
    let current = require_project(conn, id).await?;
    require_revision(id, current, expected)?;
    Ok(current + 1)
}

async fn commit_revision(conn: &mut SqliteConnection, id: Uuid, next: Revision) -> Result<()> {
    sqlx::query("UPDATE projects SET revision = ?2, updated_at = ?3 WHERE id = ?1")
        .bind(id.to_string())
        .bind(db_revision(next)?)
        .bind(now()?)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// A stored subject's identity, kind and panels by number.
struct SubjectRow {
    id: Uuid,
    mosaic: bool,
    panels: BTreeMap<u32, Uuid>,
}

/// The Project's subjects by Target.
async fn subject_rows(
    conn: &mut SqliteConnection,
    project: Uuid,
) -> Result<HashMap<Uuid, SubjectRow>> {
    let rows = sqlx::query(
        "SELECT s.target_id, s.id, s.mosaic, p.number, p.id AS panel_id FROM project_subjects s \
         LEFT JOIN subject_panels p ON p.subject_id = s.id WHERE s.project_id = ?1",
    )
    .bind(project.to_string())
    .fetch_all(&mut *conn)
    .await?;
    let mut subjects: HashMap<Uuid, SubjectRow> = HashMap::new();
    for row in &rows {
        let target = parse_uuid(&row.try_get::<String, _>("target_id")?)?;
        let entry = match subjects.entry(target) {
            std::collections::hash_map::Entry::Occupied(entry) => entry.into_mut(),
            std::collections::hash_map::Entry::Vacant(entry) => entry.insert(SubjectRow {
                id: parse_uuid(&row.try_get::<String, _>("id")?)?,
                mosaic: row.try_get::<i64, _>("mosaic")? == 1,
                panels: BTreeMap::new(),
            }),
        };
        if let Some(panel) = row.try_get::<Option<String>, _>("panel_id")? {
            entry.panels.insert(panel_number(row.try_get("number")?)?, parse_uuid(&panel)?);
        }
    }
    Ok(subjects)
}

fn panel_number(value: i64) -> Result<u32> {
    u32::try_from(value)
        .map_err(|_| LibraryError::PersistenceFailure(format!("corrupt panel number {value}")))
}

/// Keep each listed Target's subject and each listed panel number's panel,
/// remove the rest with their goals, then remove each goal its subject's kind no
/// longer takes.
async fn write_subjects(
    conn: &mut SqliteConnection,
    project: Uuid,
    subjects: &[SubjectInput],
) -> Result<()> {
    for subject in subjects {
        load_target(conn, subject.target_id).await?;
    }
    let stored = subject_rows(conn, project).await?;
    let listed: BTreeSet<Uuid> = subjects.iter().map(|subject| subject.target_id).collect();
    for (_, removed) in stored.iter().filter(|(target, _)| !listed.contains(target)) {
        for statement in [
            "DELETE FROM project_goals WHERE subject_id = ?1",
            "DELETE FROM subject_panels WHERE subject_id = ?1",
            "DELETE FROM project_subjects WHERE id = ?1",
        ] {
            sqlx::query(statement).bind(removed.id.to_string()).execute(&mut *conn).await?;
        }
    }
    for (position, subject) in (0_i64..).zip(subjects) {
        let kept = stored.get(&subject.target_id);
        let id = kept.map_or_else(Uuid::new_v4, |row| row.id);
        sqlx::query(
            "INSERT INTO project_subjects (id, project_id, target_id, mosaic, name, position) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT (id) DO UPDATE SET \
             mosaic = excluded.mosaic, name = excluded.name, position = excluded.position",
        )
        .bind(id.to_string())
        .bind(project.to_string())
        .bind(subject.target_id.to_string())
        .bind(i64::from(subject.mosaic))
        .bind(subject.label())
        .bind(position)
        .execute(&mut *conn)
        .await?;
        let panels = kept.map(|row| row.panels.clone()).unwrap_or_default();
        write_panels(conn, id, &panels, &subject.panels).await?;
    }
    // Integration and frame-count goals of a mosaic subject name a panel.
    sqlx::query(
        "DELETE FROM project_goals WHERE project_id = ?1 AND kind <> 'quality_bar' \
         AND panel_id IS NULL AND subject_id IN \
         (SELECT id FROM project_subjects WHERE project_id = ?1 AND mosaic = 1)",
    )
    .bind(project.to_string())
    .execute(&mut *conn)
    .await?;
    Ok(())
}

async fn write_panels(
    conn: &mut SqliteConnection,
    subject: Uuid,
    stored: &BTreeMap<u32, Uuid>,
    panels: &[PanelInput],
) -> Result<()> {
    let listed: BTreeSet<u32> = panels.iter().map(|panel| panel.number).collect();
    for (_, removed) in stored.iter().filter(|(number, _)| !listed.contains(number)) {
        for statement in [
            "DELETE FROM project_goals WHERE panel_id = ?1",
            "DELETE FROM subject_panels WHERE id = ?1",
        ] {
            sqlx::query(statement).bind(removed.to_string()).execute(&mut *conn).await?;
        }
    }
    for panel in panels {
        let id = stored.get(&panel.number).copied().unwrap_or_else(Uuid::new_v4);
        sqlx::query(
            "INSERT INTO subject_panels (id, subject_id, number, ra_deg, dec_deg, rotation_deg) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT (id) DO UPDATE SET \
             ra_deg = excluded.ra_deg, dec_deg = excluded.dec_deg, \
             rotation_deg = excluded.rotation_deg",
        )
        .bind(id.to_string())
        .bind(subject.to_string())
        .bind(i64::from(panel.number))
        .bind(panel.ra_deg)
        .bind(panel.dec_deg)
        .bind(panel.rotation_deg)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

async fn write_rigs(conn: &mut SqliteConnection, project: Uuid, rig_ids: &[Uuid]) -> Result<()> {
    for rig in rig_ids {
        load_equipment(conn, *rig).await?;
    }
    sqlx::query("DELETE FROM project_rigs WHERE project_id = ?1")
        .bind(project.to_string())
        .execute(&mut *conn)
        .await?;
    for (position, rig) in (0_i64..).zip(rig_ids) {
        sqlx::query(
            "INSERT INTO project_rigs (project_id, equipment_id, position) VALUES (?1, ?2, ?3)",
        )
        .bind(project.to_string())
        .bind(rig.to_string())
        .bind(position)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

/// A goal's stored scope and identity.
type GoalKey = (Uuid, Option<Uuid>, GoalIdentity);

/// Replace the goal list, resolving each goal's Target to its subject and its
/// panel number to the panel, and keeping the id of each goal whose key stays.
async fn write_goals(
    conn: &mut SqliteConnection,
    project: Uuid,
    goals: &[GoalInput],
) -> Result<()> {
    let subjects = subject_rows(conn, project).await?;
    let mut stored: HashMap<GoalKey, Uuid> = HashMap::new();
    for row in goal_rows(conn, project).await? {
        stored.insert(
            (row.goal.subject_id, row.goal.panel_id, row.goal.goal.identity()),
            row.goal.id,
        );
    }
    let mut resolved = Vec::with_capacity(goals.len());
    for item in goals {
        let subject =
            subjects.get(&item.target_id).ok_or_else(|| not_a_subject(project, item.target_id))?;
        let panel = match (subject.mosaic, item.panel) {
            (false, Some(number)) => {
                return Err(LibraryError::InvalidInput(format!(
                    "subject {} is not a mosaic and has no panel {number}",
                    subject.id
                )));
            }
            (true, Some(number)) => Some(*subject.panels.get(&number).ok_or_else(|| {
                LibraryError::NotFound(format!("panel {number} of subject {}", subject.id))
            })?),
            (true, None) if item.goal.counts_frames() => {
                return Err(LibraryError::InvalidInput(format!(
                    "the {} goal of mosaic subject {} names its panel",
                    item.goal.kind_name(),
                    subject.id
                )));
            }
            (_, None) => None,
        };
        let goal = item.goal.normalized();
        let key = (subject.id, panel, goal.identity());
        let id = stored.get(&key).copied().unwrap_or_else(Uuid::new_v4);
        resolved.push(ProjectGoal { id, subject_id: subject.id, panel_id: panel, goal });
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
            "INSERT INTO project_goals (id, project_id, subject_id, panel_id, kind, channel, \
             goal_seconds, goal_frames, criterion, position) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        )
        .bind(goal.id.to_string())
        .bind(project.to_string())
        .bind(goal.subject_id.to_string())
        .bind(goal.panel_id.map(|id| id.to_string()))
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

/// Record one Project-only decision per mark inside the caller's transaction,
/// all or nothing; the Project revision is not touched. A run's Review step
/// calls this in the same transaction that removes the frame from its draft.
///
/// # Errors
/// `InvalidInput` for empty or repeated marks, a Trashed frame or a copy of a
/// retired location; `NotFound` for an unknown Project or asset; `Conflict`
/// naming the asset at its current decision revision when the mark's expected
/// revision is stale or its bytes changed since review.
pub async fn write_rejections(
    conn: &mut SqliteConnection,
    project: Uuid,
    marks: &[RejectionMark],
) -> Result<Vec<ProjectRejection>> {
    let mut seen = BTreeSet::new();
    if marks.is_empty() || !marks.iter().all(|mark| seen.insert(mark.asset_id)) {
        return Err(LibraryError::InvalidInput(
            "rejection marks must be unique and non-empty".into(),
        ));
    }
    require_project(conn, project).await?;
    let decided_at = now()?;
    let mut decided = Vec::with_capacity(marks.len());
    for mark in marks {
        let asset = load_asset(conn, mark.asset_id).await?;
        if asset.availability == Availability::Trashed {
            return Err(LibraryError::InvalidInput(format!(
                "asset {} is in the Trash and takes no Project decision",
                asset.id
            )));
        }
        require_decidable(&asset)?;
        let current: Option<i64> = sqlx::query_scalar(
            "SELECT max(revision) FROM project_rejections WHERE project_id = ?1 AND asset_id = ?2",
        )
        .bind(project.to_string())
        .bind(asset.id.to_string())
        .fetch_one(&mut *conn)
        .await?;
        let current = current.map(revision).transpose()?.unwrap_or(0);
        require_revision(asset.id, current, mark.expected_revision)?;
        if !fingerprint_matches(&asset.fingerprint, &mark.fingerprint) {
            return Err(conflict(asset.id, current));
        }
        let next = current + 1;
        sqlx::query(
            "INSERT INTO project_rejections (project_id, asset_id, revision, rejected, fingerprint, \
             decided_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .bind(project.to_string())
        .bind(asset.id.to_string())
        .bind(db_revision(next)?)
        .bind(i64::from(mark.rejected))
        .bind(to_json(&asset.fingerprint)?)
        .bind(&decided_at)
        .execute(&mut *conn)
        .await?;
        decided.push(ProjectRejection {
            asset_id: asset.id,
            revision: next,
            rejected: mark.rejected,
            fingerprint: asset.fingerprint,
            decided_at: decided_at.clone(),
        });
    }
    Ok(decided)
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

async fn load_project(conn: &mut SqliteConnection, id: Uuid) -> Result<Project> {
    let row = sqlx::query(
        "SELECT name, notes, state, done_at, revision, created_at, updated_at FROM projects \
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
        state: from_text(&row.try_get::<String, _>("state")?)?,
        done_at: row.try_get("done_at")?,
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
        "SELECT s.id, s.target_id, t.designation, s.name, s.mosaic FROM project_subjects s \
         JOIN targets t ON t.id = s.target_id WHERE s.project_id = ?1 ORDER BY s.position",
    )
    .bind(project.to_string())
    .fetch_all(&mut *conn)
    .await?;
    let mut subjects = Vec::with_capacity(rows.len());
    for row in &rows {
        let id = parse_uuid(&row.try_get::<String, _>("id")?)?;
        let panels = sqlx::query(
            "SELECT id, number, ra_deg, dec_deg, rotation_deg FROM subject_panels \
             WHERE subject_id = ?1 ORDER BY number",
        )
        .bind(id.to_string())
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
        .collect::<Result<Vec<_>>>()?;
        subjects.push(ProjectSubject {
            id,
            target_id: parse_uuid(&row.try_get::<String, _>("target_id")?)?,
            designation: row.try_get("designation")?,
            name: row.try_get("name")?,
            mosaic: row.try_get::<i64, _>("mosaic")? == 1,
            panels,
        });
    }
    Ok(subjects)
}

/// A stored goal with the Target and panel number that name it in inputs.
struct GoalRow {
    goal: ProjectGoal,
    target_id: Uuid,
    panel: Option<u32>,
}

async fn goal_rows(conn: &mut SqliteConnection, project: Uuid) -> Result<Vec<GoalRow>> {
    let rows = sqlx::query(
        "SELECT g.id, g.subject_id, g.panel_id, g.kind, g.channel, g.goal_seconds, \
         g.goal_frames, g.criterion, s.target_id, p.number FROM project_goals g \
         JOIN project_subjects s ON s.id = g.subject_id \
         LEFT JOIN subject_panels p ON p.id = g.panel_id \
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
                    )))
                }
            };
            let panel_id: Option<String> = row.try_get("panel_id")?;
            let number: Option<i64> = row.try_get("number")?;
            Ok(GoalRow {
                goal: ProjectGoal {
                    id: parse_uuid(&row.try_get::<String, _>("id")?)?,
                    subject_id: parse_uuid(&row.try_get::<String, _>("subject_id")?)?,
                    panel_id: panel_id.as_deref().map(parse_uuid).transpose()?,
                    goal,
                },
                target_id: parse_uuid(&row.try_get::<String, _>("target_id")?)?,
                panel: number.map(panel_number).transpose()?,
            })
        })
        .collect()
}

/// The stored goals as inputs, in order.
async fn goal_inputs(conn: &mut SqliteConnection, project: Uuid) -> Result<Vec<GoalInput>> {
    Ok(goal_rows(conn, project)
        .await?
        .into_iter()
        .map(|row| GoalInput { target_id: row.target_id, panel: row.panel, goal: row.goal.goal })
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

/// The latest Project-only decision of each asset outside the Trash, by asset.
async fn latest_rejections(
    conn: &mut SqliteConnection,
    project: Uuid,
) -> Result<Vec<ProjectRejection>> {
    let rows = sqlx::query(
        "SELECT r.asset_id, r.revision, r.rejected, r.fingerprint, r.decided_at \
         FROM project_rejections r JOIN live_assets a ON a.id = r.asset_id \
         WHERE r.project_id = ?1 AND r.revision = (SELECT max(x.revision) \
         FROM project_rejections x WHERE x.project_id = r.project_id AND x.asset_id = r.asset_id) \
         ORDER BY r.asset_id",
    )
    .bind(project.to_string())
    .fetch_all(&mut *conn)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(ProjectRejection {
                asset_id: parse_uuid(&row.try_get::<String, _>("asset_id")?)?,
                revision: revision(row.try_get("revision")?)?,
                rejected: row.try_get::<i64, _>("rejected")? == 1,
                fingerprint: from_json(&row.try_get::<String, _>("fingerprint")?)?,
                decided_at: row.try_get("decided_at")?,
            })
        })
        .collect()
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
        let subject = SubjectInput {
            target_id: target.candidate.id,
            name: None,
            mosaic: false,
            panels: Vec::new(),
        };
        let input = ProjectInput {
            name: "NGC 7000 HOO".into(),
            notes: Some("x".repeat(400_000)),
            subjects: vec![subject],
            rig_ids: vec![rig.id],
            goals: Vec::new(),
        };
        catalog.limit_writer_pages_for_test().await.unwrap();
        let error = catalog.create_project(&input).await.unwrap_err();
        assert_eq!(error.response(None, None).kind, "persistence_failure");
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
