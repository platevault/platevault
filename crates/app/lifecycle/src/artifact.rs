// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Application use cases for processing artifact observation (spec 012).
//!
//! ## Entry points
//!
//! - [`detect`]         — record a newly observed file, classify it, attribute it to a launch.
//! - [`list`]           — list artifacts for a project (for the drawer accordion).
//! - [`classify`]       — apply / clear a manual classification override.
//! - [`mark_resolved`]  — mark a missing artifact as user-resolved.
//! - [`reconcile`]      — on-attach rescan: detect new files + mark gone files as missing.
//! - [`reattribute`]    — back-fill `tool_launch_id` after a new `tool.launch` event (T022b).
//! - [`complete_run`]   — set `ToolLaunch.completed_at` and emit `workflow.run_completed` (T022c).
//! - [`resolve_project_id_for_path`] — path→project attribution by
//!   longest-prefix match against registered project roots (spec 012,
//!   package WP-012-A).
//! - [`reattribute_root_keyed_artifacts`] — one-time idempotent startup
//!   fix-up for rows the retired global watcher (pre-#400) keyed by
//!   library-root id instead of project id (WP-012-A).
//!
//! ## Architecture
//!
//! Classification uses `workflow_artifacts::classify` (pure; no DB or I/O).
//! Attribution uses `workflow_artifacts::attribute` (pure timestamp math).
//! Persistence is delegated to `persistence_db::repositories::artifacts`.
//! Audit events are emitted via `audit::bus::EventBus`.
//!
//! Constitution III: this module never opens, processes, or modifies observed files.
//! Constitution V: the DB row is the durable record; the file index is reproducible.
#![allow(clippy::too_many_arguments)]
#![allow(clippy::doc_markdown)]

use audit::bus::EventBus;
use audit::event_bus::{
    ArtifactClassified, ArtifactClassifyOverride, ArtifactClassifyOverrideCleared,
    ArtifactDetected, ArtifactMissing, ArtifactRecovered, ArtifactUpdated, ArtifactUserResolved,
    Source, WorkflowRunCompleted, TOPIC_ARTIFACT_CLASSIFIED, TOPIC_ARTIFACT_CLASSIFY_OVERRIDE,
    TOPIC_ARTIFACT_CLASSIFY_OVERRIDE_CLEARED, TOPIC_ARTIFACT_DETECTED, TOPIC_ARTIFACT_MISSING,
    TOPIC_ARTIFACT_RECOVERED, TOPIC_ARTIFACT_UPDATED, TOPIC_ARTIFACT_USER_RESOLVED,
    TOPIC_WORKFLOW_RUN_COMPLETED,
};
use domain_core::ids::{new_id, Timestamp};
use sqlx::SqlitePool;
use std::path::{Path, PathBuf};
use time::OffsetDateTime;
use workflow_artifacts::{
    attribute, classify, default_artifact_rules, resolve_project_for_path, ArtifactKind, LaunchRef,
    ProjectPathRef, DEFAULT_ATTRIBUTION_WINDOW,
};

use persistence_db::repositories::artifacts::{self as repo, ArtifactRow, InsertArtifact};
use persistence_db::repositories::inventory::list_all_roots;
use persistence_db::repositories::projects::list_projects;
use persistence_db::repositories::tool_launches::{self as tl_repo};

use contracts_core::tools::ArtifactSummary;

// ── Helpers ───────────────────────────────────────────────────────────────────

fn parse_dt(s: &str) -> Option<OffsetDateTime> {
    OffsetDateTime::parse(s, &time::format_description::well_known::Rfc3339).ok()
}

/// Canonicalize `p`, falling back to `p` unchanged when canonicalization
/// fails (path does not exist yet, permission error, etc). Mirrors the
/// existing convention in `app_core::tool_launch`'s cwd-containment check so
/// the two resolution paths agree on what "under this project" means.
fn canonicalize_or_self(p: &Path) -> PathBuf {
    p.canonicalize().unwrap_or_else(|_| p.to_path_buf())
}

// ── Path → project attribution (spec 012, WP-012-A) ──────────────────────────

