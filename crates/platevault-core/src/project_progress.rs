// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Project goal progress and warnings (spec 065: PRJ-FR-04, PRJ-FR-11,
//! PRJ-FR-21; spec 068 CAL-FR-12; D-W29, D-W36, D-W66, D-W72).
//!
//! The catalog counts "in project" and "captured" per goal from one snapshot,
//! a median-FWHM bar reading this build's measurement method. The
//! exposure-mismatch warning reads the calibration-matching evidence of the
//! Project's candidate light sessions per subject, rig and channel, as the
//! Project's calibration evidence does. Nothing here assigns calibration, sets
//! a goal, blocks a run or writes anything.

use platevault_pixels::measure;
use uuid::Uuid;

use crate::calibration::Rules;
use crate::library::Library;
use crate::{LibraryError, MeasurementMethod, ProjectProgress};

impl Library {
    /// The goal progress of Project `id`, in goal order, and its warnings.
    /// Goal met reads "in project" only; a warning is never a goal and never
    /// blocks a run. Read-only.
    ///
    /// # Errors
    /// `NotFound` for an unknown Project; `PersistenceFailure` when the
    /// catalog cannot be read.
    pub async fn project_progress(&self, id: Uuid) -> Result<ProjectProgress, LibraryError> {
        let method = MeasurementMethod::new(measure::METHOD.name, measure::METHOD.version);
        let basis = self.catalog().project_progress_basis(id, &method).await?;
        let warnings = self.catalog().project_exposure_warnings(id, &Rules).await?;
        Ok(ProjectProgress {
            project_id: basis.project_id,
            revision: basis.revision,
            goals: basis.goals,
            warnings,
        })
    }
}
