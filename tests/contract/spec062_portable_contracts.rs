// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

use std::collections::HashSet;

use contracts_core::sessions::heterogeneity::calibration::{
    AutomaticEligibility, CalibrationCandidateEvidence, CalibrationHandoffFrame, CalibrationKind,
    CalibrationListOperation, CalibrationQuery, HandoffOperationQueryRequest, IndexedReadableState,
};
use contracts_core::sessions::heterogeneity::inbox::{
    InboxListOperation, InboxQuery, OperationQueryRequest,
};
use contracts_core::sessions::heterogeneity::metadata::{
    MetadataEvidenceQueryRequest, MetadataListOperation, MetadataQuery,
};
use contracts_core::sessions::heterogeneity::projects::{
    ProjectListOperation, ProjectQuery, ProjectQueryRequest, RelatedSessionListRequest,
};
use contracts_core::sessions::heterogeneity::relations::{
    EvidenceTernary, ManualRelationCreateRequest, ManualRelationKind, ManualTargetScope,
    PanelListRequest, ParityEvidence, RelationEvidence, RelationListOperation, RelationQuery,
    SessionQueryRequest, TargetCompatibility, TraversalStartRequest,
};
use contracts_core::sessions::heterogeneity::settings::{
    CalibrationAgePolicy, DarkThermalThresholds, FixedMatchingRules, FlatAgeThresholds,
    FlatOrientationThresholds, GeometryThresholds, MatchingSettings, MatchingSettingsGetRequest,
    MatchingSettingsQuery, MosaicThresholds, SettingsSeverity,
};
use contracts_core::sessions::heterogeneity::shared::{
    BoundedList, CanonicalId, CanonicalRelativePath, CanonicalUuid, CommandFence, ContractRange,
    Cursor, EntityRef, ErrorCode, FiniteDecimal, IdempotencyOutcome, KeysetListOperation,
    MutationContext, NamedSafeValue, NonBlankSafeText, Page, PageBasis, PageRequest,
    PortableContractError, ProtectedResourceState, RevisionRef, Rfc3339Timestamp, SafeErrorDetails,
    SafeScalar, SafeText, SupportedFrameKind, MAX_CURSOR_BYTES, MAX_REQUEST_BYTES,
    MAX_RESPONSE_BYTES,
};
use schemars::schema_for;
use serde_json::{json, Value};

const ID: &str = "018f22b2-7f7f-7f7f-8f7f-7f7f7f7f7f7f";
const OTHER_ID: &str = "018f22b2-7f7f-7f7f-8f7f-7f7f7f7f7f80";
const DIGEST: &str = "sha256:0000000000000000000000000000000000000000000000000000000000000000";

fn id(value: &str) -> CanonicalId {
    CanonicalId::try_new(value).expect("fixture id is canonical")
}

fn uuid(value: &str) -> CanonicalUuid {
    CanonicalUuid::try_new(value).expect("fixture UUID is canonical")
}

fn safe(value: &str) -> SafeText {
    SafeText::try_new(value).expect("fixture text is safe")
}

fn non_blank(value: &str) -> NonBlankSafeText {
    NonBlankSafeText::try_new(value).expect("fixture text is non-blank")
}

fn decimal(value: f64) -> FiniteDecimal {
    FiniteDecimal::try_new(value).expect("fixture decimal is finite")
}

