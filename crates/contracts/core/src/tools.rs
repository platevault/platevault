//! Processing tool contract DTOs for the Tauri IPC surface.

use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProcessingTool {
    pub id: String,
    pub name: String,
    pub path: Option<String>,
    pub version: Option<String>,
    pub detected: bool,
    pub enabled: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProcessingTool {
    pub id: String,
    pub path: Option<String>,
    pub enabled: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ToolPathValidation {
    pub path: String,
    pub valid: bool,
    pub reason: Option<String>,
}
