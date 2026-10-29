// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The Sessions filters "Needs a Target", "Not in any Project" and "Needs
//! calibration", their counts, and a session row's Create Project and Add to
//! Project (LIB-FR-17, PRJ-FR-08, PRJ-FR-19, D-W59). The filters are derived
//! on read from current associations, the sessions Projects hold
//! (`project_sessions`) and session calibration. A Target associated by
//! agreeing evidence counts as confirmed here as in readiness (D-W124,
//! [`counts_as_confirmed`]). Both row actions hold the session through the
//! membership add ([`project_inputs::add_members`]), which admits it and
//! appends its Target and rig ([`append_target_and_rig`]): only a session
//! whose calibration is settled joins, and a refusal writes nothing.

use std::collections::HashSet;

use platevault_model::{
    counts_as_confirmed, AddedRig, AssociationState, EvidenceItem, ExpectedSession, LibraryError,
    Project, ProjectAdded, ProjectAddition, ProjectInput, Revision, Session, SessionFilterCounts,
    SubjectInput,
};
use sqlx::sqlite::SqliteConnection;
use sqlx::{Connection, Row};
use uuid::Uuid;

use super::project_inputs::{self, NewGroup, SessionAdd};
use super::projects::{commit_revision, insert_project, load_project, require_project};
use super::{
    calibration, check_expected_sessions, from_json, from_text, lineage_successors,
    listed_sessions, load_equipment, load_session_row, load_target, parse_uuid, Catalog, Members,
    Result, SessionFilter,
};

/// Every session's Target row naming a Target; [`counts_as_confirmed`]
/// decides which count as confirmed.
const TARGET_ROWS: &str = "SELECT session_id, state, evidence FROM associations \
     WHERE kind = 'target' AND target_id IS NOT NULL";

/// Sessions a Project holds (PRJ-FR-19): a session is in no Project until
/// one adds it, whatever its lifecycle; matching a Project's subjects and
/// rigs only makes it a suggestion.
const IN_A_PROJECT: &str = "SELECT DISTINCT session_id FROM project_sessions";

