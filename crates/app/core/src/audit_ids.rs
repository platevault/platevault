// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Deterministic `entity_id` derivation for durable audit rows whose real
//! identity is a plain string, not a UUID (spec 030 FR-133, T123/T125).
//!
//! Shared by `protection.rs` (source ids, plan/item ids) and `first_run.rs`
//! (attempted registration paths that never got a source id). UUIDv5 keeps
//! every audit row for the same real-world id correlated under one
//! `entity_id`, without requiring that id to already be a UUID — the same
//! technique `crates/targeting/src/identity.rs` uses for target ids.

use domain_core::ids::EntityId;

/// Derive a stable UUIDv5 `entity_id` from `namespace` (a fixed per-call-site
/// tag, e.g. `"protection.source"`) and `seed` (the real-world string id,
/// e.g. a source id or attempted path).
pub(crate) fn deterministic_entity_id(namespace: &str, seed: &str) -> EntityId {
    let ns = uuid::Uuid::new_v5(
        &uuid::Uuid::NAMESPACE_DNS,
        format!("astro-plan.audit.{namespace}").as_bytes(),
    );
    EntityId::from_uuid(uuid::Uuid::new_v5(&ns, seed.as_bytes()))
}
