// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Physical cameras (spec 064 LIB-FR-26, 072 PLAN-EQ-FR-08; D-W104). A camera
//! keeps one identity across the rigs that mount it. Cameras are saved
//! together so the whole set always holds [`Camera::validate_all`]: aliases
//! unique, and an alias on every camera of a model two cameras share. A
//! calibration session names its camera by model while the rigs hold one
//! camera of it, or by the camera the user confirmed; a link, once written,
//! is never reinterpreted by a later camera, alias or default edit.

use std::collections::{BTreeMap, BTreeSet};

use platevault_model::{
    Camera, CameraBasis, CameraLink, CameraResolution, ExpectedSession, LibraryError,
};
use sqlx::sqlite::{SqliteConnection, SqliteRow};
use sqlx::{Connection, Row};
use uuid::Uuid;

use super::versions::load_session_rig_version;
use crate::{
    check_expected_sessions, current_member_assets, db_revision, from_text, load_session_row,
    next_revision, now, parse_uuid, revision, to_text, Catalog, Result,
};

impl Catalog {
    /// Every camera of the rigs, by model and then alias.
    ///
    /// # Errors
    /// `PersistenceFailure` for an unreadable catalog.
    pub async fn cameras(&self) -> Result<Vec<Camera>> {
        let mut conn = self.reader().await?;
        load_cameras(&mut conn).await
    }

    /// One camera.
    ///
    /// # Errors
    /// `NotFound` for an unknown camera.
    pub async fn camera(&self, id: Uuid) -> Result<Camera> {
        let mut conn = self.reader().await?;
        load_camera(&mut conn, id).await
    }

    /// Save new and edited cameras in one transaction, all or nothing. Each
    /// camera carries the revision it was read at, and 0 for a new one; the
    /// saved records come back with their next revision, model and alias
    /// trimmed. After the save every camera of the rigs must hold
    /// [`Camera::validate_all`]. Only camera records are written: no rig
    /// version, session or master link and no calibration pin changes, so an
    /// alias or default edit reassigns nothing (sessions are settled by a
    /// default as they are matched, never in bulk).
    ///
    /// # Errors
    /// `InvalidInput` for no camera, a camera listed twice or a set that
    /// fails validation; `NotFound` for an edit of an unknown camera;
    /// `Conflict` for a stale revision or a new camera whose id is taken.
    pub async fn save_cameras(&self, cameras: &[Camera]) -> Result<Vec<Camera>> {
        let edits = normalized(cameras)?;
        let saved = write_txn!(self, |conn| {
            let mut all: BTreeMap<Uuid, Camera> =
                load_cameras(conn).await?.into_iter().map(|camera| (camera.id, camera)).collect();
            let mut saved = Vec::with_capacity(edits.len());
            for edit in edits {
                let current = all.get(&edit.id).map(|camera| db_revision(camera.revision));
                let expected = (edit.revision > 0).then_some(edit.revision);
                let next = next_revision(edit.id, current.transpose()?, expected, "camera")?;
                let camera = Camera { revision: next, ..edit };
                all.insert(camera.id, camera.clone());
                saved.push(camera);
            }
            let saved_ids: BTreeSet<_> = saved.iter().map(|camera| camera.id).collect();
            all.retain(|id, _| !saved_ids.contains(id));
            let stored: Vec<_> = all.into_values().collect();
            Camera::validate_all(&saved, &stored)?;
            write_cameras(conn, &saved).await?;
            saved
        });
        Ok(saved)
    }

    /// Which camera calibration headers naming `model` were taken with: the
    /// one camera of that model, or the cameras the import asks between.
    ///
    /// # Errors
    /// `PersistenceFailure` for an unreadable catalog.
    pub async fn camera_resolution(&self, model: &str) -> Result<CameraResolution> {
        let mut conn = self.reader().await?;
        Ok(Camera::resolve_model(&load_cameras(&mut conn).await?, model))
    }

    /// The camera a session was taken with: its calibration camera link, or
    /// else the camera of the rig version it recorded. `None` while neither
    /// names one.
    ///
    /// # Errors
    /// `NotFound` for an unknown session.
    pub async fn session_camera(&self, session_id: Uuid) -> Result<Option<Camera>> {
        let mut conn = self.reader().await?;
        load_session_row(&mut conn, session_id).await?;
        load_session_camera(&mut conn, session_id).await
    }

