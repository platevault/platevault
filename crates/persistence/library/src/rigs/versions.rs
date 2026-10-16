// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Rig versions (spec 064 LIB-FR-26, 072 PLAN-EQ-FR-07; D-W102, D-W104).
//! Editing a rig's components adds an immutable version from a date; a
//! rename is an equipment save and adds none. A session confirmed to a rig
//! records the version its night falls in ([`RigVersion::for_night`]), and
//! keeps it: a later or backdated version never rebinds a recorded session,
//! its pins or its group. A regroup's successor keeps the version its frames'
//! sessions recorded. A remount is a version with the same optics: flats
//! change, the Project group does not ([`RigVersion::starts_new_group`]).

use std::collections::BTreeSet;

use platevault_model::{CameraBasis, CameraLink, CaptureKey, LibraryError, RigVersion};
use sqlx::sqlite::{SqliteConnection, SqliteRow};
use sqlx::{Connection, Row};
use time::Date;
use uuid::Uuid;

use super::cameras::{load_camera, load_session_camera_link, write_session_camera};
use crate::calibration::{confirmed_equipment, night_of};
use crate::{
    from_json, from_text, load_equipment, load_session_row, now, parse_uuid, to_json, to_text,
    Catalog, Result,
};

const DATE: &[time::format_description::BorrowedFormatItem<'static>] =
    time::macros::format_description!("[year]-[month]-[day]");

impl Catalog {
    /// A rig's versions, oldest first.
    ///
    /// # Errors
    /// `NotFound` for an unknown rig.
    pub async fn rig_versions(&self, rig_id: Uuid) -> Result<Vec<RigVersion>> {
        let mut conn = self.reader().await?;
        load_equipment(&mut conn, rig_id).await?;
        load_rig_versions(&mut conn, rig_id).await
    }

    /// Add an immutable version of a rig, from its date. Retrying a version
    /// that was saved returns it unchanged. No recorded session changes; a
    /// current session confirmed to the rig that recorded no version yet,
    /// because the rig had none, records the one its night falls in.
    ///
    /// # Errors
    /// `InvalidInput` for invalid optics, a date the rig already has a
    /// version from, or a reused id; `NotFound` for an unknown rig or camera.
    pub async fn add_rig_version(&self, version: &RigVersion) -> Result<RigVersion> {
        version.validate()?;
        let added = write_txn!(self, |conn| {
            let rig = load_equipment(conn, version.rig_id).await?;
            if let Some(camera_id) = version.optics.camera_id {
                load_camera(conn, camera_id).await?;
            }
            let versions = load_rig_versions(conn, version.rig_id).await?;
            if let Some(saved) = load_rig_version(conn, version.id).await? {
                if saved == *version {
                    return Ok(saved);
                }
                return Err(LibraryError::InvalidInput(format!(
                    "rig version {} is already saved with other components",
                    version.id
                )));
            }
            if versions.iter().any(|saved| saved.valid_from == version.valid_from) {
                return Err(LibraryError::InvalidInput(format!(
                    "{} already has a version from {}",
                    rig.name,
                    date_text(version.valid_from)?
                )));
            }
            insert_rig_version(conn, version).await?;
            for session in unversioned_sessions(conn, version.rig_id).await? {
                record_session_rig_version(conn, session, version.rig_id).await?;
                crate::calibration::rig_recorded(conn, session).await?;
            }
            version.clone()
        });
        Ok(added)
    }

    /// The rig version a session recorded; `None` until it is confirmed to
    /// a rig that has a version for it.
    ///
    /// # Errors
    /// `NotFound` for an unknown session.
    pub async fn session_rig_version(&self, session_id: Uuid) -> Result<Option<RigVersion>> {
        let mut conn = self.reader().await?;
        load_session_row(&mut conn, session_id).await?;
        load_session_rig_version(&mut conn, session_id).await
    }
}

fn date_text(date: Date) -> Result<String> {
    date.format(DATE).map_err(|error| LibraryError::PersistenceFailure(error.to_string()))
}

fn parse_date(text: &str) -> Result<Date> {
    Date::parse(text, DATE).map_err(|error| {
        LibraryError::PersistenceFailure(format!("corrupt rig version date {text:?}: {error}"))
    })
}

/// The night of a session's capture key, e.g. `2026-09-18@date-loc-noon`;
/// `None` when the key records no usable night.
fn session_night(key: &CaptureKey) -> Option<Date> {
    let night = night_of(key)?;
    Date::parse(night.split('@').next()?, DATE).ok()
}

fn rig_version_from_row(row: &SqliteRow) -> Result<RigVersion> {
    Ok(RigVersion {
        id: parse_uuid(&row.try_get::<String, _>("id")?)?,
        rig_id: parse_uuid(&row.try_get::<String, _>("equipment_id")?)?,
        valid_from: parse_date(&row.try_get::<String, _>("valid_from")?)?,
        optics: from_json(&row.try_get::<String, _>("optics")?)?,
        rotator: from_text(&row.try_get::<String, _>("rotator")?)?,
    })
}

/// A rig's versions, oldest first.
pub async fn load_rig_versions(
    conn: &mut SqliteConnection,
    rig_id: Uuid,
) -> Result<Vec<RigVersion>> {
    let rows =
        sqlx::query("SELECT * FROM rig_versions WHERE equipment_id = ?1 ORDER BY valid_from")
            .bind(rig_id.to_string())
            .fetch_all(&mut *conn)
            .await?;
    rows.iter().map(rig_version_from_row).collect()
}

async fn load_rig_version(conn: &mut SqliteConnection, id: Uuid) -> Result<Option<RigVersion>> {
    let row = sqlx::query("SELECT * FROM rig_versions WHERE id = ?1")
        .bind(id.to_string())
        .fetch_optional(&mut *conn)
        .await?;
    row.as_ref().map(rig_version_from_row).transpose()
}

async fn insert_rig_version(conn: &mut SqliteConnection, version: &RigVersion) -> Result<()> {
    sqlx::query(
        "INSERT INTO rig_versions (id, equipment_id, valid_from, camera_id, optics, rotator, \
         created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    )
    .bind(version.id.to_string())
    .bind(version.rig_id.to_string())
    .bind(date_text(version.valid_from)?)
    .bind(version.optics.camera_id.map(|id| id.to_string()))
    .bind(to_json(&version.optics)?)
    .bind(to_text(&version.rotator)?)
    .bind(now()?)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// The rig version a session recorded, if any.
pub async fn load_session_rig_version(
    conn: &mut SqliteConnection,
    session_id: Uuid,
) -> Result<Option<RigVersion>> {
    let row = sqlx::query(
        "SELECT v.* FROM session_rig_versions r JOIN rig_versions v ON v.id = r.rig_version_id \
         WHERE r.session_id = ?1",
    )
    .bind(session_id.to_string())
    .fetch_optional(&mut *conn)
    .await?;
    row.as_ref().map(rig_version_from_row).transpose()
}

/// Current sessions confirmed to a rig that recorded no version of it.
async fn unversioned_sessions(conn: &mut SqliteConnection, rig_id: Uuid) -> Result<Vec<Uuid>> {
    let ids: Vec<String> = sqlx::query_scalar(
        "SELECT a.session_id FROM associations a \
         JOIN sessions s ON s.id = a.session_id AND s.superseded_by IS NULL \
         WHERE a.kind = 'equipment' AND a.state = 'confirmed' AND a.equipment_id = ?1 \
         AND NOT EXISTS (SELECT 1 FROM session_rig_versions r WHERE r.session_id = a.session_id) \
         ORDER BY a.session_id",
    )
    .bind(rig_id.to_string())
    .fetch_all(&mut *conn)
    .await?;
    ids.iter().map(|id| parse_uuid(id)).collect()
}

async fn write_session_rig_version(
    conn: &mut SqliteConnection,
    session_id: Uuid,
    version_id: Uuid,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO session_rig_versions (session_id, rig_version_id, recorded_at) \
         VALUES (?1, ?2, ?3) ON CONFLICT (session_id) DO UPDATE SET \
         rig_version_id = excluded.rig_version_id, recorded_at = excluded.recorded_at",
    )
    .bind(session_id.to_string())
    .bind(version_id.to_string())
    .bind(now()?)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Record the version of `rig_id` a session confirmed to it was captured
/// with. A session that already recorded a version of this rig keeps it; a
/// version of another rig, after the session was confirmed to this one, is
/// replaced by this rig's version for its night, or removed when this rig
/// has none for it.
pub async fn record_session_rig_version(
    conn: &mut SqliteConnection,
    session_id: Uuid,
    rig_id: Uuid,
) -> Result<()> {
    let recorded = load_session_rig_version(conn, session_id).await?;
    if recorded.as_ref().is_some_and(|version| version.rig_id == rig_id) {
        return Ok(());
    }
    let night = session_night(&load_session_row(conn, session_id).await?.session.key);
    let versions = load_rig_versions(conn, rig_id).await?;
    match RigVersion::for_night(&versions, night) {
        Some(version) => write_session_rig_version(conn, session_id, version.id).await,
        None if recorded.is_some() => {
            sqlx::query("DELETE FROM session_rig_versions WHERE session_id = ?1")
                .bind(session_id.to_string())
                .execute(&mut *conn)
                .await?;
            Ok(())
        }
        None => Ok(()),
    }
}

/// A regroup's new session keeps what its frames' sessions recorded.
/// `frame_sessions` names, per frame, the session it came from (`None` for
/// a frame new to the catalog). With a confirmed rig, the successor takes
/// the version every frame's session recorded of that rig, or else the
/// version its night falls in. It keeps a calibration camera link when every
/// frame's session linked the same camera, by model unless all confirmed.
pub async fn inherit_successor(
    conn: &mut SqliteConnection,
    successor: Uuid,
    frame_sessions: &[Option<Uuid>],
) -> Result<()> {
    if frame_sessions.iter().all(Option::is_none) {
        return Ok(());
    }
    let predecessors: Option<BTreeSet<Uuid>> = frame_sessions.iter().copied().collect();
    if let Some(rig_id) = confirmed_equipment(conn, successor).await? {
        let shared = match &predecessors {
            Some(predecessors) => shared_version(conn, predecessors, rig_id).await?,
            None => None,
        };
        match shared {
            Some(version_id) => write_session_rig_version(conn, successor, version_id).await?,
            None => record_session_rig_version(conn, successor, rig_id).await?,
        }
    }
    if let Some(predecessors) = &predecessors {
        let mut links = Vec::with_capacity(predecessors.len());
        for predecessor in predecessors {
            links.push(load_session_camera_link(conn, *predecessor).await?);
        }
        let links: Option<Vec<_>> = links.into_iter().collect();
        if let Some([first, rest @ ..]) = links.as_deref() {
            if rest.iter().all(|link| link.camera_id == first.camera_id) {
                let confirmed = rest.iter().all(|link| link.basis == CameraBasis::Confirmed)
                    && first.basis == CameraBasis::Confirmed;
                let basis = if confirmed { CameraBasis::Confirmed } else { CameraBasis::Model };
                let link = CameraLink { camera_id: first.camera_id, basis };
                write_session_camera(conn, successor, link).await?;
            }
        }
    }
    Ok(())
}

/// The one version of `rig_id` every predecessor recorded, if they agree.
async fn shared_version(
    conn: &mut SqliteConnection,
    predecessors: &BTreeSet<Uuid>,
    rig_id: Uuid,
) -> Result<Option<Uuid>> {
    let mut shared = None;
    for predecessor in predecessors {
        match load_session_rig_version(conn, *predecessor).await? {
            Some(version)
                if version.rig_id == rig_id && shared.is_none_or(|id| id == version.id) =>
            {
                shared = Some(version.id);
            }
            _ => return Ok(None),
        }
    }
    Ok(shared)
}
