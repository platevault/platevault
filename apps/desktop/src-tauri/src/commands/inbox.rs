//! Spec 030 inbox commands (T030).
//!
//! `inbox.scan` performs an on-demand scan of inbox folders and returns
//! discovered file entries. Currently a stub returning fixture data until
//! the real scan pipeline is wired.

use contracts_core::inbox::{InboxFileEntry, InboxScanResult};

/// `inbox.scan` — on-demand inbox folder scan.
///
/// Returns a stub list of discovered file entries. The real implementation
/// will delegate to the filesystem inventory scanner.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta(rename = "inbox.scan")]
pub async fn inbox_scan(root_id: Option<String>) -> Result<InboxScanResult, String> {
    let root = root_id.unwrap_or_else(|| "root-inbox-001".to_owned());
    tracing::debug!("stub: inbox.scan root_id={root}");
    Ok(InboxScanResult {
        root_id: root,
        entries: vec![
            InboxFileEntry {
                path: "/astro/inbox/NGC7000_Ha_001.fits".to_owned(),
                file_name: "NGC7000_Ha_001.fits".to_owned(),
                size_bytes: 67_108_864,
                extension: "fits".to_owned(),
            },
            InboxFileEntry {
                path: "/astro/inbox/M31_L_001.fits".to_owned(),
                file_name: "M31_L_001.fits".to_owned(),
                size_bytes: 67_108_864,
                extension: "fits".to_owned(),
            },
            InboxFileEntry {
                path: "/astro/inbox/IC1396_SII_001.xisf".to_owned(),
                file_name: "IC1396_SII_001.xisf".to_owned(),
                size_bytes: 134_217_728,
                extension: "xisf".to_owned(),
            },
        ],
        total_count: 3,
        total_size_bytes: 268_435_456,
    })
}