    /// Link an unlinked calibration session to the camera its frames'
    /// camera model names, when the rigs hold exactly one camera of it. A
    /// session already linked keeps its link, whatever cameras were added
    /// since: a second camera of the model never reinterprets it.
    ///
    /// # Errors
    /// `NotFound` for an unknown session.
    pub async fn link_session_camera(&self, session_id: Uuid) -> Result<Option<CameraLink>> {
        let linked = write_txn!(self, |conn| {
            load_session_row(conn, session_id).await?;
            link_session_camera_by_model(conn, session_id).await?
        });
        Ok(linked)
    }

    /// The camera the user confirms for calibration sessions at import: the
    /// explicit match, replacing any link by model. Each session's decision
    /// revision advances; the fresh expectations come back in input order.
    ///
    /// # Errors
    /// `NotFound` for an unknown camera or session; `Conflict` (with
    /// successors for a superseded session) for stale expectations.
    pub async fn confirm_session_camera(
        &self,
        expected: &[ExpectedSession],
        camera_id: Uuid,
    ) -> Result<Vec<ExpectedSession>> {
        let confirmed = write_txn!(self, |conn| {
            load_camera(conn, camera_id).await?;
            let sessions = check_expected_sessions(conn, expected).await?;
            let link = CameraLink { camera_id, basis: CameraBasis::Confirmed };
            let mut confirmed = Vec::with_capacity(sessions.len());
            for session in sessions {
                write_session_camera(conn, session.id, link).await?;
                let decision_revision = session.decision_revision + 1;
                sqlx::query("UPDATE sessions SET decision_revision = ?1 WHERE id = ?2")
                    .bind(db_revision(decision_revision)?)
                    .bind(session.id.to_string())
                    .execute(&mut *conn)
                    .await?;
                confirmed.push(ExpectedSession {
                    session_id: session.id,
                    grouping_revision: session.grouping_revision,
                    decision_revision,
                });
            }
            confirmed
        });
        Ok(confirmed)
    }
}

/// Trimmed copies of the cameras to save, each listed once.
fn normalized(cameras: &[Camera]) -> Result<Vec<Camera>> {
    if cameras.is_empty() {
        return Err(LibraryError::InvalidInput("no camera to save".into()));
    }
    let mut ids = BTreeSet::new();
    cameras
        .iter()
        .enumerate()
        .map(|(index, camera)| {
            if !ids.insert(camera.id) {
                return Err(LibraryError::invalid_field(
                    &format!("{index}.id"),
                    format!("camera {} is listed twice", camera.id),
                ));
            }
            let normalized = Camera {
                model: camera.model.trim().to_owned(),
                alias: camera.alias.as_deref().map(|alias| alias.trim().to_owned()),
                ..camera.clone()
            };
            normalized.validate().map_err(|error| error.within_field(&index.to_string()))?;
            Ok(normalized)
        })
        .collect()
}

