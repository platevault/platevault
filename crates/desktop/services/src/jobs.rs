// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Job-progress feeds for the library's long-running work: scans (spec 064)
//! and PIX measurement runs (spec 067).
//!
//! Each feed reads the library's progress broadcast. Progress events can be
//! lost, and polling status is the durable truth (`library_scan_status`,
//! `pix_measurement_status`), so after a broadcast lag a feed re-reads durable
//! status instead of going quiet until the next event.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;

use platevault_core::library::Library;
use platevault_core::{
    LibraryError, MeasurementProgress, MeasurementRun, NativePath, Revision, ScanOperation,
    ScanProgress, ScanState,
};
use serde::Serialize;
use tokio::sync::broadcast::{self, error::RecvError};
use uuid::Uuid;

use crate::channels::Feed;

/// Newest operations re-read from durable status after the progress channel lagged.
const RESYNC_PAGE: u32 = 64;
/// Most recent terminal snapshots a resync recovered whose channel terminal has
/// not arrived yet; older ones are forgotten so a lost terminal cannot leak.
const RETAINED_FINISHED: usize = 256;

/// One committed scan operation snapshot (the `library_scan_progress` event
/// payload): operation id, revision, counts and scope.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type))]
pub struct ScanProgressEvent {
    operation_id: Uuid,
    revision: Revision,
    location_id: Uuid,
    state: ScanState,
    progress: ScanProgress,
    complete_scopes: Vec<NativePath>,
    incomplete_scopes: Vec<NativePath>,
}

impl ScanProgressEvent {
    /// The scan operation this snapshot belongs to.
    #[must_use]
    pub const fn operation_id(&self) -> Uuid {
        self.operation_id
    }
}

impl From<ScanOperation> for ScanProgressEvent {
    fn from(operation: ScanOperation) -> Self {
        Self {
            operation_id: operation.id,
            revision: operation.revision,
            location_id: operation.location_id,
            state: operation.state,
            progress: operation.progress,
            complete_scopes: operation.complete_scopes,
            incomplete_scopes: operation.incomplete_scopes,
        }
    }
}

/// Committed scan snapshots. After broadcast lag it re-reads durable status;
/// per-operation revisions keep it from yielding an older snapshot after a
/// newer one.
pub struct ScanProgressFeed {
    library: Arc<Library>,
    events: broadcast::Receiver<ScanOperation>,
    emitted: Emitted,
    /// Snapshots a resync admitted, yielded before the channel resumes.
    pending: VecDeque<ScanOperation>,
}

impl ScanProgressFeed {
    /// Subscribe to the library's scan progress now.
    #[must_use]
    pub fn subscribe(library: Arc<Library>) -> Self {
        let events = library.subscribe_scan_progress();
        Self { library, events, emitted: Emitted::default(), pending: VecDeque::new() }
    }

    /// Queue durable status of every tracked operation and of Running ones
    /// among the newest; anything else missed is recovered by polling.
    async fn resync(&mut self) -> Result<(), LibraryError> {
        let library = Arc::clone(&self.library);
        let catalog = library.catalog();
        let recent = catalog.list_operations(None, 0, RESYNC_PAGE).await?;
        let mut refreshed = HashSet::with_capacity(recent.len());
        for operation in recent {
            if operation.state == ScanState::Running || self.emitted.tracks(operation.id) {
                refreshed.insert(operation.id);
                self.recover(operation);
            }
        }
        for id in self.emitted.rereads(&refreshed) {
            self.recover(catalog.scan_status(id).await?);
        }
        Ok(())
    }

    fn recover(&mut self, operation: ScanOperation) {
        if self.emitted.admit(&operation, false) {
            self.pending.push_back(operation);
        }
    }
}

impl Feed for ScanProgressFeed {
    type Item = ScanProgressEvent;

