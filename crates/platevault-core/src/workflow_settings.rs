// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The library's workflow settings on the [`Library`] facade (D-W114): the
//! framing margins, calibration matching thresholds, group keywords and
//! default View mode (LIB-FR-04, PRJ-FR-31, CAL-FR-20/21), the calibration
//! settings (CAL-FR-15, J36 S8) and each band's Moon-avoidance curve
//! (PLAN-FR-02), read and saved whole under one revision. A save changes
//! nothing already split, grouped or pinned.

use crate::library::Library;
use crate::{LibraryError, Revision, WorkflowSettings, WorkflowSettingsRecord};

impl Library {
    /// The workflow settings at their revision; the defaults at revision 0
    /// while none are saved.
    ///
    /// # Errors
    /// `PersistenceFailure` for an unreadable catalog or recorded settings
    /// that are not valid.
    pub async fn workflow_settings(&self) -> Result<WorkflowSettingsRecord, LibraryError> {
        let (settings, revision) = self.catalog().workflow_settings().await?;
        Ok(WorkflowSettingsRecord { settings, revision })
    }

    /// Validate and save `settings` over revision `expected` (0 while none
    /// are saved), returning them at their new revision.
    ///
    /// # Errors
    /// `InvalidInput` naming an invalid field; `Conflict` naming
    /// [`persistence_library::WORKFLOW_SETTINGS_ID`] at the current revision
    /// when `expected` is stale. Nothing is stored on either.
    pub async fn save_workflow_settings(
        &self,
        expected: Revision,
        settings: &WorkflowSettings,
    ) -> Result<WorkflowSettingsRecord, LibraryError> {
        let revision = self.catalog().save_workflow_settings(expected, settings).await?;
        Ok(WorkflowSettingsRecord { settings: settings.clone(), revision })
    }
}
