//! Project health use case — spec 009 US4 + P7 + P8.
//!
//! Responsibilities:
//! - `check_project_ready_invariant`: fires `setup_incomplete → ready`
//!   auto-transition (P8, R-Ready-Trigger) when `≥1 source` is confirmed.
//! - `emit_block_transition`: emits `* → blocked` when a detectable condition
//!   is found (US4, P7 debounce).
//!
//! ## Storage note
//! The spec 008 `projects` table uses a `lifecycle` column (not `state`).
//! The spec 002 `LifecycleRepository::record_transition` targets the older
//! `project` table which has a `state` column. These are DIFFERENT tables.
//! This module writes to the `projects` table via `repo::update_project_lifecycle`
//! and publishes events on the bus, keeping the lifecycle consistent without
//! hitting the legacy lifecycle repository.
//!
//! ## Actor=system authorization (A4)
//! The `setup_incomplete → ready` edge is explicitly listed as a permitted
//! system-actor invariant transition in spec 009 data-model.md §A4.
//!
//! ## Debounce (P7)
//! The detector MUST suppress re-emission of a block signal for the same
//! `(entity_id, condition_kind)` pair within a 60-second window. The lifecycle
//! use case itself has no debounce; all suppression lives here.
//!
//! ## Deferred detection reasons
//! - `calibration_unmatched`: requires spec 007 calibration matching tables.
//! - `prepared_source_stale`: requires spec 012 / prepared_source_view table.
//! - Both are deferred and documented in tasks.md.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use audit::bus::EventBus;
use audit::event_bus::{LifecycleTransitionApplied, Source, TOPIC_LIFECYCLE_TRANSITION_APPLIED};
use persistence_db::repositories::projects as repo;
use sqlx::SqlitePool;

// ── Constants ─────────────────────────────────────────────────────────────────

/// Default debounce window per (entity_id, condition) pair (P7, D5).
/// Configurable via this in-process constant (no user-facing setting).
#[allow(clippy::duration_suboptimal_units)]
pub const DEBOUNCE_WINDOW: Duration = Duration::from_secs(60);

// ── Blocking reason (mirrors data-model.md §BlockedReason) ───────────────────

/// Structured blocking reason for a system-detected block.
#[derive(Clone, Debug, Eq, PartialEq, Hash)]
pub enum BlockCondition {
    SourceMissing { inventory_id: String },
    ToolUnconfigured { tool: String },
    User { note: String },
}

impl BlockCondition {
    #[must_use]
    pub fn kind_str(&self) -> &'static str {
        match self {
            Self::SourceMissing { .. } => "source_missing",
            Self::ToolUnconfigured { .. } => "tool_unconfigured",
            Self::User { .. } => "user",
        }
    }

    /// Human-readable message for audit records and the event bus.
    #[must_use]
    pub fn message(&self) -> String {
        match self {
            Self::SourceMissing { inventory_id } => format!("Source missing: {inventory_id}"),
            Self::ToolUnconfigured { tool } => format!("Tool path not configured: {tool}"),
            Self::User { note } => note.clone(),
        }
    }
}

// ── Debounce table ────────────────────────────────────────────────────────────

/// Key for the debounce table: entity + condition kind.
#[derive(Clone, Debug, Eq, PartialEq, Hash)]
struct DebounceKey {
    entity_id: String,
    condition_kind: &'static str,
}

/// In-process debounce table (P7, D5): maps `(entity_id, condition_kind)` → last emission time.
#[derive(Clone, Debug, Default)]
pub struct DebounceTable {
    last_emitted: HashMap<DebounceKey, Instant>,
    window: Duration,
}

impl DebounceTable {
    #[must_use]
    pub fn new(window: Duration) -> Self {
        Self { last_emitted: HashMap::new(), window }
    }

    /// Returns `true` if the signal should be suppressed (still within the debounce window).
    pub fn should_suppress(&mut self, entity_id: &str, condition_kind: &'static str) -> bool {
        let key = DebounceKey { entity_id: entity_id.to_owned(), condition_kind };
        let now = Instant::now();
        if let Some(&last) = self.last_emitted.get(&key) {
            if now.duration_since(last) < self.window {
                return true;
            }
        }
        self.last_emitted.insert(key, now);
        false
    }

