// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Project-create orchestration: create + mkdir-only scaffolding auto-apply.
//!
//! Lives in `app_core` (not `app_core_projects`) because it orchestrates
//! `project_setup::create` together with the `plans` + `plan_apply` modules,
//! which are `app_core` modules — the same layering rationale as
//! [`crate::inbox_plan`].
//!
//! Constitution II nuance (user decision 2026-07-04, supersedes D16 in
//! `docs/development/orchestrator-handover-2026-07-03.md`): the
//! folder-scaffolding plan record and its per-action audit rows are STILL
//! written, so reviewability-as-record is preserved. Only the approval click
//! is skipped, and only when every action in the plan is directory creation
//! (see [`crate::plans::plan_qualifies_for_mkdir_auto_apply`]). Any plan that
//! touches a user file keeps the normal explicit review flow, unchanged.

use audit::bus::EventBus;
use contracts_core::projects_v2::{ProjectCreateRequest, ProjectCreateResult};
use contracts_core::ContractError;
use persistence_plans::repositories::plans as plans_repo;
use sqlx::SqlitePool;

use crate::projects::project_setup;

/// Bounded wait for the (tiny) scaffolding apply run: 120 × 25 ms ≈ 3 s.
const TERMINAL_POLL_ATTEMPTS: u32 = 120;
const TERMINAL_POLL_INTERVAL_MS: u64 = 25;

/// Create a project and auto-apply its folder-scaffolding plan when the plan
/// is mkdir-only (user decision 2026-07-04).
///
/// Behaviour:
/// - `project_setup::create` persists the project AND the reviewable
///   scaffolding plan + audit rows, exactly as before.
/// - When the plan qualifies (every action is `mkdir`, plus the app-owned
///   `write_manifest` marker record), the same approve + apply use-cases as a
///   manual click are invoked; `scaffold_applied` in the result reports
///   whether the run reached the `applied` terminal state.
/// - A failed or non-starting auto-apply NEVER fails project creation: the
///   result carries `scaffold_applied = Some(false)` and the plan remains
///   reviewable through the normal plan surfaces, exactly like a failed
///   manual apply.
/// - A plan with any user-file action is left in `ready_for_review`
///   (`scaffold_applied = None`) — normal review flow.
///
/// # Errors
///
/// Returns `ContractError` only for the create itself (validation or DB
/// failure); auto-apply problems are reported via `scaffold_applied`.
pub async fn create(
    pool: &SqlitePool,
    bus: &EventBus,
    redb_cache: &dyn simbad_resolver::Cache,
    req: &ProjectCreateRequest,
) -> Result<ProjectCreateResult, ContractError> {
    let mut result = project_setup::create(pool, bus, redb_cache, req).await?;

    let Some(plan_id) = result.plan_id.clone() else {
        return Ok(result);
    };

    match crate::plans::auto_apply_mkdir_only_plan(pool, bus, &plan_id).await {
        Ok(Some(_run)) => {
            // The executor runs on a background task; the scaffolding plan is
            // a handful of mkdirs, so a short bounded poll gives the caller an
            // honest "folders created" signal instead of "apply started".
            result.scaffold_applied = Some(wait_for_applied(pool, &plan_id).await);
        }
        Ok(None) => {
            // Plan contains a user-file action → normal review flow.
        }
        Err(e) => {
            tracing::warn!(
                %plan_id,
                error = ?e,
                "scaffolding auto-apply could not start; plan remains reviewable"
            );
            result.scaffold_applied = Some(false);
        }
    }

    Ok(result)
}