/// Resolve the id of the project that owns `artifact_path`, by longest-prefix
/// match against every registered project's root path.
///
/// Used by [`reattribute_root_keyed_artifacts`] to determine the real
/// `project_id` for rows the retired global watcher (pre-#400) keyed by the
/// library-root id verbatim (the WP-012-A bug). The live per-project watcher
/// (`apps/desktop/src-tauri/src/watcher.rs`) no longer needs event-time
/// resolution — it knows its project at attach time — so this resolver's
/// remaining runtime consumer is the startup fix-up.
///
/// Returns `Ok(None)` when no registered project's root contains the path —
/// callers MUST NOT fabricate an id in that case; spec 012's data model has
/// no "unattributed project" placeholder (`processing_artifacts.project_id`
/// is `NOT NULL`, migration 0025) and its user stories are scoped to "a
/// project's output folder", so a path outside every known project was never
/// something this feature promised to track.
///
/// # Errors
/// Returns `Err(String)` on DB failure.
pub async fn resolve_project_id_for_path(
    pool: &SqlitePool,
    artifact_path: &str,
) -> Result<Option<String>, String> {
    let projects =
        list_projects(pool).await.map_err(|e| format!("DB list projects failed: {e}"))?;
    if projects.is_empty() {
        return Ok(None);
    }

    let canon_artifact = canonicalize_or_self(Path::new(artifact_path));
    let artifact_str = canon_artifact.to_string_lossy().into_owned();

    let refs: Vec<ProjectPathRef> = projects
        .iter()
        .map(|p| ProjectPathRef {
            id: p.id.clone(),
            path: canonicalize_or_self(Path::new(&p.path)).to_string_lossy().into_owned(),
        })
        .collect();

    Ok(resolve_project_for_path(&artifact_str, &refs))
}

/// One-time, idempotent fix-up for `processing_artifacts` rows that the
/// pre-fix watcher keyed by a *library root* id instead of the owning
/// project's id (WP-012-A). A genuine project id is a UUID from
/// [`domain_core::ids::new_id`] and will never coincide with a
/// `library_root.id`, so any row whose `project_id` matches a real root id
/// is unambiguously mis-attributed.
///
/// For each such row, re-resolves the owning project from the artifact's
/// stored path (same algorithm as [`resolve_project_id_for_path`]) and
/// updates `project_id` in place. Rows whose path no longer matches any
/// registered project are left untouched (never deleted) and logged via
/// `tracing::warn` so they stay investigable.
///
/// Idempotent: once a row is corrected its `project_id` is a real project id
/// (not a root id), so a second pass skips it. Safe to run on every app
/// startup.
///
/// Returns `(re_attributed_count, still_unmatched_count)`.
///
/// # Errors
/// Returns `Err(String)` on DB failure.
pub async fn reattribute_root_keyed_artifacts(pool: &SqlitePool) -> Result<(usize, usize), String> {
    let roots = list_all_roots(pool).await.map_err(|e| format!("DB list roots failed: {e}"))?;
    if roots.is_empty() {
        return Ok((0, 0));
    }
    let root_ids: std::collections::HashSet<&str> = roots.iter().map(|r| r.id.as_str()).collect();

    let identities = repo::list_all_artifact_identities(pool)
        .await
        .map_err(|e| format!("DB list artifact identities failed: {e}"))?;

    let mut fixed = 0usize;
    let mut unmatched = 0usize;
    for identity in identities {
        if !root_ids.contains(identity.project_id.as_str()) {
            // Already keyed to a real project (or already fixed by a prior pass).
            continue;
        }

        let Some(real_project_id) = resolve_project_id_for_path(pool, &identity.path).await? else {
            unmatched += 1;
            tracing::warn!(
                "artifact re-attribution: artifact {} at '{}' still has a library-root id \
                 ({}) as project_id and no registered project claims its path; left as-is \
                 (not deleted)",
                identity.id,
                identity.path,
                identity.project_id
            );
            continue;
        };

        if let Err(e) = repo::set_project_id(pool, &identity.id, &real_project_id).await {
            tracing::warn!(
                "artifact re-attribution: failed to update artifact {} to project {}: {e}",
                identity.id,
                real_project_id
            );
            continue;
        }
        fixed += 1;
    }
    Ok((fixed, unmatched))
}

// ── detect ────────────────────────────────────────────────────────────────────

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

// ── list ──────────────────────────────────────────────────────────────────────

