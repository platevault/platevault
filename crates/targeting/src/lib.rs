//! Target identity and query normalization (the pure catalog primitives).
//!
//! # Module layout
//!
//! - [`normalize`]: query normalization pipeline (casefold, NFKC, prefix expansion).
//! - [`identity`]: deterministic UUIDv5 generation for `canonical_target.id`.
//! - [`coords`]: coordinate-based nearest-neighbour target resolution
//!   (haversine separation + FOV-aware radius + ranking; spec 041 R-17/R-18),
//!   now built on the `target-match` crate's coordinate primitives.
//!
//! `Angle`, `Equatorial`, `Epoch`, and `separation` are re-exported from
//! `target_match` so downstream crates get one coordinate-primitive dependency
//! (via `targeting`) rather than each pulling `target-match` directly for basic
//! RA/Dec/angle types.
//!
//! The on-demand SIMBAD resolver, the SQLite resolution cache, and the
//! bundled-seed loader (spec 035) live in the sibling `targeting_resolver`
//! crate (split out in spec 042 / T250) so this crate stays free of the
//! sqlx/reqwest/tokio dependency surface.
//!
//! The spec-013 in-memory catalog engine (`catalog`, `lookup`, `resolve`,
//! `aliases`, `fixture`) was removed by spec 036.

#![allow(clippy::doc_markdown)] // spec/domain terminology is not suited for backticks

pub mod coords;
pub mod identity;
pub mod normalize;

pub use target_match::{separation, Angle, Epoch, Equatorial, Field};

pub const CRATE_NAME: &str = "targeting";

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn exposes_crate_name() {
        assert_eq!(CRATE_NAME, "targeting");
    }
}
