//! Project create/update, health, manifests, notes, and prepared-view use cases.
//!
//! Groups the project-domain use-case modules (spec 008 / 009 / 024 / 026).
//! Each sub-module is re-exported from the crate root so existing
//! `app_core::<module>` paths remain stable.

pub mod prepared_views;
pub mod project_health;
pub mod project_manifests;
pub mod project_notes;
pub mod project_setup;
