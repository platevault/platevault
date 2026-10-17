// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Application profiles (spec 069 PREP-FR-01/02): the application a Project's
//! View is opened in, its arguments and its verified capabilities, and the
//! corrected header fields a patched copy carries (PREP-FR-03).

use std::fmt;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{LibraryError, NativePath, Revision};

fn invalid(message: impl Into<String>) -> LibraryError {
    LibraryError::InvalidInput(message.into())
}

// ---------------------------------------------------------------------------
// Profiles (PREP-FR-01, PREP-FR-02)
// ---------------------------------------------------------------------------

/// The application a profile hands a run to. `Generic` is Open in... with a
/// configured executable and arguments; it never claims a verified profile.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum ProfileKind {
    /// `PixInsight` with its Weighted Batch Preprocessing script.
    Wbpp,
    Siril,
    /// SETI Astro Suite Pro.
    Seti,
    Generic,
}

/// How the application treats the files it is given (D04). Only recorded
/// evidence makes it `ReadOnly`; until then it is `Unknown`.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum InputBehavior {
    ReadOnly,
    /// The application may write to, rename or rewrite its inputs.
    WriteProne,
    #[default]
    Unknown,
}

impl fmt::Display for InputBehavior {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::ReadOnly => "read-only",
            Self::WriteProne => "write-prone",
            Self::Unknown => "unknown",
        })
    }
}

/// The capabilities D04 requires evidence for before a verified-profile claim.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum Capability {
    /// What the application does to its input files.
    Input,
    /// The folder layout it loads.
    Layout,
    /// How it is configured: exact input lists passed at launch.
    Configuration,
    /// Output it writes that `PlateVault` recognizes.
    RecognizedOutput,
}

impl Capability {
    pub const ALL: [Self; 4] =
        [Self::Input, Self::Layout, Self::Configuration, Self::RecognizedOutput];
}

impl fmt::Display for Capability {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Input => "input behaviour",
            Self::Layout => "folder layout",
            Self::Configuration => "input-list configuration",
            Self::RecognizedOutput => "recognized output",
        })
    }
}

/// One recorded piece of capability evidence: what was observed, and where.
#[derive(Clone, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct CapabilityProof {
    pub capability: Capability,
    pub evidence: String,
}

/// A profile's recorded capability evidence (D04). Nothing is claimed
/// without a proof: read-only input needs an `Input` proof and an input list
/// a `Configuration` proof.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct CapabilityEvidence {
    #[serde(default)]
    pub input_behavior: InputBehavior,
    /// The application reads the exact input paths passed as `{inputs}`.
    #[serde(default)]
    pub input_list: bool,
    #[serde(default)]
    pub proofs: Vec<CapabilityProof>,
}

impl CapabilityEvidence {
    fn proves(&self, capability: Capability) -> bool {
        self.proofs.iter().any(|proof| proof.capability == capability)
    }

    /// Every capability without recorded evidence, named in the review.
    #[must_use]
    pub fn unproven(&self) -> Vec<Capability> {
        Capability::ALL.into_iter().filter(|capability| !self.proves(*capability)).collect()
    }

    /// # Errors
    /// `InvalidInput` for blank evidence, or a claim without its proof.
    pub fn validate(&self) -> Result<(), LibraryError> {
        if self.proofs.iter().any(|proof| proof.evidence.trim().is_empty()) {
            return Err(invalid("capability evidence names what was observed"));
        }
        if self.input_behavior == InputBehavior::ReadOnly && !self.proves(Capability::Input) {
            return Err(invalid("read-only input needs recorded input-behaviour evidence"));
        }
        if self.input_list && !self.proves(Capability::Configuration) {
            return Err(invalid("an input list needs recorded configuration evidence"));
        }
        Ok(())
    }
}

/// The argument placeholders a profile's launch arguments may hold.
pub const PROFILE_PLACEHOLDERS: [&str; 3] = ["{folder}", "{results}", "{inputs}"];

/// What the user enters for a profile.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct ProfileInput {
    pub name: String,
    pub kind: ProfileKind,
    /// Configured or located by the user; none is assumed.
    pub executable: Option<NativePath>,
    /// Launch arguments; `{folder}`, `{results}` and `{inputs}` are expanded.
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub capability_evidence: CapabilityEvidence,
}

impl ProfileInput {
    /// # Errors
    /// `InvalidInput` for a blank name, an unknown `{placeholder}`, or
    /// capability evidence [`CapabilityEvidence::validate`] refuses.
    pub fn validate(&self) -> Result<(), LibraryError> {
        if self.name.trim().is_empty() {
            return Err(invalid("a profile needs a name"));
        }
        for arg in &self.args {
            let mut rest = arg.as_str();
            while let Some(start) = rest.find('{') {
                let tail = &rest[start..];
                let end =
                    tail.find('}').ok_or_else(|| invalid(format!("unclosed '{{' in {arg}")))?;
                if !PROFILE_PLACEHOLDERS.contains(&&tail[..=end]) {
                    return Err(invalid(format!(
                        "{} is not a placeholder; use {}",
                        &tail[..=end],
                        PROFILE_PLACEHOLDERS.join(", ")
                    )));
                }
                rest = &tail[end + 1..];
            }
        }
        if self.args.iter().any(|arg| arg.contains("{inputs}") && arg != "{inputs}") {
            return Err(invalid("{inputs} stands alone: it expands to one argument per input"));
        }
        self.capability_evidence.validate()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct Profile {
    pub id: Uuid,
    pub name: String,
    pub kind: ProfileKind,
    pub executable: Option<NativePath>,
    pub args: Vec<String>,
    pub capability_evidence: CapabilityEvidence,
    pub revision: Revision,
    pub created_at: String,
    pub updated_at: String,
}

impl Profile {
    /// A verified-profile claim (D04): a named application with evidence for
    /// every capability. Generic Open in... never claims one.
    #[must_use]
    pub fn verified(&self) -> bool {
        self.kind != ProfileKind::Generic && self.capability_evidence.unproven().is_empty()
    }

    /// Whether Linked View and Direct source may hand it library originals:
    /// only read-only input with recorded evidence does (D04).
    #[must_use]
    pub fn reads_only(&self) -> bool {
        self.capability_evidence.input_behavior == InputBehavior::ReadOnly
    }
}

/// One corrected field of an input: the catalog value next to the header
/// value the application reads unless a patched copy carries the catalog one.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CorrectedField {
    /// The capture field as the catalog names it, such as `filter`.
    pub field: String,
    /// The FITS keywords a patched copy writes; empty when `PlateVault`
    /// patches no keyword for this field.
    pub keywords: Vec<String>,
    /// The value the source header holds.
    pub header: Option<String>,
    /// The confirmed catalog value.
    pub catalog: Option<String>,
}