/// List artifacts for a project, converted to `ArtifactSummary` DTOs.
///
/// `include_states`: if empty, defaults to `["present", "missing"]`.
///
/// # Errors
/// Returns `Err(String)` on DB failure.
pub async fn list(
    pool: &SqlitePool,
    project_id: &str,
    include_states: &[&str],
) -> Result<Vec<ArtifactSummary>, String> {
    let states: Vec<&str> = if include_states.is_empty() {
        vec!["present", "missing"]
    } else {
        include_states.to_vec()
    };

    let rows = repo::list_artifacts_for_project(pool, project_id, &states)
        .await
        .map_err(|e| format!("DB list failed: {e}"))?;

    Ok(rows.into_iter().map(row_to_summary).collect())
}

fn row_to_summary(row: ArtifactRow) -> ArtifactSummary {
    ArtifactSummary {
        id: row.id,
        project_id: row.project_id,
        tool_launch_id: row.tool_launch_id,
        path: row.path,
        kind: row.kind,
        tool: row.tool,
        detected_at: row.detected_at,
        last_seen_at: row.last_seen_at,
        state: row.state,
        classification_confidence: row.classification_confidence,
        classification_source: row.classification_source,
        size_bytes: row.size_bytes,
    }
}

// ── classify (override) ───────────────────────────────────────────────────────

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

// ── mark_resolved ─────────────────────────────────────────────────────────────

/// Mark a `missing` artifact as user-resolved.
///
/// # Errors
/// Returns `Err(String)` on DB failure.
pub async fn mark_resolved(
    pool: &SqlitePool,
    bus: &EventBus,
    project_id: &str,
    artifact_id: &str,
) -> Result<(), String> {
    repo::mark_artifact_user_resolved(pool, artifact_id)
        .await
        .map_err(|e| format!("DB mark resolved failed: {e}"))?;

    let now = Timestamp::now_iso();
    let _ = bus
        .publish(
            TOPIC_ARTIFACT_USER_RESOLVED,
            Source::System,
            ArtifactUserResolved {
                artifact_id: artifact_id.to_owned(),
                project_id: project_id.to_owned(),
                at: now,
            },
        )
        .await;
    Ok(())
}

// ── reconcile ─────────────────────────────────────────────────────────────────

/// Mark an artifact as missing (reconciliation pass — file gone from disk).
///
/// # Errors
/// Returns `Err(String)` on DB failure.
pub async fn mark_missing(
    pool: &SqlitePool,
    bus: &EventBus,
    project_id: &str,
    artifact_id: &str,
    path: &str,
) -> Result<(), String> {
    repo::mark_artifact_missing(pool, artifact_id)
        .await
        .map_err(|e| format!("DB mark missing failed: {e}"))?;

    let now = Timestamp::now_iso();
    let _ = bus
        .publish(
            TOPIC_ARTIFACT_MISSING,
            Source::System,
            ArtifactMissing {
                artifact_id: artifact_id.to_owned(),
                project_id: project_id.to_owned(),
                path: path.to_owned(),
                at: now.clone(),
            },
        )
        .await;

    // spec 048 US5 (FR-024, PATH A): flag any calibration match whose
    // master's generated master file is this now-missing artifact.
    emit_calibration_match_flag_for_artifact(pool, bus, artifact_id, &now, false).await;

    Ok(())
}

/// Mark an artifact as recovered (reconciliation — file back on disk).
///
/// # Errors
/// Returns `Err(String)` on DB failure.
pub async fn mark_recovered(
    pool: &SqlitePool,
    bus: &EventBus,
    project_id: &str,
    artifact_id: &str,
    path: &str,
    size_bytes: i64,
) -> Result<(), String> {
    repo::mark_artifact_recovered(pool, artifact_id, size_bytes, None)
        .await
        .map_err(|e| format!("DB mark recovered failed: {e}"))?;

    let now = Timestamp::now_iso();
    let _ = bus
        .publish(
            TOPIC_ARTIFACT_RECOVERED,
            Source::System,
            ArtifactRecovered {
                artifact_id: artifact_id.to_owned(),
                project_id: project_id.to_owned(),
                path: path.to_owned(),
                at: now.clone(),
            },
        )
        .await;

    // spec 048 US5 (FR-025): clear "master missing" on any calibration match
    // whose master's generated master file is this now-recovered artifact.
    emit_calibration_match_flag_for_artifact(pool, bus, artifact_id, &now, true).await;

    Ok(())
}

