// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The Storage overview (spec 071 STO-FR-11, STO-FR-12, STO-AC-12, D16) on
//! the composed library over real files: location availability, run
//! footprints, live content-identity duplicate candidates and archive
//! transfers in separate sections; a candidate shown authorizes nothing; and
//! external drift in an entry the application wrote blocks that item.
#![cfg(unix)]

#[path = "support/storage_overview.rs"]
mod overview_support;
#[path = "support/prepare.rs"]
mod prepare_support;
mod support;

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use overview_support::{append, register, step_to, transfer_draft, BinTrash, Duplicates};
use platevault_core::custody::trash::OsTrash;
use platevault_core::library::Library;
use platevault_core::*;
use prepare_support::{digest, tree, world, Watch, HA_LIGHTS, OIII_LIGHTS, RUN};
use uuid::Uuid;

const QUIET: &str = "exit 0";

fn path(native: &NativePath) -> PathBuf {
    native.to_path_buf().unwrap()
}

/// Every file below `root` with its digest, the catalog's own files aside.
fn files(root: &Path) -> Vec<(PathBuf, String)> {
    tree(root).into_iter().filter(|(path, _)| !path.to_string_lossy().contains(".sqlite")).collect()
}

/// STO-AC-12: given registered online and offline locations, a prepared run,
/// duplicate content and an archive transfer, Storage shows each in its own
/// section: a Trash operation is no transfer, a Trashed copy is no duplicate
/// and a prepared copy is footprint only.
#[tokio::test]
async fn overview_separates_availability_footprints_duplicates_transfers() {
    let world = world().await;
    let root = fs::canonicalize(world.temp.path()).unwrap();
    let profile = world.siril(QUIET).await;
    let request = world.request(&profile, InputMode::Copy, None);
    let outcome = world.prepare(&request, &Watch::quiet()).await;
    assert_eq!(outcome.revision.state, PreparationState::Prepared, "{outcome:#?}");
    let duplicates = Duplicates::new(&world.library, &root).await;
    let drive = register(&world.library, &root.join("Travel drive"), "Travel drive").await;
    world
        .catalog()
        .mark_location_unavailable(drive.id, Availability::Offline, "the drive is unplugged")
        .await
        .unwrap();
    let archive = root.join("Archive");
    fs::create_dir_all(&archive).unwrap();
    let source = world.light(HA_LIGHTS[0]);
    let draft = transfer_draft(&world.library, &source, &archive, "NGC 7000/Ha_001.fits").await;
    let transfer = world
        .catalog()
        .record_storage_operation(StorageOperationKind::Copy, &[draft])
        .await
        .unwrap()
        .id;
    let trash = BinTrash::in_folder(&root.join("OS Trash"));
    let copied = world.library.run_storage_operation(transfer, trash).await.unwrap();
    assert_eq!(copied.items[0].outcome, Some(ItemOutcome::Copied), "{copied:?}");

    let overview = world.library.storage_overview().await.unwrap();

    // Location availability: every registered location once, as LIB observed it.
    let mut registered: Vec<Uuid> = vec![world.captures.id, world.calibration.id, drive.id];
    registered.extend(duplicates.locations.iter().map(|location| location.id));
    let listed: BTreeSet<Uuid> = overview.locations.iter().map(|state| state.location.id).collect();
    assert_eq!(listed, registered.iter().copied().collect(), "{:#?}", overview.locations);
    assert_eq!(overview.locations.len(), registered.len());
    for state in &overview.locations {
        if state.location.id == drive.id {
            assert_eq!(state.location.availability, Availability::Offline);
            let failure = state.failure.as_ref().expect("the offline reason is named");
            assert_eq!(failure.reason, "the drive is unplugged");
        } else {
            assert_eq!(state.location.availability, Availability::Available, "{state:?}");
            assert!(state.failure.is_none());
        }
    }

    // Run footprints: the run's prepared folder, its copies and Results folder.
    assert_eq!(overview.footprints.len(), 1, "{:#?}", overview.footprints);
    let run = &overview.footprints[0];
    assert_eq!((run.view_id, run.name.as_str()), (world.run, RUN));
    assert!(!run.in_project_trash);
    assert_eq!(run.results_folder.as_ref(), Some(&outcome.revision.results_folder));
    assert_eq!(run.revisions.len(), 1);
    let revision = &run.revisions[0];
    assert_eq!((revision.preparation_id, revision.n), (outcome.revision.id, 1));
    assert_eq!(revision.folder, outcome.revision.folder);
    assert_eq!((revision.state, revision.mode), (PreparationState::Prepared, InputMode::Copy));
    let copy_bytes: u64 = outcome.prepared.iter().map(|entry| entry.size_bytes).sum();
    assert_eq!(revision.entries as usize, outcome.prepared.len());
    assert!(copy_bytes > 0);
    assert_eq!((revision.footprint_bytes, run.footprint_bytes), (copy_bytes, copy_bytes));
    assert!(revision.blocked.is_empty(), "{:#?}", revision.blocked);

    // Duplicate candidates: the frame's live copies in Disk A and Disk B only.
    assert_eq!(overview.duplicates.len(), 1, "{:#?}", overview.duplicates);
    let candidate = &overview.duplicates[0];
    assert_eq!(candidate.sha256, duplicates.sha256);
    let homes: Vec<Uuid> = candidate.copies.iter().map(|copy| copy.location_id).collect();
    assert_eq!(homes, vec![duplicates.locations[0].id, duplicates.locations[1].id]);
    assert!(candidate.copies.iter().all(|copy| copy.availability == Availability::Available));

    // Archive transfers: the Copy with its phases; the cleanup Trash is not one.
    assert_eq!(overview.transfers.len(), 1, "{:#?}", overview.transfers);
    let shown = &overview.transfers[0];
    assert_eq!(shown.operation_id, transfer);
    assert_ne!(shown.operation_id, duplicates.cleanup);
    assert_eq!(
        (shown.kind, shown.state),
        (StorageOperationKind::Copy, StorageOperationState::Settled)
    );
    let item = &shown.items[0];
    assert_eq!(item.source, NativePath::from_path(&source));
    assert_eq!((item.phase, item.outcome), (ItemPhase::Settled, Some(ItemOutcome::Copied)));
    assert!(item.blocked.is_none(), "{item:?}");

    // The sections stay separate on the wire.
    let wire = serde_json::to_value(&overview).unwrap();
    let sections: BTreeSet<&str> = wire.as_object().unwrap().keys().map(String::as_str).collect();
    assert_eq!(
        sections,
        ["duplicates", "footprints", "locations", "transfers"].into_iter().collect()
    );
}

