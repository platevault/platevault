// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Project records (spec 065): Tier 1 user decisions on the catalog's single
//! serialized writer. Every write is one `BEGIN IMMEDIATE` transaction that
//! checks the expected Project revision and every referenced record, writes only
//! the Project tables and adds one to the revision. Nothing here reads or writes
//! an image file or changes a library record.

use std::collections::{BTreeSet, HashMap};

use platevault_model::{
    ChecklistItem, ChecklistItemInput, ChecklistKind, ExpectedAsset, ExpectedSession, LibraryError,
    LinkState, PanelInput, Project, ProjectInput, ProjectPanel, ProjectQuery, ProjectRejection,
    ProjectSessionLink, ProjectSummary, ProjectTarget, Revision, SessionLinkInput, SkyCoordinates,
    TargetFraming,
};
use sqlx::sqlite::{SqliteConnection, SqliteRow};
use sqlx::{Connection, Row};
use uuid::Uuid;

use super::{
    check_expected_assets, check_expected_sessions, conflict, db_revision, from_json,
    load_equipment, load_session_row, load_target, now, parse_uuid, require_revision, revision,
    successors_of, to_json, Catalog, Result, MAX_PAGE,
};

impl Catalog {
    /// Create a Project at revision 1, snapshotting each framing Target at the
    /// revision the user confirmed. Writes only Project rows.
    ///
    /// # Errors
    /// `InvalidInput` for invalid fields; `NotFound` for an unsaved Target or
    /// unknown equipment; `Conflict` naming a Target whose revision is not the
    /// expected one. Nothing is written on failure.
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
            .bind(notes(input))
            .bind(&at)
            .execute(&mut *conn)
            .await?;
            write_fields(conn, id, input).await?;
            load_project(conn, id).await?
        });
        Ok(project)
    }

    /// Replace a Project's name, notes, framing, panels and equipment. A framing
    /// Target given at its confirmed revision keeps its snapshot; one given at its
    /// current revision is confirmed anew. Writes no link, checklist or library
    /// record.
    ///
    /// # Errors
    /// `Conflict` with the current revision for a stale Project or Target
    /// revision; `NotFound` for an unknown Project, Target, equipment or panel id;
    /// `InvalidInput` for invalid fields, for removing a panel that holds links
    /// and for removing the last panel under a panel-coverage item.
    pub async fn update_project(
        &self,
        id: Uuid,
        expected: Revision,
        input: &ProjectInput,
    ) -> Result<Project> {
        input.validate()?;
        let project = write_txn!(self, |conn| {
            let next = next_revision(conn, id, expected).await?;
            sqlx::query("UPDATE projects SET name = ?2, notes = ?3 WHERE id = ?1")
                .bind(id.to_string())
                .bind(input.name.trim())
                .bind(notes(input))
                .execute(&mut *conn)
                .await?;
            write_fields(conn, id, input).await?;
            if input.panels.is_empty() && has_panel_coverage(conn, id).await? {
                return Err(LibraryError::InvalidInput(format!(
                    "project {id} keeps a panel_coverage checklist item, which needs panels"
                )));
            }
            commit_revision(conn, id, next).await?;
            load_project(conn, id).await?
        });
        Ok(project)
    }

    /// Set the ordered checklist. Items without `id` get one; listed ids keep
    /// theirs; omitted items are removed.
    ///
    /// # Errors
    /// `Conflict` for a stale Project revision; `NotFound` for an unknown
    /// Project, item id or equipment; `InvalidInput` for an invalid criterion or
    /// an item id given twice.
    pub async fn set_checklist(
        &self,
        id: Uuid,
        expected: Revision,
        items: &[ChecklistItemInput],
    ) -> Result<Project> {
        let project = write_txn!(self, |conn| {
            let next = next_revision(conn, id, expected).await?;
            let panels = load_panels(conn, id).await?;
            let kept = item_ids(conn, id).await?;
            let mut named = BTreeSet::new();
            for item in items {
                item.validate(&panels)?;
                if let Some(item_id) = item.id {
                    if !named.insert(item_id) {
                        return Err(LibraryError::InvalidInput(format!(
                            "checklist items name item {item_id} twice"
                        )));
                    }
                    if !kept.contains(&item_id) {
                        return Err(LibraryError::NotFound(format!(
                            "checklist item {item_id} of project {id}"
                        )));
                    }
                }
                if let ChecklistKind::Equipment { equipment_id } = &item.criterion {
                    load_equipment(conn, *equipment_id).await?;
                }
            }
            sqlx::query("DELETE FROM project_checklist WHERE project_id = ?1")
                .bind(id.to_string())
                .execute(&mut *conn)
                .await?;
            for (position, item) in (0_i64..).zip(items) {
                insert_item(conn, id, position, item).await?;
            }
            commit_revision(conn, id, next).await?;
            load_project(conn, id).await?
        });
        Ok(project)
    }

    /// Link sessions explicitly, each through the exact session record the user
    /// saw; linking a linked session reassigns its panel. Nothing is linked by
    /// proximity, OBJECT or name.
    ///
    /// # Errors
    /// `Conflict` for a stale Project revision, or naming a session with its
    /// current revision, and its lineage successors when a correction superseded
    /// it; `NotFound` for an unknown Project, session or panel; `InvalidInput`
    /// for empty or repeated sessions.
    pub async fn link_sessions(
        &self,
        id: Uuid,
        expected: Revision,
        links: &[SessionLinkInput],
    ) -> Result<Project> {
        let sessions: Vec<ExpectedSession> =
            links.iter().map(|link| link.session.clone()).collect();
        let project = write_txn!(self, |conn| {
            let next = next_revision(conn, id, expected).await?;
            let panels: BTreeSet<Uuid> =
                load_panels(conn, id).await?.into_iter().map(|panel| panel.id).collect();
            if let Some(panel) =
                links.iter().filter_map(|link| link.panel_id).find(|panel| !panels.contains(panel))
            {
                return Err(LibraryError::NotFound(format!("panel {panel} of project {id}")));
            }
            let current = check_expected_sessions(conn, &sessions).await?;
            let at = now()?;
            for (link, session) in links.iter().zip(&current) {
                sqlx::query(
                    "INSERT INTO project_session_links \
                     (project_id, session_id, panel_id, grouping_revision, linked_at) \
                     VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (project_id, session_id) DO UPDATE \
                     SET panel_id = excluded.panel_id, \
                     grouping_revision = excluded.grouping_revision, linked_at = excluded.linked_at",
                )
                .bind(id.to_string())
                .bind(session.id.to_string())
                .bind(link.panel_id.map(|panel| panel.to_string()))
                .bind(db_revision(session.grouping_revision)?)
                .bind(&at)
                .execute(&mut *conn)
                .await?;
            }
            commit_revision(conn, id, next).await?;
            load_project(conn, id).await?
        });
        Ok(project)
    }

    /// Remove links; every rejection decision stays.
    ///
    /// # Errors
    /// `Conflict` for a stale Project revision; `NotFound` for an unknown Project
    /// or a session that is not linked; `InvalidInput` for empty or repeated ids.
    pub async fn unlink_sessions(
        &self,
        id: Uuid,
        expected: Revision,
        sessions: &[Uuid],
    ) -> Result<Project> {
        let unique: BTreeSet<Uuid> = sessions.iter().copied().collect();
        if sessions.is_empty() || unique.len() != sessions.len() {
            return Err(LibraryError::InvalidInput(
                "sessions to unlink must be unique and non-empty".into(),
            ));
        }
        let project = write_txn!(self, |conn| {
            let next = next_revision(conn, id, expected).await?;
            for session in sessions {
                let removed = sqlx::query(
                    "DELETE FROM project_session_links WHERE project_id = ?1 AND session_id = ?2",
                )
                .bind(id.to_string())
                .bind(session.to_string())
                .execute(&mut *conn)
                .await?;
                if removed.rows_affected() == 0 {
                    return Err(LibraryError::NotFound(format!(
                        "session {session} is not linked to project {id}"
                    )));
                }
            }
            commit_revision(conn, id, next).await?;
            load_project(conn, id).await?
        });
        Ok(project)
    }

    /// Record one Project rejection decision per asset, or withdraw it with
    /// `rejected` false. A rejection of any copy applies to its logical capture
    /// for this Project only: library quality, totals and View membership are
    /// unchanged and no source is read.
    ///
    /// # Errors
    /// `Conflict` for a stale Project revision or a changed asset; `NotFound` for
    /// an unknown Project or asset; `InvalidInput` for a copy of a retired
    /// location or empty or repeated assets.
    pub async fn set_project_rejection(
        &self,
        id: Uuid,
        expected: Revision,
        assets: &[ExpectedAsset],
        rejected: bool,
    ) -> Result<Project> {
        let project = write_txn!(self, |conn| {
            let next = next_revision(conn, id, expected).await?;
            let decided = check_expected_assets(conn, assets).await?;
            let at = now()?;
            for asset in &decided {
                sqlx::query(
                    "INSERT INTO project_rejections \
                     (project_id, asset_id, rejected, fingerprint, project_revision, decided_at) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                )
                .bind(id.to_string())
                .bind(asset.id.to_string())
                .bind(i64::from(rejected))
                .bind(to_json(&asset.fingerprint)?)
                .bind(db_revision(next)?)
                .bind(&at)
                .execute(&mut *conn)
                .await?;
            }
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

    /// Project summaries by name, optionally only those framing a Target. No
    /// progress is computed.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn list_projects(&self, query: &ProjectQuery) -> Result<Vec<ProjectSummary>> {
        let mut conn = self.reader().await?;
        let rows = sqlx::query(
            "SELECT p.id, p.name, p.revision, \
             (SELECT count(*) FROM project_panels x WHERE x.project_id = p.id) AS panels, \
             (SELECT count(*) FROM project_session_links x WHERE x.project_id = p.id) AS links, \
             (SELECT count(*) FROM project_checklist x WHERE x.project_id = p.id) AS items \
             FROM projects p WHERE ?1 IS NULL OR EXISTS (SELECT 1 FROM project_targets t \
             WHERE t.project_id = p.id AND t.target_id = ?1) \
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
            let target_designations = sqlx::query_scalar(
                "SELECT designation FROM project_targets WHERE project_id = ?1 ORDER BY position",
            )
            .bind(id.to_string())
            .fetch_all(&mut *conn)
            .await?;
            summaries.push(ProjectSummary {
                id,
                name: row.try_get("name")?,
                revision: revision(row.try_get("revision")?)?,
                target_designations,
                panel_count: count(row, "panels")?,
                linked_session_count: count(row, "links")?,
                checklist_item_count: count(row, "items")?,
            });
        }
        Ok(summaries)
    }
}

/// Notes as given; blank notes are no notes.
fn notes(input: &ProjectInput) -> Option<&str> {
    input.notes.as_deref().filter(|notes| !notes.trim().is_empty())
}

fn count(row: &SqliteRow, column: &str) -> Result<u64> {
    let value: i64 = row.try_get(column)?;
    u64::try_from(value)
        .map_err(|_| LibraryError::PersistenceFailure(format!("corrupt {column} count {value}")))
}

/// The revision a write of Project `id` commits, after checking `expected`.
async fn next_revision(
    conn: &mut SqliteConnection,
    id: Uuid,
    expected: Revision,
) -> Result<Revision> {
    let current: i64 = sqlx::query_scalar("SELECT revision FROM projects WHERE id = ?1")
        .bind(id.to_string())
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| LibraryError::NotFound(format!("project {id}")))?;
    let current = revision(current)?;
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

/// Framing, panels and equipment of a create or update.
async fn write_fields(conn: &mut SqliteConnection, id: Uuid, input: &ProjectInput) -> Result<()> {
    write_framing(conn, id, &input.targets).await?;
    write_panels(conn, id, &input.panels).await?;
    sqlx::query("DELETE FROM project_equipment WHERE project_id = ?1")
        .bind(id.to_string())
        .execute(&mut *conn)
        .await?;
    for (position, equipment_id) in (0_i64..).zip(&input.equipment_ids) {
        load_equipment(conn, *equipment_id).await?;
        sqlx::query(
            "INSERT INTO project_equipment (project_id, equipment_id, position) VALUES (?1, ?2, ?3)",
        )
        .bind(id.to_string())
        .bind(equipment_id.to_string())
        .bind(position)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

/// A Target already framed at the given revision keeps its snapshot; any other
/// must be saved at exactly the expected revision and is snapshotted now.
async fn write_framing(
    conn: &mut SqliteConnection,
    id: Uuid,
    targets: &[TargetFraming],
) -> Result<()> {
    let stored: HashMap<Uuid, ProjectTarget> = load_targets(conn, id)
        .await?
        .into_iter()
        .map(|target| (target.target_id, target))
        .collect();
    sqlx::query("DELETE FROM project_targets WHERE project_id = ?1")
        .bind(id.to_string())
        .execute(&mut *conn)
        .await?;
    for (position, framing) in (0_i64..).zip(targets) {
        let snapshot = match stored.get(&framing.target_id) {
            Some(kept) if kept.confirmed_revision == framing.expected_revision => kept.clone(),
            _ => {
                let record = load_target(conn, framing.target_id).await?;
                if record.decision_revision != framing.expected_revision {
                    return Err(conflict(framing.target_id, record.decision_revision));
                }
                ProjectTarget {
                    target_id: framing.target_id,
                    confirmed_revision: record.decision_revision,
                    designation: record.candidate.designation,
                    coordinates: record.candidate.coordinates,
                    provenance: record.candidate.provenance,
                    current_revision: record.decision_revision,
                    framing_changed: false,
                }
            }
        };
        let coordinates = snapshot.coordinates.as_ref();
        sqlx::query(
            "INSERT INTO project_targets (project_id, target_id, position, confirmed_revision, \
             designation, ra_deg, dec_deg, frame, provenance) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        )
        .bind(id.to_string())
        .bind(snapshot.target_id.to_string())
        .bind(position)
        .bind(db_revision(snapshot.confirmed_revision)?)
        .bind(&snapshot.designation)
        .bind(coordinates.map(|value| value.ra_deg))
        .bind(coordinates.map(|value| value.dec_deg))
        .bind(coordinates.map(|value| value.frame.as_str()))
        .bind(to_json(&snapshot.provenance)?)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

/// Keep listed panels by id, create unlisted ones and remove the rest, refusing
/// to remove a panel that holds links.
async fn write_panels(conn: &mut SqliteConnection, id: Uuid, panels: &[PanelInput]) -> Result<()> {
    let stored = load_panels(conn, id).await?;
    let listed: BTreeSet<Uuid> = panels.iter().filter_map(|panel| panel.id).collect();
    if let Some(unknown) = listed.iter().find(|panel| !stored.iter().any(|kept| kept.id == **panel))
    {
        return Err(LibraryError::NotFound(format!("panel {unknown} of project {id}")));
    }
    for removed in stored.iter().filter(|panel| !listed.contains(&panel.id)) {
        let links: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM project_session_links WHERE project_id = ?1 AND panel_id = ?2",
        )
        .bind(id.to_string())
        .bind(removed.id.to_string())
        .fetch_one(&mut *conn)
        .await?;
        if links > 0 {
            return Err(LibraryError::InvalidInput(format!(
                "panel {} ({:?}) of project {id} has {links} assigned links; unassign them \
                 before removing it",
                removed.id, removed.name
            )));
        }
        sqlx::query("DELETE FROM project_panels WHERE id = ?1")
            .bind(removed.id.to_string())
            .execute(&mut *conn)
            .await?;
    }
    for (position, panel) in (0_i64..).zip(panels) {
        let panel_id = panel.id.unwrap_or_else(Uuid::new_v4);
        sqlx::query(
            "INSERT INTO project_panels (id, project_id, position, name, ra_deg, dec_deg, \
             width_deg, height_deg, position_angle_deg) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) \
             ON CONFLICT (id) DO UPDATE SET position = excluded.position, name = excluded.name, \
             ra_deg = excluded.ra_deg, dec_deg = excluded.dec_deg, width_deg = excluded.width_deg, \
             height_deg = excluded.height_deg, position_angle_deg = excluded.position_angle_deg",
        )
        .bind(panel_id.to_string())
        .bind(id.to_string())
        .bind(position)
        .bind(panel.name.trim())
        .bind(panel.ra_deg)
        .bind(panel.dec_deg)
        .bind(panel.width_deg)
        .bind(panel.height_deg)
        .bind(panel.position_angle_deg)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

async fn has_panel_coverage(conn: &mut SqliteConnection, id: Uuid) -> Result<bool> {
    let found: i64 = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM project_checklist WHERE project_id = ?1 \
         AND kind = 'panel_coverage')",
    )
    .bind(id.to_string())
    .fetch_one(&mut *conn)
    .await?;
    Ok(found == 1)
}

async fn item_ids(conn: &mut SqliteConnection, id: Uuid) -> Result<BTreeSet<Uuid>> {
    let ids: Vec<String> =
        sqlx::query_scalar("SELECT id FROM project_checklist WHERE project_id = ?1")
            .bind(id.to_string())
            .fetch_all(&mut *conn)
            .await?;
    ids.iter().map(|item| parse_uuid(item)).collect()
}

const fn kind_name(criterion: &ChecklistKind) -> &'static str {
    match criterion {
        ChecklistKind::Integration { .. } => "integration",
        ChecklistKind::FrameCount { .. } => "frame_count",
        ChecklistKind::ExposurePreference { .. } => "exposure_preference",
        ChecklistKind::PanelCoverage => "panel_coverage",
        ChecklistKind::Equipment { .. } => "equipment",
        ChecklistKind::MissingCalibration { .. } => "missing_calibration",
    }
}

async fn insert_item(
    conn: &mut SqliteConnection,
    id: Uuid,
    position: i64,
    item: &ChecklistItemInput,
) -> Result<()> {
    let equipment = match &item.criterion {
        ChecklistKind::Equipment { equipment_id } => Some(equipment_id.to_string()),
        _ => None,
    };
    sqlx::query(
        "INSERT INTO project_checklist (id, project_id, position, kind, criterion, equipment_id) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )
    .bind(item.id.unwrap_or_else(Uuid::new_v4).to_string())
    .bind(id.to_string())
    .bind(position)
    .bind(kind_name(&item.criterion))
    .bind(to_json(&item.criterion)?)
    .bind(equipment)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async fn load_project(conn: &mut SqliteConnection, id: Uuid) -> Result<Project> {
    let row = sqlx::query(
        "SELECT name, notes, revision, created_at, updated_at FROM projects WHERE id = ?1",
    )
    .bind(id.to_string())
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| LibraryError::NotFound(format!("project {id}")))?;
    let equipment: Vec<String> = sqlx::query_scalar(
        "SELECT equipment_id FROM project_equipment WHERE project_id = ?1 ORDER BY position",
    )
    .bind(id.to_string())
    .fetch_all(&mut *conn)
    .await?;
    Ok(Project {
        id,
        name: row.try_get("name")?,
        notes: row.try_get("notes")?,
        revision: revision(row.try_get("revision")?)?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
        targets: load_targets(conn, id).await?,
        panels: load_panels(conn, id).await?,
        equipment_ids: equipment.iter().map(|item| parse_uuid(item)).collect::<Result<_>>()?,
        checklist: load_checklist(conn, id).await?,
        links: load_links(conn, id).await?,
        rejections: load_rejections(conn, id).await?,
    })
}

async fn load_targets(conn: &mut SqliteConnection, id: Uuid) -> Result<Vec<ProjectTarget>> {
    let rows = sqlx::query(
        "SELECT f.target_id, f.confirmed_revision, f.designation, f.ra_deg, f.dec_deg, f.frame, \
         f.provenance, t.decision_revision AS current_revision FROM project_targets f \
         JOIN targets t ON t.id = f.target_id WHERE f.project_id = ?1 ORDER BY f.position",
    )
    .bind(id.to_string())
    .fetch_all(&mut *conn)
    .await?;
    rows.iter()
        .map(|row| {
            let coordinates = match (
                row.try_get::<Option<f64>, _>("ra_deg")?,
                row.try_get::<Option<f64>, _>("dec_deg")?,
                row.try_get::<Option<String>, _>("frame")?,
            ) {
                (Some(ra_deg), Some(dec_deg), Some(frame)) => {
                    Some(SkyCoordinates { ra_deg, dec_deg, frame })
                }
                _ => None,
            };
            let confirmed_revision = revision(row.try_get("confirmed_revision")?)?;
            let current_revision = revision(row.try_get("current_revision")?)?;
            Ok(ProjectTarget {
                target_id: parse_uuid(&row.try_get::<String, _>("target_id")?)?,
                confirmed_revision,
                designation: row.try_get("designation")?,
                coordinates,
                provenance: from_json(&row.try_get::<String, _>("provenance")?)?,
                current_revision,
                framing_changed: current_revision != confirmed_revision,
            })
        })
        .collect()
}

async fn load_panels(conn: &mut SqliteConnection, id: Uuid) -> Result<Vec<ProjectPanel>> {
    let rows = sqlx::query(
        "SELECT id, name, ra_deg, dec_deg, width_deg, height_deg, position_angle_deg \
         FROM project_panels WHERE project_id = ?1 ORDER BY position",
    )
    .bind(id.to_string())
    .fetch_all(&mut *conn)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(ProjectPanel {
                id: parse_uuid(&row.try_get::<String, _>("id")?)?,
                name: row.try_get("name")?,
                ra_deg: row.try_get("ra_deg")?,
                dec_deg: row.try_get("dec_deg")?,
                width_deg: row.try_get("width_deg")?,
                height_deg: row.try_get("height_deg")?,
                position_angle_deg: row.try_get("position_angle_deg")?,
            })
        })
        .collect()
}

async fn load_checklist(conn: &mut SqliteConnection, id: Uuid) -> Result<Vec<ChecklistItem>> {
    let rows = sqlx::query(
        "SELECT id, criterion FROM project_checklist WHERE project_id = ?1 ORDER BY position",
    )
    .bind(id.to_string())
    .fetch_all(&mut *conn)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(ChecklistItem {
                id: parse_uuid(&row.try_get::<String, _>("id")?)?,
                criterion: from_json(&row.try_get::<String, _>("criterion")?)?,
            })
        })
        .collect()
}

/// Links in session order. A link reads `NeedsReview` with the lineage
/// successors once a correction superseded its session.
async fn load_links(conn: &mut SqliteConnection, id: Uuid) -> Result<Vec<ProjectSessionLink>> {
    let rows = sqlx::query(
        "SELECT session_id, panel_id, grouping_revision, linked_at FROM project_session_links \
         WHERE project_id = ?1 ORDER BY session_id",
    )
    .bind(id.to_string())
    .fetch_all(&mut *conn)
    .await?;
    let mut links = Vec::with_capacity(rows.len());
    for row in &rows {
        let session_id = parse_uuid(&row.try_get::<String, _>("session_id")?)?;
        let session = load_session_row(conn, session_id).await?;
        let successors = successors_of(conn, &session).await?;
        let panel_id: Option<String> = row.try_get("panel_id")?;
        links.push(ProjectSessionLink {
            session_id,
            panel_id: panel_id.as_deref().map(parse_uuid).transpose()?,
            grouping_revision: revision(row.try_get("grouping_revision")?)?,
            linked_at: row.try_get("linked_at")?,
            state: if session.superseded_by.is_some() {
                LinkState::NeedsReview
            } else {
                LinkState::Current
            },
            successors,
        });
    }
    Ok(links)
}

/// The latest decision of each asset, in asset order.
async fn load_rejections(conn: &mut SqliteConnection, id: Uuid) -> Result<Vec<ProjectRejection>> {
    let rows = sqlx::query(
        "SELECT r.asset_id, r.rejected, r.fingerprint, r.project_revision, r.decided_at \
         FROM project_rejections r WHERE r.project_id = ?1 AND r.id = (SELECT max(x.id) \
         FROM project_rejections x WHERE x.project_id = r.project_id AND x.asset_id = r.asset_id) \
         ORDER BY r.asset_id",
    )
    .bind(id.to_string())
    .fetch_all(&mut *conn)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(ProjectRejection {
                asset_id: parse_uuid(&row.try_get::<String, _>("asset_id")?)?,
                rejected: row.try_get::<i64, _>("rejected")? == 1,
                fingerprint: from_json(&row.try_get::<String, _>("fingerprint")?)?,
                project_revision: revision(row.try_get("project_revision")?)?,
                decided_at: row.try_get("decided_at")?,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use platevault_model::{PanelInput, ProjectInput};

    use super::Catalog;

    fn mosaic(notes: String) -> ProjectInput {
        ProjectInput {
            name: "NGC 7000 mosaic".into(),
            notes: Some(notes),
            targets: Vec::new(),
            panels: vec![PanelInput {
                id: None,
                name: "East".into(),
                ra_deg: 314.75,
                dec_deg: 44.33,
                width_deg: 2.5,
                height_deg: 1.7,
                position_angle_deg: None,
            }],
            equipment_ids: Vec::new(),
        }
    }

    /// A disposable `max_page_count` catalog forces `SQLITE_FULL` on a Project
    /// write: it reports `PersistenceFailure`, and nothing of it persists.
    #[tokio::test]
    async fn sqlite_full_on_a_project_write_reports_persistence_failure_and_persists_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("catalog.sqlite");
        let catalog = Catalog::open(&path).await.unwrap();
        catalog.limit_writer_pages_for_test().await.unwrap();
        let input = mosaic("x".repeat(400_000));
        let error = catalog.create_project(&input).await.unwrap_err();
        assert_eq!(error.response(None, None).kind, "persistence_failure");
        assert!(error.to_string().contains("full"), "{error}");
        catalog.close().await.unwrap();

        let reopened = Catalog::open(&path).await.unwrap();
        let none = reopened.list_projects(&platevault_model::ProjectQuery::default()).await;
        assert!(none.unwrap().is_empty(), "no Project row persisted");
        let saved = reopened.create_project(&input).await.unwrap();
        assert_eq!(reopened.project(saved.id).await.unwrap(), saved, "an unlimited writer saves");
    }
}
