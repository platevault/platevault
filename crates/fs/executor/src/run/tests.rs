// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

use std::sync::Arc;

use camino::{Utf8Path, Utf8PathBuf};
use tokio::sync::Mutex;

use super::*;

fn utf8(p: &std::path::Path) -> Utf8PathBuf {
    Utf8PathBuf::from_path_buf(p.to_path_buf()).expect("temp dir path is UTF-8")
}

// ── Fake callbacks ────────────────────────────────────────────────────────

#[derive(Default)]
struct FakeCallbacks {
    events: Arc<Mutex<Vec<ItemProgressEvent>>>,
}

impl ExecutorCallbacks for FakeCallbacks {
    fn on_item_start(
        &self,
        _item_id: &str,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + '_>> {
        Box::pin(async {})
    }

    fn on_item_progress(
        &self,
        event: ItemProgressEvent,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + '_>> {
        let events = self.events.clone();
        Box::pin(async move {
            events.lock().await.push(event);
        })
    }
}

fn make_move_item(id: &str, src: &Utf8Path, dst: &Utf8Path) -> ExecutorItem {
    ExecutorItem {
        id: id.to_owned(),
        plan_id: "p1".to_owned(),
        action: ExecutorItemAction::Move,
        // No library_root: pass absolute paths as-is (legacy mode).
        source_path: Some(src.to_path_buf()),
        destination_path: Some(dst.to_path_buf()),
        library_root: None,
        destination_root: None,
        cas_snapshot: CasSnapshot { approved_mtime: None, approved_size_bytes: None },
        is_protected: false,
        requires_destructive_confirm: false,
        destructive_confirmed: false,
        current_state: "pending".to_owned(),
    }
}

#[tokio::test]
async fn happy_path_all_succeed() {
    let dir = tempfile::tempdir().unwrap();
    let root = utf8(dir.path());
    let src = root.join("file.fits");
    let dst = root.join("dest.fits");
    std::fs::write(&src, b"data").unwrap();

    let item = make_move_item("item-1", &src, &dst);
    let callbacks = FakeCallbacks::default();
    let cancel = CancellationToken::new();
    let skip = SkipSet::new();
    let retry = RetryQueue::new();

    let outcome = execute_plan(vec![item], &callbacks, &cancel, &skip, &retry).await;

    let events = callbacks.events.lock().await;
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].new_state, "succeeded");
    drop(events);

    match outcome {
        ApplyOutcome::Completed(counts) => {
            assert_eq!(counts.succeeded, 1);
            assert_eq!(counts.failed, 0);
        }
        other => panic!("expected Completed, got {other:?}"),
    }
    assert!(dst.exists());
    assert!(!src.exists());
}

#[tokio::test]
async fn item_in_failed_state_is_skipped_by_executor() {
    let item = ExecutorItem {
        id: "item-1".to_owned(),
        plan_id: "p1".to_owned(),
        action: ExecutorItemAction::NoOp,
        source_path: None,
        destination_path: None,
        library_root: None,
        destination_root: None,
        cas_snapshot: CasSnapshot { approved_mtime: None, approved_size_bytes: None },
        is_protected: false,
        requires_destructive_confirm: false,
        destructive_confirmed: false,
        current_state: "failed".to_owned(), // already terminal
    };

    let callbacks = FakeCallbacks::default();
    let cancel = CancellationToken::new();
    let skip = SkipSet::new();
    let retry = RetryQueue::new();

    let outcome = execute_plan(vec![item], &callbacks, &cancel, &skip, &retry).await;

    // No events should be emitted for already-terminal items.
    assert!(callbacks.events.lock().await.is_empty());
    match outcome {
        ApplyOutcome::Completed(counts) => {
            assert_eq!(counts.succeeded, 0);
        }
        other => panic!("expected Completed, got {other:?}"),
    }
}

#[tokio::test]
async fn cancellation_halts_before_next_item() {
    let dir = tempfile::tempdir().unwrap();
    let root = utf8(dir.path());
    let src1 = root.join("a.fits");
    let dst1 = root.join("a_dst.fits");
    let src2 = root.join("b.fits");
    let dst2 = root.join("b_dst.fits");
    std::fs::write(&src1, b"a").unwrap();
    std::fs::write(&src2, b"b").unwrap();

    let cancel = CancellationToken::new();
    // Pre-signal cancellation.
    cancel.cancel();

    let items =
        vec![make_move_item("item-1", &src1, &dst1), make_move_item("item-2", &src2, &dst2)];
    let callbacks = FakeCallbacks::default();
    let skip = SkipSet::new();
    let retry = RetryQueue::new();

    let outcome = execute_plan(items, &callbacks, &cancel, &skip, &retry).await;

    // No items executed (cancel was signalled before the loop started).
    match outcome {
        ApplyOutcome::Cancelled(counts) => {
            assert_eq!(counts.succeeded, 0);
        }
        other => panic!("expected Cancelled, got {other:?}"),
    }
    // Both sources still exist.
    assert!(src1.exists());
    assert!(src2.exists());
}

