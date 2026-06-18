//! Target resolution module (spec 035: SIMBAD Target Resolution).
//!
//! Resolves astronomical target identities on demand against SIMBAD, backed by
//! a bundled seed index and a local SQLite cache. This module owns the
//! resolver seam (a testable [`Resolver`] trait — implemented later by
//! `SimbadResolver` and a `FakeResolver`), the cache read/write layer, and the
//! bundled-seed loader.
//!
//! This is metadata/identity resolution only — no image processing
//! (PixInsight boundary, constitution §III).
//!
//! # Module layout
//!
//! - [`simbad`]: SIMBAD TAP/Sesame HTTP client (`reqwest`) → canonical identity.
//! - [`cache`]: cache read/write, dedupe by SIMBAD oid, source precedence.
//! - [`seed`]: bundled-seed load at first run.

pub mod cache;
pub mod seed;
pub mod simbad;

// TODO(T004): define the `Resolver` trait (async resolve/search seam) here,
// mirroring the testable-seam pattern of the retired `download::CatalogFetcher`.
