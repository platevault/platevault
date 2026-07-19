// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Project create/update/source/channel use cases (spec 008 F-3).
//!
//! Entry points:
//! - [`create`]          — validate, persist, infer channels, emit audit.
//! - [`update`]          — patch name/tool/notes; enforce tool-lock + read-only.
//! - [`add_source`]      — link an Inventory session; snapshot fields; recompute channels.
//! - [`remove_source`]   — unlink a source; gate on lifecycle; re-check ready trigger.
//! - [`reinfer_channels`]  — recompute channels from scratch; reset drift.
//! - [`dismiss_drift`]     — reset channel drift flag without changing channels.
//!
//! Auto-transition seam (spec 009): after `create`, `add_source`, and `update`
//! this module checks whether `setup_incomplete → ready` should fire (tool != null
//! AND ≥1 source linked). When the condition is met it directly updates the
//! lifecycle column via the repository. Spec 009 will own the full lifecycle
//! service; the auto-transition here is the thin seam described in tasks.md F-3
//! (R-Ready-Trigger). The `new_lifecycle` field in the response is the signal
//! the UI should surface.
//!
//! Constitution II: `create` generates a reviewable `FilesystemPlan` via
//! `domain_core::lifecycle::plan` + `crates/persistence/db::repositories::plans`.
//! The plan contains one `mkdir` item per folder required by the project's tool
//! (from `crates/project/structure::required_folders`) plus a `write_manifest`
//! item for the project marker.  The plan is returned as `plan_id` in the
//! response; the caller drives approval + application via specs 017/025.
//!
//! Constitution V: SQLite is the durable record; audit events are emitted via
//! the `EventBus` for every mutation.
//!
//! Split by responsibility (refactor sweep #972): [`create`] owns path
//! anchoring + the Constitution II folder plan builder; [`update`] is
//! metadata-only; [`sources`] links/unlinks Inventory sessions and recomputes
//! channels; [`channels`] handles the reinfer/dismiss-drift pair; [`read`]
//! covers the `list`/`get` DTO projections. Helpers shared by more than one
//! use case (error mapping, exposure/channel aggregation, the auto-transition
//! seam, the source-change manifest trigger) stay here so siblings pull them
//! via `super::`.

use contracts_core::projects_v2::ProjectChannelDto;
use contracts_core::{error_code::ErrorCode, ContractError, ErrorSeverity};
use domain_core::project::channels::{infer_channels, Channel};
use persistence_db::repositories::projects as repo;
use sqlx::SqlitePool;

use crate::project_health;

mod channels;
mod create;
mod read;
mod sources;
mod update;

#[cfg(test)]
mod tests;

pub use channels::{dismiss_drift, reinfer_channels};
pub use create::create;
pub use read::{get, list};
pub use sources::{add_source, remove_source};
pub use update::update;

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Map a static `&str` validation error code (returned by `domain_core::project::validate`)
/// to the corresponding `ErrorCode` variant.
fn str_to_error_code(code: &str) -> ErrorCode {
    match code {
        "name.empty" => ErrorCode::NameEmpty,
        "name.too_long" => ErrorCode::NameTooLong,
        "tool.unknown" => ErrorCode::ToolUnknown,
        _ => {
            tracing::warn!("unknown validation code '{code}', using InternalData");
            ErrorCode::InternalData
        }
    }
}

fn db_err(e: persistence_db::DbError) -> ContractError {
    match e {
        persistence_db::DbError::NotFound(msg) => {
            ContractError::new(ErrorCode::ProjectNotFound, msg, ErrorSeverity::Blocking, false)
        }
        other => app_core_errors::db_err(other),
    }
}

/// Parse an `exposure_snapshot` string (e.g. `"300s"`, `"1.5s"`) into whole
/// seconds (D5: parse at read time; the write path / stored format is
/// unchanged — see `persistence_db::repositories::inbox::format_exposure_label`
/// for the writer this mirrors).
///
/// Never panics: missing, empty, or unparseable values (e.g. `"Mixed"` from
/// a multi-value grouping bucket, or a bare `"na"`) degrade to `0` with a
/// debug-level log line rather than surfacing an error. Fractional seconds
/// are truncated toward zero.
fn parse_exposure_seconds(exposure: &str) -> u64 {
    let trimmed = exposure.trim();
    if trimmed.is_empty() {
        return 0;
    }
    let numeric = trimmed.strip_suffix('s').unwrap_or(trimmed);
    match numeric.parse::<f64>() {
        // Guarded by `v.is_finite() && v >= 0.0`, so truncation only ever
        // drops a fractional-second remainder and sign loss cannot occur.
        #[allow(clippy::cast_sign_loss, clippy::cast_possible_truncation)]
        Ok(v) if v.is_finite() && v >= 0.0 => v as u64,
        _ => {
            tracing::debug!("unparseable exposure snapshot '{exposure}', treating as 0s");
            0
        }
    }
}

/// Per-channel aggregate totals (sub-frame count, integration seconds),
/// grouped by `filter_snapshot`. Channel labels are matched against this map
/// by exact (case-sensitive) string equality — the same rule
/// `domain_core::project::channels::infer_channels` uses to derive labels
/// from filters in the first place.
fn channel_totals_by_filter(
    sources: &[repo::ProjectSourceRow],
) -> std::collections::HashMap<String, (u32, u64)> {
    let mut totals: std::collections::HashMap<String, (u32, u64)> =
        std::collections::HashMap::new();
    for s in sources {
        if s.filter_snapshot.is_empty() {
            continue;
        }
        let frames = u32::try_from(s.frames_snapshot).unwrap_or(0);
        let secs = parse_exposure_seconds(&s.exposure_snapshot);
        let entry = totals.entry(s.filter_snapshot.clone()).or_insert((0, 0));
        entry.0 = entry.0.saturating_add(frames);
        entry.1 = entry.1.saturating_add(u64::from(frames).saturating_mul(secs));
    }
    totals
}