/// spec 048 US5 (FR-024/025, PATH A): emit `calibration_match.source_missing`
/// / `.source_recovered` for every calibration match whose master's
/// generated master file is `artifact_id`. Best-effort — a lookup/publish
/// failure here must not fail the artifact reconcile pass, since the flag is
/// re-derived live on next read regardless (never the durable record).
async fn emit_calibration_match_flag_for_artifact(
    pool: &SqlitePool,
    bus: &EventBus,
    artifact_id: &str,
    at: &str,
    recovered: bool,
) {
    let Ok(assignments) =
        persistence_db::repositories::calibration_assignment::find_by_source_artifact(
            pool,
            artifact_id,
        )
        .await
    else {
        return;
    };
    for assignment in assignments {
        if recovered {
            let _ = bus
                .publish(
                    audit::event_bus::TOPIC_CALIBRATION_MATCH_SOURCE_RECOVERED,
                    Source::System,
                    audit::event_bus::CalibrationMatchSourceRecovered {
                        match_id: assignment.id,
                        frame_id: artifact_id.to_owned(),
                        at: at.to_owned(),
                    },
                )
                .await;
        } else {
            let _ = bus
                .publish(
                    audit::event_bus::TOPIC_CALIBRATION_MATCH_SOURCE_MISSING,
                    Source::System,
                    audit::event_bus::CalibrationMatchSourceMissing {
                        match_id: assignment.id,
                        frame_id: artifact_id.to_owned(),
                        at: at.to_owned(),
                    },
                )
                .await;
        }
    }
}

// ── reattribute ───────────────────────────────────────────────────────────────

/// Back-fill `tool_launch_id` for artifacts detected before the launch row was
/// persisted (A7 re-attribution on `tool.launch` event).
///
/// Fetches all artifacts for the project, then updates those whose `detected_at`
/// falls within the attribution window AND whose current attribution is null or
/// earlier than `new_launch`.
///
/// # Errors
/// Returns `Err(String)` on DB failure.
pub async fn reattribute(
    pool: &SqlitePool,
    project_id: &str,
    new_launch_id: &str,
    new_launch_tool_id: &str,
    new_launch_launched_at: &str,
) -> Result<usize, String> {
    let rows = repo::list_artifacts_for_project(pool, project_id, &[])
        .await
        .map_err(|e| format!("DB list failed: {e}"))?;

    let new_launch_dt = parse_dt(new_launch_launched_at)
        .ok_or_else(|| format!("invalid launched_at: {new_launch_launched_at}"))?;

    let new_launch = LaunchRef {
        id: new_launch_id.to_owned(),
        tool_id: new_launch_tool_id.to_owned(),
        launched_at: new_launch_dt,
    };

    // Load existing launches to determine ordering.
    let existing = load_launch_refs(pool, project_id, new_launch_tool_id).await?;

    // Build candidate list.
    let triplets: Vec<(String, OffsetDateTime, Option<String>)> = rows
        .iter()
        .filter(|r| r.tool == new_launch_tool_id)
        .filter_map(|r| {
            let dt = parse_dt(&r.detected_at)?;
            Some((r.id.clone(), dt, r.tool_launch_id.clone()))
        })
        .collect();

    let candidates = workflow_artifacts::reattribute_candidates(
        &new_launch,
        &triplets,
        &existing,
        DEFAULT_ATTRIBUTION_WINDOW,
    );

    let mut updated = 0usize;
    for artifact_id in candidates {
        repo::set_tool_launch_id(pool, artifact_id, new_launch_id)
            .await
            .map_err(|e| format!("DB re-attribute failed: {e}"))?;
        updated += 1;
    }
    Ok(updated)
}

// ── complete_run ──────────────────────────────────────────────────────────────

