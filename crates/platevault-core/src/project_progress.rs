// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Project goal progress and warnings (spec 065: PRJ-FR-04, PRJ-FR-11,
//! PRJ-FR-21; D-W29, D-W36, D-W66, D-W105).
//!
//! The catalog counts "in project" and "captured" per goal from one snapshot,
//! a median-FWHM bar reading this build's measurement method. The
//! exposure-mismatch warning is computed from the light sessions the Project
//! holds, per subject, rig and channel: each session's darks are checked
//! with the calibration rules its matching uses. Nothing here assigns
//! calibration, sets a goal, blocks Apply or writes anything.

use std::collections::BTreeSet;

use persistence_library::ProjectDarkBasis;
use platevault_pixels::measure;
use uuid::Uuid;

use crate::calibration::{exposure_mismatch, Rules};
use crate::library::Library;
use crate::{LibraryError, MeasurementMethod, ProjectProgress, ProjectWarning};

impl Library {
    /// The goal progress of Project `id`, in goal order, and its warnings.
    /// Goal met reads "in project" only; a warning is never a goal and never
    /// blocks Apply. Read-only.
    ///
    /// # Errors
    /// `NotFound` for an unknown Project; `PersistenceFailure` when the
    /// catalog cannot be read.
    pub async fn project_progress(&self, id: Uuid) -> Result<ProjectProgress, LibraryError> {
        let basis = self.catalog().project_progress_basis(id, &progress_method()).await?;
        let darks = self.catalog().project_dark_basis(id, &Rules).await?;
        Ok(ProjectProgress {
            project_id: basis.project_id,
            revision: basis.revision,
            goals: basis.goals,
            warnings: exposure_warnings(&darks),
        })
    }
}

/// The measurement method a goal's median-FWHM bar reads: this build's.
pub(crate) fn progress_method() -> MeasurementMethod {
    MeasurementMethod::new(measure::METHOD.name, measure::METHOD.version)
}

/// One exposure-mismatch warning per subject, rig and channel whose light
/// sessions find darks that differ from them only in exposure (PRJ-FR-11).
/// In subject order, then channel with `None` last, then rig.
fn exposure_warnings(basis: &ProjectDarkBasis) -> Vec<ProjectWarning> {
    type Exposures = (BTreeSet<String>, BTreeSet<String>);
    let mut found: Vec<((Uuid, Uuid, Option<String>), Exposures)> = Vec::new();
    let mut subjects: Vec<Uuid> = Vec::new();
    for held in &basis.lights {
        if !subjects.contains(&held.subject_id) {
            subjects.push(held.subject_id);
        }
        let Some(mismatch) = exposure_mismatch(&held.light, &basis.darks, &basis.settings) else {
            continue;
        };
        let key = (held.subject_id, held.rig_id, mismatch.channel);
        let at = found.iter().position(|(other, _)| *other == key).unwrap_or_else(|| {
            found.push((key, Exposures::default()));
            found.len() - 1
        });
        found[at].1 .0.extend(mismatch.light_exposures);
        found[at].1 .1.extend(mismatch.dark_exposures);
    }
    let position = |subject: Uuid| subjects.iter().position(|id| *id == subject);
    found.sort_by_key(|((subject, _, channel), _)| {
        (position(*subject), channel.is_none(), channel.clone())
    });
    found
        .into_iter()
        .map(|((subject_id, rig_id, channel), (light, dark))| ProjectWarning::ExposureMismatch {
            subject_id,
            rig_id,
            channel,
            light_exposures: ascending(light),
            dark_exposures: ascending(dark),
        })
        .collect()
}

/// Canonical decimal seconds, ascending by value.
fn ascending(values: BTreeSet<String>) -> Vec<String> {
    let mut values: Vec<String> = values.into_iter().collect();
    values.sort_by(|left, right| match (left.parse::<f64>(), right.parse::<f64>()) {
        (Ok(left), Ok(right)) => left.total_cmp(&right),
        _ => left.cmp(right),
    });
    values
}
