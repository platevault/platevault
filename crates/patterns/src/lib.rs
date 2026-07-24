// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Token-pattern resolver and validator for Astro Library Manager (spec 015).
//!
//! # Responsibilities
//!
//! - [`PatternPart`] / [`Pattern`]: the data model for an ordered list of tokens
//!   and separators.
//! - [`TokenRegistry`]: the v1 token vocabulary with fallback and transform rules.
//! - [`validate`]: structural validation of a pattern without metadata.
//! - [`resolve`]: full pattern resolution against a [`MetadataBundle`] with
//!   sanitization, path-traversal rejection, reserved-name rejection, and
//!   length caps.
//!
//! This crate has **no database or UI dependencies**. It is consumed by
//! `crates/app/core/src/patterns.rs` for Tauri command wiring.
#![allow(clippy::doc_markdown)] // spec/domain terminology not appropriate for backticks

pub mod per_type;
pub mod registry;
pub mod resolver;
pub mod validator;

pub use per_type::{
    classify_frame, default_pattern, effective_pattern, validate_pattern_str, FrameTypeClass,
    PatternStrError,
};
pub use registry::{TokenDefinition, TokenRegistry, TokenTransform, V1_REGISTRY};
pub use resolver::{
    resolve, resolve_pattern_str, resolve_v1, MetadataBundle, ResolveError, ResolveResult,
    ResolverConfig,
};
pub use validator::{validate, ValidateError, ValidateResult, ValidationWarning};

use serde::{Deserialize, Serialize};

// ── PatternPart ───────────────────────────────────────────────────────────────

/// One element in an ordered pattern: either a metadata token or a literal
/// separator.
///
/// Invariants (enforced by [`validate`]):
/// - `kind = "token"` ⇒ `value` must be a registered token name.
/// - `kind = "separator"` ⇒ `value` must be one of `/`, `-`, `_`, ` `.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatternPart {
    /// Stable client-side identifier (not semantically interpreted by the resolver).
    pub id: String,
    /// `"token"` or `"separator"`.
    pub kind: String,
    /// Token name (e.g. `"target"`) or literal separator character.
    pub value: String,
}

/// A pattern is an ordered list of [`PatternPart`] items.
pub type Pattern = Vec<PatternPart>;

/// Separator characters that are valid in patterns.
pub const VALID_SEPARATORS: &[&str] = &["/", "-", "_", " "];