/// Mark a tool launch complete and emit `workflow.run_completed` (T022c).
///
/// Sets `tool_launches.completed_at` and emits the event that spec 024
/// subscribes to for manifest creation.
///
/// # Errors
/// Returns `Err(String)` on DB or audit failure.
pub async fn complete_run(
    pool: &SqlitePool,
    bus: &EventBus,
    project_id: &str,
    tool_id: &str,
    tool_launch_id: &str,
) -> Result<bool, String> {
    let completed_at = Timestamp::now_iso();
    let updated = repo::complete_tool_launch(pool, tool_launch_id, &completed_at)
        .await
        .map_err(|e| format!("DB complete_run failed: {e}"))?;

    if updated {
        let artifact_ids = repo::list_artifact_ids_for_launch(pool, tool_launch_id)
            .await
            .map_err(|e| format!("DB artifact ids failed: {e}"))?;

        let _ = bus
            .publish(
                TOPIC_WORKFLOW_RUN_COMPLETED,
                Source::System,
                WorkflowRunCompleted {
                    project_id: project_id.to_owned(),
                    tool_id: tool_id.to_owned(),
                    tool_launch_id: tool_launch_id.to_owned(),
                    completed_at,
                    artifact_ids,
                },
            )
            .await;
    }

    Ok(updated)
}

// ── sweep_stale_launches ────────────────────────────────────────────────────────

