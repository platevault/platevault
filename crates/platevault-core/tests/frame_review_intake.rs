// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Session-intake Finish/reopen Review entry points (spec 064 LIB-FR-17/20/23/24,
//! 067 PIX-FR-18; D-W78, D-W97, D-W100).

#![cfg(unix)]

use std::sync::Arc;

use persistence_library::SessionQuery;
use platevault_core::frame_review::FrameReview;
use platevault_core::library::Library;
use platevault_core::*;
use uuid::Uuid;

mod support;

fn rig() -> Equipment {
    Equipment {
        id: Uuid::new_v4(),
        name: "RedCat".into(),
        camera: Some("ASI2600MM".into()),
        telescope: Some("RedCat".into()),
        focal_length_mm: Some(250.0),
        pixel_size_um: None,
        sensor_width_px: None,
        sensor_height_px: None,
        color_kind: None,
        decision_revision: 0,
        state: AssociationState::Confirmed,
        provenance: Provenance::User,
    }
}

fn target() -> TargetCandidate {
    TargetCandidate {
        id: Uuid::new_v4(),
        designation: "NGC 7000".into(),
        aliases: Vec::new(),
        common_name: None,
        object_type: "nebula".into(),
        coordinates: None,
        provenance: Provenance::User,
        provider_id: None,
        angular_size: None,
        catalogues: Vec::new(),
    }
}