impl Catalog {
    /// The lengths of the "Needs a Target", "Not in any Project" and "Needs
    /// calibration" lists over the default Sessions scope, from one catalog
    /// snapshot. Read-only.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn session_filter_counts(&self) -> Result<SessionFilterCounts> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let listed = listed_sessions(&mut snapshot, false, None, Members::Live).await?;
        let queue = calibration::calibration_queue(&mut snapshot, &listed).await?;
        let needs_calibration = u64::try_from(queue.len()).unwrap_or(u64::MAX);
        let counts = filter_counts(&mut snapshot, &listed, needs_calibration).await?;
        snapshot.rollback().await?;
        Ok(counts)
    }

    /// Create Project's prefill from a session: named after its confirmed
    /// Target, which is the one subject, with its confirmed rig when it has
    /// one. Nothing is saved.
    ///
    /// # Errors
    /// `NotFound` for an unknown session; `Conflict` for a superseded one;
    /// `InvalidInput` when it has no confirmed Target.
    pub async fn project_prefill(&self, session_id: Uuid) -> Result<ProjectInput> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let basis = SessionBasis::read(&mut snapshot, session_id).await?;
        let target = load_target(&mut snapshot, basis.target_id).await?;
        snapshot.rollback().await?;
        Ok(ProjectInput {
            name: target.candidate.designation,
            notes: None,
            subjects: vec![SubjectInput { target_id: basis.target_id, name: None }],
            rig_ids: basis.rig_id.into_iter().collect(),
            goals: Vec::new(),
        })
    }

    /// What Add to Project would add to `project_id` for the session, with the
    /// note naming a rig it adds (D-W59). Nothing is saved.
    ///
    /// # Errors
    /// `NotFound` for an unknown session or Project; `Conflict` for a
    /// superseded session; `InvalidInput` when it has no confirmed Target.
    pub async fn preview_project_addition(
        &self,
        session_id: Uuid,
        project_id: Uuid,
    ) -> Result<ProjectAddition> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let basis = SessionBasis::read(&mut snapshot, session_id).await?;
        let addition = addition(&mut snapshot, &basis, project_id).await?;
        snapshot.rollback().await?;
        Ok(addition)
    }

    /// Add to Project from a session row (PRJ-FR-08, PRJ-FR-19): the session
    /// joins whole through the membership add, which admits it and adds its
    /// confirmed Target as the Project's last subject unless it is one and
    /// its confirmed rig as the last rig when the Project lacks it, all in
    /// one Project revision. `groups` and `adds` are core's placement of this
    /// one session. It commits only on `expected` and `expected_revision`, as
    /// previewed, and returns what it added.
    ///
    /// # Errors
    /// `Conflict` for a stale Project revision or a session whose grouping or
    /// decisions changed since `expected`; `NotFound` for an unknown session,
    /// Project or group; `InvalidInput` when the session has no confirmed
    /// Target, for an add of any other session, and as
    /// [`Catalog::add_project_sessions`] for every admission blocker.
    pub async fn add_session_to_project(
        &self,
        expected: &ExpectedSession,
        project_id: Uuid,
        expected_revision: Revision,
        groups: &[NewGroup],
        adds: &[SessionAdd],
    ) -> Result<ProjectAdded> {
        require_only(expected, adds)?;
        let added = write_txn!(self, |conn| {
            let next = project_inputs::begin_edit(conn, project_id, expected_revision).await?;
            check_expected_sessions(conn, std::slice::from_ref(expected)).await?;
            let basis = SessionBasis::read(conn, expected.session_id).await?;
            let addition = addition(conn, &basis, project_id).await?;
            project_inputs::add_members(conn, project_id, groups, adds).await?;
            commit_revision(conn, project_id, next).await?;
            ProjectAdded { project: load_project(conn, project_id).await?, addition }
        });
        Ok(added)
    }

    /// Create Project from a session row (LIB-FR-17, PRJ-FR-01): a new open
    /// Project from `input`, prefilled by [`Catalog::project_prefill`],
    /// holding the session whole through the membership add, all at its
    /// first revision. Like Add to Project it holds only a session admission
    /// lets join; otherwise no Project is saved. `groups` and `adds` are
    /// core's placement of this one session in a Project with no groups.
    ///
    /// # Errors
    /// As [`Catalog::create_project`], and as
    /// [`Catalog::add_session_to_project`] for the session.
    pub async fn create_project_with_session(
        &self,
        input: &ProjectInput,
        expected: &ExpectedSession,
        groups: &[NewGroup],
        adds: &[SessionAdd],
    ) -> Result<Project> {
        require_only(expected, adds)?;
        let project = write_txn!(self, |conn| {
            check_expected_sessions(conn, std::slice::from_ref(expected)).await?;
            let id = insert_project(conn, input).await?;
            project_inputs::add_members(conn, id, groups, adds).await?;
            load_project(conn, id).await?
        });
        Ok(project)
    }
}

/// A session row adds its one session, the one it was read for.
fn require_only(expected: &ExpectedSession, adds: &[SessionAdd]) -> Result<()> {
    match adds {
        [add] if add.session_id == expected.session_id => Ok(()),
        _ => Err(LibraryError::InvalidInput(format!(
            "a session row adds only its session {}",
            expected.session_id
        ))),
    }
}

/// Keep the sessions of `listed` that `filter` lists, in order. No filter and
/// "Trashed" keep every one: the Trashed scope is chosen by the listing.
pub async fn retain(
    conn: &mut SqliteConnection,
    filter: Option<SessionFilter>,
    mut listed: Vec<Uuid>,
) -> Result<Vec<Uuid>> {
    let filter = match filter {
        Some(SessionFilter::NeedsCalibration) => {
            let mut queue = Vec::with_capacity(listed.len());
            for id in listed {
                if !calibration::session_needs(conn, id).await?.is_empty() {
                    queue.push(id);
                }
            }
            return Ok(queue);
        }
        Some(filter @ (SessionFilter::NeedsTarget | SessionFilter::NotInAnyProject)) => filter,
        Some(SessionFilter::Trashed) | None => return Ok(listed),
    };
    let standing = Standing::read(conn).await?;
    listed.retain(|id| standing.holds(filter, *id));
    Ok(listed)
}

