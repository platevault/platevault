//! Native filesystem control contract DTOs (spec 004).
//!
//! Covers `native.directory.pick`, `native.file.pick`, and `native.reveal`
//! command surfaces. Types mirror the JSON Schema contracts at
//! `specs/004-native-filesystem-controls/contracts/`.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

// ── Enums ───────────────────────────────────────────────────────────────────

/// Entity kind for audit-log correlation on reveal operations.
#[derive(
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
    Serialize,
    Deserialize,
    JsonSchema,
    Type,
)]
#[serde(rename_all = "snake_case")]
pub enum EntityKind {
    InboxItem,
    InventoryRow,
    ProjectManifest,
    MasterCalibration,
    RegisteredSource,
    Other,
}

/// How the target was highlighted in the OS file browser after a reveal.
#[derive(
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
    Serialize,
    Deserialize,
    JsonSchema,
    Type,
)]
#[serde(rename_all = "snake_case")]
pub enum RevealSelection {
    /// The item was selected in the file browser (macOS, Windows, Linux freedesktop).
    Target,
    /// Only the parent directory opened (Linux xdg-open fallback).
    DirectoryOnly,
    /// No UI hint was applied.
    None,
}

// ── Directory picker ────────────────────────────────────────────────────────

/// Request payload for `native.directory.pick`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryPickRequest {
    pub request_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_path: Option<String>,
}

/// Response payload for `native.directory.pick`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryPickResponse {
    /// Absolute OS-canonical path the user selected, or `None` when cancelled.
    pub path: Option<String>,
    /// True when the user dismissed the dialog without selecting.
    pub cancelled: bool,
}

// ── File picker ─────────────────────────────────────────────────────────────

/// A file-type filter row for the OS file picker.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FileFilter {
    /// Display name for the filter (e.g. "FITS files").
    pub name: String,
    /// Extensions without leading dot (e.g. `["fits", "fit"]`).
    pub extensions: Vec<String>,
}

/// Request payload for `native.file.pick`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FilePickRequest {
    pub request_id: String,
    /// Ordered list of file-type filters. The first filter is the default.
    pub filters: Vec<FileFilter>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_path: Option<String>,
}

/// Response payload for `native.file.pick`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FilePickResponse {
    /// Absolute OS-canonical path the user selected, or `None` when cancelled.
    pub path: Option<String>,
    /// The name of the filter active when the user clicked Open.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_filter: Option<String>,
    /// True when the user dismissed the dialog without selecting.
    pub cancelled: bool,
}

// ── Reveal ──────────────────────────────────────────────────────────────────

/// Request payload for `native.reveal`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RevealRequest {
    pub request_id: String,
    /// Absolute path to reveal. May point to a file or directory.
    pub path: String,
    /// Optional context tag for audit-log correlation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entity_kind: Option<EntityKind>,
    /// Optional entity identifier for audit-log correlation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entity_id: Option<String>,
}

/// Response payload for `native.reveal`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RevealResponse {
    /// True when the OS file browser launched successfully.
    pub revealed: bool,
    /// How the target was highlighted.
    pub selection: RevealSelection,
}

// ── Error codes ─────────────────────────────────────────────────────────────

/// Dotted error codes for native filesystem controls.
pub mod error_codes {
    /// The OS dialog picker is unavailable on this platform.
    pub const PICKER_UNAVAILABLE: &str = "picker.unavailable";
    /// One or more file filters are invalid (e.g. wildcard `*` in a non-"All files" filter).
    pub const FILTERS_INVALID: &str = "filters.invalid";
    /// The OS command to reveal the path failed.
    pub const OS_COMMAND_FAILED: &str = "os.command_failed";
    /// The requested path does not exist on disk.
    pub const PATH_NOT_EXISTS: &str = "path.not_exists";
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    // ── EntityKind ──────────────────────────────────────────────────────────

    #[test]
    fn entity_kind_serializes_snake_case() {
        assert_eq!(serde_json::to_value(EntityKind::InboxItem).unwrap(), json!("inbox_item"));
        assert_eq!(serde_json::to_value(EntityKind::InventoryRow).unwrap(), json!("inventory_row"));
        assert_eq!(
            serde_json::to_value(EntityKind::ProjectManifest).unwrap(),
            json!("project_manifest")
        );
        assert_eq!(
            serde_json::to_value(EntityKind::MasterCalibration).unwrap(),
            json!("master_calibration")
        );
        assert_eq!(
            serde_json::to_value(EntityKind::RegisteredSource).unwrap(),
            json!("registered_source")
        );
        assert_eq!(serde_json::to_value(EntityKind::Other).unwrap(), json!("other"));
    }

    #[test]
    fn entity_kind_roundtrips() {
        for variant_str in [
            "inbox_item",
            "inventory_row",
            "project_manifest",
            "master_calibration",
            "registered_source",
            "other",
        ] {
            let deserialized: EntityKind = serde_json::from_value(json!(variant_str))
                .unwrap_or_else(|e| {
                    panic!("\"{variant_str}\" should deserialize to EntityKind: {e}");
                });
            let reserialized = serde_json::to_value(deserialized).unwrap();
            assert_eq!(reserialized, json!(variant_str));
        }
    }

    // ── RevealSelection ─────────────────────────────────────────────────────

