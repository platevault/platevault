// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Persistence facade — TRANSITIONAL re-export layer (bead astro-plan-gl58).
//!
//! This crate will be DELETED once all 12 dependents migrate to direct sub-crate
//! deps. It contains NO logic, NO tests, NO modules — only re-exports preserving
//! existing import paths.
#![allow(clippy::doc_markdown)]

// ── Re-exports from persistence_core ────────────────────────────────────────

pub use persistence_core::{
    migration_divergence_detail, Database, DbError, DbResult, Repository, BUSY_TIMEOUT, CRATE_NAME,
};

/// Transitional re-export (bead astro-plan-gl58).
pub use persistence_core::operation_state;

/// Transitional test-support re-export.
pub mod test_support {
    pub use persistence_core::test_support::*;
}

// ── Re-exported repository surface ─────────────────────────────────────────

/// Transitional repositories module that re-exports every sub-crate's
/// repository surface, preserving `persistence_db::repositories::*` paths.
pub mod repositories {
    // persistence_core (cross-domain queries + audit write primitives)
    /// Transitional re-export (bead astro-plan-gl58).
    pub use persistence_core::repositories::audit_writes;
    /// Transitional re-export (bead astro-plan-gl58).
    pub use persistence_core::repositories::q_core;

    // persistence_targets also hosts q_desktop (mixed target/inbox queries)
    /// Transitional re-export (bead astro-plan-gl58).
    pub use persistence_targets::repositories::q_desktop;

    // persistence_inbox
    /// Transitional re-export (bead astro-plan-gl58).
    pub use persistence_inbox::repositories::inbox;
    /// Transitional re-export (bead astro-plan-gl58).
    pub use persistence_inbox::repositories::q_inbox;

    // persistence_lifecycle
    /// Transitional re-export (bead astro-plan-gl58).
    pub use persistence_lifecycle::repositories::audit;
    /// Transitional re-export (bead astro-plan-gl58).
    pub use persistence_lifecycle::repositories::command_ledger;
    /// Transitional re-export (bead astro-plan-gl58).
    pub use persistence_lifecycle::repositories::events;
    /// Transitional re-export (bead astro-plan-gl58).
    pub use persistence_lifecycle::repositories::first_run;
    /// Transitional re-export (bead astro-plan-gl58).
    pub use persistence_lifecycle::repositories::lifecycle;
    /// Transitional re-export (bead astro-plan-gl58).
    pub use persistence_lifecycle::repositories::onboarding;
    /// Transitional re-export (bead astro-plan-gl58).
    pub use persistence_lifecycle::repositories::provenance;
    /// Transitional re-export (bead astro-plan-gl58).
    pub use persistence_lifecycle::repositories::settings;

    // persistence_calibration
    /// Transitional re-export (bead astro-plan-gl58).
    pub use persistence_calibration::repositories::calibration_assignment;
    /// Transitional re-export (bead astro-plan-gl58).
    pub use persistence_calibration::repositories::calibration_tolerances;
    /// Transitional re-export (bead astro-plan-gl58).
    pub use persistence_calibration::repositories::equipment;
    /// Transitional re-export (bead astro-plan-gl58).
    pub use persistence_calibration::repositories::q_calibration;

    // persistence_targets
    /// Transitional re-export (bead astro-plan-gl58).
    pub use persistence_targets::repositories::framing;
    /// Transitional re-export (bead astro-plan-gl58).
    pub use persistence_targets::repositories::inventory;
    /// Transitional re-export (bead astro-plan-gl58).
    pub use persistence_targets::repositories::q_resolver;
    /// Transitional re-export (bead astro-plan-gl58).
    pub use persistence_targets::repositories::q_targets_ingest;
    /// Transitional re-export (bead astro-plan-gl58).
    pub use persistence_targets::repositories::q_targets_mgmt;
    /// Transitional re-export (bead astro-plan-gl58).
    pub use persistence_targets::repositories::target_favourites;
    /// Transitional re-export (bead astro-plan-gl58).
    pub use persistence_targets::repositories::targets;

    // persistence_plans
    /// Transitional re-export (bead astro-plan-gl58).
    pub use persistence_plans::repositories::artifacts;
    /// Transitional re-export (bead astro-plan-gl58).
    pub use persistence_plans::repositories::manifests;
    /// Transitional re-export (bead astro-plan-gl58).
    pub use persistence_plans::repositories::plan_apply;
    /// Transitional re-export (bead astro-plan-gl58).
    pub use persistence_plans::repositories::plans;
    /// Transitional re-export (bead astro-plan-gl58).
    pub use persistence_plans::repositories::prepared_source_views;
    /// Transitional re-export (bead astro-plan-gl58).
    pub use persistence_plans::repositories::project_notes;
    /// Transitional re-export (bead astro-plan-gl58).
    pub use persistence_plans::repositories::projects;
    /// Transitional re-export (bead astro-plan-gl58).
    pub use persistence_plans::repositories::q_projects;
    /// Transitional re-export (bead astro-plan-gl58).
    pub use persistence_plans::repositories::source_protection;
    /// Transitional re-export (bead astro-plan-gl58).
    pub use persistence_plans::repositories::tool_launches;
}
