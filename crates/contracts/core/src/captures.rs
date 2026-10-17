// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! New captures per Captures location (bead astro-plan-ef440): supported
//! frames that arrived in an online Captures location and that the library
//! has not indexed yet, for Home's Pending ingestions.
//!
//! The rebuilt library shell answers the `library_new_captures` query with
//! [`NewCaptures`] and emits the same payload as the [`NEW_CAPTURES_EVENT`]
//! event whenever a count changes. Each payload is the complete current
//! state, so a client replaces what it showed. A location is listed once it
//! has been counted and leaves the list while it is offline, retired or no
//! longer a Captures location.

use serde::{Deserialize, Serialize};
use specta::Type;
use uuid::Uuid;

/// Tauri event carrying a [`NewCaptures`] payload after every change.
pub const NEW_CAPTURES_EVENT: &str = "library_new_captures";

/// The new files of every counted Captures location, by location id.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NewCaptures {
    pub locations: Vec<NewCaptureCount>,
}

/// The new files of one online Captures location.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NewCaptureCount {
    pub location_id: Uuid,
    /// Supported frames below the location that the library does not hold
    /// yet: arrived since its last index, until indexing adds them.
    pub new_files: u32,
    /// Whether a live folder watcher keeps the count current. `false` while
    /// the count may lag: the watcher did not start or misses some folders,
    /// and every sweep retries it, or the location's removable drive is being
    /// ejected.
    pub live: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wire_shape_is_camel_case() {
        let id = Uuid::nil();
        let payload = NewCaptures {
            locations: vec![NewCaptureCount { location_id: id, new_files: 142, live: true }],
        };
        assert_eq!(
            serde_json::to_value(&payload).unwrap(),
            serde_json::json!({
                "locations": [{ "locationId": id.to_string(), "newFiles": 142, "live": true }]
            })
        );
    }
}
