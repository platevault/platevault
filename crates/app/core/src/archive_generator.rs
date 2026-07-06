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

use contracts_core::archive::{ArchiveEntry, ArchiveListResponse, GenerateArchivePlanResult};
use contracts_core::ContractError;
use persistence_db::repositories::artifacts as artifacts_repo;
use persistence_db::repositories::projects as projects_repo;
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
    })
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

    let entries = rows
        .into_iter()
        .map(|r| ArchiveEntry {
            id: r.id,
            name: r.name,
            entity_type: "project".to_owned(),
            archived_at: r.archived_at,
            reason: r.plan_title.unwrap_or_default(),
            original_path: r.path,
            size_bytes: r.archived_bytes.unwrap_or(0),
            archived_via_plan_id: r.archived_via_plan_id,
        })
        .collect();

    Ok(ArchiveListResponse { entries })
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use persistence_db::repositories::artifacts::{insert_artifact, InsertArtifact};
    use persistence_db::repositories::plans as plans_repo;
    use persistence_db::repositories::projects::{insert_project, InsertProject};
    use persistence_db::Database;

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
        insert_artifact(
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
    }

    #[tokio::test]
    async fn list_archived_empty_when_none_archived() {
        let db = setup().await;
        seed_project(&db, "p1", "completed").await;
        let resp = list_archived(db.pool()).await.unwrap();
        assert!(resp.entries.is_empty());
    }
}
