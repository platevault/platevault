// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Equipment inventory (spec 072 PLAN-EQ-FR-01, D-W87): every saved rig,
//! with its filter list, and safe deletion of a rig or a camera. A record is
//! deleted only while nothing refers to it; otherwise the delete is refused
//! naming what uses it, and nothing is written. Nothing cascades: sessions,
//! associations, rig versions, camera links, masters and Projects stay as
//! they were. A rig's own filter list is part of the rig and goes with it.
//! Cameras are listed by [`Catalog::cameras`]; a filter is deleted by saving
//! its rig's list without it ([`Catalog::save_rig_filters`]).

use platevault_model::{Equipment, LibraryError, Revision, RigFilters};
use sqlx::sqlite::SqliteConnection;
use sqlx::Connection;
use uuid::Uuid;

use super::cameras::load_camera;
use super::load_rig_filters;
use crate::{load_all_equipment, load_equipment, require_revision, Catalog, Result};

impl Catalog {
    /// Every saved rig, by name and then id.
    ///
    /// # Errors
    /// `PersistenceFailure` for an unreadable catalog.
    pub async fn list_equipment(&self) -> Result<Vec<Equipment>> {
        let mut conn = self.reader().await?;
        load_all_equipment(&mut conn).await
    }

    /// Every saved rig with its filter list, as [`Self::list_equipment`]
    /// orders them, read in one snapshot. A list never saved reads revision 0
    /// and no filters.
    ///
    /// # Errors
    /// `PersistenceFailure` for an unreadable catalog.
    pub async fn rigs_with_filters(&self) -> Result<Vec<(Equipment, RigFilters)>> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let rigs = load_all_equipment(&mut snapshot).await?;
        let mut listed = Vec::with_capacity(rigs.len());
        for rig in rigs {
            let filters = load_rig_filters(&mut snapshot, rig.id).await?;
            listed.push((rig, filters));
        }
        snapshot.rollback().await?;
        Ok(listed)
    }

    /// Delete a rig nothing refers to, with its filter list.
    ///
    /// # Errors
    /// `NotFound` for an unknown rig; `Conflict` when `expected` is not its
    /// current revision; `InvalidInput` naming the rig while a session's
    /// association (confirmed or automatic), a Project or a rig version
    /// refers to it, and then nothing is written.
    pub async fn delete_equipment(&self, id: Uuid, expected: Revision) -> Result<()> {
        write_txn!(self, |conn| {
            let rig = load_equipment(conn, id).await?;
            require_revision(id, rig.decision_revision, expected)?;
            let uses = rig_uses(conn, id).await?;
            if !uses.is_empty() {
                return Err(LibraryError::InvalidInput(format!(
                    "rig {} is used by {}",
                    rig.name,
                    uses.join(", ")
                )));
            }
            for sql in [
                "DELETE FROM rig_filters WHERE equipment_id = ?1",
                "DELETE FROM rig_filter_lists WHERE equipment_id = ?1",
                "DELETE FROM equipment WHERE id = ?1",
            ] {
                sqlx::query(sql).bind(id.to_string()).execute(&mut *conn).await?;
            }
        });
        Ok(())
    }

    /// Delete a camera nothing refers to.
    ///
    /// # Errors
    /// `NotFound` for an unknown camera; `Conflict` when `expected` is not
    /// its current revision; `InvalidInput` naming the camera while a rig
    /// version, a session's camera link, an adopted master or a Project group
    /// refers to it, and then nothing is written.
    pub async fn delete_camera(&self, id: Uuid, expected: Revision) -> Result<()> {
        write_txn!(self, |conn| {
            let camera = load_camera(conn, id).await?;
            require_revision(id, camera.revision, expected)?;
            let uses = camera_uses(conn, id).await?;
            if !uses.is_empty() {
                let label = camera.alias.as_deref().unwrap_or(&camera.model);
                return Err(LibraryError::InvalidInput(format!(
                    "camera {label} ({}) is used by {}",
                    camera.model,
                    uses.join(", ")
                )));
            }
            sqlx::query("DELETE FROM cameras WHERE id = ?1")
                .bind(id.to_string())
                .execute(&mut *conn)
                .await?;
        });
        Ok(())
    }
}

/// What refers to a rig, as "N kind" phrases; empty when nothing does.
async fn rig_uses(conn: &mut SqliteConnection, id: Uuid) -> Result<Vec<String>> {
    let (sessions, projects, versions): (i64, i64, i64) = sqlx::query_as(
        "SELECT \
         (SELECT count(DISTINCT session_id) FROM associations WHERE equipment_id = ?1), \
         (SELECT count(*) FROM (SELECT project_id FROM project_rigs WHERE equipment_id = ?1 \
          UNION SELECT project_id FROM project_groups WHERE rig_id = ?1)), \
         (SELECT count(*) FROM rig_versions WHERE equipment_id = ?1)",
    )
    .bind(id.to_string())
    .fetch_one(&mut *conn)
    .await?;
    Ok(uses(&[(sessions, "session(s)"), (projects, "Project(s)"), (versions, "rig version(s)")]))
}

/// What refers to a camera, as "N kind" phrases; empty when nothing does.
async fn camera_uses(conn: &mut SqliteConnection, id: Uuid) -> Result<Vec<String>> {
    let (versions, sessions, masters, groups): (i64, i64, i64, i64) = sqlx::query_as(
        "SELECT \
         (SELECT count(*) FROM rig_versions WHERE camera_id = ?1), \
         (SELECT count(*) FROM session_cameras WHERE camera_id = ?1), \
         (SELECT count(*) FROM adopted_masters WHERE camera_id = ?1), \
         (SELECT count(*) FROM project_groups WHERE json_extract(optics, '$.cameraId') = ?1)",
    )
    .bind(id.to_string())
    .fetch_one(&mut *conn)
    .await?;
    Ok(uses(&[
        (versions, "rig version(s)"),
        (sessions, "session(s)"),
        (masters, "calibration master(s)"),
        (groups, "Project group(s)"),
    ]))
}

fn uses(counts: &[(i64, &str)]) -> Vec<String> {
    counts
        .iter()
        .filter(|(count, _)| *count > 0)
        .map(|(count, what)| format!("{count} {what}"))
        .collect()
}