fn assert_registry<T, const N: usize>(operations: [T; N], names: &mut HashSet<&'static str>)
where
    T: Copy + KeysetListOperation,
{
    for operation in operations {
        assert!(names.insert(operation.query_name()), "duplicate query operation");
        let order = operation.unique_order();
        assert!(!order.is_empty(), "list operation must define a total order");
        assert!(
            order.last().is_some_and(|field| field.ends_with(" ASC") || field.ends_with(" DESC")),
            "the final keyset tie-breaker must be deterministic"
        );
    }
}

#[test]
fn snapshot_and_watermark_pages_round_trip_but_ambiguous_pages_are_rejected() {
    let page = Page::try_new(
        BoundedList::try_new(vec![safe("accepted")]).unwrap(),
        PageBasis::Snapshot { snapshot_id: id(ID) },
        Some(Cursor::try_new("next-page").unwrap()),
    )
    .unwrap();

    let encoded = serde_json::to_value(&page).unwrap();
    assert_eq!(encoded["snapshotId"], ID);
    assert!(encoded.get("watermark").is_none());
    assert_eq!(serde_json::from_value::<Page<SafeText>>(encoded).unwrap(), page);

    let ambiguous = json!({
        "items": [],
        "snapshotId": ID,
        "watermark": "42"
    });
    assert!(serde_json::from_value::<Page<SafeText>>(ambiguous).is_err());
    assert!(serde_json::from_value::<Page<SafeText>>(json!({ "items": [] })).is_err());

    let watermark = Page::<SafeText>::try_new(
        BoundedList::default(),
        PageBasis::Watermark { watermark: safe("43") },
        None,
    )
    .unwrap();
    assert_eq!(serde_json::to_value(watermark).unwrap()["watermark"], "43");
}

#[test]
fn portable_bounds_are_enforced_during_construction_and_decode() {
    assert!(BoundedList::<u8, 2>::try_new(vec![1, 2]).is_ok());
    assert!(BoundedList::<u8, 2>::try_new(vec![1, 2, 3]).is_err());
    assert!(serde_json::from_value::<BoundedList<u8, 2>>(json!([1, 2, 3])).is_err());
    assert!(PageRequest::try_new(None, 0).is_err());
    assert!(PageRequest::try_new(None, 501).is_err());
    assert_eq!(serde_json::from_value::<PageRequest>(json!({})).unwrap().limit, 100);
    assert!(serde_json::from_value::<PageRequest>(json!({ "limit": 501 })).is_err());
    assert!(Cursor::try_new("x".repeat(MAX_CURSOR_BYTES + 1)).is_err());
    assert!(SafeText::try_new("contains\ncontrol").is_err());
    assert!(CanonicalRelativePath::try_new("../outside.fit").is_err());
    assert!(CanonicalId::try_new("550e8400-e29b-41d4-a716-446655440000").is_err());
    assert!(CanonicalUuid::try_new("550e8400-e29b-41d4-a716-446655440000").is_ok());
    assert_eq!(MAX_REQUEST_BYTES, 1_048_576);
    assert_eq!(MAX_RESPONSE_BYTES, 4_194_304);
}

#[test]
fn runtime_bounds_and_defaults_are_present_in_json_schema() {
    let bounded = serde_json::to_value(schema_for!(BoundedList<u8, 2>)).unwrap();
    assert_eq!(bounded["maxItems"], 2);

    let page = serde_json::to_value(schema_for!(PageRequest)).unwrap();
    assert_eq!(page["properties"]["limit"]["default"], 100);
    assert_eq!(page["properties"]["limit"]["minimum"], 1);
    assert_eq!(page["properties"]["limit"]["maximum"], 500);
    assert!(!page["required"]
        .as_array()
        .is_some_and(|required| { required.iter().any(|field| field == "limit") }));

    let entity_id = serde_json::to_value(schema_for!(CanonicalId)).unwrap();
    assert!(entity_id["pattern"].as_str().unwrap().contains("-7"));
}

#[test]
fn every_reviewed_list_operation_has_a_unique_name_and_total_keyset_order() {
    let mut names = HashSet::new();
    assert_registry(InboxListOperation::ALL, &mut names);
    assert_registry(MetadataListOperation::ALL, &mut names);
    assert_registry(CalibrationListOperation::ALL, &mut names);
    assert_registry(RelationListOperation::ALL, &mut names);
    assert_registry(ProjectListOperation::ALL, &mut names);
    assert_eq!(names.len(), 65);
}

#[test]
fn published_total_order_tuples_use_exact_documented_paths() {
    assert_eq!(
        MetadataListOperation::PanelConsequenceLineage.unique_order(),
        &[
            "ordinal ASC",
            "lineage.predecessorPanelGroupId ASC",
            "lineage.successorPanelGroupId ASC",
        ]
    );
    assert_eq!(
        MetadataListOperation::ApplyPanelRevision.unique_order(),
        &["ordinal ASC", "revisionRef.revisionId ASC"]
    );
    for operation in [
        RelationListOperation::ProposalSourceRevision,
        RelationListOperation::ProposalSubject,
        RelationListOperation::ProposalMembership,
        RelationListOperation::ProposalEdge,
        RelationListOperation::ProposalLineage,
        RelationListOperation::DecisionRevision,
        RelationListOperation::DecisionRetiredGroup,
        RelationListOperation::DecisionSessionSupersession,
        RelationListOperation::DecisionGroupLineage,
        RelationListOperation::TraversalNode,
        RelationListOperation::TraversalEdge,
    ] {
        assert_eq!(operation.unique_order(), &["ordinal ASC"], "{}", operation.query_name());
    }
    assert_eq!(RelationListOperation::PanelHistory.unique_order(), &["revisionNumber DESC"]);
    assert_eq!(RelationListOperation::MosaicHistory.unique_order(), &["revisionNumber DESC"]);
    assert_eq!(ProjectListOperation::PlanOverlayMapping.unique_order(), &["ordinal ASC"]);
}

#[test]
fn six_surface_wire_operations_are_dotted_flat_and_operation_specific() {
    let samples = [
        serde_json::to_value(InboxQuery::Materialization(OperationQueryRequest {
            operation_id: id(ID),
        }))
        .unwrap(),
        serde_json::to_value(MetadataQuery::Evidence(MetadataEvidenceQueryRequest {
            session_id: id(ID),
            evidence_revision: Some(3),
        }))
        .unwrap(),
        serde_json::to_value(RelationQuery::Session(SessionQueryRequest { session_id: id(ID) }))
            .unwrap(),
        serde_json::to_value(ProjectQuery::ViewState(ProjectQueryRequest { project_id: id(ID) }))
            .unwrap(),
        serde_json::to_value(CalibrationQuery::HandoffOperation(HandoffOperationQueryRequest {
            operation_id: id(ID),
        }))
        .unwrap(),
        serde_json::to_value(MatchingSettingsQuery::Get(MatchingSettingsGetRequest {
            revision: Some(7),
        }))
        .unwrap(),
    ];
    let operations = [
        "session.materialization.query",
        "metadata.evidence.query",
        "session.query",
        "project.view_state.query",
        "calibration.handoff.operation.query",
        "matching_settings.get",
    ];
    for (sample, operation) in samples.iter().zip(operations) {
        assert_eq!(sample["operation"], operation);
        assert!(sample.get("payload").is_none());
    }
    assert_eq!(samples[1]["sessionId"], ID);
    assert_eq!(samples[1]["evidenceRevision"], 3);
    assert!(samples[1].get("entityId").is_none());
    assert_eq!(samples[2]["sessionId"], ID);
}

#[test]
fn unknown_calibration_evidence_is_explicitly_blocked() {
    let candidate: CalibrationCandidateEvidence = serde_json::from_value(json!({
        "evidenceId": ID,
        "sessionId": ID,
        "requirementId": ID,
        "recipeCompatibility": "unknown",
        "recipeEvidenceRef": "recipe-evidence",
        "recipeEvidenceComplete": true,
        "missingRecipeFields": [],
        "temperatureMode": "unknown",
        "age": {
            "basis": "elapsed_days",
            "state": "unknown",
            "freshThroughDays": 30,
            "redAfterDays": 365,
            "settingsRevision": 4
        },
        "thermal": {
            "state": "unknown",
            "missingReadingCount": 1,
            "invalidReadingCount": 0
        },
        "orientation": { "state": "not_applicable" },
        "sourceAvailability": {
            "indexedFrameCount": 4,
            "availableReadableIndexedFrameCount": 4,
            "checkedAt": "2026-07-22T00:00:00Z"
        },
        "sufficient": true,
        "automaticEligibility": "blocked",
        "warningCodes": ["calibration.temperature_unknown"],
        "basisFingerprint": DIGEST
    }))
    .unwrap();

    assert_eq!(candidate.automatic_eligibility, AutomaticEligibility::Blocked);
    assert!(candidate.derives_blocked_state());
}

#[test]
fn risky_but_valid_settings_produce_yellow_warnings() {
    let settings = MatchingSettings {
        revision: 8,
        same_session: GeometryThresholds {
            coverage_min_percent: decimal(92.0),
            center_separation_max_percent: decimal(2.0),
            rotation_max_deg: decimal(1.0),
        },
        sibling: GeometryThresholds {
            coverage_min_percent: decimal(84.0),
            center_separation_max_percent: decimal(5.0),
            rotation_max_deg: decimal(5.0),
        },
        mosaic: MosaicThresholds {
            overlap_min_percent: decimal(2.0),
            overlap_max_percent: decimal(30.0),
            residual_sky_rotation_cap_deg: decimal(90.0),
        },
        dark_thermal: DarkThermalThresholds {
            moderate_deg: decimal(0.5),
            severe_deg: decimal(2.0),
        },
        calibration_age: BoundedList::<CalibrationAgePolicy, 500>::default(),
        flat_orientation: FlatOrientationThresholds {
            normal_through_deg: decimal(2.0),
            red_above_deg: decimal(6.0),
        },
        flat_age: FlatAgeThresholds { red_after_nights: 100 },
        fixed_rules: FixedMatchingRules::default(),
        updated_at: Rfc3339Timestamp::try_new("2026-07-22T00:00:00Z").unwrap(),
        updated_by: id(ID),
    };

    let validation = settings.validate();
    assert!(validation.valid);
    assert!(!validation.issues.is_empty());
    assert!(validation.issues.iter().all(|issue| issue.severity == SettingsSeverity::Yellow));
}

#[test]
fn stale_errors_are_typed_and_detail_shapes_are_allowlisted_on_decode() {
    let stale = PortableContractError::try_new(
        ErrorCode::RelationProposalStale,
        safe("Proposal basis is stale."),
        Some(SafeErrorDetails::StaleRevisions {
            revisions: BoundedList::default(),
            total_count: 0,
            decision_snapshot_id: Some(id(ID)),
        }),
    )
    .unwrap();
    let encoded = serde_json::to_value(&stale).unwrap();
    assert_eq!(encoded["code"], "relation_proposal.stale");
    assert_eq!(serde_json::from_value::<PortableContractError>(encoded).unwrap(), stale);

    let invalid = json!({
        "code": "resource.unavailable",
        "message": "Resource unavailable.",
        "details": {
            "kind": "domain",
            "code": "secret",
            "values": []
        }
    });
    assert!(serde_json::from_value::<PortableContractError>(invalid).is_err());

    let wrong_field = PortableContractError::try_new(
        ErrorCode::SessionNotFound,
        safe("Session was not found."),
        Some(SafeErrorDetails::Domain {
            code: safe("session.not_found"),
            values: BoundedList::try_new(vec![NamedSafeValue {
                name: safe("secretPath"),
                value: SafeScalar::Text(safe("redacted")),
            }])
            .unwrap(),
            decision_snapshot_id: None,
        }),
    );
    assert!(wrong_field.is_err());
}

#[test]
fn protected_missing_and_unauthorized_resources_are_indistinguishable() {
    let missing = ProtectedResourceState::Missing.projected_error().unwrap();
    let unauthorized = ProtectedResourceState::Unauthorized.projected_error().unwrap();
    assert_eq!(missing, unauthorized);
    let encoded = serde_json::to_string(&missing).unwrap();
    assert_eq!(encoded, r#"{"code":"resource.unavailable","message":"Resource unavailable."}"#);
    assert!(!encoded.contains(ID));
}

#[test]
fn idempotency_and_fencing_have_explicit_portable_states() {
    let current = CommandFence { command_id: uuid(ID), lease_generation: 7 };
    let stale = CommandFence { command_id: uuid(ID), lease_generation: 6 };
    let other = CommandFence { command_id: uuid(OTHER_ID), lease_generation: 7 };
    assert!(current.is_current(&current));
    assert!(!stale.is_current(&current));
    assert!(!other.is_current(&current));

    let mismatch = IdempotencyOutcome::<SafeText>::PayloadMismatch;
    assert_eq!(serde_json::to_value(mismatch).unwrap()["state"], "payload_mismatch");
}

#[test]
fn manual_relation_request_discloses_missing_evidence_and_required_collections() {
    let entity = EntityRef { entity_type: safe("session"), entity_id: id(ID) };
    let request = ManualRelationCreateRequest {
        relation_kind: ManualRelationKind::PanelAdd,
        source_revision_refs: BoundedList::try_new(vec![RevisionRef {
            entity_type: safe("panel_group"),
            entity_id: id(ID),
            revision_id: id(OTHER_ID),
            revision_number: 3,
        }])
        .unwrap(),
        subject_refs: BoundedList::try_new(vec![entity.clone()]).unwrap(),
        proposed_membership_refs: Some(BoundedList::try_new(vec![entity]).unwrap()),
        proposed_edges: None,
        proposed_lineage: None,
        target_scope: ManualTargetScope::SameTarget { canonical_target_id: id(ID) },
        evidence: RelationEvidence {
            evidence_id: id(ID),
            target_compatibility: TargetCompatibility::SameTarget,
            footprint_coverage_percent: None,
            center_separation_percent: None,
            residual_sky_rotation_deg: None,
            allowed_residual_rotation_ranges_deg:
                BoundedList::<ContractRange<FiniteDecimal>, 16>::default(),
            parity: ParityEvidence::Unknown,
            acquisition_geometry: EvidenceTernary::Unknown,
            equipment: EvidenceTernary::Unknown,
            missing_evidence_codes: BoundedList::try_new(vec![safe("equipment.unknown")]).unwrap(),
            threshold_snapshot: BoundedList::default(),
        },
        review_reason: non_blank("Reviewed by operator"),
        mutation_context: MutationContext {
            command_id: uuid(OTHER_ID),
            reason: Some(safe("manual relation")),
            approval_digest: None,
        },
    };

    assert!(request.has_required_collections());
    let encoded = serde_json::to_value(&request).unwrap();
    assert_eq!(encoded["relationKind"], "panel_add");
    assert_eq!(encoded["evidence"]["missingEvidenceCodes"][0], "equipment.unknown");
    assert_eq!(
        serde_json::from_value::<ManualRelationCreateRequest>(encoded.clone()).unwrap(),
        request
    );

    let mut wrong_kind = encoded.clone();
    wrong_kind["relationKind"] = json!("mosaic_edge");
    assert!(serde_json::from_value::<ManualRelationCreateRequest>(wrong_kind).is_err());

    let mut duplicate_cross_target = encoded;
    duplicate_cross_target["targetScope"] = json!({
        "kind": "new_reviewed_cross_target",
        "canonicalTargetIds": [ID, ID],
        "purpose": "Reviewed association"
    });
    assert!(serde_json::from_value::<ManualRelationCreateRequest>(duplicate_cross_target).is_err());
}

#[test]
fn optional_defaults_and_relation_bounds_are_enforced_on_decode() {
    let panel: PanelListRequest = serde_json::from_value(json!({ "page": {} })).unwrap();
    assert!(panel.active_only);

    let related: RelatedSessionListRequest = serde_json::from_value(json!({
        "projectId": ID,
        "page": {}
    }))
    .unwrap();
    assert!(related.include_pinned);

    let traversal: TraversalStartRequest = serde_json::from_value(json!({
        "startRefs": [{ "entityType": "panel_group", "entityId": ID }],
        "graph": "panel_lineage",
        "direction": "both"
    }))
    .unwrap();
    assert_eq!(traversal.limits.max_depth, 64);
    assert_eq!(traversal.limits.max_nodes, 10_000);
    assert_eq!(traversal.limits.max_edges, 50_000);
    assert!(serde_json::from_value::<TraversalStartRequest>(json!({
        "startRefs": [{ "entityType": "panel_group", "entityId": ID }],
        "graph": "panel_lineage",
        "direction": "both",
        "limits": { "maxDepth": 0, "maxNodes": 1, "maxEdges": 1 }
    }))
    .is_err());

    let mut fixed = serde_json::to_value(FixedMatchingRules::default()).unwrap();
    fixed["opticalProfileSameMaxPercent"] = json!(6);
    assert!(serde_json::from_value::<FixedMatchingRules>(fixed).is_err());
}

#[test]
fn dark_flat_is_not_a_supported_frame_or_calibration_kind() {
    assert!(serde_json::from_str::<CalibrationKind>(r#""dark_flat""#).is_err());
    assert!(serde_json::from_str::<SupportedFrameKind>(r#""dark_flat""#).is_err());

    let calibration_schema = serde_json::to_string(&schema_for!(CalibrationKind)).unwrap();
    let frame_schema = serde_json::to_string(&schema_for!(SupportedFrameKind)).unwrap();
    assert!(!calibration_schema.contains("dark_flat"));
    assert!(!frame_schema.contains("dark_flat"));
}

#[test]
fn redacted_calibration_sources_omit_paths_and_fingerprints() {
    let redacted = CalibrationHandoffFrame::Redacted {
        selection_id: id(ID),
        session_id: id(ID),
        session_membership_ordinal: 1,
        frame_id: id(OTHER_ID),
        source_state: IndexedReadableState::IndexedReadable,
    };
    let encoded = serde_json::to_value(redacted).unwrap();
    assert_eq!(encoded["visibility"], "redacted");
    for forbidden in
        ["sourceRootId", "sourceRelativePath", "stableFileIdentity", "strongContentFingerprint"]
    {
        assert!(encoded.get(forbidden).is_none());
    }
}

#[test]
fn portable_error_and_contract_schema_roots_are_serializable() {
    let schema: Value = serde_json::to_value(schema_for!(PortableContractError)).unwrap();
    assert!(schema.get("$schema").is_some());
}
