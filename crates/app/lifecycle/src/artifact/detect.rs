// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! `detect` — observe and record a new file, or update an existing row in
//! place (A8 rerun).

use audit::bus::EventBus;
use audit::event_bus::{
    ArtifactClassified, ArtifactDetected, ArtifactUpdated, Source, TOPIC_ARTIFACT_CLASSIFIED,
    TOPIC_ARTIFACT_DETECTED, TOPIC_ARTIFACT_UPDATED,
};
use domain_core::ids::{new_id, Timestamp};
use sqlx::SqlitePool;
use workflow_artifacts::{attribute, classify, default_artifact_rules, DEFAULT_ATTRIBUTION_WINDOW};

use persistence_db::repositories::artifacts::{self as repo, InsertArtifact};

use super::{load_launch_refs, parse_dt};

/// Observe and record a new file, or update an existing row in-place (A8 rerun).
///
/// Pipeline:
/// 1. Check if a row for `(project_id, path)` already exists.
/// 2. If yes → in-place update (A8); emit `artifact.updated`.
/// 3. If no → classify → attribute to nearest launch → insert; emit `artifact.detected`.
///
/// # Errors
/// Returns `Err(String)` on DB or audit failure.
pub async fn detect(
    pool: &SqlitePool,
    bus: &EventBus,
    project_id: &str,
    path: &str,
    tool: &str,
    size_bytes: i64,
    file_mtime: &str,
    detected_at: &str,
) -> Result<String, String> {
    // Step 1: check for existing row (upsert path, A8).
    let existing = repo::get_artifact_by_path(pool, project_id, path)
        .await
        .map_err(|e| format!("DB lookup failed: {e}"))?;

    if let Some(ref existing_row) = existing {
        // A8: in-place update — no new detected event.
        let prior_hash = existing_row.content_hash.clone();
        repo::update_artifact_inplace(pool, &existing_row.id, size_bytes, None)
            .await
            .map_err(|e| format!("DB update failed: {e}"))?;

        let now = Timestamp::now_iso();
        let _ = bus
            .publish(
                TOPIC_ARTIFACT_UPDATED,
                Source::System,
                ArtifactUpdated {
                    artifact_id: existing_row.id.clone(),
                    project_id: project_id.to_owned(),
                    path: path.to_owned(),
                    tool: tool.to_owned(),
                    prior_content_hash: prior_hash,
                    new_content_hash: None,
                    updated_at: now,
                },
            )
            .await;
        return Ok(existing_row.id.clone());
    }

    // Step 3a: classify.
    let rules = default_artifact_rules();
    let detect_file_name = std::path::Path::new(path)
        .file_name()
        .map_or_else(|| path.to_owned(), |n| n.to_string_lossy().into_owned());
    let classification = classify(&detect_file_name, &rules);

    // Step 3b: attribute to nearest preceding launch.
    let launches = load_launch_refs(pool, project_id, tool).await?;
    let arrival_dt = parse_dt(detected_at);
    let tool_launch_id =
        arrival_dt.and_then(|dt| attribute(tool, dt, &launches, DEFAULT_ATTRIBUTION_WINDOW));

    // Step 3c: insert.
    let id = new_id();
    let kind_str = classification.kind.as_str();
    let source_str = classification.source.as_str();

    repo::insert_artifact(
        pool,
        InsertArtifact {
            id: &id,
            project_id,
            tool_launch_id: tool_launch_id.as_deref(),
            path,
            kind: kind_str,
            tool,
            detected_at,
            state: "present",
            classification_confidence: classification.confidence,
            classification_source: source_str,
            size_bytes,
            file_mtime,
            content_hash: None,
        },
    )
    .await
    .map_err(|e| format!("DB insert failed: {e}"))?;

    let _ = bus
        .publish(
            TOPIC_ARTIFACT_DETECTED,
            Source::System,
            ArtifactDetected {
                artifact_id: id.clone(),
                project_id: project_id.to_owned(),
                path: path.to_owned(),
                kind: kind_str.to_owned(),
                tool: tool.to_owned(),
                classification_source: source_str.to_owned(),
                classification_confidence: classification.confidence,
                tool_launch_id: tool_launch_id.clone(),
                detected_at: detected_at.to_owned(),
            },
        )
        .await;

    // Emit artifact.classified (spec 033 T028, FR-009) — the second required
    // event that was previously absent from the bus.  Carries the classification
    // result with confidence so UI and audit consumers see both events.
    let _ = bus
        .publish(
            TOPIC_ARTIFACT_CLASSIFIED,
            Source::System,
            ArtifactClassified {
                artifact_id: id.clone(),
                project_id: project_id.to_owned(),
                classification: kind_str.to_owned(),
                confidence: Some(classification.confidence),
                classified_at: detected_at.to_owned(),
            },
        )
        .await;

    Ok(id)
}
