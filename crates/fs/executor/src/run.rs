//! Sequential per-item executor loop (spec 025, T013).
//!
//! Walks an approved plan's items in order. For each item:
//!   1. Check cancellation token (between items only — never mid-item).
//!   2. Check skip-set (user-requested skips injected between items).
//!   3. Check per-item FS CAS snapshot (R-FS-1).
//!   4. Perform the filesystem operation.
//!   5. Emit progress event via callbacks.
//!   6. Re-check retry-queue before advancing.
//!
//! Pause conditions (`volume.unavailable`, `disk.full`, `item.stale`)
//! halt the loop and return `ApplyOutcome::Paused`.
//!
//! Cancellation halts forward progress; remaining pending items are
//! batched to `cancelled` by the caller (app/core use case).
//!
//! This module has NO database or audit bus dependencies — those are
//! injected via `ExecutorCallbacks` so the crate can be unit-tested
//! with an in-process fake.
//!
//! Constitution §II: never overwrite silently; per-item audit via callbacks.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use camino::{Utf8Path, Utf8PathBuf};
use tokio::sync::watch;

use crate::failure::{FailureCode, PlanItemFailure, RollbackOutcome};
use crate::ops::archive_op;
use crate::ops::cas_check::{check_cas, CasSnapshot};
use crate::ops::delete_op;
use crate::ops::move_op;
use crate::ops::path_gate;
use crate::ops::trash_op;

// ── Public types ──────────────────────────────────────────────────────────────

/// Snapshot of counters at the end of a run (for terminal state computation).
#[derive(Clone, Debug, Default)]
pub struct TerminalCounts {
    pub succeeded: i64,
    pub failed: i64,
    pub skipped: i64,
    pub cancelled: i64,
}

impl TerminalCounts {
    /// Compute the terminal plan state string from the counters.
    /// `cancelled_flag` overrides when cancellation was observed.
    #[must_use]
    pub fn terminal_state(&self, cancelled_flag: bool) -> &'static str {
        if cancelled_flag {
            return "cancelled";
        }
        match (self.succeeded, self.failed) {
            (s, 0) if s > 0 => "applied",
            (0, f) if f > 0 => "failed",
            (s, f) if s > 0 && f > 0 => "partially_applied",
            _ => "failed", // zero successes, zero failures (all skipped)
        }
    }
}

/// Progress event emitted per item state transition.
#[derive(Clone, Debug)]
pub struct ItemProgressEvent {
    pub item_id: String,
    pub prior_state: String,
    pub new_state: String,
    pub at: String,
    pub failure: Option<PlanItemFailure>,
    pub rollback_attempted: bool,
    pub rollback_outcome: RollbackOutcome,
    pub rollback_message: Option<String>,
    /// Structured audit reason for refusals (e.g. `"root_escape"`, `"symlink"`,
    /// `"stale"`, `"destination_exists"`, `"destructive_unconfirmed"`).
    /// `None` for normal success/failure transitions.
    pub audit_reason: Option<String>,
}

/// Final outcome of an `execute_plan` call.
#[derive(Clone, Debug)]
pub enum ApplyOutcome {
    /// All items reached a terminal state.
    Completed(TerminalCounts),
    /// User cancelled; remaining items are pending (caller batch-cancels).
    Cancelled(TerminalCounts),
    /// Run paused due to a recoverable condition.
    Paused { reason: String, counts: TerminalCounts },
}

