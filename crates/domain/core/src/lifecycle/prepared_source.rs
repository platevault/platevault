// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! PreparedSource lifecycle state model (spec 002 data-model.md).
//! PreparedSourceView model extended for spec 026 (removal/regeneration).

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;
use strum::{EnumString, IntoStaticStr};

use crate::ids::EntityId;

// ── Spec 002 legacy state (kept for lifecycle ledger compatibility) ────────────

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
pub enum PreparedSourceState {
    NotCreated,
    Planned,
    Ready,
    Stale,
    Retired,
}

/// Canonical allowed `(from, to)` edges. Derived from data-model.md §Project
/// edge table side-effects (prepared-source rows are linked at `ready → prepared`,
/// retired at `prepared → ready`) plus the §Plan-Requirement table noting that
/// any `* → retired` edge requires a `FilesystemPlan`.
pub const TRANSITIONS: &[(PreparedSourceState, PreparedSourceState)] = &[
    (PreparedSourceState::NotCreated, PreparedSourceState::Planned),
    (PreparedSourceState::Planned, PreparedSourceState::Ready),
    (PreparedSourceState::Planned, PreparedSourceState::Retired),
    (PreparedSourceState::Ready, PreparedSourceState::Stale),
    (PreparedSourceState::Ready, PreparedSourceState::Retired),
    (PreparedSourceState::Stale, PreparedSourceState::Planned),
    (PreparedSourceState::Stale, PreparedSourceState::Retired),
];

#[must_use]
pub fn is_allowed(from: PreparedSourceState, to: PreparedSourceState) -> bool {
    TRANSITIONS.iter().any(|&(f, t)| f == from && t == to)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PreparedSourceView {
    pub id: EntityId,
    pub project_id: EntityId,
    pub state: PreparedSourceState,
    pub created_at: String,
}

// ── Spec 026 view model ───────────────────────────────────────────────────────

/// The strategy used to materialise a view item on disk.
/// `Hardlink` is reserved for v1.x; v1 only implements symlink/junction/copy
/// (R-026-Strategies, GRILL 2026-05-22).
/// `strum` `serialize_all` mirrors the serde `rename_all`, so the derived
/// `FromStr` / `Into<&'static str>` produce byte-identical persisted strings
/// (`symlink`, `junction`, `copy`, `hardlink`).
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
    EnumString,
    IntoStaticStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum ViewKind {
    Symlink,
    Junction,
    Copy,
    /// Reserved — not implemented in v1 (R-026-Strategies).
    Hardlink,
}

impl ViewKind {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        // `strum::IntoStaticStr` yields the canonical snake_case strings.
        self.into()
    }

    #[must_use]
    pub fn parse_str(s: &str) -> Option<Self> {
        // `strum::EnumString` parses the canonical strings; unknown -> None.
        s.parse().ok()
    }

    /// Returns true for the three v1-supported kinds (not hardlink).
    #[must_use]
    pub fn is_v1_supported(self) -> bool {
        matches!(self, Self::Symlink | Self::Junction | Self::Copy)
    }
}

/// Lifecycle state of a `PreparedSourceView026` record (spec 026 data-model).
///
/// `strum` `serialize_all` mirrors the serde `rename_all`, so the derived
/// `FromStr` / `Into<&'static str>` produce byte-identical persisted strings
/// (`current`, `stale`, `missing`, `removed`, `failed`, `kind_diverged`).
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
    EnumString,
    IntoStaticStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum ViewState {
    /// The view exists on disk and all items are present.
    Current,
    /// At least one item is missing, changed kind, or (for copy-kind) has a
    /// content-hash mismatch.
    Stale,
    /// The entire view folder is missing.
    Missing,
    /// The `ViewRemovalPlan` was successfully applied; membership preserved.
    Removed,
    /// A plan apply reported per-item failures; retry context is in audit.
    Failed,
    /// Pre-existing record whose `kind` disagrees with an item's
    /// `materialization` (D-026-H2). Requires manual resolution.
    KindDiverged,
}

impl ViewState {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        // `strum::IntoStaticStr` yields the canonical snake_case strings.
        self.into()
    }

    #[must_use]
    pub fn parse_str(s: &str) -> Option<Self> {
        // `strum::EnumString` parses the canonical strings; unknown -> None.
        s.parse().ok()
    }

    /// Returns true when view operations (remove / regenerate) are allowed
    /// from this state. `kind_diverged` blocks all ops — user must resolve
    /// via UI first (D-026-H2).
    #[must_use]
    pub fn allows_mutation(self) -> bool {
        !matches!(self, Self::KindDiverged)
    }
}

/// Last-observed per-item state from a stale-detection sweep.
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
pub enum ItemObservedState {
    Present,
    Missing,
    ChangedKind,
    Diverged,
    /// Copy-kind only: content hash no longer matches recorded hash (A3).
    HashDiverged,
}

impl ItemObservedState {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Present => "present",
            Self::Missing => "missing",
            Self::ChangedKind => "changed_kind",
            Self::Diverged => "diverged",
            Self::HashDiverged => "hash_diverged",
        }
    }

    #[must_use]
    pub fn parse_str(s: &str) -> Option<Self> {
        match s {
            "present" => Some(Self::Present),
            "missing" => Some(Self::Missing),
            "changed_kind" => Some(Self::ChangedKind),
            "diverged" => Some(Self::Diverged),
            "hash_diverged" => Some(Self::HashDiverged),
            _ => None,
        }
    }
}