#[tokio::test]
async fn user_skip_set_prevents_execution() {
    let dir = tempfile::tempdir().unwrap();
    let root = utf8(dir.path());
    let src = root.join("skip.fits");
    let dst = root.join("skip_dst.fits");
    std::fs::write(&src, b"data").unwrap();

    let item = make_move_item("item-skip", &src, &dst);
    let callbacks = FakeCallbacks::default();
    let cancel = CancellationToken::new();
    let skip = SkipSet::new();
    skip.insert("item-skip");
    let retry = RetryQueue::new();

    let outcome = execute_plan(vec![item], &callbacks, &cancel, &skip, &retry).await;

    let events = callbacks.events.lock().await;
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].new_state, "skipped");
    drop(events);

    match outcome {
        ApplyOutcome::Completed(counts) => assert_eq!(counts.skipped, 1),
        other => panic!("expected Completed, got {other:?}"),
    }
    // Source not moved.
    assert!(src.exists());
}

#[tokio::test]
async fn stale_source_triggers_pause() {
    let dir = tempfile::tempdir().unwrap();
    let root = utf8(dir.path());
    let src = root.join("stale.fits");
    std::fs::write(&src, b"data").unwrap();
    let dst = root.join("dst.fits");

    let item = ExecutorItem {
        id: "item-stale".to_owned(),
        plan_id: "p1".to_owned(),
        action: ExecutorItemAction::Move,
        source_path: Some(src.clone()),
        destination_path: Some(dst),
        library_root: None,
        destination_root: None,
        cas_snapshot: CasSnapshot {
            approved_mtime: None,
            approved_size_bytes: Some(999), // wrong size → stale
        },
        is_protected: false,
        requires_destructive_confirm: false,
        destructive_confirmed: false,
        current_state: "pending".to_owned(),
    };

    let callbacks = FakeCallbacks::default();
    let cancel = CancellationToken::new();
    let skip = SkipSet::new();
    let retry = RetryQueue::new();

    let outcome = execute_plan(vec![item], &callbacks, &cancel, &skip, &retry).await;
    match outcome {
        ApplyOutcome::Paused { reason, .. } => {
            assert!(reason.contains("stale"));
        }
        other => panic!("expected Paused, got {other:?}"),
    }
}

/// Callbacks that, on seeing `item-1` fail, clear the conflicting
/// destination that caused the failure and files a retry — mirroring
/// what `retry_plan_item` + a user fix do in the real app (issue #742).
#[derive(Clone)]
struct RetryOnFailureCallbacks {
    events: Arc<Mutex<Vec<ItemProgressEvent>>>,
    retry_queue: RetryQueue,
    conflicting_destination: Utf8PathBuf,
}

impl ExecutorCallbacks for RetryOnFailureCallbacks {
    fn on_item_start(
        &self,
        _item_id: &str,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + '_>> {
        Box::pin(async {})
    }

    fn on_item_progress(
        &self,
        event: ItemProgressEvent,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + '_>> {
        let events = self.events.clone();
        let retry_queue = self.retry_queue.clone();
        let conflicting_destination = self.conflicting_destination.clone();
        Box::pin(async move {
            if event.item_id == "item-1" && event.new_state == "failed" {
                let _ = std::fs::remove_file(&conflicting_destination);
                retry_queue.push("item-1");
            }
            events.lock().await.push(event);
        })
    }
}

#[tokio::test]
async fn mid_run_retry_reexecutes_already_passed_item() {
    let dir = tempfile::tempdir().unwrap();
    let root = utf8(dir.path());
    let src1 = root.join("a.fits");
    let dst1 = root.join("a_dst.fits");
    let src2 = root.join("b.fits");
    let dst2 = root.join("b_dst.fits");
    std::fs::write(&src1, b"a").unwrap();
    std::fs::write(&src2, b"b").unwrap();
    // item-1's destination already exists, so its first attempt fails
    // with a non-pausing conflict — exactly the class of failure a user
    // fixes and retries mid-run.
    std::fs::write(&dst1, b"stale").unwrap();

    let item1 = make_move_item("item-1", &src1, &dst1);
    let item2 = make_move_item("item-2", &src2, &dst2);

    let retry = RetryQueue::new();
    let callbacks = RetryOnFailureCallbacks {
        events: Arc::new(Mutex::new(Vec::new())),
        retry_queue: retry.clone(),
        conflicting_destination: dst1.clone(),
    };
    let cancel = CancellationToken::new();
    let skip = SkipSet::new();

    let outcome = execute_plan(vec![item1, item2], &callbacks, &cancel, &skip, &retry).await;

    match outcome {
        ApplyOutcome::Completed(counts) => {
            // item-1's original failure is still counted; its retry
            // succeeds, and item-2 succeeds normally.
            assert_eq!(counts.succeeded, 2);
            assert_eq!(counts.failed, 1);
        }
        other => panic!("expected Completed, got {other:?}"),
    }

    // item-1 actually moved once the conflicting destination was cleared
    // and the retry re-executed the real filesystem operation — not just
    // a DB-state flip with no corresponding work (the original bug).
    assert!(dst1.exists());
    assert!(!src1.exists());

    let events = callbacks.events.lock().await;
    let item1_events: Vec<_> = events.iter().filter(|e| e.item_id == "item-1").collect();
    assert_eq!(item1_events.len(), 2, "expected a failed then a succeeded event");
    assert_eq!(item1_events[0].new_state, "failed");
    assert_eq!(item1_events[1].new_state, "succeeded");
    // The retry's prior_state reflects the DB row `retry_plan_item`
    // already transitioned to `applying` — not the original "pending".
    assert_eq!(item1_events[1].prior_state, "applying");
}

