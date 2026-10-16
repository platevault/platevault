// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Durable session review completion (spec 064 LIB-FR-17/20/23/24, 067
//! PIX-FR-18; D-W78, D-W97, D-W100).

#![cfg(unix)]

#[path = "support/project_state.rs"]
mod project_state_support;
mod support;

use persistence_library::SessionQuery;
use platevault_model::{ExpectedAsset, Quality, SessionReadiness};
use project_state_support::world;
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection};
use sqlx::Connection;
use support::{expected, scan, DiskProbe};

#[tokio::test]
async fn finish_reopen_and_regroup_are_bound_to_current_intake_state() {
    let world = world().await;
    let catalog = &world.catalog;
    let session = world.session().await;
    let admission = catalog.session_admission(session.id).await.unwrap();
    assert_eq!(admission.intake.readiness(), SessionReadiness::NeedsReview);
    assert_eq!(admission.intake.unreviewed_frames, 2);

    let detail = catalog.session(session.id).await.unwrap();
    let assets: Vec<ExpectedAsset> = detail.assets.iter().map(expected).collect();
    catalog.set_quality(&assets, Quality::Usable, DiskProbe).await.unwrap();
    let stale =
        catalog.finish_session_review(session.id, session.grouping_revision + 1).await.unwrap_err();
    assert!(matches!(stale, platevault_model::LibraryError::Conflict { .. }), "{stale:?}");
    let admission = catalog.session_admission(session.id).await.unwrap();
    assert_eq!(admission.intake.readiness(), SessionReadiness::NeedsReview);
    assert_eq!(admission.intake.unreviewed_frames, 0);

    assert_eq!(
        catalog.finish_session_review(session.id, session.grouping_revision).await.unwrap(),
        session.grouping_revision
    );
    assert_eq!(
        catalog.session_admission(session.id).await.unwrap().intake.readiness(),
        SessionReadiness::Ready
    );

    let project = world.project("Review remains library-owned", Vec::new()).await;
    let project_before = catalog.project(project.id).await.unwrap();
    catalog.reopen_session_review(session.id).await.unwrap();
    let project_after = catalog.project(project.id).await.unwrap();
    assert_eq!(project_after.revision, project_before.revision, "reopen writes no Project state");
    assert_eq!(
        catalog.session_admission(session.id).await.unwrap().intake.readiness(),
        SessionReadiness::NeedsReview
    );
    let not_ready = catalog.reopen_session_review(session.id).await.unwrap_err();
    assert!(matches!(not_ready, platevault_model::LibraryError::InvalidInput(_)), "{not_ready:?}");

    catalog.finish_session_review(session.id, session.grouping_revision).await.unwrap();
    let mut raw =
        SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&world.fx.db))
            .await
            .unwrap();
    let recorded: i64 =
        sqlx::query_scalar("SELECT grouping_revision FROM session_reviews WHERE session_id = ?1")
            .bind(session.id.to_string())
            .fetch_one(&mut raw)
            .await
            .unwrap();
    assert_eq!(recorded, i64::try_from(session.grouping_revision).unwrap());

    world.fx.write("Ha_003.fits", b"frame Ha_003.fits");
    scan(catalog, &world.fx, &world.location, &["Ha_001.fits", "Ha_002.fits", "Ha_003.fits"]).await;
    let current = catalog.session(session.id).await.unwrap().summary.session;
    assert!(current.grouping_revision > session.grouping_revision);
    let intake = catalog.session_admission(session.id).await.unwrap().intake;
    assert!(!intake.review_finished, "the previous grouping revision no longer counts");
    assert_eq!(intake.readiness(), SessionReadiness::NeedsReview);
    let stale =
        catalog.finish_session_review(session.id, session.grouping_revision).await.unwrap_err();
    assert!(matches!(stale, platevault_model::LibraryError::Conflict { .. }), "{stale:?}");

    let detail = catalog.session(session.id).await.unwrap();
    let added: Vec<ExpectedAsset> = detail
        .assets
        .iter()
        .filter(|asset| asset.relative_path.display().ends_with("Ha_003.fits"))
        .map(expected)
        .collect();
    catalog.set_quality(&added, Quality::Usable, DiskProbe).await.unwrap();
    catalog.finish_session_review(session.id, current.grouping_revision).await.unwrap();
    assert_eq!(
        catalog.session_admission(session.id).await.unwrap().intake.readiness(),
        SessionReadiness::Ready
    );

    let sessions = catalog.list_sessions(&SessionQuery::default()).await.unwrap();
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].session.id, session.id);
}