/// Write saved cameras. Their aliases are released first, so two cameras
/// can swap aliases in one save without tripping the unique alias key.
async fn write_cameras(conn: &mut SqliteConnection, cameras: &[Camera]) -> Result<()> {
    for camera in cameras {
        sqlx::query("UPDATE cameras SET alias = NULL, alias_key = NULL WHERE id = ?1")
            .bind(camera.id.to_string())
            .execute(&mut *conn)
            .await?;
    }
    let updated_at = now()?;
    for camera in cameras {
        sqlx::query(
            "INSERT INTO cameras (id, model, model_key, alias, alias_key, no_darks, no_bias, \
             revision, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) \
             ON CONFLICT (id) DO UPDATE SET model = excluded.model, \
             model_key = excluded.model_key, alias = excluded.alias, \
             alias_key = excluded.alias_key, no_darks = excluded.no_darks, \
             no_bias = excluded.no_bias, revision = excluded.revision, \
             updated_at = excluded.updated_at",
        )
        .bind(camera.id.to_string())
        .bind(&camera.model)
        .bind(camera.model_key())
        .bind(camera.alias.as_deref())
        .bind(camera.alias_key())
        .bind(camera.no_darks)
        .bind(camera.no_bias)
        .bind(db_revision(camera.revision)?)
        .bind(&updated_at)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

fn camera_from_row(row: &SqliteRow) -> Result<Camera> {
    Ok(Camera {
        id: parse_uuid(&row.try_get::<String, _>("id")?)?,
        model: row.try_get("model")?,
        alias: row.try_get("alias")?,
        no_darks: row.try_get("no_darks")?,
        no_bias: row.try_get("no_bias")?,
        revision: revision(row.try_get("revision")?)?,
    })
}

/// Every camera of the rigs, by model and then alias.
pub async fn load_cameras(conn: &mut SqliteConnection) -> Result<Vec<Camera>> {
    let rows = sqlx::query("SELECT * FROM cameras ORDER BY model_key, alias_key, id")
        .fetch_all(&mut *conn)
        .await?;
    rows.iter().map(camera_from_row).collect()
}

/// One camera; `NotFound` for an unknown id.
pub async fn load_camera(conn: &mut SqliteConnection, id: Uuid) -> Result<Camera> {
    let row = sqlx::query("SELECT * FROM cameras WHERE id = ?1")
        .bind(id.to_string())
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| LibraryError::NotFound(format!("camera {id}")))?;
    camera_from_row(&row)
}

/// The link calibration taken with `model` makes: the camera the user chose
/// (the explicit match), else the one camera of that model. `None` while
/// the rigs hold no camera of the model, or several and none was chosen.
/// Calibration's import calls this inside its own transaction to write a
/// master's `camera_id`/`camera_basis`.
///
/// # Errors
/// `NotFound` for an unknown chosen camera.
pub async fn camera_link(
    conn: &mut SqliteConnection,
    model: Option<&str>,
    chosen: Option<Uuid>,
) -> Result<Option<CameraLink>> {
    if let Some(camera_id) = chosen {
        load_camera(conn, camera_id).await?;
        return Ok(Some(CameraLink { camera_id, basis: CameraBasis::Confirmed }));
    }
    let Some(model) = model else { return Ok(None) };
    Ok(Camera::resolve_model(&load_cameras(conn).await?, model).link())
}

/// A calibration session's camera link, if one was written.
pub async fn load_session_camera_link(
    conn: &mut SqliteConnection,
    session_id: Uuid,
) -> Result<Option<CameraLink>> {
    let row = sqlx::query("SELECT camera_id, basis FROM session_cameras WHERE session_id = ?1")
        .bind(session_id.to_string())
        .fetch_optional(&mut *conn)
        .await?;
    row.map(|row| {
        Ok(CameraLink {
            camera_id: parse_uuid(&row.try_get::<String, _>("camera_id")?)?,
            basis: from_text(&row.try_get::<String, _>("basis")?)?,
        })
    })
    .transpose()
}

/// The camera a session was taken with: its calibration camera link, else
/// the camera of the rig version it recorded.
pub async fn load_session_camera(
    conn: &mut SqliteConnection,
    session_id: Uuid,
) -> Result<Option<Camera>> {
    let camera_id = match load_session_camera_link(conn, session_id).await? {
        Some(link) => Some(link.camera_id),
        None => load_session_rig_version(conn, session_id)
            .await?
            .and_then(|version| version.optics.camera_id),
    };
    match camera_id {
        Some(id) => Ok(Some(load_camera(conn, id).await?)),
        None => Ok(None),
    }
}

/// Link an unlinked session by its frames' camera model when that names one
/// camera; an existing link is returned unchanged.
pub async fn link_session_camera_by_model(
    conn: &mut SqliteConnection,
    session_id: Uuid,
) -> Result<Option<CameraLink>> {
    if let Some(link) = load_session_camera_link(conn, session_id).await? {
        return Ok(Some(link));
    }
    let model = current_member_assets(conn, session_id)
        .await?
        .into_iter()
        .find_map(|asset| asset.effective.camera);
    let link = camera_link(conn, model.as_deref(), None).await?;
    if let Some(link) = link {
        write_session_camera(conn, session_id, link).await?;
    }
    Ok(link)
}

/// Record a session's camera link, replacing the one it had.
pub async fn write_session_camera(
    conn: &mut SqliteConnection,
    session_id: Uuid,
    link: CameraLink,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO session_cameras (session_id, camera_id, basis, recorded_at) \
         VALUES (?1, ?2, ?3, ?4) ON CONFLICT (session_id) DO UPDATE SET \
         camera_id = excluded.camera_id, basis = excluded.basis, \
         recorded_at = excluded.recorded_at",
    )
    .bind(session_id.to_string())
    .bind(link.camera_id.to_string())
    .bind(to_text(&link.basis)?)
    .bind(now()?)
    .execute(&mut *conn)
    .await?;
    Ok(())
}
