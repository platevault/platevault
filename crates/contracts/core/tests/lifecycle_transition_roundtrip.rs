//! Regression tests for issue #423: `TransitionRequest` must accept the
//! canonical flat discriminated envelope from the source-of-truth contract
//! (`packages/contracts/src/generated/lifecycle.transition.d.ts`) and must
//! round-trip its own serialization.
//!
//! A previously duplicated `entity_type` field inside each variant struct
//! collided with the enum's `#[serde(tag = "entityType")]` (serde consumes the
//! tag during variant dispatch), which made `lifecycle.transition.apply` /
//! `.preview` uncallable by any client: single-tag payloads failed with
//! `missing field entityType`, and Rust-serialized output emitted the key
//! twice and failed with `duplicate field entityType`.

use contracts_core::lifecycle::{
    ProjectState, ProjectTransitionRequest, TransitionActor, TransitionRequest,
};
use uuid::Uuid;

/// The canonical flat wire shape (single `entityType` discriminator) must
/// deserialize. This is exactly what the spec-037 Layer-2 E2E journey
/// `lifecycle_integrity` sends.
#[test]
fn canonical_flat_envelope_deserializes() {
    let json = serde_json::json!({
        "entityType": "project",
        "contractVersion": "2.0.0",
        "requestId": "e2e00000-0000-4000-8000-000000000001",
        "entityId": "e2e00000-0000-4000-8000-000000000002",
        "currentState": "setup_incomplete",
        "nextState": "ready",
        "actionLabel": null,
        "actor": "user",
    });

    let req: TransitionRequest =
        serde_json::from_value(json).expect("canonical flat envelope must deserialize");
    let TransitionRequest::Project(project) = req else {
        panic!("expected the Project variant");
    };
    assert_eq!(project.current_state, ProjectState::SetupIncomplete);
    assert_eq!(project.next_state, ProjectState::Ready);
    assert_eq!(project.actor, TransitionActor::User);
}

/// Serialization must emit `entityType` exactly once and deserialize back to
/// the same value (the #423 failure mode emitted it twice).
#[test]
fn serialization_round_trips() {
    let req = TransitionRequest::Project(ProjectTransitionRequest::new(
        Uuid::new_v4(),
        Uuid::new_v4(),
        ProjectState::SetupIncomplete,
        ProjectState::Ready,
        TransitionActor::User,
    ));

    let json = serde_json::to_string(&req).expect("serialize");
    assert_eq!(
        json.matches("\"entityType\"").count(),
        1,
        "entityType must appear exactly once on the wire: {json}"
    );

    let back: TransitionRequest =
        serde_json::from_str(&json).expect("own serialization must round-trip");
    assert_eq!(back, req);
}
