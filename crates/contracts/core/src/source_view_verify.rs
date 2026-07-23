// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Contract DTOs for spec 049 US4 — `sourceview.verify` (read-only
//! pre-processing check that every link in a generated source view still
//! resolves to a present canonical source).
//!
//! Mirrors `specs/049-source-view-generation/contracts/sourceview.verify.json`.
//! Follows the same bare-success-DTO convention as
//! `crate::source_view_generate::SourceViewGenerateResponse`: transport
//! envelope fields (`status`/`contractVersion`/`requestId`) are handled by the
//! Tauri/IPC layer, and `view.not_found` surfaces as a `ContractError` rather
//! than the contract JSON's embedded `errors` array.
//!
//! FR-014/FR-015: verification MUST NOT mutate the filesystem and MUST NOT
//! auto-repair; repair is via explicit spec 026 regeneration
//! (`preparedview.regenerate`).

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

/// Request: verify a `PreparedSourceView`'s links without mutating anything.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct SourceViewVerifyRequest {
    pub view_id: String,
}

/// Why a single item failed verification (contract `brokenItems[].state`).
#[derive(
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
    Serialize,
    Deserialize,
    JsonSchema,
    Type,
)]
#[serde(rename_all = "snake_case")]
pub enum BrokenItemState {
    /// The destination path itself no longer exists on disk.
    Missing,
    /// The canonical source (inventory reference) no longer resolves.
    Moved,
    /// The destination link is present but does not resolve to a live source
    /// (a dangling symlink, or its target no longer matches the canonical
    /// source path).
    UnresolvedLink,
    /// The on-disk materialization kind no longer matches the kind recorded
    /// for this item (spec 026 FR-008 mixed-kind concept, per-item).
    ChangedKind,
    /// A copy-kind item's destination content no longer matches the
    /// canonical source (a real file copy, unlike a symlink/hardlink, can
    /// silently drift — spec 026 FR-009 / #746).
    HashDiverged,
}

/// One broken/missing/stale item in a verified view.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct BrokenItem {
    pub inventory_item_id: String,
    pub view_relative_path: String,
    pub state: BrokenItemState,
}

/// Success response for `sourceview.verify`.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct SourceViewVerifyResponse {
    /// `true` when every item resolved to a present canonical source (safe to
    /// process — SC-006). `false` iff `broken_items` is non-empty.
    pub clean: bool,
    /// Empty when `clean`. One entry per broken/missing/stale item.
    #[serde(default)]
    pub broken_items: Vec<BrokenItem>,
}
