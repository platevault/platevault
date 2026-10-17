// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Library-shell request DTOs (spec 064 onwards): client input the shell must
//! not deserialize straight into the model type, because that type carries a
//! state only the server sets. Each one converts explicitly into the model
//! type the library takes.

use platevault_model::PreviousItemReview;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

/// The user's review of one file `View (previous)/` still holds (D-W110):
/// keep it where it is, move it into `View/` at the same place, or move it to
/// the OS Trash. The model's `Pending` is the state the catalog records a
/// leftover in, and no client sets it.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum PreviousItemResolution {
    Kept,
    Moved,
    Trashed,
}

impl From<PreviousItemResolution> for PreviousItemReview {
    fn from(resolution: PreviousItemResolution) -> Self {
        match resolution {
            PreviousItemResolution::Kept => Self::Kept,
            PreviousItemResolution::Moved => Self::Moved,
            PreviousItemResolution::Trashed => Self::Trashed,
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn a_resolution_reads_as_the_review_it_names_and_never_as_pending() {
        for (wire, review) in [
            ("kept", PreviousItemReview::Kept),
            ("moved", PreviousItemReview::Moved),
            ("trashed", PreviousItemReview::Trashed),
        ] {
            let resolution: PreviousItemResolution =
                serde_json::from_value(json!(wire)).expect(wire);
            assert_eq!(PreviousItemReview::from(resolution), review);
            assert_eq!(serde_json::to_value(review).expect(wire), json!(wire), "same wire text");
        }
        assert!(serde_json::from_value::<PreviousItemResolution>(json!("pending")).is_err());
    }
}