/// Poll the plan row until it reaches a terminal state or the bounded wait
/// elapses. Returns `true` only for a clean `applied` terminal.
async fn wait_for_applied(pool: &SqlitePool, plan_id: &str) -> bool {
    for _ in 0..TERMINAL_POLL_ATTEMPTS {
        match plans_repo::get_plan(pool, plan_id, false).await {
            Ok(row) => match row.state.as_str() {
                "applied" => return true,
                "partially_applied" | "failed" | "cancelled" | "paused" | "stale" => return false,
                _ => {}
            },
            Err(e) => {
                tracing::warn!(%plan_id, error = %e, "scaffolding apply status poll failed");
                return false;
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(TERMINAL_POLL_INTERVAL_MS)).await;
    }
    tracing::warn!(%plan_id, "scaffolding apply did not reach a terminal state in time");
    false
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use contracts_core::projects_v2::ProjectTool;
    use domain_core::ids::new_id;
    use persistence_core::Database;

    async fn setup() -> (Database, EventBus) {
        let db = Database::in_memory().await.expect("in-memory DB");
        db.migrate().await.expect("migrations");
        let bus = EventBus::with_pool(db.pool().clone());
        (db, bus)
    }

    fn make_req(name: &str, path: &str) -> ProjectCreateRequest {
        ProjectCreateRequest {
            request_id: new_id(),
            name: name.to_owned(),
            tool: ProjectTool::PixInsight,
            path: path.to_owned(),
            initial_sources: vec![],
            notes: None,
            canonical_target_id: None,
            is_mosaic: false,
        }
    }

    /// These tests create projects with no `canonical_target_id`, so
    /// `create`'s promotion never touches the cache.
    fn empty_cache() -> simbad_resolver::RedbCache {
        simbad_resolver::Store::in_memory().unwrap().cache()
    }

    /// Happy path: the scaffolding plan auto-applies and the tool folders
    /// exist on disk; the plan row records the applied terminal state.
    #[tokio::test]
    async fn create_auto_applies_scaffolding_and_creates_folders() {
        let (db, bus) = setup().await;
        let root = tempfile::tempdir().unwrap();
        let project_path = format!("{}/m31", root.path().to_str().unwrap());

        let result = create(db.pool(), &bus, &empty_cache(), &make_req("M31 LRGB", &project_path))
            .await
            .unwrap();

        assert_eq!(result.scaffold_applied, Some(true), "mkdir-only plan must auto-apply");

        // Folders really exist (PixInsight layout includes lights/ + darks/).
        assert!(std::path::Path::new(&format!("{project_path}/lights")).is_dir());
        assert!(std::path::Path::new(&format!("{project_path}/darks")).is_dir());

        // The reviewable plan record is still written (constitution II) and
        // shows the applied terminal state.
        let plan_id = result.plan_id.expect("plan_id present");
        let plan = plans_repo::get_plan(db.pool(), &plan_id, false).await.unwrap();
        assert_eq!(plan.state, "applied");
    }

    /// astro-plan-l3y0: the `write_manifest` plan item previously fell
    /// through to `ExecutorItemAction::NoOp` (`plan_apply/paths.rs`), so
    /// auto-apply reported the whole plan "applied" while the app-owned
    /// project marker file was never written to disk. Proves the marker is a
    /// real file with the correct project id — not just that the executor
    /// was invoked — and that its own durable `audit_log_entry` row exists
    /// (constitution §II: an audit record per attempted action and outcome).
    #[tokio::test]
    async fn create_auto_apply_writes_project_marker_to_disk_with_audit() {
        let (db, bus) = setup().await;
        let root = tempfile::tempdir().unwrap();
        let project_path = format!("{}/ngc7000", root.path().to_str().unwrap());

        let result = create(db.pool(), &bus, &empty_cache(), &make_req("NGC 7000", &project_path))
            .await
            .unwrap();

        assert_eq!(result.scaffold_applied, Some(true), "mkdir + marker plan must auto-apply");

        let marker_path = format!("{project_path}/.astro-plan-project.json");
        let marker_content = std::fs::read_to_string(&marker_path).unwrap_or_else(|e| {
            panic!("project marker file must exist on disk at {marker_path}: {e}")
        });
        let parsed = project_structure::parse_marker(&marker_content)
            .expect("marker file must be valid, versioned marker JSON");
        assert_eq!(parsed.project_id, result.project_id, "marker must record the project's own id");

        // The per-item audit trail (constitution §II) must cover the marker
        // write specifically, not just the sibling mkdir items.
        let plan_id = result.plan_id.expect("plan_id present");
        let items = plans_repo::list_plan_items(db.pool(), &plan_id).await.unwrap();
        let marker_item = items
            .iter()
            .find(|i| i.action == "write_manifest")
            .expect("plan must contain the write_manifest item");

        let (payload,): (String,) = sqlx::query_as(
            "SELECT payload FROM audit_log_entry \
             WHERE payload LIKE '%' || ? || '%' AND to_state = 'succeeded' LIMIT 1",
        )
        .bind(&marker_item.id)
        .fetch_one(db.pool())
        .await
        .expect("a durable audit_log_entry row must record the write_manifest item's outcome");
        assert!(payload.contains(&marker_item.id));
    }

    /// Failure path: a file blocking a scaffolding folder makes the apply
    /// fail; create still succeeds, `scaffold_applied` is `Some(false)`, and
    /// the plan lands in the reviewable `failed` state.
    #[tokio::test]
    async fn create_reports_false_when_scaffolding_apply_fails() {
        let (db, bus) = setup().await;
        let root = tempfile::tempdir().unwrap();
        let project_path = format!("{}/blocked", root.path().to_str().unwrap());
        std::fs::create_dir_all(&project_path).unwrap();
        // A FILE where the `lights` folder must go → conflict.destination_exists.
        std::fs::write(format!("{project_path}/lights"), b"in the way").unwrap();

        let result =
            create(db.pool(), &bus, &empty_cache(), &make_req("Blocked Project", &project_path))
                .await
                .unwrap();

        assert_eq!(
            result.scaffold_applied,
            Some(false),
            "failed auto-apply must be reported, not swallowed"
        );

        let plan_id = result.plan_id.expect("plan_id present");
        let plan = plans_repo::get_plan(db.pool(), &plan_id, false).await.unwrap();
        assert!(
            matches!(plan.state.as_str(), "failed" | "partially_applied"),
            "plan must land in a reviewable terminal failure state, got {}",
            plan.state
        );
        // The blocking file was not overwritten (constitution II).
        assert_eq!(std::fs::read(format!("{project_path}/lights")).unwrap(), b"in the way");
    }
}
