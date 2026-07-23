// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Canonical `(entity_type, from, to) → requires_plan` table (spec 002 T044).
//!
//! Authored from data-model.md §Plan-Requirement Edge Table. Callers MUST NOT
//! pass `requires_plan` on the contract request — the use case derives it via
//! [`requires_plan`] on every transition attempt.
//!
//! The wildcard `"*"` means "any state". Specific edges win over wildcards
//! when both match.

use crate::lifecycle::data_asset::EntityType;

/// One row in the plan-requirement table.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PlanRequirementEdge {
    pub entity_type: EntityType,
    /// `"*"` matches any from-state.
    pub from: &'static str,
    /// `"*"` matches any to-state.
    pub to: &'static str,
    pub requires_plan: bool,
}

/// Canonical rule table, ordered most-specific-first so that specific
/// `(project, ready, prepared)` rows match before the implicit defaults at
/// the bottom (`project, *, *` is permissive — no fallthrough to plan-required).
pub const TABLE: &[PlanRequirementEdge] = &[
    // ── Project ──────────────────────────────────────────────────────────
    PlanRequirementEdge {
        entity_type: EntityType::Project,
        from: "ready",
        to: "prepared",
        requires_plan: true,
    },
    PlanRequirementEdge {
        entity_type: EntityType::Project,
        from: "prepared",
        to: "ready",
        requires_plan: true,
    },
    PlanRequirementEdge {
        entity_type: EntityType::Project,
        from: "completed",
        to: "archived",
        requires_plan: true,
    },
    PlanRequirementEdge {
        entity_type: EntityType::Project,
        from: "blocked",
        to: "archived",
        requires_plan: true,
    },
    PlanRequirementEdge {
        entity_type: EntityType::Project,
        from: "archived",
        to: "processing",
        requires_plan: true,
    },
    PlanRequirementEdge {
        entity_type: EntityType::Project,
        from: "archived",
        to: "ready",
        requires_plan: true,
    },
    // ── Prepared source ──────────────────────────────────────────────────
    PlanRequirementEdge {
        entity_type: EntityType::PreparedSource,
        from: "*",
        to: "retired",
        requires_plan: true,
    },
    // ── Processing artifact ──────────────────────────────────────────────
    PlanRequirementEdge {
        entity_type: EntityType::ProcessingArtifact,
        from: "*",
        to: "regenerating",
        requires_plan: true,
    },
    PlanRequirementEdge {
        entity_type: EntityType::Projection,
        from: "*",
        to: "regenerating",
        requires_plan: true,
    },
];

/// Derive `requires_plan` for the given `(entity_type, from, to)` edge.
///
/// Returns `false` for every edge not listed in [`TABLE`], matching the
/// data-model.md final row group (`data_source`, `plan`, `file_record`).
#[must_use]
pub fn requires_plan(entity_type: EntityType, from: &str, to: &str) -> bool {
    TABLE
        .iter()
        .filter(|edge| edge.entity_type == entity_type)
        .any(|edge| (edge.from == from || edge.from == "*") && (edge.to == to || edge.to == "*"))
        && TABLE
            .iter()
            .filter(|edge| {
                edge.entity_type == entity_type
                    && (edge.from == from || edge.from == "*")
                    && (edge.to == to || edge.to == "*")
            })
            .all(|edge| edge.requires_plan)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_ready_to_prepared_requires_plan() {
        assert!(requires_plan(EntityType::Project, "ready", "prepared"));
    }

    #[test]
    fn project_completed_to_archived_requires_plan() {
        assert!(requires_plan(EntityType::Project, "completed", "archived"));
    }

    #[test]
    fn project_archived_to_ready_requires_plan() {
        assert!(requires_plan(EntityType::Project, "archived", "ready"));
    }

    #[test]
    fn project_ready_to_processing_is_unrestricted() {
        assert!(!requires_plan(EntityType::Project, "ready", "processing"));
    }

    #[test]
    fn prepared_source_to_retired_requires_plan() {
        assert!(requires_plan(EntityType::PreparedSource, "ready", "retired"));
        assert!(requires_plan(EntityType::PreparedSource, "stale", "retired"));
    }

    #[test]
    fn file_record_to_protected_no_plan() {
        assert!(!requires_plan(EntityType::FileRecord, "observed", "protected"));
    }
}
