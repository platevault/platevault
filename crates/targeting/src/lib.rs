//! Target catalog, aliases, identifiers, and lookup for spec 013.
//!
//! # Module layout
//!
//! - [`catalog`]: in-memory catalog types — [`catalog::TargetCatalog`],
//!   [`catalog::CatalogEntry`], [`catalog::TargetMatch`], [`catalog::MatchEvidence`].
//! - [`normalize`]: query normalization pipeline (casefold, NFKC, prefix expansion).
//! - [`identity`]: deterministic UUIDv5 generation for `Target.id` (R6).
//! - [`lookup`]: exact, fuzzy, and edit-distance matchers.
//! - [`resolve`]: ambiguity policy (R3) wrapping the lookup pipeline.
//! - [`load`]: SQLite-backed catalog loader (T005).
//! - [`fixture`]: seeded in-memory test catalog (no network, no files).

#![allow(clippy::doc_markdown)] // spec/domain terminology is not suited for backticks

pub mod catalog;
pub mod identity;
pub mod load;
pub mod lookup;
pub mod normalize;
pub mod resolve;

#[cfg(any(test, feature = "test-fixture"))]
pub mod fixture;

pub const CRATE_NAME: &str = "targeting";

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn exposes_crate_name() {
        assert_eq!(CRATE_NAME, "targeting");
    }
}
