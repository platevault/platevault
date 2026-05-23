//! T028: edge-list test for `SessionState` transitions (research.md §2.3).
//!
//! Applies to both `AcquisitionSession` and `CalibrationSession`.

use domain_core::lifecycle::session::{is_allowed, SessionState, TRANSITIONS};

#[test]
fn covers_11_edges() {
    assert_eq!(TRANSITIONS.len(), 11);
}

#[test]
fn confirmed_is_soft_terminal_reopenable() {
    // Mockup InventoryPage:388-394: re-open review allowed.
    assert!(is_allowed(SessionState::Confirmed, SessionState::NeedsReview));
    assert!(is_allowed(SessionState::Rejected, SessionState::NeedsReview));
}

#[test]
fn ignored_can_be_unignored() {
    assert!(is_allowed(SessionState::Ignored, SessionState::Candidate));
}

#[test]
fn discovered_cannot_jump_to_confirmed() {
    // Must transit candidate first (research.md §2.3).
    assert!(!is_allowed(SessionState::Discovered, SessionState::Confirmed));
}
