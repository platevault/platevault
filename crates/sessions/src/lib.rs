// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Acquisition and calibration session modeling boundaries.

pub mod clustering;
pub mod key;
pub mod optic_train;

pub use clustering::{
    angular_separation_deg, circular_mean_deg, derive_clustering, fov_diagonal_deg,
    rotation_circular_distance_deg, Assignment, ClusteringResult, ExistingFraming, NewFramingGroup,
    SessionGeometry, ToleranceParams, UnassignedReason,
};
pub use key::{observing_night, session_key, KeyError, ObserverContext};
pub use optic_train::optic_train_key;

pub const CRATE_NAME: &str = "sessions";

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn exposes_crate_name() {
        assert_eq!(CRATE_NAME, "sessions");
    }
}
