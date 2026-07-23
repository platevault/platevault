// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! T026: exhaustive edge-list test for `ProjectState` transitions.
//!
//! Mirrors the data-model.md §Project §Lifecycle table verbatim. If the
//! domain table drifts from the spec, this test fails.

use domain_core::lifecycle::project::{is_allowed, ProjectState, TRANSITIONS};

#[test]
fn covers_19_edges_from_data_model() {
    assert_eq!(TRANSITIONS.len(), 19, "spec 002 §Project lists 19 edges");
}

#[test]
fn setup_incomplete_edges() {
    assert!(is_allowed(ProjectState::SetupIncomplete, ProjectState::Ready));
    assert!(is_allowed(ProjectState::SetupIncomplete, ProjectState::Blocked));
}

#[test]
fn ready_edges() {
    assert!(is_allowed(ProjectState::Ready, ProjectState::Prepared));
    assert!(is_allowed(ProjectState::Ready, ProjectState::Processing));
    assert!(is_allowed(ProjectState::Ready, ProjectState::Blocked));
}

#[test]
fn processing_to_ready_is_disallowed() {
    // research.md §2.1: `processing → ready` is explicitly disallowed.
    assert!(!is_allowed(ProjectState::Processing, ProjectState::Ready));
}

#[test]
fn unarchive_paths_both_allowed() {
    // spec 009 R-Unarchive (GRILL 2026-05-22)
    assert!(is_allowed(ProjectState::Archived, ProjectState::Ready));
    assert!(is_allowed(ProjectState::Archived, ProjectState::Processing));
}

#[test]
fn blocked_can_escape_to_archived() {
    // spec 009 A3: escape-hatch for permanently-blocked projects.
    assert!(is_allowed(ProjectState::Blocked, ProjectState::Archived));
    // `blocked → completed` remains forbidden (GRILL spec 009).
    assert!(!is_allowed(ProjectState::Blocked, ProjectState::Completed));
}

#[test]
fn same_state_is_not_in_table() {
    // No-op detection lives in the use case before the table is consulted
    // (research.md §5). The table itself must not include identity edges.
    for s in [
        ProjectState::SetupIncomplete,
        ProjectState::Ready,
        ProjectState::Prepared,
        ProjectState::Processing,
        ProjectState::Completed,
        ProjectState::Archived,
        ProjectState::Blocked,
    ] {
        assert!(!is_allowed(s, s), "identity edge {s:?} must be absent");
    }
}
