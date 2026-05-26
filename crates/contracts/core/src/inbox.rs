//! Inbox scan contract DTOs for the Tauri IPC surface.

use serde::{Deserialize, Serialize};
use specta::Type;

/// A file entry discovered during an inbox scan.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxFileEntry {
    pub path: String,
    pub file_name: String,
    pub size_bytes: u64,
    pub extension: String,
}

/// Result of an inbox scan operation.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxScanResult {
    pub root_id: String,
    pub entries: Vec<InboxFileEntry>,
    pub total_count: u32,
    pub total_size_bytes: u64,
}