    async fn next(&mut self) -> Option<ScanProgressEvent> {
        loop {
            if let Some(operation) = self.pending.pop_front() {
                return Some(operation.into());
            }
            match self.events.recv().await {
                Ok(operation) => {
                    if self.emitted.admit(&operation, true) {
                        return Some(operation.into());
                    }
                }
                Err(RecvError::Lagged(skipped)) => {
                    tracing::warn!(skipped, "scan progress lagged; re-reading durable status");
                    if let Err(error) = self.resync().await {
                        tracing::error!(
                            %error,
                            "scan progress resync failed; clients must poll library_scan_status"
                        );
                    }
                }
                Err(RecvError::Closed) => return None,
            }
        }
    }
}

/// Yielded revision of each operation that may still send a snapshot.
///
/// A terminal snapshot from the channel is its operation's last message, so it
/// ends tracking. `run_scan` commits a terminal state before it sends it, so a
/// terminal a resync read from durable status may still be followed by its
/// channel terminal and by older queued snapshots: its revision is kept until
/// that channel terminal arrives, or until [`RETAINED_FINISHED`] later recovered
/// terminals displace it when the channel never delivers one.
#[derive(Default)]
struct Emitted {
    revisions: HashMap<Uuid, Revision>,
    /// Recovered terminals still awaiting their channel terminal.
    finished: HashSet<Uuid>,
    /// Recovery order of `finished`; entries a channel terminal already ended
    /// are skipped when popped.
    recovered: VecDeque<Uuid>,
}

impl Emitted {
    /// Whether `operation` is newer than its yielded revision, recording it.
    fn admit(&mut self, operation: &ScanOperation, from_channel: bool) -> bool {
        let newer = self.revisions.get(&operation.id).is_none_or(|&seen| operation.revision > seen);
        if from_channel && operation.state != ScanState::Running {
            self.revisions.remove(&operation.id);
            self.finished.remove(&operation.id);
            return newer;
        }
        if newer {
            self.revisions.insert(operation.id, operation.revision);
        }
        if operation.state != ScanState::Running && self.finished.insert(operation.id) {
            self.recovered.push_back(operation.id);
            while self.recovered.len() > RETAINED_FINISHED {
                if let Some(oldest) = self.recovered.pop_front() {
                    if self.finished.remove(&oldest) {
                        self.revisions.remove(&oldest);
                    }
                }
            }
        }
        newer
    }

    fn tracks(&self, id: Uuid) -> bool {
        self.revisions.contains_key(&id)
    }

    /// Tracked operations a resync re-reads by id: those outside `refreshed`
    /// that are still running. A recovered terminal has nothing newer to read.
    fn rereads(&self, refreshed: &HashSet<Uuid>) -> Vec<Uuid> {
        self.revisions
            .keys()
            .filter(|id| !refreshed.contains(*id) && !self.finished.contains(*id))
            .copied()
            .collect()
    }
}

/// Measurement snapshots. Each channel event is one settled frame or state
/// change, so all are yielded; after broadcast lag the Running run's durable
/// status is yielded without a frame.
pub struct MeasurementProgressFeed {
    library: Arc<Library>,
    events: broadcast::Receiver<MeasurementProgress>,
}

impl MeasurementProgressFeed {
    /// Subscribe to the library's measurement progress now.
    #[must_use]
    pub fn subscribe(library: Arc<Library>) -> Self {
        let events = library.frame_review().subscribe_measurement_progress();
        Self { library, events }
    }
}

impl Feed for MeasurementProgressFeed {
    type Item = MeasurementProgress;

    async fn next(&mut self) -> Option<MeasurementProgress> {
        loop {
            match self.events.recv().await {
                Ok(progress) => return Some(progress),
                Err(RecvError::Lagged(skipped)) => {
                    tracing::warn!(
                        skipped,
                        "measurement progress lagged; re-reading durable status"
                    );
                    match self.library.frame_review().running_run().await {
                        Ok(Some(run)) => return Some(frameless(&run)),
                        Ok(None) => {}
                        Err(error) => tracing::error!(
                            %error,
                            "measurement progress resync failed; clients must poll pix_measurement_status"
                        ),
                    }
                }
                Err(RecvError::Closed) => return None,
            }
        }
    }
}

