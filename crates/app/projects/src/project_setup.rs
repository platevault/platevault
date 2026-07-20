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

use crate::project_health;
use audit::bus::EventBus;
use audit::event_bus::Source;
use contracts_core::projects_v2::{
    ChannelDriftDto, ProjectChannelDto, ProjectChannelsDismissDriftRequest,
    ProjectChannelsDismissDriftResult, ProjectChannelsReinferRequest, ProjectChannelsReinferResult,
    ProjectCreateRequest, ProjectCreateResult, ProjectDetailDto, ProjectSourceAddRequest,
    ProjectSourceAddResult, ProjectSourceDto, ProjectSourceRemoveRequest,
    ProjectSourceRemoveResult, ProjectSummaryDto, ProjectTool, ProjectUpdateRequest,
    ProjectUpdateResult,
};
use contracts_core::{error_code::ErrorCode, ContractError, ErrorSeverity};
use domain_core::first_run::SourceKind;
use domain_core::ids::{new_id, Timestamp};
use domain_core::project::channels::{
    infer_channels, merge_channels, reinfer_channels as domain_reinfer, Channel,
};
use domain_core::project::validate::{
    is_read_only, is_source_remove_locked, is_tool_locked, validate_name, validate_tool,
};
use persistence_db::repositories::first_run as first_run_repo;
use persistence_db::repositories::plans as plans_repo;
use persistence_db::repositories::projects as repo;
use persistence_db::repositories::q_core;
use project_structure::{required_folders, ProcessingTool as StructureTool, MARKER_FILENAME};
use sqlx::SqlitePool;

use app_core_errors::bus_err;

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

/// A project source's snapshot of its inventory session, taken at link time
/// (#1218). Empty strings / `0` mean "the session does not carry this value",
/// which is what every field was hardcoded to before this was wired.
#[derive(Debug, Default)]
struct SourceSnapshot {
    name: String,
    frames: i64,
    filter: String,
    exposure: String,
}

