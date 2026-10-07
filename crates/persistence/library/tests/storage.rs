// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Storage custody journal: durable operations and items, item CAS, and the
//! refusals that keep a settled item and operation final.
#![cfg(unix)]

mod support;

use persistence_library::Catalog;
use platevault_model::{
    EntryEvidence, EntryKind, FileIdentity, ItemChange, ItemOutcome, ItemPhase, ItemReason,
    LibraryError, NativePath, ReasonCode, StorageItemDraft, StorageOperationKind,
    StorageOperationState, TransferDestination, WrittenCopy,
};
use support::*;

fn evidence(fx: &Fixture, relative: &str) -> EntryEvidence {
    let path = fx.root.join(relative);
    EntryEvidence {
        path: NativePath::from_path(&path),
        kind: EntryKind::File,
        fingerprint: file_fingerprint(&path).unwrap(),
        sha256: Some(sha_of(&path)),
    }
}

fn trash_item(fx: &Fixture, relative: &str) -> StorageItemDraft {
    StorageItemDraft { source: evidence(fx, relative), relied_on: Vec::new(), destination: None }
}

fn written(fx: &Fixture) -> WrittenCopy {
    WrittenCopy {
        partial: NativePath::from_path(&fx.root.join(".pv-partial")),
        identity: FileIdentity { volume: volume(), file_id: Some("7".into()) },
    }
}

#[tokio::test]
async fn storage_journal_survives_reopen_and_refuses_stale_or_settled_changes() {
    let fx = Fixture::new();
    fx.write("a.fits", b"frame a");
    fx.write("b.fits", b"frame b");
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let recorded = catalog
        .record_storage_operation(
            StorageOperationKind::Trash,
            &[trash_item(&fx, "a.fits"), trash_item(&fx, "b.fits")],
        )
        .await
        .unwrap();
    assert_eq!(recorded.state, StorageOperationState::Reviewed);
    assert!(recorded.items.iter().all(|item| item.phase == ItemPhase::Pending));
    let id = recorded.id;
    let retiring =
        ItemChange { phase: ItemPhase::Retiring, outcome: None, reason: None, written: None };
    let refused = catalog.advance_storage_item(id, 0, 1, &retiring).await.unwrap_err();
    assert!(
        matches!(refused, LibraryError::InvalidInput(_)),
        "a reviewed operation records no progress"
    );

    catalog.start_storage_operation(id).await.unwrap();
    let item = catalog.advance_storage_item(id, 0, 1, &retiring).await.unwrap();
    assert_eq!((item.phase, item.revision), (ItemPhase::Retiring, 2));
    let stale = catalog.advance_storage_item(id, 0, 1, &retiring).await.unwrap_err();
    assert!(matches!(stale, LibraryError::Conflict { current: 2, .. }), "{stale:?}");
    catalog.close().await.unwrap();

    let catalog = Catalog::open(&fx.db).await.unwrap();
    let reopened = catalog.storage_operation(id).await.unwrap();
    assert_eq!(reopened.state, StorageOperationState::Running, "running work survives a restart");
    assert_eq!(reopened.items[0].phase, ItemPhase::Retiring);
    assert_eq!(
        reopened.items[0].source, recorded.items[0].source,
        "evidence round-trips losslessly"
    );
    let unsettled = catalog.unsettled_storage_operations().await.unwrap();
    assert_eq!(unsettled.iter().map(|op| op.id).collect::<Vec<_>>(), vec![id]);

    let open = catalog.settle_storage_operation(id).await.unwrap_err();
    assert!(matches!(open, LibraryError::InvalidInput(_)), "open items keep the operation running");
    let trashed = ItemChange {
        phase: ItemPhase::Settled,
        outcome: Some(ItemOutcome::Trashed),
        reason: None,
        written: None,
    };
    catalog.advance_storage_item(id, 0, 2, &trashed).await.unwrap();
    let again = catalog.advance_storage_item(id, 0, 3, &retiring).await.unwrap_err();
    assert!(matches!(again, LibraryError::InvalidInput(_)), "a settled item is final");
    let blocked = ItemChange {
        phase: ItemPhase::Settled,
        outcome: Some(ItemOutcome::Blocked),
        reason: Some(ItemReason::new(ReasonCode::TrashUnsupported, "network volume")),
        written: None,
    };
    catalog.advance_storage_item(id, 1, 1, &blocked).await.unwrap();
    let settled = catalog.settle_storage_operation(id).await.unwrap();
    assert_eq!(settled.state, StorageOperationState::Settled);
    assert_eq!(settled.items[1].reason.as_ref().unwrap().code, ReasonCode::TrashUnsupported);
    assert!(catalog.unsettled_storage_operations().await.unwrap().is_empty());
    let restart = catalog.start_storage_operation(id).await.unwrap_err();
    assert!(
        matches!(restart, LibraryError::InvalidInput(_)),
        "a settled operation never runs again"
    );
}

#[tokio::test]
async fn storage_journal_refuses_items_and_changes_that_do_not_fit_the_kind() {
    let fx = Fixture::new();
    fx.write("a.fits", b"frame a");
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let destination = TransferDestination {
        root: NativePath::from_path(&fx.root),
        relative: NativePath::from_path(std::path::Path::new("M31/a.fits")),
    };
    let mut transfer = trash_item(&fx, "a.fits");
    transfer.destination = Some(destination.clone());

    let cases = [
        (StorageOperationKind::Trash, transfer.clone(), "a Trash item has no destination"),
        (StorageOperationKind::Copy, trash_item(&fx, "a.fits"), "a transfer needs a destination"),
        (
            StorageOperationKind::Move,
            StorageItemDraft {
                destination: Some(TransferDestination {
                    relative: NativePath::from_path(std::path::Path::new("../escape.fits")),
                    ..destination.clone()
                }),
                ..transfer.clone()
            },
            "a destination stays below its root",
        ),
        (
            StorageOperationKind::Trash,
            StorageItemDraft {
                source: EntryEvidence { sha256: None, ..evidence(&fx, "a.fits") },
                ..trash_item(&fx, "a.fits")
            },
            "a file needs its reviewed SHA-256",
        ),
    ];
    for (kind, draft, why) in cases {
        let refused = catalog.record_storage_operation(kind, &[draft]).await.unwrap_err();
        assert!(matches!(refused, LibraryError::InvalidInput(_)), "{why}: {refused:?}");
    }

    let copy =
        catalog.record_storage_operation(StorageOperationKind::Copy, &[transfer]).await.unwrap();
    catalog.start_storage_operation(copy.id).await.unwrap();
    let unwritten =
        ItemChange { phase: ItemPhase::Writing, outcome: None, reason: None, written: None };
    let refused = catalog.advance_storage_item(copy.id, 0, 1, &unwritten).await.unwrap_err();
    assert!(matches!(refused, LibraryError::InvalidInput(_)), "writing names its partial copy");
    let moved = ItemChange {
        phase: ItemPhase::Settled,
        outcome: Some(ItemOutcome::Moved),
        reason: None,
        written: Some(written(&fx)),
    };
    let refused = catalog.advance_storage_item(copy.id, 0, 1, &moved).await.unwrap_err();
    assert!(matches!(refused, LibraryError::InvalidInput(_)), "a Copy never retires its source");
    let writing = ItemChange { written: Some(written(&fx)), ..unwritten };
    let item = catalog.advance_storage_item(copy.id, 0, 1, &writing).await.unwrap();
    assert_eq!(item.written, Some(written(&fx)));
}
