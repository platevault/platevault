// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! A Project's inputs on the catalog's single writer (spec 065 PRJ-FR-02,
//! PRJ-FR-05, PRJ-FR-08/09, PRJ-FR-27 to PRJ-FR-31; 066 VSEL-FR-10, VSEL-FR-12,
//! VSEL-FR-15/16; D-W94 to D-W96, D-W100, D-W105, D-W107, D-W109). Pairs with
//! `project_inputs.sql`.
//!
//! Every edit is one `BEGIN IMMEDIATE` transaction that checks the Project is
//! open and at the expected revision, writes only Project rows and adds one
//! to the revision. Nothing here touches the View: once it exists, an edit
//! reads as a pending change, computed on read from the desired state and
//! the live Library against the installed manifest's basis, never stored.
//!
//! A session joins only through [`Catalog::add_project_sessions`], whole,
//! after [`admission::require_admission`] in the same transaction: Ready,
//! settled and not drifted, on the group's rig, at the basis the user saw.
//! Its exact logical captures and copies are recorded as they stand, so an
//! availability change or a new matching session never changes what the
//! Project holds: there is no rekey and no implicit add. The one Library
//! write here is a regroup's: an open Project holding a session the regroup
//! replaced holds the successors that took its frames instead, with exactly
//! those frames and choices ([`carry_regrouped`], D-W100), and reads that as
//! the Library's pending change. Which group a new session joins and what a
//! new group is called is core's rule; this module records the groups and
//! placements it is given.

use std::collections::{BTreeMap, BTreeSet};

use platevault_model::{
    counts_as_confirmed, logical_quality, AdmissionBasis, ApplicableQuality, Asset,
    AssociationState, Availability, BasisCapture, BasisGroup, BasisSession, CaptureInclusion,
    CopyBasis, EvidenceItem, ExclusionBasis, FrameChoice, FramingEvidence, GroupKeywords,
    GroupName, GroupOrigin, InclusionBasis, LibraryError, NativePath, OpticsSignature,
    PendingChange, ProjectBasis, ProjectCandidate, ProjectCapture, ProjectDesired, ProjectGroup,
    ProjectLifecycle, ProjectSessionMember, ProjectSuggestion, ProjectViewSettings, Revision,
    SessionAdmission, SessionIntake, SessionLineage, SessionPlacement, SessionReadiness, ViewMode,
};

use sqlx::sqlite::SqliteConnection;
use sqlx::{Connection, Row};
use uuid::Uuid;

use super::projects::{candidates, commit_revision, next_project_revision, require_project};
use super::workflow_settings::read_workflow_settings;
use super::{
    admission, from_json, from_text, load_assets, load_session_row, now, parse_uuid, revision,
    scoped_members, session_filters, to_json, to_text, CaptureView, Catalog, Members, Result,
};

/// A group an edit creates: a framing group for added sessions, or the
/// user's new or split group. It goes after the Project's last group.
#[derive(Clone, Debug, PartialEq)]
pub struct NewGroup {
    pub id: Uuid,
    pub rig_id: Uuid,
    pub name: GroupName,
    pub origin: GroupOrigin,
    pub optics: OpticsSignature,
    pub framing: Option<FramingEvidence>,
}

/// One whole session to add to `group_id`, at the admission basis the user
/// saw (`None` takes the current one).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionAdd {
    pub session_id: Uuid,
    pub group_id: Uuid,
    pub placement: SessionPlacement,
    pub expected: Option<AdmissionBasis>,
}