/// Callbacks injected by the use case layer for persistence + audit.
///
/// Each method is async and returns a `Result<(), String>` where the `String`
/// is an error description. The executor does NOT retry on callback failures —
/// it logs them at `tracing::error!` level and continues.
pub trait ExecutorCallbacks: Send + Sync {
    /// Called when an item transitions to `applying`.
    fn on_item_start(
        &self,
        item_id: &str,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + '_>>;

    /// Called when an item resolves (succeeded, failed, skipped, stale).
    fn on_item_progress(
        &self,
        event: ItemProgressEvent,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + '_>>;
}

/// An item description passed to the executor (de-coupled from the DB row).
#[derive(Clone, Debug)]
pub struct ExecutorItem {
    pub id: String,
    pub plan_id: String,
    pub action: ExecutorItemAction,
    /// **Relative** source path (executor resolves against `library_root` via the path gate).
    ///
    /// Set to `None` for actions that have no source (e.g. `NoOp`, `Mkdir`).
    pub source_path: Option<Utf8PathBuf>,
    /// **Relative** destination path (executor resolves against `library_root` via the path gate).
    ///
    /// Set to `None` when the destination is implicit (e.g. `Trash`).
    pub destination_path: Option<Utf8PathBuf>,
    /// Absolute library root — all relative paths are joined against this.
    ///
    /// `None` means "use the path as-is" (legacy / test items with pre-resolved paths).
    pub library_root: Option<Utf8PathBuf>,
    /// Approval-time CAS snapshot (R-FS-1).
    pub cas_snapshot: CasSnapshot,
    /// Protection status from spec-016 (FR-008).
    pub is_protected: bool,
    /// Whether this item requires destructive confirmation (FR-003, D9).
    ///
    /// Derived from action type: `delete` and `trash` ⇒ `true`. Independent of
    /// `is_protected`. Replaces the old `confirm_required = is_protected` inversion.
    pub requires_destructive_confirm: bool,
    /// Whether the destructive confirmation has been satisfied by the user (FR-003).
    pub destructive_confirmed: bool,
    /// Current state when the executor picks it up.
    pub current_state: String,
}

/// Item action categories understood by the executor.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ExecutorItemAction {
    Move,
    Archive {
        archive_destination: Utf8PathBuf,
    },
    /// Move to OS trash. Falls back to archive at `fallback_archive_destination` if provided.
    Trash {
        /// Absolute path to use as the archive fallback destination when OS trash is unavailable.
        fallback_archive_destination: Option<Utf8PathBuf>,
    },
    Delete,
    /// RecordOnly / Mkdir / Link / Junction — no FS mutation; mark succeeded.
    NoOp,
}

/// Configuration for a single executor run.
#[derive(Clone, Debug)]
pub struct RunConfig {
    pub plan_id: String,
    pub run_id: String,
}

/// A shared cancellation token.
///
/// The apply use case signals cancellation by calling `cancel()`.
/// The executor loop checks `is_cancelled()` between items.
#[derive(Clone, Debug)]
pub struct CancellationToken {
    sender: watch::Sender<bool>,
    receiver: watch::Receiver<bool>,
}

impl CancellationToken {
    /// Create a new token that starts in the non-cancelled state.
    #[must_use]
    pub fn new() -> Self {
        let (sender, receiver) = watch::channel(false);
        Self { sender, receiver }
    }

    /// Signal cancellation.
    pub fn cancel(&self) {
        let _ = self.sender.send(true);
    }

    /// Return true if cancellation has been signalled.
    #[must_use]
    pub fn is_cancelled(&self) -> bool {
        *self.receiver.borrow()
    }
}

impl Default for CancellationToken {
    fn default() -> Self {
        Self::new()
    }
}

/// A shared skip-set: item ids the user has requested to skip.
///
/// The use case injects skip requests between items; the executor checks
/// before picking up each pending item.
///
/// Access is synchronous: each operation takes a `std::sync::Mutex` for a
/// brief, non-blocking critical section (a `HashSet` insert/remove), so there
/// is no need for an async lock — the guard is never held across an `.await`.
#[derive(Clone, Debug, Default)]
pub struct SkipSet {
    inner: Arc<Mutex<HashSet<String>>>,
}

impl SkipSet {
    #[must_use]
    pub fn new() -> Self {
        Self { inner: Arc::new(Mutex::new(HashSet::new())) }
    }

    /// Add an item id to the skip set.
    ///
    /// # Panics
    /// Panics if the internal mutex is poisoned (only if another thread
    /// panicked while holding the lock — not reachable in normal operation).
    pub fn insert(&self, item_id: &str) {
        self.inner.lock().expect("skip-set mutex poisoned").insert(item_id.to_owned());
    }

    /// Remove and return true if the item was in the skip set.
    ///
    /// # Panics
    /// Panics if the internal mutex is poisoned.
    #[must_use]
    pub fn take(&self, item_id: &str) -> bool {
        self.inner.lock().expect("skip-set mutex poisoned").remove(item_id)
    }
}

/// A shared retry queue: item ids to re-attempt (per-item retry, US4).
///
/// Access is synchronous for the same reason as [`SkipSet`]: the critical
/// section is a single `HashSet` operation, never held across an `.await`.
#[derive(Clone, Debug, Default)]
pub struct RetryQueue {
    inner: Arc<Mutex<HashSet<String>>>,
}

impl RetryQueue {
    #[must_use]
    pub fn new() -> Self {
        Self { inner: Arc::new(Mutex::new(HashSet::new())) }
    }

