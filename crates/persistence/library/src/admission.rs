// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The F4 admission contract (spec 064 LIB-FR-20/23, 065 PRJ-FR-08/09; D-W78,
//! D-W105, D-W107): a session's readiness and calibration as one catalog
//! snapshot reads them, and the rule every membership-add transaction applies
//! before it writes. Only a current, Ready session with every calibration
//! kind pinned or declined joins a group on its own rig of an open Project,
//! at the basis it was reviewed on. The rule itself is
//! [`platevault_model::admit_session`]; `project_inputs.sql` refuses the same
//! rows. "Needs calibration" is a separate queue that holds any session whose
//! calibration is unsettled, Ready or not: this contract only gates joining.

use platevault_model::{
    admit_session, counts_as_confirmed, session_blockers, AdmissionBasis, ApplicableQuality,
    AssociationKind, InputKind, LibraryError, PinState, ProjectLifecycle, SessionAdmission,
    SessionCalibration, SessionIntake,
};
use sqlx::sqlite::SqliteConnection;
use sqlx::Row;
use uuid::Uuid;

use super::{
    calibration, from_json, from_text, load_associations, load_session_row, parse_uuid, revision,
    scoped_members, successors_of, CaptureView, Catalog, Members, Result,
};

impl Catalog {
    /// One session's readiness and calibration for every Project, with the
    /// blockers that keep it out of all of them: superseded, not Ready, or
    /// calibration not settled. Suggestions show these blockers. Reads one
    /// snapshot and writes nothing.
    ///
    /// # Errors
    /// `NotFound` for an unknown session; `PersistenceFailure` for a corrupt
    /// record.
    pub async fn session_admission(&self, session_id: Uuid) -> Result<SessionAdmission> {
        let mut conn = self.reader().await?;
        read_admission(&mut conn, session_id).await
    }

    /// The full admission rule for adding `session_id` to `group_id` of
    /// `project_id`, read-only: the basis a later add must still match.
    ///
    /// # Errors
    /// `NotFound` for an unknown Project, group of that Project, or session;
    /// `Conflict` with the successors for a superseded session, and for a
    /// current basis other than `expected`; `InvalidInput` naming every other
    /// blocker.
    pub async fn check_admission(
        &self,
        project_id: Uuid,
        group_id: Uuid,
        session_id: Uuid,
        expected: Option<&AdmissionBasis>,
    ) -> Result<AdmissionBasis> {
        let mut conn = self.reader().await?;
        require_admission(&mut conn, project_id, group_id, session_id, expected).await
    }
}

/// A session's readiness, calibration, pin health and blockers in the
/// caller's snapshot.
///
/// # Errors
/// `NotFound` for an unknown session; `PersistenceFailure` for a corrupt
/// record.
pub async fn read_admission(
    conn: &mut SqliteConnection,
    session_id: Uuid,
) -> Result<SessionAdmission> {
    let intake = read_intake(conn, session_id).await?;
    let calibration = read_calibration(conn, session_id).await?;
    let health = calibration::read_health(conn, &calibration).await?;
    let blockers = session_blockers(&intake, &calibration, &health);
    Ok(SessionAdmission { intake, calibration, health, blockers })
}

/// The admission rule inside the caller's transaction. A membership writer
/// calls it before inserting into `project_sessions`, with the basis the user
/// reviewed, and records the basis it returns.
///
/// # Errors
/// `NotFound` for an unknown Project, group of that Project, or session;
/// `Conflict` with the successors for a superseded session, and for a current
/// basis other than `expected`; `InvalidInput` naming every other blocker.
pub async fn require_admission(
    conn: &mut SqliteConnection,
    project_id: Uuid,
    group_id: Uuid,
    session_id: Uuid,
    expected: Option<&AdmissionBasis>,
) -> Result<AdmissionBasis> {
    let lifecycle: Option<String> =
        sqlx::query_scalar("SELECT lifecycle FROM projects WHERE id = ?1")
            .bind(project_id.to_string())
            .fetch_optional(&mut *conn)
            .await?;
    let lifecycle: ProjectLifecycle = from_text(
        &lifecycle.ok_or_else(|| LibraryError::NotFound(format!("project {project_id}")))?,
    )?;
    let group_rig: Option<String> =
        sqlx::query_scalar("SELECT rig_id FROM project_groups WHERE id = ?1 AND project_id = ?2")
            .bind(group_id.to_string())
            .bind(project_id.to_string())
            .fetch_optional(&mut *conn)
            .await?;
    let group_rig = parse_uuid(&group_rig.ok_or_else(|| {
        LibraryError::NotFound(format!("group {group_id} of project {project_id}"))
    })?)?;
    let SessionAdmission { intake, calibration, health, .. } =
        read_admission(conn, session_id).await?;
    if intake.superseded {
        let row = load_session_row(conn, session_id).await?;
        return Err(LibraryError::Conflict {
            id: session_id,
            current: intake.grouping_revision,
            successors: successors_of(conn, &row).await?,
        });
    }
    let basis = admit_session(lifecycle, group_rig, &intake, &calibration, &health)?;
    if let Some(expected) = expected.filter(|expected| **expected != basis) {
        let current = if expected.grouping_revision == basis.grouping_revision {
            basis.calibration_generation
        } else {
            basis.grouping_revision
        };
        return Err(LibraryError::Conflict { id: session_id, current, successors: Vec::new() });
    }
    Ok(basis)
}

