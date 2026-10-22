// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The F4 workflow settings (D-W114): intake reads the framing margins here
//! when it splits sessions (LIB-FR-04), so the margins in force at intake set
//! the split, Project grouping compares framings with the same margins
//! (PRJ-FR-31), and calibration matching reads the flat and dark thresholds
//! here inside its own transaction. With no recorded row every value is the
//! owner-approved default at revision 0. Saving them is one revision-checked
//! write; nothing already split, grouped or pinned changes by itself.

use platevault_model::{LibraryError, Revision, WorkflowSettings};
use sqlx::sqlite::SqliteConnection;
use sqlx::{Connection, Row};

use super::{conflict, db_revision, from_json, now, revision, to_json, Catalog, Result};

/// The settings row's id: there is one at most.
const SETTINGS_ROW: i64 = 1;

/// The identity a Conflict on the workflow settings names.
pub const WORKFLOW_SETTINGS_ID: uuid::Uuid =
    uuid::Uuid::from_u128(0x7a3c_51e0_0114_5000_8000_0000_0000_0001);

impl Catalog {
    /// The workflow settings and their revision; the defaults at revision 0
    /// when none are recorded.
    ///
    /// # Errors
    /// `PersistenceFailure` for an unreadable catalog or recorded settings
    /// that are not valid.
    pub async fn workflow_settings(&self) -> Result<(WorkflowSettings, Revision)> {
        let mut conn = self.reader().await?;
        read_workflow_settings(&mut conn).await
    }

    /// Save the workflow settings over revision `expected` (0 while none
    /// are recorded) and return the new revision.
    ///
    /// # Errors
    /// `InvalidInput` for settings that are not valid; `Conflict` naming
    /// [`WORKFLOW_SETTINGS_ID`] at the current revision when `expected` is
    /// stale.
    pub async fn save_workflow_settings(
        &self,
        expected: Revision,
        settings: &WorkflowSettings,
    ) -> Result<Revision> {
        settings.validate()?;
        let saved = write_txn!(self, |conn| {
            let (_, current) = read_workflow_settings(conn).await?;
            if current != expected {
                return Err(conflict(WORKFLOW_SETTINGS_ID, current));
            }
            let next = current + 1;
            sqlx::query(
                "INSERT INTO workflow_settings (id, settings, revision, updated_at) \
                 VALUES (?1, ?2, ?3, ?4) ON CONFLICT (id) DO UPDATE SET \
                 settings = excluded.settings, revision = excluded.revision, \
                 updated_at = excluded.updated_at",
            )
            .bind(SETTINGS_ROW)
            .bind(to_json(settings)?)
            .bind(db_revision(next)?)
            .bind(now()?)
            .execute(&mut *conn)
            .await?;
            next
        });
        Ok(saved)
    }
}

/// [`Catalog::workflow_settings`] in the caller's transaction.
///
/// # Errors
/// As [`Catalog::workflow_settings`].
pub async fn read_workflow_settings(
    conn: &mut SqliteConnection,
) -> Result<(WorkflowSettings, Revision)> {
    let Some(row) = sqlx::query("SELECT settings, revision FROM workflow_settings WHERE id = ?1")
        .bind(SETTINGS_ROW)
        .fetch_optional(&mut *conn)
        .await?
    else {
        return Ok((WorkflowSettings::default(), 0));
    };
    let settings: WorkflowSettings = from_json(&row.try_get::<String, _>("settings")?)?;
    settings.validate().map_err(|error| {
        LibraryError::PersistenceFailure(format!("recorded workflow settings: {error}"))
    })?;
    Ok((settings, revision(row.try_get("revision")?)?))
}
