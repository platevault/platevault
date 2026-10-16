// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Hold sessions in a Project through the composed library, as the user does
//! once review and calibration let a session join (spec 065 PRJ-FR-08,
//! LIB-FR-23): its Unreviewed frames marked Usable, its review finished at
//! its grouping revision and every calibration kind answered No, then Add to
//! Project. Included with `#[path = "support/membership.rs"] mod
//! membership_support;`.
#![allow(dead_code)]

use platevault_core::library::{InventoryProbe, Library};
use platevault_core::projects::SessionToAdd;
use platevault_core::{ExpectedAsset, InputKind, ProjectDesired, Quality};
use uuid::Uuid;

/// Mark `session`'s Unreviewed frames Usable (marks already made stay) and
/// finish its review: it is Ready, so a matching Project suggests it.
pub async fn review(library: &Library, session: Uuid) {
    let catalog = library.catalog();
    let detail = catalog.session(session).await.unwrap();
    let unreviewed: Vec<ExpectedAsset> = detail
        .assets
        .iter()
        .filter(|asset| asset.quality == Quality::Unreviewed)
        .map(|asset| ExpectedAsset {
            asset_id: asset.id,
            decision_revision: asset.decision_revision,
            fingerprint: asset.fingerprint.clone(),
        })
        .collect();
    if !unreviewed.is_empty() {
        catalog.set_quality(&unreviewed, Quality::Usable, InventoryProbe::default()).await.unwrap();
    }
    let grouping = catalog.session(session).await.unwrap().summary.session.grouping_revision;
    catalog.finish_session_review(session, grouping).await.unwrap();
}

/// [`review`] `session` and say No to each calibration kind: it is Ready
/// and settled, so it can join.
pub async fn admit(library: &Library, session: Uuid) {
    review(library, session).await;
    let catalog = library.catalog();
    for kind in [InputKind::Bias, InputKind::Dark, InputKind::Flat] {
        let generation = catalog.session_admission(session).await.unwrap().calibration.generation;
        catalog.decline_calibration(&[(session, generation)], kind).await.unwrap();
    }
}

/// [`admit`] `session`, then add it whole to `project` at its current
/// revision, in the group its rig and framing give.
pub async fn hold(library: &Library, project: Uuid, session: Uuid) -> ProjectDesired {
    admit(library, session).await;
    let revision = library.catalog().project_desired(project).await.unwrap().revision;
    let adds = [SessionToAdd { session_id: session, expected: None }];
    library.add_project_sessions(project, revision, &adds, None).await.unwrap()
}
