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
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
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
            return Err(LibraryError::invalid_field(
                "model",
                format!("camera {}: the model is blank", self.id),
            ));
        }
        if self.alias_key().is_some_and(|alias| alias.is_empty()) {
            return Err(LibraryError::invalid_field(
                "alias",
                format!("camera {}: the alias is blank", self.id),
            ));
        }
        Ok(())
    }

    /// Every camera of the rigs: each valid and once, aliases unique, and an
    /// alias on every camera of a model two or more cameras share.
    ///
    /// # Errors
    /// `InvalidInput` naming the camera or alias; an invalid camera's field
    /// is named below its position, while an alias clash names the camera
    /// whose alias is duplicated or missing.
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
                    return Err(LibraryError::invalid_field(
                        "alias",
                        format!(
                            "two cameras share the alias {}",
                            camera.alias.as_deref().unwrap_or_default().trim()
                        ),
                    )
                    .concerning(camera.id));
                }
            }
            *models.entry(camera.model_key()).or_default() += 1;
        }
        if let Some(camera) = cameras.iter().find(|camera| {
            camera.alias.is_none()
                && models.get(&camera.model_key()).is_some_and(|count| *count > 1)
        }) {
            return Err(LibraryError::invalid_field(
                "alias",
                format!("several cameras are a {}: each needs a unique alias", camera.model.trim()),
            )
            .concerning(camera.id));
        }
        Ok(())
    }

    /// Which camera calibration headers naming `model` were taken with
    /// (PLAN-EQ-FR-08): the one camera of that model the rigs hold, or a
    /// choice among several. Models compare by comparison key.
    #[must_use]
    pub fn resolve_model(cameras: &[Self], model: &str) -> CameraResolution {
        let key = comparison_key(model);
        if key.is_empty() {
            return CameraResolution::Unknown;
        }
        let mut camera_ids: Vec<Uuid> = cameras
            .iter()
            .filter(|camera| camera.model_key() == key)
            .map(|camera| camera.id)
            .collect();
        camera_ids.sort_unstable();
        match camera_ids.as_slice() {
            [] => CameraResolution::Unknown,
            [camera_id] => CameraResolution::Model { camera_id: *camera_id },
            _ => CameraResolution::Choose { camera_ids },
        }
    }
}

/// How a camera model read from calibration headers names a camera of the
/// rigs. Only one camera of the model links by model; with several, the
/// import asks which, and a camera the user confirms is the explicit match.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "resolution", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum CameraResolution {
    /// The rigs hold no camera of this model.
    Unknown,
    /// The rigs hold one camera of this model: it matches with no question.
    Model { camera_id: Uuid },
    /// The rigs hold several, in id order: the import asks which, by alias.
    Choose { camera_ids: Vec<Uuid> },
}

impl CameraResolution {
    /// The link a model alone makes: only to the one camera of its model.
    #[must_use]
    pub const fn link(&self) -> Option<CameraLink> {
        match self {
            Self::Model { camera_id } => {
                Some(CameraLink { camera_id: *camera_id, basis: CameraBasis::Model })
            }
            Self::Unknown | Self::Choose { .. } => None,
        }
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
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
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
                return Err(LibraryError::invalid_field(
                    "focalLengthMm",
                    format!("focal length {text} mm is not a positive length"),
                ));
            }
        }
        if let Some(reducer) = &self.reducer {
            if reducer.is_empty() || reducer.trim() != reducer {
                return Err(LibraryError::invalid_field("reducer", "the reducer is blank"));
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

    /// The version of a rig a capture on `night` was taken with: the latest
    /// one starting on or before that night. A night before the first version
    /// reads the first, which stands for the rig before any recorded edit.
    /// An unknown night reads a rig's only version and nothing when it has
    /// several. `versions` are one rig's, in any order.
    #[must_use]
    pub fn for_night(versions: &[Self], night: Option<Date>) -> Option<&Self> {
        let Some(night) = night else {
            return match versions {
                [only] => Some(only),
                _ => None,
            };
        };
        versions
            .iter()
            .filter(|version| version.valid_from <= night)
            .max_by_key(|version| version.valid_from)
            .or_else(|| versions.iter().min_by_key(|version| version.valid_from))
    }

    /// # Errors
    /// `InvalidInput` for an invalid optics signature.
    pub fn validate(&self) -> Result<(), LibraryError> {
        self.optics.validate().map_err(|error| error.within_field("optics"))
    }
}