    #[test]
    fn reveal_selection_serializes_snake_case() {
        assert_eq!(serde_json::to_value(RevealSelection::Target).unwrap(), json!("target"));
        assert_eq!(
            serde_json::to_value(RevealSelection::DirectoryOnly).unwrap(),
            json!("directory_only")
        );
        assert_eq!(serde_json::to_value(RevealSelection::None).unwrap(), json!("none"));
    }

    // ── DirectoryPickRequest / Response ──────────────────────────────────────

    #[test]
    fn directory_pick_request_camel_case() {
        let req = DirectoryPickRequest {
            request_id: "req-001".to_owned(),
            default_path: Some("/astro/raw".to_owned()),
        };
        let value = serde_json::to_value(&req).unwrap();
        assert_eq!(value["requestId"], json!("req-001"));
        assert_eq!(value["defaultPath"], json!("/astro/raw"));
    }

    #[test]
    fn directory_pick_request_omits_null_default_path() {
        let req = DirectoryPickRequest { request_id: "req-001".to_owned(), default_path: None };
        let value = serde_json::to_value(&req).unwrap();
        assert!(!value.as_object().unwrap().contains_key("defaultPath"));
    }

    #[test]
    fn directory_pick_response_cancelled() {
        let resp = DirectoryPickResponse { path: None, cancelled: true };
        let value = serde_json::to_value(&resp).unwrap();
        assert_eq!(value["path"], json!(null));
        assert_eq!(value["cancelled"], json!(true));
    }

    #[test]
    fn directory_pick_response_selected() {
        let resp = DirectoryPickResponse { path: Some("/astro/raw".to_owned()), cancelled: false };
        let value = serde_json::to_value(&resp).unwrap();
        assert_eq!(value["path"], json!("/astro/raw"));
        assert_eq!(value["cancelled"], json!(false));
    }

    // ── FileFilter ──────────────────────────────────────────────────────────

    #[test]
    fn file_filter_camel_case() {
        let filter = FileFilter {
            name: "FITS files".to_owned(),
            extensions: vec!["fits".to_owned(), "fit".to_owned()],
        };
        let value = serde_json::to_value(&filter).unwrap();
        assert_eq!(value["name"], json!("FITS files"));
        assert_eq!(value["extensions"], json!(["fits", "fit"]));
    }

    // ── FilePickRequest / Response ──────────────────────────────────────────

    #[test]
    fn file_pick_request_camel_case() {
        let req = FilePickRequest {
            request_id: "req-002".to_owned(),
            filters: vec![FileFilter {
                name: "FITS files".to_owned(),
                extensions: vec!["fits".to_owned()],
            }],
            default_path: None,
        };
        let value = serde_json::to_value(&req).unwrap();
        assert_eq!(value["requestId"], json!("req-002"));
        assert!(value["filters"].is_array());
        assert!(!value.as_object().unwrap().contains_key("defaultPath"));
    }

    #[test]
    fn file_pick_response_with_selected_filter() {
        let resp = FilePickResponse {
            path: Some("/astro/darks/master_dark.fits".to_owned()),
            selected_filter: Some("FITS files".to_owned()),
            cancelled: false,
        };
        let value = serde_json::to_value(&resp).unwrap();
        assert_eq!(value["selectedFilter"], json!("FITS files"));
        assert_eq!(value["cancelled"], json!(false));
    }

    #[test]
    fn file_pick_response_cancelled_omits_selected_filter() {
        let resp = FilePickResponse { path: None, selected_filter: None, cancelled: true };
        let value = serde_json::to_value(&resp).unwrap();
        assert_eq!(value["path"], json!(null));
        assert!(!value.as_object().unwrap().contains_key("selectedFilter"));
        assert_eq!(value["cancelled"], json!(true));
    }

    // ── RevealRequest / Response ────────────────────────────────────────────

    #[test]
    fn reveal_request_camel_case_with_context() {
        let req = RevealRequest {
            request_id: "req-003".to_owned(),
            path: "/astro/raw/M31/light_001.fits".to_owned(),
            entity_kind: Some(EntityKind::InventoryRow),
            entity_id: Some("inv-42".to_owned()),
        };
        let value = serde_json::to_value(&req).unwrap();
        assert_eq!(value["requestId"], json!("req-003"));
        assert_eq!(value["path"], json!("/astro/raw/M31/light_001.fits"));
        assert_eq!(value["entityKind"], json!("inventory_row"));
        assert_eq!(value["entityId"], json!("inv-42"));
    }

    #[test]
    fn reveal_request_omits_optional_context() {
        let req = RevealRequest {
            request_id: "req-004".to_owned(),
            path: "/astro/raw".to_owned(),
            entity_kind: None,
            entity_id: None,
        };
        let value = serde_json::to_value(&req).unwrap();
        let obj = value.as_object().unwrap();
        assert!(!obj.contains_key("entityKind"));
        assert!(!obj.contains_key("entityId"));
    }

    #[test]
    fn reveal_response_success() {
        let resp = RevealResponse { revealed: true, selection: RevealSelection::Target };
        let value = serde_json::to_value(&resp).unwrap();
        assert_eq!(value["revealed"], json!(true));
        assert_eq!(value["selection"], json!("target"));
    }

    #[test]
    fn reveal_response_directory_only_fallback() {
        let resp = RevealResponse { revealed: true, selection: RevealSelection::DirectoryOnly };
        let value = serde_json::to_value(&resp).unwrap();
        assert_eq!(value["selection"], json!("directory_only"));
    }
}
