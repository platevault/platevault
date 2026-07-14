// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Minimal event-publishing seam.
//!
//! Lets `persistence_db` repositories (e.g. `lifecycle::SqliteLifecycleRepository`)
//! emit domain events without depending on the `audit` crate's `EventBus`
//! runtime — `audit` depends on `persistence_db` (for the `events` table SQL),
//! so `persistence_db -> audit` would be a cycle. `audit::bus::EventBus`
//! implements this trait; production code is unaffected (same `EventBus`
//! value is passed in, just behind the trait).
//!
//! Non-generic over the payload (unlike `EventBus::publish<P: Serialize>`)
//! so the trait stays object-safe for `Arc<dyn EventPublisher>` — callers
//! serialize their typed payload to `serde_json::Value` before calling.

use crate::event_bus::Source;

#[async_trait::async_trait]
pub trait EventPublisher: Send + Sync {
    async fn publish(&self, topic: &str, source: Source, payload: serde_json::Value);
}
