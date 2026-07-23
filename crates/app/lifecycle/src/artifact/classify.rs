// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! `classify_override` — apply or clear a manual classification override.

use audit::bus::EventBus;
use audit::event_bus::{
    ArtifactClassifyOverride, ArtifactClassifyOverrideCleared, Source,
    TOPIC_ARTIFACT_CLASSIFY_OVERRIDE, TOPIC_ARTIFACT_CLASSIFY_OVERRIDE_CLEARED,
};
use domain_core::ids::Timestamp;
use sqlx::SqlitePool;
use workflow_artifacts::{classify, default_artifact_rules, ArtifactKind};

use persistence_db::repositories::artifacts::{self as repo};

use contracts_core::tools::ArtifactSummary;

use super::row_to_summary;

/// Apply or clear a manual classification override.
///
/// - `kind = Some(k)`: insert/replace override row; set `classification_source = manual_override`.
/// - `kind = None`:    delete override row; re-run rule classification (A6).
///
/// # Errors
/// Returns `Err(String)` on DB failure or if artifact not found.
pub async fn classify_override(
    pool: &SqlitePool,
    bus: &EventBus,
    project_id: &str,
    artifact_id: &str,
    kind: Option<&str>,
    reason: Option<&str>,
) -> Result<ArtifactSummary, String> {
    // Fetch the artifact to validate it exists and belongs to the project.
    let rows = repo::list_artifacts_for_project(pool, project_id, &[])
        .await
        .map_err(|e| format!("DB list failed: {e}"))?;
    let row = rows
        .into_iter()
        .find(|r| r.id == artifact_id)
        .ok_or_else(|| format!("artifact.not_found: {artifact_id}"))?;

    let now = Timestamp::now_iso();

    if let Some(new_kind) = kind {
        // Validate kind value.
        ArtifactKind::try_from_str(new_kind)
            .map_err(|_| format!("artifact.kind_invalid: {new_kind}"))?;

        repo::upsert_override(pool, artifact_id, new_kind, reason)
            .await
            .map_err(|e| format!("DB override failed: {e}"))?;

        let _ = bus
            .publish(
                TOPIC_ARTIFACT_CLASSIFY_OVERRIDE,
                Source::System,
                ArtifactClassifyOverride {
                    artifact_id: artifact_id.to_owned(),
                    project_id: project_id.to_owned(),
                    new_kind: new_kind.to_owned(),
                    reason: reason.map(ToOwned::to_owned),
                    at: now,
                },
            )
            .await;
    } else {
        // A6: clear override, re-run rule classification.
        let prior_kind = row.kind.clone();
        let _cleared = repo::clear_override(pool, artifact_id)
            .await
            .map_err(|e| format!("DB clear override failed: {e}"))?;

        let override_file_name = std::path::Path::new(&row.path)
            .file_name()
            .map_or_else(|| row.path.clone(), |n| n.to_string_lossy().into_owned());
        let rules = default_artifact_rules();
        let classification = classify(&override_file_name, &rules);

        repo::update_classification(
            pool,
            artifact_id,
            classification.kind.as_str(),
            classification.confidence,
            classification.source.as_str(),
        )
        .await
        .map_err(|e| format!("DB update classification failed: {e}"))?;

        let _ = bus
            .publish(
                TOPIC_ARTIFACT_CLASSIFY_OVERRIDE_CLEARED,
                Source::System,
                ArtifactClassifyOverrideCleared {
                    artifact_id: artifact_id.to_owned(),
                    project_id: project_id.to_owned(),
                    prior_kind,
                    new_kind: classification.kind.as_str().to_owned(),
                    at: now,
                },
            )
            .await;
    }

    // Return refreshed summary.
    let refreshed = repo::list_artifacts_for_project(pool, project_id, &[])
        .await
        .map_err(|e| format!("DB refresh failed: {e}"))?;
    let updated = refreshed
        .into_iter()
        .find(|r| r.id == artifact_id)
        .ok_or("artifact vanished after update")?;
    Ok(row_to_summary(updated))
}
