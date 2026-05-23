//! T035a: edge-list test for `InventoryState` (`FileRecord`) transitions.
//!
//! Mirrors research.md §2.4 and data-model.md `FileRecord` Lifecycle. The
//! `* -> protected` wildcard is encoded as an explicit edge per non-terminal
//! source state.

#![allow(clippy::doc_markdown)]

use domain_core::lifecycle::inventory::{is_allowed, InventoryState, TRANSITIONS};

#[test]
fn covers_15_edges() {
    assert_eq!(TRANSITIONS.len(), 15);
}

#[test]
fn protected_is_sticky() {
    for s in [
        InventoryState::Observed,
        InventoryState::Classified,
        InventoryState::Changed,
        InventoryState::Missing,
        InventoryState::Rejected,
        InventoryState::Protected,
    ] {
        assert!(
            !is_allowed(InventoryState::Protected, s),
            "protected → {s:?} must be forbidden (sticky pin)"
        );
    }
}

#[test]
fn missing_can_recover_or_pin() {
    assert!(is_allowed(InventoryState::Missing, InventoryState::Observed));
    assert!(is_allowed(InventoryState::Missing, InventoryState::Protected));
    // Missing should NOT jump to classified directly — must observe first.
    assert!(!is_allowed(InventoryState::Missing, InventoryState::Classified));
}

#[test]
fn star_to_protected_wildcard() {
    for from in [
        InventoryState::Observed,
        InventoryState::Classified,
        InventoryState::Changed,
        InventoryState::Missing,
        InventoryState::Rejected,
    ] {
        assert!(
            is_allowed(from, InventoryState::Protected),
            "{from:?} → protected must be allowed (`* → protected` rule)"
        );
    }
}
