// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Stop requests for the long library operations a command runs (Apply,
//! Close): the running command enters its run under an id, another command
//! asks it to stop by that id, and the run leaves when the command returns.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use uuid::Uuid;

/// The runs in progress, by id.
#[derive(Default)]
pub struct Stops(Mutex<HashMap<Uuid, Arc<AtomicBool>>>);

impl Stops {
    fn runs(&self) -> MutexGuard<'_, HashMap<Uuid, Arc<AtomicBool>>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Enter a run under `id` until the returned value drops. A second run
    /// under an id already entered is never reachable by [`Self::stop`]: the
    /// first keeps the id, and the library refuses the second anyway.
    #[must_use = "dropping it leaves the run"]
    pub fn enter(&self, id: Uuid) -> Entered<'_> {
        let flag = Arc::new(AtomicBool::new(false));
        self.runs().entry(id).or_insert_with(|| Arc::clone(&flag));
        Entered { stops: self, id, flag }
    }

    /// Ask the run under `id` to stop; `false` when none runs.
    pub fn stop(&self, id: Uuid) -> bool {
        self.runs().get(&id).is_some_and(|flag| {
            flag.store(true, Ordering::Release);
            true
        })
    }
}

/// One run in [`Stops`]; dropping it leaves.
pub struct Entered<'a> {
    stops: &'a Stops,
    id: Uuid,
    flag: Arc<AtomicBool>,
}

impl Entered<'_> {
    /// Whether a stop was asked for this run.
    pub fn stopped(&self) -> bool {
        self.flag.load(Ordering::Acquire)
    }
}

impl Drop for Entered<'_> {
    fn drop(&mut self) {
        let mut runs = self.stops.runs();
        if runs.get(&self.id).is_some_and(|flag| Arc::ptr_eq(flag, &self.flag)) {
            runs.remove(&self.id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_stop_reaches_only_the_run_that_holds_the_id() {
        let stops = Stops::default();
        let id = Uuid::new_v4();
        assert!(!stops.stop(id), "nothing runs yet");
        let first = stops.enter(id);
        let second = stops.enter(id);
        assert!(stops.stop(id));
        assert!(first.stopped() && !second.stopped());
        drop(second);
        assert!(stops.stop(id), "the second run leaving keeps the first's id");
        drop(first);
        assert!(!stops.stop(id), "the run left with its command");
    }
}
