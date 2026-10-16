// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Physical cameras and rig versions (spec 064 LIB-FR-26, 072 PLAN-EQ-FR-07/08;
//! D-W95, D-W104). A physical camera keeps one identity across the rigs that
//! mount it; once two cameras share a model each needs a unique alias, and
//! its "Don't use darks" and "Don't use bias" defaults settle its sessions.
//! Editing a rig adds an immutable dated version; a session keeps the version
//! it was captured with, and versions never invalidate anything
//! retroactively. A new version starts a new Project group only when the
//! optics change; any new version makes earlier flats incompatible.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use time::Date;
use uuid::Uuid;

use crate::{canonical_decimal, comparison_key, LibraryError, Revision};

fn invalid(message: String) -> LibraryError {
    LibraryError::InvalidInput(message)
}

/// One physical camera body.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Camera {
    pub id: Uuid,
    pub model: String,
    /// The user's unique label; required once two cameras share a model.
    pub alias: Option<String>,
    /// "Don't use darks": its sessions start settled as No darks.
    pub no_darks: bool,
    /// "Don't use bias": its sessions start settled as No bias.
    pub no_bias: bool,
    pub revision: Revision,
}

impl Camera {
    #[must_use]
    pub fn model_key(&self) -> String {
        comparison_key(&self.model)
    }

    #[must_use]
    pub fn alias_key(&self) -> Option<String> {
        self.alias.as_deref().map(comparison_key)
    }

    /// A model, and an alias that is not blank when present.
    ///
    /// # Errors
    /// `InvalidInput` naming the camera.
    pub fn validate(&self) -> Result<(), LibraryError> {
        if self.model_key().is_empty() {
            return Err(invalid(format!("camera {}: the model is blank", self.id)));
        }
        if self.alias_key().is_some_and(|alias| alias.is_empty()) {
            return Err(invalid(format!("camera {}: the alias is blank", self.id)));
        }
        Ok(())
    }

    /// Every camera of the rigs: each valid and once, aliases unique, and an
    /// alias on every camera of a model two or more cameras share.
    ///
    /// # Errors
    /// `InvalidInput` naming the camera or alias.
    pub fn validate_all(cameras: &[Self]) -> Result<(), LibraryError> {
        let mut ids = BTreeSet::new();
        let mut aliases = BTreeSet::new();
        let mut models: BTreeMap<String, u32> = BTreeMap::new();
        for camera in cameras {
            camera.validate()?;
            if !ids.insert(camera.id) {
                return Err(invalid(format!("camera {} is listed twice", camera.id)));
            }
            if let Some(alias) = camera.alias_key() {
                if !aliases.insert(alias) {
                    return Err(invalid(format!(
                        "two cameras share the alias {}",
                        camera.alias.as_deref().unwrap_or_default().trim()
                    )));
                }
            }
            *models.entry(camera.model_key()).or_default() += 1;
        }
        if let Some(camera) = cameras.iter().find(|camera| {
            camera.alias.is_none()
                && models.get(&camera.model_key()).is_some_and(|count| *count > 1)
        }) {
            return Err(invalid(format!(
                "several cameras are a {}: each needs a unique alias",
                camera.model.trim()
            )));
        }
        Ok(())
    }
}

/// How a calibration session or master names its camera: by model while the
/// rigs hold one camera of it, or confirmed at import.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CameraBasis {
    Model,
    Confirmed,
}

/// The camera a calibration session or adopted master was taken with.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraLink {
    pub camera_id: Uuid,
    pub basis: CameraBasis,
}

/// Whether a rig version has a rotator. Without one, a missing rotation
/// angle is no blocker; with one, or not knowing, it reads unknown.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RotatorPresence {
    Present,
    Absent,
    Unknown,
}

impl RotatorPresence {
    /// Whether flat matching needs a known rotation angle.
    #[must_use]
    pub const fn needs_angle(self) -> bool {
        !matches!(self, Self::Absent)
    }
}

/// What makes two rig versions one optical setup: camera, focal length and
/// reducer. Focal length is canonical decimal text, compared exactly.
#[derive(Clone, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpticsSignature {
    pub camera_id: Option<Uuid>,
    pub focal_length_mm: Option<String>,
    pub reducer: Option<String>,
}

impl OpticsSignature {
    /// # Errors
    /// `InvalidInput` for a focal length that is not a positive finite number
    /// or a blank reducer.
    pub fn new(
        camera_id: Option<Uuid>,
        focal_length_mm: Option<f64>,
        reducer: Option<&str>,
    ) -> Result<Self, LibraryError> {
        let signature = Self {
            camera_id,
            focal_length_mm: focal_length_mm.map(canonical_decimal),
            reducer: reducer.map(|reducer| reducer.trim().to_owned()),
        };
        signature.validate()?;
        Ok(signature)
    }

    /// # Errors
    /// `InvalidInput` for a focal length that is not canonical positive
    /// decimal text, or a reducer that is blank or untrimmed.
    pub fn validate(&self) -> Result<(), LibraryError> {
        if let Some(text) = &self.focal_length_mm {
            let canonical = text
                .parse::<f64>()
                .ok()
                .filter(|value| value.is_finite() && *value > 0.0)
                .is_some_and(|value| canonical_decimal(value) == *text);
            if !canonical {
                return Err(invalid(format!("focal length {text} mm is not a positive length")));
            }
        }
        if let Some(reducer) = &self.reducer {
            if reducer.is_empty() || reducer.trim() != reducer {
                return Err(invalid("the reducer is blank".into()));
            }
        }
        Ok(())
    }
}

/// One immutable dated version of a rig.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RigVersion {
    pub id: Uuid,
    /// The rig: a saved equipment record.
    pub rig_id: Uuid,
    #[serde(with = "crate::iso_date")]
    pub valid_from: Date,
    pub optics: OpticsSignature,
    pub rotator: RotatorPresence,
}

impl RigVersion {
    /// A new version starts a new Project group only when the optics change;
    /// a remount with the same optics stays in its group (its flats still
    /// change).
    #[must_use]
    pub fn starts_new_group(&self, other: &Self) -> bool {
        self.optics != other.optics
    }

    /// # Errors
    /// `InvalidInput` for an invalid optics signature.
    pub fn validate(&self) -> Result<(), LibraryError> {
        self.optics.validate()
    }
}