/// STO-FR-11, D16: showing a duplicate candidate, however often, records no
/// operation, moves or changes no file and changes no catalog record. The
/// candidate names only live copies and carries nothing that approves removal.
#[tokio::test]
async fn candidate_display_authorizes_nothing() {
    let temp = tempfile::tempdir().unwrap();
    let root = fs::canonicalize(temp.path()).unwrap();
    let library = Library::open(&root.join("library.sqlite"), None).await.unwrap();
    let duplicates = Duplicates::new(&library, &root).await;
    let catalog = library.catalog();
    let unsettled = |operations: Vec<StorageOperation>| -> Vec<Uuid> {
        operations.into_iter().map(|operation| operation.id).collect()
    };
    let operations = unsettled(catalog.unsettled_storage_operations().await.unwrap());
    let records = |assets: &[Asset]| -> Vec<(Uuid, Availability, Quality, Revision)> {
        assets
            .iter()
            .map(|asset| (asset.id, asset.availability, asset.quality, asset.decision_revision))
            .collect()
    };
    let mut before = Vec::new();
    for location in &duplicates.locations {
        before.push(records(&catalog.location_assets(location.id).await.unwrap()));
    }
    let before_files = files(&root);

    let first = library.storage_overview().await.unwrap();
    let second = library.storage_overview().await.unwrap();

    assert_eq!(first.duplicates.len(), 1, "{:#?}", first.duplicates);
    let candidate = &first.duplicates[0];
    let named: Vec<Uuid> = candidate.copies.iter().map(|copy| copy.asset_id).collect();
    assert_eq!(named, duplicates.assets[..2].to_vec(), "the Trashed copy is never a candidate");
    let wire = serde_json::to_value(candidate).unwrap();
    let fields: BTreeSet<&str> = wire.as_object().unwrap().keys().map(String::as_str).collect();
    assert_eq!(fields, ["copies", "sha256", "sizeBytes"].into_iter().collect());
    assert_eq!(
        serde_json::to_value(&first.duplicates).unwrap(),
        serde_json::to_value(&second.duplicates).unwrap()
    );

    assert_eq!(
        unsettled(catalog.unsettled_storage_operations().await.unwrap()),
        operations,
        "no operation is recorded"
    );
    assert!(catalog.archive_transfers().await.unwrap().is_empty(), "no transfer is recorded");
    for (location, recorded) in duplicates.locations.iter().zip(&before) {
        let after = records(&catalog.location_assets(location.id).await.unwrap());
        assert_eq!(&after, recorded, "no decision or availability changes");
    }
    assert_eq!(files(&root), before_files, "no file moves or changes");
    for path in &duplicates.paths[..2] {
        assert_eq!(digest(path), duplicates.sha256, "every live copy stays in place");
    }
}