    /// Force-expire an entry (used by tests to simulate elapsed time without sleeping).
    #[cfg(test)]
    pub fn expire(&mut self, entity_id: &str, condition_kind: &'static str) {
        let key = DebounceKey { entity_id: entity_id.to_owned(), condition_kind };
        self.last_emitted.remove(&key);
    }
}

// ── Error ─────────────────────────────────────────────────────────────────────

/// Error from the health use cases.
#[derive(Debug, thiserror::Error)]
pub enum HealthError {
    #[error("persistence error: {0}")]
    Persistence(#[from] persistence_db::DbError),
    #[error("project not found: {0}")]
    NotFound(String),
}

// ── P8: setup_incomplete → ready invariant check ──────────────────────────────

/// Check the `setup_incomplete → ready` invariant (P8, R-Ready-Trigger).
///
/// Condition: `lifecycle == "setup_incomplete"` AND `≥1 source mapped`.
///
/// Writes to the `projects` table via `repo::update_project_lifecycle`, then
/// publishes `project.lifecycle.ready` on the event bus (P8-3).
///
/// Returns `Some("ready")` when the transition fires, `None` when the condition
/// is not met or the project is already past `setup_incomplete`.
///
/// # Errors
/// Returns `HealthError` on database failure.
pub async fn check_project_ready_invariant(
    pool: &SqlitePool,
    bus: &EventBus,
    project_id: &str,
) -> Result<Option<String>, HealthError> {
    let row = repo::get_project(pool, project_id)
        .await
        .map_err(|e| HealthError::NotFound(format!("project {project_id}: {e}")))?;

    if row.lifecycle != "setup_incomplete" {
        return Ok(None);
    }

    let sources =
        repo::list_project_sources(pool, project_id).await.map_err(HealthError::Persistence)?;
    if sources.is_empty() {
        return Ok(None);
    }

    repo::update_project_lifecycle(pool, project_id, "ready")
        .await
        .map_err(HealthError::Persistence)?;

    // Publish project.lifecycle.ready event (P8-3).
    let now = domain_core::ids::Timestamp::now_utc();
    let _ = bus
        .publish(
            "project.lifecycle.ready",
            Source::System,
            LifecycleTransitionApplied {
                entity_type: domain_core::lifecycle::data_asset::EntityType::Project,
                entity_id: project_id.to_owned(),
                from_state: "setup_incomplete".to_owned(),
                to_state: "ready".to_owned(),
                actor: "system".to_owned(),
                at: now,
            },
        )
        .await;

    Ok(Some("ready".to_owned()))
}

// ── US4: auto-blocked detection ───────────────────────────────────────────────

/// Lightweight record returned when a block transition was applied.
#[derive(Clone, Debug)]
pub struct BlockTransitionRecord {
    pub project_id: String,
    pub from_state: String,
    pub condition: BlockCondition,
}

/// Emit a system-driven `* → blocked` transition for the given project.
///
/// - Performs debounce (P7): if the same `(project_id, condition_kind)` was
///   emitted within `DEBOUNCE_WINDOW`, the transition is suppressed.
/// - Writes the new `blocked` lifecycle to the `projects` table.
/// - Publishes `TOPIC_LIFECYCLE_TRANSITION_APPLIED` and
///   `project.lifecycle.blocked` on the event bus.
///
/// Returns `Some(record)` when applied, `None` when debounced or already blocked.
///
/// # Panics
/// Panics if the debounce table mutex is poisoned (only possible if another
/// thread panicked while holding the lock — should not happen in practice).
///
/// # Errors
/// Returns `HealthError` on database failure.
pub async fn emit_block_transition(
    pool: &SqlitePool,
    bus: &EventBus,
    debounce: &Arc<Mutex<DebounceTable>>,
    project_id: &str,
    condition: &BlockCondition,
) -> Result<Option<BlockTransitionRecord>, HealthError> {
    let condition_kind = condition.kind_str();

    // Debounce check (P7).
    {
        let mut table = debounce.lock().expect("debounce lock poisoned");
        if table.should_suppress(project_id, condition_kind) {
            return Ok(None);
        }
    }

    let row = repo::get_project(pool, project_id)
        .await
        .map_err(|e| HealthError::NotFound(format!("project {project_id}: {e}")))?;

    // Already blocked → nothing to do.
    if row.lifecycle == "blocked" {
        return Ok(None);
    }

    let from_state = row.lifecycle.clone();
    let message = condition.message();

    repo::update_project_lifecycle(pool, project_id, "blocked")
        .await
        .map_err(HealthError::Persistence)?;

    let now = domain_core::ids::Timestamp::now_utc();

    let _ = bus
        .publish(
            TOPIC_LIFECYCLE_TRANSITION_APPLIED,
            Source::System,
            LifecycleTransitionApplied {
                entity_type: domain_core::lifecycle::data_asset::EntityType::Project,
                entity_id: project_id.to_owned(),
                from_state: from_state.clone(),
                to_state: "blocked".to_owned(),
                actor: "system".to_owned(),
                at: now,
            },
        )
        .await;

    let _ = bus
        .publish(
            "project.lifecycle.blocked",
            Source::System,
            serde_json::json!({
                "projectId": project_id,
                "fromState": from_state,
                "conditionKind": condition_kind,
                "message": message,
            }),
        )
        .await;

    Ok(Some(BlockTransitionRecord {
        project_id: project_id.to_owned(),
        from_state,
        condition: condition.clone(),
    }))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use audit::bus::EventBus;
    use contracts_core::projects_v2::{ProjectCreateRequest, ProjectSourceAddRequest};
    use persistence_db::Database;
    use sqlx::SqlitePool;
    use uuid::Uuid;

    use super::*;
    use crate::project_setup;

    async fn setup() -> (SqlitePool, EventBus) {
        let db = Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        let bus = EventBus::with_pool(db.pool().clone());
        (db.pool().clone(), bus)
    }

    fn new_id() -> String {
        Uuid::new_v4().to_string()
    }

    fn make_create_req(name: &str) -> ProjectCreateRequest {
        use contracts_core::projects_v2::ProjectTool;
        ProjectCreateRequest {
            request_id: new_id(),
            name: name.to_owned(),
            tool: ProjectTool::PixInsight,
            path: format!("projects/{name}"),
            initial_sources: vec![],
            notes: None,
        }
    }

    // P8-4: no sources → invariant not met → no transition
    #[tokio::test]
    async fn ready_invariant_no_sources_no_op() {
        let (pool, bus) = setup().await;
        let created =
            project_setup::create(&pool, &bus, &make_create_req("M1 No Sources")).await.unwrap();
        assert_eq!(created.lifecycle, "setup_incomplete");

        let result = check_project_ready_invariant(&pool, &bus, &created.project_id).await.unwrap();
        assert_eq!(result, None, "no sources → invariant not met → no transition");
    }

    // P8-4: with confirmed source → auto-transition fires
    #[tokio::test]
    async fn ready_invariant_with_source_transitions() {
        let (pool, bus) = setup().await;
        let created =
            project_setup::create(&pool, &bus, &make_create_req("NGC 7000 Auto")).await.unwrap();
        assert_eq!(created.lifecycle, "setup_incomplete");

        // Add a source (project_setup.add_source also calls maybe_auto_ready;
        // reset lifecycle afterward to isolate the invariant check).
        project_setup::add_source(
            &pool,
            &bus,
            &ProjectSourceAddRequest {
                request_id: new_id(),
                project_id: created.project_id.clone(),
                inventory_session_id: "inv-auto-001".to_owned(),
            },
        )
        .await
        .unwrap();
        persistence_db::repositories::projects::update_project_lifecycle(
            &pool,
            &created.project_id,
            "setup_incomplete",
        )
        .await
        .unwrap();

        let result = check_project_ready_invariant(&pool, &bus, &created.project_id).await.unwrap();
        assert_eq!(result, Some("ready".to_owned()), "source present → transition fires");
    }

    // P8-4: invariant is a no-op when project is already ready
    #[tokio::test]
    async fn ready_invariant_already_ready_no_op() {
        let (pool, bus) = setup().await;
        let created =
            project_setup::create(&pool, &bus, &make_create_req("Already Ready")).await.unwrap();

        persistence_db::repositories::projects::update_project_lifecycle(
            &pool,
            &created.project_id,
            "ready",
        )
        .await
        .unwrap();

        let result = check_project_ready_invariant(&pool, &bus, &created.project_id).await.unwrap();
        assert_eq!(result, None, "already ready → no-op");
    }

    // P7-2: debounce suppresses duplicate block signals within window
    #[tokio::test]
    async fn debounce_suppresses_duplicate_block() {
        let (pool, bus) = setup().await;
        let debounce = Arc::new(Mutex::new(DebounceTable::new(DEBOUNCE_WINDOW)));
        let created =
            project_setup::create(&pool, &bus, &make_create_req("M31 Block Test")).await.unwrap();
        let condition = BlockCondition::SourceMissing { inventory_id: "inv-missing".to_owned() };

        let first = emit_block_transition(&pool, &bus, &debounce, &created.project_id, &condition)
            .await
            .unwrap();
        assert!(first.is_some(), "first block signal should be applied");

        // Reset lifecycle so a real write would succeed if debounce weren't active.
        persistence_db::repositories::projects::update_project_lifecycle(
            &pool,
            &created.project_id,
            "setup_incomplete",
        )
        .await
        .unwrap();

        let second = emit_block_transition(&pool, &bus, &debounce, &created.project_id, &condition)
            .await
            .unwrap();
        assert!(second.is_none(), "second signal within window → debounce suppressed");
    }

    // P7-2: after window expires, a second signal is emitted
    #[tokio::test]
    async fn debounce_allows_after_window_expires() {
        let (pool, bus) = setup().await;
        let debounce = Arc::new(Mutex::new(DebounceTable::new(DEBOUNCE_WINDOW)));
        let created =
            project_setup::create(&pool, &bus, &make_create_req("M82 Expiry")).await.unwrap();
        let condition = BlockCondition::SourceMissing { inventory_id: "inv-gone".to_owned() };

        emit_block_transition(&pool, &bus, &debounce, &created.project_id, &condition)
            .await
            .unwrap();

        // Expire the debounce entry manually (avoids a 60s sleep).
        {
            let mut table = debounce.lock().unwrap();
            table.expire(&created.project_id, "source_missing");
        }

        // Reset lifecycle so the transition can succeed again.
        persistence_db::repositories::projects::update_project_lifecycle(
            &pool,
            &created.project_id,
            "setup_incomplete",
        )
        .await
        .unwrap();

        let second = emit_block_transition(&pool, &bus, &debounce, &created.project_id, &condition)
            .await
            .unwrap();
        assert!(second.is_some(), "after window expiry → second signal applied");
    }

    // P7-3: integration — two rapid source_missing signals produce only one blocked state
    #[tokio::test]
    async fn rapid_source_missing_produces_one_transition() {
        let (pool, bus) = setup().await;
        let debounce = Arc::new(Mutex::new(DebounceTable::new(DEBOUNCE_WINDOW)));
        let created =
            project_setup::create(&pool, &bus, &make_create_req("IC 1805 Rapid")).await.unwrap();
        let condition = BlockCondition::SourceMissing { inventory_id: "inv-rapid".to_owned() };

        // First signal — applied.
        let first = emit_block_transition(&pool, &bus, &debounce, &created.project_id, &condition)
            .await
            .unwrap();
        assert!(first.is_some());

        let row = persistence_db::repositories::projects::get_project(&pool, &created.project_id)
            .await
            .unwrap();
        assert_eq!(row.lifecycle, "blocked", "project should be blocked after first signal");

        // Second signal immediately — suppressed by debounce.
        let second = emit_block_transition(&pool, &bus, &debounce, &created.project_id, &condition)
            .await
            .unwrap();
        assert!(second.is_none(), "second rapid signal must be debounced");

        // Verify: lifecycle unchanged (still blocked, no second write occurred).
        let row2 = persistence_db::repositories::projects::get_project(&pool, &created.project_id)
            .await
            .unwrap();
        assert_eq!(row2.lifecycle, "blocked", "lifecycle unchanged — no double-write");
    }
}
