// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The new-captures feed (bead astro-plan-ef440): the library's per-location
//! new-file counts as the `contracts_core::captures` payload, which is both
//! the `library_new_captures` query reply and its event.

use contracts_core::captures::{NewCaptureCount, NewCaptures};
use platevault_core::new_captures::{self, CaptureWatch};

use crate::channels::{Feed, Latest};

/// The contract payload for the counts `counts`.
#[must_use]
pub fn new_captures(counts: &[new_captures::NewCaptureCount]) -> NewCaptures {
    NewCaptures {
        locations: counts
            .iter()
            .map(|count| NewCaptureCount {
                location_id: count.location_id,
                new_files: u32::try_from(count.new_files).unwrap_or(u32::MAX),
                live: count.live,
            })
            .collect(),
    }
}

/// The current counts first, then each change, until discovery stops.
pub struct NewCapturesFeed {
    counts: Latest<Vec<new_captures::NewCaptureCount>>,
}

impl NewCapturesFeed {
    #[must_use]
    pub fn subscribe(watch: &CaptureWatch) -> Self {
        Self { counts: Latest::new(watch.subscribe()) }
    }
}

impl Feed for NewCapturesFeed {
    type Item = NewCaptures;

    async fn next(&mut self) -> Option<NewCaptures> {
        self.counts.next().await.map(|counts| new_captures(&counts))
    }
}

#[cfg(test)]
mod tests {
    use uuid::Uuid;

    use super::*;

    #[test]
    fn counts_map_to_the_contract_and_saturate() {
        let id = Uuid::new_v4();
        let counts = [new_captures::NewCaptureCount {
            location_id: id,
            new_files: u64::from(u32::MAX) + 7,
            live: false,
        }];
        assert_eq!(
            new_captures(&counts),
            NewCaptures {
                locations: vec![NewCaptureCount {
                    location_id: id,
                    new_files: u32::MAX,
                    live: false
                }]
            }
        );
    }
}
