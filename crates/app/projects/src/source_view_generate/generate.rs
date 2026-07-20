// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! `sourceview.generate` — the plan-build pipeline itself.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use camino::{Utf8Path, Utf8PathBuf};
use contracts_core::source_view_generate::{
    GenerationWarning, GenerationWarningCode, SourceViewGenerateRequest, SourceViewGenerateResponse,
};
use contracts_core::{error_code::ErrorCode, ContractError, ErrorSeverity};
use domain_core::ids::new_id;
use domain_core::source_view::Materialization;
use patterns::{resolve_pattern_str, MetadataBundle};
use persistence_db::repositories::{plans as plans_repo, projects as projects_repo, q_projects};
use sqlx::SqlitePool;

use app_core_errors::db_internal_ctx;

use crate::prepared_views::{check_project_lifecycle, project_db_err};

use super::{
    exceeds_windows_long_path_limit, frames_for_ids, get_destination_override, join_portable,
    layout_resolve_err, parse_frame_ids, session_night,
};

/// A single planned link: canonical source (root + relative path) → the
/// view-relative destination path, plus the inventory reference to carry
/// into `PreparedSourceViewItem.inventory_item_id` on successful apply.
struct PlannedLink {
    inventory_item_id: String,
    source_root_id: String,
    source_relative_path: String,
    dest_relative: Utf8PathBuf,
}

