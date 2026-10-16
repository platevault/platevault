// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Reading the F4 workflow settings (D-W114): intake reads the framing
//! margins here when it splits sessions (LIB-FR-04), so the margins in force
//! at intake set the split. With no recorded row every value is the
//! owner-approved default at revision 0. Saving them with a revision check is
//! the Settings API's.

use platevault_model::{LibraryError, Revision, WorkflowSettings};
use sqlx::Row;

use super::{from_json, revision, Catalog, Result};

impl Catalog {
    /// The workflow settings and their revision; the defaults at revision 0
    /// when none are recorded.
    ///
    /// # Errors
    /// `PersistenceFailure` for an unreadable catalog or recorded settings
    /// that are not valid.
    pub async fn workflow_settings(&self) -> Result<(WorkflowSettings, Revision)> {
        let mut conn = self.reader().await?;
        let Some(row) =
            sqlx::query("SELECT settings, revision FROM workflow_settings WHERE id = 1")
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
}
