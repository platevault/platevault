// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Spec 017 US2 (WP-B) whole-project archive plan generator + archive listing.
//!
//! ## Generator (`generate`)
//!
//! Builds a reviewable, whole-project archive plan: every observed processing
//! artifact of a project becomes an `archive`-action plan item that moves the
//! file into the app-managed archive folder
//! (`<library_root>/.astro-plan-archive/<planId>/…`, resolved by the spec-025
//! executor at apply time). Generating a plan performs NO filesystem mutation
//! (constitution II / FR-002) and never auto-applies.
//!
//! ### DB-backed candidate discipline (mirrors #389)
//!
//! Files are enumerated from the `processing_artifacts` table only — the same
//! recorded-inventory read path the cleanup generator uses. We do NOT walk the
//! filesystem to discover files the DB does not know about (constitution I/II).
//! Classification reuses [`crate::cleanup_generator::DataType`] so a file's
//! protected-category (masters/finals) still gates approval; unlike cleanup, an
//! archive plan takes ALL observed artifacts regardless of a cleanup policy —
//! archiving preserves the whole project.
//!
//! ### FR-008 note (documented deviation)
//!
//! FR-008 says archive destinations come from the spec-015 token pattern
//! builder. The C5 reconciliation instead routes archive plans through the
//! app-managed archive folder so the archive-management operations
//! (`archive.send_to_trash` / `archive.permanently_delete`, which already act on
//! `<library_root>/.astro-plan-archive/<planId>/`) work O(1) off
//! `archived_via_plan_id`. Each item's `to_relative_path` is the project's own
//! relative path; the executor joins it under the archive root. Revert path: a
//! pattern-resolved destination can replace `to_relative_path` here without
//! changing any other surface.
//!
//! ## Lifecycle closure
//!
//! The archive plan carries the project id in the plan row's `origin_path`. On a
//! successful (`applied`) apply of an `origin = archive` plan, the apply path
//! (`crate::plan_apply`) drives the project → `archived` lifecycle transition —
//! the single legitimate closure of the requires-plan gate (C5).
//!
//! ## Listing (`list_archived`)
//!
//! `archive.list` returns projects currently in the `archived` lifecycle state
//! only (C5: projects-only surface — no session/master/target rows), each row
//! carrying `archived_via_plan_id` so the management commands act on the owning
//! plan.

#![allow(clippy::doc_markdown)] // domain terminology not appropriate for backticks

use camino::Utf8Path;
use contracts_core::archive::{
    ArchiveEntry, ArchiveListResponse, GenerateArchivePlanResult, GenerateRestorePlanResult,
};
use contracts_core::error_code::ErrorCode;
use contracts_core::{ContractError, ErrorSeverity};
use persistence_plans::repositories::artifacts as artifacts_repo;
use persistence_plans::repositories::plans as plans_repo;
use persistence_plans::repositories::projects as projects_repo;
use sqlx::SqlitePool;

use crate::cleanup_generator::DataType;
use crate::errors::db_err;
use crate::protection::{self, CleanupPlanItem, GeneratePlanRequest};
use domain_core::ids::new_id;

