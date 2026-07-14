// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Channel inference and merge logic (spec 008 F-2, US4-1, US4-2).
//!
//! Rules per data-model.md §ProjectChannel (research R4):
//!
//! - `infer_channels`: deduplicated, sorted-ascending list of non-empty filter
//!   values across all linked sources.
//! - `merge_channels`: overlay of inferred + manual, preserving manual additions
//!   that are NOT in the inferred set. Manual removals are not tracked as a
//!   separate diff — the DB stores the full channel list. This matches the R4
//!   rule that manual additions persist regardless of source coverage.
//!
//! The simpler interpretation used here (suitable for v1):
//!
//! - `infer_channels(sources)` → sorted, dedup list of non-empty filters tagged
//!   as `source = "inferred"`.
//! - `merge_channels(inferred, existing_channels)` → rebuild: keep all inferred
//!   channels (as inferred), keep manual channels from `existing_channels` that
//!   are NOT in the inferred set (as manual), drop nothing else.
//!   This matches the R4 rule: "Manual additions persist regardless of source coverage."
//!   Re-infer (`reinfer_channels`) replaces the full list with pure inferred output.

/// A lightweight channel record passed between domain functions.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Channel {
    pub label: String,
    /// `"inferred"` or `"manual"`
    pub source: String,
}

impl Channel {
    /// Create an inferred channel.
    #[must_use]
    pub fn inferred(label: impl Into<String>) -> Self {
        Self { label: label.into(), source: "inferred".to_owned() }
    }

    /// Create a manual channel.
    #[must_use]
    pub fn manual(label: impl Into<String>) -> Self {
        Self { label: label.into(), source: "manual".to_owned() }
    }
}

/// Derive the inferred channel list from a slice of (non-empty) filter strings.
///
/// Rules:
/// 1. Collect all non-empty, non-whitespace-only filter values.
/// 2. Deduplicate (case-sensitive per domain decision — filters like "Ha" and
///    "HA" are distinct in PixInsight workflows).
/// 3. Sort ascending.
/// 4. Return as `Channel { source: "inferred" }` entries.
///
/// # Examples
///
/// ```rust
/// use domain_core::project::channels::infer_channels;
/// let ch = infer_channels(&["Ha", "OIII", "Ha", ""]);
/// assert_eq!(ch.len(), 2);
/// assert_eq!(ch[0].label, "Ha");
/// assert_eq!(ch[1].label, "OIII");
/// ```
#[must_use]
pub fn infer_channels(filters: &[&str]) -> Vec<Channel> {
    let mut seen: Vec<String> = filters
        .iter()
        .filter_map(|f| {
            let trimmed = f.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_owned())
            }
        })
        .collect();
    seen.sort_unstable();
    seen.dedup();
    seen.into_iter().map(Channel::inferred).collect()
}

/// Merge a freshly inferred channel list with the project's existing channels.
///
/// Merge rules (R4):
/// - All `inferred` channels from `new_inferred` are kept (marked inferred).
/// - Manual channels from `existing` that do NOT appear in `new_inferred`
///   are appended (marked manual) — preserving user-added channels.
/// - Channels that were in `existing` but are now covered by inference lose
///   the `manual` tag (they become inferred).
///
/// This produces a sorted list (inferred first by label, then manual).
///
/// # Examples
///
/// ```rust
/// use domain_core::project::channels::{Channel, merge_channels};
/// let inferred = vec![Channel::inferred("Ha"), Channel::inferred("OIII")];
/// let existing = vec![
///     Channel::inferred("Ha"),
///     Channel::manual("L"),      // user-added; not in inferred — kept as manual
///     Channel::inferred("SII"),  // was inferred before; not in new inferred — dropped
/// ];
/// let merged = merge_channels(&inferred, &existing);
/// assert_eq!(merged.len(), 3);
/// let labels: Vec<&str> = merged.iter().map(|c| c.label.as_str()).collect();
/// assert!(labels.contains(&"Ha"));
/// assert!(labels.contains(&"OIII"));
/// assert!(labels.contains(&"L"));
/// ```
#[must_use]
pub fn merge_channels(new_inferred: &[Channel], existing: &[Channel]) -> Vec<Channel> {
    let inferred_labels: std::collections::HashSet<&str> =
        new_inferred.iter().map(|c| c.label.as_str()).collect();

    let mut result: Vec<Channel> = new_inferred.to_vec();

    // Add manual channels from existing that are NOT covered by inference.
    for ch in existing {
        if ch.source == "manual" && !inferred_labels.contains(ch.label.as_str()) {
            result.push(Channel::manual(&ch.label));
        }
    }

    result.sort_by(|a, b| a.label.cmp(&b.label));
    result
}

/// Recompute channels from scratch (re-infer). Discards all manual overrides.
/// This is the "Re-infer channels" button from US4-4.
#[must_use]
pub fn reinfer_channels(filters: &[&str]) -> Vec<Channel> {
    infer_channels(filters)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn infer_channels_deduplicates_and_sorts() {
        let ch = infer_channels(&["OIII", "Ha", "Ha", "SII", ""]);
        assert_eq!(ch.len(), 3);
        assert_eq!(ch[0].label, "Ha");
        assert_eq!(ch[1].label, "OIII");
        assert_eq!(ch[2].label, "SII");
        assert!(ch.iter().all(|c| c.source == "inferred"));
    }

    #[test]
    fn infer_channels_skips_empty_and_whitespace() {
        let ch = infer_channels(&["", "  ", "Ha"]);
        assert_eq!(ch.len(), 1);
        assert_eq!(ch[0].label, "Ha");
    }

    #[test]
    fn infer_channels_empty_input_returns_empty() {
        let ch = infer_channels(&[]);
        assert!(ch.is_empty());
    }

    #[test]
    fn merge_channels_keeps_manual_additions() {
        let inferred = vec![Channel::inferred("Ha"), Channel::inferred("OIII")];
        let existing = vec![
            Channel::inferred("Ha"),
            Channel::manual("L"), // user-added
        ];
        let merged = merge_channels(&inferred, &existing);
        assert_eq!(merged.len(), 3);
        let labels: Vec<&str> = merged.iter().map(|c| c.label.as_str()).collect();
        assert!(labels.contains(&"L"));
    }

    #[test]
    fn merge_channels_drops_stale_inferred() {
        // SII was inferred before but is not in the new inferred set.
        let new_inferred = vec![Channel::inferred("Ha")];
        let existing = vec![Channel::inferred("Ha"), Channel::inferred("SII")];
        let merged = merge_channels(&new_inferred, &existing);
        // SII is inferred in existing, not manual → NOT kept.
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].label, "Ha");
    }

    #[test]
    fn reinfer_channels_discards_manual() {
        let ch = reinfer_channels(&["Ha", "OIII"]);
        assert!(ch.iter().all(|c| c.source == "inferred"));
        assert_eq!(ch.len(), 2);
    }
}