/// STO-FR-12: an entry the application wrote that changed outside
/// `PlateVault` blocks its item for review before anything mutates: a
/// prepared copy, the copy a transfer wrote, a transfer item's reviewed
/// source, and a destination another file now occupies. The overview changes
/// neither the files nor the journal.
#[tokio::test]
async fn external_drift_in_app_written_entry_blocks_item() {
    let world = world().await;
    let root = fs::canonicalize(world.temp.path()).unwrap();
    let profile = world.siril(QUIET).await;
    let request = world.request(&profile, InputMode::Copy, None);
    let outcome = world.prepare(&request, &Watch::quiet()).await;
    assert_eq!(outcome.revision.state, PreparationState::Prepared, "{outcome:#?}");
    let edited = outcome.prepared[0].clone();
    append(&path(&edited.path));

    let archive = root.join("Archive");
    fs::create_dir_all(archive.join("taken")).unwrap();
    let occupied = archive.join("taken/OIII_002.fits");
    fs::write(&occupied, b"a file PlateVault did not write").unwrap();
    let (written, drifted, blocked) =
        (world.light(HA_LIGHTS[1]), world.light(OIII_LIGHTS[0]), world.light(OIII_LIGHTS[1]));
    let drafts = vec![
        transfer_draft(&world.library, &written, &archive, "copied/Ha_002.fits").await,
        transfer_draft(&world.library, &drifted, &archive, "pending/OIII_001.fits").await,
        transfer_draft(&world.library, &blocked, &archive, "taken/OIII_002.fits").await,
    ];
    let transfer = world
        .catalog()
        .record_storage_operation(StorageOperationKind::Move, &drafts)
        .await
        .unwrap()
        .id;
    let trash: Arc<dyn OsTrash> = BinTrash::in_folder(&root.join("OS Trash"));
    let journal =
        step_to(&world.library, transfer, &trash, 0, ItemPhase::DestinationVerified).await;
    let copy = archive.join("copied/Ha_002.fits");
    append(&copy);
    append(&drifted);
    let before_files = files(&root);
    let entries = world.catalog().preparation(outcome.revision.id).await.unwrap().entries;

    let overview = world.library.storage_overview().await.unwrap();

    let revision = &overview.footprints[0].revisions[0];
    assert_eq!(revision.blocked.len(), 1, "{:#?}", revision.blocked);
    let entry = &revision.blocked[0];
    assert_eq!((entry.seq, &entry.path), (edited.seq, &edited.path));
    assert_eq!(entry.reason.code, ReasonCode::DestinationMismatch);
    assert!(entry.reason.detail.contains(&edited.path.display()), "{entry:?}");
    assert!(entry.reason.detail.contains("changed outside PlateVault"), "{entry:?}");

    let shown = overview.transfers.iter().find(|view| view.operation_id == transfer).unwrap();
    let codes: Vec<(ItemPhase, Option<ReasonCode>)> = shown
        .items
        .iter()
        .map(|item| (item.phase, item.blocked.as_ref().map(|reason| reason.code)))
        .collect();
    assert_eq!(
        codes,
        vec![
            (ItemPhase::DestinationVerified, Some(ReasonCode::DestinationChanged)),
            (ItemPhase::Pending, Some(ReasonCode::SourceDrift)),
            (ItemPhase::Pending, Some(ReasonCode::DestinationOccupied)),
        ],
        "{:#?}",
        shown.items
    );
    assert!(shown.items[0].blocked.as_ref().unwrap().detail.contains(&copy.display().to_string()));
    assert!(shown.items[1]
        .blocked
        .as_ref()
        .unwrap()
        .detail
        .contains(&drifted.display().to_string()));

    assert_eq!(files(&root), before_files, "both versions stay where they are");
    let after = world.catalog().storage_operation(transfer).await.unwrap();
    assert_eq!(after.items, journal.items, "the journal is unchanged");
    assert_eq!(after.state, StorageOperationState::Running);
    let recorded = world.catalog().preparation(outcome.revision.id).await.unwrap().entries;
    assert_eq!(recorded, entries, "the prepared entries' records are unchanged");
}
