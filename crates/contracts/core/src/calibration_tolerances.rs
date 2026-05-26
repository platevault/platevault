//! Calibration tolerance contract DTOs for the Tauri IPC surface.

use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationTolerances {
    pub temperature_tolerance_c: f64,
    pub exposure_tolerance_s: f64,
    pub aging_limit_days: i32,
    pub require_same_camera: bool,
    pub require_same_gain: bool,
    pub require_same_binning: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCalibrationTolerances {
    pub temperature_tolerance_c: f64,
    pub exposure_tolerance_s: f64,
    pub aging_limit_days: i32,
    pub require_same_camera: bool,
    pub require_same_gain: bool,
    pub require_same_binning: bool,
}