impl Catalog {
    /// What Project `id` holds as its intent, read in one snapshot.
    ///
    /// # Errors
    /// `NotFound` for an unknown Project; `PersistenceFailure` for a corrupt
    /// record.
    pub async fn project_desired(&self, id: Uuid) -> Result<ProjectDesired> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let desired = read_desired(&mut snapshot, id).await?;
        snapshot.rollback().await?;
        Ok(desired)
    }

    /// Add whole sessions to Project `id` in one transaction, all or none
    /// (PRJ-FR-08). Each session must pass the admission rule now, at its
    /// `expected` basis, into its group on its own rig; `groups` are the new
    /// framing groups the adds go into, and each gets a session. Each
    /// session's live logical captures are recorded with every copy's
    /// decision revision and observation: Usable ones included, the others
    /// visibly excluded until the user includes them (VSEL-FR-15). A session
    /// whose Target or rig the Project lacks adds them too (PRJ-FR-02).
    ///
    /// # Errors
    /// `Conflict` for a stale Project revision, a superseded session (with
    /// its successors) or a basis other than `expected`; `NotFound` for an
    /// unknown Project, group or session; `InvalidInput` for a Project that
    /// isn't open, a session listed twice or already held, a capture or copy
    /// another held session holds, a group no add uses or a name another
    /// group has, and every admission blocker.
    pub async fn add_project_sessions(
        &self,
        id: Uuid,
        expected: Revision,
        groups: &[NewGroup],
        adds: &[SessionAdd],
    ) -> Result<ProjectDesired> {
        let desired = write_txn!(self, |conn| {
            let next = begin_edit(conn, id, expected).await?;
            add_members(conn, id, groups, adds).await?;
            commit_revision(conn, id, next).await?;
            read_desired(conn, id).await?
        });
        Ok(desired)
    }

    /// Remove whole sessions from Project `id` with their captures. A
    /// framing group left empty goes with them, unless it carries goals.
    /// Subjects and rigs stay (PRJ-FR-02).
    ///
    /// # Errors
    /// `Conflict` for a stale revision; `NotFound` for an unknown Project or a
    /// session it doesn't hold; `InvalidInput` for a Project that isn't open.
    pub async fn remove_project_sessions(
        &self,
        id: Uuid,
        expected: Revision,
        sessions: &[Uuid],
    ) -> Result<ProjectDesired> {
        require_distinct(sessions.iter().copied(), "session")?;
        let desired = write_txn!(self, |conn| {
            let next = begin_edit(conn, id, expected).await?;
            for session in sessions {
                require_held(conn, id, *session).await?;
                delete_member(conn, id, *session).await?;
            }
            drop_empty_framing_groups(conn, id).await?;
            commit_revision(conn, id, next).await?;
            read_desired(conn, id).await?
        });
        Ok(desired)
    }

    /// Move held sessions into `group_id` of their own rig; the user's move
    /// survives recomputation (PRJ-FR-27, PRJ-FR-31). A framing group left
    /// empty goes, unless it carries goals.
    ///
    /// # Errors
    /// `Conflict` for a stale revision; `NotFound` for an unknown Project,
    /// group or held session; `InvalidInput` for a Project that isn't open or
    /// a group of another rig.
    pub async fn move_project_sessions(
        &self,
        id: Uuid,
        expected: Revision,
        sessions: &[Uuid],
        group_id: Uuid,
    ) -> Result<ProjectDesired> {
        require_distinct(sessions.iter().copied(), "session")?;
        let desired = write_txn!(self, |conn| {
            let next = begin_edit(conn, id, expected).await?;
            move_sessions(conn, id, sessions, group_id).await?;
            drop_empty_framing_groups(conn, id).await?;
            commit_revision(conn, id, next).await?;
            read_desired(conn, id).await?
        });
        Ok(desired)
    }

    /// Create a group (PRJ-FR-27) and move `sessions` into it: with sessions
    /// of one group this is a split. The user names it when it is created.
    ///
    /// # Errors
    /// As [`Catalog::move_project_sessions`], and `InvalidInput` for a name
    /// another group of the Project has.
    pub async fn create_project_group(
        &self,
        id: Uuid,
        expected: Revision,
        group: &NewGroup,
        sessions: &[Uuid],
    ) -> Result<ProjectDesired> {
        require_distinct(sessions.iter().copied(), "session")?;
        let desired = write_txn!(self, |conn| {
            let next = begin_edit(conn, id, expected).await?;
            insert_group(conn, id, group).await?;
            move_sessions(conn, id, sessions, group.id).await?;
            drop_empty_framing_groups(conn, id).await?;
            commit_revision(conn, id, next).await?;
            read_desired(conn, id).await?
        });
        Ok(desired)
    }

    /// Remove an empty group.
    ///
    /// # Errors
    /// `Conflict` for a stale revision; `NotFound` for an unknown Project or
    /// group; `InvalidInput` for a Project that isn't open, or a group that
    /// still holds sessions or goals.
    pub async fn remove_project_group(
        &self,
        id: Uuid,
        expected: Revision,
        group_id: Uuid,
    ) -> Result<ProjectDesired> {
        let desired = write_txn!(self, |conn| {
            let next = begin_edit(conn, id, expected).await?;
            require_group(conn, id, group_id).await?;
            let (sessions, goals): (i64, i64) = sqlx::query_as(
                "SELECT (SELECT count(*) FROM project_sessions WHERE group_id = ?1), \
                 (SELECT count(*) FROM project_goals WHERE group_id = ?1)",
            )
            .bind(group_id.to_string())
            .fetch_one(&mut *conn)
            .await?;
            if sessions > 0 {
                return Err(LibraryError::InvalidInput(format!(
                    "group {group_id} still holds {sessions} sessions; move or remove them first"
                )));
            }
            if goals > 0 {
                return Err(LibraryError::InvalidInput(format!(
                    "group {group_id} still has goals; remove them first"
                )));
            }
            sqlx::query("DELETE FROM project_groups WHERE id = ?1")
                .bind(group_id.to_string())
                .execute(&mut *conn)
                .await?;
            commit_revision(conn, id, next).await?;
            read_desired(conn, id).await?
        });
        Ok(desired)
    }

    /// Rename a group; its folder changes on the next Apply (PRJ-FR-27).
    ///
    /// # Errors
    /// `Conflict` for a stale revision; `NotFound` for an unknown Project or
    /// group; `InvalidInput` for a Project that isn't open or a name another
    /// group has.
    pub async fn rename_project_group(
        &self,
        id: Uuid,
        expected: Revision,
        group_id: Uuid,
        name: &GroupName,
    ) -> Result<ProjectDesired> {
        let desired = write_txn!(self, |conn| {
            let next = begin_edit(conn, id, expected).await?;
            require_group(conn, id, group_id).await?;
            rename(conn, id, group_id, name).await?;
            commit_revision(conn, id, next).await?;
            read_desired(conn, id).await?
        });
        Ok(desired)
    }

    /// Mark a group a mosaic panel, or not, optionally renaming it in the
    /// same edit (PRJ-FR-29): a panel group carries only the PANEL token and
    /// its own goals.
    ///
    /// # Errors
    /// As [`Catalog::rename_project_group`], and `InvalidInput` for unmarking
    /// a panel group that has goals.
    pub async fn set_project_group_panel(
        &self,
        id: Uuid,
        expected: Revision,
        group_id: Uuid,
        panel: bool,
        name: Option<&GroupName>,
    ) -> Result<ProjectDesired> {
        let desired = write_txn!(self, |conn| {
            let next = begin_edit(conn, id, expected).await?;
            require_group(conn, id, group_id).await?;
            if !panel && has_goals(conn, group_id).await? {
                return Err(LibraryError::InvalidInput(format!(
                    "group {group_id} has panel goals and stays a panel; remove them first"
                )));
            }
            sqlx::query("UPDATE project_groups SET panel = ?2 WHERE id = ?1")
                .bind(group_id.to_string())
                .bind(i64::from(panel))
                .execute(&mut *conn)
                .await?;
            if let Some(name) = name {
                rename(conn, id, group_id, name).await?;
            }
            commit_revision(conn, id, next).await?;
            read_desired(conn, id).await?
        });
        Ok(desired)
    }

    /// The user's choice for held frames (VSEL-FR-10, VSEL-FR-15): exclude
    /// them from this Project, include them although the Library has them
    /// Unusable, or follow the Library again. Files and library quality stay.
    ///
    /// # Errors
    /// `Conflict` for a stale revision; `NotFound` for an unknown Project or
    /// a capture it doesn't hold; `InvalidInput` for a Project that isn't
    /// open or no capture.
    pub async fn set_project_frames(
        &self,
        id: Uuid,
        expected: Revision,
        capture_keys: &[Uuid],
        choice: FrameChoice,
    ) -> Result<ProjectDesired> {
        if capture_keys.is_empty() {
            return Err(LibraryError::InvalidInput("no frame chosen".into()));
        }
        require_distinct(capture_keys.iter().copied(), "capture")?;
        let desired = write_txn!(self, |conn| {
            let next = begin_edit(conn, id, expected).await?;
            let held = read_captures(conn, id).await?;
            let live = live_copies(conn, held.values().flatten()).await?;
            for key in capture_keys {
                let capture = held
                    .values()
                    .flatten()
                    .find(|capture| capture.capture_key == *key)
                    .ok_or_else(|| {
                    LibraryError::NotFound(format!("capture {key} of project {id}"))
                })?;
                let quality =
                    live_quality(&live_of(capture, &live)).unwrap_or(ApplicableQuality::Unreviewed);
                write_inclusion(conn, id, *key, CaptureInclusion::chosen(choice, quality)).await?;
            }
            commit_revision(conn, id, next).await?;
            read_desired(conn, id).await?
        });
        Ok(desired)
    }

    /// The View step's settings (VSEL-FR-16, PREP-FR-04/06, PRJ-FR-28): input
    /// mode, this Project's keyword names (`None` uses Settings), the
    /// application and the processing location. A mode switch reaches the
    /// View only through Apply.
    ///
    /// # Errors
    /// `Conflict` for a stale revision; `NotFound` for an unknown Project or
    /// application profile; `InvalidInput` for a Project that isn't open.
    pub async fn set_project_view_settings(
        &self,
        id: Uuid,
        expected: Revision,
        settings: &ProjectViewSettings,
    ) -> Result<ProjectDesired> {
        let desired = write_txn!(self, |conn| {
            let next = begin_edit(conn, id, expected).await?;
            if let Some(profile) = settings.profile_id {
                let known: bool =
                    sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM profiles WHERE id = ?1)")
                        .bind(profile.to_string())
                        .fetch_one(&mut *conn)
                        .await?;
                if !known {
                    return Err(LibraryError::NotFound(format!("application profile {profile}")));
                }
            }
            let keywords = settings.keywords.as_ref();
            sqlx::query(
                "UPDATE projects SET view_mode = ?2, group_keyword = ?3, panel_keyword = ?4, \
                 profile_id = ?5, processing_parent = ?6 WHERE id = ?1",
            )
            .bind(id.to_string())
            .bind(to_text(&settings.mode)?)
            .bind(keywords.map(|keywords| keywords.group().as_str().to_owned()))
            .bind(keywords.map(|keywords| keywords.panel().as_str().to_owned()))
            .bind(settings.profile_id.map(|profile| profile.to_string()))
            .bind(settings.parent.as_ref().map(to_json).transpose()?)
            .execute(&mut *conn)
            .await?;
            commit_revision(conn, id, next).await?;
            read_desired(conn, id).await?
        });
        Ok(desired)
    }

    /// Discard Project `id`'s own edits since its installed View (D-W100,
    /// D-W109, VSEL-FR-12, VSEL-AC-33): the sessions it added go, the ones
    /// it removed come back with the frames and choices it held, moved
    /// sessions go back to their groups, and its groups, names, mosaic
    /// marks, frame choices, input mode and keywords return to what that
    /// View was built from. A Library change stays pending, because it is
    /// fixed at its source or by removing the session, and the successors a
    /// regroup carried in place of a session stay; goals, subjects,
    /// rigs, notes and the application and processing location are no
    /// View inputs and stay. All or none, one revision.
    ///
    /// # Errors
    /// `Conflict` for a stale revision, or with its successors for a removed
    /// session the Library has since regrouped; `NotFound` for an unknown
    /// Project; `InvalidInput` for a Project that isn't open, has no View
    /// yet or no edit of its own pending, a group to remove or unmark that
    /// carries goals, or a removed session that can no longer join,
    /// naming each blocker.
    pub async fn discard_project_edits(
        &self,
        id: Uuid,
        expected: Revision,
    ) -> Result<ProjectDesired> {
        let desired = write_txn!(self, |conn| {
            let next = begin_edit(conn, id, expected).await?;
            let Some(applied) = installed_basis(conn, id).await? else {
                return Err(LibraryError::InvalidInput(format!(
                    "project {id} has no View yet, so it has no pending edit to discard"
                )));
            };
            let desired = read_desired(conn, id).await?;
            let pending = changes_against(conn, &desired, &applied).await?;
            if !pending.iter().any(PendingChange::discardable) {
                return Err(LibraryError::InvalidInput(format!(
                    "project {id} has no edit of its own to discard"
                )));
            }
            restore_basis(conn, &desired, &applied).await?;
            commit_revision(conn, id, next).await?;
            read_desired(conn, id).await?
        });
        Ok(desired)
    }

    /// The pending changes of Project `id` (VSEL-FR-12, D-W100, D-W109):
    /// its desired state with the live Library against the basis of its
    /// installed View, each labelled with its source. The Project's own
    /// edits come first, then the Library's: frames it rejected or restored,
    /// calibration reassigned on a held session, and held sessions it no
    /// longer has Ready or regrouped. A Project with no View yet, or one
    /// that isn't open, has none. Read-only.
    ///
    /// # Errors
    /// `NotFound` for an unknown Project; `PersistenceFailure` for a corrupt
    /// record.
    pub async fn project_pending_changes(&self, id: Uuid) -> Result<Vec<PendingChange>> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let changes = pending_changes(&mut snapshot, id).await?;
        snapshot.rollback().await?;
        Ok(changes)
    }

    /// The Ready sessions Project `id` suggests and doesn't hold (PRJ-FR-09),
    /// each with what keeps it out for now. A suggestion is never added by
    /// itself; a session that needs review, a superseded or Trashed one is
    /// not suggested, and a Project that isn't open suggests nothing.
    /// Read-only.
    ///
    /// # Errors
    /// `NotFound` for an unknown Project; `PersistenceFailure` for a corrupt
    /// record.
    pub async fn project_suggestions(&self, id: Uuid) -> Result<Vec<ProjectSuggestion>> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let suggestions = suggestions(&mut snapshot, id).await?;
        snapshot.rollback().await?;
        Ok(suggestions)
    }
}