/// The durable status of `run` as a progress snapshot that settles no frame.
fn frameless(run: &MeasurementRun) -> MeasurementProgress {
    MeasurementProgress {
        operation_id: run.operation_id,
        revision: run.revision,
        state: run.state,
        counters: run.counters,
        asset_id: None,
        frame_state: None,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use platevault_core::{ScanOperation, ScanProgress, ScanState};
    use uuid::Uuid;

    use super::{Emitted, ScanProgressEvent, RETAINED_FINISHED};

    fn snapshot(id: Uuid, revision: u64, state: ScanState) -> ScanOperation {
        ScanOperation {
            id,
            revision,
            location_id: Uuid::nil(),
            state,
            progress: ScanProgress::default(),
            issues: Vec::new(),
            complete_scopes: Vec::new(),
            incomplete_scopes: Vec::new(),
            started_at: "2026-10-06T00:00:00Z".into(),
            finished_at: None,
        }
    }

    /// A terminal snapshot recovered by a resync is yielded once; a stale
    /// snapshot still queued from before that resync never follows it.
    #[test]
    fn no_stale_snapshot_follows_a_terminal_recovered_by_resync() {
        let id = Uuid::new_v4();
        let mut emitted = Emitted::default();
        assert!(emitted.admit(&snapshot(id, 1, ScanState::Running), true));
        // The channel lagged past the terminal snapshot; resync reads it.
        assert!(emitted.admit(&snapshot(id, 3, ScanState::Completed), false));
        assert!(!emitted.admit(&snapshot(id, 3, ScanState::Completed), false), "yielded once");
        assert!(!emitted.admit(&snapshot(id, 2, ScanState::Running), true), "stale queued");
    }

    /// `run_scan` commits the terminal state before it sends it: a resync in
    /// that window yields the committed terminal, and the channel's own terminal
    /// that follows is the same revision and is not yielded again.
    #[test]
    fn a_terminal_committed_before_its_channel_send_is_yielded_once() {
        let id = Uuid::new_v4();
        let mut emitted = Emitted::default();
        assert!(emitted.admit(&snapshot(id, 1, ScanState::Running), true));
        assert!(emitted.admit(&snapshot(id, 2, ScanState::Completed), false), "resync yields");
        assert!(!emitted.admit(&snapshot(id, 2, ScanState::Completed), true), "yielded twice");
        assert!(!emitted.tracks(id), "its channel terminal ends tracking");
    }

    /// A terminal whose channel message was lost is never re-read by later
    /// resyncs, and retention of such terminals is bounded.
    #[test]
    fn finished_operations_recovered_by_resync_do_not_leak() {
        let mut emitted = Emitted::default();
        let running = Uuid::new_v4();
        assert!(emitted.admit(&snapshot(running, 1, ScanState::Running), true));
        let lost: Vec<Uuid> = (0..=RETAINED_FINISHED).map(|_| Uuid::new_v4()).collect();
        for id in &lost {
            assert!(emitted.admit(&snapshot(*id, 1, ScanState::Running), true));
            assert!(emitted.admit(&snapshot(*id, 2, ScanState::Failed), false));
        }
        assert_eq!(emitted.rereads(&HashSet::new()), vec![running], "terminals are not re-read");
        assert!(!emitted.tracks(lost[0]), "the oldest lost terminal is forgotten");
        assert!(lost[1..].iter().all(|id| emitted.tracks(*id)));
        assert!(emitted.revisions.len() <= RETAINED_FINISHED + 1, "bounded");
    }

    /// The event payload keeps the `library_scan_progress` contract: camelCase
    /// operation id, revision, location, state, counts and scopes only.
    #[test]
    fn the_scan_progress_event_carries_only_the_contract_fields() {
        let id = Uuid::new_v4();
        let event = ScanProgressEvent::from(snapshot(id, 4, ScanState::Running));
        let json = serde_json::to_value(&event).expect("serialize");
        let fields: HashSet<&str> =
            json.as_object().expect("object").keys().map(String::as_str).collect();
        assert_eq!(
            fields,
            HashSet::from([
                "operationId",
                "revision",
                "locationId",
                "state",
                "progress",
                "completeScopes",
                "incompleteScopes",
            ])
        );
        assert_eq!(json["operationId"], serde_json::json!(id));
        assert_eq!(json["revision"], serde_json::json!(4));
    }
}