/// The Sessions filters' counts over `listed`, the default Sessions scope,
/// given how many of them need calibration.
pub async fn filter_counts(
    conn: &mut SqliteConnection,
    listed: &[Uuid],
    needs_calibration: u64,
) -> Result<SessionFilterCounts> {
    let standing = Standing::read(conn).await?;
    let count = |filter| listed.iter().filter(|id| standing.holds(filter, **id)).count() as u64;
    Ok(SessionFilterCounts {
        needs_target: count(SessionFilter::NeedsTarget),
        not_in_any_project: count(SessionFilter::NotInAnyProject),
        needs_calibration,
    })
}

/// Which sessions have a confirmed Target and which are in a Project.
struct Standing {
    confirmed: HashSet<Uuid>,
    in_project: HashSet<Uuid>,
}

impl Standing {
    async fn read(conn: &mut SqliteConnection) -> Result<Self> {
        Ok(Self {
            confirmed: confirmed_targets(conn).await?,
            in_project: session_ids(conn, IN_A_PROJECT).await?,
        })
    }

    fn holds(&self, filter: SessionFilter, id: Uuid) -> bool {
        match filter {
            SessionFilter::NeedsTarget => !self.confirmed.contains(&id),
            SessionFilter::NotInAnyProject => {
                self.confirmed.contains(&id) && !self.in_project.contains(&id)
            }
            SessionFilter::Trashed | SessionFilter::NeedsCalibration => true,
        }
    }
}

async fn session_ids(conn: &mut SqliteConnection, sql: &'static str) -> Result<HashSet<Uuid>> {
    let ids: Vec<String> = sqlx::query_scalar(sql).fetch_all(&mut *conn).await?;
    ids.iter().map(|id| parse_uuid(id)).collect()
}

/// Sessions whose Target counts as confirmed: confirmed by the user or
/// associated by agreeing evidence (D-W124).
async fn confirmed_targets(conn: &mut SqliteConnection) -> Result<HashSet<Uuid>> {
    let rows = sqlx::query(TARGET_ROWS).fetch_all(&mut *conn).await?;
    let mut confirmed = HashSet::new();
    for row in &rows {
        let state: AssociationState = from_text(&row.try_get::<String, _>("state")?)?;
        let evidence: Vec<EvidenceItem> = from_json(&row.try_get::<String, _>("evidence")?)?;
        if counts_as_confirmed(&state, &evidence) {
            confirmed.insert(parse_uuid(&row.try_get::<String, _>("session_id")?)?);
        }
    }
    Ok(confirmed)
}

/// A current session with its confirmed Target, which may be one associated
/// by agreeing evidence (D-W124), and its confirmed rig.
struct SessionBasis {
    session: Session,
    target_id: Uuid,
    rig_id: Option<Uuid>,
}

