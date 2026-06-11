//! `CalibrationMatch` — the result of a single master evaluation.
#![allow(clippy::must_use_candidate)]
//!
//! Returned by `calibration.match.suggest`; each field maps directly to the
//! JSON Schema in `specs/007-calibration-matching-rules/contracts/calibration.match.suggest.json`.

use serde::{Deserialize, Serialize};

use crate::{CalibrationKind, Dimension};

// ── Dimension detail types ────────────────────────────────────────────────────

/// A dimension that matched between the session and the master.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchedDim {
    pub dimension: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub observed: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference: Option<serde_json::Value>,
    /// Absolute delta for soft dimensions (units depend on dimension).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delta: Option<f64>,
}

impl MatchedDim {
    /// Exact hard-rule match (no numeric delta).
    #[must_use]
    pub fn exact(dimension: Dimension) -> Self {
        Self {
            dimension: dimension.as_str().to_owned(),
            observed: None,
            reference: None,
            delta: None,
        }
    }

    /// Soft match within tolerance — carries numeric delta.
    #[must_use]
    pub fn soft(dimension: Dimension, observed: f64, reference: f64, delta: f64) -> Self {
        Self {
            dimension: dimension.as_str().to_owned(),
            observed: Some(serde_json::json!(observed)),
            reference: Some(serde_json::json!(reference)),
            delta: Some(delta),
        }
    }

    /// Exact match with string values.
    #[must_use]
    pub fn exact_string(dimension: Dimension, value: &str) -> Self {
        Self {
            dimension: dimension.as_str().to_owned(),
            observed: Some(serde_json::json!(value)),
            reference: Some(serde_json::json!(value)),
            delta: None,
        }
    }
}

/// Why a dimension was not satisfied.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MismatchReason {
    /// Value is outside the configured tolerance.
    OutOfTolerance,
    /// The dimension metadata was absent in either the session or the master.
    MetadataMissing,
    /// A hard-rule dimension did not match exactly.
    HardRuleViolation,
}

/// A dimension that did not satisfy the matching rule for this candidate.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MismatchedDim {
    pub dimension: String,
    pub reason: MismatchReason,
    /// Absolute delta when the value was out of tolerance.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delta: Option<f64>,
}

impl MismatchedDim {
    /// Hard-rule violation.
    #[must_use]
    pub fn hard(dimension: Dimension) -> Self {
        Self {
            dimension: dimension.as_str().to_owned(),
            reason: MismatchReason::HardRuleViolation,
            delta: None,
        }
    }

    /// Out-of-tolerance soft dimension with delta.
    #[must_use]
    pub fn out_of_tolerance(dimension: Dimension, delta: f64) -> Self {
        Self {
            dimension: dimension.as_str().to_owned(),
            reason: MismatchReason::OutOfTolerance,
            delta: Some(delta),
        }
    }

    /// Metadata was missing in session or master.
    #[must_use]
    pub fn metadata_missing(dimension: Dimension) -> Self {
        Self {
            dimension: dimension.as_str().to_owned(),
            reason: MismatchReason::MetadataMissing,
            delta: None,
        }
    }
}

/// How this candidate was selected (observing-night provenance).
///
/// Precedence for sort tiebreaking: `SameSession` > `SameNight` > `CompatibleFallback`.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SelectionReason {
    /// The calibration master came from the same acquisition session.
    SameSession,
    /// The calibration master came from the same observing night.
    SameNight,
    /// The calibration master is dimensionally compatible (different night/session).
    CompatibleFallback,
}

impl SelectionReason {
    /// Numeric sort key: lower = higher priority.
    #[must_use]
    pub const fn priority(self) -> u8 {
        match self {
            Self::SameSession => 0,
            Self::SameNight => 1,
            Self::CompatibleFallback => 2,
        }
    }
}

// ── CalibrationMatch ──────────────────────────────────────────────────────────

/// A ranked calibration master suggestion for a light session.
///
/// Returned by `suggest()` and exposed via the `calibration.match.suggest` Tauri command.
/// Invariant 3: `confidence ∈ [0.0, 1.0]`.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationMatch {
    pub session_id: String,
    pub master_id: String,
    pub calibration_type: CalibrationKind,
    /// Scalar confidence clamped to [0.0, 1.0].
    pub confidence: f64,
    pub dimensions_matched: Vec<MatchedDim>,
    pub dimensions_mismatched: Vec<MismatchedDim>,
    pub selection_reason: SelectionReason,
}

impl CalibrationMatch {
    /// Clamp confidence into [0.0, 1.0] per data-model invariant 3.
    #[must_use]
    pub fn new(
        session_id: String,
        master_id: String,
        calibration_type: CalibrationKind,
        confidence: f64,
        dimensions_matched: Vec<MatchedDim>,
        dimensions_mismatched: Vec<MismatchedDim>,
        selection_reason: SelectionReason,
    ) -> Self {
        Self {
            session_id,
            master_id,
            calibration_type,
            confidence: confidence.clamp(0.0, 1.0),
            dimensions_matched,
            dimensions_mismatched,
            selection_reason,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn confidence_clamped_to_zero_when_negative() {
        let m = CalibrationMatch::new(
            "s".to_owned(),
            "m".to_owned(),
            CalibrationKind::Dark,
            -0.5,
            vec![],
            vec![],
            SelectionReason::CompatibleFallback,
        );
        assert!((m.confidence - 0.0).abs() < 1e-9);
    }

    #[test]
    fn confidence_clamped_to_one_when_over() {
        let m = CalibrationMatch::new(
            "s".to_owned(),
            "m".to_owned(),
            CalibrationKind::Dark,
            1.5,
            vec![],
            vec![],
            SelectionReason::CompatibleFallback,
        );
        assert!((m.confidence - 1.0).abs() < 1e-9);
    }

    #[test]
    fn matched_dim_exact() {
        let d = MatchedDim::exact(Dimension::Gain);
        assert_eq!(d.dimension, "gain");
        assert!(d.delta.is_none());
    }

    #[test]
    fn mismatched_dim_serializes_reason() {
        let d = MismatchedDim::hard(Dimension::Offset);
        let j = serde_json::to_value(&d).unwrap();
        assert_eq!(j["reason"], "hard_rule_violation");
    }

    #[test]
    fn selection_reason_priority_ordering() {
        assert!(SelectionReason::SameSession.priority() < SelectionReason::SameNight.priority());
        assert!(
            SelectionReason::SameNight.priority() < SelectionReason::CompatibleFallback.priority()
        );
    }
}
