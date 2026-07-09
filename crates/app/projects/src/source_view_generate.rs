//! Spec 049 US1: `sourceview.generate` — first-materialization of a project
//! source view as a reviewable `prepared_view_generation` plan.
//!
//! Companion to `crate::prepared_views` (spec 026 remove/regenerate), which
//! this module reuses unchanged: the `PreparedSourceView` /
//! `PreparedSourceViewItem` entities, the project-lifecycle gate, and the
//! spec 017/025 plan review→approve→apply pipeline. The first-materialization
//! DB write itself happens on successful apply
//! (`app_core::plan_apply::finalize_view_generation`), not here — this use
//! case only builds and persists the reviewable plan (FR-001).
//!
//! ## Scope (US1 MVP superseded by US2 profile-driven layout)
//!
//! - Selection is **session-level** (spec 048 per-frame selection is a
//!   separate follow-up, CL-9): every project-linked `acquisition_session`
//!   (`project_sources`) contributes all of its **present** frames.
//! - Layout is **profile-driven** (spec 049 US2 T025/T026): the active
//!   project's tool profile (`req.profile_id`, else `projects.tool`, resolved
//!   against `workflow_profiles::seed`) supplies a
//!   [`workflow_profiles::SourceViewLayout`] — a `{token}` directory pattern
//!   for lights (WBPP default: `{date}/{filter}/{exposure}/`, i.e.
//!   session/night → filter → exposure) resolved via
//!   [`patterns::resolve_pattern_str`] against the shared v1 token registry,
//!   plus a calibration-location pattern. Every matched calibration set still
//!   gets its own subdirectory beneath that location (keyed by `master_id`)
//!   so collisions stay impossible by construction (FR-009a/CL-5) without
//!   needing a `master_id` metadata token in the shared registry.
//! - Calibration selection (T027): `calibration_assignment.master_id` always
//!   resolves to a `calibration_session` row. This codebase's calibration
//!   matching engine (`calibration_core::MasterInfo`) has no raw-vs-master
//!   branch at that level — the raw/master distinction (spec 040 `is_master`)
//!   is resolved earlier, during inbox confirm, onto
//!   `inbox_classification_evidence`, and is not carried onto
//!   `calibration_session`/`calibration_assignment`. So "masters when the
//!   match resolved masters, else the matched raw calibration sets" (FR-010/
//!   CL-4) already holds trivially today: there is exactly one resolved frame
//!   set per assignment, and it is linked as-is. If a future schema change
//!   lets one assignment carry both a master and a raw fallback, this
//!   function's calibration loop is the place to add masters-preferred
//!   branching.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use camino::{Utf8Path, Utf8PathBuf};
use contracts_core::source_view_generate::{
    GenerationWarning, GenerationWarningCode, SourceViewGenerateRequest, SourceViewGenerateResponse,
};
use contracts_core::{error_code::ErrorCode, ContractError, ErrorSeverity};
use domain_core::ids::new_id;
use domain_core::source_view::Materialization;
use patterns::{resolve_pattern_str, MetadataBundle, ResolveError};
use persistence_db::repositories::{plans as plans_repo, projects as projects_repo};
use sqlx::SqlitePool;

use app_core_errors::db_internal_ctx;

use crate::prepared_views::{check_project_lifecycle, project_db_err};

/// Map a pattern-resolution failure to a blocking `ContractError` (spec 049
/// US2 T026). Layout patterns are fixed per profile, so these are only
/// reachable via pathological metadata values (e.g. a filter/exposure
/// snapshot containing `..`) — treat them the same as the other filesystem
/// safety refusals in this module: refuse and point at the offending pattern
/// input, never silently truncate or substitute.
fn layout_resolve_err(e: &ResolveError, dest_hint: &str) -> ContractError {
    let code = match e {
        ResolveError::PathTraversal { .. } => ErrorCode::PathTraversal,
        ResolveError::ReservedName { .. } => ErrorCode::PathReservedName,
        ResolveError::Empty | ResolveError::UnknownToken { .. } => ErrorCode::PathInvalid,
        ResolveError::UnicodeConfusable { .. } | ResolveError::PathTooLong { .. } => {
            ErrorCode::PathInvalid
        }
    };
    ContractError::new(
        code,
        format!("could not resolve source-view layout for '{dest_hint}': {e}"),
        ErrorSeverity::Blocking,
        false,
    )
}