/// Complete any of a project's open tool launches whose attribution window
/// has closed (#727 / FR-010's stated heuristic: a launch is terminal when
/// the attribution window elapses after the last artifact attributed to it
/// was last seen — or, when nothing was ever attributed, after the launch
/// itself started).
///
/// This is the real production trigger for [`complete_run`]: it is polled
/// periodically by the live per-project watcher
/// (`apps/desktop/src-tauri/src/watcher.rs`) while a project's drawer is
/// open. Previously `complete_run` had no production caller at all, so
/// `workflow.run_completed` (and the spec 024 manifest subscriber that
/// depends on it) never fired outside tests.
///
/// Returns the number of launches completed.
///
/// # Errors
/// Returns `Err(String)` on DB failure.
pub async fn sweep_stale_launches(
    pool: &SqlitePool,
    bus: &EventBus,
    project_id: &str,
) -> Result<usize, String> {
    let launches = tl_repo::list_launches_for_project(pool, project_id)
        .await
        .map_err(|e| format!("DB launches failed: {e}"))?;
    let open: Vec<_> = launches
        .into_iter()
        .filter(|l| l.outcome == "spawned" && l.completed_at.is_none())
        .collect();
    if open.is_empty() {
        return Ok(0);
    }

    let artifacts = repo::list_artifacts_for_project(pool, project_id, &[])
        .await
        .map_err(|e| format!("DB artifacts failed: {e}"))?;

    let now = OffsetDateTime::now_utc();
    let mut completed = 0usize;
    for launch in open {
        let last_seen = artifacts
            .iter()
            .filter(|a| a.tool_launch_id.as_deref() == Some(launch.id.as_str()))
            .filter_map(|a| parse_dt(&a.last_seen_at))
            .max();
        let Some(reference) = last_seen.or_else(|| parse_dt(&launch.launched_at)) else {
            continue; // unparseable timestamp; leave for the next sweep
        };
        if now - reference >= DEFAULT_ATTRIBUTION_WINDOW
            && complete_run(pool, bus, project_id, &launch.tool_id, &launch.id).await?
        {
            completed += 1;
        }
    }
    Ok(completed)
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/// Load `LaunchRef` entries for a project + tool from the `tool_launches` table.
async fn load_launch_refs(
    pool: &SqlitePool,
    project_id: &str,
    tool_id: &str,
) -> Result<Vec<LaunchRef>, String> {
    let rows = tl_repo::list_launches_for_project(pool, project_id)
        .await
        .map_err(|e| format!("DB launches failed: {e}"))?;

    let refs = rows
        .into_iter()
        .filter(|r| r.tool_id == tool_id)
        .filter_map(|r| {
            let dt = parse_dt(&r.launched_at)?;
            Some(LaunchRef { id: r.id, tool_id: r.tool_id, launched_at: dt })
        })
        .collect();
    Ok(refs)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    async fn make_pool() -> SqlitePool {
        let db = persistence_db::Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        db.pool().clone()
    }

    fn make_bus(pool: &SqlitePool) -> EventBus {
        EventBus::with_pool(pool.clone())
    }

    #[tokio::test]
    async fn detect_inserts_classified_artifact() {
        let pool = make_pool().await;
        let bus = make_bus(&pool);

        let id = detect(
            &pool,
            &bus,
            "proj-1",
            "output/MasterDark_bin1x1.xisf",
            "pixinsight",
            2048,
            "2026-06-01T09:55:00Z",
            "2026-06-01T10:00:00Z",
        )
        .await
        .unwrap();

        assert!(!id.is_empty());

        let artifacts = list(&pool, "proj-1", &[]).await.unwrap();
        assert_eq!(artifacts.len(), 1);
        assert_eq!(artifacts[0].kind, "master");
        assert_eq!(artifacts[0].classification_source, "rule");
    }

    #[tokio::test]
    async fn detect_unknown_file_falls_back_to_intermediate() {
        let pool = make_pool().await;
        let bus = make_bus(&pool);

        detect(
            &pool,
            &bus,
            "proj-1",
            "output/random_output.xisf",
            "pixinsight",
            1024,
            "2026-06-01T09:55:00Z",
            "2026-06-01T10:00:00Z",
        )
        .await
        .unwrap();

        let artifacts = list(&pool, "proj-1", &[]).await.unwrap();
        assert_eq!(artifacts[0].kind, "intermediate");
        assert_eq!(artifacts[0].classification_source, "fallback");
        assert!(artifacts[0].classification_confidence < 0.2);
    }

    #[tokio::test]
    async fn classify_override_applies_and_clears() {
        let pool = make_pool().await;
        let bus = make_bus(&pool);

        let art_id = detect(
            &pool,
            &bus,
            "proj-1",
            "output/img.xisf",
            "pixinsight",
            512,
            "2026-06-01T09:55:00Z",
            "2026-06-01T10:00:00Z",
        )
        .await
        .unwrap();

        // Apply override → final.
        let summary =
            classify_override(&pool, &bus, "proj-1", &art_id, Some("final"), None).await.unwrap();
        assert_eq!(summary.kind, "final");
        assert_eq!(summary.classification_source, "manual_override");
        #[allow(clippy::float_cmp)]
        {
            assert_eq!(summary.classification_confidence, 1.0);
        }

        // Clear override.
        let summary2 = classify_override(&pool, &bus, "proj-1", &art_id, None, None).await.unwrap();
        // After clearing, rule-based or fallback classification applies.
        assert!(
            summary2.classification_source == "rule"
                || summary2.classification_source == "fallback"
        );
    }

    /// T018: classify -> override -> rescan -> override preserved. A rescan
    /// is a second `detect()` call on the same path; the A8 in-place-update
    /// branch never touches `kind`/`classification_source` (see
    /// `detect_inplace_update_on_rerun`), so an override must survive it —
    /// this asserts that combination explicitly rather than relying on two
    /// separate tests to imply it.
    #[tokio::test]
    async fn classify_override_survives_rescan() {
        let pool = make_pool().await;
        let bus = make_bus(&pool);

        let art_id = detect(
            &pool,
            &bus,
            "proj-1",
            "output/img.xisf",
            "pixinsight",
            512,
            "2026-06-01T09:55:00Z",
            "2026-06-01T10:00:00Z",
        )
        .await
        .unwrap();

        classify_override(&pool, &bus, "proj-1", &art_id, Some("master"), None).await.unwrap();

        // Rescan: same path, updated size/mtime (e.g. the file grew).
        let rescanned_id = detect(
            &pool,
            &bus,
            "proj-1",
            "output/img.xisf",
            "pixinsight",
            1024,
            "2026-06-01T11:55:00Z",
            "2026-06-01T12:00:00Z",
        )
        .await
        .unwrap();
        assert_eq!(art_id, rescanned_id, "rescan must update the same row, not create a new one");

        let artifacts = list(&pool, "proj-1", &[]).await.unwrap();
        let row = artifacts.iter().find(|a| a.id == art_id).unwrap();
        assert_eq!(row.kind, "master", "override kind must survive a rescan");
        assert_eq!(
            row.classification_source, "manual_override",
            "override source must survive a rescan"
        );
    }

    #[tokio::test]
    async fn detect_inplace_update_on_rerun() {
        let pool = make_pool().await;
        let bus = make_bus(&pool);

        let id1 = detect(
            &pool,
            &bus,
            "proj-1",
            "output/img.xisf",
            "pixinsight",
            1024,
            "2026-06-01T09:55:00Z",
            "2026-06-01T10:00:00Z",
        )
        .await
        .unwrap();

        // Second detect on same path → A8 in-place update, same id.
        let id2 = detect(
            &pool,
            &bus,
            "proj-1",
            "output/img.xisf",
            "pixinsight",
            2048,
            "2026-06-01T11:55:00Z",
            "2026-06-01T12:00:00Z",
        )
        .await
        .unwrap();

        assert_eq!(id1, id2, "A8: same path must return same artifact id");

        // Only one row.
        let artifacts = list(&pool, "proj-1", &[]).await.unwrap();
        assert_eq!(artifacts.len(), 1);
    }

    #[tokio::test]
    async fn mark_missing_and_resolved() {
        let pool = make_pool().await;
        let bus = make_bus(&pool);

        let art_id = detect(
            &pool,
            &bus,
            "proj-1",
            "output/img.xisf",
            "pixinsight",
            512,
            "2026-06-01T09:55:00Z",
            "2026-06-01T10:00:00Z",
        )
        .await
        .unwrap();

        mark_missing(&pool, &bus, "proj-1", &art_id, "output/img.xisf").await.unwrap();
        let arts = list(&pool, "proj-1", &["missing"]).await.unwrap();
        assert_eq!(arts.len(), 1);
        assert_eq!(arts[0].state, "missing");

        mark_resolved(&pool, &bus, "proj-1", &art_id).await.unwrap();
        // user_resolved_missing rows are excluded from default listing.
        let present = list(&pool, "proj-1", &["present", "missing"]).await.unwrap();
        assert!(present.is_empty());
    }

    #[tokio::test]
    async fn complete_run_emits_workflow_run_completed() {
        let pool = make_pool().await;
        let bus = make_bus(&pool);

        // Insert a tool launch row.
        sqlx::query(
            "INSERT INTO tool_launches (id, project_id, tool_id, launched_at, outcome, audit_id)
             VALUES ('tl-1','proj-1','pixinsight','2026-06-01T08:00:00Z','spawned','aud-1')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let updated = complete_run(&pool, &bus, "proj-1", "pixinsight", "tl-1").await.unwrap();
        assert!(updated);

        // Idempotent second call.
        let updated2 = complete_run(&pool, &bus, "proj-1", "pixinsight", "tl-1").await.unwrap();
        assert!(!updated2);
    }

    // ── sweep_stale_launches (#727) ─────────────────────────────────────────────

    #[tokio::test]
    async fn sweep_completes_launch_with_no_recent_activity() {
        let pool = make_pool().await;
        let bus = make_bus(&pool);

        // Launched long enough ago (> DEFAULT_ATTRIBUTION_WINDOW = 6h) with no
        // artifacts ever attributed to it — the sweep must complete it.
        sqlx::query(
            "INSERT INTO tool_launches (id, project_id, tool_id, launched_at, outcome, audit_id)
             VALUES ('tl-stale','proj-1','pixinsight','2020-01-01T00:00:00Z','spawned','aud-1')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let completed = sweep_stale_launches(&pool, &bus, "proj-1").await.unwrap();
        assert_eq!(completed, 1);

        let launches = tl_repo::list_launches_for_project(&pool, "proj-1").await.unwrap();
        assert!(launches[0].completed_at.is_some());
    }

    #[tokio::test]
    async fn sweep_leaves_recently_launched_run_open() {
        let pool = make_pool().await;
        let bus = make_bus(&pool);

        let recent = Timestamp::now_iso();
        sqlx::query(
            "INSERT INTO tool_launches (id, project_id, tool_id, launched_at, outcome, audit_id)
             VALUES ('tl-fresh','proj-1',?,?, 'spawned','aud-1')",
        )
        .bind("pixinsight")
        .bind(&recent)
        .execute(&pool)
        .await
        .unwrap();

        let completed = sweep_stale_launches(&pool, &bus, "proj-1").await.unwrap();
        assert_eq!(completed, 0);

        let launches = tl_repo::list_launches_for_project(&pool, "proj-1").await.unwrap();
        assert!(launches[0].completed_at.is_none());
    }

    #[tokio::test]
    async fn sweep_uses_last_artifact_activity_not_launch_time() {
        let pool = make_pool().await;
        let bus = make_bus(&pool);

        // Launch started long ago, but an artifact under it was seen recently
        // (e.g. re-touched by an on-attach reconciliation pass) — the run is
        // still active and must NOT be completed.
        sqlx::query(
            "INSERT INTO tool_launches (id, project_id, tool_id, launched_at, outcome, audit_id)
             VALUES ('tl-active','proj-1','pixinsight','2020-01-01T00:00:00Z','spawned','aud-1')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let art_id = detect(
            &pool,
            &bus,
            "proj-1",
            "output/img.xisf",
            "pixinsight",
            512,
            "2020-01-01T00:05:00Z",
            "2020-01-01T00:05:00Z",
        )
        .await
        .unwrap();
        repo::set_tool_launch_id(&pool, &art_id, "tl-active").await.unwrap();
        repo::touch_artifact(&pool, &art_id).await.unwrap(); // bumps last_seen_at to now

        let completed = sweep_stale_launches(&pool, &bus, "proj-1").await.unwrap();
        assert_eq!(completed, 0);
    }

    // ── T028: artifact.detected AND artifact.classified both emitted (FR-009) ──

    #[tokio::test]
    async fn detect_emits_artifact_detected_and_artifact_classified() {
        use audit::event_bus::{TOPIC_ARTIFACT_CLASSIFIED, TOPIC_ARTIFACT_DETECTED};

        let pool = make_pool().await;
        let bus = make_bus(&pool);

        // Subscribe BEFORE detect so we capture the events.
        let mut rx = bus.subscribe();

        detect(
            &pool,
            &bus,
            "proj-t028",
            "output/MasterFlat_bin1x1.xisf",
            "pixinsight",
            1024,
            "2026-06-01T09:55:00Z",
            "2026-06-01T10:00:00Z",
        )
        .await
        .unwrap();

        // Collect events published synchronously by the detect call.
        // EventBus.publish is async; read with a short timeout.
        let mut detected = false;
        let mut classified = false;
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(1);
        while !(detected && classified) {
            match tokio::time::timeout_at(deadline, rx.recv()).await {
                Ok(Ok(env)) if env.topic == TOPIC_ARTIFACT_DETECTED => {
                    detected = true;
                    // Payload must have artifact_id.
                    assert!(env.payload.get("artifactId").is_some());
                    assert_eq!(env.payload["projectId"].as_str(), Some("proj-t028"));
                }
                Ok(Ok(env)) if env.topic == TOPIC_ARTIFACT_CLASSIFIED => {
                    classified = true;
                    // Payload must have classification and confidence.
                    assert!(env.payload.get("classification").is_some());
                    assert!(env.payload.get("confidence").is_some());
                    assert_eq!(env.payload["projectId"].as_str(), Some("proj-t028"));
                }
                Ok(Ok(_)) => {} // other topics, keep draining
                Ok(Err(_)) | Err(_) => break,
            }
        }

        assert!(detected, "artifact.detected must be emitted by detect()");
        assert!(classified, "artifact.classified must be emitted by detect() (T028 FR-009)");
    }

    #[tokio::test]
    async fn artifact_classify_response_is_flat_shape() {
        // Verifies the contract: ArtifactClassifyResponse has flat fields,
        // not a nested { artifact: … } envelope (spec 033 T028 regression guard).
        use contracts_core::tools::ArtifactClassifyResponse;
        let pool = make_pool().await;
        let bus = make_bus(&pool);

        let art_id = detect(
            &pool,
            &bus,
            "proj-flat",
            "output/img.xisf",
            "pixinsight",
            512,
            "2026-06-01T09:55:00Z",
            "2026-06-01T10:00:00Z",
        )
        .await
        .unwrap();

        // Simulate what the Tauri command does: call classify_override then build
        // ArtifactClassifyResponse with the flat shape.
        let summary = classify_override(&pool, &bus, "proj-flat", &art_id, Some("final"), None)
            .await
            .unwrap();

        let resp = ArtifactClassifyResponse {
            artifact_id: summary.id.clone(),
            classification: summary.kind.clone(),
            confidence: Some(summary.classification_confidence),
            classified_at: "2026-06-01T10:01:00Z".to_owned(),
        };

        // Serialise and check the JSON does NOT have a nested "artifact" key.
        let json = serde_json::to_value(&resp).unwrap();
        assert!(
            json.get("artifact").is_none(),
            "flat shape must not have nested 'artifact' key; got: {json}"
        );
        assert_eq!(json["artifactId"].as_str(), Some(summary.id.as_str()));
        assert_eq!(json["classification"].as_str(), Some("final"));
        assert!(json.get("confidence").is_some());
    }
}
