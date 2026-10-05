// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Project records (spec 065): Tier 1 user decisions on the catalog's single
//! serialized writer. Every write is one `BEGIN IMMEDIATE` transaction that
//! checks the expected Project revision and every referenced record, writes only
//! the Project tables and adds one to the revision. Nothing here reads or writes
//! an image file or changes a library record.

use std::collections::btree_map::Entry;
use std::collections::{BTreeMap, BTreeSet, HashMap};

use platevault_model::{
    ApplicableQuality, Asset, AssetReference, AssociationKind, Availability, AvailabilityShare,
    CaptureSite, ChannelProgress, ChecklistItem, ChecklistItemInput, ChecklistKind,
    EffectiveRejection, ExpectedAsset, ExpectedSession, LibraryError, LinkState,
    LinkedSessionEvidence, Microseconds, PanelInput, Project, ProjectInput, ProjectPanel,
    ProjectProgress, ProjectProgressBasis, ProjectQuery, ProjectRejection, ProjectSessionLink,
    ProjectSummary, ProjectTarget, ReferenceKind, Revision, SessionExposure, SessionLinkInput,
    SkyCoordinates, TargetFraming,
};
use sqlx::sqlite::{SqliteConnection, SqliteRow};
use sqlx::{Connection, Row};
use uuid::Uuid;

