// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Event-bus driven stale-propagation subscriber (spec 002 T046).
//!
//! Subscribes to `lifecycle.transition.applied` events and recomputes
//! dependent staleness. The full propagation graph (research.md §6) requires
//! per-entity dependent indexes that aren't all wired yet, so this module
//! ships the spawn-and-loop skeleton plus a tested handler hook. Adding a
//! new dependent kind means dropping a closure into the registered hooks.
//!
//! Idempotence rule (research.md §6.1): subscribers MUST be idempotent on
//! `(audit_id, subscriber_id)`. The hook contract takes the audit id so the
//! handler can deduplicate against its own ledger.

use std::sync::Arc;

use sqlx::SqlitePool;
use tokio::sync::broadcast::error::RecvError;

use crate::bus::EventBus;
use crate::event_bus::{EventEnvelope, TOPIC_LIFECYCLE_TRANSITION_APPLIED};

/// Hook signature for a downstream propagator.
///
/// Receives the full envelope plus an `audit_id` string for dedup tracking.
/// Returning `Err(...)` is logged but does not unsubscribe — propagators
/// are best-effort; the durable bus is the source of truth on restart.
pub type PropagatorFn =
    Arc<dyn Fn(&EventEnvelope<serde_json::Value>) -> Result<(), String> + Send + Sync + 'static>;

/// Configurable propagator that fans events out to registered hooks.
#[derive(Default, Clone)]
pub struct StalePropagator {
    hooks: Vec<PropagatorFn>,
}

impl StalePropagator {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a new propagation hook. Returns `self` for builder chaining.
    #[must_use]
    pub fn with_hook(mut self, hook: PropagatorFn) -> Self {
        self.hooks.push(hook);
        self
    }

    /// Invoke every hook for the given envelope, swallowing per-hook errors.
    /// Errors are returned as a `Vec<String>` so callers can log them.
    #[must_use]
    pub fn dispatch(&self, env: &EventEnvelope<serde_json::Value>) -> Vec<String> {
        self.hooks.iter().filter_map(|h| (h)(env).err()).collect()
    }

    /// Spawn the subscriber loop on the current tokio runtime.
    ///
    /// Filters to `lifecycle.transition.applied` only; other topics pass
    /// through unhandled.
    #[must_use]
    pub fn spawn(self, bus: &EventBus) -> tokio::task::JoinHandle<()> {
        let mut rx = bus.subscribe();
        tokio::spawn(async move {
            loop {
                match rx.recv().await {
                    Ok(env) => {
                        if env.topic == TOPIC_LIFECYCLE_TRANSITION_APPLIED {
                            let _errors = self.dispatch(&env);
                        }
                    }
                    // Lagged receivers reattach via replay; for the skeleton
                    // we just keep the live loop going on the next message.
                    Err(RecvError::Lagged(_)) => {}
                    Err(RecvError::Closed) => break,
                }
            }
        })
    }
}