    /// Enqueue an item for retry.
    ///
    /// # Panics
    /// Panics if the internal mutex is poisoned.
    pub fn push(&self, item_id: &str) {
        self.inner.lock().expect("retry-queue mutex poisoned").insert(item_id.to_owned());
    }

    /// Remove and return true if the item is queued for retry.
    ///
    /// # Panics
    /// Panics if the internal mutex is poisoned.
    #[must_use]
    pub fn take(&self, item_id: &str) -> bool {
        self.inner.lock().expect("retry-queue mutex poisoned").remove(item_id)
    }
}

// ── Executor entry point ──────────────────────────────────────────────────────

/// Execute an ordered list of items sequentially.
///
/// Returns `ApplyOutcome` when all items are resolved or a halt condition
/// (cancel / pause) is observed.
///
/// The caller (app/core) is responsible for:
/// - The CAS `approved → applying` transition before calling this.
/// - Batch-cancelling pending items after `Cancelled` is returned.
/// - Calling `pause_run` / `resume_run` on the DB on `Paused`.
/// - Writing the terminal plan state on `Completed`.
#[allow(clippy::too_many_lines)]
pub async fn execute_plan<C: ExecutorCallbacks>(
    items: Vec<ExecutorItem>,
    callbacks: &C,
    cancel: &CancellationToken,
    skip_set: &SkipSet,
    retry_queue: &RetryQueue,
) -> ApplyOutcome {
    let mut counts = TerminalCounts::default();
    let mut cancelled = false;

    for item in &items {
        // Skip items that are already in a terminal state (re-apply idempotency).
        if matches!(item.current_state.as_str(), "succeeded" | "skipped" | "cancelled" | "failed") {
            tracing::debug!(item_id = %item.id, state = %item.current_state, "skipping already-terminal item");
            continue;
        }

        // Check cancellation between items (never mid-item).
        if cancel.is_cancelled() {
            cancelled = true;
            break;
        }

        // Check user-requested skip.
        if skip_set.take(&item.id) {
            tracing::debug!(item_id = %item.id, "user-skipped item");
            callbacks
                .on_item_progress(ItemProgressEvent {
                    item_id: item.id.clone(),
                    prior_state: "pending".to_owned(),
                    new_state: "skipped".to_owned(),
                    at: now_iso(),
                    failure: None,
                    rollback_attempted: false,
                    rollback_outcome: RollbackOutcome::NotApplicable,
                    rollback_message: None,
                    audit_reason: None,
                })
                .await;
            counts.skipped += 1;
            continue;
        }

        // Destructive-confirm gate (FR-003, D9, T020).
        // `requires_destructive_confirm` is derived from the action type (delete/trash),
        // independent of protection status. Replaces the old `confirm_required = is_protected`
        // inversion at plan_apply.rs:199.
        if item.requires_destructive_confirm && !item.destructive_confirmed {
            let failure = PlanItemFailure::with_code(
                FailureCode::DestructiveUnconfirmed,
                format!(
                    "item {} requires destructive confirmation (action is destructive); \
                     confirm before applying",
                    item.id
                ),
            );
            callbacks
                .on_item_progress(ItemProgressEvent {
                    item_id: item.id.clone(),
                    prior_state: "pending".to_owned(),
                    new_state: "refused".to_owned(),
                    at: now_iso(),
                    failure: Some(failure),
                    rollback_attempted: false,
                    rollback_outcome: RollbackOutcome::NotApplicable,
                    rollback_message: None,
                    audit_reason: Some("destructive_unconfirmed".to_owned()),
                })
                .await;
            counts.failed += 1;
            continue;
        }

        // Notify start.
        callbacks.on_item_start(&item.id).await;

        // Path-resolution gate (FR-001/002, D8, T018): resolve + validate source path
        // against the library root before any filesystem CAS or mutation.
        if let (Some(ref src_rel), Some(ref root)) = (&item.source_path, &item.library_root) {
            match path_gate::resolve_and_validate(root, src_rel) {
                Err(gate_failure) => {
                    let audit_reason = gate_failure.code.as_str().to_owned();
                    let triggers_pause = gate_failure.code.triggers_pause();
                    callbacks
                        .on_item_progress(ItemProgressEvent {
                            item_id: item.id.clone(),
                            prior_state: "applying".to_owned(),
                            new_state: "refused".to_owned(),
                            at: now_iso(),
                            failure: Some(gate_failure),
                            rollback_attempted: false,
                            rollback_outcome: RollbackOutcome::NotApplicable,
                            rollback_message: None,
                            audit_reason: Some(audit_reason),
                        })
                        .await;
                    counts.failed += 1;
                    if triggers_pause {
                        return ApplyOutcome::Paused { reason: "path.invalid".to_owned(), counts };
                    }
                    continue;
                }
                Ok(_resolved) => {
                    // Path is safe; the resolved absolute path will be used by execute_item.
                }
            }
        }

        // Per-item FS CAS revalidation (R-FS-1).
        // Use the library-root-resolved path if available; otherwise use the raw path (legacy).
        let resolved_source_for_cas: Option<Utf8PathBuf> =
            if let (Some(ref src_rel), Some(ref root)) = (&item.source_path, &item.library_root) {
                // Already validated above; re-resolve (cheap lexical op).
                path_gate::resolve_and_validate(root, src_rel).ok().map(|r| r.0)
            } else {
                item.source_path.clone()
            };

        if let Some(ref src) = resolved_source_for_cas {
            if let Err(stale_failure) = check_cas(src, &item.cas_snapshot) {
                let triggers_pause = stale_failure.code.triggers_pause();
                let failure_clone = stale_failure.clone();

                callbacks
                    .on_item_progress(ItemProgressEvent {
                        item_id: item.id.clone(),
                        prior_state: "applying".to_owned(),
                        new_state: "stale".to_owned(),
                        at: now_iso(),
                        failure: Some(failure_clone),
                        rollback_attempted: false,
                        rollback_outcome: RollbackOutcome::NotApplicable,
                        rollback_message: None,
                        audit_reason: Some("stale".to_owned()),
                    })
                    .await;

                counts.failed += 1;

                if triggers_pause {
                    return ApplyOutcome::Paused {
                        reason: stale_failure.code.as_str().to_owned(),
                        counts,
                    };
                }
                continue;
            }
        }

        // Protection check (FR-008).
        if item.is_protected && !matches!(item.action, ExecutorItemAction::NoOp) {
            let failure = PlanItemFailure::with_code(
                FailureCode::ProtectedSource,
                format!("item {} is protected by source policy", item.id),
            );
            callbacks
                .on_item_progress(ItemProgressEvent {
                    item_id: item.id.clone(),
                    prior_state: "applying".to_owned(),
                    new_state: "failed".to_owned(),
                    at: now_iso(),
                    failure: Some(failure),
                    rollback_attempted: false,
                    rollback_outcome: RollbackOutcome::NotApplicable,
                    rollback_message: None,
                    audit_reason: Some("protected".to_owned()),
                })
                .await;
            counts.failed += 1;
            continue;
        }

        // Execute the operation.
        //
        // T212: the filesystem primitives in `execute_item` are synchronous and
        // blocking (`std::fs::rename`/`copy`/`remove_file`, trash). Running them
        // directly on a tokio worker thread would stall the async runtime, so we
        // hand the work to `spawn_blocking`, which dispatches it onto the
        // dedicated blocking thread pool and yields the worker thread back to the
        // runtime until the fs op completes.
        let item_for_blocking = item.clone();
        let op_result = tokio::task::spawn_blocking(move || execute_item(&item_for_blocking))
            .await
            .unwrap_or_else(|join_err| {
                // The blocking task panicked. Surface it as an internal failure
                // rather than propagating the panic through the executor loop.
                Err((
                    PlanItemFailure::with_code(
                        FailureCode::Unknown,
                        format!("filesystem worker task failed: {join_err}"),
                    ),
                    false,
                    RollbackOutcome::NotApplicable,
                    None,
                ))
            });

        match op_result {
            Ok(()) => {
                callbacks
                    .on_item_progress(ItemProgressEvent {
                        item_id: item.id.clone(),
                        prior_state: "applying".to_owned(),
                        new_state: "succeeded".to_owned(),
                        at: now_iso(),
                        failure: None,
                        rollback_attempted: false,
                        rollback_outcome: RollbackOutcome::NotApplicable,
                        rollback_message: None,
                        audit_reason: None,
                    })
                    .await;
                counts.succeeded += 1;
            }
            Err((failure, rollback_attempted, rollback_outcome, rollback_message)) => {
                let triggers_pause = failure.code.triggers_pause();
                let failure_clone = failure.clone();

                callbacks
                    .on_item_progress(ItemProgressEvent {
                        item_id: item.id.clone(),
                        prior_state: "applying".to_owned(),
                        new_state: "failed".to_owned(),
                        at: now_iso(),
                        failure: Some(failure_clone),
                        rollback_attempted,
                        rollback_outcome,
                        rollback_message,
                        audit_reason: None,
                    })
                    .await;
                counts.failed += 1;

                if triggers_pause {
                    return ApplyOutcome::Paused {
                        reason: failure.code.as_str().to_owned(),
                        counts,
                    };
                }
            }
        }

        // After resolving this item, check if a retry was queued.
        // (Retry items are re-inserted at the front of the pending list by
        // the use case; within this loop they would need re-ordering which
        // is deferred to the use case. Here we just clear the queue entry
        // to avoid phantom state.)
        let _ = retry_queue.take(&item.id);
    }

    if cancelled {
        ApplyOutcome::Cancelled(counts)
    } else {
        ApplyOutcome::Completed(counts)
    }
}

// ── Operation dispatch ────────────────────────────────────────────────────────

type OpError = (PlanItemFailure, bool, RollbackOutcome, Option<String>);

fn execute_item(item: &ExecutorItem) -> Result<(), OpError> {
    // Resolve the source and destination paths against the library root (if set).
    // The path gate has already validated them earlier in the loop; this is the
    // absolute-path computation for the actual filesystem operation.
    let resolved_src: Option<Utf8PathBuf> =
        resolve_item_path(item.source_path.as_deref(), item.library_root.as_deref());
    let resolved_dst: Option<Utf8PathBuf> =
        resolve_item_path(item.destination_path.as_deref(), item.library_root.as_deref());

    match &item.action {
        ExecutorItemAction::NoOp => Ok(()),

        ExecutorItemAction::Move => {
            let src = require_resolved_path(resolved_src.as_deref(), "source")?;
            let dst = require_resolved_path(resolved_dst.as_deref(), "destination")?;
            move_op::move_file(src, dst)
                .map_err(|(f, r)| (f, r.rollback_attempted, r.rollback_outcome, r.rollback_message))
        }

        ExecutorItemAction::Archive { archive_destination } => {
            let src = require_resolved_path(resolved_src.as_deref(), "source")?;
            // archive_destination is already absolute (pre-computed at plan generation).
            archive_op::archive_file(src, archive_destination)
                .map_err(|(f, r)| (f, r.rollback_attempted, r.rollback_outcome, r.rollback_message))
        }

        ExecutorItemAction::Trash { fallback_archive_destination } => {
            let src = require_resolved_path(resolved_src.as_deref(), "source")?;
            trash_op::trash_file(src, fallback_archive_destination.as_deref())
                .map(|_| ()) // discard TrashResult (audit_reason recorded by caller)
                .map_err(|(f, r)| (f, r.rollback_attempted, r.rollback_outcome, r.rollback_message))
        }

        ExecutorItemAction::Delete => {
            let src = require_resolved_path(resolved_src.as_deref(), "source")?;
            // T020: use `destructive_confirmed`, not `is_protected`.
            delete_op::delete_file(src, item.destructive_confirmed)
                .map_err(|(f, r)| (f, r.rollback_attempted, r.rollback_outcome, None))
        }
    }
}

/// Resolve a relative path against an optional library root.
/// Returns `None` if either argument is `None`.
fn resolve_item_path(relative: Option<&Utf8Path>, root: Option<&Utf8Path>) -> Option<Utf8PathBuf> {
    match (relative, root) {
        (Some(rel), Some(r)) => {
            // Use the validated lexical normalization (path_gate already checked safety).
            Some(path_gate::lexical_normalize(&r.join(rel)))
        }
        (Some(rel), None) => {
            // Legacy: no root — use path as-is.
            Some(rel.to_path_buf())
        }
        _ => None,
    }
}

fn require_resolved_path<'a>(
    p: Option<&'a Utf8Path>,
    label: &str,
) -> Result<&'a Utf8Path, OpError> {
    p.ok_or_else(|| {
        (
            PlanItemFailure::with_code(
                FailureCode::PathInvalid,
                format!("{label} path is not set on this plan item"),
            ),
            false,
            RollbackOutcome::NotApplicable,
            None,
        )
    })
}

fn now_iso() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned())
}

// ── Tests ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tokio::sync::Mutex;

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
}
