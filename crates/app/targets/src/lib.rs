//! Target catalog, resolution, search, and ingest-resolution use cases.
//!
//! Groups the target-domain use-case modules (spec 035 / spec 036). Each
//! sub-module is re-exported from the crate root so existing
//! `app_core::<module>` paths remain stable.
//!
//! Extracted from `app_core` into its own crate (spec 042 / T253 O3b). Its only
//! cross-group dependency was on the now-extracted `app_core_errors` leaf; the
//! remaining cross-references (`target_dto`) are internal to this crate.
//! `app_core` re-exports these modules at their original `app_core::<module>`
//! paths so the public surface is byte-identical.
#![allow(clippy::doc_markdown)] // spec/domain terminology not appropriate for backticks

pub mod frame_writer;
pub mod ingest_resolution;
pub mod ingest_sessions;
pub mod resolver_settings;
pub mod target_dto;
pub mod target_favourites;
pub mod target_management;
pub mod target_resolve;
pub mod target_search;
