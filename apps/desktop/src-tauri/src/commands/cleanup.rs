//! Spec 030 cleanup policy commands (T024).
//!
//! Stubs that return a default cleanup policy and accept updates.
//! Real persistence will be wired when the cleanup policy repository is built.

use contracts_core::cleanup::{
    CleanupAction, CleanupPolicy, CleanupPolicyEntry, CleanupScanResult, UpdateCleanupPolicy,
};

/// `cleanup.policy.get` — returns the current cleanup policy.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta]
pub async fn cleanup_policy_get() -> Result<CleanupPolicy, String> {
    tracing::debug!("stub: cleanup.policy.get");
    Ok(default_cleanup_policy())
}

/// `cleanup.policy.update` — update the cleanup policy.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta]
pub async fn cleanup_policy_update(request: UpdateCleanupPolicy) -> Result<CleanupPolicy, String> {
    tracing::debug!(
        "stub: cleanup.policy.update ({} entries, auto={})",
        request.entries.len(),
        request.auto_on_completion,
    );
    // Echo back as if persisted.
    Ok(CleanupPolicy { entries: request.entries, auto_on_completion: request.auto_on_completion })
}

/// `cleanup.scan` — scan a project for cleanup candidates.
///
/// Returns an empty candidates list as a stub. The real implementation will
/// walk the project file tree and apply the cleanup policy to identify
/// reclaimable artifacts.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta]
pub async fn cleanup_scan(project_id: String) -> Result<CleanupScanResult, String> {
    tracing::debug!("stub: cleanup.scan project_id={project_id}");
    Ok(CleanupScanResult { project_id, candidates: vec![], total_reclaimable_bytes: 0 })
}

fn default_cleanup_policy() -> CleanupPolicy {
    let data_types = [
        "calibrated_lights",
        "registered_lights",
        "drizzle_data",
        "cosmetic_correction",
        "debayered_frames",
        "master_bias",
        "master_dark",
        "master_flat",
        "master_light",
        "processing_logs",
        "sequence_files",
        "light_subs_with_master",
        "dark_subs_with_master",
        "flat_subs_with_master",
        "bias_subs_with_master",
    ];

    CleanupPolicy {
        entries: data_types
            .iter()
            .map(|dt| CleanupPolicyEntry {
                data_type: (*dt).to_owned(),
                action: CleanupAction::Keep,
            })
            .collect(),
        auto_on_completion: false,
    }
}
