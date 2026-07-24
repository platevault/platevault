// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Rust-side contract DTOs for onboarding commands (spec 056).
//!
//! Replaces the removed spec-010 coach and tour operations — see
//! `contracts/onboarding-commands.md`. Five commands:
//! - `onboarding.state.get`          — read the full projection for UI hydration.
//! - `onboarding.item.set_state`     — manual check-off or dismiss (FR-017).
//! - `onboarding.orientation.complete` — mark the L1 walk finished/skipped.
//! - `onboarding.section.set`        — explicit remove + collapse persistence.
//! - `onboarding.restore`            — the single Settings → Advanced restore/reset.
//!
//! Plus the `onboarding:state-changed` notification payload (backend → frontend).

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

// ── Shared enums ──────────────────────────────────────────────────────────────

/// Per-item lifecycle state (data-model.md "State transitions").
///
/// `AutoChecked`/`ManuallyChecked`/`Dismissed` are terminal: neither a live
/// event nor a repeat manual action ever downgrades a settled item.
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
pub enum OnboardingItemState {
    Unchecked,
    AutoChecked,
    ManuallyChecked,
    Dismissed,
}

/// What set the item's current state.
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
pub enum OnboardingStateSource {
    Seed,
    Event,
    User,
}

/// The five FR-006 workflow pages that carry a Getting Started checklist.
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
pub enum OnboardingPage {
    Inbox,
    Sessions,
    Calibration,
    Targets,
    Projects,
}

// ── Shared row/projection DTOs ───────────────────────────────────────────────

/// Prerequisite presentation for an item whose upstream milestone is missing
/// (FR-010).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingPrerequisiteDto {
    /// Registry id of the upstream item that must be done first.
    ///
    /// The UI needs the id itself, not just the rendered reason: a blocked
    /// item's find affordance spotlights the UPSTREAM item's control, which
    /// means resolving the upstream item's anchor and label. Recovering it by
    /// stripping a prefix off `reason_key` would couple the UI to a message-key
    /// format.
    pub upstream_item_id: String,
    /// Whether the upstream milestone is currently satisfied.
    pub met: bool,
    /// Paraglide message key for the human-readable reason.
    pub reason_key: String,
    /// Page to jump to in order to satisfy the prerequisite.
    pub jump_page: OnboardingPage,
}

/// One onboarding item row for UI hydration.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingItemDto {
    pub item_id: String,
    pub page: OnboardingPage,
    pub state: OnboardingItemState,
    /// RFC-3339 UTC timestamp of the last state change.
    pub at: String,
    pub source: OnboardingStateSource,
    /// `None` when the item has no prerequisite in the registry. Present
    /// (with a live-computed `met`) whenever the item has one, regardless of
    /// current satisfaction — the UI decides what to render for `met: true`.
    pub prerequisite: Option<OnboardingPrerequisiteDto>,
    /// True when this item has a `completion_topic` (auto-tick eligible) —
    /// lets the UI distinguish "will tick itself" from "check me manually".
    pub has_auto_tick: bool,
}

/// Section-level flags (`onboarding_flags` singleton).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingFlagsDto {
    pub orientation_done: bool,
    /// Covers both explicit removal (FR-013) and completion auto-hide
    /// (FR-031).
    pub section_hidden: bool,
    pub sidebar_collapsed: bool,
}

/// Per-page item counts.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingPageProgressDto {
    pub page: OnboardingPage,
    pub done: u32,
    pub total: u32,
}

/// Overall + per-page progress, derived from `onboarding_state` (never
/// stored).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingProgressDto {
    pub done: u32,
    pub total: u32,
    pub per_page: Vec<OnboardingPageProgressDto>,
}

/// Full onboarding projection — the response shape shared by
/// `onboarding.state.get` and `onboarding.restore`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingStateDto {
    pub items: Vec<OnboardingItemDto>,
    pub flags: OnboardingFlagsDto,
    pub progress: OnboardingProgressDto,
}

// ── onboarding.state.get ─────────────────────────────────────────────────────

/// Response from `onboarding.state.get`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingStateGetResponse {
    pub state: OnboardingStateDto,
}

// ── onboarding.item.set_state ────────────────────────────────────────────────

/// Manual state a caller may request via `onboarding.item.set_state`
/// (FR-017). `auto_checked` is rejected — `invalid_state` — because only the
/// bus subscriber may assert that real work happened.
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
pub enum OnboardingManualState {
    ManuallyChecked,
    Dismissed,
    /// Explicit un-check — the only transition that may clear a settled row.
    ///
    /// Settled states are otherwise terminal so re-derivation, live ticks and
    /// repeat calls can never *silently* downgrade a user's decision. An
    /// un-check is the user asking for exactly that, once, by hand, so it is
    /// allowed from ANY state, automatic rows included.
    ///
    /// It does not let the checklist permanently contradict the library: the
    /// item re-ticks when the underlying action happens again, and an explicit
    /// restore re-derives it from real database state.
    Unchecked,
}

/// Request for `onboarding.item.set_state`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingItemSetStateRequest {
    pub item_id: String,
    pub state: OnboardingManualState,
}

/// Response from `onboarding.item.set_state` — the updated item row.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingItemSetStateResponse {
    pub item: OnboardingItemDto,
}

// ── onboarding.orientation.complete ──────────────────────────────────────────

/// How the walk ended (both set done-forever, FR-004).
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
pub enum OnboardingOrientationOutcome {
    Finished,
    Skipped,
}

/// Request for `onboarding.orientation.complete`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingOrientationCompleteRequest {
    pub outcome: OnboardingOrientationOutcome,
}

/// Response from `onboarding.orientation.complete`. Idempotent — repeat
/// calls return the original timestamp.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingOrientationCompleteResponse {
    pub orientation_done_at: String,
}

// ── onboarding.section.set ───────────────────────────────────────────────────

/// Request for `onboarding.section.set`. At least one field MUST be set.
/// `hidden` accepts only `true` (user remove) — unhiding happens exclusively
/// via `onboarding.restore`; `hidden: false` is rejected as `invalid_state`.
/// The completion auto-hide (FR-031) is written by the backend settle path,
/// never through this command.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingSectionSetRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sidebar_collapsed: Option<bool>,
}

/// Response from `onboarding.section.set` — the updated flags.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingSectionSetResponse {
    pub flags: OnboardingFlagsDto,
}

// ── onboarding.restore ───────────────────────────────────────────────────────

/// Response from `onboarding.restore` — same shape as `onboarding.state.get`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingRestoreResponse {
    pub state: OnboardingStateDto,
}

// ── onboarding:state-changed notification ────────────────────────────────────

/// Payload for the `onboarding:state-changed` Tauri notification. A hint
/// only — the frontend re-reads via `onboarding.state.get`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingStateChangedEvent {
    pub item_id: Option<String>,
}
