//! Bias frame matching rule (spec 007 US3, FR-005).
#![allow(clippy::collapsible_match, clippy::single_match_else, clippy::must_use_candidate)]
//!
//! Hard dimensions: `gain`, `offset` — exact match required.
//! No soft dimensions: exposure and temperature are explicitly excluded.
//!
//! `dimensions_matched ∪ dimensions_mismatched` contains only `gain` and `offset`.

use crate::candidate::{CalibrationMatch, MatchedDim, MismatchedDim, SelectionReason};
use crate::ranking::MatchingRuleConfig;
use crate::{CalibrationKind, Dimension, MasterInfo, SessionInfo};

/// Evaluate a single bias master against a light session.
///
/// Returns `None` when any active hard-rule dimension fails.
/// Bias matching explicitly NEVER evaluates exposure or temperature.
///
/// When `config.require_same_offset` is false, an offset mismatch or missing
/// offset reduces confidence rather than excluding the candidate.
pub fn evaluate(
    session: &SessionInfo,
    master: &MasterInfo,
    config: &MatchingRuleConfig,
) -> Option<CalibrationMatch> {
    debug_assert_eq!(master.kind, CalibrationKind::Bias);

    let mut matched: Vec<MatchedDim> = Vec::new();
    let mut mismatched: Vec<MismatchedDim> = Vec::new();
    let mut confidence = 1.0_f64;

    // ── Hard rule: gain ───────────────────────────────────────────────────────
    match (session.gain, master.gain) {
        (Some(sg), Some(mg)) => {
            if (sg - mg).abs() < 1e-9 {
                matched.push(MatchedDim::exact(Dimension::Gain));
            } else {
                return None;
            }
        }
        _ => {
            return None;
        }
    }

    // ── Hard rule: offset (controlled by config.require_same_offset) ─────────
    //
    // Mirrors the dark rule: strict by default, relaxable via policy flag.
    match (session.offset, master.offset) {
        (Some(so), Some(mo)) => {
            if (so - mo).abs() < 1e-9 {
                matched.push(MatchedDim::exact(Dimension::Offset));
            } else if config.require_same_offset {
                return None;
            } else {
                mismatched
                    .push(MismatchedDim::out_of_tolerance(Dimension::Offset, (so - mo).abs()));
                confidence -= 0.2;
            }
        }
        _ => {
            if config.require_same_offset {
                return None;
            }
            mismatched.push(MismatchedDim::metadata_missing(Dimension::Offset));
            confidence -= 0.2;
        }
    }

    Some(CalibrationMatch::new(
        session.id.clone(),
        master.id.clone(),
        CalibrationKind::Bias,
        confidence,
        matched,
        mismatched,
        SelectionReason::CompatibleFallback,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(gain: f64, offset: f64) -> SessionInfo {
        SessionInfo {
            id: "ses-bias-001".to_owned(),
            session_type: "light".to_owned(),
            gain: Some(gain),
            offset: Some(offset),
            has_observer_location: true,
            has_exposure_start_utc: true,
            ..Default::default()
        }
    }

    fn bias_master(gain: f64, offset: f64) -> MasterInfo {
        MasterInfo {
            id: "m-bias-001".to_owned(),
            kind: CalibrationKind::Bias,
            gain: Some(gain),
            offset: Some(offset),
            exposure_s: Some(0.001),
            temp_c: Some(-5.0),
            filter: None,
            rotation_deg: None,
            binning: None,
            optic_train: None,
            source_session_id: None,
            observing_night_date: None,
        }
    }

    #[test]
    fn exact_match_confidence_1_0() {
        let r = evaluate(
            &session(100.0, 50.0),
            &bias_master(100.0, 50.0),
            &MatchingRuleConfig::default(),
        );
        let r = r.unwrap();
        assert!((r.confidence - 1.0).abs() < 1e-9, "bias exact match should have confidence 1.0");
        assert!(r.dimensions_mismatched.is_empty(), "bias should have no mismatched dimensions");
    }

    #[test]
    fn gain_mismatch_excludes() {
        let r = evaluate(
            &session(100.0, 50.0),
            &bias_master(200.0, 50.0),
            &MatchingRuleConfig::default(),
        );
        assert!(r.is_none(), "gain mismatch should exclude");
    }

    #[test]
    fn offset_mismatch_excludes() {
        let r = evaluate(
            &session(100.0, 50.0),
            &bias_master(100.0, 75.0),
            &MatchingRuleConfig::default(),
        );
        assert!(r.is_none(), "offset mismatch should exclude");
    }

    #[test]
    fn missing_gain_excludes() {
        let mut s = session(100.0, 50.0);
        s.gain = None;
        let r = evaluate(&s, &bias_master(100.0, 50.0), &MatchingRuleConfig::default());
        assert!(r.is_none(), "missing session gain should exclude");
    }

    #[test]
    fn no_exposure_or_temperature_dimensions_reported() {
        let r = evaluate(
            &session(100.0, 50.0),
            &bias_master(100.0, 50.0),
            &MatchingRuleConfig::default(),
        )
        .unwrap();
        let all_dims: Vec<&str> = r
            .dimensions_matched
            .iter()
            .map(|d| d.dimension.as_str())
            .chain(r.dimensions_mismatched.iter().map(|d| d.dimension.as_str()))
            .collect();
        assert!(!all_dims.contains(&"exposure"), "bias should not report exposure dimension");
        assert!(!all_dims.contains(&"temperature"), "bias should not report temperature dimension");
    }

    #[test]
    fn only_gain_and_offset_dimensions() {
        let r = evaluate(
            &session(100.0, 50.0),
            &bias_master(100.0, 50.0),
            &MatchingRuleConfig::default(),
        )
        .unwrap();
        let matched_dims: Vec<&str> =
            r.dimensions_matched.iter().map(|d| d.dimension.as_str()).collect();
        assert!(matched_dims.contains(&"gain"), "bias should report gain");
        assert!(matched_dims.contains(&"offset"), "bias should report offset");
        assert_eq!(matched_dims.len(), 2, "bias should only have gain and offset dimensions");
    }

    // ── require_same_offset tests ─────────────────────────────────────────────

    #[test]
    fn offset_mismatch_excludes_when_policy_strict() {
        // Default policy: require_same_offset = true → mismatch excludes.
        let r = evaluate(
            &session(100.0, 50.0),
            &bias_master(100.0, 75.0),
            &MatchingRuleConfig::default(),
        );
        assert!(r.is_none(), "strict offset policy should exclude bias on mismatch");
    }

    #[test]
    fn offset_mismatch_accepted_when_policy_relaxed() {
        let config =
            MatchingRuleConfig { require_same_offset: false, ..MatchingRuleConfig::default() };
        let r = evaluate(&session(100.0, 50.0), &bias_master(100.0, 75.0), &config);
        assert!(r.is_some(), "relaxed offset policy should not exclude bias on mismatch");
        let r = r.unwrap();
        assert!(r.confidence < 1.0, "offset mismatch should reduce bias confidence");
        assert!(
            r.dimensions_mismatched.iter().any(|d| d.dimension == "offset"),
            "offset mismatch should appear in dimensions_mismatched"
        );
    }

    #[test]
    fn missing_offset_accepted_when_policy_relaxed() {
        let config =
            MatchingRuleConfig { require_same_offset: false, ..MatchingRuleConfig::default() };
        let mut m = bias_master(100.0, 50.0);
        m.offset = None;
        let r = evaluate(&session(100.0, 50.0), &m, &config);
        assert!(r.is_some(), "relaxed policy should not exclude bias on missing offset");
        let r = r.unwrap();
        assert!(
            r.dimensions_mismatched.iter().any(|d| d.dimension == "offset"
                && d.reason == crate::candidate::MismatchReason::MetadataMissing),
            "missing offset should produce metadata_missing in bias"
        );
    }

    #[test]
    fn missing_offset_excluded_when_policy_strict() {
        let mut m = bias_master(100.0, 50.0);
        m.offset = None;
        let r = evaluate(&session(100.0, 50.0), &m, &MatchingRuleConfig::default());
        assert!(r.is_none(), "strict policy should exclude bias on missing offset");
    }

    #[test]
    fn different_exposure_temp_do_not_affect_result() {
        // Even with completely different exposure/temp in master, bias still matches
        let mut m = bias_master(100.0, 50.0);
        m.exposure_s = Some(999.0);
        m.temp_c = Some(50.0);
        let r = evaluate(&session(100.0, 50.0), &m, &MatchingRuleConfig::default());
        assert!(r.is_some(), "exposure/temp differences should not affect bias matching");
    }
}
