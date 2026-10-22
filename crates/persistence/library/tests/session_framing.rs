// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Session framing in the catalog (spec 064 LIB-FR-04/24; D-W107): the
//! workflow settings intake reads its framing margins from, the framing each
//! session records, kept through a regroup that renumbers it, refused when it
//! is anchored outside its session, and the framing label a merge records as
//! a reviewed correction, which moves the merged frames under one anchor.
#![cfg(unix)]

mod support;

use std::collections::BTreeMap;

use persistence_library::{Catalog, SessionQuery, SourceProbe};
use platevault_model::{
    Asset, CaptureKey, CorrectionInput, GroupingResult, LibraryError, Location, ScanBatch,
    ScanObservation, ScanProgress, ScanState, Session, SessionCandidate, SessionFraming,
    SplitLimits, WorkflowSettings, FRAMING_LABEL_FIELD,
};
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection};
use sqlx::Connection;
use support::*;
use uuid::Uuid;

/// A framing per file-name prefix (`A…`, `B…`), or per framing label when
/// the frame has one; anchored at the first file name, numbered from
/// `first_ordinal` in anchor order.
fn by_prefix(assets: &[Asset], first_ordinal: u32) -> GroupingResult {
    let mut framings: BTreeMap<String, Vec<&Asset>> = BTreeMap::new();
    for asset in assets {
        let name = asset.relative_path.display();
        let part = asset.effective.framing_label.clone().unwrap_or_else(|| name[..1].to_owned());
        framings.entry(part).or_default().push(asset);
    }
    let mut anchored: Vec<(String, Vec<&Asset>)> = framings
        .into_values()
        .map(|mut members| {
            members.sort_by_key(|asset| asset.relative_path.display());
            (members[0].relative_path.display(), members)
        })
        .collect();
    anchored.sort_by(|left, right| left.0.cmp(&right.0));
    GroupingResult {
        sessions: anchored
            .into_iter()
            .zip(first_ordinal..)
            .map(|((_, members), ordinal)| {
                let mut asset_ids: Vec<Uuid> = members.iter().map(|asset| asset.id).collect();
                asset_ids.sort_unstable();
                SessionCandidate {
                    key: CaptureKey("capture-v1|type=light|night=2026-09-12@date-loc-noon".into()),
                    asset_ids,
                    provisional: Vec::new(),
                    date_basis: Some("date-loc-noon".into()),
                    framing: Some(SessionFraming {
                        ordinal,
                        anchor_asset_id: members[0].id,
                        ra_deg: 314.68,
                        dec_deg: 44.31,
                        rotator_deg: Some(12.4),
                        sky_angle_deg: None,
                        field: None,
                        label: members[0].effective.framing_label.clone(),
                        split_limits: SplitLimits::default(),
                    }),
                }
            })
            .collect(),
    }
}

async fn scan_grouped<G>(
    catalog: &Catalog,
    fx: &Fixture,
    location: &Location,
    files: &[&str],
    grouping: G,
) where
    G: FnMut(&[Asset]) -> GroupingResult + Copy,
{
    let operation = catalog.begin_scan(location.id, None).await.unwrap();
    let files: Vec<_> = files.iter().map(|relative| fx.scan_file(relative)).collect();
    let root = DiskProbe.root_identity(location).unwrap();
    let progress = ScanProgress {
        discovered: files.len() as u64,
        metadata_read: files.len() as u64,
        ..ScanProgress::default()
    };
    let batch = ScanBatch { files: files.clone(), issues: Vec::new(), progress: progress.clone() };
    catalog.apply_scan_batch(operation.id, &root, &batch, grouping).await.unwrap();
    let observation = ScanObservation {
        location_id: location.id,
        root_identity: root,
        incomplete_scopes: Vec::new(),
        files,
        issues: Vec::new(),
        complete_scopes: vec![root_scope()],
        progress,
        state: ScanState::Completed,
    };
    catalog
        .finish_scan(
            operation.id,
            &observation,
            |location| DiskProbe.root_identity(location),
            grouping,
        )
        .await
        .unwrap();
}

async fn sessions(catalog: &Catalog) -> Vec<Session> {
    let mut sessions: Vec<Session> = catalog
        .list_sessions(&SessionQuery::default())
        .await
        .unwrap()
        .into_iter()
        .map(|summary| summary.session)
        .collect();
    sessions.sort_by_key(|session| session.framing.as_ref().map(|framing| framing.ordinal));
    sessions
}

#[tokio::test]
async fn intake_reads_the_recorded_workflow_settings_else_the_defaults() {
    let fx = Fixture::new();
    let catalog = Catalog::open(&fx.db).await.unwrap();
    assert_eq!(catalog.workflow_settings().await.unwrap(), (WorkflowSettings::default(), 0));

    let mut wide = WorkflowSettings::default();
    wide.framing.split.max_centre_offset_arcmin = 15.0;
    let mut raw = SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&fx.db))
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO workflow_settings (id, settings, revision, updated_at) \
         VALUES (1, ?1, 3, '2026-10-16T09:00:00Z')",
    )
    .bind(serde_json::to_string(&wide).unwrap())
    .execute(&mut raw)
    .await
    .unwrap();
    assert_eq!(catalog.workflow_settings().await.unwrap(), (wide.clone(), 3));

    let mut invalid = wide;
    invalid.framing.split.max_rotation_deg = 400.0;
    sqlx::query("UPDATE workflow_settings SET settings = ?1, revision = 4 WHERE id = 1")
        .bind(serde_json::to_string(&invalid).unwrap())
        .execute(&mut raw)
        .await
        .unwrap();
    let refused = catalog.workflow_settings().await.unwrap_err();
    assert!(matches!(refused, LibraryError::PersistenceFailure(_)), "{refused:?}");
}

