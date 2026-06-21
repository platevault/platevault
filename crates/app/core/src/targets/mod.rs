//! Target catalog, resolution, search, and ingest-resolution use cases.
//!
//! Groups the target-domain use-case modules (spec 035 / spec 036). Each
//! sub-module is re-exported from the crate root so existing
//! `app_core::<module>` paths remain stable.

pub mod ingest_resolution;
pub mod resolver_settings;
pub mod target_dto;
pub mod target_management;
pub mod target_resolve;
pub mod target_search;