// ── Shared rules ─────────────────────────────────────────────────────────────

/// The stored `(inclusion, basis)` columns of a capture's inclusion.
const fn inclusion_columns(inclusion: CaptureInclusion) -> (&'static str, &'static str) {
    match inclusion {
        CaptureInclusion::Included { basis: InclusionBasis::Usable } => ("included", "usable"),
        CaptureInclusion::Included { basis: InclusionBasis::Explicit } => ("included", "explicit"),
        CaptureInclusion::Excluded { basis: ExclusionBasis::Unusable } => ("excluded", "unusable"),
        CaptureInclusion::Excluded { basis: ExclusionBasis::User } => ("excluded", "user"),
    }
}

/// A capture's inclusion from its stored `(inclusion, basis)` columns.
///
/// # Errors
/// `PersistenceFailure` for columns `project_inputs.sql` refuses.
pub fn capture_inclusion(inclusion: &str, basis: &str) -> Result<CaptureInclusion> {
    match (inclusion, basis) {
        ("included", "usable") => Ok(CaptureInclusion::Included { basis: InclusionBasis::Usable }),
        ("included", "explicit") => {
            Ok(CaptureInclusion::Included { basis: InclusionBasis::Explicit })
        }
        ("excluded", "unusable") => {
            Ok(CaptureInclusion::Excluded { basis: ExclusionBasis::Unusable })
        }
        ("excluded", "user") => Ok(CaptureInclusion::Excluded { basis: ExclusionBasis::User }),
        _ => Err(LibraryError::PersistenceFailure(format!(
            "corrupt capture inclusion {inclusion}/{basis}"
        ))),
    }
}

/// A copy the Library still holds: neither Trashed nor retired.
const fn is_live(asset: &Asset) -> bool {
    !matches!(asset.availability, Availability::Trashed | Availability::Retired)
}

/// The logical quality of a capture's live copies; `None` with none live.
#[must_use]
pub fn live_quality(live: &[&Asset]) -> Option<ApplicableQuality> {
    (!live.is_empty()).then(|| logical_quality(live))
}

fn require_distinct(ids: impl Iterator<Item = Uuid>, what: &str) -> Result<()> {
    let mut seen = BTreeSet::new();
    for id in ids {
        if !seen.insert(id) {
            return Err(LibraryError::InvalidInput(format!("{what} {id} is listed twice")));
        }
    }
    Ok(())
}

/// An edit of Project `id` at `expected`: the revision it commits. A Closing,
/// Closed or Archived Project takes no edit (PRJ-FR-25).
pub async fn begin_edit(
    conn: &mut SqliteConnection,
    id: Uuid,
    expected: Revision,
) -> Result<Revision> {
    let next = next_project_revision(conn, id, expected).await?;
    let lifecycle = read_lifecycle(conn, id).await?;
    if !lifecycle.is_open() {
        return Err(LibraryError::InvalidInput(format!(
            "project {id} is {lifecycle} and takes no edit; duplicate it to continue"
        )));
    }
    Ok(next)
}

async fn read_lifecycle(conn: &mut SqliteConnection, id: Uuid) -> Result<ProjectLifecycle> {
    let lifecycle: Option<String> =
        sqlx::query_scalar("SELECT lifecycle FROM projects WHERE id = ?1")
            .bind(id.to_string())
            .fetch_optional(&mut *conn)
            .await?;
    from_text(&lifecycle.ok_or_else(|| LibraryError::NotFound(format!("project {id}")))?)
}

async fn require_group(conn: &mut SqliteConnection, project: Uuid, group: Uuid) -> Result<Uuid> {
    let rig: Option<String> =
        sqlx::query_scalar("SELECT rig_id FROM project_groups WHERE id = ?1 AND project_id = ?2")
            .bind(group.to_string())
            .bind(project.to_string())
            .fetch_optional(&mut *conn)
            .await?;
    parse_uuid(
        &rig.ok_or_else(|| LibraryError::NotFound(format!("group {group} of project {project}")))?,
    )
}

/// The group a held session sits in.
async fn require_held(conn: &mut SqliteConnection, project: Uuid, session: Uuid) -> Result<Uuid> {
    let group: Option<String> = sqlx::query_scalar(
        "SELECT group_id FROM project_sessions WHERE project_id = ?1 AND session_id = ?2",
    )
    .bind(project.to_string())
    .bind(session.to_string())
    .fetch_optional(&mut *conn)
    .await?;
    parse_uuid(&group.ok_or_else(|| {
        LibraryError::NotFound(format!("session {session} is not in project {project}"))
    })?)
}

/// Two groups of a Project never share a name (`project_inputs.sql`).
async fn require_free_name(
    conn: &mut SqliteConnection,
    project: Uuid,
    name: &GroupName,
    except: Option<Uuid>,
) -> Result<()> {
    let taken: Option<String> = sqlx::query_scalar(
        "SELECT id FROM project_groups WHERE project_id = ?1 AND name_key = ?2 \
         AND id IS NOT ?3",
    )
    .bind(project.to_string())
    .bind(name.key())
    .bind(except.map(|id| id.to_string()))
    .fetch_optional(&mut *conn)
    .await?;
    match taken {
        Some(_) => Err(LibraryError::InvalidInput(format!(
            "another group of the Project is already named {}",
            name.as_str()
        ))),
        None => Ok(()),
    }
}

