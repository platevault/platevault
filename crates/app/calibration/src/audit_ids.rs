// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Shared derivation of audit `entity_id`s for this crate's write paths.
//!
//! Mirrors `app_core::audit_ids`, which this crate cannot reuse: `app_core`
//! re-exports `app_calibration`, so the dependency edge only runs one way.

use domain_core::ids::EntityId;

/// Audit `entity_id` for `id` under `namespace` (a fixed per-call-site tag,
/// e.g. `"equipment"`).
///
/// Parses `id` as a real UUID when possible — every persisted equipment item
/// and calibration assignment id is one — and otherwise derives a stable
/// UUIDv5, so audit rows for entities that have no id yet (a failed `create`,
/// keyed on the attempted name) still correlate across repeated attempts.
///
/// The `astro-plan.audit.{namespace}` seed is load-bearing: changing it
/// re-keys every already-written audit row's `entity_id`.
pub(crate) fn audit_entity_id(namespace: &str, id: &str) -> EntityId {
    uuid::Uuid::parse_str(id).map_or_else(
        |_| {
            let ns = uuid::Uuid::new_v5(
                &uuid::Uuid::NAMESPACE_DNS,
                format!("astro-plan.audit.{namespace}").as_bytes(),
            );
            EntityId::from_uuid(uuid::Uuid::new_v5(&ns, id.as_bytes()))
        },
        EntityId::from_uuid,
    )
}

#[cfg(test)]
mod tests {
    use super::audit_entity_id;

    /// The pre-extraction `equipment_entity_id` hard-coded this namespace seed
    /// as a byte literal; audit rows written under it must keep resolving to
    /// the same `entity_id`.
    #[test]
    fn equipment_namespace_matches_the_pre_extraction_byte_seed() {
        let ns = uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_DNS, b"astro-plan.audit.equipment");
        let expected = uuid::Uuid::new_v5(&ns, b"ASI2600MM");
        assert_eq!(audit_entity_id("equipment", "ASI2600MM").as_uuid(), expected);
    }

    #[test]
    fn a_uuid_id_is_used_verbatim() {
        let id = uuid::Uuid::new_v4();
        assert_eq!(audit_entity_id("calibration.assignment", &id.to_string()).as_uuid(), id);
    }
}
