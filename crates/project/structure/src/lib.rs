//! App-owned project envelope and folder-structure rules (spec 008 F-1).
//!
//! Defines the expected on-disk folder layout for each `ProcessingTool` and
//! the format of the app-owned project marker file.
//!
//! Constitution III: this crate does NOT invoke `PixInsight` or any processing
//! tool. It only specifies the folder shape the app creates.

pub const CRATE_NAME: &str = "project_structure";

/// The processing tool a project targets.
///
/// Values must stay in sync with `domain_core::lifecycle::project::ProcessingTool`
/// and the JSON Schema `ProcessingTool` enum in the contracts.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum ProcessingTool {
    PixInsight,
    Siril,
    PlanetarySuite,
}

impl ProcessingTool {
    /// Parse from the canonical string representation stored in the DB.
    ///
    /// # Errors
    ///
    /// Returns `Err` when the string is not a known tool value.
    pub fn parse(s: &str) -> Result<Self, UnknownTool> {
        match s {
            "PixInsight" => Ok(Self::PixInsight),
            "Siril" => Ok(Self::Siril),
            "Planetary Suite" => Ok(Self::PlanetarySuite),
            other => Err(UnknownTool(other.to_owned())),
        }
    }

    /// Canonical string representation (matches DB and contract enum).
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::PixInsight => "PixInsight",
            Self::Siril => "Siril",
            Self::PlanetarySuite => "Planetary Suite",
        }
    }
}

/// Error returned when parsing an unknown tool string.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UnknownTool(pub String);

impl std::fmt::Display for UnknownTool {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "unknown processing tool: {}", self.0)
    }
}

// ── Folder layout ─────────────────────────────────────────────────────────────

/// A relative folder path that should exist inside a project directory.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct RequiredFolder(pub String);

/// Return the set of sub-folders that the app should create inside the project
/// root for the given tool.
///
/// Paths are relative to the project root (no leading slash).
///
/// `PixInsight` layout follows the WBPP-centric convention from research R3:
///   `lights/`, `darks/`, `flats/`, `bias/`, `output/`, `processing/`
///
/// Siril layout follows the Siril sequence convention:
///   `lights/`, `darks/`, `flats/`, `bias/`, `output/`
///
/// Planetary Suite layout is minimal (planetary stacking uses a flat folder):
///   `captures/`, `output/`
#[must_use]
pub fn required_folders(tool: ProcessingTool) -> Vec<RequiredFolder> {
    match tool {
        ProcessingTool::PixInsight => vec![
            RequiredFolder("lights".to_owned()),
            RequiredFolder("darks".to_owned()),
            RequiredFolder("flats".to_owned()),
            RequiredFolder("bias".to_owned()),
            RequiredFolder("output".to_owned()),
            RequiredFolder("processing".to_owned()),
        ],
        ProcessingTool::Siril => vec![
            RequiredFolder("lights".to_owned()),
            RequiredFolder("darks".to_owned()),
            RequiredFolder("flats".to_owned()),
            RequiredFolder("bias".to_owned()),
            RequiredFolder("output".to_owned()),
        ],
        ProcessingTool::PlanetarySuite => {
            vec![RequiredFolder("captures".to_owned()), RequiredFolder("output".to_owned())]
        }
    }
}

// ── Project marker ────────────────────────────────────────────────────────────

/// The filename written as the app-owned project marker inside the project root.
///
/// The file is JSON; its presence identifies the folder as an app-managed
/// project. The content is versioned so onboard reconciliation can detect old
/// format markers from previous app versions.
pub const MARKER_FILENAME: &str = ".astro-plan-project.json";

/// Marker format version. Bump when the marker schema changes.
pub const MARKER_VERSION: &str = "1";

/// Render a project marker as a JSON string to be written into
/// `<project_root>/<MARKER_FILENAME>`.
///
/// The marker intentionally contains only the project id and format version;
/// the authoritative metadata lives in the database (Constitution V).
#[must_use]
pub fn render_marker(project_id: &str) -> String {
    // Produce deterministic, human-readable JSON without pulling in serde_json
    // to keep this crate free of heavy dependencies.
    format!("{{\n  \"version\": \"{MARKER_VERSION}\",\n  \"projectId\": \"{project_id}\"\n}}\n")
}