/// The session's intake facts in the caller's snapshot.
pub async fn read_intake(conn: &mut SqliteConnection, session_id: Uuid) -> Result<SessionIntake> {
    let mut row = load_session_row(conn, session_id).await?;
    let grouping_revision = row.session.grouping_revision;
    let superseded = row.superseded_by.is_some();
    // A Target associated by agreeing evidence counts as confirmed (D-W124).
    let target_confirmed = load_associations(conn, session_id).await?.iter().any(|association| {
        association.kind == AssociationKind::Target
            && association.subject_id.is_some()
            && counts_as_confirmed(&association.state, &association.evidence)
    });
    let rig_id = calibration::confirmed_equipment(conn, session_id).await?;
    let reviewed: Option<i64> =
        sqlx::query_scalar("SELECT grouping_revision FROM session_reviews WHERE session_id = ?1")
            .bind(session_id.to_string())
            .fetch_optional(&mut *conn)
            .await?;
    let review_finished = reviewed.map(revision).transpose()? == Some(grouping_revision);
    let assets = scoped_members(conn, &mut row, Members::Live).await?;
    let view = CaptureView::read(conn, &[session_id], &assets).await?;
    let (mut unreviewed, mut changed) = (0_usize, 0_usize);
    for member in view.members(&assets) {
        match member.applicable_quality {
            ApplicableQuality::Unreviewed => unreviewed += 1,
            ApplicableQuality::ChangedContent { .. } => changed += 1,
            _ => {}
        }
    }
    Ok(SessionIntake {
        session_id,
        grouping_revision,
        superseded,
        target_confirmed,
        rig_id,
        review_finished,
        unreviewed_frames: u64::try_from(unreviewed).unwrap_or(u64::MAX),
        changed_frames: u64::try_from(changed).unwrap_or(u64::MAX),
    })
}

/// The session's calibration record; a session without one reads every kind
/// unresolved at generation 0.
pub async fn read_calibration(
    conn: &mut SqliteConnection,
    session_id: Uuid,
) -> Result<SessionCalibration> {
    let mut calibration = SessionCalibration::unresolved(session_id);
    let Some(row) = sqlx::query(
        "SELECT generation, matching_pending FROM session_calibration WHERE session_id = ?1",
    )
    .bind(session_id.to_string())
    .fetch_optional(&mut *conn)
    .await?
    else {
        return Ok(calibration);
    };
    calibration.generation = revision(row.try_get("generation")?)?;
    calibration.matching_pending = row.try_get::<i64, _>("matching_pending")? == 1;
    let kinds =
        sqlx::query("SELECT kind, pin FROM session_calibration_kinds WHERE session_id = ?1")
            .bind(session_id.to_string())
            .fetch_all(&mut *conn)
            .await?;
    for kind in kinds {
        let pin: PinState = from_json(&kind.try_get::<String, _>("pin")?)?;
        let slot = match from_text::<InputKind>(&kind.try_get::<String, _>("kind")?)? {
            InputKind::Bias => &mut calibration.bias,
            InputKind::Dark => &mut calibration.dark,
            InputKind::Flat => &mut calibration.flat,
        };
        *slot = pin;
    }
    Ok(calibration)
}
