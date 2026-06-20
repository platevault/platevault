//! Spec 029 target stubs exposed to the Tauri webview.
//!
//! Stub implementations returning hardcoded fixture data matching the mock
//! layer until the real persistence layer is wired.

use std::collections::HashMap;

use contracts_core::lifecycle::ProjectState;
use contracts_core::sessions::{
    AcquisitionSession, ConfidenceLevel, MetaValue, ProvenanceOrigin, SessionKey, SessionState,
};
use contracts_core::targets::{
    CatalogIds, Coordinates, Target, TargetDetail, TargetKind, TargetProjectStub,
};
use contracts_core::ContractError;
use contracts_core::JsonAny;

/// `targets.list` — returns all targets, optionally filtered by search.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta]
pub async fn targets_list(search: Option<String>) -> Result<Vec<Target>, ContractError> {
    tracing::debug!("stub: targets.list search={search:?}");
    let targets = stub_targets();
    if let Some(q) = search {
        let q = q.to_lowercase();
        Ok(targets.into_iter().filter(|t| t.name.to_lowercase().contains(&q)).collect())
    } else {
        Ok(targets)
    }
}

/// `targets.get` — returns a single target detail.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta]
pub async fn targets_get(id: String) -> Result<TargetDetail, ContractError> {
    tracing::debug!("stub: targets.get id={id}");
    let base = stub_targets()
        .into_iter()
        .next()
        .ok_or_else(|| ContractError::internal("no stub target available"))?;
    Ok(TargetDetail {
        id: id.clone(),
        name: base.name,
        aliases: base.aliases,
        catalog_ids: base.catalog_ids,
        kind: base.kind,
        coordinates: base.coordinates,
        session_count: base.session_count,
        project_count: base.project_count,
        total_integration_hours: base.total_integration_hours,
        coverage: base.coverage,
        recommended_hours: base.recommended_hours,
        sessions: vec![AcquisitionSession {
            id: "550e8400-e29b-41d4-a716-446655440001".to_owned(),
            session_key: SessionKey {
                target: "NGC 7000".to_owned(),
                filter: "Ha".to_owned(),
                binning: "1".to_owned(),
                gain: "100".to_owned(),
                night: "2026-04-12".to_owned(),
            },
            state: SessionState::Discovered,
            confidence: ConfidenceLevel::Medium,
            optical_train_id: "550e8400-e29b-41d4-a716-446655440101".to_owned(),
            frame_count: 18,
            total_integration_seconds: 10800.0,
            total_size_bytes: 1_258_291_200,
            metadata: HashMap::from([(
                "target".to_owned(),
                MetaValue {
                    value: JsonAny::from(serde_json::json!("NGC 7000")),
                    raw: Some("NGC7000".to_owned()),
                    origin: ProvenanceOrigin::Observed,
                    confidence: ConfidenceLevel::Medium,
                    evidence_ref: None,
                },
            )]),
            target_ids: vec![id.clone()],
            project_ids: vec![],
            warnings: vec![],
        }],
        projects: vec![
            TargetProjectStub {
                id: "proj-001".to_owned(),
                name: "NGC 7000 Narrowband".to_owned(),
                state: ProjectState::Processing,
            },
            TargetProjectStub {
                id: "proj-002".to_owned(),
                name: "NGC 7000 LRGB".to_owned(),
                state: ProjectState::Ready,
            },
        ],
    })
}

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

fn stub_targets() -> Vec<Target> {
    vec![
        Target {
            id: "550e8400-e29b-41d4-a716-446655440201".to_owned(),
            name: "NGC 7000".to_owned(),
            aliases: vec!["North America Nebula".to_owned(), "Caldwell 20".to_owned()],
            catalog_ids: CatalogIds { ngc: Some("7000".to_owned()), ic: None, messier: None },
            kind: TargetKind::DeepSky,
            coordinates: Some(Coordinates { ra: Some(314.68), dec: Some(44.31) }),
            session_count: 5,
            project_count: 2,
            total_integration_hours: 12.5,
            coverage: HashMap::from([
                ("Ha".to_owned(), 6.0),
                ("OIII".to_owned(), 4.5),
                ("SII".to_owned(), 2.0),
            ]),
            recommended_hours: HashMap::from([
                ("Ha".to_owned(), 10.0),
                ("OIII".to_owned(), 8.0),
                ("SII".to_owned(), 8.0),
            ]),
        },
        Target {
            id: "550e8400-e29b-41d4-a716-446655440202".to_owned(),
            name: "M31".to_owned(),
            aliases: vec!["Andromeda Galaxy".to_owned()],
            catalog_ids: CatalogIds {
                ngc: Some("224".to_owned()),
                ic: None,
                messier: Some("31".to_owned()),
            },
            kind: TargetKind::DeepSky,
            coordinates: Some(Coordinates { ra: Some(10.68), dec: Some(41.27) }),
            session_count: 3,
            project_count: 1,
            total_integration_hours: 8.0,
            coverage: HashMap::from([
                ("L".to_owned(), 4.0),
                ("R".to_owned(), 1.5),
                ("G".to_owned(), 1.5),
                ("B".to_owned(), 1.0),
            ]),
            recommended_hours: HashMap::from([
                ("L".to_owned(), 10.0),
                ("R".to_owned(), 4.0),
                ("G".to_owned(), 4.0),
                ("B".to_owned(), 4.0),
            ]),
        },
        Target {
            id: "550e8400-e29b-41d4-a716-446655440203".to_owned(),
            name: "IC 1396".to_owned(),
            aliases: vec!["Elephant Trunk Nebula".to_owned()],
            catalog_ids: CatalogIds { ngc: None, ic: Some("1396".to_owned()), messier: None },
            kind: TargetKind::DeepSky,
            coordinates: Some(Coordinates { ra: Some(324.75), dec: Some(57.49) }),
            session_count: 1,
            project_count: 0,
            total_integration_hours: 2.0,
            coverage: HashMap::from([("SII".to_owned(), 2.0)]),
            recommended_hours: HashMap::from([
                ("Ha".to_owned(), 10.0),
                ("OIII".to_owned(), 8.0),
                ("SII".to_owned(), 8.0),
            ]),
        },
    ]
}
