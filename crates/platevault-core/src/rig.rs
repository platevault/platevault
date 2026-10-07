// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Rigs (spec 072 PLAN-EQ-FR-01..06, LIB-FR-05 unknown filter part): the bands
//! a rig captures, its field of view, and the FILTER values its confirmed
//! sessions carry that no filter on its list matches.

use std::collections::BTreeSet;

use uuid::Uuid;

use crate::library::Library;
use crate::{
    Band, ColorKind, Equipment, FieldOfView, LibraryError, Revision, Rig, RigFilter,
    RigFilterValues, RigFilters,
};

/// Bands a rig captures: R, G and B without a filter on an OSC camera, plus
/// every band each listed filter passes, in [`Band`] order. A mono or unknown
/// camera captures only what its filters pass.
#[must_use]
pub fn rig_bands(color_kind: Option<ColorKind>, filters: &[RigFilter]) -> Vec<Band> {
    let mut bands: BTreeSet<Band> =
        filters.iter().flat_map(|filter| filter.bands.iter().copied()).collect();
    if color_kind == Some(ColorKind::Osc) {
        bands.extend([Band::R, Band::G, Band::B]);
    }
    bands.into_iter().collect()
}

/// Field of view from the camera's sensor size and pixel size and the rig's
/// focal length; `None` when any of them is unknown.
#[must_use]
pub fn field_of_view(equipment: &Equipment) -> Option<FieldOfView> {
    let focal_mm = equipment.focal_length_mm?;
    let pixel_mm = equipment.pixel_size_um? / 1000.0;
    let angle =
        |pixels: u32| (f64::from(pixels) * pixel_mm / (2.0 * focal_mm)).atan().to_degrees() * 2.0;
    Some(FieldOfView {
        width_deg: angle(equipment.sensor_width_px?),
        height_deg: angle(equipment.sensor_height_px?),
    })
}

fn rig(equipment: Equipment, filters: RigFilters) -> Rig {
    Rig {
        bands: rig_bands(equipment.color_kind, &filters.filters),
        field_of_view: field_of_view(&equipment),
        equipment,
        filters,
    }
}

impl Library {
    /// A rig with its filter list, captured bands and field of view.
    ///
    /// # Errors
    /// `NotFound` for unknown equipment.
    pub async fn rig(&self, equipment_id: Uuid) -> Result<Rig, LibraryError> {
        let equipment = self.catalog().equipment(equipment_id).await?;
        let filters = self.catalog().rig_filters(equipment_id).await?;
        Ok(rig(equipment, filters))
    }

    /// Replace a rig's filter list; only that rig's list changes. A failed save
    /// leaves the last saved list in effect, and retrying the same list with the
    /// same `expected_revision` saves it.
    ///
    /// # Errors
    /// `InvalidInput`, `NotFound` or `Conflict` as for
    /// [`persistence_library::Catalog::save_rig_filters`], or a
    /// `PersistenceFailure` the caller may retry.
    pub async fn save_rig_filters(
        &self,
        equipment_id: Uuid,
        filters: &[RigFilter],
        expected_revision: Revision,
    ) -> Result<Rig, LibraryError> {
        let filters =
            self.catalog().save_rig_filters(equipment_id, filters, expected_revision).await?;
        let equipment = self.catalog().equipment(equipment_id).await?;
        Ok(rig(equipment, filters))
    }

    /// FILTER values on sessions confirmed to a rig that no filter on that rig
    /// matches, for one rig or every rig, each naming its sessions. A rig with
    /// no unknown value is left out; a session whose rig is not confirmed never
    /// contributes.
    ///
    /// # Errors
    /// `NotFound` for an unknown `equipment_id`; persistence failures.
    pub async fn rig_unknown_filters(
        &self,
        equipment_id: Option<Uuid>,
    ) -> Result<Vec<RigFilterValues>, LibraryError> {
        if let Some(id) = equipment_id {
            self.catalog().equipment(id).await?;
        }
        let mut unknown = Vec::new();
        for mut observed in self.catalog().rig_filter_values(equipment_id).await? {
            let listed = self.catalog().rig_filters(observed.equipment_id).await?.filters;
            observed.values.retain(|seen| !listed.iter().any(|filter| filter.matches(&seen.value)));
            if !observed.values.is_empty() {
                unknown.push(observed);
            }
        }
        Ok(unknown)
    }
}