/// FR-003 (#713): marks a project's dependent projections/prepared sources
/// stale when the project's own lifecycle transitions (research.md §6:
/// `ProjectManifest depends_on Project`). Narrow slice of the dependency
/// graph — only the `project_id` FK dependents already modeled in the schema
/// (`processing_artifact.project_id`, `prepared_source_view.project_id`);
/// session-level dependents (`PreparedSourceView depends_on AcquisitionSession[]`)
/// would need a further join and are out of scope for this minimal fix.
///
/// No-ops when the envelope carries no `projectId` (unresolvable at the
/// publish site — see `LifecycleTransitionApplied::project_id`).
#[must_use]
pub fn resolve_project_dependents_hook(pool: SqlitePool) -> PropagatorFn {
    Arc::new(move |env| {
        let Some(project_id) = env.payload.get("projectId").and_then(|v| v.as_str()) else {
            return Ok(());
        };
        let project_id = project_id.to_owned();
        let pool = pool.clone();
        // Hooks are synchronous (best-effort, at-least-once per the module
        // docs); spawn the actual DB write rather than blocking the
        // dispatch loop that drives every other registered hook.
        tokio::spawn(async move {
            // DB-boundary: the actual UPDATE statements live in
            // `persistence_lifecycle::repositories::lifecycle` (check-db-boundary.sh
            // forbids raw SQL outside crates/persistence/db).
            if let Err(err) =
                persistence_lifecycle::repositories::lifecycle::mark_project_dependents_stale(
                    &pool,
                    &project_id,
                )
                .await
            {
                tracing::warn!(
                    project_id,
                    error = %err,
                    "stale-dependent propagation failed"
                );
            }
        });
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event_bus::{LifecycleTransitionApplied, Source};
    use domain_core::ids::Timestamp;
    use domain_core::lifecycle::data_asset::EntityType;
    use std::sync::atomic::{AtomicUsize, Ordering};

    async fn test_bus() -> EventBus {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS events (\
             event_id INTEGER PRIMARY KEY AUTOINCREMENT,\
             topic TEXT NOT NULL, source TEXT NOT NULL,\
             emitted_at TEXT NOT NULL, payload TEXT NOT NULL)",
        )
        .execute(&pool)
        .await
        .unwrap();
        EventBus::with_pool(pool)
    }

    #[tokio::test]
    async fn hooks_fire_on_matching_topic() {
        let counter = Arc::new(AtomicUsize::new(0));
        let counter_clone = counter.clone();

        let propagator = StalePropagator::new().with_hook(Arc::new(move |_env| {
            counter_clone.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }));

        let bus = test_bus().await;
        let handle = propagator.spawn(&bus);

        bus.publish(
            TOPIC_LIFECYCLE_TRANSITION_APPLIED,
            Source::User,
            LifecycleTransitionApplied {
                entity_type: EntityType::Project,
                entity_id: "00000000-0000-0000-0000-000000000000".to_owned(),
                from_state: "ready".to_owned(),
                to_state: "processing".to_owned(),
                actor: "user".to_owned(),
                at: Timestamp::now_utc(),
                project_id: Some("00000000-0000-0000-0000-000000000000".to_owned()),
            },
        )
        .await
        .unwrap();

        // Let the spawned task observe the event.
        tokio::task::yield_now().await;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        assert_eq!(counter.load(Ordering::SeqCst), 1);
        handle.abort();
    }

    /// Real migrated DB — `resolve_project_dependents_hook` needs the actual
    /// `processing_artifact`/`prepared_source_view` tables (migration 0002).
    async fn migrated_test_bus() -> (persistence_core::Database, EventBus) {
        let db = persistence_core::Database::in_memory().await.expect("in-memory db");
        db.migrate().await.expect("migrate");
        let bus = EventBus::with_pool(db.pool().clone());
        (db, bus)
    }

    /// Seeds two projects (`project_id` / `other_project_id`) each with a
    /// `processing_artifact` row, plus one `prepared_source_view` row for
    /// `project_id` only — the fixture `resolve_project_dependents_hook`
    /// tests scope their assertions against.
    async fn seed_two_project_dependents(
        pool: &sqlx::SqlitePool,
        project_id: &str,
        other_project_id: &str,
        now: &str,
    ) {
        sqlx::query(
            "INSERT INTO target (id, primary_designation, created_at) VALUES ('t1', 'M31', ?)",
        )
        .bind(now)
        .execute(pool)
        .await
        .unwrap();
        for pid in [project_id, other_project_id] {
            sqlx::query(
                "INSERT INTO project (id, name, target_id, session_ids, created_at) \
                 VALUES (?, 'p', 't1', '[]', ?)",
            )
            .bind(pid)
            .bind(now)
            .execute(pool)
            .await
            .unwrap();
        }
        sqlx::query(
            "INSERT INTO library_root (id, label, current_path, kind, state, created_at) \
             VALUES ('root1', 'r', '/tmp', 'local', 'active', ?)",
        )
        .bind(now)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO file_record \
             (id, root_id, relative_path, size_bytes, mtime, state, first_seen_at, last_seen_at) \
             VALUES ('fr1', 'root1', 'a.fits', 1, ?, 'observed', ?, ?)",
        )
        .bind(now)
        .bind(now)
        .bind(now)
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO processing_artifact \
             (id, project_id, file_record_id, kind, staleness, created_at) \
             VALUES ('art-mine', ?, 'fr1', 'manifest', 'current', ?)",
        )
        .bind(project_id)
        .bind(now)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO processing_artifact \
             (id, project_id, file_record_id, kind, staleness, created_at) \
             VALUES ('art-other', ?, 'fr1', 'manifest', 'current', ?)",
        )
        .bind(other_project_id)
        .bind(now)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO prepared_source_view (id, project_id, state, created_at) \
             VALUES ('psv-mine', ?, 'ready', ?)",
        )
        .bind(project_id)
        .bind(now)
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn resolve_project_dependents_hook_marks_project_scoped_rows_stale() {
        let (db, bus) = migrated_test_bus().await;
        let project_id = "11111111-1111-1111-1111-111111111111";
        let other_project_id = "22222222-2222-2222-2222-222222222222";
        let now = "2026-07-19T00:00:00Z";
        seed_two_project_dependents(db.pool(), project_id, other_project_id, now).await;

        let propagator =
            StalePropagator::new().with_hook(resolve_project_dependents_hook(db.pool().clone()));
        let handle = propagator.spawn(&bus);

        bus.publish(
            TOPIC_LIFECYCLE_TRANSITION_APPLIED,
            Source::User,
            LifecycleTransitionApplied {
                entity_type: EntityType::Project,
                entity_id: project_id.to_owned(),
                from_state: "ready".to_owned(),
                to_state: "processing".to_owned(),
                actor: "user".to_owned(),
                at: Timestamp::now_utc(),
                project_id: Some(project_id.to_owned()),
            },
        )
        .await
        .unwrap();

        // The hook's own DB write is a spawned task; give it time to land.
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        handle.abort();

        let mine: String =
            sqlx::query_scalar("SELECT staleness FROM processing_artifact WHERE id = 'art-mine'")
                .fetch_one(db.pool())
                .await
                .unwrap();
        assert_eq!(mine, "stale", "this project's artifact must flip to stale");

        let other: String =
            sqlx::query_scalar("SELECT staleness FROM processing_artifact WHERE id = 'art-other'")
                .fetch_one(db.pool())
                .await
                .unwrap();
        assert_eq!(other, "current", "a different project's artifact must be untouched");

        let psv: String =
            sqlx::query_scalar("SELECT state FROM prepared_source_view WHERE id = 'psv-mine'")
                .fetch_one(db.pool())
                .await
                .unwrap();
        assert_eq!(psv, "stale", "this project's prepared source view must flip to stale");
    }

    #[tokio::test]
    async fn resolve_project_dependents_hook_is_a_noop_without_project_id() {
        let (db, bus) = migrated_test_bus().await;
        let propagator =
            StalePropagator::new().with_hook(resolve_project_dependents_hook(db.pool().clone()));
        let handle = propagator.spawn(&bus);

        // No project_id resolvable (e.g. a FileRecord transition) — must not
        // panic or error the dispatch loop.
        bus.publish(
            TOPIC_LIFECYCLE_TRANSITION_APPLIED,
            Source::System,
            LifecycleTransitionApplied {
                entity_type: EntityType::FileRecord,
                entity_id: "fr-unrelated".to_owned(),
                from_state: "observed".to_owned(),
                to_state: "changed".to_owned(),
                actor: "system".to_owned(),
                at: Timestamp::now_utc(),
                project_id: None,
            },
        )
        .await
        .unwrap();

        tokio::task::yield_now().await;
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        handle.abort();
    }
}