/// Read the snapshot fields for one inventory (acquisition) session.
///
/// - `filter` comes from the session key, whose format `crates/sessions`
///   owns (`sessions::parse_session_key`); it is the same value the Sessions
///   surfaces show.
/// - `frames` is the ACTIVE (non-`missing`) frame count, matching
///   `app_core::sessions`' honest counts rather than the raw `frame_ids` length.
/// - `exposure` is a PER-SUB token (`"300s"`), never total integration time —
///   `parse_exposure_seconds` and the source-view `{exposure}` path token both
///   read it that way. Exposure is not part of the session key, so a session
///   may hold several distinct per-sub exposures; only a session with exactly
///   ONE distinct value gets a token. With zero (no metadata) or several, no
///   scalar is truthful, so the field stays empty and the pattern registry's
///   documented `unknown-exposure` fallback applies rather than inventing a
///   directory name that reads like a real exposure.
///
/// An unknown session id yields an all-empty snapshot: source linking is
/// best-effort and must never fail project creation.
async fn source_snapshot(
    pool: &SqlitePool,
    inventory_session_id: &str,
) -> Result<SourceSnapshot, ContractError> {
    let Some(row) = q_core::get_session_joined(pool, inventory_session_id).await.map_err(db_err)?
    else {
        return Ok(SourceSnapshot::default());
    };

    let key = sessions::parse_session_key(&row.session_key);
    let target = row.canonical_target_name.filter(|n| !n.is_empty()).or(key.target);
    let filter = key.filter.unwrap_or_default();

    let frame_ids: Vec<String> = serde_json::from_str(&row.frame_ids).unwrap_or_default();
    let (frames, _bytes) = q_core::active_frame_summary(pool, &frame_ids).await.map_err(db_err)?;
    let exposures = q_core::active_frame_exposures(pool, &frame_ids).await.map_err(db_err)?;
    let exposure = match exposures.as_slice() {
        [only] => persistence_db::repositories::inbox::format_exposure_label(*only),
        _ => String::new(),
    };

    // Mirrors `app_core::inventory::derive_session_name`, so a linked source
    // shows the same label the Sessions/Inventory surfaces show.
    let name = target.map_or_else(String::new, |t| {
        let filter_part = if filter.is_empty() { "?" } else { filter.as_str() };
        let night = key.night.unwrap_or_default();
        format!("{t} · {filter_part} — {night}")
    });

    Ok(SourceSnapshot { name, frames, filter, exposure })
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
fn source_to_dto(row: &repo::ProjectSourceRow) -> ProjectSourceDto {
    // `role` and `selection` are None until spec 003 Inventory integration
    // provides confirmed session metadata with role + selection snapshots.
    ProjectSourceDto {
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
    bus: &EventBus,
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
async fn write_source_change_manifest(pool: &SqlitePool, bus: &EventBus, project_id: &str) {
    use contracts_core::manifests::ManifestReason as DtoManifestReason;

    crate::project_manifests::write_lifecycle_manifest(
        pool,
        bus,
        project_id,
        DtoManifestReason::SourceChange,
    )
    .await;
}

// ── Path anchoring (Constitution I) ───────────────────────────────────────────

/// Resolve the requested project path to an unambiguous absolute location.
///
/// `projects.path` is consumed as an absolute path by every downstream reader
/// (scaffolding `mkdir` executor, spec-011 tool-launch cwd, artifact watcher,
/// spec-024 manifests). The creation wizard historically submitted a
/// library-relative path (`projects/<slug>`) which was stored verbatim and
/// silently resolved against the process CWD at each consumer. Constitution I
/// models roots separately from relative paths, so a relative request path is
/// anchored here — at creation — to the registered project folder
/// (`registered_sources.kind = 'project'`, earliest registration wins).
///
/// Rules:
/// - `..` components are rejected (`path.invalid`) — a project path must not
///   escape its anchor;
/// - an absolute path is used as-is (validated downstream by containment);
/// - a relative path is joined onto the registered project folder;
/// - a relative path with no registered project folder is rejected
///   (`path.invalid`) — there is no unambiguous location to anchor to.
async fn anchor_project_path(pool: &SqlitePool, raw: &str) -> Result<String, ContractError> {
    let trimmed = raw.trim();
    let candidate = std::path::Path::new(trimmed);

    if candidate.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err(ContractError::new(
            ErrorCode::PathInvalid,
            "Project path must not contain '..' components.",
            ErrorSeverity::Blocking,
            false,
        ));
    }

    if candidate.is_absolute() {
        return Ok(trimmed.to_owned());
    }

    let project_root = first_run_repo::list_sources(pool)
        .await
        .map_err(db_err)?
        .into_iter()
        .find(|s| s.kind == SourceKind::Project)
        .map(|s| s.path);

    let Some(root) = project_root else {
        return Err(ContractError::new(
            ErrorCode::PathInvalid,
            "Project path is relative and no project folder is registered; \
             register a project folder in setup or provide an absolute path.",
            ErrorSeverity::Blocking,
            false,
        ));
    };

    // Join with '/' (valid on all supported platforms); strip trailing
    // separators from the root so the stored path has a single separator.
    Ok(format!("{}/{}", root.trim_end_matches(['/', '\\']), trimmed))
}

// ── Folder plan builder (Constitution II) ─────────────────────────────────────

/// One resolved (not yet persisted) folder-plan item destination.
struct FolderPlanItemData {
    id: String,
    name: String,
    action: &'static str,
    to_relative_path: String,
    reason: &'static str,
}

/// Resolved (not yet persisted) folder-structure plan for a project
/// (Constitution II): one `mkdir` item per sub-folder required by the tool
/// (`project_structure::required_folders`) plus one `write_manifest` item for
/// the app-owned project marker.
struct FolderPlanData {
    plan_id: String,
    plan_title: String,
    items: Vec<FolderPlanItemData>,
}

/// Resolve the folder-structure plan for `project_path`/`tool_str` without
/// touching the database (pure). The caller borrows these owned strings into
/// `persistence_db::repositories::plans::{InsertPlan, InsertPlanItem}` for
/// [`repo::create_project_tx`], which persists the plan (in `draft`, then
/// advanced to `ready_for_review`) atomically with the rest of project
/// creation.
fn build_folder_plan_data(project_path: &str, tool_str: &str) -> FolderPlanData {
    let plan_id = new_id();
    let tool = StructureTool::parse(tool_str).unwrap_or(StructureTool::PixInsight);
    let folders = required_folders(tool);
    let plan_title = format!("Create project folder structure: {project_path}");

    let mut items = Vec::with_capacity(folders.len() + 1);
    for folder in &folders {
        items.push(FolderPlanItemData {
            id: new_id(),
            name: folder.0.clone(),
            action: "mkdir",
            to_relative_path: format!("{project_path}/{}", folder.0),
            reason: "Create project sub-folder for tool workflow",
        });
    }
    // One write_manifest item for the project marker file.
    items.push(FolderPlanItemData {
        id: new_id(),
        name: MARKER_FILENAME.to_owned(),
        action: "write_manifest",
        to_relative_path: format!("{project_path}/{MARKER_FILENAME}"),
        reason: "Write app-owned project marker file",
    });

    FolderPlanData { plan_id, plan_title, items }
}

// ── project.create ────────────────────────────────────────────────────────────

/// Create a new project.
///
/// Validates name (non-empty, ≤120 chars, unique), tool (canonical value),
/// path (unique within library). A relative request path is anchored to the
/// registered project folder before storage so `projects.path` is always an
/// unambiguous absolute location (Constitution I; see [`anchor_project_path`]).
/// Persists the project in `setup_incomplete`,
/// links any `initial_sources`, infers channels, checks the auto-ready trigger,
/// and emits a `project.created` audit event.
///
/// Constitution II: folder structure creation goes through a persisted,
/// auditable FilesystemPlan returned as `plan_id`. Application is driven by
/// the caller: the app_core `project_create` orchestration auto-applies the
/// plan when every action is directory creation (user decision 2026-07-04,
/// supersedes handover D16) and falls back to the manual review flow
/// otherwise.
///
/// # Errors
///
/// Returns `ContractError` on validation failure or database error.
#[allow(clippy::too_many_lines)]
pub async fn create(
    pool: &SqlitePool,
    bus: &EventBus,
    redb_cache: &dyn simbad_resolver::Cache,
    req: &ProjectCreateRequest,
) -> Result<ProjectCreateResult, ContractError> {
    // 1. Validate name.
    validate_name(&req.name).map_err(|code| {
        ContractError::new(
            str_to_error_code(code),
            format!("Project name error: {code}"),
            ErrorSeverity::Blocking,
            false,
        )
    })?;
    validate_tool(req.tool.as_db_str()).map_err(|code| {
        ContractError::new(
            str_to_error_code(code),
            format!("Processing tool error: {code}"),
            ErrorSeverity::Blocking,
            false,
        )
    })?;

    // 2. Check name uniqueness.
    if let Some(conflict_id) = repo::name_exists(pool, &req.name, None).await.map_err(db_err)? {
        return Err(ContractError::new(
            ErrorCode::NameDuplicate,
            "A project with this name already exists.",
            ErrorSeverity::Blocking,
            false,
        )
        .with_details(serde_json::json!({ "conflictingProjectId": conflict_id })));
    }

    // 3. Validate path non-empty.
    if req.path.trim().is_empty() {
        return Err(ContractError::new(
            ErrorCode::PathInvalid,
            "Project path must not be empty.",
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // 3b. Anchor a relative path to the registered project folder so the
    //     stored path is an unambiguous absolute location (Constitution I).
    let project_path = anchor_project_path(pool, &req.path).await?;

    // 4. Check path uniqueness (on the anchored path).
    if let Some(collide_id) = repo::path_exists(pool, &project_path, None).await.map_err(db_err)? {
        return Err(ContractError::new(
            ErrorCode::PathCollision,
            "Another project already uses this path.",
            ErrorSeverity::Blocking,
            false,
        )
        .with_details(serde_json::json!({ "collidingProjectId": collide_id })));
    }

    let project_id = new_id();
    let now = Timestamp::now_iso();

    // Promote the optional canonical target into the durable table if it
    // isn't already there (spec 052 P1 FR-004: adding a target to a project
    // is an in-use commit). `target.resolve`/`target.search` no longer write
    // `canonical_target` themselves, so `ctid` is typically a redb-cache-only
    // id at this point; a dangling id (unknown to both stores) is still
    // rejected rather than silently stored.
    if let Some(ctid) = req.canonical_target_id.as_deref() {
        let uuid = uuid::Uuid::parse_str(ctid).map_err(|_| {
            ContractError::new(
                ErrorCode::CanonicalTargetNotFound,
                "The selected target was not found.",
                ErrorSeverity::Blocking,
                false,
            )
            .with_details(serde_json::json!({ "canonicalTargetId": ctid }))
        })?;
        let promoted = app_core_targets::target_resolve::promote_by_id(
            pool,
            redb_cache,
            uuid,
            &req.request_id,
        )
        .await?;
        if !promoted {
            return Err(ContractError::new(
                ErrorCode::CanonicalTargetNotFound,
                "The selected target was not found.",
                ErrorSeverity::Blocking,
                false,
            )
            .with_details(serde_json::json!({ "canonicalTargetId": ctid })));
        }
    }

    // 5. Build the project row, initial source links, inferred channels, and
    //    the Constitution II folder-structure plan (+ items) — every write
    //    this use case needs — then persist them as ONE atomic unit via
    //    `create_project_tx`. A mid-sequence database failure previously left
    //    a half-built project (project row with no sources/channels/plan);
    //    see `docs/development/duplication-and-abstraction-audit.md` T2-a.
    let insert = repo::InsertProject {
        id: &project_id,
        name: &req.name,
        tool: req.tool.as_db_str(),
        lifecycle: "setup_incomplete",
        path: &project_path,
        notes: req.notes.as_deref(),
        canonical_target_id: req.canonical_target_id.as_deref(),
        is_mosaic: req.is_mosaic,
    };

    // Link initial sources (best-effort: an id with no acquisition session is
    // linked with an empty snapshot rather than failing the create). Ids are
    // pre-generated so `source_rows` (used for channel inference and the
    // response DTOs) and `source_data` (borrowed into the composite insert)
    // can share them without re-querying the DB.
    //
    // Snapshots are resolved HERE, before `create_project_tx`, because that
    // call must stay one atomic unit (see the comment above `insert`).
    let source_ids: Vec<String> = req.initial_sources.iter().map(|_| new_id()).collect();
    let mut snapshots: Vec<SourceSnapshot> = Vec::with_capacity(req.initial_sources.len());
    for inv_id in &req.initial_sources {
        snapshots.push(source_snapshot(pool, inv_id).await?);
    }
    let source_rows: Vec<repo::ProjectSourceRow> = req
        .initial_sources
        .iter()
        .zip(source_ids.iter())
        .zip(snapshots.iter())
        .map(|((inv_id, src_id), snap)| repo::ProjectSourceRow {
            id: src_id.clone(),
            project_id: project_id.clone(),
            inventory_session_id: inv_id.clone(),
            name_snapshot: snap.name.clone(),
            frames_snapshot: snap.frames,
            filter_snapshot: snap.filter.clone(),
            exposure_snapshot: snap.exposure.clone(),
            linked_at: now.clone(),
        })
        .collect();
    let source_data: Vec<repo::InsertProjectSource> = req
        .initial_sources
        .iter()
        .zip(source_ids.iter())
        .zip(snapshots.iter())
        .map(|((inv_id, src_id), snap)| repo::InsertProjectSource {
            id: src_id,
            project_id: &project_id,
            inventory_session_id: inv_id,
            name_snapshot: &snap.name,
            frames_snapshot: snap.frames,
            filter_snapshot: &snap.filter,
            exposure_snapshot: &snap.exposure,
            linked_at: &now,
        })
        .collect();

    // Infer channels from initial sources.
    let channels = infer_from_sources(&source_rows);
    let channel_pairs: Vec<(&str, &str)> =
        channels.iter().map(|c| (c.label.as_str(), c.source.as_str())).collect();

    // Constitution II folder-structure plan.
    let folder_plan = build_folder_plan_data(&project_path, req.tool.as_db_str());
    let plan_items: Vec<plans_repo::InsertPlanItem> = folder_plan
        .items
        .iter()
        .enumerate()
        .map(|(idx, item)| plans_repo::InsertPlanItem {
            id: &item.id,
            plan_id: &folder_plan.plan_id,
            item_index: i64::try_from(idx).unwrap_or(0),
            name: &item.name,
            action: item.action,
            from_root_id: None,
            from_relative_path: "",
            to_root_id: None,
            to_relative_path: &item.to_relative_path,
            reason: item.reason,
            protection: "normal",
            linked_entity: Some(&project_id),
            provenance_json: None,
            archive_path: None,
            // Project setup items create app-managed folders/files; source
            // protection does not apply.
            source_id: None,
            category: None,
        })
        .collect();
    let plan_data = plans_repo::InsertPlan {
        id: &folder_plan.plan_id,
        title: &folder_plan.plan_title,
        origin: "project",
        origin_path: Some(&project_path),
        plan_type: "project_create",
        destructive_destination: "archive",
        parent_plan_id: None,
        total_bytes_required: 0,
    };

    let create_input = repo::CreateProjectInput {
        project: insert,
        sources: &source_data,
        channels: &channel_pairs,
        channels_added_at: &now,
        plan: plan_data,
        plan_items: &plan_items,
    };
    repo::create_project_tx(pool, &create_input).await.map_err(db_err)?;
    let plan_id = folder_plan.plan_id;

    // 6. Auto-transition setup_incomplete → ready if sources are present.
    let final_lifecycle = maybe_auto_ready(pool, bus, &project_id, "setup_incomplete")
        .await
        .map_err(db_err)?
        .unwrap_or_else(|| "setup_incomplete".to_owned());

    // 7. Audit.
    let audit_id = new_id();
    bus.publish(
        "project.created",
        Source::User,
        serde_json::json!({
            "auditId": audit_id,
            "projectId": project_id,
            "name": req.name,
            "tool": req.tool.as_db_str(),
            "lifecycle": final_lifecycle,
            "sourceCount": source_rows.len(),
            "isMosaic": req.is_mosaic,
        }),
    )
    .await
    .map_err(bus_err)?;

    let channel_totals = channel_totals_by_filter(&source_rows);
    let channel_dtos: Vec<ProjectChannelDto> =
        channels.into_iter().map(|c| channel_dto_from_domain(c, &now, &channel_totals)).collect();

    Ok(ProjectCreateResult {
        project_id,
        is_mosaic: req.is_mosaic,
        lifecycle: final_lifecycle,
        plan_id: Some(plan_id),
        channels: channel_dtos,
        audit_id,
        created_at: now,
        // Set by the app_core `project_create` orchestration when the
        // scaffolding plan qualifies for mkdir-only auto-apply (user decision
        // 2026-07-04). This module only persists the reviewable plan.
        scaffold_applied: None,
    })
}

// ── project.update ────────────────────────────────────────────────────────────

/// Update whitelisted metadata fields (name, tool, notes).
///
/// Enforces:
/// - `lifecycle == "archived"` → `lifecycle.read_only`
/// - `tool` change when `lifecycle in {prepared, processing, completed, blocked}` → `tool.locked`
/// - At least one field must change.
///
/// # Errors
///
/// Returns `ContractError` on validation failure or database error.
pub async fn update(
    pool: &SqlitePool,
    bus: &EventBus,
    req: &ProjectUpdateRequest,
) -> Result<ProjectUpdateResult, ContractError> {
    let row = repo::get_project(pool, &req.project_id).await.map_err(db_err)?;

    // Check read-only lifecycle.
    if is_read_only(&row.lifecycle) {
        return Err(ContractError::new(
            ErrorCode::LifecycleReadOnly,
            "This project is archived and cannot be edited.",
            ErrorSeverity::Blocking,
            false,
        )
        .with_details(serde_json::json!({ "currentLifecycle": row.lifecycle })));
    }

    // Check tool lock.
    if req.tool.is_some() && is_tool_locked(&row.lifecycle) {
        return Err(ContractError::new(
            ErrorCode::ToolLocked,
            "Tool cannot be changed in the current lifecycle state.",
            ErrorSeverity::Blocking,
            false,
        )
        .with_details(serde_json::json!({ "currentLifecycle": row.lifecycle })));
    }

    // Check no-op.
    let name_changing = req.name.as_deref().is_some_and(|n| n != row.name);
    let tool_changing = req.tool.is_some_and(|t| t.as_db_str() != row.tool);
    let notes_changing = req.notes.as_deref().is_some_and(|n| row.notes.as_deref() != Some(n));
    let is_mosaic_changing = req.is_mosaic.is_some_and(|m| m != row.is_mosaic);

    if !name_changing && !tool_changing && !notes_changing && !is_mosaic_changing {
        return Err(ContractError::new(
            ErrorCode::NoOp,
            "No fields were changed.",
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // Validate new name if changing.
    if let Some(new_name) = &req.name {
        validate_name(new_name).map_err(|code| {
            ContractError::new(
                str_to_error_code(code),
                format!("Name error: {code}"),
                ErrorSeverity::Blocking,
                false,
            )
        })?;
        if let Some(conflict_id) =
            repo::name_exists(pool, new_name, Some(&req.project_id)).await.map_err(db_err)?
        {
            return Err(ContractError::new(
                ErrorCode::NameDuplicate,
                "A project with this name already exists.",
                ErrorSeverity::Blocking,
                false,
            )
            .with_details(serde_json::json!({ "conflictingProjectId": conflict_id })));
        }
    }

    let new_tool_str: Option<String> = req.tool.map(|t| t.as_db_str().to_owned());
    let updated_at = repo::update_project_fields(
        pool,
        &req.project_id,
        req.name.as_deref(),
        new_tool_str.as_deref(),
        req.notes.as_deref(),
        req.is_mosaic,
    )
    .await
    .map_err(db_err)?;

    let mut fields_updated: Vec<String> = Vec::new();
    if name_changing {
        fields_updated.push("name".to_owned());
    }
    if tool_changing {
        fields_updated.push("tool".to_owned());
    }
    if notes_changing {
        fields_updated.push("notes".to_owned());
    }
    if is_mosaic_changing {
        fields_updated.push("isMosaic".to_owned());
    }

    let audit_id = new_id();
    bus.publish(
        "project.updated",
        Source::User,
        serde_json::json!({
            "auditId": audit_id,
            "projectId": req.project_id,
            "fieldsUpdated": fields_updated,
        }),
    )
    .await
    .map_err(bus_err)?;

    Ok(ProjectUpdateResult {
        project_id: req.project_id.clone(),
        fields_updated,
        audit_id,
        updated_at,
    })
}

// ── project.source.add ────────────────────────────────────────────────────────

/// Link an Inventory session to an existing project.
///
/// Enforces:
/// - Project exists.
/// - Source not already linked (`source.already.linked`).
/// - Lifecycle not archived.
///
/// Note (D9, 2026-07-03): the old spec-002 `source.not_confirmed` gate against
/// `acquisition_sessions.state` is descoped. Post spec-041, sessions are
/// derived, already-confirmed inventory (there is no unconfirmed state left to
/// gate on), so no confirmation check runs here.
///
/// Recomputes channel inference and merges with existing manual channels.
/// Sets `channel_drift = true` when channels were manually overridden before.
/// Fires auto-transition `setup_incomplete → ready` (R-Ready-Trigger).
///
/// # Errors
///
/// Returns `ContractError` on validation failure or database error.
pub async fn add_source(
    pool: &SqlitePool,
    bus: &EventBus,
    req: &ProjectSourceAddRequest,
) -> Result<ProjectSourceAddResult, ContractError> {
    let row = repo::get_project(pool, &req.project_id).await.map_err(db_err)?;

    // Check archived lifecycle.
    if row.lifecycle == "archived" {
        return Err(ContractError::new(
            ErrorCode::LifecycleReadOnly,
            "Sources cannot be added to an archived project.",
            ErrorSeverity::Blocking,
            false,
        )
        .with_details(serde_json::json!({ "currentLifecycle": row.lifecycle })));
    }

    // Check duplicate.
    let existing_sources =
        repo::list_project_sources(pool, &req.project_id).await.map_err(db_err)?;
    if let Some(dupe) =
        existing_sources.iter().find(|s| s.inventory_session_id == req.inventory_session_id)
    {
        return Err(ContractError::new(
            ErrorCode::SourceAlreadyLinked,
            "This inventory session is already linked to the project.",
            ErrorSeverity::Blocking,
            false,
        )
        .with_details(serde_json::json!({ "existingLinkAt": dupe.linked_at })));
    }

    // D9 (2026-07-03): no confirmation gate here — sessions are derived,
    // already-confirmed inventory post spec-041, so there is no
    // `source.not_confirmed` state to check.

    let now = Timestamp::now_iso();
    let src_id = new_id();

    let snap = source_snapshot(pool, &req.inventory_session_id).await?;
    let src_data = repo::InsertProjectSource {
        id: &src_id,
        project_id: &req.project_id,
        inventory_session_id: &req.inventory_session_id,
        name_snapshot: &snap.name,
        frames_snapshot: snap.frames,
        filter_snapshot: &snap.filter,
        exposure_snapshot: &snap.exposure,
        linked_at: &now,
    };
    repo::insert_project_source(pool, &src_data).await.map_err(db_err)?;

    // Recompute channels.
    let all_sources = repo::list_project_sources(pool, &req.project_id).await.map_err(db_err)?;
    let existing_channels =
        repo::list_project_channels(pool, &req.project_id).await.map_err(db_err)?;

    let new_inferred = infer_from_sources(&all_sources);
    let existing_domain: Vec<Channel> = existing_channels
        .iter()
        .map(|r| Channel { label: r.label.clone(), source: r.source.clone() })
        .collect();
    let merged = merge_channels(&new_inferred, &existing_domain);
    persist_channels(pool, &req.project_id, &merged).await.map_err(db_err)?;

    // Set channel_drift if there were any manual channels previously.
    let had_manual = existing_domain.iter().any(|c| c.source == "manual");
    if had_manual {
        repo::set_channel_drift(pool, &req.project_id, true).await.map_err(db_err)?;
    }

    // Auto-transition setup_incomplete → ready.
    let new_lifecycle =
        maybe_auto_ready(pool, bus, &req.project_id, &row.lifecycle).await.map_err(db_err)?;

    // Audit.
    let audit_id = new_id();
    bus.publish(
        "project.source.added",
        Source::User,
        serde_json::json!({
            "auditId": audit_id,
            "projectId": req.project_id,
            "inventorySessionId": req.inventory_session_id,
        }),
    )
    .await
    .map_err(bus_err)?;

    write_source_change_manifest(pool, bus, &req.project_id).await;

    let added_row = repo::ProjectSourceRow {
        id: src_id,
        project_id: req.project_id.clone(),
        inventory_session_id: req.inventory_session_id.clone(),
        name_snapshot: snap.name,
        frames_snapshot: snap.frames,
        filter_snapshot: snap.filter,
        exposure_snapshot: snap.exposure,
        linked_at: now.clone(),
    };

    let channel_totals = channel_totals_by_filter(&all_sources);
    let channel_dtos: Vec<ProjectChannelDto> =
        merged.into_iter().map(|c| channel_dto_from_domain(c, &now, &channel_totals)).collect();

    Ok(ProjectSourceAddResult {
        project_id: req.project_id.clone(),
        source_added: source_to_dto(&added_row),
        channels: channel_dtos,
        audit_id,
        linked_at: now,
        new_lifecycle,
    })
}

// ── project.source.remove ─────────────────────────────────────────────────────

/// Remove a source link from a project.
///
/// Enforces:
/// - Project and source exist.
/// - `lifecycle not in {prepared, processing, completed, archived}` (FR-011).
/// - Last-source confirmation gate: if removing the last source, `confirm_last_source`
///   must be `true`; otherwise returns `lifecycle.last_confirmed_source`.
///
/// Checks `ready → setup_incomplete` regression after removal.
///
/// # Errors
///
/// Returns `ContractError` on validation or database error.
pub async fn remove_source(
    pool: &SqlitePool,
    bus: &EventBus,
    req: &ProjectSourceRemoveRequest,
) -> Result<ProjectSourceRemoveResult, ContractError> {
    let row = repo::get_project(pool, &req.project_id).await.map_err(db_err)?;

    // Check lifecycle lock for source removal.
    if is_source_remove_locked(&row.lifecycle) {
        return Err(ContractError::new(
            ErrorCode::LifecycleReadOnly,
            "Sources cannot be removed in the current lifecycle state.",
            ErrorSeverity::Blocking,
            false,
        )
        .with_details(serde_json::json!({ "currentLifecycle": row.lifecycle })));
    }

    // Verify source exists.
    let sources = repo::list_project_sources(pool, &req.project_id).await.map_err(db_err)?;
    if !sources.iter().any(|s| s.inventory_session_id == req.project_source_id) {
        return Err(ContractError::new(
            ErrorCode::SourceNotFound,
            "Source not found on this project.",
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // Last-source confirmation gate.
    if sources.len() == 1 && !req.confirm_last_source {
        return Err(ContractError::new(
            ErrorCode::LifecycleLastConfirmedSource,
            "Removing the last source requires explicit confirmation.",
            ErrorSeverity::Blocking,
            false,
        )
        .with_details(serde_json::json!({ "remainingConfirmedCount": 0 })));
    }

    // Delete the source row.
    repo::delete_project_source(pool, &req.project_id, &req.project_source_id)
        .await
        .map_err(db_err)?;

    // Recompute channels.
    let remaining_sources =
        repo::list_project_sources(pool, &req.project_id).await.map_err(db_err)?;
    let new_inferred = infer_from_sources(&remaining_sources);
    let existing_channels =
        repo::list_project_channels(pool, &req.project_id).await.map_err(db_err)?;
    let existing_domain: Vec<Channel> = existing_channels
        .iter()
        .map(|r| Channel { label: r.label.clone(), source: r.source.clone() })
        .collect();
    let merged = merge_channels(&new_inferred, &existing_domain);
    persist_channels(pool, &req.project_id, &merged).await.map_err(db_err)?;

    // Regress ready → setup_incomplete if no sources remain.
    let new_lifecycle =
        maybe_regress_to_incomplete(pool, &req.project_id, &row.lifecycle).await.map_err(db_err)?;

    let audit_id = new_id();
    bus.publish(
        "project.source.removed",
        Source::User,
        serde_json::json!({
            "auditId": audit_id,
            "projectId": req.project_id,
            "inventorySessionId": req.project_source_id,
        }),
    )
    .await
    .map_err(bus_err)?;

    write_source_change_manifest(pool, bus, &req.project_id).await;

    Ok(ProjectSourceRemoveResult {
        project_id: req.project_id.clone(),
        removed_source_id: req.project_source_id.clone(),
        audit_id,
        new_lifecycle,
    })
}

// ── project.channels.reinfer ──────────────────────────────────────────────────

/// Re-infer channels from all linked sources, discarding all manual overrides.
///
/// Resets `channel_drift` to false.
///
/// # Errors
///
/// Returns `ContractError` on database error or when project is archived.
pub async fn reinfer_channels(
    pool: &SqlitePool,
    bus: &EventBus,
    req: &ProjectChannelsReinferRequest,
) -> Result<ProjectChannelsReinferResult, ContractError> {
    let row = repo::get_project(pool, &req.project_id).await.map_err(db_err)?;

    if is_read_only(&row.lifecycle) {
        return Err(ContractError::new(
            ErrorCode::LifecycleReadOnly,
            "Channels cannot be changed on an archived project.",
            ErrorSeverity::Blocking,
            false,
        ));
    }

    let sources = repo::list_project_sources(pool, &req.project_id).await.map_err(db_err)?;
    let filters: Vec<&str> = sources.iter().map(|s| s.filter_snapshot.as_str()).collect();
    let channels = domain_reinfer(&filters);
    persist_channels(pool, &req.project_id, &channels).await.map_err(db_err)?;
    repo::set_channel_drift(pool, &req.project_id, false).await.map_err(db_err)?;

    let now = Timestamp::now_iso();
    let audit_id = new_id();
    bus.publish(
        "project.channels.recomputed",
        Source::User,
        serde_json::json!({
            "auditId": audit_id,
            "projectId": req.project_id,
        }),
    )
    .await
    .map_err(bus_err)?;

    let channel_totals = channel_totals_by_filter(&sources);
    let channel_dtos: Vec<ProjectChannelDto> =
        channels.into_iter().map(|c| channel_dto_from_domain(c, &now, &channel_totals)).collect();

    Ok(ProjectChannelsReinferResult {
        project_id: req.project_id.clone(),
        channels: channel_dtos,
        audit_id,
        updated_at: now,
    })
}

// ── project.channels.dismiss_drift ───────────────────────────────────────────

/// Dismiss the channel drift banner without re-inferring.
///
/// Resets `channel_drift` flag; does not change the channel list.
///
/// # Errors
///
/// Returns `ContractError` on database error.
pub async fn dismiss_drift(
    pool: &SqlitePool,
    bus: &EventBus,
    req: &ProjectChannelsDismissDriftRequest,
) -> Result<ProjectChannelsDismissDriftResult, ContractError> {
    // Verify project exists.
    repo::get_project(pool, &req.project_id).await.map_err(db_err)?;

    repo::set_channel_drift(pool, &req.project_id, false).await.map_err(db_err)?;

    let now = Timestamp::now_iso();
    let audit_id = new_id();
    bus.publish(
        "project.channel_drift.dismissed",
        Source::User,
        serde_json::json!({
            "auditId": audit_id,
            "projectId": req.project_id,
        }),
    )
    .await
    .map_err(bus_err)?;

    Ok(ProjectChannelsDismissDriftResult {
        project_id: req.project_id.clone(),
        audit_id,
        dismissed_at: now,
    })
}

// ── Read: list + get ──────────────────────────────────────────────────────────

/// List all projects as summary DTOs.
///
/// # Errors
///
/// Returns `ContractError` on database error.
pub async fn list(pool: &SqlitePool) -> Result<Vec<ProjectSummaryDto>, ContractError> {
    let rows = repo::list_projects(pool).await.map_err(db_err)?;
    let mut dtos = Vec::with_capacity(rows.len());
    for row in rows {
        let sources = repo::list_project_sources(pool, &row.id).await.map_err(db_err)?;
        let tool = ProjectTool::from_db_str(&row.tool).map_err(|e| {
            ContractError::new(ErrorCode::InternalData, e, ErrorSeverity::Fatal, false)
        })?;
        dtos.push(ProjectSummaryDto {
            id: row.id,
            name: row.name,
            tool,
            lifecycle: row.lifecycle,
            path: row.path,
            notes: row.notes,
            channel_drift: row.channel_drift,
            source_count: u32::try_from(sources.len()).unwrap_or(0),
            created_at: row.created_at,
            updated_at: row.updated_at,
            blocked_reason_kind: row.blocked_reason_kind,
            blocked_reason_note: row.blocked_reason_note,
            is_mosaic: row.is_mosaic,
        });
    }
    Ok(dtos)
}

/// Get a single project with full sources + channels.
///
/// # Errors
///
/// Returns `ContractError` on database error or when not found.
pub async fn get(pool: &SqlitePool, id: &str) -> Result<ProjectDetailDto, ContractError> {
    let row = repo::get_project(pool, id).await.map_err(db_err)?;
    let sources = repo::list_project_sources(pool, id).await.map_err(db_err)?;
    let channels = repo::list_project_channels(pool, id).await.map_err(db_err)?;

    let tool = ProjectTool::from_db_str(&row.tool)
        .map_err(|e| ContractError::new(ErrorCode::InternalData, e, ErrorSeverity::Fatal, false))?;

    // Spec 035 US1 #2: surface the associated canonical target (LEFT JOIN);
    // `None` when the project has no canonical-target association.
    let canonical_target =
        repo::get_project_canonical_target(pool, id).await.map_err(db_err)?.map(|ct| {
            contracts_core::projects_v2::ProjectCanonicalTarget {
                id: ct.id,
                primary_designation: ct.primary_designation,
                common_name: ct.common_name,
            }
        });

    Ok(ProjectDetailDto {
        id: row.id,
        name: row.name,
        tool,
        lifecycle: row.lifecycle,
        path: row.path,
        notes: row.notes,
        channel_drift: ChannelDriftDto {
            has_new_sources: row.channel_drift,
            suggested_action: if row.channel_drift {
                "re_infer".to_owned()
            } else {
                "dismiss".to_owned()
            },
        },
        sources: sources.iter().map(source_to_dto).collect(),
        channels: channels_to_dto(&channels, &sources),
        created_at: row.created_at,
        updated_at: row.updated_at,
        canonical_target,
        blocked_reason_kind: row.blocked_reason_kind,
        blocked_reason_note: row.blocked_reason_note,
        is_mosaic: row.is_mosaic,
    })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{abs, register_project_root, TEST_PROJECT_ROOT};
    use persistence_db::Database;

    async fn setup() -> (SqlitePool, EventBus) {
        let db = Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        let bus = EventBus::with_pool(db.pool().clone());
        let pool = db.pool().clone();
        // Register a project-kind source so relative request paths have an
        // anchor (mirrors the first-run wizard registering a project folder).
        register_project_root(&pool, TEST_PROJECT_ROOT).await;
        (pool, bus)
    }

    /// An empty redb resolve cache — these tests exercise `create()` either
    /// with no `canonical_target_id` or with one already seeded directly into
    /// SQLite (`seed_canonical_target`), so promotion's cache fallback is
    /// never exercised here (see `promotes_from_redb_cache_when_not_yet_durable`).
    fn empty_cache() -> simbad_resolver::RedbCache {
        simbad_resolver::Store::in_memory().unwrap().cache()
    }

    // ── P7: exposure parsing + channel aggregation (pure helpers) ─────────────

    #[test]
    fn parse_exposure_seconds_whole_and_fractional() {
        assert_eq!(parse_exposure_seconds("300s"), 300);
        assert_eq!(parse_exposure_seconds("60s"), 60);
        // Fractional seconds truncate toward zero.
        assert_eq!(parse_exposure_seconds("1.5s"), 1);
        // Missing trailing "s" is still accepted.
        assert_eq!(parse_exposure_seconds("120"), 120);
    }

    #[test]
    fn parse_exposure_seconds_degrades_to_zero_without_panicking() {
        assert_eq!(parse_exposure_seconds(""), 0);
        assert_eq!(parse_exposure_seconds("na"), 0);
        assert_eq!(parse_exposure_seconds("Mixed"), 0);
        assert_eq!(parse_exposure_seconds("-5s"), 0);
        assert_eq!(parse_exposure_seconds("   "), 0);
    }

    #[test]
    fn channel_totals_by_filter_groups_and_sums() {
        let sources = vec![
            repo::ProjectSourceRow {
                id: "s1".to_owned(),
                project_id: "p1".to_owned(),
                inventory_session_id: "inv-1".to_owned(),
                name_snapshot: "Ha 1".to_owned(),
                frames_snapshot: 18,
                filter_snapshot: "Ha".to_owned(),
                exposure_snapshot: "120s".to_owned(),
                linked_at: "2026-01-01T00:00:00Z".to_owned(),
            },
            repo::ProjectSourceRow {
                id: "s2".to_owned(),
                project_id: "p1".to_owned(),
                inventory_session_id: "inv-2".to_owned(),
                name_snapshot: "Ha 2".to_owned(),
                frames_snapshot: 10,
                filter_snapshot: "Ha".to_owned(),
                exposure_snapshot: "60s".to_owned(),
                linked_at: "2026-01-01T00:00:00Z".to_owned(),
            },
            repo::ProjectSourceRow {
                id: "s3".to_owned(),
                project_id: "p1".to_owned(),
                inventory_session_id: "inv-3".to_owned(),
                name_snapshot: "OIII 1".to_owned(),
                frames_snapshot: 20,
                filter_snapshot: "OIII".to_owned(),
                exposure_snapshot: "300s".to_owned(),
                linked_at: "2026-01-01T00:00:00Z".to_owned(),
            },
            // Empty filter (unconfirmed source) must not contribute a bogus group.
            repo::ProjectSourceRow {
                id: "s4".to_owned(),
                project_id: "p1".to_owned(),
                inventory_session_id: "inv-4".to_owned(),
                name_snapshot: String::new(),
                frames_snapshot: 5,
                filter_snapshot: String::new(),
                exposure_snapshot: String::new(),
                linked_at: "2026-01-01T00:00:00Z".to_owned(),
            },
        ];

        let totals = channel_totals_by_filter(&sources);
        assert_eq!(totals.get("Ha"), Some(&(28, 18 * 120 + 10 * 60)));
        assert_eq!(totals.get("OIII"), Some(&(20, 20 * 300)));
        assert_eq!(totals.len(), 2, "empty filter_snapshot must not create a group");
    }

    fn make_create_req(name: &str, tool: ProjectTool) -> ProjectCreateRequest {
        ProjectCreateRequest {
            request_id: new_id(),
            name: name.to_owned(),
            tool,
            path: format!("projects/{name}"),
            initial_sources: vec![],
            notes: None,
            canonical_target_id: None,
            is_mosaic: false,
        }
    }

    #[tokio::test]
    async fn create_project_setup_incomplete_no_sources() {
        let (pool, bus) = setup().await;
        let req = make_create_req("NGC 7000 NB", ProjectTool::PixInsight);
        let result = create(&pool, &bus, &empty_cache(), &req).await.unwrap();
        assert_eq!(result.lifecycle, "setup_incomplete");
        assert!(result.channels.is_empty());
        // Constitution II: create always produces a folder-structure plan.
        assert!(result.plan_id.is_some(), "create must return a plan_id");
    }

    #[tokio::test]
    async fn create_project_duplicate_name_rejected() {
        let (pool, bus) = setup().await;
        let req = make_create_req("NGC 7000 NB", ProjectTool::PixInsight);
        create(&pool, &bus, &empty_cache(), &req).await.unwrap();
        let req2 = ProjectCreateRequest { path: "projects/other".to_owned(), ..req };
        let err = create(&pool, &bus, &empty_cache(), &req2).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::NameDuplicate);
    }

    #[tokio::test]
    async fn create_project_duplicate_path_rejected() {
        let (pool, bus) = setup().await;
        let req = make_create_req("NGC 7000 NB", ProjectTool::PixInsight);
        create(&pool, &bus, &empty_cache(), &req).await.unwrap();
        let req2 = ProjectCreateRequest { name: "Other Name".to_owned(), ..req };
        let err = create(&pool, &bus, &empty_cache(), &req2).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::PathCollision);
    }

    // ── Constitution I: path anchoring tests ──────────────────────────────────

    #[tokio::test]
    async fn create_anchors_relative_path_to_registered_project_root() {
        let (pool, bus) = setup().await;
        let req = make_create_req("M31 LRGB", ProjectTool::PixInsight);
        let result = create(&pool, &bus, &empty_cache(), &req).await.unwrap();

        let detail = get(&pool, &result.project_id).await.unwrap();
        assert_eq!(
            detail.path,
            format!("{TEST_PROJECT_ROOT}/projects/M31 LRGB"),
            "relative wizard path must be anchored to the registered project folder"
        );
        assert!(
            std::path::Path::new(&detail.path).is_absolute(),
            "stored project path must be absolute (CWD-independent)"
        );
    }

    /// CWD-independence proof at this layer: every scaffolding plan item
    /// destination is absolute, so the mkdir executor and every other
    /// consumer resolve the same location regardless of process CWD.
    #[tokio::test]
    async fn create_folder_plan_items_are_absolute_regardless_of_cwd() {
        use persistence_db::repositories::plans as plans_repo;

        let (pool, bus) = setup().await;
        let req = make_create_req("NGC 7000 CWD", ProjectTool::PixInsight);
        let result = create(&pool, &bus, &empty_cache(), &req).await.unwrap();

        let plan_id = result.plan_id.expect("plan_id must be present");
        let items = plans_repo::list_plan_items(&pool, &plan_id).await.unwrap();
        assert!(!items.is_empty());
        for item in items {
            assert!(
                std::path::Path::new(&item.to_relative_path).is_absolute(),
                "scaffolding destination must be absolute, got: {}",
                item.to_relative_path
            );
            assert!(
                item.to_relative_path.starts_with(TEST_PROJECT_ROOT),
                "scaffolding destination must live under the project root, got: {}",
                item.to_relative_path
            );
        }
    }

    #[tokio::test]
    async fn create_absolute_path_stored_as_is() {
        let (pool, bus) = setup().await;
        // Platform-absolute: "/elsewhere/m101" alone is not absolute on
        // Windows and would be anchored instead of stored as-is.
        let req = ProjectCreateRequest {
            path: abs("/elsewhere/m101"),
            ..make_create_req("M101 Abs", ProjectTool::PixInsight)
        };
        let result = create(&pool, &bus, &empty_cache(), &req).await.unwrap();
        let detail = get(&pool, &result.project_id).await.unwrap();
        assert_eq!(detail.path, abs("/elsewhere/m101"));
    }

    #[tokio::test]
    async fn create_relative_path_without_project_root_rejected() {
        // Fresh DB WITHOUT a registered project folder.
        let db = Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        let bus = EventBus::with_pool(db.pool().clone());
        let req = make_create_req("No Root", ProjectTool::PixInsight);
        let err = create(db.pool(), &bus, &empty_cache(), &req).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::PathInvalid);
    }

    #[tokio::test]
    async fn create_parent_dir_components_rejected() {
        let (pool, bus) = setup().await;
        let req = ProjectCreateRequest {
            path: "projects/../../etc".to_owned(),
            ..make_create_req("Escape Attempt", ProjectTool::PixInsight)
        };
        let err = create(&pool, &bus, &empty_cache(), &req).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::PathInvalid);
    }

    #[tokio::test]
    async fn create_project_empty_name_rejected() {
        let (pool, bus) = setup().await;
        let req = make_create_req("", ProjectTool::PixInsight);
        let err = create(&pool, &bus, &empty_cache(), &req).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::NameEmpty);
    }

    #[tokio::test]
    async fn update_project_name() {
        let (pool, bus) = setup().await;
        let create_req = make_create_req("Old Name", ProjectTool::PixInsight);
        let created = create(&pool, &bus, &empty_cache(), &create_req).await.unwrap();

        let update_req = ProjectUpdateRequest {
            request_id: new_id(),
            project_id: created.project_id.clone(),
            name: Some("New Name".to_owned()),
            tool: None,
            notes: None,
            is_mosaic: None,
        };
        let result = update(&pool, &bus, &update_req).await.unwrap();
        assert!(result.fields_updated.contains(&"name".to_owned()));
    }

    #[tokio::test]
    async fn update_archived_project_rejected() {
        let (pool, bus) = setup().await;
        let create_req = make_create_req("My Project", ProjectTool::PixInsight);
        let created = create(&pool, &bus, &empty_cache(), &create_req).await.unwrap();

        // Manually set lifecycle to archived.
        repo::update_project_lifecycle(&pool, &created.project_id, "archived").await.unwrap();

        let update_req = ProjectUpdateRequest {
            request_id: new_id(),
            project_id: created.project_id,
            name: Some("New Name".to_owned()),
            tool: None,
            notes: None,
            is_mosaic: None,
        };
        let err = update(&pool, &bus, &update_req).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::LifecycleReadOnly);
    }

    #[tokio::test]
    async fn add_source_triggers_ready_transition() {
        let (pool, bus) = setup().await;
        let create_req = make_create_req("NGC 7000 NB", ProjectTool::PixInsight);
        let created = create(&pool, &bus, &empty_cache(), &create_req).await.unwrap();
        assert_eq!(created.lifecycle, "setup_incomplete");

        let add_req = ProjectSourceAddRequest {
            request_id: new_id(),
            project_id: created.project_id.clone(),
            inventory_session_id: "inv-001".to_owned(),
        };
        let result = add_source(&pool, &bus, &add_req).await.unwrap();
        assert_eq!(result.new_lifecycle, Some("ready".to_owned()));
    }

    /// #665: `add_source` must fire the `SourceChange` manifest trigger with
    /// the POST-mutation lifecycle (here, the auto `ready` transition), not
    /// the stale pre-mutation value.
    #[tokio::test]
    async fn add_source_writes_source_change_manifest() {
        let (pool, bus) = setup().await;
        let create_req = make_create_req("M31 Andromeda", ProjectTool::PixInsight);
        let created = create(&pool, &bus, &empty_cache(), &create_req).await.unwrap();

        // `TEST_PROJECT_ROOT` is a synthetic, non-writable path (existing
        // convention across this module's tests) — point the project at a
        // real tempdir so the manifest file write can actually succeed.
        let dir = tempfile::tempdir().unwrap();
        sqlx::query("UPDATE projects SET path = ? WHERE id = ?")
            .bind(dir.path().to_str().unwrap())
            .bind(&created.project_id)
            .execute(&pool)
            .await
            .unwrap();

        let add_req = ProjectSourceAddRequest {
            request_id: new_id(),
            project_id: created.project_id.clone(),
            inventory_session_id: "inv-001".to_owned(),
        };
        add_source(&pool, &bus, &add_req).await.unwrap();

        let (rows, _) = persistence_db::repositories::manifests::list_manifests_for_project(
            &pool,
            &created.project_id,
            None,
            10,
        )
        .await
        .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].reason, "source_change");
        let manifest = crate::project_manifests::get(&pool, &rows[0].id).await.unwrap();
        assert_eq!(manifest.manifest.body.lifecycle_state, "ready");
        assert!(manifest.manifest.body.source_map.is_some());
    }

    #[tokio::test]
    async fn add_source_duplicate_rejected() {
        let (pool, bus) = setup().await;
        let create_req = make_create_req("NGC 7000 NB", ProjectTool::PixInsight);
        let created = create(&pool, &bus, &empty_cache(), &create_req).await.unwrap();

        let add_req = ProjectSourceAddRequest {
            request_id: new_id(),
            project_id: created.project_id.clone(),
            inventory_session_id: "inv-001".to_owned(),
        };
        add_source(&pool, &bus, &add_req).await.unwrap();
        let err =
            add_source(&pool, &bus, &ProjectSourceAddRequest { request_id: new_id(), ..add_req })
                .await
                .unwrap_err();
        assert_eq!(err.code, ErrorCode::SourceAlreadyLinked);
    }

    #[tokio::test]
    async fn remove_source_last_requires_confirmation() {
        let (pool, bus) = setup().await;
        let create_req = make_create_req("NGC 7000 NB", ProjectTool::PixInsight);
        let created = create(&pool, &bus, &empty_cache(), &create_req).await.unwrap();

        let add_req = ProjectSourceAddRequest {
            request_id: new_id(),
            project_id: created.project_id.clone(),
            inventory_session_id: "inv-001".to_owned(),
        };
        add_source(&pool, &bus, &add_req).await.unwrap();

        // Attempt remove without confirmation.
        let rm_req = ProjectSourceRemoveRequest {
            request_id: new_id(),
            project_id: created.project_id.clone(),
            project_source_id: "inv-001".to_owned(),
            confirm_last_source: false,
        };
        let err = remove_source(&pool, &bus, &rm_req).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::LifecycleLastConfirmedSource);
    }

    #[tokio::test]
    async fn remove_source_with_confirmation_succeeds() {
        let (pool, bus) = setup().await;
        let create_req = make_create_req("NGC 7000 NB", ProjectTool::PixInsight);
        let created = create(&pool, &bus, &empty_cache(), &create_req).await.unwrap();

        let add_req = ProjectSourceAddRequest {
            request_id: new_id(),
            project_id: created.project_id.clone(),
            inventory_session_id: "inv-001".to_owned(),
        };
        add_source(&pool, &bus, &add_req).await.unwrap();

        let rm_req = ProjectSourceRemoveRequest {
            request_id: new_id(),
            project_id: created.project_id.clone(),
            project_source_id: "inv-001".to_owned(),
            confirm_last_source: true,
        };
        let result = remove_source(&pool, &bus, &rm_req).await.unwrap();
        assert_eq!(result.new_lifecycle, Some("setup_incomplete".to_owned()));
    }

    /// #665: `remove_source` must also fire the `SourceChange` manifest
    /// trigger, with the POST-removal regressed lifecycle.
    #[tokio::test]
    async fn remove_source_writes_source_change_manifest() {
        let (pool, bus) = setup().await;
        let create_req = make_create_req("NGC 6960 Veil", ProjectTool::PixInsight);
        let created = create(&pool, &bus, &empty_cache(), &create_req).await.unwrap();
        let dir = tempfile::tempdir().unwrap();
        sqlx::query("UPDATE projects SET path = ? WHERE id = ?")
            .bind(dir.path().to_str().unwrap())
            .bind(&created.project_id)
            .execute(&pool)
            .await
            .unwrap();

        let add_req = ProjectSourceAddRequest {
            request_id: new_id(),
            project_id: created.project_id.clone(),
            inventory_session_id: "inv-001".to_owned(),
        };
        add_source(&pool, &bus, &add_req).await.unwrap();

        let rm_req = ProjectSourceRemoveRequest {
            request_id: new_id(),
            project_id: created.project_id.clone(),
            project_source_id: "inv-001".to_owned(),
            confirm_last_source: true,
        };
        remove_source(&pool, &bus, &rm_req).await.unwrap();

        let (rows, _) = persistence_db::repositories::manifests::list_manifests_for_project(
            &pool,
            &created.project_id,
            None,
            10,
        )
        .await
        .unwrap();
        // One from add_source, one from remove_source.
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().all(|r| r.reason == "source_change"));
        let latest = crate::project_manifests::get(&pool, &rows[0].id).await.unwrap();
        assert_eq!(latest.manifest.body.lifecycle_state, "setup_incomplete");
    }

    #[tokio::test]
    async fn remove_source_from_prepared_rejected() {
        let (pool, bus) = setup().await;
        let create_req = make_create_req("NGC 7000 NB", ProjectTool::PixInsight);
        let created = create(&pool, &bus, &empty_cache(), &create_req).await.unwrap();

        // Add a source so lifecycle can be moved to ready.
        let add_req = ProjectSourceAddRequest {
            request_id: new_id(),
            project_id: created.project_id.clone(),
            inventory_session_id: "inv-001".to_owned(),
        };
        add_source(&pool, &bus, &add_req).await.unwrap();
        // Move to prepared manually (lifecycle gate test).
        repo::update_project_lifecycle(&pool, &created.project_id, "prepared").await.unwrap();

        let rm_req = ProjectSourceRemoveRequest {
            request_id: new_id(),
            project_id: created.project_id.clone(),
            project_source_id: "inv-001".to_owned(),
            confirm_last_source: true,
        };
        let err = remove_source(&pool, &bus, &rm_req).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::LifecycleReadOnly);
    }

    #[tokio::test]
    async fn reinfer_clears_drift_flag() {
        let (pool, bus) = setup().await;
        let create_req = make_create_req("NGC 7000 NB", ProjectTool::PixInsight);
        let created = create(&pool, &bus, &empty_cache(), &create_req).await.unwrap();

        // Artificially set drift.
        repo::set_channel_drift(&pool, &created.project_id, true).await.unwrap();

        let req = ProjectChannelsReinferRequest {
            request_id: new_id(),
            project_id: created.project_id.clone(),
        };
        reinfer_channels(&pool, &bus, &req).await.unwrap();
        let detail = get(&pool, &created.project_id).await.unwrap();
        assert!(!detail.channel_drift.has_new_sources);
    }

    #[tokio::test]
    async fn dismiss_drift_clears_flag() {
        let (pool, bus) = setup().await;
        let create_req = make_create_req("NGC 7000 NB", ProjectTool::PixInsight);
        let created = create(&pool, &bus, &empty_cache(), &create_req).await.unwrap();

        repo::set_channel_drift(&pool, &created.project_id, true).await.unwrap();

        let req = ProjectChannelsDismissDriftRequest {
            request_id: new_id(),
            project_id: created.project_id.clone(),
        };
        dismiss_drift(&pool, &bus, &req).await.unwrap();
        let detail = get(&pool, &created.project_id).await.unwrap();
        assert!(!detail.channel_drift.has_new_sources);
    }

    #[tokio::test]
    async fn list_projects_returns_summary() {
        let (pool, bus) = setup().await;
        create(&pool, &bus, &empty_cache(), &make_create_req("A", ProjectTool::PixInsight))
            .await
            .unwrap();
        create(&pool, &bus, &empty_cache(), &make_create_req("B", ProjectTool::Siril))
            .await
            .unwrap();
        let list = list(&pool).await.unwrap();
        assert_eq!(list.len(), 2);

        // Verify summary content is real, not just row count — each summary
        // must carry its own name/tool/path, not a copy or a default.
        // `path` is resolved against the project root at create time (not a
        // literal echo of the request path), so check the suffix rather than
        // an exact match.
        let a = list.iter().find(|p| p.name == "A").expect("project A must be in the list");
        assert_eq!(a.tool, ProjectTool::PixInsight);
        assert!(
            a.path.ends_with("projects/A"),
            "path must resolve under project A's name: {}",
            a.path
        );

        let b = list.iter().find(|p| p.name == "B").expect("project B must be in the list");
        assert_eq!(b.tool, ProjectTool::Siril);
        assert!(
            b.path.ends_with("projects/B"),
            "path must resolve under project B's name: {}",
            b.path
        );

        assert_ne!(a.id, b.id, "summaries must carry distinct project ids");
    }

    // ── Constitution II: folder plan tests ────────────────────────────────────

    #[tokio::test]
    async fn create_returns_plan_id() {
        let (pool, bus) = setup().await;
        let req = make_create_req("NGC 7000 NB", ProjectTool::PixInsight);
        let result = create(&pool, &bus, &empty_cache(), &req).await.unwrap();
        assert!(
            result.plan_id.is_some(),
            "create must return a plan_id for the folder-structure plan"
        );
    }

    #[tokio::test]
    async fn create_pixinsight_plan_has_correct_folders() {
        use persistence_db::repositories::plans as plans_repo;

        let (pool, bus) = setup().await;
        let req = make_create_req("NGC 7000 PI", ProjectTool::PixInsight);
        let result = create(&pool, &bus, &empty_cache(), &req).await.unwrap();

        let plan_id = result.plan_id.expect("plan_id must be present");
        let plan = plans_repo::get_plan(&pool, &plan_id, false).await.unwrap();
        let items = plans_repo::list_plan_items(&pool, &plan_id).await.unwrap();

        assert_eq!(plan.state, "ready_for_review", "plan should be ready for review");
        assert_eq!(plan.origin, "project");

        let actions: Vec<&str> = items.iter().map(|i| i.action.as_str()).collect();
        // PixInsight: 6 mkdir + 1 write_manifest = 7 items
        let mkdir_count = actions.iter().filter(|&&a| a == "mkdir").count();
        let manifest_count = actions.iter().filter(|&&a| a == "write_manifest").count();
        assert_eq!(
            mkdir_count, 6,
            "PixInsight needs 6 sub-folders (lights, darks, flats, bias, output, processing)"
        );
        assert_eq!(manifest_count, 1, "exactly one marker write item");

        let folder_names: Vec<&str> =
            items.iter().filter(|i| i.action == "mkdir").map(|i| i.name.as_str()).collect();
        assert!(folder_names.contains(&"lights"));
        assert!(folder_names.contains(&"darks"));
        assert!(folder_names.contains(&"flats"));
        assert!(folder_names.contains(&"bias"));
        assert!(folder_names.contains(&"output"));
        assert!(folder_names.contains(&"processing"));

        // Marker item name should be the app marker filename
        let has_marker = items.iter().any(|i| i.name == ".astro-plan-project.json");
        assert!(has_marker, "marker file item must be present");
    }

    #[tokio::test]
    async fn create_siril_plan_has_five_folders() {
        use persistence_db::repositories::plans as plans_repo;

        let (pool, bus) = setup().await;
        let req = make_create_req("M31 Siril", ProjectTool::Siril);
        let result = create(&pool, &bus, &empty_cache(), &req).await.unwrap();

        let plan_id = result.plan_id.expect("plan_id must be present");
        let items = plans_repo::list_plan_items(&pool, &plan_id).await.unwrap();

        let mkdir_count = items.iter().filter(|i| i.action == "mkdir").count();
        // Siril: 5 sub-folders (no processing/)
        assert_eq!(mkdir_count, 5);
        let folder_names: Vec<&str> =
            items.iter().filter(|i| i.action == "mkdir").map(|i| i.name.as_str()).collect();
        assert!(!folder_names.contains(&"processing"), "Siril has no processing/ folder");
    }

    // ── spec 035 US1 #2: project ↔ canonical_target association ──────────────────

    /// Insert a minimal `canonical_target` row so the create use case's existence
    /// check passes and the FK target is present.
    async fn seed_canonical_target(pool: &SqlitePool, id: &str) {
        sqlx::query(
            "INSERT INTO canonical_target
                (id, simbad_oid, primary_designation, object_type, ra_deg, dec_deg, source, resolved_at)
             VALUES (?, NULL, 'M 31', 'galaxy', 10.68, 41.27, 'resolved', '2026-01-01T00:00:00Z')",
        )
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn create_without_canonical_target_stores_null() {
        let (pool, bus) = setup().await;
        let req = make_create_req("No Target Project", ProjectTool::PixInsight);
        let result = create(&pool, &bus, &empty_cache(), &req).await.unwrap();
        let stored =
            repo::get_project_canonical_target_id(&pool, &result.project_id).await.unwrap();
        assert_eq!(stored, None, "absent canonicalTargetId must persist as NULL");
    }

    #[tokio::test]
    async fn create_with_canonical_target_persists_and_reads_back() {
        let (pool, bus) = setup().await;
        let ctid = "11111111-1111-5111-8111-111111111111";
        seed_canonical_target(&pool, ctid).await;

        let mut req = make_create_req("Targeted Project", ProjectTool::PixInsight);
        req.canonical_target_id = Some(ctid.to_owned());
        let result = create(&pool, &bus, &empty_cache(), &req).await.unwrap();

        let stored =
            repo::get_project_canonical_target_id(&pool, &result.project_id).await.unwrap();
        assert_eq!(stored.as_deref(), Some(ctid), "canonicalTargetId must round-trip");
    }

    #[tokio::test]
    async fn create_with_unknown_canonical_target_is_rejected() {
        let (pool, bus) = setup().await;
        let mut req = make_create_req("Dangling Target", ProjectTool::PixInsight);
        req.canonical_target_id = Some("22222222-2222-5222-8222-222222222222".to_owned());
        let err = create(&pool, &bus, &empty_cache(), &req).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::CanonicalTargetNotFound);
    }

    // ── spec 035 US1 #2: canonical target surfaced on the detail READ path ───────

    #[tokio::test]
    async fn get_returns_canonical_target_with_designation_and_common_name() {
        let (pool, bus) = setup().await;
        let ctid = "33333333-3333-5333-8333-333333333333";
        seed_canonical_target(&pool, ctid).await;
        // A common_name alias so the read populates `common_name`.
        sqlx::query(
            "INSERT INTO target_alias (id, target_id, alias, normalized, kind)
             VALUES ('a1', ?, 'Andromeda Galaxy', 'andromeda galaxy', 'common_name')",
        )
        .bind(ctid)
        .execute(&pool)
        .await
        .unwrap();

        let mut req = make_create_req("Detail With Target", ProjectTool::PixInsight);
        req.canonical_target_id = Some(ctid.to_owned());
        let created = create(&pool, &bus, &empty_cache(), &req).await.unwrap();

        let detail = get(&pool, &created.project_id).await.unwrap();
        let ct = detail.canonical_target.expect("canonical_target must be present");
        assert_eq!(ct.id, ctid);
        assert_eq!(ct.primary_designation, "M 31");
        assert_eq!(ct.common_name.as_deref(), Some("Andromeda Galaxy"));
    }

    #[tokio::test]
    async fn get_canonical_target_is_none_without_alias_common_name() {
        let (pool, bus) = setup().await;
        let ctid = "44444444-4444-5444-8444-444444444444";
        seed_canonical_target(&pool, ctid).await; // no common_name alias

        let mut req = make_create_req("Detail No Common Name", ProjectTool::PixInsight);
        req.canonical_target_id = Some(ctid.to_owned());
        let created = create(&pool, &bus, &empty_cache(), &req).await.unwrap();

        let detail = get(&pool, &created.project_id).await.unwrap();
        let ct = detail.canonical_target.expect("association present");
        assert_eq!(ct.primary_designation, "M 31");
        assert_eq!(ct.common_name, None, "no common-name alias → null");
    }

    #[tokio::test]
    async fn get_returns_no_canonical_target_when_unassociated() {
        let (pool, bus) = setup().await;
        let req = make_create_req("Detail No Target", ProjectTool::PixInsight);
        let created = create(&pool, &bus, &empty_cache(), &req).await.unwrap();

        let detail = get(&pool, &created.project_id).await.unwrap();
        assert!(detail.canonical_target.is_none(), "no association → None");
    }

    // ── P7: server-side channel aggregation (end-to-end via `get`) ────────────

    /// Directly insert a `project_sources` row with real snapshot data
    /// (bypassing `add_source`, which — pending spec 003 Inventory
    /// integration — always writes empty/zero snapshot fields). This mirrors
    /// the fixture shape used in `persistence_db::repositories::projects`
    /// tests and is the only way to exercise the aggregation with non-zero
    /// frames/exposure until spec 003 lands.
    async fn seed_real_source(
        pool: &SqlitePool,
        project_id: &str,
        inv_id: &str,
        filter: &str,
        frames: i64,
        exposure: &str,
    ) {
        repo::insert_project_source(
            pool,
            &repo::InsertProjectSource {
                id: &new_id(),
                project_id,
                inventory_session_id: inv_id,
                name_snapshot: &format!("{filter} {inv_id}"),
                frames_snapshot: frames,
                filter_snapshot: filter,
                exposure_snapshot: exposure,
                linked_at: "2026-01-01T00:00:00Z",
            },
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn get_aggregates_sub_frames_and_integration_seconds_per_channel() {
        let (pool, bus) = setup().await;
        let req = make_create_req("Aggregation Project", ProjectTool::PixInsight);
        let created = create(&pool, &bus, &empty_cache(), &req).await.unwrap();

        seed_real_source(&pool, &created.project_id, "inv-1", "Ha", 18, "120s").await;
        seed_real_source(&pool, &created.project_id, "inv-2", "Ha", 10, "60s").await;
        seed_real_source(&pool, &created.project_id, "inv-3", "OIII", 20, "300s").await;
        repo::replace_project_channels(
            &pool,
            &created.project_id,
            &[("Ha", "inferred"), ("OIII", "inferred")],
        )
        .await
        .unwrap();

        let detail = get(&pool, &created.project_id).await.unwrap();
        let ha = detail.channels.iter().find(|c| c.label == "Ha").expect("Ha channel");
        assert_eq!(ha.sub_frames, 28);
        assert_eq!(ha.total_integration_s, 18 * 120 + 10 * 60);

        let oiii = detail.channels.iter().find(|c| c.label == "OIII").expect("OIII channel");
        assert_eq!(oiii.sub_frames, 20);
        assert_eq!(oiii.total_integration_s, 20 * 300);
    }

    #[tokio::test]
    async fn get_channel_totals_ignore_unparseable_exposure_without_panicking() {
        let (pool, bus) = setup().await;
        let req = make_create_req("Unparseable Exposure Project", ProjectTool::PixInsight);
        let created = create(&pool, &bus, &empty_cache(), &req).await.unwrap();

        seed_real_source(&pool, &created.project_id, "inv-1", "Ha", 5, "Mixed").await;
        repo::replace_project_channels(&pool, &created.project_id, &[("Ha", "inferred")])
            .await
            .unwrap();

        let detail = get(&pool, &created.project_id).await.unwrap();
        let ha = detail.channels.iter().find(|c| c.label == "Ha").expect("Ha channel");
        assert_eq!(
            ha.sub_frames, 5,
            "frame count is still summed even when exposure is unparseable"
        );
        assert_eq!(ha.total_integration_s, 0, "unparseable exposure degrades to 0s, never panics");
    }
}