impl SessionBasis {
    async fn read(conn: &mut SqliteConnection, session_id: Uuid) -> Result<Self> {
        let row = load_session_row(conn, session_id).await?;
        if let Some(lineage) = row.superseded_by {
            return Err(LibraryError::Conflict {
                id: session_id,
                current: row.session.grouping_revision,
                successors: lineage_successors(conn, lineage).await?,
            });
        }
        let rows = sqlx::query(
            "SELECT kind, state, evidence, target_id, equipment_id FROM associations \
             WHERE session_id = ?1",
        )
        .bind(session_id.to_string())
        .fetch_all(&mut *conn)
        .await?;
        let (mut target_id, mut rig_id) = (None, None);
        for row in &rows {
            let state: AssociationState = from_text(&row.try_get::<String, _>("state")?)?;
            match row.try_get::<&str, _>("kind")? {
                "target" => {
                    let evidence: Vec<EvidenceItem> =
                        from_json(&row.try_get::<String, _>("evidence")?)?;
                    if counts_as_confirmed(&state, &evidence) {
                        target_id = row.try_get::<Option<String>, _>("target_id")?;
                    }
                }
                _ if state == AssociationState::Confirmed => {
                    rig_id = row.try_get::<Option<String>, _>("equipment_id")?;
                }
                _ => {}
            }
        }
        let target_id = target_id.ok_or_else(|| {
            LibraryError::InvalidInput(format!("session {session_id} has no confirmed Target"))
        })?;
        Ok(Self {
            session: row.session,
            target_id: parse_uuid(&target_id)?,
            rig_id: rig_id.as_deref().map(parse_uuid).transpose()?,
        })
    }

    const fn expected(&self) -> ExpectedSession {
        ExpectedSession {
            session_id: self.session.id,
            grouping_revision: self.session.grouping_revision,
            decision_revision: self.session.decision_revision,
        }
    }
}

/// What the session adds to the Project as it stands on `conn`.
async fn addition(
    conn: &mut SqliteConnection,
    basis: &SessionBasis,
    project_id: Uuid,
) -> Result<ProjectAddition> {
    let revision = require_project(conn, project_id).await?;
    let project = project_id.to_string();
    let is_subject: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM project_subjects WHERE project_id = ?1 AND target_id = ?2)",
    )
    .bind(&project)
    .bind(basis.target_id.to_string())
    .fetch_one(&mut *conn)
    .await?;
    let mut added_rig = None;
    if let Some(rig) = basis.rig_id {
        let on_project: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM project_rigs WHERE project_id = ?1 AND equipment_id = ?2)",
        )
        .bind(&project)
        .bind(rig.to_string())
        .fetch_one(&mut *conn)
        .await?;
        if !on_project {
            added_rig = Some(AddedRig { id: rig, name: load_equipment(conn, rig).await?.name });
        }
    }
    Ok(ProjectAddition::new(
        project_id,
        revision,
        basis.expected(),
        basis.target_id,
        !is_subject,
        added_rig,
    ))
}

/// Inside a membership add (PRJ-FR-02, PRJ-FR-19): the session's confirmed
/// Target becomes the Project's last subject unless it is one, and its
/// confirmed rig the last rig when the Project lacks it. The caller commits
/// the Project revision.
pub async fn append_target_and_rig(
    conn: &mut SqliteConnection,
    project_id: Uuid,
    session_id: Uuid,
) -> Result<ProjectAddition> {
    let basis = SessionBasis::read(conn, session_id).await?;
    let addition = addition(conn, &basis, project_id).await?;
    append(conn, &addition).await?;
    Ok(addition)
}

/// Append the subject and rig the addition names.
async fn append(conn: &mut SqliteConnection, addition: &ProjectAddition) -> Result<()> {
    let project = addition.project_id.to_string();
    if addition.adds_subject {
        sqlx::query(
            "INSERT INTO project_subjects (id, project_id, target_id, name, position) \
             VALUES (?1, ?2, ?3, NULL, (SELECT coalesce(max(position) + 1, 0) \
             FROM project_subjects WHERE project_id = ?2))",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&project)
        .bind(addition.target_id.to_string())
        .execute(&mut *conn)
        .await?;
        super::projects::restore_hidden_goals(conn, addition.project_id, addition.target_id)
            .await?;
    }
    if let Some(rig) = &addition.added_rig {
        sqlx::query(
            "INSERT INTO project_rigs (project_id, equipment_id, position) VALUES (?1, ?2, \
             (SELECT coalesce(max(position) + 1, 0) FROM project_rigs WHERE project_id = ?1))",
        )
        .bind(&project)
        .bind(rig.id.to_string())
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}
