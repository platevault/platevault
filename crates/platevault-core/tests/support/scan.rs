// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Waiting for a scan to finish, for the core and desktop tests.
//!
//! The stored scan status turns terminal at the scan's commit. Target
//! suggestions and calibration matching (LIB-FR-23/24) run after that commit,
//! and the scan's terminal event is published only after them. A test that
//! polls the stored status races those writes; it waits for the event instead.
//!
//! Included by path as `scan_support`, never from `support/mod.rs`, which the
//! library's own unit tests compile as `crate::fixtures`:
//! `#[path = "support/scan.rs"] mod scan_support;` in `crates/platevault-core/tests`,
//! `#[path = "../../../../crates/platevault-core/tests/support/scan.rs"]` in
//! the desktop tests.
#![allow(dead_code)]

use std::sync::Arc;
use std::time::Duration;

use platevault_core::library::Library;
use platevault_core::{ScanOperation, ScanState};
use tokio::sync::broadcast::{error::RecvError, Receiver};
use uuid::Uuid;

/// How long a scan may take to publish its terminal event. Only a hang should
/// fail: on Windows every root check and every duplicate-copy rehash of a scan
/// runs a PowerShell CIM volume query, so a scan beside duplicate copies makes
/// about sixteen. While measurement tests ran their own queries beside the
/// core suite, CI saw ~2 s per query and such a scan pass 20 s; the budget
/// keeps a 3x margin.
pub const PATIENCE: Duration = Duration::from_secs(120);

/// The library's scan events, subscribed before the scan they wait for starts,
/// so its terminal event can't be published unseen.
pub struct ScanWatch(Receiver<ScanOperation>);

impl ScanWatch {
    /// Subscribe now; start the scan after this.
    pub fn new(library: &Library) -> Self {
        Self(library.subscribe_scan_progress())
    }

    /// The terminal event of scan `id`, within `patience`. A receiver that
    /// lagged skips to the oldest event still held. While `id` is the only
    /// scan publishing, its terminal event, published last, is never among
    /// those dropped; a concurrent scan's events could push it out.
    pub async fn terminal(mut self, id: Uuid, patience: Duration) -> ScanOperation {
        tokio::time::timeout(patience, async {
            loop {
                match self.0.recv().await {
                    Ok(operation)
                        if operation.id == id && operation.state != ScanState::Running =>
                    {
                        return operation;
                    }
                    Ok(_) | Err(RecvError::Lagged(_)) => {}
                    Err(RecvError::Closed) => panic!("the library closed its scan events"),
                }
            }
        })
        .await
        .unwrap_or_else(|_| panic!("scan {id} published no terminal state within {patience:?}"))
    }
}

/// Scan the whole `location` and wait for its terminal event.
pub async fn scan_to_end(library: &Arc<Library>, location: Uuid) -> ScanOperation {
    let watch = ScanWatch::new(library);
    let started = library.start_scan(location, None).await.unwrap();
    watch.terminal(started.id, PATIENCE).await
}