pub async fn insert_group(
    conn: &mut SqliteConnection,
    project: Uuid,
    group: &NewGroup,
) -> Result<()> {
    group.optics.validate()?;
    if let Some(framing) = &group.framing {
        framing.validate()?;
    }
    require_free_name(conn, project, &group.name, None).await?;
    sqlx::query(
        "INSERT INTO project_groups (id, project_id, rig_id, name, name_key, panel, origin, \
         optics, framing, position, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7, ?8, \
         (SELECT coalesce(max(position) + 1, 0) FROM project_groups WHERE project_id = ?2), ?9)",
    )
    .bind(group.id.to_string())
    .bind(project.to_string())
    .bind(group.rig_id.to_string())
    .bind(group.name.as_str())
    .bind(group.name.key())
    .bind(to_text(&group.origin)?)
    .bind(to_json(&group.optics)?)
    .bind(group.framing.as_ref().map(to_json).transpose()?)
    .bind(now()?)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

async fn rename(
    conn: &mut SqliteConnection,
    project: Uuid,
    group: Uuid,
    name: &GroupName,
) -> Result<()> {
    require_free_name(conn, project, name, Some(group)).await?;
    sqlx::query("UPDATE project_groups SET name = ?2, name_key = ?3 WHERE id = ?1")
        .bind(group.to_string())
        .bind(name.as_str())
        .bind(name.key())
        .execute(&mut *conn)
        .await?;
    Ok(())
}

async fn move_sessions(
    conn: &mut SqliteConnection,
    project: Uuid,
    sessions: &[Uuid],
    group: Uuid,
) -> Result<()> {
    let rig = require_group(conn, project, group).await?;
    for session in sessions {
        let from = require_held(conn, project, *session).await?;
        let from_rig = require_group(conn, project, from).await?;
        if from_rig != rig {
            return Err(LibraryError::InvalidInput(format!(
                "session {session} is on rig {from_rig}; group {group} holds rig {rig} only"
            )));
        }
        sqlx::query(
            "UPDATE project_sessions SET group_id = ?3, placement = 'user' \
             WHERE project_id = ?1 AND session_id = ?2",
        )
        .bind(project.to_string())
        .bind(session.to_string())
        .bind(group.to_string())
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

/// A framing group exists for its sessions: once none is left it goes,
/// unless it carries goals. A user's group stays until removed.
async fn drop_empty_framing_groups(conn: &mut SqliteConnection, project: Uuid) -> Result<()> {
    sqlx::query(
        "DELETE FROM project_groups WHERE project_id = ?1 AND origin = 'framing' \
         AND id NOT IN (SELECT group_id FROM project_sessions WHERE project_id = ?1) \
         AND id NOT IN (SELECT group_id FROM project_goals \
             WHERE project_id = ?1 AND group_id IS NOT NULL)",
    )
    .bind(project.to_string())
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Whether a group carries goals; a panel group with goals stays a panel.
async fn has_goals(conn: &mut SqliteConnection, group: Uuid) -> Result<bool> {
    Ok(sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM project_goals WHERE group_id = ?1)")
        .bind(group.to_string())
        .fetch_one(&mut *conn)
        .await?)
}

/// The Project's choice for one held capture.
async fn write_inclusion(
    conn: &mut SqliteConnection,
    project: Uuid,
    capture_key: Uuid,
    inclusion: CaptureInclusion,
) -> Result<()> {
    let (inclusion, basis) = inclusion_columns(inclusion);
    sqlx::query(
        "UPDATE project_captures SET inclusion = ?3, basis = ?4, updated_at = ?5 \
         WHERE project_id = ?1 AND capture_key = ?2",
    )
    .bind(project.to_string())
    .bind(capture_key.to_string())
    .bind(inclusion)
    .bind(basis)
    .bind(now()?)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Remove a held session; its captures and copies go with it.
async fn delete_member(conn: &mut SqliteConnection, project: Uuid, session: Uuid) -> Result<()> {
    sqlx::query("DELETE FROM project_sessions WHERE project_id = ?1 AND session_id = ?2")
        .bind(project.to_string())
        .bind(session.to_string())
        .execute(&mut *conn)
        .await?;
    Ok(())
}

// ── Membership add ───────────────────────────────────────────────────────────

/// The membership add of [`Catalog::add_project_sessions`] in the caller's
/// transaction, all or none: the new framing groups, then each whole session
/// through admission with its Target and rig. The caller checks the Project
/// revision and commits the next one.
///
/// # Errors
/// As [`Catalog::add_project_sessions`], less the Project revision.
pub async fn add_members(
    conn: &mut SqliteConnection,
    project: Uuid,
    groups: &[NewGroup],
    adds: &[SessionAdd],
) -> Result<()> {
    if adds.is_empty() {
        return Err(LibraryError::InvalidInput("no session to add".into()));
    }
    require_distinct(adds.iter().map(|add| add.session_id), "session")?;
    if let Some(group) = groups.iter().find(|group| adds.iter().all(|add| add.group_id != group.id))
    {
        return Err(LibraryError::InvalidInput(format!(
            "new group {} gets no session",
            group.name.as_str()
        )));
    }
    for group in groups {
        insert_group(conn, project, group).await?;
    }
    for add in adds {
        add_session(conn, project, add).await?;
    }
    Ok(())
}

/// Add one whole session in the caller's transaction, in the order
/// `project_inputs.sql` expects: admission, the session row with the basis
/// it returned, captures, copies.
async fn add_session(conn: &mut SqliteConnection, project: Uuid, add: &SessionAdd) -> Result<()> {
    let held: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM project_sessions WHERE project_id = ?1 AND session_id = ?2)",
    )
    .bind(project.to_string())
    .bind(add.session_id.to_string())
    .fetch_one(&mut *conn)
    .await?;
    if held {
        return Err(LibraryError::InvalidInput(format!(
            "session {} is already in project {project}",
            add.session_id
        )));
    }
    let basis = admission::require_admission(
        conn,
        project,
        add.group_id,
        add.session_id,
        add.expected.as_ref(),
    )
    .await?;
    let joined = session_filters::append_target_and_rig(conn, project, add.session_id).await?;
    insert_member(
        conn,
        project,
        add.session_id,
        add.group_id,
        add.placement,
        joined.target_id,
        &basis,
    )
    .await?;
    for capture in session_captures(conn, add.session_id).await? {
        insert_capture(
            conn,
            project,
            capture.session_id,
            capture.capture_key,
            &capture.copies,
            capture.inclusion,
            capture.quality_when_added,
        )
        .await?;
    }
    Ok(())
}

/// The session row with the admission basis `require_admission` returned
/// in the caller's transaction, in its group with its placement and the
/// Target it joins on.
pub async fn insert_member(
    conn: &mut SqliteConnection,
    project: Uuid,
    session: Uuid,
    group: Uuid,
    placement: SessionPlacement,
    target: Uuid,
    basis: &AdmissionBasis,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO project_sessions (project_id, session_id, group_id, placement, target_id, \
         grouping_revision, calibration_generation, added_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    )
    .bind(project.to_string())
    .bind(session.to_string())
    .bind(group.to_string())
    .bind(to_text(&placement)?)
    .bind(target.to_string())
    .bind(super::db_revision(basis.grouping_revision)?)
    .bind(super::db_revision(basis.calibration_generation)?)
    .bind(now()?)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// The session's live logical captures (D16) as they stand, each with every
/// copy's decision revision and observation.
pub async fn session_captures(
    conn: &mut SqliteConnection,
    session_id: Uuid,
) -> Result<Vec<ProjectCapture>> {
    let mut row = load_session_row(conn, session_id).await?;
    let assets: Vec<Asset> = scoped_members(conn, &mut row, Members::Live).await?;
    let view = CaptureView::read(conn, &[session_id], &assets).await?;
    let mut captures = Vec::new();
    for key in view.group(&assets).into_keys() {
        let copies = view.copies_of(&key);
        let live: Vec<&Asset> = copies.iter().copied().filter(|copy| is_live(copy)).collect();
        let quality = live_quality(&live).unwrap_or(ApplicableQuality::Unreviewed);
        let bases = copies
            .iter()
            .map(|copy| CopyBasis {
                asset_id: copy.id,
                decision_revision: copy.decision_revision,
                fingerprint: copy.fingerprint.clone(),
            })
            .collect();
        captures.push(ProjectCapture::new(
            session_id,
            bases,
            CaptureInclusion::on_add(quality),
            quality,
        )?);
    }
    Ok(captures)
}

/// One capture of `session_id` and its copies, with the Project's choice
/// and its quality when added; each is held once per Project.
pub async fn insert_capture(
    conn: &mut SqliteConnection,
    project: Uuid,
    session_id: Uuid,
    capture_key: Uuid,
    copies: &[CopyBasis],
    inclusion: CaptureInclusion,
    quality_when_added: ApplicableQuality,
) -> Result<()> {
    let ids: Vec<String> = copies.iter().map(|copy| copy.asset_id.to_string()).collect();
    let holder: Option<String> = sqlx::query_scalar(
        "SELECT c.session_id FROM project_capture_copies cc JOIN project_captures c \
         ON c.project_id = cc.project_id AND c.capture_key = cc.capture_key \
         WHERE cc.project_id = ?1 AND (cc.asset_id IN (SELECT value FROM json_each(?2)) \
         OR cc.capture_key = ?3) LIMIT 1",
    )
    .bind(project.to_string())
    .bind(to_json(&ids)?)
    .bind(capture_key.to_string())
    .fetch_optional(&mut *conn)
    .await?;
    if let Some(holder) = holder {
        return Err(LibraryError::InvalidInput(format!(
            "capture {capture_key} is already held through session {holder}; a frame enters a \
             Project once"
        )));
    }
    let (inclusion, basis) = inclusion_columns(inclusion);
    sqlx::query(
        "INSERT INTO project_captures (project_id, capture_key, session_id, inclusion, basis, \
         quality_when_added, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    )
    .bind(project.to_string())
    .bind(capture_key.to_string())
    .bind(session_id.to_string())
    .bind(inclusion)
    .bind(basis)
    .bind(to_json(&quality_when_added)?)
    .bind(now()?)
    .execute(&mut *conn)
    .await?;
    for copy in copies {
        sqlx::query(
            "INSERT INTO project_capture_copies (project_id, capture_key, asset_id, \
             decision_revision, fingerprint) VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .bind(project.to_string())
        .bind(capture_key.to_string())
        .bind(copy.asset_id.to_string())
        .bind(super::db_revision(copy.decision_revision)?)
        .bind(to_json(&copy.fingerprint)?)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

// ── Regroup carry ────────────────────────────────────────────────────────────

/// A held session's place in the Project, which its successors take.
struct HeldPlace {
    session_id: Uuid,
    group_id: Uuid,
    placement: SessionPlacement,
    target_id: Uuid,
}

/// A regroup that replaced sessions an open Project holds keeps their frames
/// there (LIB-FR-12, VSEL-FR-12; D-W100): in the regroup's transaction, each
/// such Project holds every successor that took one of their frames in place
/// of its predecessor, in the predecessor's group and placement and on the
/// Target it joined on, and each held capture moves with its choice and
/// copies, so no frame leaves the Project. A successor that isn't Ready or
/// settled stays all the same: it reads Needs review there and Apply waits
/// for it. Each Project takes one revision; a Closing, Closed or Archived
/// Project keeps what it holds.
///
/// # Errors
/// `PersistenceFailure` for a held capture none of whose copies went to a
/// successor.
pub async fn carry_regrouped(conn: &mut SqliteConnection, lineage: &SessionLineage) -> Result<()> {
    let predecessors: BTreeSet<Uuid> = lineage.predecessors.iter().copied().collect();
    let rows = sqlx::query(
        "SELECT ps.project_id, ps.session_id, ps.group_id, ps.placement, ps.target_id \
         FROM project_sessions ps JOIN projects p ON p.id = ps.project_id \
         WHERE p.lifecycle = 'open' AND ps.session_id IN (SELECT value FROM json_each(?1)) \
         ORDER BY ps.project_id, ps.added_at, ps.session_id",
    )
    .bind(super::json_ids(&predecessors)?)
    .fetch_all(&mut *conn)
    .await?;
    let mut held: BTreeMap<Uuid, Vec<HeldPlace>> = BTreeMap::new();
    for row in rows {
        held.entry(parse_uuid(&row.try_get::<String, _>("project_id")?)?).or_default().push(
            HeldPlace {
                session_id: parse_uuid(&row.try_get::<String, _>("session_id")?)?,
                group_id: parse_uuid(&row.try_get::<String, _>("group_id")?)?,
                placement: from_text(&row.try_get::<String, _>("placement")?)?,
                target_id: parse_uuid(&row.try_get::<String, _>("target_id")?)?,
            },
        );
    }
    for (project, places) in held {
        carry_into(conn, project, &places, lineage).await?;
    }
    Ok(())
}

/// [`carry_regrouped`] for one Project: the successors join first, while
/// the predecessors they stand in for are still held, which is what lets
/// `project_sessions_admit_ready` and `_admit_settled` take them.
async fn carry_into(
    conn: &mut SqliteConnection,
    project: Uuid,
    places: &[HeldPlace],
    lineage: &SessionLineage,
) -> Result<()> {
    let mut held = read_captures(conn, project).await?;
    let mut moving = Vec::new();
    for place in places {
        for capture in held.remove(&place.session_id).unwrap_or_default() {
            moving.push((place, capture));
        }
    }
    let copies: BTreeSet<Uuid> = moving
        .iter()
        .flat_map(|(_, capture)| capture.copies.iter().map(|copy| copy.asset_id))
        .collect();
    let session_of = super::current_session_of(conn, &copies).await?;
    let mut joins: BTreeMap<Uuid, &HeldPlace> = BTreeMap::new();
    let mut carried = Vec::with_capacity(moving.len());
    for (place, capture) in moving {
        let successor = capture
            .copies
            .iter()
            .filter_map(|copy| session_of.get(&copy.asset_id))
            .find(|session| lineage.successors.contains(session))
            .copied()
            .ok_or_else(|| {
                LibraryError::PersistenceFailure(format!(
                    "held capture {} of session {} went to no successor",
                    capture.capture_key, place.session_id
                ))
            })?;
        joins.entry(successor).or_insert(place);
        carried.push((successor, capture));
    }
    for (successor, place) in joins {
        let basis = AdmissionBasis {
            grouping_revision: lineage.grouping_revision,
            calibration_generation: admission::read_calibration(conn, successor).await?.generation,
        };
        insert_member(
            conn,
            project,
            successor,
            place.group_id,
            place.placement,
            place.target_id,
            &basis,
        )
        .await?;
    }
    for place in places {
        delete_member(conn, project, place.session_id).await?;
    }
    for (successor, capture) in carried {
        insert_capture(
            conn,
            project,
            successor,
            capture.capture_key,
            &capture.copies,
            capture.inclusion,
            capture.quality_when_added,
        )
        .await?;
    }
    let next = require_project(conn, project).await? + 1;
    commit_revision(conn, project, next).await
}

// ── Reads ────────────────────────────────────────────────────────────────────

/// The desired state of Project `id` in the caller's snapshot.
///
/// # Errors
/// `NotFound` for an unknown Project; `PersistenceFailure` for a corrupt
/// record.
pub async fn read_desired(conn: &mut SqliteConnection, id: Uuid) -> Result<ProjectDesired> {
    let project = id.to_string();
    let row = sqlx::query(
        "SELECT revision, lifecycle, view_mode, group_keyword, panel_keyword, profile_id, \
         processing_parent FROM projects WHERE id = ?1",
    )
    .bind(&project)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| LibraryError::NotFound(format!("project {id}")))?;
    let keywords = match (
        row.try_get::<Option<String>, _>("group_keyword")?,
        row.try_get::<Option<String>, _>("panel_keyword")?,
    ) {
        (Some(group), Some(panel)) => Some(GroupKeywords::new(&group, &panel)?),
        _ => None,
    };
    let settings = ProjectViewSettings {
        mode: from_text::<ViewMode>(&row.try_get::<String, _>("view_mode")?)?,
        keywords,
        profile_id: row
            .try_get::<Option<String>, _>("profile_id")?
            .as_deref()
            .map(parse_uuid)
            .transpose()?,
        parent: row
            .try_get::<Option<String>, _>("processing_parent")?
            .map(|parent| from_json::<NativePath>(&parent))
            .transpose()?,
    };
    let mut groups = Vec::new();
    for group in sqlx::query(
        "SELECT id, rig_id, name, panel, origin, optics, framing, position FROM project_groups \
         WHERE project_id = ?1 ORDER BY position, id",
    )
    .bind(&project)
    .fetch_all(&mut *conn)
    .await?
    {
        groups.push(ProjectGroup {
            id: parse_uuid(&group.try_get::<String, _>("id")?)?,
            rig_id: parse_uuid(&group.try_get::<String, _>("rig_id")?)?,
            name: GroupName::new(&group.try_get::<String, _>("name")?)?,
            panel: group.try_get::<i64, _>("panel")? == 1,
            origin: from_text(&group.try_get::<String, _>("origin")?)?,
            optics: from_json(&group.try_get::<String, _>("optics")?)?,
            framing: group
                .try_get::<Option<String>, _>("framing")?
                .map(|framing| from_json(&framing))
                .transpose()?,
            position: u32::try_from(group.try_get::<i64, _>("position")?)
                .map_err(|_| LibraryError::PersistenceFailure("corrupt group position".into()))?,
        });
    }
    let mut sessions = Vec::new();
    for member in sqlx::query(
        "SELECT session_id, group_id, placement, target_id, grouping_revision, \
         calibration_generation, added_at FROM project_sessions WHERE project_id = ?1 \
         ORDER BY added_at, session_id",
    )
    .bind(&project)
    .fetch_all(&mut *conn)
    .await?
    {
        sessions.push(ProjectSessionMember {
            session_id: parse_uuid(&member.try_get::<String, _>("session_id")?)?,
            group_id: parse_uuid(&member.try_get::<String, _>("group_id")?)?,
            placement: from_text(&member.try_get::<String, _>("placement")?)?,
            target_id: parse_uuid(&member.try_get::<String, _>("target_id")?)?,
            grouping_revision: revision(member.try_get("grouping_revision")?)?,
            calibration_generation: revision(member.try_get("calibration_generation")?)?,
            added_at: member.try_get("added_at")?,
        });
    }
    let captures = read_captures(conn, id).await?.into_values().flatten().collect();
    Ok(ProjectDesired {
        project_id: id,
        revision: revision(row.try_get("revision")?)?,
        lifecycle: from_text(&row.try_get::<String, _>("lifecycle")?)?,
        settings,
        groups,
        sessions,
        captures,
    })
}

/// The Project's held captures by session, each with its copies, in
/// capture-key order.
async fn read_captures(
    conn: &mut SqliteConnection,
    project: Uuid,
) -> Result<BTreeMap<Uuid, Vec<ProjectCapture>>> {
    let mut copies: BTreeMap<Uuid, Vec<CopyBasis>> = BTreeMap::new();
    for row in sqlx::query(
        "SELECT capture_key, asset_id, decision_revision, fingerprint FROM project_capture_copies \
         WHERE project_id = ?1 ORDER BY capture_key, asset_id",
    )
    .bind(project.to_string())
    .fetch_all(&mut *conn)
    .await?
    {
        copies.entry(parse_uuid(&row.try_get::<String, _>("capture_key")?)?).or_default().push(
            CopyBasis {
                asset_id: parse_uuid(&row.try_get::<String, _>("asset_id")?)?,
                decision_revision: revision(row.try_get("decision_revision")?)?,
                fingerprint: from_json(&row.try_get::<String, _>("fingerprint")?)?,
            },
        );
    }
    let mut captures: BTreeMap<Uuid, Vec<ProjectCapture>> = BTreeMap::new();
    for row in sqlx::query(
        "SELECT capture_key, session_id, inclusion, basis, quality_when_added \
         FROM project_captures WHERE project_id = ?1 ORDER BY capture_key",
    )
    .bind(project.to_string())
    .fetch_all(&mut *conn)
    .await?
    {
        let capture_key = parse_uuid(&row.try_get::<String, _>("capture_key")?)?;
        let session_id = parse_uuid(&row.try_get::<String, _>("session_id")?)?;
        let capture = ProjectCapture {
            capture_key,
            session_id,
            copies: copies.remove(&capture_key).unwrap_or_default(),
            inclusion: capture_inclusion(
                &row.try_get::<String, _>("inclusion")?,
                &row.try_get::<String, _>("basis")?,
            )?,
            quality_when_added: from_json(&row.try_get::<String, _>("quality_when_added")?)?,
        };
        capture.validate().map_err(|error| {
            LibraryError::PersistenceFailure(format!("held capture {capture_key}: {error}"))
        })?;
        captures.entry(session_id).or_default().push(capture);
    }
    Ok(captures)
}

/// Every live copy of `captures`, by asset id.
async fn live_copies<'a>(
    conn: &mut SqliteConnection,
    captures: impl Iterator<Item = &'a ProjectCapture>,
) -> Result<BTreeMap<Uuid, Asset>> {
    let ids: BTreeSet<Uuid> =
        captures.flat_map(|capture| capture.copies.iter().map(|copy| copy.asset_id)).collect();
    Ok(load_assets(conn, &ids)
        .await?
        .into_iter()
        .filter(is_live)
        .map(|asset| (asset.id, asset))
        .collect())
}

fn live_of<'a>(capture: &ProjectCapture, live: &'a BTreeMap<Uuid, Asset>) -> Vec<&'a Asset> {
    capture.copies.iter().filter_map(|copy| live.get(&copy.asset_id)).collect()
}

// ── Pending changes ──────────────────────────────────────────────────────────

/// Frames of one session whose placement differs from the applied basis,
/// by the change they make.
#[derive(Default)]
struct FrameChanges {
    included: Vec<Uuid>,
    excluded: Vec<Uuid>,
    rejected: Vec<Uuid>,
    restored: Vec<Uuid>,
}

impl FrameChanges {
    /// The capture's placement moved from the basis: the Project's own edit
    /// when its choice differs from the one the build saw, else the
    /// Library's (D-W109).
    fn record(&mut self, key: Uuid, now: bool, own_edit: bool) {
        let list = match (own_edit, now) {
            (true, true) => &mut self.included,
            (true, false) => &mut self.excluded,
            (false, true) => &mut self.restored,
            (false, false) => &mut self.rejected,
        };
        list.push(key);
    }

    /// The held frames of `session` whose placement moved from `basis`. The
    /// Library's side of a frame awaiting a decision, set back to Unreviewed
    /// in a reopened review or changed after review, moves nothing: its
    /// session reads Needs review, and Apply waits until it is decided
    /// (D-W100, D-W140).
    fn of(
        session: Uuid,
        held: &[ProjectCapture],
        basis: &[BasisCapture],
        live: &BTreeMap<Uuid, Asset>,
    ) -> Self {
        let mut frames = Self::default();
        for capture in held.iter().filter(|capture| capture.session_id == session) {
            let Some(was) = basis.iter().find(|was| was.capture_key == capture.capture_key) else {
                continue;
            };
            let quality = live_quality(&live_of(capture, live));
            let own_edit = capture.inclusion != was.inclusion;
            let undecided = matches!(
                quality,
                Some(ApplicableQuality::Unreviewed | ApplicableQuality::ChangedContent { .. })
            );
            if undecided && !own_edit {
                continue;
            }
            let now = capture.inclusion.admits(quality);
            if now != was.included {
                frames.record(capture.capture_key, now, own_edit);
            }
        }
        frames
    }

    /// Each non-empty list as the change it makes, by source.
    fn push_into(
        self,
        session_id: Uuid,
        own: &mut Vec<PendingChange>,
        library: &mut Vec<PendingChange>,
    ) {
        if !self.included.is_empty() {
            own.push(PendingChange::FramesIncluded { session_id, capture_keys: self.included });
        }
        if !self.excluded.is_empty() {
            own.push(PendingChange::FramesExcluded { session_id, capture_keys: self.excluded });
        }
        if !self.rejected.is_empty() {
            library
                .push(PendingChange::LibraryRejected { session_id, capture_keys: self.rejected });
        }
        if !self.restored.is_empty() {
            library
                .push(PendingChange::LibraryRestored { session_id, capture_keys: self.restored });
        }
    }
}

pub async fn pending_changes(conn: &mut SqliteConnection, id: Uuid) -> Result<Vec<PendingChange>> {
    let desired = read_desired(conn, id).await?;
    if !desired.lifecycle.is_open() {
        return Ok(Vec::new());
    }
    let Some(applied) = installed_basis(conn, id).await? else { return Ok(Vec::new()) };
    changes_against(conn, &desired, &applied).await
}

/// The basis of the Project's installed View; `None` before its first Apply.
async fn installed_basis(conn: &mut SqliteConnection, id: Uuid) -> Result<Option<ProjectBasis>> {
    let basis: Option<String> = sqlx::query_scalar(
        "SELECT basis FROM view_manifests WHERE project_id = ?1 AND state = 'installed'",
    )
    .bind(id.to_string())
    .fetch_optional(&mut *conn)
    .await?;
    basis.as_deref().map(from_json).transpose()
}

/// What a regroup carried in place of the basis sessions the Project no
/// longer holds (D-W100): by basis session, the held sessions the basis
/// lacks that now hold its captures.
struct Carried(BTreeMap<Uuid, BTreeSet<Uuid>>);

impl Carried {
    fn of(desired: &ProjectDesired, applied: &ProjectBasis) -> Self {
        let basis: Vec<&BasisSession> =
            applied.groups.iter().flat_map(|group| &group.sessions).collect();
        let mut carried = BTreeMap::new();
        for session in &basis {
            if desired.sessions.iter().any(|member| member.session_id == session.session_id) {
                continue;
            }
            let successors: BTreeSet<Uuid> = desired
                .captures
                .iter()
                .filter(|capture| {
                    basis.iter().all(|was| was.session_id != capture.session_id)
                        && session.captures.iter().any(|was| was.capture_key == capture.capture_key)
                })
                .map(|capture| capture.session_id)
                .collect();
            if !successors.is_empty() {
                carried.insert(session.session_id, successors);
            }
        }
        Self(carried)
    }

    /// The basis session a held session stands in for: the one a regroup
    /// carried it from, else itself.
    fn basis_of(&self, session: Uuid) -> Uuid {
        self.0
            .iter()
            .find(|(_, successors)| successors.contains(&session))
            .map_or(session, |(basis, _)| *basis)
    }

    fn successors(&self, basis: Uuid) -> Option<&BTreeSet<Uuid>> {
        self.0.get(&basis)
    }
}

/// `desired` with the live Library against `applied`: the Project's own
/// edits first, then the Library's. A held session a regroup carried in
/// place of a basis session is compared with that session's basis, and the
/// regroup itself is the Library's change (D-W100).
async fn changes_against(
    conn: &mut SqliteConnection,
    desired: &ProjectDesired,
    applied: &ProjectBasis,
) -> Result<Vec<PendingChange>> {
    let keywords = match &desired.settings.keywords {
        Some(keywords) => keywords.clone(),
        None => read_workflow_settings(conn).await?.0.keywords,
    };
    let mut own = Vec::new();
    if desired.settings.mode != applied.mode {
        own.push(PendingChange::ModeSwitched { from: applied.mode, to: desired.settings.mode });
    }
    if keywords != applied.keywords {
        own.push(PendingChange::KeywordsChanged { from: applied.keywords.clone(), to: keywords });
    }
    own.extend(group_changes(desired, applied));
    let applied_sessions: BTreeMap<Uuid, (Uuid, &[BasisCapture])> = applied
        .groups
        .iter()
        .flat_map(|group| {
            group
                .sessions
                .iter()
                .map(|session| (session.session_id, (group.id, session.captures.as_slice())))
        })
        .collect();
    let carried = Carried::of(desired, applied);
    let live = live_copies(conn, desired.captures.iter()).await?;
    let mut library = Vec::new();
    for member in &desired.sessions {
        let Some((group, captures)) = applied_sessions.get(&carried.basis_of(member.session_id))
        else {
            own.push(PendingChange::SessionAdded {
                session_id: member.session_id,
                group_id: member.group_id,
            });
            continue;
        };
        if *group != member.group_id {
            own.push(PendingChange::SessionMoved {
                session_id: member.session_id,
                from_group: *group,
                to_group: member.group_id,
            });
        }
        FrameChanges::of(member.session_id, &desired.captures, captures, &live).push_into(
            member.session_id,
            &mut own,
            &mut library,
        );
    }
    for (session_id, (group, _)) in &applied_sessions {
        if let Some(successors) = carried.successors(*session_id) {
            library.push(PendingChange::SessionRegrouped {
                session_id: *session_id,
                successors: successors.iter().copied().collect(),
            });
        } else if desired.sessions.iter().all(|member| member.session_id != *session_id) {
            own.push(PendingChange::SessionRemoved { session_id: *session_id, group_id: *group });
        }
    }
    for session in applied.groups.iter().flat_map(|group| &group.sessions) {
        let held = desired.sessions.iter().any(|member| member.session_id == session.session_id);
        let standing_in: Vec<Uuid> = match carried.successors(session.session_id) {
            Some(successors) => successors.iter().copied().collect(),
            None if held => vec![session.session_id],
            None => Vec::new(),
        };
        for session_id in standing_in {
            let current = admission::read_calibration(conn, session_id).await?;
            library.extend(current.changes_since(&session.calibration));
        }
    }
    for member in &desired.sessions {
        library.extend(session_change(conn, member.session_id).await?);
    }
    own.extend(library);
    Ok(own)
}

/// The groups the Project added, renamed, marked or unmarked, and removed.
fn group_changes(desired: &ProjectDesired, applied: &ProjectBasis) -> Vec<PendingChange> {
    let mut own = Vec::new();
    for group in &desired.groups {
        let Some(was) = applied.groups.iter().find(|was| was.id == group.id) else {
            own.push(PendingChange::GroupAdded { group_id: group.id, name: group.name.clone() });
            continue;
        };
        if was.name != group.name {
            own.push(PendingChange::GroupRenamed {
                group_id: group.id,
                from: was.name.clone(),
                to: group.name.clone(),
            });
        }
        if was.panel != group.panel {
            own.push(PendingChange::GroupPanelChanged { group_id: group.id, panel: group.panel });
        }
    }
    for group in &applied.groups {
        if desired.groups.iter().all(|held| held.id != group.id) {
            own.push(PendingChange::GroupRemoved { group_id: group.id, name: group.name.clone() });
        }
    }
    own
}

/// A held session the Library no longer has Ready. A frame whose bytes
/// changed after review holds the session back without being a pending
/// change (LIB-FR-09, D-W140), so only the other causes count here. A
/// session a regroup replaced is never held: its successors are, and the
/// regroup reads against the basis (D-W100).
async fn session_change(
    conn: &mut SqliteConnection,
    session_id: Uuid,
) -> Result<Option<PendingChange>> {
    let intake = admission::read_intake(conn, session_id).await?;
    let readiness = SessionIntake { changed_frames: 0, ..intake }.readiness();
    Ok((readiness != SessionReadiness::Ready)
        .then_some(PendingChange::SessionNotReady { session_id, readiness }))
}

// ── Discard ──────────────────────────────────────────────────────────────────

/// The installed basis's sessions, each with its group.
type BasisSessions<'a> = BTreeMap<Uuid, (Uuid, &'a BasisSession)>;

/// Put the Project's own choices back to `applied` in the order the
/// triggers allow: added sessions go, removed groups come back, moved
/// sessions go back, created groups go, every group's name, mark and
/// position return, removed sessions rejoin through admission, held frames'
/// choices return, then the input mode and keywords. Library state is only
/// read, so its changes stay pending: the successors a regroup carried in
/// place of a basis session stay, back in its group with its frames'
/// choices (D-W100).
async fn restore_basis(
    conn: &mut SqliteConnection,
    desired: &ProjectDesired,
    applied: &ProjectBasis,
) -> Result<()> {
    let project = desired.project_id;
    let sessions: BasisSessions<'_> = applied
        .groups
        .iter()
        .flat_map(|group| {
            group.sessions.iter().map(move |session| (session.session_id, (group.id, session)))
        })
        .collect();
    let carried = Carried::of(desired, applied);
    for member in &desired.sessions {
        if !sessions.contains_key(&carried.basis_of(member.session_id)) {
            delete_member(conn, project, member.session_id).await?;
        }
    }
    for group in &applied.groups {
        if desired.groups.iter().all(|held| held.id != group.id) {
            restore_group(conn, project, group).await?;
        }
    }
    move_back(conn, desired, &sessions, &carried).await?;
    drop_created_groups(conn, desired, applied).await?;
    restore_group_names(conn, desired, applied).await?;
    for (session_id, (group, session)) in &sessions {
        if let Some(successors) = carried.successors(*session_id) {
            for successor in successors {
                let current: Vec<&ProjectCapture> = desired
                    .captures
                    .iter()
                    .filter(|capture| capture.session_id == *successor)
                    .collect();
                restore_choices(conn, project, session, &current).await?;
            }
        } else if desired.sessions.iter().any(|member| member.session_id == *session_id) {
            restore_frames(conn, project, session, &desired.captures).await?;
        } else {
            rejoin(conn, project, *group, session).await?;
        }
    }
    restore_settings(conn, desired, applied).await
}

/// A placeholder name key no group name has (names carry no control
/// character), so restored names can swap within one transaction.
fn placeholder_key(group: Uuid) -> String {
    format!("\u{1}{group}")
}

/// A group the Project removed, back with its basis identity, rig, optics,
/// framing and position, under a placeholder name key.
async fn restore_group(
    conn: &mut SqliteConnection,
    project: Uuid,
    group: &BasisGroup,
) -> Result<()> {
    group.optics.validate()?;
    if let Some(framing) = &group.framing {
        framing.validate()?;
    }
    sqlx::query(
        "INSERT INTO project_groups (id, project_id, rig_id, name, name_key, panel, origin, \
         optics, framing, position, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, \
         ?10, ?11)",
    )
    .bind(group.id.to_string())
    .bind(project.to_string())
    .bind(group.rig_id.to_string())
    .bind(group.name.as_str())
    .bind(placeholder_key(group.id))
    .bind(i64::from(group.panel))
    .bind(to_text(&group.origin)?)
    .bind(to_json(&group.optics)?)
    .bind(group.framing.as_ref().map(to_json).transpose()?)
    .bind(i64::from(group.position))
    .bind(now()?)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Held sessions the Project moved go back to their basis group and
/// placement, a successor a regroup carried to its predecessor's; a session
/// stays on its rig, so the move is always allowed.
async fn move_back(
    conn: &mut SqliteConnection,
    desired: &ProjectDesired,
    sessions: &BasisSessions<'_>,
    carried: &Carried,
) -> Result<()> {
    for member in &desired.sessions {
        let Some((group, session)) = sessions.get(&carried.basis_of(member.session_id)) else {
            continue;
        };
        if member.group_id != *group || member.placement != session.placement {
            sqlx::query(
                "UPDATE project_sessions SET group_id = ?3, placement = ?4 \
                 WHERE project_id = ?1 AND session_id = ?2",
            )
            .bind(desired.project_id.to_string())
            .bind(member.session_id.to_string())
            .bind(group.to_string())
            .bind(to_text(&session.placement)?)
            .execute(&mut *conn)
            .await?;
        }
    }
    Ok(())
}

/// Groups the Project created since the View go; by now they hold no
/// session. A group with goals stays until the user removes them.
async fn drop_created_groups(
    conn: &mut SqliteConnection,
    desired: &ProjectDesired,
    applied: &ProjectBasis,
) -> Result<()> {
    for group in &desired.groups {
        if applied.groups.iter().any(|was| was.id == group.id) {
            continue;
        }
        if has_goals(conn, group.id).await? {
            return Err(LibraryError::InvalidInput(format!(
                "group {} is new since the View and has goals; remove them before discarding",
                group.name.as_str()
            )));
        }
        sqlx::query("DELETE FROM project_groups WHERE id = ?1")
            .bind(group.id.to_string())
            .execute(&mut *conn)
            .await?;
    }
    Ok(())
}

/// Every basis group's name, mosaic mark and position, in two passes so
/// two groups can swap names. A panel group with goals stays a panel.
async fn restore_group_names(
    conn: &mut SqliteConnection,
    desired: &ProjectDesired,
    applied: &ProjectBasis,
) -> Result<()> {
    for group in &applied.groups {
        sqlx::query("UPDATE project_groups SET name_key = ?2 WHERE id = ?1")
            .bind(group.id.to_string())
            .bind(placeholder_key(group.id))
            .execute(&mut *conn)
            .await?;
    }
    for group in &applied.groups {
        let marked = desired.groups.iter().any(|held| held.id == group.id && held.panel);
        if marked && !group.panel && has_goals(conn, group.id).await? {
            return Err(LibraryError::InvalidInput(format!(
                "group {} has panel goals and stays a panel; remove them before discarding",
                group.name.as_str()
            )));
        }
        sqlx::query(
            "UPDATE project_groups SET name = ?2, name_key = ?3, panel = ?4, position = ?5 \
             WHERE id = ?1",
        )
        .bind(group.id.to_string())
        .bind(group.name.as_str())
        .bind(group.name.key())
        .bind(i64::from(group.panel))
        .bind(i64::from(group.position))
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

/// A session the Project removed joins again through the admission rule,
/// at the current basis, with the frames and choices the View was built
/// from. A Library change since (a regroup, a review reopened, an
/// association or calibration that no longer admits it) refuses it: that
/// is fixed at its source.
async fn rejoin(
    conn: &mut SqliteConnection,
    project: Uuid,
    group: Uuid,
    session: &BasisSession,
) -> Result<()> {
    let basis =
        admission::require_admission(conn, project, group, session.session_id, None).await?;
    insert_member(
        conn,
        project,
        session.session_id,
        group,
        session.placement,
        session.target_id,
        &basis,
    )
    .await?;
    insert_basis_captures(conn, project, session).await
}

async fn insert_basis_captures(
    conn: &mut SqliteConnection,
    project: Uuid,
    session: &BasisSession,
) -> Result<()> {
    for capture in &session.captures {
        insert_capture(
            conn,
            project,
            session.session_id,
            capture.capture_key,
            &capture.copies,
            capture.inclusion,
            capture.quality_when_added,
        )
        .await?;
    }
    Ok(())
}

/// A held session's frames as the basis held them: each choice back, or,
/// when the session was removed and added again since, its basis captures
/// in place of the ones it was added again with.
async fn restore_frames(
    conn: &mut SqliteConnection,
    project: Uuid,
    session: &BasisSession,
    held: &[ProjectCapture],
) -> Result<()> {
    let current: Vec<&ProjectCapture> =
        held.iter().filter(|capture| capture.session_id == session.session_id).collect();
    let same = current.len() == session.captures.len()
        && session.captures.iter().all(|was| {
            current.iter().any(|capture| {
                capture.capture_key == was.capture_key
                    && capture.copies == was.copies
                    && capture.quality_when_added == was.quality_when_added
            })
        });
    if !same {
        sqlx::query("DELETE FROM project_captures WHERE project_id = ?1 AND session_id = ?2")
            .bind(project.to_string())
            .bind(session.session_id.to_string())
            .execute(&mut *conn)
            .await?;
        return insert_basis_captures(conn, project, session).await;
    }
    restore_choices(conn, project, session, &current).await
}

/// Each of the `current` captures back to the choice the basis `session`
/// held it with.
async fn restore_choices(
    conn: &mut SqliteConnection,
    project: Uuid,
    session: &BasisSession,
    current: &[&ProjectCapture],
) -> Result<()> {
    for was in &session.captures {
        if current
            .iter()
            .any(|now| now.capture_key == was.capture_key && now.inclusion != was.inclusion)
        {
            write_inclusion(conn, project, was.capture_key, was.inclusion).await?;
        }
    }
    Ok(())
}

/// The input mode and keyword names the View was built with. Keywords the
/// Project resolves to the basis's stay as they are; otherwise the Project
/// follows Settings again when Settings give the basis's names, and keeps
/// the basis's names as its own when they don't.
async fn restore_settings(
    conn: &mut SqliteConnection,
    desired: &ProjectDesired,
    applied: &ProjectBasis,
) -> Result<()> {
    let project = desired.project_id.to_string();
    sqlx::query("UPDATE projects SET view_mode = ?2 WHERE id = ?1")
        .bind(&project)
        .bind(to_text(&applied.mode)?)
        .execute(&mut *conn)
        .await?;
    let follow = read_workflow_settings(conn).await?.0.keywords;
    if *desired.settings.keywords.as_ref().unwrap_or(&follow) == applied.keywords {
        return Ok(());
    }
    let own = (follow != applied.keywords).then_some(&applied.keywords);
    sqlx::query("UPDATE projects SET group_keyword = ?2, panel_keyword = ?3 WHERE id = ?1")
        .bind(&project)
        .bind(own.map(|keywords| keywords.group().as_str()))
        .bind(own.map(|keywords| keywords.panel().as_str()))
        .execute(&mut *conn)
        .await?;
    Ok(())
}

// ── Suggestions and held frames, for progress too ────────────────────────────

async fn suggestions(conn: &mut SqliteConnection, id: Uuid) -> Result<Vec<ProjectSuggestion>> {
    Ok(suggested(conn, id)
        .await?
        .into_iter()
        .map(|(candidate, admission)| ProjectSuggestion {
            session_id: candidate.session_id,
            subject_id: candidate.subject_id,
            rig_id: candidate.rig_id,
            basis: AdmissionBasis {
                grouping_revision: admission.intake.grouping_revision,
                calibration_generation: admission.calibration.generation,
            },
            blockers: admission.blockers,
        })
        .collect())
}

/// The Project's suggestions with their admission (PRJ-FR-09): current
/// Ready sessions it doesn't hold whose confirmed Target is a subject and
/// whose confirmed rig is on its rig list, with their live frames. An open
/// Project only; settled or not.
pub async fn suggested(
    conn: &mut SqliteConnection,
    id: Uuid,
) -> Result<Vec<(ProjectCandidate, SessionAdmission)>> {
    if !read_lifecycle(conn, id).await?.is_open() {
        return Ok(Vec::new());
    }
    let held: Vec<String> =
        sqlx::query_scalar("SELECT session_id FROM project_sessions WHERE project_id = ?1")
            .bind(id.to_string())
            .fetch_all(&mut *conn)
            .await?;
    let held: BTreeSet<Uuid> = held.iter().map(|id| parse_uuid(id)).collect::<Result<_>>()?;
    let mut suggested = Vec::new();
    for candidate in candidates(conn, id).await? {
        if held.contains(&candidate.session_id) {
            continue;
        }
        let admission = admission::read_admission(conn, candidate.session_id).await?;
        if admission.intake.superseded || admission.intake.readiness() != SessionReadiness::Ready {
            continue;
        }
        suggested.push((candidate, admission));
    }
    Ok(suggested)
}

/// A held capture with where the Project holds it.
pub struct HeldCapture {
    pub capture: ProjectCapture,
    pub group_id: Uuid,
    /// The Project subject of the session's Target when it counts as confirmed,
    /// else the Target it joined on, so a Library association to a Target the
    /// Project lacks keeps it counting (PRJ-AC-26); `None` once neither is a subject.
    pub subject_id: Option<Uuid>,
}

/// Every capture the Project holds, with its group and subject.
pub async fn held_captures(conn: &mut SqliteConnection, id: Uuid) -> Result<Vec<HeldCapture>> {
    let project = id.to_string();
    let mut places: BTreeMap<Uuid, (Uuid, Option<Uuid>)> = BTreeMap::new();
    for row in sqlx::query(
        "SELECT ps.session_id, ps.group_id, a.state AS target_state, \
         a.evidence AS target_evidence, associated_subject.id AS associated_subject_id, \
         joined_subject.id AS joined_subject_id \
         FROM project_sessions ps LEFT JOIN associations a \
         ON a.session_id = ps.session_id AND a.kind = 'target' \
         LEFT JOIN project_subjects associated_subject \
         ON associated_subject.project_id = ps.project_id AND associated_subject.target_id = a.target_id \
         LEFT JOIN project_subjects joined_subject \
         ON joined_subject.project_id = ps.project_id AND joined_subject.target_id = ps.target_id \
         WHERE ps.project_id = ?1",
    )
    .bind(&project)
    .fetch_all(&mut *conn)
    .await?
    {
        let associated_subject: Option<String> = row.try_get("associated_subject_id")?;
        let joined_subject: Option<String> = row.try_get("joined_subject_id")?;
        let subject_id = if let Some(state) = row.try_get::<Option<String>, _>("target_state")? {
            let state: AssociationState = from_text(&state)?;
            let evidence: Vec<EvidenceItem> =
                from_json(&row.try_get::<String, _>("target_evidence")?)?;
            if counts_as_confirmed(&state, &evidence) {
                associated_subject.or(joined_subject)
            } else {
                joined_subject
            }
        } else {
            joined_subject
        };
        places.insert(
            parse_uuid(&row.try_get::<String, _>("session_id")?)?,
            (
                parse_uuid(&row.try_get::<String, _>("group_id")?)?,
                subject_id.as_deref().map(parse_uuid).transpose()?,
            ),
        );
    }
    let mut held = Vec::new();
    for (session, captures) in read_captures(conn, id).await? {
        let Some(&(group_id, subject_id)) = places.get(&session) else { continue };
        held.extend(captures.into_iter().map(|capture| HeldCapture {
            capture,
            group_id,
            subject_id,
        }));
    }
    Ok(held)
}
