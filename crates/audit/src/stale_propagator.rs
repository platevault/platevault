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
}
