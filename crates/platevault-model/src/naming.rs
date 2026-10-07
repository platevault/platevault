// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Naming templates (STO-IMP-FR-07): the per-frame-type folder patterns Import
//! and Archive lay files out with, their sample metadata and resolution report.

use serde::{Deserialize, Serialize};

/// The seven frame-type classes that each own a naming template.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NamingFrameType {
    Light,
    Flat,
    Dark,
    Bias,
    MasterFlat,
    MasterDark,
    MasterBias,
}

impl NamingFrameType {
    /// Every class, in Settings > Naming order.
    pub const ALL: [Self; 7] = [
        Self::Light,
        Self::Flat,
        Self::Dark,
        Self::Bias,
        Self::MasterFlat,
        Self::MasterDark,
        Self::MasterBias,
    ];

    /// Stable stored name, matching the serialized form.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Light => "light",
            Self::Flat => "flat",
            Self::Dark => "dark",
            Self::Bias => "bias",
            Self::MasterFlat => "master_flat",
            Self::MasterDark => "master_dark",
            Self::MasterBias => "master_bias",
        }
    }

    /// Parse a stored name written by [`Self::as_str`].
    #[must_use]
    pub fn from_stored(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|class| class.as_str() == name)
    }
}

/// One frame type's effective template beside its built-in default.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NamingTemplate {
    pub frame_type: NamingFrameType,
    /// The stored override, else the default.
    pub template: String,
    pub default_template: String,
    /// `true` only when an override is stored.
    pub overridden: bool,
}

/// Frame metadata the nine tokens resolve from; an absent value takes the
/// token's fallback. `date` is the ISO observing-night local date.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct NamingMetadata {
    pub target: Option<String>,
    pub filter: Option<String>,
    pub date: Option<String>,
    pub frame_type: Option<String>,
    pub camera: Option<String>,
    pub exposure: Option<String>,
    pub gain: Option<String>,
    pub binning: Option<String>,
    pub set_temp: Option<String>,
}

/// A token that resolved to its fallback because the metadata lacked it.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NamingFallback {
    pub token: String,
    pub value: String,
}

/// A template resolved against metadata: the forward-slash relative folder and
/// every fallback used, in template order.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NamingResolution {
    pub template: String,
    pub relative_path: String,
    pub fallbacks: Vec<NamingFallback>,
}
