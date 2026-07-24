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

// ── Inbox-confirm attribution (F-Framing-5/6/10, FR-019/FR-020/FR-022) ────────

/// One ranked suggestion from the Inbox-confirm attribution pass
/// (data-model.md `IngestionAttributionCandidate`). A **suggestion surface**
/// only — it never writes a merge (FR-019/FR-020); the user picks via
/// [`ChosenAttributionDto`] on the confirm request (FR-022).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum IngestionAttributionKind {
    AddToFraming,
    NewFraming,
    FlagOpticDifference,
    NewProject,
}

/// A ranked attribution candidate (data-model.md §`IngestionAttributionCandidate`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct IngestionAttributionCandidateDto {
    pub kind: IngestionAttributionKind,
    /// Present for every kind except a match-less pass (the caller always
    /// receives at least one candidate — a trailing zero-score `new_project`
    /// candidate with no `projectId` when nothing else matched).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    /// Present for `add_to_framing`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub framing_id: Option<String>,
    /// The matched target, when one resolved.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_id: Option<String>,
    /// Ranking key: framing-match strength (target+optic-train+pointing+rotation).
    /// Higher is a closer match; candidates are returned in descending order.
    pub match_score: f32,
    /// `true` when `projectId` is a `completed` project — selecting this
    /// candidate offers add + reopen (Q25 revoke/warn, F-Framing-6).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reopen: Option<bool>,
    /// `true` for `flag_optic_difference`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub optic_mismatch: Option<bool>,
}

/// The user's attribution pick (data-model.md §Apply-path, FR-022) — an
/// additive field on the Inbox confirm request. `Unassigned` (or omitting
/// this field entirely) leaves the confirmed session's framing membership
/// unset, attributable later via `framing.reassign`.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ChosenAttributionKind {
    AddToFraming,
    NewFraming,
    FlagOpticDifference,
    NewProject,
    Unassigned,
}

/// Request payload for the attribution apply-path (data-model.md `chosenAttribution?`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ChosenAttributionDto {
    pub kind: ChosenAttributionKind,
    /// Required for `new_framing` / `flag_optic_difference` (the existing
    /// project to create the new framing under). Ignored for `new_project`
    /// (a project is created) and `unassigned`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    /// Required for `add_to_framing`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub framing_id: Option<String>,
}

/// Outcome of applying a [`ChosenAttributionDto`] at confirm time
/// (F-Framing-10/6). Returned alongside the confirm response so the UI can
/// surface the reopen/warning without a follow-up read.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AttributionAppliedDto {
    pub project_id: String,
    /// `None` for `unassigned`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub framing_id: Option<String>,
    /// `true` when this pick triggered a `completed -> processing` reopen
    /// (F-Framing-6, spec-009's existing edge).
    pub reopened: bool,
    /// `true` when `reopened` and the project's raw subs have already been
    /// archived via a cleanup plan (Q25 raw-subs-archived reopen warning) —
    /// a degraded reopen the user should be aware of.
    pub raw_subs_archived_warning: bool,
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

    // ── Attribution DTOs (F-Framing-5/10) ──────────────────────────────────

    #[test]
    fn ingestion_attribution_kind_serializes_snake_case() {
        assert_eq!(
            serde_json::to_string(&IngestionAttributionKind::AddToFraming).unwrap(),
            r#""add_to_framing""#
        );
        assert_eq!(
            serde_json::to_string(&IngestionAttributionKind::FlagOpticDifference).unwrap(),
            r#""flag_optic_difference""#
        );
    }

    #[test]
    fn chosen_attribution_kind_serializes_snake_case() {
        assert_eq!(
            serde_json::to_string(&ChosenAttributionKind::Unassigned).unwrap(),
            r#""unassigned""#
        );
    }

    #[test]
    fn chosen_attribution_dto_round_trips_camel_case() {
        let dto = ChosenAttributionDto {
            kind: ChosenAttributionKind::AddToFraming,
            project_id: Some("proj-1".to_owned()),
            framing_id: Some("framing-1".to_owned()),
        };
        let json = serde_json::to_value(&dto).unwrap();
        assert_eq!(json["kind"], "add_to_framing");
        assert_eq!(json["projectId"], "proj-1");
        assert_eq!(json["framingId"], "framing-1");
        let back: ChosenAttributionDto = serde_json::from_value(json).unwrap();
        assert_eq!(back, dto);
    }

    #[test]
    fn ingestion_attribution_candidate_omits_absent_optionals() {
        let dto = IngestionAttributionCandidateDto {
            kind: IngestionAttributionKind::NewProject,
            project_id: None,
            framing_id: None,
            target_id: None,
            match_score: 0.0,
            reopen: None,
            optic_mismatch: None,
        };
        let json = serde_json::to_value(&dto).unwrap();
        let obj = json.as_object().unwrap();
        assert!(!obj.contains_key("projectId"));
        assert!(!obj.contains_key("framingId"));
        assert!(!obj.contains_key("reopen"));
        assert!(!obj.contains_key("opticMismatch"));
    }
}
