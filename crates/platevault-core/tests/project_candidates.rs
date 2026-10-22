// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! A Project's candidates review list (spec 067 PIX-FR-18; record §5 line
//! 100, §9 line 175) on the Apply world: it lists the live light captures of
//! the Project's candidate sessions with their library quality, and the
//! Unreviewed filter keeps only those still unreviewed. A mark is the
//! library's decision at its source; listing changes nothing.

#[path = "support/apply.rs"]
mod apply_support;

use std::collections::BTreeSet;

use apply_support::{catalogued, World, HA, OIII};
use platevault_core::*;
use uuid::Uuid;

async fn list(world: &World, filter: ReviewFilter) -> ReviewList {
    let context = ReviewContext::ProjectCandidates { project_id: world.project };
    world
        .library
        .frame_review()
        .review_list(context, filter, &ReviewSort::default(), &NameTemplate::FileName)
        .await
        .unwrap()
}

fn ids(list: &ReviewList) -> BTreeSet<Uuid> {
    list.frames.iter().map(|frame| frame.asset.id).collect()
}

/// Every quality record of the Project's candidate frames.
async fn qualities(world: &World, assets: &BTreeSet<Uuid>) -> Vec<(Uuid, Quality, Revision)> {
    let mut records = Vec::new();
    for id in assets {
        let asset = world.catalog().asset(*id).await.unwrap();
        records.push((asset.id, asset.quality, asset.decision_revision));
    }
    records
}

/// PIX-FR-18: the candidates list names every frame of the Project's
/// candidate sessions and no calibration frame. Marked through the library,
/// a Usable and an Unusable frame leave the Unreviewed filter, which lists
/// and counts only what is still unreviewed; listing changes no quality.
#[tokio::test]
async fn project_candidates_context_filtered_unreviewed() {
    let world = catalogued(ViewMode::Symlinks).await;
    let catalog = world.catalog();
    let mut candidates = BTreeSet::new();
    for candidate in catalog.project_candidates(world.project).await.unwrap() {
        let session = catalog.session(candidate.session_id).await.unwrap();
        candidates.extend(session.assets.iter().map(|asset| asset.id));
    }
    let all = list(&world, ReviewFilter::All).await;
    assert_eq!(all.project_id, world.project);
    assert_eq!(ids(&all), candidates, "every candidate frame, once");
    let picked = world.asset_at(&world.captures, HA[0]).await;
    let rejected = world.asset_at(&world.captures, OIII[0]).await;
    for asset in [&picked, &rejected] {
        assert!(
            candidates.contains(&asset.id),
            "{} is a candidate frame",
            asset.relative_path.display()
        );
    }
    let calibration: BTreeSet<Uuid> = catalog
        .location_assets(world.calibration.id)
        .await
        .unwrap()
        .into_iter()
        .map(|asset| asset.id)
        .collect();
    assert!(candidates.is_disjoint(&calibration), "calibration frames are never candidates");
    assert_eq!(all.counts.unreviewed, all.counts.all, "{:?}", all.counts);

    let review = world.library.frame_review();
    for (asset, quality) in [(&picked, Quality::Usable), (&rejected, Quality::Unusable)] {
        let expected = ExpectedAsset {
            asset_id: asset.id,
            decision_revision: asset.decision_revision,
            fingerprint: asset.fingerprint.clone(),
        };
        review.review_mark(&ReviewMark { asset: expected, quality }).await.unwrap();
    }
    let before = qualities(&world, &candidates).await;

    let unreviewed = list(&world, ReviewFilter::Unreviewed).await;

    let mut still: BTreeSet<Uuid> = candidates.clone();
    still.remove(&picked.id);
    still.remove(&rejected.id);
    assert_eq!(unreviewed.filter, ReviewFilter::Unreviewed);
    assert_eq!(ids(&unreviewed), still);
    assert!(unreviewed.frames.iter().all(|frame| frame.label == QualityLabel::Unreviewed));
    assert_eq!(unreviewed.counts.unreviewed, u64::try_from(still.len()).unwrap());
    assert_eq!((unreviewed.counts.picked, unreviewed.counts.rejected), (1, 1));
    assert_eq!(qualities(&world, &candidates).await, before, "listing changes no quality record");
}
