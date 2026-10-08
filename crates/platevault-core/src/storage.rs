// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Storage custody (spec 071).

mod cleanup;
pub(crate) use cleanup::register as register_cleanup;
// Done / Archive execution (U31): Archive, restore and the three trash moves.
mod archive;
mod overview;
mod trash_moves;
pub use overview::{
    BlockedEntry, DuplicateCandidate, GroupFootprint, GroupRevisionFootprint, LocationAvailability,
    RevisionFootprint, RunFootprint, StorageOverview, TransferItemView, TransferView,
};
