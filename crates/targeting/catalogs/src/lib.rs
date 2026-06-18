//! Catalog registry, license attribution, download lifecycle, and loader
//! boundary for spec 014 — Catalog Index Licensing.
#![allow(clippy::doc_markdown)] // spec/domain terminology not appropriate for backticks
//!
//! # Module layout
//!
//! - [`registry`]: static registry of known v1 catalogs and their metadata.
//! - [`license`]: `LicenseAttribution` model and the `LicenseShortCode` enum.
//! - [`download`]: manifest fetch, ETag caching, per-catalog download,
//!   SHA-256 checksum verification, and install into SQLite.  The real HTTP
//!   fetch is abstracted behind [`download::CatalogFetcher`] so the lifecycle
//!   state-machine is unit-testable with a [`download::FakeFetcher`] (no real
//!   network in tests).
//! - [`loader`]: reader for the per-catalog `<slug>.json` entry file
//!   ([`loader::read_catalog_file`]); the ratified F3 format consumed by spec 013.

pub mod download;
pub mod license;
pub mod loader;
pub mod registry;

pub const CRATE_NAME: &str = "targeting_catalogs";

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn exposes_crate_name() {
        assert_eq!(CRATE_NAME, "targeting_catalogs");
    }
}
