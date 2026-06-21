//! Stored settings domain types (spec 042 T254).
//!
//! These types are the durable, on-disk representation of the v1 settings bag
//! and per-source overrides. They live in `domain_core` (the lowest layer) so
//! the persistence layer can depend on them without importing the transport
//! crate (`contracts_core`). `contracts_core` re-exports them so the IPC /
//! binding surface is byte-identical to before the move.
//!
//! The serde derives (`rename_all = "camelCase"`, field shapes,
//! `skip_serializing_if`) are preserved verbatim from the former
//! `contracts_core::settings` definitions so the persisted JSON and the
//! generated TypeScript bindings are unchanged.

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::JsonAny;

// ── PatternPart (data-model.md §Pattern Part) ─────────────────────────────

/// One token or separator in the project folder naming pattern.
///
/// `kind` is `"token"` (resolves at materialization) or `"separator"` (literal).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PatternPart {
    /// Stable identifier for drag-reorder.
    pub id: String,
    /// `"token"` or `"separator"`.
    pub kind: String,
    /// Token name (e.g. `"target"`) or literal separator character.
    pub value: String,
}

// ── ImageTypMapping (data-model.md absorbed keys §F) ─────────────────────

/// User-extensible IMAGETYP normalization entry (spec 005 R-IMAGETYP-Norm).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ImageTypMapping {
    pub imagetyp_string: String,
    pub frame_type: String,
}

// ── SettingsState v1 ──────────────────────────────────────────────────────

/// Complete v1 settings bag (data-model.md §`SettingsState` v1).
///
/// Fields that hold structured-path key values (`tools.*`, `workflow_profile.*`)
/// that cannot be statically typed are captured in `extra`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
// This is a flat data-transfer bag; bools are intentional per the spec data-model.
#[allow(clippy::struct_excessive_bools)]
pub struct SettingsState {
    // ── Naming & Structure ──────────────────────────────────────────────
    /// Project folder token pattern. Noisy key.
    pub pattern: Vec<PatternPart>,
    /// Whether new projects adopt the pattern without confirmation.
    pub auto_apply_pattern: bool,

    // ── Ingestion & Review ──────────────────────────────────────────────
    /// Forces a preview step before any filesystem plan is generated.
    pub always_preview_before_plan: bool,

    // ── Data Sources ────────────────────────────────────────────────────
    /// Follow symlinks during scan. Off by default (constitution §I).
    pub follow_symlinks: bool,
    /// Hashing strategy: `"lazy"` | `"eager"` | `"off"`.
    pub hash_on_scan: String,

    // ── Calibration ─────────────────────────────────────────────────────
    /// Dark frame match tolerance: `"strict"` | `"loose"` | `"any"`.
    pub dark_match_tolerance: String,
    /// Flat matching: `"filter-rot"` | `"filter"` | `"manual"`.
    pub flat_matching: String,
    /// Whether to surface calibration suggestions.
    pub suggest_calibration: bool,

    // ── Advanced / density ────────────────────────────────────────────────
    /// Row density (retained for mockup; FR-006 removes it later via T032).
    pub row_density: String,

    // ── Application Log ──────────────────────────────────────────────────
    /// Log level: `"error"` | `"warn"` | `"info"` | `"debug"`.
    pub log_level: String,
    /// Whether follow-tail toggle persists across restarts. Noisy.
    pub remember_follow_logs: bool,

    // ── Source Protection ────────────────────────────────────────────────
    /// Default protection level: `"protected"` | `"normal"` | `"unprotected"`.
    pub default_protection: String,
    /// Routes destructive operations to archive/trash workflows.
    pub block_permanent_delete: bool,
    /// Protected category strings. Noisy.
    pub protected_categories: Vec<String>,

    // ── Absorbed keys (spec 018 Phase 9) ────────────────────────────────
    /// Currently-open library id (spec 020 R-Lib-V1).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_library_id: Option<String>,

