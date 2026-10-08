// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Storage custody (spec 071).

mod cleanup;
pub(crate) use cleanup::register as register_cleanup;
mod overview;
pub use overview::{
    BlockedEntry, DuplicateCandidate, LocationAvailability, RevisionFootprint, RunFootprint,
    StorageOverview, TransferItemView, TransferView,
};
