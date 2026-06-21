//! Target identity and query normalization (the pure catalog primitives).
//!
//! # Module layout
//!
//! - [`normalize`]: query normalization pipeline (casefold, NFKC, prefix expansion).
//! - [`identity`]: deterministic UUIDv5 generation for `canonical_target.id`.
//!
//! The on-demand SIMBAD resolver, the SQLite resolution cache, and the
//! bundled-seed loader (spec 035) live in the sibling `targeting_resolver`
//! crate (split out in spec 042 / T250) so this crate stays free of the
//! sqlx/reqwest/tokio dependency surface.
//!
//! The spec-013 in-memory catalog engine (`catalog`, `lookup`, `resolve`,
//! `aliases`, `fixture`) was removed by spec 036.

#![allow(clippy::doc_markdown)] // spec/domain terminology is not suited for backticks

pub mod identity;
pub mod normalize;

pub const CRATE_NAME: &str = "targeting";

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn exposes_crate_name() {
        assert_eq!(CRATE_NAME, "targeting");
    }
}
