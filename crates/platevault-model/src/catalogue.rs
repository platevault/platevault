// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Bundled catalogue facts carried by a target candidate (spec 072
//! PLAN-TGT-FR-02 catalogue membership, PLAN-TGT-FR-11 angular size).

use serde::{Deserialize, Serialize};

/// A catalogue the Targets page can browse.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Catalogue {
    Messier,
    Ngc,
    Ic,
    Caldwell,
    Sharpless,
    Lbn,
    Ldn,
    Barnard,
}

impl Catalogue {
    /// Every browsable catalogue, in display order.
    pub const ALL: [Self; 8] = [
        Self::Messier,
        Self::Ngc,
        Self::Ic,
        Self::Caldwell,
        Self::Sharpless,
        Self::Lbn,
        Self::Ldn,
        Self::Barnard,
    ];
}

/// One catalogue entry an object is listed under.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogueMembership {
    pub catalogue: Catalogue,
    /// Designation within the catalogue, for example `M 31` or `Caldwell 14`.
    pub designation: String,
    /// Leading catalogue number for ordering; `None` for designations that
    /// carry none (LBN Galactic-coordinate names such as `LBN 169.02-15.54`).
    pub number: Option<u32>,
}

/// Catalogued angular size. Present only when the major axis is known; an
/// object with no catalogued size has no `AngularSize` at all.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AngularSize {
    pub major_arcmin: f64,
    pub minor_arcmin: Option<f64>,
    /// Position angle of the major axis, degrees east of north.
    pub pa_deg: Option<f64>,
}