/// Callbacks that, on seeing `item-1` succeed, queue a retry for
/// `item-2` and signal cancellation in the same tick — mirroring a user
/// clicking Cancel right as a mid-run retry is filed (review fix for
/// #742's retry-drain loop).
#[derive(Clone)]
struct CancelDuringRetryDrainCallbacks {
    events: Arc<Mutex<Vec<ItemProgressEvent>>>,
    retry_queue: RetryQueue,
    cancel: CancellationToken,
}

impl ExecutorCallbacks for CancelDuringRetryDrainCallbacks {
    fn on_item_start(
        &self,
        _item_id: &str,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + '_>> {
        Box::pin(async {})
    }

    fn on_item_progress(
        &self,
        event: ItemProgressEvent,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + '_>> {
        let events = self.events.clone();
        let retry_queue = self.retry_queue.clone();
        let cancel = self.cancel.clone();
        Box::pin(async move {
            if event.item_id == "item-1" && event.new_state == "succeeded" {
                retry_queue.push("item-2");
                cancel.cancel();
            }
            events.lock().await.push(event);
        })
    }
}

#[tokio::test]
async fn cancellation_is_observed_between_retry_items_not_just_forward_items() {
    let dir = tempfile::tempdir().unwrap();
    let root = utf8(dir.path());
    let src1 = root.join("a.fits");
    let dst1 = root.join("a_dst.fits");
    let src2 = root.join("b.fits");
    let dst2 = root.join("b_dst.fits");
    std::fs::write(&src1, b"a").unwrap();
    std::fs::write(&src2, b"b").unwrap();

    let item1 = make_move_item("item-1", &src1, &dst1);
    // item-2 carries `current_state: "failed"` — mirrors a pre-pause
    // failed item a resumed run now carries forward purely for
    // `item_by_id` lookup purposes (review fix for resume/retry item-set
    // agreement); the forward loop skips it as already-terminal, so the
    // ONLY path that could execute it is the retry-drain below.
    let item2 = ExecutorItem {
        current_state: "failed".to_owned(),
        ..make_move_item("item-2", &src2, &dst2)
    };

    let cancel = CancellationToken::new();
    let retry = RetryQueue::new();
    let callbacks = CancelDuringRetryDrainCallbacks {
        events: Arc::new(Mutex::new(Vec::new())),
        retry_queue: retry.clone(),
        cancel: cancel.clone(),
    };
    let skip = SkipSet::new();

    let outcome = execute_plan(vec![item1, item2], &callbacks, &cancel, &skip, &retry).await;

    match outcome {
        ApplyOutcome::Cancelled(counts) => {
            assert_eq!(counts.succeeded, 1, "only item-1's normal forward pass");
        }
        other => panic!("expected Cancelled, got {other:?}"),
    }

    // item-2's queued retry must NOT have executed: cancellation is
    // checked between retry items too, same as forward items.
    assert!(src2.exists(), "item-2's retry must not have run after cancel");
    assert!(!dst2.exists());
    let events = callbacks.events.lock().await;
    assert!(
        events.iter().all(|e| e.item_id != "item-2"),
        "no progress event should have been emitted for the cancelled-out retry"
    );
}

#[test]
fn terminal_state_all_succeeded() {
    let c = TerminalCounts { succeeded: 5, failed: 0, skipped: 0, cancelled: 0 };
    assert_eq!(c.terminal_state(false), "applied");
}

#[test]
fn terminal_state_partial() {
    let c = TerminalCounts { succeeded: 3, failed: 2, skipped: 0, cancelled: 0 };
    assert_eq!(c.terminal_state(false), "partially_applied");
}

#[test]
fn terminal_state_all_failed() {
    let c = TerminalCounts { succeeded: 0, failed: 3, skipped: 0, cancelled: 0 };
    assert_eq!(c.terminal_state(false), "failed");
}

#[test]
fn terminal_state_cancelled_overrides() {
    let c = TerminalCounts { succeeded: 3, failed: 0, skipped: 0, cancelled: 2 };
    assert_eq!(c.terminal_state(true), "cancelled");
}

#[test]
fn cancellation_token_default_not_cancelled() {
    let tok = CancellationToken::new();
    assert!(!tok.is_cancelled());
    tok.cancel();
    assert!(tok.is_cancelled());
}