use super::{
    check_expected_assets, check_expected_sessions, conflict, current_member_assets, db_revision,
    from_json, is_light, json_ids, load_association, load_equipment, load_session_row, load_target,
    now, oldest, parse_uuid, require_revision, revision, successors_of, summarize_rows, to_json,
    CaptureView, Catalog, Result, MAX_PAGE,
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

    /// What checklist evaluation reads, from one catalog snapshot: per exact
    /// channel, captured, library-usable and Project-accepted integer microseconds
    /// and logical light frames over the current members of the Current links,
    /// each logical capture once, with per-session evidence and the effective
    /// rejections. Reads no source, starts no rehash and writes nothing.
    ///
    /// # Errors
    /// `NotFound` for an unknown Project; `PersistenceFailure` when the catalog
    /// cannot be read.
    pub async fn project_progress(&self, id: Uuid) -> Result<ProjectProgressBasis> {
        let mut conn = self.reader().await?;
        // One deferred transaction, so every read below sees the same snapshot.
        let mut snapshot = conn.begin().await?;
        let basis = progress_basis(&mut snapshot, id).await?;
        snapshot.rollback().await?;
        Ok(basis)
    }

    /// The Projects holding any of `assets`, through a Current or `NeedsReview`
    /// link of the session holding them or through an effective rejection. Each
    /// reference names the asked assets it holds and carries the Project revision.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn project_references(&self, assets: &BTreeSet<Uuid>) -> Result<Vec<AssetReference>> {
        if assets.is_empty() {
            return Ok(Vec::new());
        }
        let mut conn = self.reader().await?;
        let rows =
            sqlx::query(PROJECT_REFERENCES).bind(json_ids(assets)?).fetch_all(&mut *conn).await?;
        let mut references: BTreeMap<Uuid, AssetReference> = BTreeMap::new();
        for row in &rows {
            let id = parse_uuid(&row.try_get::<String, _>("project_id")?)?;
            let reference = match references.entry(id) {
                Entry::Occupied(entry) => entry.into_mut(),
                Entry::Vacant(entry) => entry.insert(AssetReference {
                    kind: ReferenceKind::Project,
                    id,
                    name: row.try_get("name")?,
                    revision: revision(row.try_get("revision")?)?,
                    asset_ids: Vec::new(),
                }),
            };
            reference.asset_ids.push(parse_uuid(&row.try_get::<String, _>("asset_id")?)?);
        }
        Ok(references.into_values().collect())
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

// ---------------------------------------------------------------------------
// Progress and references
// ---------------------------------------------------------------------------

/// Projects holding asked assets through a link of the session that holds them
/// now (Current links), the session's recorded members (links needing review)
/// or the latest rejection decision, when it rejects.
const PROJECT_REFERENCES: &str = "\
    WITH asked(id) AS (SELECT value FROM json_each(?1)), \
    held(project_id, asset_id) AS ( \
        SELECT l.project_id, a.id FROM assets a \
        JOIN project_session_links l ON l.session_id = a.session_id \
        WHERE a.id IN (SELECT id FROM asked) \
        UNION SELECT l.project_id, m.asset_id FROM session_members m \
        JOIN project_session_links l ON l.session_id = m.session_id \
        WHERE m.asset_id IN (SELECT id FROM asked) \
        UNION SELECT r.project_id, r.asset_id FROM project_rejections r \
        WHERE r.asset_id IN (SELECT id FROM asked) AND r.rejected = 1 AND r.id = ( \
            SELECT max(x.id) FROM project_rejections x \
            WHERE x.project_id = r.project_id AND x.asset_id = r.asset_id)) \
    SELECT p.id AS project_id, p.name, p.revision, h.asset_id FROM held h \
    JOIN projects p ON p.id = h.project_id ORDER BY p.id, h.asset_id";

/// Availability labels in display order; Retired copies count toward no total.
const SHARE_ORDER: [Availability; 5] = [
    Availability::Available,
    Availability::Offline,
    Availability::IdentityConflict,
    Availability::Unreadable,
    Availability::Missing,
];

/// Per-session evidence of a Current link's logical captures.
#[derive(Default)]
struct SessionTally {
    sites: Vec<CaptureSite>,
    unknown_site_frames: u64,
    exposures: BTreeMap<(Option<String>, Option<Microseconds>), u64>,
}

impl SessionTally {
    #[expect(clippy::float_cmp, reason = "exact observed coordinates: no clustering tolerance")]
    fn count(&mut self, primary: &Asset, exposure: Option<Microseconds>) {
        let metadata = &primary.effective;
        *self.exposures.entry((metadata.filter.clone(), exposure)).or_default() += 1;
        let (Some(latitude_deg), Some(longitude_deg)) =
            (metadata.site_latitude_deg, metadata.site_longitude_deg)
        else {
            self.unknown_site_frames += 1;
            return;
        };
        match self
            .sites
            .iter_mut()
            .find(|site| site.latitude_deg == latitude_deg && site.longitude_deg == longitude_deg)
        {
            Some(site) => site.frames += 1,
            None => self.sites.push(CaptureSite { latitude_deg, longitude_deg, frames: 1 }),
        }
    }
}

/// Add a known exposure; an unknown one is counted by the caller, never added.
fn add(total: &mut Microseconds, exposure: Option<Microseconds>) {
    if let Some(exposure) = exposure {
        *total = total.saturating_add(exposure);
    }
}

/// Count one logical light capture, on its primary copy, into its channel row.
fn count_light(
    row: &mut ChannelProgress,
    primary: &Asset,
    exposure: Option<Microseconds>,
    quality: ApplicableQuality,
    verified_at: Option<&String>,
    rejected: bool,
) {
    row.captured_frames += 1;
    add(&mut row.captured_seconds, exposure);
    if exposure.is_none() {
        row.unknown_exposure_count += 1;
    }
    let at = primary.availability;
    let index = row.availability.iter().position(|share| share.availability == at);
    let index = index.unwrap_or_else(|| {
        row.availability.push(AvailabilityShare {
            availability: at,
            captured_seconds: Microseconds::default(),
            captured_frames: 0,
        });
        row.availability.len() - 1
    });
    let share = &mut row.availability[index];
    share.captured_frames += 1;
    add(&mut share.captured_seconds, exposure);
    if rejected {
        row.rejected_frames += 1;
    }
    match quality {
        ApplicableQuality::Usable => {
            row.usable_frames += 1;
            add(&mut row.usable_seconds, exposure);
            row.usable_last_verified_at =
                oldest(row.usable_last_verified_at.iter().chain(verified_at));
            if !rejected {
                row.accepted_frames += 1;
                add(&mut row.accepted_seconds, exposure);
                row.accepted_last_verified_at =
                    oldest(row.accepted_last_verified_at.iter().chain(verified_at));
            }
        }
        ApplicableQuality::Unreviewed => add(&mut row.unreviewed_seconds, exposure),
        ApplicableQuality::ChangedContent { .. } => row.drifted_decisions += 1,
        ApplicableQuality::VerificationPending { .. } => row.verification_pending += 1,
        ApplicableQuality::Conflicting => row.conflicting_decisions += 1,
        ApplicableQuality::ConflictingCopies => row.conflicting_copies += 1,
        ApplicableQuality::Unusable => {}
    }
}

/// The progress basis of Project `id`, read on `conn`'s snapshot.
async fn progress_basis(conn: &mut SqliteConnection, id: Uuid) -> Result<ProjectProgressBasis> {
    let project = load_project(conn, id).await?;
    let mut rows = Vec::with_capacity(project.links.len());
    for link in &project.links {
        rows.push(load_session_row(conn, link.session_id).await?);
    }
    // The linked session holding each asset: the recorded members of a link that
    // needs review, overridden below by the current members of Current links.
    let mut holder: HashMap<Uuid, Uuid> = HashMap::new();
    for row in rows.iter().filter(|row| row.superseded_by.is_some()) {
        for asset in &row.session.asset_ids {
            holder.entry(*asset).or_insert(row.session.id);
        }
    }
    let current: Vec<Uuid> = project
        .links
        .iter()
        .filter(|link| link.state == LinkState::Current)
        .map(|link| link.session_id)
        .collect();
    let mut assets = Vec::new();
    for session in &current {
        for asset in current_member_assets(conn, *session).await? {
            holder.insert(asset.id, *session);
            // Retired copies stay as history and count toward no total.
            if asset.availability != Availability::Retired {
                assets.push(asset);
            }
        }
    }
    let rejected: BTreeSet<Uuid> = project
        .rejections
        .iter()
        .filter(|decision| decision.rejected)
        .map(|decision| decision.asset_id)
        .collect();
    let view = CaptureView::read(conn, &current, &assets).await?;
    let (progress, mut tallies) = tally_progress(&view, &assets, &holder, &rejected);
    let summaries = summarize_rows(conn, rows).await?;
    let mut sessions = Vec::with_capacity(project.links.len());
    for (link, summary) in project.links.iter().zip(summaries) {
        let tally = tallies.remove(&link.session_id).unwrap_or_default();
        sessions.push(LinkedSessionEvidence {
            session_id: link.session_id,
            panel_id: link.panel_id,
            state: link.state,
            successors: link.successors.clone(),
            summary,
            capture_sites: tally.sites,
            unknown_site_frames: tally.unknown_site_frames,
            exposures: tally
                .exposures
                .into_iter()
                .map(|((channel, exposure_seconds), frames)| SessionExposure {
                    channel,
                    exposure_seconds,
                    frames,
                })
                .collect(),
            equipment: load_association(conn, link.session_id, AssociationKind::Equipment).await?,
        });
    }
    let rejections = project
        .rejections
        .iter()
        .filter(|decision| decision.rejected)
        .map(|decision| EffectiveRejection {
            asset_id: decision.asset_id,
            session_id: holder.get(&decision.asset_id).copied(),
            decided_at: decision.decided_at.clone(),
            project_revision: decision.project_revision,
        })
        .collect();
    Ok(ProjectProgressBasis {
        project_id: project.id,
        project_revision: project.revision,
        progress,
        sessions,
        rejections,
    })
}

/// Per-channel progress of these current members, each logical capture once on
/// its primary copy, and the per-session evidence of the session holding it.
fn tally_progress(
    view: &CaptureView,
    assets: &[Asset],
    holder: &HashMap<Uuid, Uuid>,
    rejected: &BTreeSet<Uuid>,
) -> (ProjectProgress, HashMap<Uuid, SessionTally>) {
    let mut locations = BTreeSet::new();
    let mut channels: BTreeMap<Option<String>, ChannelProgress> = BTreeMap::new();
    let mut tallies: HashMap<Uuid, SessionTally> = HashMap::new();
    for (key, present) in view.group(assets) {
        locations.extend(present.iter().map(|asset| asset.location_id));
        // Each logical capture counts once, on an available copy when there is one.
        let Some(primary) = present.iter().min_by_key(|asset| {
            (asset.availability != Availability::Available, asset.location_id, asset.id)
        }) else {
            continue;
        };
        let exposure = primary.effective.exposure_seconds.and_then(Microseconds::from_seconds);
        tallies.entry(holder[&primary.id]).or_default().count(primary, exposure);
        let light = is_light(&primary.effective);
        if light == Some(false) {
            continue;
        }
        let channel = primary.effective.filter.clone();
        let row = channels
            .entry(channel.clone())
            .or_insert_with(|| ChannelProgress { channel, ..ChannelProgress::default() });
        if light.is_none() {
            row.unknown_image_type_count += 1;
            continue;
        }
        if candidate(view, primary) {
            row.duplicate_candidates += 1;
        }
        let quality = view.quality(&key);
        let verified_at =
            if quality == ApplicableQuality::Usable { view.verified_at(&key) } else { None };
        let rejected = view.copies_of(&key).iter().any(|copy| rejected.contains(&copy.id));
        count_light(row, primary, exposure, quality, verified_at.as_ref(), rejected);
    }
    for row in channels.values_mut() {
        row.availability
            .sort_by_key(|share| SHARE_ORDER.iter().position(|state| *state == share.availability));
    }
    for tally in tallies.values_mut() {
        tally.sites.sort_by(|left, right| {
            left.latitude_deg
                .total_cmp(&right.latitude_deg)
                .then(left.longitude_deg.total_cmp(&right.longitude_deg))
        });
    }
    let provisional = locations.iter().any(|location| view.location_provisional(*location))
        || assets.iter().any(|asset| candidate(view, asset));
    let unknown_channel = channels.remove(&None);
    let progress = ProjectProgress {
        channels: channels.into_values().collect(),
        unknown_channel,
        provisional,
        covered_location_ids: locations.into_iter().collect(),
    };
    (progress, tallies)
}

/// An unhashed copy matching a copy in another location: totals stay provisional.
fn candidate(view: &CaptureView, asset: &Asset) -> bool {
    view.candidates.contains(&asset.id)
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
