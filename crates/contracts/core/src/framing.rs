// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Spec 008 Q27 (Phase F) framing contract DTOs: `framing.list`,
//! `framing.merge`, `framing.split`, `framing.reassign`.
//!
//! Mirrors `specs/008-project-create-onboard-edit/data-model.md` §Framing.
//! Authored during implementation (F-Framing-3) per plan.md's Phase F note —
//! no separate JSON Schema exists yet for these four operations (the seven
//! spec-008 schemas under `specs/008-project-create-onboard-edit/contracts/`
//! predate the Q27 iteration).
//!
//! Field names follow the data-model pseudocode (`pointing: { ra, dec }`,
//! `tolerance: { pointing, rotation }`) rather than inventing new unit-suffixed
//! names, so the wire shape stays traceable to the spec.
//!
//! These are **membership-only** mutations (FR-015): merge/split/reassign
//! never touch a framing's `targetId`/`opticTrainKey`/`pointing`/`rotation`/
//! `tolerance` snapshot — only `sessionIds` and `clustering` change.

use serde::{Deserialize, Serialize};
use specta::Type;

// ── Shared sub-types ──────────────────────────────────────────────────────────

/// Representative pointing, degrees ICRS (data-model.md `Framing.pointing`).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FramingPointingDto {
    pub ra: f64,
    pub dec: f64,
}

/// Snapshot of the tunable tolerance the clustering pass used (FR-014;
/// data-model.md `Framing.tolerance`). Never an exact-match key.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FramingToleranceDto {
    pub pointing: f64,
    pub rotation: f64,
}

/// Clustering provenance (FR-015). `Suggested` is the app's own tolerance-based
/// grouping; `UserAdjusted` marks a framing a user has merged, split, or
/// reassigned into — re-derivation (F-Framing-2) never modifies it.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum FramingClustering {
    Suggested,
    UserAdjusted,
}

impl FramingClustering {
    /// Parse the DB-stored `"suggested"` / `"user_adjusted"` string. Any other
    /// value degrades to `Suggested` rather than panicking — the CHECK
    /// constraint on the `framing.clustering` column (migration 0064) is the
    /// real guard against bad data.
    #[must_use]
    pub fn from_db_str(s: &str) -> Self {
        if s == "user_adjusted" {
            Self::UserAdjusted
        } else {
            Self::Suggested
        }
    }

    /// The DB-stored string for this value.
    #[must_use]
    pub const fn as_db_str(self) -> &'static str {
        match self {
            Self::Suggested => "suggested",
            Self::UserAdjusted => "user_adjusted",
        }
    }
}

/// A framing (spec 008 Q27 data-model.md `Framing`) — the co-registerable
/// integration unit within a project.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FramingDto {
    pub id: String,
    pub project_id: String,
    /// `null` for a framing whose target has not yet resolved, or before the
    /// Q20/Q10 projections attach one. Equal to the project's declared target
    /// for mosaic panels (FR-017) and for the single active framing of a
    /// non-mosaic project (FR-016).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_id: Option<String>,
    pub optic_train_key: String,
    pub pointing: FramingPointingDto,
    /// Representative rotation, degrees.
    pub rotation: f64,
    pub tolerance: FramingToleranceDto,
    pub session_ids: Vec<String>,
    pub clustering: FramingClustering,
}

// ── framing.list ─────────────────────────────────────────────────────────────

/// Request body for `framing.list`.
#[derive(Clone, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FramingListRequest {
    pub project_id: String,
}

/// Response body for `framing.list`.
#[derive(Clone, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FramingListResponse {
    pub framings: Vec<FramingDto>,
}

// ── framing.merge ────────────────────────────────────────────────────────────

/// Request body for `framing.merge`: fold `mergeFramingIds` into
/// `primaryFramingId`. The merged-away framings are deleted; their sessions
/// become members of `primaryFramingId`, which flips to `user_adjusted`.
#[derive(Clone, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FramingMergeRequest {
    pub request_id: String,
    pub project_id: String,
    pub primary_framing_id: String,
    /// At least one id, all distinct from `primaryFramingId` and belonging to
    /// the same project.
    pub merge_framing_ids: Vec<String>,
}

/// Successful result from `framing.merge`.
#[derive(Clone, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FramingMergeResult {
    pub project_id: String,
    /// The surviving framing with its post-merge membership.
    pub framing: FramingDto,
    pub removed_framing_ids: Vec<String>,
    pub audit_id: String,
}

// ── framing.split ────────────────────────────────────────────────────────────

/// Request body for `framing.split`: move `sessionIds` (a non-empty proper
/// subset of `sourceFramingId`'s members) into a brand-new framing. The new
/// framing inherits `sourceFramingId`'s target/optic-train/pointing/rotation/
/// tolerance snapshot unchanged (membership-only mutation, FR-015); both the
/// source and the new framing flip to `user_adjusted`.
#[derive(Clone, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FramingSplitRequest {
    pub request_id: String,
    pub project_id: String,
    pub source_framing_id: String,
    /// Must be non-empty and leave at least one session behind in
    /// `sourceFramingId`.
    pub session_ids: Vec<String>,
}

/// Successful result from `framing.split`.
#[derive(Clone, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FramingSplitResult {
    pub project_id: String,
    pub source_framing: FramingDto,
    pub new_framing: FramingDto,
    pub audit_id: String,
}

// ── framing.reassign ─────────────────────────────────────────────────────────

/// Request body for `framing.reassign`: move `sessionIds` into
/// `targetFramingId`, whether they currently belong to another framing of the
/// same project or to none. `targetFramingId` flips to `user_adjusted`, as
/// does any framing a session was moved out of.
#[derive(Clone, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FramingReassignRequest {
    pub request_id: String,
    pub project_id: String,
    pub session_ids: Vec<String>,
    pub target_framing_id: String,
}

/// Successful result from `framing.reassign`.
#[derive(Clone, Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FramingReassignResult {
    pub project_id: String,
    pub target_framing: FramingDto,
    /// `targetFramingId` plus every framing a session was moved out of —
    /// callers should invalidate/refetch all of these.
    pub affected_framing_ids: Vec<String>,
    pub audit_id: String,
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clustering_db_str_round_trips() {
        for s in ["suggested", "user_adjusted"] {
            let c = FramingClustering::from_db_str(s);
            assert_eq!(c.as_db_str(), s);
        }
    }

    #[test]
    fn clustering_unknown_db_str_degrades_to_suggested() {
        assert_eq!(FramingClustering::from_db_str("bogus"), FramingClustering::Suggested);
    }

    #[test]
    fn clustering_serializes_snake_case() {
        assert_eq!(
            serde_json::to_string(&FramingClustering::UserAdjusted).unwrap(),
            r#""user_adjusted""#
        );
    }
}