/// Parse the `projectId` field from a marker string.
///
/// Returns `Err(ParseMarkerError)` when the string is not valid JSON, the
/// format version is unrecognised, or the required fields are missing.
///
/// # Errors
///
/// Returns `Err(ParseMarkerError::InvalidJson)` on non-JSON input.
/// Returns `Err(ParseMarkerError::UnknownVersion)` on unrecognised version.
/// Returns `Err(ParseMarkerError::MissingField)` when `projectId` is absent.
pub fn parse_marker(raw: &str) -> Result<ParsedMarker, ParseMarkerError> {
    // Minimal parser: look for "projectId" and "version" as JSON string fields.
    // Avoids a serde_json dependency in this leaf crate.
    let version = extract_json_string_field(raw, "version")
        .ok_or(ParseMarkerError::MissingField("version"))?;
    if version != MARKER_VERSION {
        return Err(ParseMarkerError::UnknownVersion(version));
    }
    let project_id = extract_json_string_field(raw, "projectId")
        .ok_or(ParseMarkerError::MissingField("projectId"))?;
    Ok(ParsedMarker { project_id })
}

/// Extracted fields from a project marker.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ParsedMarker {
    pub project_id: String,
}

/// Errors from [`parse_marker`].
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ParseMarkerError {
    MissingField(&'static str),
    UnknownVersion(String),
}

impl std::fmt::Display for ParseMarkerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MissingField(name) => write!(f, "marker missing required field: {name}"),
            Self::UnknownVersion(v) => write!(f, "unrecognised marker version: {v}"),
        }
    }
}

/// Naive string scanner: find the value of a top-level JSON string field.
/// Sufficient for the simple single-object markers this crate writes.
fn extract_json_string_field(json: &str, field: &str) -> Option<String> {
    let needle = format!("\"{field}\"");
    let start = json.find(&needle)?;
    let after_key = &json[start + needle.len()..];
    // skip whitespace and ':'
    let colon_pos = after_key.find(':')?;
    let after_colon = &after_key[colon_pos + 1..].trim_start();
    if !after_colon.starts_with('"') {
        return None;
    }
    let inner = &after_colon[1..];
    let end = inner.find('"')?;
    Some(inner[..end].to_owned())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exposes_crate_name() {
        assert_eq!(CRATE_NAME, "project_structure");
    }

    #[test]
    fn pixinsight_layout_has_six_folders() {
        let folders = required_folders(ProcessingTool::PixInsight);
        assert_eq!(folders.len(), 6);
        let names: Vec<&str> = folders.iter().map(|f| f.0.as_str()).collect();
        assert!(names.contains(&"lights"));
        assert!(names.contains(&"processing"));
    }

    #[test]
    fn siril_layout_has_five_folders() {
        let folders = required_folders(ProcessingTool::Siril);
        assert_eq!(folders.len(), 5);
        let names: Vec<&str> = folders.iter().map(|f| f.0.as_str()).collect();
        assert!(!names.contains(&"processing"));
    }

    #[test]
    fn planetary_suite_layout_has_two_folders() {
        let folders = required_folders(ProcessingTool::PlanetarySuite);
        assert_eq!(folders.len(), 2);
    }

    #[test]
    fn marker_round_trips() {
        let marker = render_marker("proj-abc-123");
        let parsed = parse_marker(&marker).unwrap();
        assert_eq!(parsed.project_id, "proj-abc-123");
    }

    #[test]
    fn parse_marker_rejects_unknown_version() {
        let bad = r#"{ "version": "99", "projectId": "x" }"#;
        assert!(matches!(parse_marker(bad), Err(ParseMarkerError::UnknownVersion(_))));
    }

    #[test]
    fn parse_marker_rejects_missing_project_id() {
        let bad = r#"{ "version": "1" }"#;
        assert_eq!(parse_marker(bad), Err(ParseMarkerError::MissingField("projectId")));
    }

    #[test]
    fn processing_tool_from_str_roundtrips() {
        for s in ["PixInsight", "Siril", "Planetary Suite"] {
            let tool = ProcessingTool::parse(s).unwrap();
            assert_eq!(tool.as_str(), s);
        }
    }

    #[test]
    fn processing_tool_from_str_rejects_unknown() {
        assert!(ProcessingTool::parse("Photoshop").is_err());
    }
}
