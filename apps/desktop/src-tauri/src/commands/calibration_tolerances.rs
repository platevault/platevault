//! Spec 030 calibration tolerances commands (T025).
//!
//! Stubs that return default tolerances and accept updates.
//! Real persistence will be wired when the tolerances repository is built.

use contracts_core::calibration_tolerances::{CalibrationTolerances, UpdateCalibrationTolerances};

/// `calibration.tolerances.get` — returns current calibration matching tolerances.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta]
pub async fn calibration_tolerances_get() -> Result<CalibrationTolerances, String> {
    tracing::debug!("stub: calibration.tolerances.get");
    Ok(default_tolerances())
}

/// `calibration.tolerances.update` — update calibration matching tolerances.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta]
pub async fn calibration_tolerances_update(
    request: UpdateCalibrationTolerances,
) -> Result<CalibrationTolerances, String> {
    tracing::debug!(
        "stub: calibration.tolerances.update temp={}C exp={}s",
        request.temperature_tolerance_c,
        request.exposure_tolerance_s,
    );
    // Echo back as if persisted.
    Ok(CalibrationTolerances {
        temperature_tolerance_c: request.temperature_tolerance_c,
        exposure_tolerance_s: request.exposure_tolerance_s,
        aging_limit_days: request.aging_limit_days,
        require_same_camera: request.require_same_camera,
        require_same_gain: request.require_same_gain,
        require_same_binning: request.require_same_binning,
    })
}

fn default_tolerances() -> CalibrationTolerances {
    CalibrationTolerances {
        temperature_tolerance_c: 5.0,
        exposure_tolerance_s: 2.0,
        aging_limit_days: 365,
        require_same_camera: true,
        require_same_gain: true,
        require_same_binning: true,
    }
}