/// Build a `prepared_view_generation` plan for `req.project_id`.
///
/// Validates:
/// 1. Project exists and its lifecycle permits view operations (not `archived`).
/// 2. At least one selected light frame resolves (`no_selection` otherwise).
/// 3. Every planned item has an achievable link kind, or `copyOptIn` is set
///    (`no_link_kind` otherwise, FR-003/FR-004b).
/// 4. No two planned items collide on the same destination path
///    (`destination.collision`, FR-009a) and no destination path already
///    exists as a user file/folder (`destination.exists`, FR-016).
///
/// # Errors
///
/// Returns `project.not_found`, `lifecycle.read_only`, `no_selection`,
/// `no_link_kind`, `destination.collision`, `destination.exists`, or an
/// `internal.*` error on failure.
#[allow(clippy::too_many_lines)] // linear validation/build pipeline (mirrors app_core::plan_apply)
pub async fn generate_source_view(
    pool: &SqlitePool,
    req: &SourceViewGenerateRequest,
) -> Result<SourceViewGenerateResponse, ContractError> {
    // 1. Project + lifecycle gate (shared with spec 026 remove/regenerate).
    let project =
        projects_repo::get_project(pool, &req.project_id).await.map_err(project_db_err)?;
    check_project_lifecycle(pool, &req.project_id).await?;

    // 2. Resolve project-linked sessions (session-level selection, CL-9 MVP fallback).
    let sources = projects_repo::list_project_sources(pool, &req.project_id)
        .await
        .map_err(|e| db_internal_ctx(e, "list project sources"))?;

    let mut warnings: Vec<GenerationWarning> = Vec::new();
    let mut planned: Vec<PlannedLink> = Vec::new();
    let mut unresolved_refs: Vec<String> = Vec::new();
    let mut sessions_without_calibration: Vec<String> = Vec::new();

    // Profile-driven layout (spec 049 US2 T025/T026): an explicit
    // `profile_id` on the request wins; otherwise resolve the project's own
    // active tool (`projects.tool`, e.g. "PixInsight"); falls back to the
    // WBPP/PixInsight default when neither matches a seeded profile.
    let layout = workflow_profiles::seed::resolve_source_view_layout(
        req.profile_id.as_deref().or(Some(project.tool.as_str())),
    );
    // T028: track which calibration types each session actually matched, to
    // detect *partial* coverage (some but not all of the project's observed
    // calibration types) in addition to the *zero* case already handled
    // below (FR-010a/CL-7).
    let mut session_calibration_types: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();

    // The generation destination is `<project>/source-views/<plan_id>/`
    // (FR-021b). The plan id is generated up-front so it can double as the
    // stable view-folder slug; the DB `PreparedSourceView.id` is a distinct
    // identifier assigned at first-materialization (apply time) — the folder
    // slug does not need to equal it, only to be stable and collision-free.
    //
    // T041 precedence: per-generation `destinationOverride` (request) >
    // per-project persisted override (settings KV) > envelope default.
    let plan_id = new_id();
    let project_destination_override = if req.destination_override.is_some() {
        None // per-generation override already wins; skip the DB read.
    } else {
        get_destination_override(pool, &req.project_id).await?
    };
    let destination_root: Utf8PathBuf = req
        .destination_override
        .as_deref()
        .or(project_destination_override.as_deref())
        .map_or_else(
            || {
                let root = Utf8PathBuf::from(&project.path);
                join_portable(&join_portable(&root, "source-views"), &plan_id)
            },
            Utf8PathBuf::from,
        );

    for src in &sources {
        let Some(session) =
            q_projects::get_acquisition_session_view(pool, &src.inventory_session_id)
                .await
                .map_err(|e| db_internal_ctx(e, "load acquisition session"))?
        else {
            unresolved_refs.push(src.inventory_session_id.clone());
            continue;
        };
        let q_projects::AcquisitionSessionViewRow {
            root_id,
            session_key,
            frame_ids: frame_ids_json,
        } = session;

        // Resolve the light-frame destination directory once per session
        // (session/night → filter → exposure grouping, US2 AS1): the
        // metadata bundle is constant across every frame in the session.
        let mut light_bundle: MetadataBundle = HashMap::new();
        light_bundle.insert("filter".to_owned(), src.filter_snapshot.clone());
        light_bundle.insert("exposure".to_owned(), src.exposure_snapshot.clone());
        light_bundle.insert("date".to_owned(), session_night(&session_key));
        let light_dir = Utf8PathBuf::from(
            resolve_pattern_str(layout.light_pattern, &light_bundle)
                .map_err(|e| layout_resolve_err(&e, &src.inventory_session_id))?
                .relative_path,
        );

        let frame_ids = parse_frame_ids(&frame_ids_json);
        let frames = frames_for_ids(pool, &frame_ids).await;

        let mut any_light_present = false;
        for frame in &frames {
            if frame.state == "missing" || frame.state == "rejected" {
                unresolved_refs.push(frame.id.clone());
                continue;
            }
            any_light_present = true;
            let basename = Utf8Path::new(&frame.relative_path)
                .file_name()
                .unwrap_or(&frame.relative_path)
                .to_owned();
            planned.push(PlannedLink {
                inventory_item_id: frame.id.clone(),
                source_root_id: root_id.clone(),
                source_relative_path: frame.relative_path.clone(),
                dest_relative: join_portable(&light_dir, basename.as_str()),
            });
        }
        if !any_light_present {
            continue;
        }

        // 3. Matched calibration (best-effort; not a generation prerequisite — FR-010a).
        let assignments: Vec<(String, String)> =
            q_projects::list_calibration_assignment_types(pool, &src.inventory_session_id)
                .await
                .unwrap_or_default();

        if assignments.is_empty() {
            sessions_without_calibration.push(src.inventory_session_id.clone());
            continue;
        }

        session_calibration_types.insert(
            src.inventory_session_id.clone(),
            assignments.iter().map(|(t, _)| t.clone()).collect(),
        );

        for (cal_type, master_id) in assignments {
            let Some((cal_root_id, cal_frame_ids_json)) =
                q_projects::get_calibration_session_view(pool, &master_id).await.unwrap_or(None)
            else {
                unresolved_refs.push(master_id.clone());
                continue;
            };

            // Calibration goes to the profile's expected calibration location
            // (FR-010); every matched set still gets its own `master_id`
            // subdirectory so two masters of the same type never collide
            // (FR-009a/CL-5) without needing a `master_id` metadata token.
            let mut cal_bundle: MetadataBundle = HashMap::new();
            cal_bundle.insert("frame_type".to_owned(), cal_type.clone());
            let cal_dir = join_portable(
                &Utf8PathBuf::from(
                    resolve_pattern_str(layout.calibration_pattern, &cal_bundle)
                        .map_err(|e| layout_resolve_err(&e, &master_id))?
                        .relative_path,
                ),
                &master_id,
            );

            let cal_frame_ids = parse_frame_ids(&cal_frame_ids_json);
            let cal_frames = frames_for_ids(pool, &cal_frame_ids).await;
            for frame in &cal_frames {
                if frame.state == "missing" || frame.state == "rejected" {
                    unresolved_refs.push(frame.id.clone());
                    continue;
                }
                let basename = Utf8Path::new(&frame.relative_path)
                    .file_name()
                    .unwrap_or(&frame.relative_path)
                    .to_owned();
                planned.push(PlannedLink {
                    inventory_item_id: frame.id.clone(),
                    source_root_id: cal_root_id.clone(),
                    source_relative_path: frame.relative_path.clone(),
                    dest_relative: join_portable(&cal_dir, basename.as_str()),
                });
            }
        }
    }

    // T028: partial calibration coverage — a session that matched *some* but
    // not all of the calibration types seen elsewhere in this project still
    // generates cleanly, but gets the same "no calibration applied" warning
    // (FR-010a/CL-7 treats "no" and "partial" alike). A session is judged
    // against the project's own observed types (not a hardcoded
    // dark/flat/bias list) because not every setup uses every type.
    let all_project_calibration_types: BTreeSet<String> =
        session_calibration_types.values().flatten().cloned().collect();
    for (session_id, types) in &session_calibration_types {
        if !types.is_empty() && types != &all_project_calibration_types {
            sessions_without_calibration.push(session_id.clone());
        }
    }

    // FR-019: unresolved sources are skipped and flagged, not a hard failure,
    // unless `strict` is requested.
    if !unresolved_refs.is_empty() {
        if req.strict {
            return Err(ContractError::new(
                ErrorCode::NoSelection,
                format!(
                    "strict mode: {} source(s) could not be resolved: {}",
                    unresolved_refs.len(),
                    unresolved_refs.join(", ")
                ),
                ErrorSeverity::Blocking,
                false,
            ));
        }
        warnings.push(GenerationWarning {
            code: GenerationWarningCode::UnresolvedSource,
            message: format!(
                "{} source(s) could not be resolved and were skipped",
                unresolved_refs.len()
            ),
            items: unresolved_refs,
        });
    }

    if !sessions_without_calibration.is_empty() {
        warnings.push(GenerationWarning {
            code: GenerationWarningCode::NoCalibrationApplied,
            message: "generated without matched calibration (missing or partial coverage) \
                      for one or more light groups"
                .to_owned(),
            items: sessions_without_calibration,
        });
    }

    // 4. No selection at all → refuse (nothing to generate).
    if planned.is_empty() {
        return Err(ContractError::new(
            ErrorCode::NoSelection,
            "project has no selected light frames to generate a source view from",
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // 5. Collision guard (FR-009a/FR-017): impossible by construction because
    // each session/calibration-set links into its own directory, but verify
    // explicitly rather than assuming — refuse rather than silently suffix.
    let mut seen_dest: BTreeSet<String> = BTreeSet::new();
    for item in &planned {
        // Case-insensitive/case-preserving collision guard (FR-017): compare
        // lowercased destination strings, not just exact matches.
        let key = item.dest_relative.as_str().to_lowercase();
        if !seen_dest.insert(key) {
            return Err(ContractError::new(
                ErrorCode::DestinationCollision,
                format!("two sources resolve to the same destination path: {}", item.dest_relative),
                ErrorSeverity::Blocking,
                false,
            ));
        }
    }

    // 6. Destination-exists guard (FR-016): never silently overwrite a path
    // that already exists as a user file/folder.
    for item in &planned {
        let abs = join_portable(&destination_root, item.dest_relative.as_str());
        if abs.exists() {
            return Err(ContractError::new(
                ErrorCode::DestinationExists,
                format!("destination already exists: {abs}"),
                ErrorSeverity::Blocking,
                false,
            ));
        }
    }

    // T042/FR-018: on Windows, a destination path exceeding the classic
    // 260-character limit is surfaced as a warning (not a failure — some
    // destinations opt into long-path support) rather than producing a
    // truncated tree. Windows-specific: macOS/Linux filesystems don't share
    // this constraint.
    if cfg!(windows) {
        let mut long_paths: BTreeSet<String> = BTreeSet::new();
        for item in &planned {
            let abs = join_portable(&destination_root, item.dest_relative.as_str());
            if exceeds_windows_long_path_limit(abs.as_str()) {
                long_paths.insert(abs.into_string());
            }
        }
        if !long_paths.is_empty() {
            warnings.push(GenerationWarning {
                code: GenerationWarningCode::LongPath,
                message: "one or more destination paths exceed the Windows 260-character limit"
                    .to_owned(),
                items: long_paths.into_iter().collect(),
            });
        }
    }

    // 7. Resolve link kind per item (FR-004/FR-022): capability probed once
    // against the project root (the nearest existing ancestor of the not-yet-
    // created destination tree — they share a volume).
    let settings = persistence_db::repositories::settings::load_settings(pool)
        .await
        .map_err(|e| db_internal_ctx(e, "load settings"))?;
    let intra_default = domain_core::source_view::Materialization::from_str_opt(
        &settings.source_view_link_kind_intra_drive,
    )
    .unwrap_or(Materialization::Hardlink);
    let cross_default = domain_core::source_view::Materialization::from_str_opt(
        &settings.source_view_link_kind_cross_drive,
    )
    .unwrap_or(Materialization::Symlink);
    let capability = fs_inventory::capability::probe(Utf8Path::new(&project.path));

    let mut drift_notices: BTreeSet<String> = BTreeSet::new();
    let mut resolved_kinds: BTreeMap<usize, Materialization> = BTreeMap::new();

    for (idx, item) in planned.iter().enumerate() {
        let source_root_path = persistence_db::repositories::inventory::get_library_root_path(
            pool,
            &item.source_root_id,
        )
        .await
        .unwrap_or(None);
        let Some(source_root_path) = source_root_path else {
            return Err(ContractError::new(
                ErrorCode::NoLinkKind,
                format!("source root {} could not be resolved", item.source_root_id),
                ErrorSeverity::Blocking,
                false,
            ));
        };
        let source_abs = Utf8PathBuf::from(source_root_path).join(&item.source_relative_path);
        let scope = fs_inventory::drive_scope::classify(&source_abs, &destination_root);

        let resolved = domain_core::source_view::resolve_link_kind(
            scope,
            intra_default,
            cross_default,
            capability,
            req.copy_opt_in,
        )
        .map_err(|_| {
            ContractError::new(
                ErrorCode::NoLinkKind,
                format!(
                    "no achievable link kind for '{}' (drive-scope {scope:?}); \
                     enable copyOptIn to allow a fallback copy",
                    item.dest_relative
                ),
                ErrorSeverity::Blocking,
                false,
            )
        })?;

        if let Some(requested) = resolved.capability_drift {
            drift_notices.insert(format!(
                "{} (requested {}, applied {})",
                item.dest_relative,
                requested.as_str(),
                resolved.kind.as_str()
            ));
        }
        resolved_kinds.insert(idx, resolved.kind);
    }

    let used_copy_fallback = resolved_kinds.values().any(|kind| *kind == Materialization::Copy);

    if !drift_notices.is_empty() {
        warnings.push(GenerationWarning {
            code: GenerationWarningCode::CapabilityDrift,
            message: "a saved link kind was not achievable and a documented fallback was applied"
                .to_owned(),
            items: drift_notices.into_iter().collect(),
        });
    }

    // 8. Persist the plan (origin `prepared_view_generation`, plan_type
    // `source_view_generation` — FR-021a).
    let title = format!("Generate source view for project {}", req.project_id);
    plans_repo::insert_plan(
        pool,
        &plans_repo::InsertPlan {
            id: &plan_id,
            title: &title,
            origin: "prepared_view_generation",
            origin_path: Some(&req.project_id),
            plan_type: "source_view_generation",
            destructive_destination: "archive",
            parent_plan_id: None,
            total_bytes_required: 0,
        },
    )
    .await
    .map_err(|e| db_internal_ctx(e, "insert source view generation plan"))?;

    // One mkdir action per distinct destination directory (idempotent —
    // `mkdir_op::make_dir` creates missing parents), then one link action per
    // planned item. Mkdirs are ordered first so link items never race an
    // absent parent directory.
    let mut item_index: i64 = 0;
    let mut mkdir_dirs: BTreeSet<Utf8PathBuf> = BTreeSet::new();
    mkdir_dirs.insert(destination_root.clone());
    for item in &planned {
        if let Some(parent) = join_portable(&destination_root, item.dest_relative.as_str()).parent()
        {
            mkdir_dirs.insert(parent.to_path_buf());
        }
    }
    for dir in &mkdir_dirs {
        item_index += 1;
        let item_id = new_id();
        plans_repo::insert_plan_item(
            pool,
            &plans_repo::InsertPlanItem {
                id: &item_id,
                plan_id: &plan_id,
                item_index,
                name: dir.as_str(),
                action: "mkdir",
                from_root_id: None,
                from_relative_path: "",
                to_root_id: None,
                to_relative_path: dir.as_str(),
                reason: "view_generation",
                protection: "normal",
                linked_entity: None,
                provenance_json: None,
                archive_path: None,
                source_id: None,
                category: None,
            },
        )
        .await
        .map_err(|e| db_internal_ctx(e, "insert generation mkdir item"))?;
    }

    for (idx, item) in planned.iter().enumerate() {
        item_index += 1;
        let item_id = new_id();
        let kind = resolved_kinds.get(&idx).copied().unwrap_or(Materialization::Symlink);
        let dest_abs = join_portable(&destination_root, item.dest_relative.as_str());
        let provenance = serde_json::to_string(&serde_json::json!([
            {"label": "materialization", "value": kind.as_str()}
        ]))
        .ok();

        plans_repo::insert_plan_item(
            pool,
            &plans_repo::InsertPlanItem {
                id: &item_id,
                plan_id: &plan_id,
                item_index,
                name: item.dest_relative.as_str(),
                action: "link",
                from_root_id: Some(&item.source_root_id),
                from_relative_path: &item.source_relative_path,
                to_root_id: None,
                to_relative_path: dest_abs.as_str(),
                reason: "view_generation",
                protection: "normal",
                linked_entity: Some(&item.inventory_item_id),
                provenance_json: provenance.as_deref(),
                archive_path: None,
                source_id: None,
                category: None,
            },
        )
        .await
        .map_err(|e| db_internal_ctx(e, "insert generation link item"))?;
    }

    // 9. Advance to ready_for_review (same convention as spec 026 remove/regenerate).
    plans_repo::update_plan_state(pool, &plan_id, "ready_for_review")
        .await
        .map_err(|e| db_internal_ctx(e, "advance generation plan to ready_for_review"))?;

    Ok(SourceViewGenerateResponse { plan_id, warnings, used_copy_fallback })
}