/// A single item within a `PreparedSourceView026`.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PreparedSourceViewItem {
    pub id: EntityId,
    pub view_id: EntityId,
    /// Canonical inventory item this projection references.
    pub inventory_item_id: EntityId,
    /// Path relative to the project workspace where the link/copy lives.
    pub view_relative_path: String,
    /// Actual kind recorded at creation time.
    pub materialization: ViewKind,
    /// State from the last sweep.
    pub last_observed_state: ItemObservedState,
}

/// The canonical record of a generated project source view (spec 026).
///
/// Records are never hard-deleted after removal; `removed_at` is set and
/// `items` membership is preserved for later regeneration indefinitely (A4).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PreparedSourceView026 {
    pub id: EntityId,
    pub project_id: EntityId,
    /// View strategy — all items share this kind at creation (FR-008).
    pub kind: ViewKind,
    pub state: ViewState,
    pub items: Vec<PreparedSourceViewItem>,
    pub created_at: String,
    /// Set when a `ViewRemovalPlan` apply succeeds.
    pub removed_at: Option<String>,
}

impl PreparedSourceView026 {
    /// Returns true if the view's `kind` (its dominant/creation-time
    /// materialization) mismatches any item's own `materialization`.
    ///
    /// This is a descriptive predicate only — NOT an error condition. Spec
    /// 049 CL-2 (2026-07-04) amended FR-008: a cross-drive project's
    /// drive-scope resolution can legitimately produce a view whose items
    /// carry more than one kind (per-item kind is authoritative); such a
    /// view must remain fully usable (removable/regeneratable), see #745.
    /// The genuinely-error state is the distinct `ViewState::KindDiverged`
    /// (a pre-existing record repaired to have a kind inconsistency that
    /// needs manual resolution), not this predicate.
    #[must_use]
    pub fn has_mixed_kind(&self) -> bool {
        self.items.iter().any(|item| item.materialization != self.kind)
    }
}

/// Allowed project lifecycle states for view remove/regenerate operations
/// (R-026-Lifecycle, GRILL 2026-05-22).
pub const ALLOWED_PROJECT_STATES_FOR_VIEW_OPS: &[&str] =
    &["setup_incomplete", "ready", "prepared", "processing", "blocked", "completed"];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn view_kind_roundtrip() {
        for (kind, s) in [
            (ViewKind::Symlink, "symlink"),
            (ViewKind::Junction, "junction"),
            (ViewKind::Copy, "copy"),
            (ViewKind::Hardlink, "hardlink"),
        ] {
            assert_eq!(kind.as_str(), s);
            assert_eq!(ViewKind::parse_str(s), Some(kind));
        }
    }

    #[test]
    fn view_state_roundtrip() {
        for (state, s) in [
            (ViewState::Current, "current"),
            (ViewState::Stale, "stale"),
            (ViewState::Missing, "missing"),
            (ViewState::Removed, "removed"),
            (ViewState::Failed, "failed"),
            (ViewState::KindDiverged, "kind_diverged"),
        ] {
            assert_eq!(state.as_str(), s);
            assert_eq!(ViewState::parse_str(s), Some(state));
        }
    }

    #[test]
    fn hardlink_is_not_v1_supported() {
        assert!(!ViewKind::Hardlink.is_v1_supported());
        assert!(ViewKind::Symlink.is_v1_supported());
        assert!(ViewKind::Junction.is_v1_supported());
        assert!(ViewKind::Copy.is_v1_supported());
    }

    #[test]
    fn kind_diverged_blocks_mutation() {
        assert!(!ViewState::KindDiverged.allows_mutation());
        assert!(ViewState::Current.allows_mutation());
        assert!(ViewState::Removed.allows_mutation());
        assert!(ViewState::Stale.allows_mutation());
    }

    #[test]
    fn mixed_kind_detection() {
        let view_id = EntityId::new();
        let item = PreparedSourceViewItem {
            id: EntityId::new(),
            view_id,
            inventory_item_id: EntityId::new(),
            view_relative_path: "src/file.fit".to_owned(),
            materialization: ViewKind::Junction,
            last_observed_state: ItemObservedState::Present,
        };
        let view = PreparedSourceView026 {
            id: view_id,
            project_id: EntityId::new(),
            kind: ViewKind::Symlink,
            state: ViewState::Current,
            items: vec![item],
            created_at: "2026-01-01T00:00:00Z".to_owned(),
            removed_at: None,
        };
        assert!(view.has_mixed_kind());
    }

    #[test]
    fn no_items_is_not_mixed_kind() {
        let view = PreparedSourceView026 {
            id: EntityId::new(),
            project_id: EntityId::new(),
            kind: ViewKind::Symlink,
            state: ViewState::Removed,
            items: vec![],
            created_at: "2026-01-01T00:00:00Z".to_owned(),
            removed_at: Some("2026-06-01T00:00:00Z".to_owned()),
        };
        assert!(!view.has_mixed_kind());
    }
}
