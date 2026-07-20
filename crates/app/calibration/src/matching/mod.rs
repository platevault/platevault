// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Calibration matching use cases (spec 007).
//!
//! Entry points:
//! - `suggest` — suggest ranked calibration masters for a single session.
//! - `batch_suggest` — suggest for multiple sessions in one call.
//! - `assign` — persist a calibration master assignment with override semantics.
//!
//! # Architecture
//!
//! The matching engine lives in `calibration_core` (pure domain, no DB access).
//! This module bridges the domain engine with persistence:
//!   1. Loads session fingerprint from `acquisition_fingerprint` table.
//!   2. Loads master fingerprints from `calibration_fingerprint` table.
//!   3. Loads `MatchingRuleConfig` from settings keys.
//!   4. Delegates to the domain engine.
//!   5. Maps results to contract DTOs.
//!   6. For `assign`: writes to `calibration_assignment` and emits audit events.
//!
//! Fingerprint tables (migration 0023) are populated by the metadata extraction
//! pipeline (spec 005 ripple). Until a session has a fingerprint row, it returns
//! `observer_location_missing` status.
//!
//! Constitution V: assignments are durable records in SQLite.
//! Constitution II: confidence is always captured at assignment time.
//! Constitution III: this module NEVER calibrates images.
//!
//! Split by responsibility (refactor sweep #988): [`suggest`]/[`batch`] are
//! the two suggest entry points; [`assign`] covers assign + unassign;
//! [`masters`] is the T037 masters list/get read surface; [`loaders`] is the
//! shared DB-loading + config-cache layer; [`context`] is the P9 session
//! context enrichment pass; [`responses`] holds the error-response builders.

#![allow(
    clippy::doc_markdown,    // spec/domain terminology
    clippy::too_many_lines,  // use-case orchestration functions are inherently multi-step
    clippy::type_complexity, // DB tuple rows are intentionally typed inline
)]

mod assign;
mod batch;
mod context;
mod loaders;
mod masters;
mod responses;
mod suggest;

#[cfg(test)]
mod tests;

pub use assign::{assign, unassign};
pub use batch::batch_suggest;
pub use masters::{masters_get, masters_list};
pub use suggest::suggest;

// ── Settings keys ─────────────────────────────────────────────────────────────

const KEY_DARK_TEMP: &str = "calibrationDarkTempTolerance";
const KEY_DARK_OVERRIDE: &str = "calibrationDarkOverridePenalty";
const KEY_FLAT_OVERRIDE: &str = "calibrationFlatOverridePenalty";
const KEY_BIAS_OVERRIDE: &str = "calibrationBiasOverridePenalty";
const KEY_PREFILL: &str = "calibrationPrefillSuggestion";
