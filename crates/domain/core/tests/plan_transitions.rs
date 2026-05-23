//! T027: edge-list test for `PlanState` transitions (research.md §2.2).

use domain_core::lifecycle::plan::{is_allowed, PlanState, TRANSITIONS};

#[test]
fn covers_14_edges() {
    // 4 terminal-flow + 4 review-flow + 3 apply-flow + 3 pause/resume + 0 from terminals.
    assert_eq!(TRANSITIONS.len(), 14);
}

#[test]
fn terminal_states_have_no_outbound_edges() {
    for s in [
        PlanState::Applied,
        PlanState::PartiallyApplied,
        PlanState::Failed,
        PlanState::Cancelled,
        PlanState::Discarded,
    ] {
        for t in
            [PlanState::Draft, PlanState::ReadyForReview, PlanState::Approved, PlanState::Applying]
        {
            assert!(!is_allowed(s, t), "terminal {s:?} → {t:?} must be forbidden");
        }
    }
}

#[test]
fn pause_resume_round_trip_allowed() {
    assert!(is_allowed(PlanState::Applying, PlanState::Paused));
    assert!(is_allowed(PlanState::Paused, PlanState::Applying));
    assert!(is_allowed(PlanState::Paused, PlanState::Cancelled));
}

#[test]
fn approval_reopen_returns_to_draft() {
    assert!(is_allowed(PlanState::Approved, PlanState::Draft));
}
