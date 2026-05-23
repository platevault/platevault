//! Canonical `(entity_type, from, to) → action_critical_fields[]` table
//! (spec 002 FR-009/FR-010, T050).
//!
//! Authored from data-model.md §Action-Bound Review. The transition use case
//! looks up this table on every edge attempt; for each listed field path it
//! fetches the field's provenance origin and refuses the transition with
//! `provenance.unreviewed` when any required field is not yet `reviewed`.
//!
//! TODO: populate via SpecKit clarification — see data-model.md
//! §Action-Bound Review. The table currently encodes only the single cell
//! documented there; further cells require explicit research before they
//! can be added (constitution §IV).
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
/// Currently contains a single cell — see data-model.md §Action-Bound Review.
pub const TABLE: &[ActionReviewEdge] = &[
    // AcquisitionSession candidate → needs_review: confirming the session as
    // ready-for-review requires that observer_location has been reviewed.
    // See data-model.md §Action-Bound Review.
    ActionReviewEdge {
        entity_type: EntityType::AcquisitionSession,
        from: "candidate",
        to: "needs_review",
        critical_fields: &["observer_location"],
    },
    // The contract dispatcher (T036) tags acquisition-session requests as
    // `EntityType::InventorySession` (the `inventory_session` contract
    // variant shares the `acquisition_session` SQL table). Mirror the same
    // cell under that alias so the gate fires regardless of which path the
    // request arrived on.
    ActionReviewEdge {
        entity_type: EntityType::InventorySession,
        from: "candidate",
        to: "needs_review",
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
    fn acquisition_session_candidate_to_needs_review_requires_observer_location() {
        let fields =
            action_critical_fields(EntityType::AcquisitionSession, "candidate", "needs_review");
        assert_eq!(fields, &["observer_location"]);
    }

    #[test]
    fn inventory_session_alias_carries_same_cell() {
        // Contract-side `inventory_session` requests are routed through the
        // same SQL table; the alias row keeps the gate firing on that path.
        let fields =
            action_critical_fields(EntityType::InventorySession, "candidate", "needs_review");
        assert_eq!(fields, &["observer_location"]);
    }

    #[test]
    fn unknown_edge_returns_empty() {
        let fields = action_critical_fields(EntityType::Project, "ready", "processing");
        assert!(fields.is_empty());
    }

    #[test]
    fn other_session_edges_are_unrestricted() {
        // Only the one documented cell is populated; other session edges
        // intentionally return an empty list until further SpecKit
        // clarification populates them.
        assert!(
            action_critical_fields(EntityType::AcquisitionSession, "needs_review", "confirmed")
                .is_empty()
        );
        assert!(
            action_critical_fields(EntityType::CalibrationSession, "candidate", "needs_review")
                .is_empty()
        );
    }

    #[test]
    fn table_is_not_empty() {
        // Defensive: the canonical cell is here so the gate has something to
        // enforce. If this fails the documented cell was deleted.
        assert!(!TABLE.is_empty());
    }
}
