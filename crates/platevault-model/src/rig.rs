// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Rig (optical train) filter lists and field of view (spec 072 PLAN-EQ-FR-01..06).
//!
//! A rig is a saved [`crate::Equipment`]. Mono or OSC comes from its camera,
//! never from the filter list. Each filter names the FITS FILTER values it
//! matches and the bands it passes.

use std::collections::{BTreeSet, HashMap, HashSet};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{Equipment, LibraryError, Revision};

/// Whether a camera captures through a colour filter array.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ColorKind {
    Mono,
    /// One-shot colour: captures R, G and B without a filter.
    Osc,
}

/// A band a filter passes, in the order the Targets Filters strip lists them.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
pub enum Band {
    L,
    R,
    G,
    B,
    Ha,
    #[serde(rename = "SII")]
    Sii,
    #[serde(rename = "OIII")]
    Oiii,
}

/// One filter on a rig's list.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RigFilter {
    pub id: Uuid,
    pub name: String,
    /// FITS FILTER values this filter matches, compared trimmed, NFC-normalized
    /// and case-insensitively.
    pub match_values: Vec<String>,
    /// Bands the filter passes, at least one, in [`Band`] order.
    pub bands: Vec<Band>,
}

impl RigFilter {
    /// Whether a FITS FILTER value names this filter.
    #[must_use]
    pub fn matches(&self, value: &str) -> bool {
        let key = filter_key(value);
        !key.is_empty() && self.match_values.iter().any(|candidate| filter_key(candidate) == key)
    }
}

/// A rig's durable filter list. `revision` is 0 until the list is first saved.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RigFilters {
    pub equipment_id: Uuid,
    pub revision: Revision,
    pub filters: Vec<RigFilter>,
}

/// Angular field of view of a rig's sensor at its focal length.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldOfView {
    pub width_deg: f64,
    pub height_deg: f64,
}

/// A rig with what its camera and filter list capture.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rig {
    pub equipment: Equipment,
    pub filters: RigFilters,
    /// Bands the rig captures: R, G and B for an OSC camera, plus every band
    /// its filters pass, in [`Band`] order.
    pub bands: Vec<Band>,
    /// `None` when the sensor size, pixel size or focal length is unknown.
    pub field_of_view: Option<FieldOfView>,
}

/// One FILTER value observed on live frames of sessions confirmed to a rig.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RigFilterValue {
    pub value: String,
    pub session_ids: Vec<Uuid>,
}

/// FILTER values seen on one rig's confirmed sessions.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RigFilterValues {
    pub equipment_id: Uuid,
    pub rig_name: String,
    pub values: Vec<RigFilterValue>,
}

/// Comparison key of a FILTER value: trimmed, NFC and lowercase.
fn filter_key(value: &str) -> String {
    use unicode_normalization::UnicodeNormalization;
    value.trim().nfc().collect::<String>().to_lowercase()
}

/// Validate a filter list for saving and return it normalized: names and
/// values trimmed, repeated values of one filter dropped, bands deduplicated in
/// [`Band`] order.
///
/// # Errors
/// `InvalidInput` for an empty name or match value, a filter passing no band, a
/// repeated filter id, or a FILTER value that two filters both match.
pub fn normalize_rig_filters(filters: &[RigFilter]) -> Result<Vec<RigFilter>, LibraryError> {
    let invalid = |message: String| Err(LibraryError::InvalidInput(message));
    let mut ids = HashSet::new();
    let mut owners: HashMap<String, &str> = HashMap::new();
    let mut normalized = Vec::with_capacity(filters.len());
    for filter in filters {
        let name = filter.name.trim();
        if name.is_empty() {
            return invalid("a filter name is empty".into());
        }
        if !ids.insert(filter.id) {
            return invalid(format!("filter {} is listed twice", filter.id));
        }
        let bands: BTreeSet<Band> = filter.bands.iter().copied().collect();
        if bands.is_empty() {
            return invalid(format!("filter {name} passes no band"));
        }
        let mut match_values = Vec::with_capacity(filter.match_values.len());
        let mut own = HashSet::new();
        for value in &filter.match_values {
            let key = filter_key(value);
            if key.is_empty() {
                return invalid(format!("filter {name} has an empty FILTER value"));
            }
            if !own.insert(key.clone()) {
                continue;
            }
            if let Some(other) = owners.insert(key, name) {
                return invalid(format!(
                    "FILTER value {} is matched by both {other} and {name}",
                    value.trim()
                ));
            }
            match_values.push(value.trim().to_owned());
        }
        normalized.push(RigFilter {
            id: filter.id,
            name: name.to_owned(),
            match_values,
            bands: bands.into_iter().collect(),
        });
    }
    Ok(normalized)
}