/// Convert a slice of DB channel rows to contract DTOs, aggregating
/// `subFrames`/`totalIntegrationS` from the project's linked sources (P7).
fn channels_to_dto(
    rows: &[repo::ProjectChannelRow],
    sources: &[repo::ProjectSourceRow],
) -> Vec<ProjectChannelDto> {
    let totals = channel_totals_by_filter(sources);
    rows.iter()
        .map(|r| {
            let (sub_frames, total_integration_s) = totals.get(&r.label).copied().unwrap_or((0, 0));
            ProjectChannelDto {
                label: r.label.clone(),
                source: r.source.clone(),
                added_at: Some(r.added_at.clone()),
                sub_frames,
                total_integration_s,
            }
        })
        .collect()
}

/// Convert a domain `Channel` (label + source only) to a contract DTO,
/// aggregating `subFrames`/`totalIntegrationS` from a pre-computed totals map
/// (P7). Used by the three call sites that build channels from a freshly
/// recomputed `Vec<Channel>` rather than DB rows.
fn channel_dto_from_domain(
    channel: Channel,
    added_at: &str,
    totals: &std::collections::HashMap<String, (u32, u64)>,
) -> ProjectChannelDto {
    let (sub_frames, total_integration_s) = totals.get(&channel.label).copied().unwrap_or((0, 0));
    ProjectChannelDto {
        label: channel.label,
        source: channel.source,
        added_at: Some(added_at.to_owned()),
        sub_frames,
        total_integration_s,
    }
}

/// Convert a DB source row to a contract DTO.
fn source_to_dto(row: &repo::ProjectSourceRow) -> contracts_core::projects_v2::ProjectSourceDto {
    // `role` and `selection` are None until spec 003 Inventory integration
    // provides confirmed session metadata with role + selection snapshots.
    contracts_core::projects_v2::ProjectSourceDto {
        inventory_id: row.inventory_session_id.clone(),
        name: row.name_snapshot.clone(),
        frames: u32::try_from(row.frames_snapshot).unwrap_or(0),
        filter: row.filter_snapshot.clone(),
        exposure: row.exposure_snapshot.clone(),
        linked_at: row.linked_at.clone(),
        role: None,
        selection: None,
    }
}

/// Derive the filter slice from source rows and call domain `infer_channels`.
fn infer_from_sources(sources: &[repo::ProjectSourceRow]) -> Vec<Channel> {
    let filters: Vec<&str> = sources.iter().map(|s| s.filter_snapshot.as_str()).collect();
    infer_channels(&filters)
}

/// Persist channels (replace_project_channels expects `&[(&str, &str)]`).
async fn persist_channels(
    pool: &SqlitePool,
    project_id: &str,
    channels: &[Channel],
) -> Result<(), persistence_db::DbError> {
    let pairs: Vec<(String, String)> =
        channels.iter().map(|c| (c.label.clone(), c.source.clone())).collect();
    let refs: Vec<(&str, &str)> = pairs.iter().map(|(l, s)| (l.as_str(), s.as_str())).collect();
    repo::replace_project_channels(pool, project_id, &refs).await
}

/// Attempt the `setup_incomplete → ready` auto-transition (R-Ready-Trigger).
///
/// Delegates to `project_health::check_project_ready_invariant` which is the
/// single source of truth for this invariant (spec 009 P8). The lifecycle
/// service writes the audit row and publishes `project.lifecycle.ready`.
///
/// Returns the new lifecycle string if the transition was applied.
async fn maybe_auto_ready(
    pool: &SqlitePool,
    bus: &audit::bus::EventBus,
    project_id: &str,
    current_lifecycle: &str,
) -> Result<Option<String>, persistence_db::DbError> {
    if current_lifecycle != "setup_incomplete" {
        return Ok(None);
    }
    project_health::check_project_ready_invariant(pool, bus, project_id)
        .await
        .map_err(|e| persistence_db::DbError::NotFound(e.to_string()))
}

/// Attempt the `ready → setup_incomplete` regression when all sources removed.
async fn maybe_regress_to_incomplete(
    pool: &SqlitePool,
    project_id: &str,
    current_lifecycle: &str,
) -> Result<Option<String>, persistence_db::DbError> {
    if current_lifecycle != "ready" {
        return Ok(None);
    }
    let sources = repo::list_project_sources(pool, project_id).await?;
    if !sources.is_empty() {
        return Ok(None);
    }
    repo::update_project_lifecycle(pool, project_id, "setup_incomplete").await?;
    Ok(Some("setup_incomplete".to_owned()))
}

/// Fire the `SourceChange` manifest trigger after a source is linked/unlinked
/// (#665 — project create, source add/remove, and lifecycle transitions had
/// no emitters at all; this covers the source add/remove half).
///
/// Best-effort: a manifest write failure must never fail the source
/// add/remove use case itself (Constitution V — the DB row for the mutation
/// itself already succeeded; the manifest is a documentation side-effect).
/// Delegates to the shared `project_manifests::write_lifecycle_manifest`
/// (re-reads the project row, so the just-applied lifecycle change from
/// `maybe_auto_ready`/`maybe_regress_to_incomplete` is already reflected).
async fn write_source_change_manifest(
    pool: &SqlitePool,
    bus: &audit::bus::EventBus,
    project_id: &str,
) {
    use contracts_core::manifests::ManifestReason as DtoManifestReason;

    crate::project_manifests::write_lifecycle_manifest(
        pool,
        bus,
        project_id,
        DtoManifestReason::SourceChange,
    )
    .await;
}