#[tokio::test]
async fn a_session_keeps_its_id_and_framing_when_an_earlier_framing_renumbers_it() {
    let fx = Fixture::new();
    for name in ["B_001.fits", "B_002.fits", "B_003.fits", "A_001.fits"] {
        fx.write(name, format!("SIMPLE = T / {name}").as_bytes());
    }
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();

    scan_grouped(&catalog, &fx, &location, &["B_001.fits", "B_002.fits"], |assets: &[Asset]| {
        by_prefix(assets, 1)
    })
    .await;
    let first = sessions(&catalog).await;
    assert_eq!(first.len(), 1);
    let framing = first[0].framing.clone().expect("the framing is recorded");
    assert_eq!(framing.ordinal, 1);

    // A joining frame keeps the session; an earlier framing renumbers it.
    scan_grouped(
        &catalog,
        &fx,
        &location,
        &["B_001.fits", "B_002.fits", "B_003.fits", "A_001.fits"],
        |assets: &[Asset]| by_prefix(assets, 1),
    )
    .await;
    let after = sessions(&catalog).await;
    assert_eq!(after.len(), 2);
    let kept = after.iter().find(|session| session.id == first[0].id).expect("the id is kept");
    assert_eq!(kept.asset_ids.len(), 3);
    let renumbered = kept.framing.as_ref().unwrap();
    assert_eq!((renumbered.ordinal, renumbered.anchor_asset_id), (2, framing.anchor_asset_id));
}

#[tokio::test]
async fn a_framing_anchored_outside_its_session_is_refused() {
    let fx = Fixture::new();
    fx.write("A_001.fits", b"SIMPLE = T / A");
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    let operation = catalog.begin_scan(location.id, None).await.unwrap();
    let batch = ScanBatch { files: vec![fx.scan_file("A_001.fits")], ..ScanBatch::default() };
    let root = DiskProbe.root_identity(&location).unwrap();

    let refused = catalog
        .apply_scan_batch(operation.id, &root, &batch, |assets: &[Asset]| {
            let mut result = by_prefix(assets, 1);
            result.sessions[0].framing.as_mut().unwrap().anchor_asset_id = Uuid::new_v4();
            result
        })
        .await
        .unwrap_err();

    assert!(matches!(refused, LibraryError::InvalidInput(_)), "{refused:?}");
    assert!(sessions(&catalog).await.is_empty(), "nothing is written");
}

#[tokio::test]
async fn a_framing_label_correction_merges_and_moves_the_frames_it_reanchors() {
    let fx = Fixture::new();
    let names = ["A_001.fits", "A_002.fits", "B_001.fits", "B_002.fits"];
    for name in names {
        fx.write(name, format!("SIMPLE = T / {name}").as_bytes());
    }
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    let grouping = |assets: &[Asset]| by_prefix(assets, 1);
    scan_grouped(&catalog, &fx, &location, &names, grouping).await;
    let split = sessions(&catalog).await;
    assert_eq!(split.len(), 2);

    let assets = catalog.location_assets(location.id).await.unwrap();
    let expectations: Vec<_> = assets.iter().map(expected).collect();
    let corrections: Vec<CorrectionInput> = assets
        .iter()
        .map(|asset| CorrectionInput {
            asset_id: asset.id,
            field: FRAMING_LABEL_FIELD.into(),
            value: serde_json::json!("merged"),
        })
        .collect();
    let preview = catalog.preview_correction(&expectations, &corrections, grouping).await.unwrap();
    let outcome = catalog.confirm_correction(preview.id, &expectations, grouping).await.unwrap();

    let merged = sessions(&catalog).await;
    assert_eq!(merged.len(), 1);
    let framing = merged[0].framing.as_ref().unwrap();
    assert_eq!(framing.label.as_deref(), Some("merged"));
    assert_eq!(framing.anchor_asset_id, by_name(&assets, "A_001.fits").id);
    let lineage = outcome.lineage.expect("both framings are succeeded");
    let mut predecessors = lineage.predecessors.clone();
    predecessors.sort_unstable();
    let mut was: Vec<Uuid> = split.iter().map(|session| session.id).collect();
    was.sort_unstable();
    assert_eq!(predecessors, was);
    let mut moved_names: Vec<String> = lineage
        .moved_assets
        .iter()
        .map(|id| assets.iter().find(|asset| asset.id == *id).unwrap().relative_path.display())
        .collect();
    moved_names.sort();
    assert_eq!(moved_names, ["B_001.fits", "B_002.fits"], "only the re-anchored frames moved");
    let corrected = catalog.asset(by_name(&assets, "B_001.fits").id).await.unwrap();
    assert_eq!(corrected.effective.framing_label.as_deref(), Some("merged"));
    assert_eq!(corrected.observed.framing_label, None, "no header holds a framing label");
}