/// Take the tail of a project-relative path (the file name) for display.
fn file_name(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

/// Materialise a reviewable whole-project archive plan (spec 017 US2, WP-B).
///
/// Enumerates the project's `present` processing artifacts, maps each to an
/// `archive`-action [`CleanupPlanItem`] tagged with the project id as its source
/// and the artifact's protected-category, then delegates to the shared
/// protection tail [`crate::protection::generate_plan`] which persists the plan
/// + items, resolves per-item protection, and advances to `ready_for_review`.
///
/// The plan is `plan_type = "archive"`, `origin = "archive"`, with the project
/// id stored in `origin_path` for the apply-time lifecycle closure.
///
/// Generating a plan performs NO filesystem mutation (FR-002).
///
/// # Errors
///
/// Returns `ContractError` on database failure.
pub async fn generate(
    pool: &SqlitePool,
    project_id: &str,
    title: Option<&str>,
) -> Result<GenerateArchivePlanResult, ContractError> {
    let plan_id = new_id();

    // Derive a title from the project when the caller did not supply one.
    let resolved_title = match title {
        Some(t) => t.to_owned(),
        None => match projects_repo::get_project(pool, project_id).await {
            Ok(p) => format!("Archive: {}", p.name),
            Err(_) => "Archive plan".to_owned(),
        },
    };

    // DB-backed candidates only: every present artifact of the project.
    let rows = artifacts_repo::list_artifacts_for_project(pool, project_id, &["present"])
        .await
        .map_err(db_err)?;

    let mut total_bytes_required: i64 = 0;
    let items: Vec<CleanupPlanItem> = rows
        .into_iter()
        .enumerate()
        .map(|(idx, row)| {
            let data_type = DataType::from_artifact_kind(&row.kind);
            total_bytes_required = total_bytes_required.saturating_add(row.size_bytes.max(0));
            CleanupPlanItem {
                id: format!("{plan_id}-item-{idx}"),
                name: file_name(&row.path).to_owned(),
                action: "archive".to_owned(),
                source_id: project_id.to_owned(),
                category: data_type.protection_category().to_owned(),
                from_relative_path: row.path.clone(),
                from_root_id: None,
                // C5: archive under the app-managed folder keyed by plan id; the
                // executor joins this relative path beneath the archive root.
                to_relative_path: row.path,
            }
        })
        .collect();

    let item_count = u32::try_from(items.len()).unwrap_or(u32::MAX);
    // #603: an empty plan is silent by default (a disabled "Approve & apply"
    // with no explanation) — the generator is the only place that knows WHY
    // (zero `present` processing artifacts recorded for this project), so
    // compute the diagnostic here rather than leaving the review UI to guess.
    let empty_reason = (item_count == 0)
        .then(|| "No files are linked to this project's sources — nothing to archive".to_owned());

    let resp = protection::generate_plan(
        pool,
        &GeneratePlanRequest {
            plan_id: plan_id.clone(),
            title: resolved_title,
            origin: "archive".to_owned(),
            plan_type: "archive".to_owned(),
            origin_path: Some(project_id.to_owned()),
            destructive_destination: "archive".to_owned(),
            reason: "archive".to_owned(),
            total_bytes_required,
            items,
        },
    )
    .await?;

    Ok(GenerateArchivePlanResult {
        plan_id: resp.plan_id,
        item_count,
        protected_item_count: u32::try_from(resp.protected_item_count).unwrap_or(u32::MAX),
        empty_reason,
    })
}

/// Resolve the app-managed archive folder for the Reveal action (#874).
///
/// Takes the first plan item that actually has an `archive_path` (some items
/// may have failed to resolve one) and returns its parent directory — the
/// `.astro-plan-archive/<planId>/` folder itself, since `archive_path` points
/// at `<folder>/<itemId>-<fileName>` (see `protection::compute_archive_destination`).
///
/// Only handles the un-rooted (`from_root_id: None`) convention `archive_generator`
/// itself produces; a rooted `archive_path` (root-relative, set by the
/// cleanup-generator archive path) is left unresolved (`None`) rather than
/// guessing a root, since this generator has no root context to resolve it —
/// a real gap only if cleanup-driven archives ever reach `archive.list`, which
/// C5's projects-only surface does not do today.
async fn resolve_archive_folder_path(pool: &SqlitePool, plan_id: &str) -> Option<String> {
    let items = plans_repo::list_plan_items(pool, plan_id).await.ok()?;
    let item = items.iter().find(|i| i.archive_path.is_some() && i.from_root_id.is_none())?;
    let archive_path = item.archive_path.as_deref()?;
    Utf8Path::new(archive_path).parent().map(ToString::to_string)
}

/// `archive.list` — every project currently in the `archived` lifecycle state.
///
/// C5: projects-only surface. Each row carries `archived_via_plan_id` so the
/// archive-management commands can act on the owning plan in O(1).
///
/// # Errors
///
/// Returns `ContractError` on database failure.
pub async fn list_archived(pool: &SqlitePool) -> Result<ArchiveListResponse, ContractError> {
    let rows = projects_repo::list_archived_projects(pool).await.map_err(db_err)?;

    // N+1 per-entry lookup (one `list_plan_items` per archived project) to
    // resolve #874's Reveal folder — acceptable for the Archive listing's
    // low cardinality; revisit with a joined query if that stops holding.
    let mut entries = Vec::with_capacity(rows.len());
    for r in rows {
        let archive_folder_path = match r.archived_via_plan_id.as_deref() {
            Some(plan_id) => resolve_archive_folder_path(pool, plan_id).await,
            None => None,
        };
        entries.push(ArchiveEntry {
            id: r.id,
            name: r.name,
            entity_type: "project".to_owned(),
            archived_at: r.archived_at,
            // Q16 / FR-136: no absence-synthesizing fallbacks — pass the
            // row's Option straight through (a deleted owning plan leaves
            // both genuinely unresolved, not an empty string / zero).
            reason: r.plan_title,
            original_path: r.path,
            size_bytes: r.archived_bytes,
            archived_via_plan_id: r.archived_via_plan_id,
            archive_folder_path,
        });
    }

    Ok(ArchiveListResponse { entries })
}

/// Materialise a reviewable restore (un-archive) plan (#885, decision D15).
///
/// Reverses a previously **applied** archive plan: every archived item (one
/// whose `archive_path` was actually resolved) becomes a `move`-action item
/// whose source is the archive location and whose destination is the item's
/// original recorded location (`from_relative_path`) — the exact mirror of
/// what the archive plan moved. Reuses the shared protection tail
/// ([`crate::protection::generate_plan`]), so the restore plan gets the same
/// reviewable-mutation discipline (constitution II): persisted in
/// `ready_for_review`, protected items gate approval, no filesystem mutation
/// happens until an explicit approve + apply.
///
/// Collision handling (an original path now occupied) and partially-missing
/// archives are NOT special-cased here: the shared apply-time move primitive
/// already refuses to silently overwrite an occupied destination
/// (`conflict.destination_exists`) and already treats a missing source as a
/// per-item failure rather than aborting the whole plan (the same
/// partial-apply model every other plan type uses) — a bespoke pre-check
/// here would only duplicate that enforcement.
///
/// The project id carried in the archive plan's `origin_path` is reused as
/// this plan's `origin_path` too, so a successful apply can drive the
/// R-Unarchive lifecycle closure (`crate::plan_apply::finalize_restore_lifecycle`).
///
/// # Errors
///
/// Returns `ContractError` with code:
/// - `plan.not_found` — no matching archive plan.
/// - `plan.invalid_state` — the referenced plan is not an *applied* `archive` plan.
/// - `archive.empty` — the archive plan has no items to restore.
pub async fn generate_restore(
    pool: &SqlitePool,
    archived_plan_id: &str,
    title: Option<&str>,
) -> Result<GenerateRestorePlanResult, ContractError> {
    generate_restore_generic(pool, archived_plan_id, title, "archive", "restore").await
}

/// Origin-parameterised tail shared by [`generate_restore`] (whole-project,
/// `origin = "archive"`) and `calibration_archive_generator::generate_restore`
/// (#886, single master, `origin = "calibration_master_archive"`) — the two
/// differ only in which archive-plan origin they reverse and which origin
/// they write the restore plan under; every other step (state validation,
/// archived-item filtering, reversed move-item mapping, protection tail) is
/// identical, so this is extracted rather than duplicated per entity kind.
///
/// # Errors
///
/// Returns `ContractError` with code:
/// - `plan.not_found` — no matching archive plan.
/// - `plan.invalid_state` — the referenced plan is not an *applied* plan of
///   `expected_archive_origin`.
/// - `archive.empty` — the archive plan has no items to restore.
pub(crate) async fn generate_restore_generic(
    pool: &SqlitePool,
    archived_plan_id: &str,
    title: Option<&str>,
    expected_archive_origin: &str,
    restore_origin: &str,
) -> Result<GenerateRestorePlanResult, ContractError> {
    // A missing plan gets the domain-specific `plan.not_found` code (matching
    // this function's documented contract) rather than the generic
    // `db_err`/`internal.database` mapping — mirrors `plans.rs`'s local
    // `db_err` shadow for the same lookup-by-id NotFound case.
    let archived_plan =
        plans_repo::get_plan(pool, archived_plan_id, false).await.map_err(|e| match e {
            persistence_core::DbError::NotFound(msg) => {
                ContractError::new(ErrorCode::PlanNotFound, msg, ErrorSeverity::Blocking, false)
            }
            other => db_err(other),
        })?;

    if archived_plan.origin != expected_archive_origin || archived_plan.state != "applied" {
        return Err(ContractError::new(
            ErrorCode::PlanInvalidState,
            format!(
                "plan {archived_plan_id} is not an applied {expected_archive_origin} plan \
                 (origin={}, state={})",
                archived_plan.origin, archived_plan.state
            ),
            ErrorSeverity::Blocking,
            false,
        ));
    }

    let source_items = plans_repo::list_plan_items(pool, archived_plan_id).await.map_err(db_err)?;
    let archived_items: Vec<_> =
        source_items.into_iter().filter(|i| i.archive_path.is_some()).collect();

    if archived_items.is_empty() {
        return Err(ContractError::new(
            ErrorCode::ArchiveEmpty,
            format!("plan {archived_plan_id} has no archived items to restore"),
            ErrorSeverity::Blocking,
            false,
        ));
    }

    let plan_id = new_id();
    let resolved_title =
        title.map_or_else(|| format!("Restore: {}", archived_plan.title), str::to_owned);

    let items: Vec<CleanupPlanItem> = archived_items
        .into_iter()
        .enumerate()
        .map(|(idx, row)| CleanupPlanItem {
            id: format!("{plan_id}-item-{idx}"),
            name: file_name(&row.from_relative_path).to_owned(),
            action: "move".to_owned(),
            source_id: row.source_id.unwrap_or_default(),
            category: row.category.unwrap_or_default(),
            // Reversed: the archived file's current location is the source,
            // its originally-recorded location is the destination.
            from_relative_path: row.archive_path.unwrap_or_default(),
            from_root_id: row.from_root_id,
            to_relative_path: row.from_relative_path,
        })
        .collect();
    let item_count = u32::try_from(items.len()).unwrap_or(u32::MAX);

    let resp = protection::generate_plan(
        pool,
        &GeneratePlanRequest {
            plan_id: plan_id.clone(),
            title: resolved_title,
            origin: restore_origin.to_owned(),
            plan_type: restore_origin.to_owned(),
            origin_path: archived_plan.origin_path,
            destructive_destination: "archive".to_owned(),
            reason: "restore".to_owned(),
            total_bytes_required: 0,
            items,
        },
    )
    .await?;

    Ok(GenerateRestorePlanResult {
        plan_id: resp.plan_id,
        item_count,
        protected_item_count: u32::try_from(resp.protected_item_count).unwrap_or(u32::MAX),
    })
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use persistence_core::Database;
    use persistence_plans::repositories::artifacts::{insert_artifact_if_absent, InsertArtifact};
    use persistence_plans::repositories::plans as plans_repo;
    use persistence_plans::repositories::projects::{insert_project, InsertProject};

    async fn setup() -> Database {
        let db = Database::in_memory().await.expect("in-memory DB");
        db.migrate().await.expect("migrations");
        db
    }

    async fn seed_project(db: &Database, id: &str, lifecycle: &str) {
        insert_project(
            db.pool(),
            &InsertProject {
                id,
                name: &format!("Project {id}"),
                tool: "PixInsight",
                lifecycle,
                path: &format!("projects/{id}"),
                notes: None,
                canonical_target_id: None,
                is_mosaic: false,
            },
        )
        .await
        .unwrap();
    }

    async fn seed_artifact(
        db: &Database,
        id: &str,
        project_id: &str,
        path: &str,
        kind: &str,
        size: i64,
    ) {
        insert_artifact_if_absent(
            db.pool(),
            InsertArtifact {
                id,
                project_id,
                tool_launch_id: None,
                path,
                kind,
                tool: "PixInsight",
                detected_at: "2026-07-01T00:00:00Z",
                state: "present",
                classification_confidence: 0.9,
                classification_source: "rule",
                size_bytes: size,
                file_mtime: "2026-07-01T00:00:00Z",
                content_hash: None,
            },
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn generate_takes_every_present_artifact() {
        let db = setup().await;
        seed_project(&db, "p1", "completed").await;
        seed_artifact(&db, "a1", "p1", "calibrated/light_001.xisf", "intermediate", 1000).await;
        seed_artifact(&db, "a2", "p1", "masters/master_dark.xisf", "master", 2000).await;
        seed_artifact(&db, "a3", "p1", "final/M31.xisf", "final", 5000).await;

        let resp = generate(db.pool(), "p1", Some("Archive M31")).await.unwrap();
        // Whole-project scope: ALL artifacts become items (no policy filter).
        assert_eq!(resp.item_count, 3);

        // The plan is an archive plan carrying the project id in origin_path.
        let plan = plans_repo::get_plan(db.pool(), &resp.plan_id, false).await.unwrap();
        assert_eq!(plan.origin, "archive");
        assert_eq!(plan.plan_type, "archive");
        assert_eq!(plan.origin_path.as_deref(), Some("p1"));
        assert_eq!(plan.state, "ready_for_review");
        // FR-012 / D17: archive-action items occupy destination space.
        assert_eq!(plan.total_bytes_required, 8000);

        let items = plans_repo::list_plan_items(db.pool(), &resp.plan_id).await.unwrap();
        assert_eq!(items.len(), 3);
        assert!(items.iter().all(|i| i.action == "archive"));
    }

    /// Regression test (spec 037 Journey 6/7 bugfix): before
    /// `protection::generate_plan` computed a real `archive_path`, every
    /// `archive`-action item generated here had `to_relative_path` set equal
    /// to its own `from_relative_path` (see `generate`'s item-mapping
    /// closure), so applying the plan always failed every item with
    /// `conflict.destination_exists` (source == destination) — a bug with
    /// zero prior test coverage until this spec added real apply-path
    /// journeys. Assert the destination is now a distinct, non-empty path
    /// under the app-managed `.astro-plan-archive/<planId>/` convention.
    #[tokio::test]
    async fn generate_computes_distinct_archive_destination_per_item() {
        let db = setup().await;
        seed_project(&db, "p1", "completed").await;
        seed_artifact(&db, "a1", "p1", "/data/p1/calibrated/light_001.xisf", "intermediate", 1000)
            .await;

        let resp = generate(db.pool(), "p1", None).await.unwrap();
        let items = plans_repo::list_plan_items(db.pool(), &resp.plan_id).await.unwrap();
        assert_eq!(items.len(), 1);
        let item = &items[0];

        assert_eq!(item.from_relative_path, "/data/p1/calibrated/light_001.xisf");
        assert_ne!(
            item.to_relative_path, item.from_relative_path,
            "archive destination must differ from the source path, or every real apply \
             fails with conflict.destination_exists"
        );
        assert!(
            item.to_relative_path.contains(".astro-plan-archive/"),
            "expected the app-managed archive folder convention in: {}",
            item.to_relative_path
        );
        assert!(item.to_relative_path.contains(&resp.plan_id));
        assert!(item.to_relative_path.ends_with("light_001.xisf"));
        assert_eq!(item.archive_path.as_deref(), Some(item.to_relative_path.as_str()));
    }

    #[tokio::test]
    async fn generate_masters_and_finals_gate_approval() {
        // Default global protection is "protected", and master/final map to the
        // default protected categories → those items gate approval (constitution
        // II: archiving protected files requires acknowledgement).
        let db = setup().await;
        seed_project(&db, "p1", "completed").await;
        seed_artifact(&db, "a1", "p1", "masters/master_dark.xisf", "master", 2000).await;
        seed_artifact(&db, "a2", "p1", "final/M31.xisf", "final", 5000).await;

        let resp = generate(db.pool(), "p1", None).await.unwrap();
        assert_eq!(resp.item_count, 2);
        assert_eq!(resp.protected_item_count, 2);
    }

    #[tokio::test]
    async fn generate_empty_project_makes_empty_plan() {
        let db = setup().await;
        seed_project(&db, "p-empty", "completed").await;
        let resp = generate(db.pool(), "p-empty", None).await.unwrap();
        assert_eq!(resp.item_count, 0);
        let plan = plans_repo::get_plan(db.pool(), &resp.plan_id, false).await.unwrap();
        assert_eq!(plan.total_bytes_required, 0);
        // #603: a 0-item plan carries a diagnostic sentence the review UI can
        // render instead of a bare disabled "Approve & apply".
        assert_eq!(
            resp.empty_reason.as_deref(),
            Some("No files are linked to this project's sources — nothing to archive")
        );
    }

    #[tokio::test]
    async fn generate_non_empty_project_has_no_empty_reason() {
        let db = setup().await;
        seed_project(&db, "p1", "completed").await;
        seed_artifact(&db, "a1", "p1", "calibrated/light_001.xisf", "intermediate", 1000).await;
        let resp = generate(db.pool(), "p1", None).await.unwrap();
        assert_eq!(
            resp.empty_reason, None,
            "empty_reason must never be a filler string standing in for a non-empty plan"
        );
    }

    #[tokio::test]
    async fn generate_creates_no_filesystem_mutation_and_stays_reviewable() {
        // Generating never applies: the plan is left in ready_for_review, and no
        // apply run exists (FR-001/FR-002).
        let db = setup().await;
        seed_project(&db, "p1", "completed").await;
        seed_artifact(&db, "a1", "p1", "calibrated/light_001.xisf", "intermediate", 1000).await;
        let resp = generate(db.pool(), "p1", None).await.unwrap();
        let plan = plans_repo::get_plan(db.pool(), &resp.plan_id, false).await.unwrap();
        assert_eq!(plan.state, "ready_for_review");
    }

    #[tokio::test]
    async fn list_archived_returns_only_archived_projects() {
        let db = setup().await;
        seed_project(&db, "p-active", "completed").await;
        seed_project(&db, "p-arch", "archived").await;
        projects_repo::set_archived_via_plan_id(db.pool(), "p-arch", "plan-xyz").await.unwrap();

        let resp = list_archived(db.pool()).await.unwrap();
        assert_eq!(resp.entries.len(), 1);
        let entry = &resp.entries[0];
        assert_eq!(entry.id, "p-arch");
        assert_eq!(entry.entity_type, "project");
        assert_eq!(entry.archived_via_plan_id.as_deref(), Some("plan-xyz"));
        assert_eq!(entry.original_path, "projects/p-arch");
        // T134 (Q16 / FR-136): "plan-xyz" was never inserted into `plans`, so
        // the LEFT JOIN leaves plan_title/total_bytes_required NULL — reason
        // and size_bytes must round-trip as None, never an empty-string /
        // zero sentinel standing in for the deleted plan's data.
        assert_eq!(entry.reason, None, "must never default to an empty-string sentinel");
        assert_eq!(entry.size_bytes, None, "must never default to a 0 sentinel");
    }

    #[tokio::test]
    async fn list_archived_empty_when_none_archived() {
        let db = setup().await;
        seed_project(&db, "p1", "completed").await;
        let resp = list_archived(db.pool()).await.unwrap();
        assert!(resp.entries.is_empty());
    }

    /// #874: `archive.list` resolves the Reveal folder from the owning plan's
    /// first archived item, once one actually exists.
    #[tokio::test]
    async fn list_archived_resolves_archive_folder_path_from_owning_plan() {
        let db = setup().await;
        seed_project(&db, "p1", "archived").await;
        seed_artifact(&db, "a1", "p1", "calibrated/light_001.xisf", "intermediate", 1000).await;
        let gen_resp = generate(db.pool(), "p1", None).await.unwrap();
        projects_repo::set_archived_via_plan_id(db.pool(), "p1", &gen_resp.plan_id).await.unwrap();

        let resp = list_archived(db.pool()).await.unwrap();
        assert_eq!(resp.entries.len(), 1);
        let folder = resp.entries[0]
            .archive_folder_path
            .as_deref()
            .expect("archive_folder_path must resolve once the plan has an archived item");
        assert!(folder.contains(".astro-plan-archive/"));
        assert!(folder.contains(&gen_resp.plan_id));
        assert!(
            !folder.contains("light_001.xisf"),
            "must be the containing folder, not the item's own file path: {folder}"
        );
    }

    #[tokio::test]
    async fn list_archived_folder_path_none_when_owning_plan_has_no_items() {
        let db = setup().await;
        seed_project(&db, "p-empty", "archived").await;
        let gen_resp = generate(db.pool(), "p-empty", None).await.unwrap();
        projects_repo::set_archived_via_plan_id(db.pool(), "p-empty", &gen_resp.plan_id)
            .await
            .unwrap();

        let resp = list_archived(db.pool()).await.unwrap();
        assert_eq!(resp.entries[0].archive_folder_path, None);
    }

    /// #885: `generate_restore` mirrors an applied archive plan's items back
    /// to their original recorded locations, as a reviewable, un-applied
    /// `ready_for_review` restore plan.
    #[tokio::test]
    async fn generate_restore_reverses_an_applied_archive_plan() {
        let db = setup().await;
        seed_project(&db, "p1", "archived").await;
        seed_artifact(&db, "a1", "p1", "calibrated/light_001.xisf", "intermediate", 1000).await;
        let archive_resp = generate(db.pool(), "p1", None).await.unwrap();
        plans_repo::update_plan_state(db.pool(), &archive_resp.plan_id, "applied").await.unwrap();

        let restore_resp = generate_restore(db.pool(), &archive_resp.plan_id, None).await.unwrap();
        assert_eq!(restore_resp.item_count, 1);

        let plan = plans_repo::get_plan(db.pool(), &restore_resp.plan_id, false).await.unwrap();
        assert_eq!(plan.origin, "restore");
        assert_eq!(plan.plan_type, "restore");
        assert_eq!(plan.state, "ready_for_review");
        // Carries the project id forward so a successful apply can drive
        // finalize_restore_lifecycle (R-Unarchive).
        assert_eq!(plan.origin_path.as_deref(), Some("p1"));

        let restore_items =
            plans_repo::list_plan_items(db.pool(), &restore_resp.plan_id).await.unwrap();
        assert_eq!(restore_items.len(), 1);
        let archive_items =
            plans_repo::list_plan_items(db.pool(), &archive_resp.plan_id).await.unwrap();
        // Reversed: the restore item's source is the archived item's
        // destination, and its destination is the archived item's original source.
        assert_eq!(restore_items[0].from_relative_path, archive_items[0].to_relative_path);
        assert_eq!(restore_items[0].to_relative_path, archive_items[0].from_relative_path);
    }

    #[tokio::test]
    async fn generate_restore_refuses_a_non_applied_archive_plan() {
        let db = setup().await;
        seed_project(&db, "p1", "completed").await;
        seed_artifact(&db, "a1", "p1", "calibrated/light_001.xisf", "intermediate", 1000).await;
        // ready_for_review, not applied — generate() never applies (FR-002).
        let archive_resp = generate(db.pool(), "p1", None).await.unwrap();

        let err = generate_restore(db.pool(), &archive_resp.plan_id, None).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::PlanInvalidState);
    }

    #[tokio::test]
    async fn generate_restore_refuses_a_non_archive_plan() {
        let db = setup().await;
        seed_project(&db, "p1", "completed").await;
        let err = generate_restore(db.pool(), "nonexistent-plan", None).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::PlanNotFound);
    }

    #[tokio::test]
    async fn generate_restore_refuses_when_archived_plan_had_no_items() {
        let db = setup().await;
        seed_project(&db, "p-empty", "archived").await;
        let archive_resp = generate(db.pool(), "p-empty", None).await.unwrap();
        plans_repo::update_plan_state(db.pool(), &archive_resp.plan_id, "applied").await.unwrap();

        let err = generate_restore(db.pool(), &archive_resp.plan_id, None).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::ArchiveEmpty);
    }
}
