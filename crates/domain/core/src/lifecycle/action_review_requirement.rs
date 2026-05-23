//! Canonical `(entity_type, from, to) → action_critical_fields[]` table
//! (spec 002 FR-009/FR-010, T050).
//!
//! Authored from data-model.md §Action-Bound Review. The transition use case
//! looks up this table on every edge attempt; for each listed field path it
//! fetches the field's provenance origin and refuses the transition with
//! `provenance.unreviewed` when any required field is not yet `reviewed`.
//!
//! Further cells require additional fields to be promoted to
//! `ProvenancedValue<T>` first. Today only
//! `AcquisitionSession.observer_location` is wrapped; promoting other
//! extracted fields (e.g. `FileRecord` exposure metadata,
//! `AcquisitionSession.target_id`, `Project.target_id`) is out of scope
//! for spec 002 and would be a separate spec amendment or a new
//! "Provenance Wrapper Coverage" spec.
//!
//! Clarification 2026-05-23: the gate previously sat on the
//! `candidate → needs_review` edge. That edge is a pipeline-driven
//! auto-transition (triggered by extraction failure), not a user action
//! the gate refuses. Moved the cell to the confirmation edges
//! (`candidate → confirmed` and `needs_review → confirmed`) where the
//! user-initiated action that requires review actually lives.
//!
//! Field-level review state is derived from each field's
//! [`ProvenancedValue::origin`] — it is NOT a per-entity column. The
//! repository surface for that read is
//! [`LifecycleRepository::field_origins`].

use crate::lifecycle::data_asset::EntityType;

/// A dotted field path on a Data Asset (matches `provenance.field_path`).
pub type FieldPath = &'static str;

/// One row in the action-bound review table.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ActionReviewEdge {
    pub entity_type: EntityType,
    pub from: &'static str,
    pub to: &'static str,
    /// Field paths whose `ProvenancedValue.origin` MUST be `reviewed`
    /// before the edge may be applied.
    pub critical_fields: &'static [FieldPath],
}

/// Canonical rule table.
///
/// See data-model.md §Action-Bound Review for the authoritative table.
pub const TABLE: &[ActionReviewEdge] = &[
    // AcquisitionSession candidate → confirmed: confirming the session
    // requires that observer_location has been reviewed.
    ActionReviewEdge {
        entity_type: EntityType::AcquisitionSession,
        from: "candidate",
        to: "confirmed",
        critical_fields: &["observer_location"],
    },
    // AcquisitionSession needs_review → confirmed: same gate when promoting
    // from explicit review back into a confirmed state.
    ActionReviewEdge {
        entity_type: EntityType::AcquisitionSession,
        from: "needs_review",
        to: "confirmed",
        critical_fields: &["observer_location"],
    },
    // The contract dispatcher (T036) tags acquisition-session requests as
    // `EntityType::InventorySession` (the `inventory_session` contract
    // variant shares the `acquisition_session` SQL table). Mirror the same
    // cells under that alias so the gate fires regardless of which path the
    // request arrived on.
    ActionReviewEdge {
        entity_type: EntityType::InventorySession,
        from: "candidate",
        to: "confirmed",
        critical_fields: &["observer_location"],
    },
    ActionReviewEdge {
        entity_type: EntityType::InventorySession,
        from: "needs_review",
        to: "confirmed",
        critical_fields: &["observer_location"],
    },
];

/// Return the field paths whose provenance origin MUST be `reviewed` before
/// the `(entity_type, from, to)` edge may be applied.
///
/// Returns an empty slice for every edge not present in [`TABLE`].
#[must_use]
pub fn action_critical_fields(
    entity_type: EntityType,
    from: &str,
    to: &str,
) -> &'static [FieldPath] {
    TABLE
        .iter()
        .find(|edge| edge.entity_type == entity_type && edge.from == from && edge.to == to)
        .map_or(&[][..], |edge| edge.critical_fields)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acquisition_session_candidate_to_confirmed_requires_observer_location() {
        let fields =
            action_critical_fields(EntityType::AcquisitionSession, "candidate", "confirmed");
        assert_eq!(fields, &["observer_location"]);
    }

    #[test]
    fn acquisition_session_needs_review_to_confirmed_requires_observer_location() {
        let fields =
            action_critical_fields(EntityType::AcquisitionSession, "needs_review", "confirmed");
        assert_eq!(fields, &["observer_location"]);
    }

    #[test]
    fn inventory_session_alias_carries_both_cells() {
        // Contract-side `inventory_session` requests are routed through the
        // same SQL table; the alias rows keep the gate firing on that path
        // for both confirmation edges.
        assert_eq!(
            action_critical_fields(EntityType::InventorySession, "candidate", "confirmed"),
            &["observer_location"],
        );
        assert_eq!(
            action_critical_fields(EntityType::InventorySession, "needs_review", "confirmed"),
            &["observer_location"],
        );
    }

    #[test]
    fn unknown_edge_returns_empty() {
        let fields = action_critical_fields(EntityType::Project, "ready", "processing");
        assert!(fields.is_empty());
    }

    #[test]
    fn entry_to_review_edge_is_not_gated() {
        // The `candidate → needs_review` edge is a pipeline-driven
        // auto-transition (extraction failure), not a user action this
        // gate refuses. It must NOT carry an action-critical cell.
        // Clarified 2026-05-23.
        assert!(action_critical_fields(
            EntityType::AcquisitionSession,
            "candidate",
            "needs_review"
        )
        .is_empty());
        assert!(action_critical_fields(EntityType::InventorySession, "candidate", "needs_review")
            .is_empty());
    }

    #[test]
    fn other_session_edges_are_unrestricted() {
        // Calibration sessions have no `observer_location` field at all
        // (calibration is environmental and observer-independent), so no
        // cells exist for that entity type. Future cells for other entity
        // types require additional fields to be promoted to
        // `ProvenancedValue<T>` first — out of scope for spec 002.
        assert!(action_critical_fields(EntityType::CalibrationSession, "candidate", "confirmed")
            .is_empty());
        assert!(action_critical_fields(
            EntityType::CalibrationSession,
            "needs_review",
            "confirmed"
        )
        .is_empty());
    }

    #[test]
    fn table_is_not_empty() {
        // Defensive: the canonical cell is here so the gate has something to
        // enforce. If this fails the documented cell was deleted.
        assert!(!TABLE.is_empty());
    }
}
