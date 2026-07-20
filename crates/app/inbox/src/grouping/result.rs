// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Grouping engine output types.

/// A deterministic, canonical group key (R-11). Equal keys ⇒ same sub-item.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct GroupKey(pub String);

impl GroupKey {
    /// The canonical string.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for GroupKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// A non-blocking, surfaced metadata-quality warning (R-9 / R-18). Warnings
/// never split a group — they annotate it.
#[derive(Clone, Debug, PartialEq)]
pub enum GroupWarning {
    /// `CCD-TEMP` deviates from `SET-TEMP` beyond the configured threshold
    /// (FR-037). The setpoint still governs the group.
    TempDeviation {
        /// Deviation magnitude in °C.
        deviation_c: f64,
        /// Configured threshold in °C.
        threshold_c: f64,
    },
    /// A flat lacks `ROTATANG` while rotation matching is enabled, and
    /// `flat_rotation_required` is OFF (FR-040, R-18). Matched without rotation.
    RotationUnavailable,
}

/// The full result of grouping one file.
#[derive(Clone, Debug, PartialEq)]
pub struct GroupResult {
    /// Deterministic canonical key (R-11, FR-042).
    pub key: GroupKey,
    /// Human label `"(root) · <type> · <discriminating dims>"` (R-12).
    pub label: GroupLabel,
    /// Non-blocking metadata-quality warnings.
    pub warnings: Vec<GroupWarning>,
}

/// A human-readable group label (R-12).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GroupLabel(pub String);

impl std::fmt::Display for GroupLabel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