async fn terminal(library: &Arc<Library>, id: Uuid) {
    tokio::time::timeout(std::time::Duration::from_secs(20), async {
        loop {
            let scan = library.catalog().scan_status(id).await.unwrap();
            if scan.state != ScanState::Running {
                assert_eq!(scan.state, ScanState::Completed, "{scan:?}");
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
}

struct World {
    _temp: tempfile::TempDir,
    library: Arc<Library>,
    session: Uuid,
    project: Uuid,
}
fn expected_session(session: &Session) -> ExpectedSession {
    ExpectedSession {
        session_id: session.id,
        grouping_revision: session.grouping_revision,
        decision_revision: session.decision_revision,
    }
}

impl World {
    async fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("Captures");
        std::fs::create_dir_all(&root).unwrap();
        support::fits(
            &root.join("Ha_001.fits"),
            &[
                ("IMAGETYP", "'LIGHT'"),
                ("INSTRUME", "'ASI2600MM'"),
                ("TELESCOP", "'RedCat'"),
                ("OBJECT", "'NGC 7000'"),
                ("FILTER", "'Ha'"),
                ("EXPTIME", "300"),
                ("DATE-OBS", "'2026-09-12T22:00:00'"),
            ],
        )
        .unwrap();
        let library = Library::open(&temp.path().join("library.sqlite"), None).await.unwrap();
        let location = library
            .register_location(
                NativePath::from_path(&root),
                "Captures".into(),
                LocationRole::Captures,
            )
            .await
            .unwrap();
        terminal(&library, library.start_scan(location.id, None).await.unwrap().id).await;
        let catalog = library.catalog();
        let session =
            catalog.list_sessions(&SessionQuery::default()).await.unwrap().remove(0).session;
        let target = catalog.save_target(&target(), None).await.unwrap().candidate.id;
        catalog.associate_target(&[expected_session(&session)], target).await.unwrap();
        let session = catalog.session(session.id).await.unwrap().summary.session;
        let rig = catalog.save_equipment(&rig(), None).await.unwrap();
        catalog.confirm_equipment(&[expected_session(&session)], rig.id).await.unwrap();
        let project = catalog
            .create_project(&ProjectInput {
                name: "Session review intake".into(),
                notes: None,
                subjects: vec![SubjectInput {
                    target_id: target,
                    name: None,
                    mosaic: false,
                    panels: Vec::new(),
                }],
                rig_ids: vec![rig.id],
                goals: Vec::new(),
            })
            .await
            .unwrap();
        Self { _temp: temp, library, session: session.id, project: project.id }
    }

    fn catalog(&self) -> &persistence_library::Catalog {
        self.library.catalog()
    }
    fn review(&self) -> &FrameReview {
        self.library.frame_review()
    }
}

#[tokio::test]
async fn session_intake_marks_finish_and_reopen_use_durable_quality_not_run_drafts() {
    let world = World::new().await;
    let session = world.catalog().session(world.session).await.unwrap().summary.session;
    let refused =
        world.review().finish_review(world.session, session.grouping_revision).await.unwrap_err();
    assert!(matches!(refused, LibraryError::InvalidInput(_)), "{refused:?}");
    assert_eq!(
        world.catalog().session_admission(world.session).await.unwrap().intake.readiness(),
        SessionReadiness::NeedsReview
    );

    let list = world
        .review()
        .session_review_list(
            world.session,
            ReviewFilter::All,
            &ReviewSort::default(),
            &NameTemplate::FileName,
        )
        .await
        .unwrap();
    let listed = &list.frames[0];
    let marked = world
        .review()
        .session_review_mark(
            world.session,
            &ReviewMark::Library {
                asset: ExpectedAsset {
                    asset_id: listed.asset.id,
                    decision_revision: listed.asset.decision_revision,
                    fingerprint: listed.asset.fingerprint.clone(),
                },
                quality: Quality::Usable,
            },
        )
        .await
        .unwrap();
    assert!(
        marked.member.is_none(),
        "session intake quality mark must not edit a legacy run draft"
    );
    assert!(marked.draft_revision.is_none());
    assert_eq!(
        world.review().session_intake(world.session).await.unwrap().intake.unreviewed_frames,
        0
    );
    assert_eq!(
        world.review().session_intake(world.session).await.unwrap().intake.readiness(),
        SessionReadiness::NeedsReview
    );

    world.review().finish_review(world.session, session.grouping_revision).await.unwrap();
    assert_eq!(
        world.catalog().session_admission(world.session).await.unwrap().intake.readiness(),
        SessionReadiness::Ready
    );
    let before = world.catalog().project(world.project).await.unwrap();
    world.review().reopen_review(world.session).await.unwrap();
    let after = world.catalog().project(world.project).await.unwrap();
    assert_eq!(after.revision, before.revision, "reopen only deletes session_reviews");
    assert_eq!(
        world.catalog().session_admission(world.session).await.unwrap().intake.readiness(),
        SessionReadiness::NeedsReview
    );
    assert!(matches!(
        world.review().reopen_review(world.session).await,
        Err(LibraryError::InvalidInput(_))
    ));
}

#[tokio::test]
async fn session_review_finish_reopens_without_project_state() {
    let world = World::new().await;
    let session = world.catalog().session(world.session).await.unwrap().summary.session;
    let list = world
        .review()
        .session_review_list(
            world.session,
            ReviewFilter::All,
            &ReviewSort::default(),
            &NameTemplate::FileName,
        )
        .await
        .unwrap();
    let frame = &list.frames[0];
    let frame_id = frame.asset.id;
    let before = world.catalog().project(world.project).await.unwrap();
    world
        .review()
        .session_review_mark(
            world.session,
            &ReviewMark::Library {
                asset: ExpectedAsset {
                    asset_id: frame.asset.id,
                    decision_revision: frame.asset.decision_revision,
                    fingerprint: frame.asset.fingerprint.clone(),
                },
                quality: Quality::Unusable,
            },
        )
        .await
        .unwrap();
    assert_eq!(world.catalog().asset(frame_id).await.unwrap().quality, Quality::Unusable);
    assert_eq!(world.catalog().project(world.project).await.unwrap().revision, before.revision);
    world.review().finish_review(world.session, session.grouping_revision).await.unwrap();
    assert_eq!(
        world.review().session_intake(world.session).await.unwrap().intake.readiness(),
        SessionReadiness::Ready
    );
}
