//! Workflow artifact observation crate (spec 012).
//!
//! Provides pure-domain types and logic for:
//! - `rules`        — `ArtifactRule` shape (kind, match, confidence, priority).
//! - `default_rules` — seeded PixInsight + Siril rule sets.
//! - `classifier`   — rule-driven classification of observed file names.
//! - `watcher`      — stable-size debounce and extension pre-filter logic.
//! - `reconciler`   — on-attach rescan comparing disk vs DB rows.
//! - `attribution`  — tool-launch attribution by app-clock window.
//! - `project_mapping` — path→project attribution (WP-012-A): longest-prefix
//!   match of a detected path against known project root paths.
//!
//! All filesystem I/O and clock calls are injected via closures/traits so
//! every module is unit-testable without real fs events or sleeps.
//!
//! Constitution III: this crate NEVER processes images. It observes file
//! names and metadata (size, mtime) only, without opening file contents.
#![allow(clippy::doc_markdown)] // spec/domain terminology

pub mod attribution;
pub mod classifier;
pub mod default_rules;
pub mod project_mapping;
pub mod reconciler;
pub mod rules;
pub mod watcher;

// Re-export the most commonly used types.
pub use attribution::{attribute, reattribute_candidates, LaunchRef, DEFAULT_ATTRIBUTION_WINDOW};
pub use classifier::{classify, ClassificationResult, ClassificationSource};
pub use default_rules::all as default_artifact_rules;
pub use project_mapping::{resolve_project_for_path, ProjectPathRef};
pub use reconciler::{reconcile, NewDetection, ReconcileOutcome, ReconcileReport};
pub use rules::{ArtifactKind, ArtifactRule, MatchKind};
pub use watcher::{
    check_stability, extension_allowed, FileSnapshot, StabilityStatus, WatchEvent, WatchEventKind,
    DEFAULT_WATCH_EXTENSIONS,
};