/// Extract the observing-night component (`YYYY-MM-DD`) from a `session_key`
/// (spec 002 T033a format: `target|filter|binning|gain|night`). Falls back to
/// the whole key when it does not contain the expected separator (e.g. test
/// fixtures using a bare id as the key) — the `{date}` token's own fallback
/// (`"undated"`) only applies to an *absent* metadata field, not a malformed
/// one, so this never fails generation.
fn session_night(session_key: &str) -> String {
    session_key.rsplit('|').next().unwrap_or(session_key).to_owned()
}

// ── Row helpers (ad hoc queries — mirrors the pragmatic per-item query style
// already used in `prepared_views::regenerate_prepared_view`) ────────────────

struct FrameRow {
    id: String,
    relative_path: String,
    state: String,
}

/// Resolve `file_record` rows for a set of ids.
///
/// The session-level `root_id` (captured once from the owning
/// `acquisition_session`/`calibration_session` row) is used for every frame
/// in that session rather than re-reading `file_record.root_id` per row —
/// sessions are single-root by construction in this codebase (see
/// `inventory::SessionProjectionRow`).
async fn frames_for_ids(pool: &SqlitePool, ids: &[String]) -> Vec<FrameRow> {
    let mut out = Vec::with_capacity(ids.len());
    for id in ids {
        if let Ok(Some(row)) = sqlx::query_as::<_, (String, String)>(
            "SELECT relative_path, state FROM file_record WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(pool)
        .await
        {
            out.push(FrameRow { id: id.clone(), relative_path: row.0, state: row.1 });
        }
        // Missing rows are silently absent here — the caller treats an id
        // with no resolved frame as unresolved (FR-019).
    }
    out
}

fn parse_frame_ids(json: &str) -> Vec<String> {
    serde_json::from_str(json).unwrap_or_default()
}

/// Append `segment` to `base` with a `/` separator, regardless of platform
/// path-separator conventions.
///
/// `Utf8PathBuf::join` inserts the platform-native separator (`\` on
/// Windows), which mixes with the forward-slash convention documented and
/// used by `resolve_pattern_str` (`crates/patterns`). Building destinations by
/// chaining `.join()` calls on Windows therefore produces paths with both
/// `\` and `/` in them (e.g. `foo\bar/baz\qux.fits`) — cosmetically ugly, but
/// also non-deterministic for anything that persists or compares
/// `to_relative_path`/`name` (spec 049's plan items). Windows path APIs
/// accept `/` as a separator natively, so joining with `/` unconditionally is
/// safe on every supported platform and keeps generated destinations
/// portable, matching the "Portable Contracts and Durable Records"
/// constitution principle.
fn join_portable(base: &Utf8Path, segment: &str) -> Utf8PathBuf {
    if base.as_str().is_empty() {
        Utf8PathBuf::from(segment)
    } else {
        Utf8PathBuf::from(format!("{base}/{segment}"))
    }
}

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
    let plan_id = new_id();
    let destination_root: Utf8PathBuf = req.destination_override.as_deref().map_or_else(
        || {
            let root = Utf8PathBuf::from(&project.path);
            join_portable(&join_portable(&root, "source-views"), &plan_id)
        },
        Utf8PathBuf::from,
    );

    for src in &sources {
        let Some((root_id, session_key, frame_ids_json)) =
            sqlx::query_as::<_, (String, String, String)>(
                "SELECT root_id, session_key, frame_ids FROM acquisition_session WHERE id = ?",
            )
            .bind(&src.inventory_session_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| db_internal_ctx(e, "load acquisition session"))?
        else {
            unresolved_refs.push(src.inventory_session_id.clone());
            continue;
        };

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
        let assignments: Vec<(String, String)> = sqlx::query_as(
            "SELECT calibration_type, master_id FROM calibration_assignment WHERE session_id = ?",
        )
        .bind(&src.inventory_session_id)
        .fetch_all(pool)
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
            let Some((cal_root_id, cal_frame_ids_json)) = sqlx::query_as::<_, (String, String)>(
                "SELECT root_id, frame_ids FROM calibration_session WHERE id = ?",
            )
            .bind(&master_id)
            .fetch_optional(pool)
            .await
            .unwrap_or(None) else {
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

#[cfg(test)]
mod tests {
    use super::*;
    use domain_core::ids::new_id as new_test_id;
    use persistence_db::Database;

    async fn setup() -> Database {
        let db = Database::in_memory().await.expect("in-memory DB");
        db.migrate().await.expect("migrations");
        db
    }

    async fn insert_project(db: &Database, id: &str, lifecycle: &str, path: &str) {
        sqlx::query(
            "INSERT INTO projects (id, name, tool, lifecycle, path, created_at, updated_at)
             VALUES (?, ?, 'PixInsight', ?, ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .bind(id)
        .bind(id)
        .bind(lifecycle)
        .bind(path)
        .execute(db.pool())
        .await
        .unwrap();
    }

    async fn insert_root(db: &Database, id: &str, path: &str) {
        sqlx::query(
            "INSERT INTO library_root (id, label, current_path, kind, state, created_at)
             VALUES (?, ?, ?, 'local', 'active', '2026-01-01T00:00:00Z')",
        )
        .bind(id)
        .bind(id)
        .bind(path)
        .execute(db.pool())
        .await
        .unwrap();
    }

    async fn insert_file_record(db: &Database, id: &str, root_id: &str, relative_path: &str) {
        sqlx::query(
            "INSERT INTO file_record (id, root_id, relative_path, size_bytes, mtime, state, first_seen_at, last_seen_at)
             VALUES (?, ?, ?, 100, '2026-01-01T00:00:00Z', 'classified', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .bind(id)
        .bind(root_id)
        .bind(relative_path)
        .execute(db.pool())
        .await
        .unwrap();
    }

    async fn insert_acquisition_session(
        db: &Database,
        id: &str,
        root_id: &str,
        frame_ids: &[&str],
    ) {
        let json = serde_json::to_string(frame_ids).unwrap();
        sqlx::query(
            "INSERT INTO acquisition_session (id, session_key, root_id, frame_ids, created_at)
             VALUES (?, ?, ?, ?, '2026-01-01T00:00:00Z')",
        )
        .bind(id)
        .bind(id)
        .bind(root_id)
        .bind(json)
        .execute(db.pool())
        .await
        .unwrap();
    }

    async fn link_project_source(db: &Database, project_id: &str, session_id: &str) {
        link_project_source_with(db, project_id, session_id, "L", "300").await;
    }

    async fn link_project_source_with(
        db: &Database,
        project_id: &str,
        session_id: &str,
        filter: &str,
        exposure: &str,
    ) {
        sqlx::query(
            "INSERT INTO project_sources (id, project_id, inventory_session_id, name_snapshot, frames_snapshot, filter_snapshot, exposure_snapshot, linked_at)
             VALUES (?, ?, ?, 'snap', 1, ?, ?, '2026-01-01T00:00:00Z')",
        )
        .bind(new_test_id())
        .bind(project_id)
        .bind(session_id)
        .bind(filter)
        .bind(exposure)
        .execute(db.pool())
        .await
        .unwrap();
    }

    async fn insert_acquisition_session_with_key(
        db: &Database,
        id: &str,
        session_key: &str,
        root_id: &str,
        frame_ids: &[&str],
    ) {
        let json = serde_json::to_string(frame_ids).unwrap();
        sqlx::query(
            "INSERT INTO acquisition_session (id, session_key, root_id, frame_ids, created_at)
             VALUES (?, ?, ?, ?, '2026-01-01T00:00:00Z')",
        )
        .bind(id)
        .bind(session_key)
        .bind(root_id)
        .bind(json)
        .execute(db.pool())
        .await
        .unwrap();
    }

    async fn insert_calibration_session(
        db: &Database,
        id: &str,
        root_id: &str,
        frame_ids: &[&str],
    ) {
        let json = serde_json::to_string(frame_ids).unwrap();
        sqlx::query(
            "INSERT INTO calibration_session (id, session_key, root_id, frame_ids, kind, created_at)
             VALUES (?, ?, ?, ?, 'flat', '2026-01-01T00:00:00Z')",
        )
        .bind(id)
        .bind(id)
        .bind(root_id)
        .bind(json)
        .execute(db.pool())
        .await
        .unwrap();
    }

    async fn insert_calibration_assignment(
        db: &Database,
        session_id: &str,
        calibration_type: &str,
        master_id: &str,
    ) {
        sqlx::query(
            "INSERT INTO calibration_assignment (id, session_id, calibration_type, master_id, confidence, assigned_at)
             VALUES (?, ?, ?, ?, 1.0, '2026-01-01T00:00:00Z')",
        )
        .bind(new_test_id())
        .bind(session_id)
        .bind(calibration_type)
        .bind(master_id)
        .execute(db.pool())
        .await
        .unwrap();
    }

    fn req(project_id: &str) -> SourceViewGenerateRequest {
        SourceViewGenerateRequest {
            project_id: project_id.to_owned(),
            profile_id: None,
            destination_override: None,
            copy_opt_in: false,
            strict: false,
        }
    }

    #[tokio::test]
    async fn generates_plan_for_project_with_selected_lights() {
        let db = setup().await;
        let dir = tempfile::tempdir().unwrap();
        let project_path = format!("{}/proj", dir.path().to_str().unwrap());
        std::fs::create_dir_all(&project_path).unwrap();
        insert_project(&db, "p1", "ready", &project_path).await;
        insert_root(&db, "root1", dir.path().to_str().unwrap()).await;
        std::fs::write(format!("{}/light1.fits", dir.path().to_str().unwrap()), b"x").unwrap();
        insert_file_record(&db, "frame1", "root1", "light1.fits").await;
        insert_acquisition_session(&db, "sess1", "root1", &["frame1"]).await;
        link_project_source(&db, "p1", "sess1").await;

        let resp = generate_source_view(db.pool(), &req("p1")).await.unwrap();
        assert!(!resp.plan_id.is_empty());
        // No calibration assignment for sess1 → warning, not a failure.
        assert!(resp.warnings.iter().any(|w| w.code
            == contracts_core::source_view_generate::GenerationWarningCode::NoCalibrationApplied));

        let plan = plans_repo::get_plan(db.pool(), &resp.plan_id, false).await.unwrap();
        assert_eq!(plan.state, "ready_for_review");
        assert_eq!(plan.origin, "prepared_view_generation");
        assert_eq!(plan.plan_type, "source_view_generation");

        let items = plans_repo::list_plan_items(db.pool(), &resp.plan_id).await.unwrap();
        // 1 mkdir (view root + Lights/sess1 collapse to distinct dirs) + 1 link.
        assert!(items.iter().any(|i| i.action == "link"));
        assert!(items.iter().any(|i| i.action == "mkdir"));
        let link_item = items.iter().find(|i| i.action == "link").unwrap();
        assert_eq!(link_item.from_relative_path, "light1.fits");
        assert_eq!(link_item.linked_entity.as_deref(), Some("frame1"));
    }

    #[tokio::test]
    async fn refuses_archived_project() {
        let db = setup().await;
        insert_project(&db, "p-arch", "archived", "/tmp/proj-arch").await;

        let err = generate_source_view(db.pool(), &req("p-arch")).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::LifecycleReadOnly);
    }

    #[tokio::test]
    async fn refuses_no_selection() {
        let db = setup().await;
        insert_project(&db, "p-empty", "ready", "/tmp/proj-empty").await;

        let err = generate_source_view(db.pool(), &req("p-empty")).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::NoSelection);
    }

    #[tokio::test]
    async fn project_not_found() {
        let db = setup().await;
        let err = generate_source_view(db.pool(), &req("nonexistent")).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::ProjectNotFound);
    }

    // ── Spec 049 US2 ──────────────────────────────────────────────────────

    /// T023 (builder-level companion to the `workflow_profiles` unit tests):
    /// a PixInsight project groups lights by session/night → filter →
    /// exposure instead of the US1 MVP flat `Lights/<session_id>/` tree.
    #[tokio::test]
    async fn wbpp_layout_groups_lights_by_night_filter_exposure() {
        let db = setup().await;
        let dir = tempfile::tempdir().unwrap();
        let project_path = format!("{}/proj", dir.path().to_str().unwrap());
        std::fs::create_dir_all(&project_path).unwrap();
        insert_project(&db, "p1", "ready", &project_path).await;
        insert_root(&db, "root1", dir.path().to_str().unwrap()).await;
        std::fs::write(format!("{}/light1.fits", dir.path().to_str().unwrap()), b"x").unwrap();
        insert_file_record(&db, "frame1", "root1", "light1.fits").await;
        insert_acquisition_session_with_key(
            &db,
            "sess1",
            "M31|Ha|1x1|100|2026-03-15",
            "root1",
            &["frame1"],
        )
        .await;
        link_project_source_with(&db, "p1", "sess1", "Ha", "300").await;

        let resp = generate_source_view(db.pool(), &req("p1")).await.unwrap();
        let items = plans_repo::list_plan_items(db.pool(), &resp.plan_id).await.unwrap();
        let link_item = items.iter().find(|i| i.action == "link").unwrap();
        assert_eq!(
            link_item.to_relative_path,
            format!("{project_path}/source-views/{}/2026-03-15/Ha/300/light1.fits", resp.plan_id)
        );
    }

    /// T024: changing the metadata that feeds the profile pattern (a
    /// different session/filter/exposure) changes only the destination path
    /// — the canonical `file_record`/`acquisition_session` rows are read,
    /// never written, by generation (US2 AS2).
    #[tokio::test]
    async fn changing_session_metadata_changes_destination_not_canonical_data() {
        let db = setup().await;
        let dir = tempfile::tempdir().unwrap();
        let project_path = format!("{}/proj", dir.path().to_str().unwrap());
        std::fs::create_dir_all(&project_path).unwrap();
        insert_project(&db, "p1", "ready", &project_path).await;
        insert_root(&db, "root1", dir.path().to_str().unwrap()).await;
        std::fs::write(format!("{}/light1.fits", dir.path().to_str().unwrap()), b"x").unwrap();
        insert_file_record(&db, "frame1", "root1", "light1.fits").await;
        insert_acquisition_session_with_key(
            &db,
            "sess1",
            "M31|Ha|1x1|100|2026-03-15",
            "root1",
            &["frame1"],
        )
        .await;
        link_project_source_with(&db, "p1", "sess1", "Lum", "600").await;

        let before: (String, String) =
            sqlx::query_as("SELECT relative_path, state FROM file_record WHERE id = 'frame1'")
                .fetch_one(db.pool())
                .await
                .unwrap();

        let resp = generate_source_view(db.pool(), &req("p1")).await.unwrap();
        let items = plans_repo::list_plan_items(db.pool(), &resp.plan_id).await.unwrap();
        let link_item = items.iter().find(|i| i.action == "link").unwrap();
        assert!(link_item.to_relative_path.ends_with("2026-03-15/Lum/600/light1.fits"));

        // Canonical file_record is untouched by generation.
        let after: (String, String) =
            sqlx::query_as("SELECT relative_path, state FROM file_record WHERE id = 'frame1'")
                .fetch_one(db.pool())
                .await
                .unwrap();
        assert_eq!(before, after);
    }

    /// T026/FR-010: matched calibration lands under the profile's calibration
    /// location, in its own `master_id` subdirectory (never colliding with
    /// another matched set of the same type).
    #[tokio::test]
    async fn calibration_lands_under_profile_calibration_location() {
        let db = setup().await;
        let dir = tempfile::tempdir().unwrap();
        let project_path = format!("{}/proj", dir.path().to_str().unwrap());
        std::fs::create_dir_all(&project_path).unwrap();
        insert_project(&db, "p1", "ready", &project_path).await;
        insert_root(&db, "root1", dir.path().to_str().unwrap()).await;
        std::fs::write(format!("{}/light1.fits", dir.path().to_str().unwrap()), b"x").unwrap();
        std::fs::write(format!("{}/flat1.fits", dir.path().to_str().unwrap()), b"x").unwrap();
        insert_file_record(&db, "frame1", "root1", "light1.fits").await;
        insert_file_record(&db, "flat1", "root1", "flat1.fits").await;
        insert_acquisition_session(&db, "sess1", "root1", &["frame1"]).await;
        link_project_source(&db, "p1", "sess1").await;
        insert_calibration_session(&db, "master-flat-1", "root1", &["flat1"]).await;
        insert_calibration_assignment(&db, "sess1", "flat", "master-flat-1").await;

        let resp = generate_source_view(db.pool(), &req("p1")).await.unwrap();
        // Calibration matched → no "no calibration applied" warning.
        assert!(!resp.warnings.iter().any(|w| w.code
            == contracts_core::source_view_generate::GenerationWarningCode::NoCalibrationApplied));

        let items = plans_repo::list_plan_items(db.pool(), &resp.plan_id).await.unwrap();
        let cal_item =
            items.iter().find(|i| i.from_relative_path == "flat1.fits").expect("calibration link");
        assert!(
            cal_item.to_relative_path.ends_with("calibration/flat/master-flat-1/flat1.fits"),
            "unexpected calibration destination: {}",
            cal_item.to_relative_path
        );
    }

    /// T028: a session that matches *some* but not all of the project's
    /// observed calibration types still generates, and is flagged the same
    /// as a session with zero matches (FR-010a/CL-7 "no or partial").
    #[tokio::test]
    async fn partial_calibration_coverage_is_flagged() {
        let db = setup().await;
        let dir = tempfile::tempdir().unwrap();
        let project_path = format!("{}/proj", dir.path().to_str().unwrap());
        std::fs::create_dir_all(&project_path).unwrap();
        insert_project(&db, "p1", "ready", &project_path).await;
        insert_root(&db, "root1", dir.path().to_str().unwrap()).await;

        // sess1: matches both dark + flat (full coverage for this project).
        std::fs::write(format!("{}/light1.fits", dir.path().to_str().unwrap()), b"x").unwrap();
        std::fs::write(format!("{}/dark1.fits", dir.path().to_str().unwrap()), b"x").unwrap();
        std::fs::write(format!("{}/flat1.fits", dir.path().to_str().unwrap()), b"x").unwrap();
        insert_file_record(&db, "frame1", "root1", "light1.fits").await;
        insert_file_record(&db, "dark1", "root1", "dark1.fits").await;
        insert_file_record(&db, "flat1", "root1", "flat1.fits").await;
        insert_acquisition_session(&db, "sess1", "root1", &["frame1"]).await;
        link_project_source(&db, "p1", "sess1").await;
        insert_calibration_session(&db, "master-dark-1", "root1", &["dark1"]).await;
        insert_calibration_session(&db, "master-flat-1", "root1", &["flat1"]).await;
        insert_calibration_assignment(&db, "sess1", "dark", "master-dark-1").await;
        insert_calibration_assignment(&db, "sess1", "flat", "master-flat-1").await;

        // sess2: matches only dark (partial relative to the project's flat+dark
        // coverage), via its own master (a shared master would trip the
        // pre-existing FR-009a collision guard, unrelated to this behavior).
        std::fs::write(format!("{}/light2.fits", dir.path().to_str().unwrap()), b"x").unwrap();
        std::fs::write(format!("{}/dark2.fits", dir.path().to_str().unwrap()), b"x").unwrap();
        insert_file_record(&db, "frame2", "root1", "light2.fits").await;
        insert_file_record(&db, "dark2", "root1", "dark2.fits").await;
        insert_acquisition_session(&db, "sess2", "root1", &["frame2"]).await;
        link_project_source(&db, "p1", "sess2").await;
        insert_calibration_session(&db, "master-dark-2", "root1", &["dark2"]).await;
        insert_calibration_assignment(&db, "sess2", "dark", "master-dark-2").await;

        let resp = generate_source_view(db.pool(), &req("p1")).await.unwrap();
        let warning = resp
            .warnings
            .iter()
            .find(|w| {
                w.code == contracts_core::source_view_generate::GenerationWarningCode::NoCalibrationApplied
            })
            .expect("partial coverage must still surface a warning");
        assert!(warning.items.contains(&"sess2".to_owned()));
        assert!(!warning.items.contains(&"sess1".to_owned()));
    }
}