    /// Runtime developer-mode toggle. Always `false` in release builds.
    pub dev_mode: bool,

    /// UI hides terminal plans older than this many days. Noisy.
    pub plans_list_default_age_cutoff_days: f64,

    /// Dark frame temperature matching tolerance in °C (spec 007 A5).
    pub calibration_dark_temp_tolerance: f64,

    /// Pre-fill the calibration assign dialog with the top candidate (spec 007 R-Prefill).
    pub calibration_prefill_suggestion: bool,

    /// Confidence penalty when user overrides dark suggestion [0,1] (spec 007).
    pub calibration_dark_override_penalty: f64,

    /// Confidence penalty when user overrides flat suggestion [0,1] (spec 007).
    pub calibration_flat_override_penalty: f64,

    /// Confidence penalty when user overrides bias suggestion [0,1] (spec 007).
    pub calibration_bias_override_penalty: f64,

    /// Days after which a calibration master is considered aging (spec 007/018 FR-023).
    /// Consumers compare `master.age_days` against this value instead of hardcoding 90.
    pub calibration_aging_threshold_days: f64,

    /// User-extensible IMAGETYP normalization entries (spec 005 R-IMAGETYP-Norm).
    pub imagetyp_normalization_user_mappings: Vec<ImageTypMapping>,
}

impl Default for SettingsState {
    fn default() -> Self {
        Self {
            pattern: default_pattern(),
            auto_apply_pattern: true,
            always_preview_before_plan: false,
            follow_symlinks: false,
            hash_on_scan: "lazy".to_owned(),
            dark_match_tolerance: "strict".to_owned(),
            flat_matching: "filter-rot".to_owned(),
            suggest_calibration: true,
            row_density: "dense".to_owned(),
            log_level: "info".to_owned(),
            remember_follow_logs: false,
            default_protection: "protected".to_owned(),
            block_permanent_delete: true,
            protected_categories: vec![
                "lights".to_owned(),
                "masters".to_owned(),
                "finals".to_owned(),
            ],
            current_library_id: None,
            dev_mode: false,
            plans_list_default_age_cutoff_days: 90.0,
            calibration_dark_temp_tolerance: 2.0,
            calibration_prefill_suggestion: true,
            calibration_dark_override_penalty: 0.3,
            calibration_flat_override_penalty: 0.3,
            calibration_bias_override_penalty: 0.3,
            calibration_aging_threshold_days: 90.0,
            imagetyp_normalization_user_mappings: vec![],
        }
    }
}

fn default_pattern() -> Vec<PatternPart> {
    vec![
        PatternPart { id: "p0".to_owned(), kind: "token".to_owned(), value: "target".to_owned() },
        PatternPart { id: "p1".to_owned(), kind: "separator".to_owned(), value: "/".to_owned() },
        PatternPart { id: "p2".to_owned(), kind: "token".to_owned(), value: "filter".to_owned() },
        PatternPart { id: "p3".to_owned(), kind: "separator".to_owned(), value: "/".to_owned() },
        PatternPart { id: "p4".to_owned(), kind: "token".to_owned(), value: "date".to_owned() },
        PatternPart { id: "p5".to_owned(), kind: "separator".to_owned(), value: "/".to_owned() },
        PatternPart {
            id: "p6".to_owned(),
            kind: "token".to_owned(),
            value: "frame_type".to_owned(),
        },
        PatternPart { id: "p7".to_owned(), kind: "separator".to_owned(), value: "/".to_owned() },
    ]
}

// ── SourceOverride ────────────────────────────────────────────────────────

/// Per-source override of an overridable settings key (data-model.md §`SourceOverride`).
///
/// Overridable keys: `followSymlinks`, `hashOnScan`, `defaultProtection`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SourceOverride {
    pub source_id: String,
    pub key: String,
    pub value: JsonAny,
    pub updated_at: String,
}
