// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Project goal progress and warnings (spec 065: PRJ-FR-04, PRJ-FR-11,
//! PRJ-FR-21; spec 068 CAL-FR-12; D-W29, D-W36, D-W66, D-W72).
//!
//! The catalog counts "in project" and "captured" per goal from one snapshot,
//! a median-FWHM bar reading this build's measurement method. The
//! exposure-mismatch warning reads calibration-matching evidence for the
//! Project's candidate light sessions, per subject and channel. Nothing here
//! assigns calibration, sets a goal, blocks a run or writes anything.

use std::collections::BTreeSet;

use persistence_library::CandidateChannel;
use platevault_pixels::measure;
use uuid::Uuid;

use crate::calibration::Rules;
use crate::library::Library;
use crate::{
    CriterionId, InputKind, LibraryError, MeasurementMethod, ProjectProgress, ProjectWarning,
    Requirement, Verdict,
};

impl Library {
    /// The goal progress of Project `id`, in goal order, and its warnings.
    /// Goal met reads "in project" only; a warning is never a goal and never
    /// blocks a run. Read-only.
    ///
    /// # Errors
    /// `NotFound` for an unknown Project; `Conflict` when a candidate session
    /// changed between the progress read and its calibration matching, so the
    /// caller reads again; `PersistenceFailure` when the catalog cannot be read.
    pub async fn project_progress(&self, id: Uuid) -> Result<ProjectProgress, LibraryError> {
        let method = MeasurementMethod::new(measure::METHOD.name, measure::METHOD.version);
        let basis = self.catalog().project_progress_basis(id, &method).await?;
        let mut warnings = Vec::new();
        for group in &basis.candidate_channels {
            let requirements = self
                .catalog()
                .calibration_match(&group.sessions, &[InputKind::Dark], &Rules)
                .await?;
            warnings.extend(exposure_mismatch(group, &requirements));
        }
        Ok(ProjectProgress {
            project_id: basis.project_id,
            revision: basis.revision,
            goals: basis.goals,
            warnings,
        })
    }
}

/// The exposure-mismatch warning of one subject and channel (PRJ-FR-11). A
/// light requirement mismatches when it has darks that are incompatible on no
/// criterion but exposure, and every one of them has another exposure.
fn exposure_mismatch(
    group: &CandidateChannel,
    requirements: &[Requirement],
) -> Option<ProjectWarning> {
    let mut lights = BTreeSet::new();
    let mut darks = BTreeSet::new();
    for requirement in requirements {
        let eligible: Vec<_> = requirement
            .candidates
            .iter()
            .map(|candidate| &candidate.evaluation.criteria)
            .filter(|criteria| {
                criteria.iter().all(|criterion| {
                    criterion.criterion == CriterionId::Exposure
                        || criterion.verdict != Verdict::Incompatible
                })
            })
            .filter_map(|criteria| {
                criteria.iter().find(|criterion| criterion.criterion == CriterionId::Exposure)
            })
            .collect();
        if eligible.is_empty()
            || eligible.iter().any(|exposure| exposure.verdict != Verdict::Incompatible)
        {
            continue;
        }
        for exposure in eligible {
            lights.extend(exposure.light_value.clone());
            darks.extend(exposure.input_value.clone());
        }
    }
    (!lights.is_empty()).then(|| ProjectWarning::ExposureMismatch {
        subject_id: group.subject_id,
        channel: group.channel.clone(),
        light_exposures: ascending(lights),
        dark_exposures: ascending(darks),
    })
}

/// Canonical decimal seconds in ascending value.
fn ascending(values: BTreeSet<String>) -> Vec<String> {
    let mut values: Vec<String> = values.into_iter().collect();
    values.sort_by(|left, right| match (left.parse::<f64>(), right.parse::<f64>()) {
        (Ok(left), Ok(right)) => left.total_cmp(&right),
        _ => left.cmp(right),
    });
    values
}
