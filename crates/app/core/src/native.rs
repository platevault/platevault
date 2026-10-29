// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Native filesystem control use cases (spec 004).
//!
//! Thin orchestration layer providing input validation, error mapping to
//! contract error codes, and audit event emission for the three native
//! filesystem operations: directory pick, file pick, and reveal.

//!
//! Extracted from `app_core` into its own crate (spec 042 / T253 O3b) as a pure
//! leaf: it has zero `crate::` references and nothing else in `app_core`
//! references it. `app_core` re-exports this crate at `app_core::native` so the
//! public surface stays byte-identical.
#![allow(clippy::doc_markdown)] // spec/domain terminology not appropriate for backticks

use std::path::Path;

use audit::bus::EventBus;
use audit::event_bus::{NativeRevealFailed, Source, TOPIC_NATIVE_REVEAL_FAILED};
use contracts_core::native::{
    error_codes, DirectoryPickRequest, DirectoryPickResponse, FilePickRequest, FilePickResponse,
    RevealRequest, RevealResponse, RevealSelection,
};
use contracts_core::{error_code::ErrorCode, ContractError, ErrorSeverity};

// ── Directory picker ────────────────────────────────────────────────────────

/// Validate a directory-pick request.
///
/// The actual dialog is opened by the Tauri command layer (which owns the
/// window handle). This use case validates inputs and maps errors.
///
/// # Errors
///
/// Returns `ContractError` with `picker.unavailable` if something prevents
/// the dialog from being shown.
#[allow(clippy::result_large_err)] // ContractError size is acceptable at this boundary
pub fn validate_directory_pick(_req: &DirectoryPickRequest) -> Result<(), ContractError> {
    // No server-side validation needed for directory pick beyond what the
    // contract schema enforces. The default_path is silently ignored when
    // it does not exist (per contract spec).
    Ok(())
}

/// Build a cancelled response for directory pick.
#[must_use]
pub fn directory_pick_cancelled() -> DirectoryPickResponse {
    DirectoryPickResponse { path: None, cancelled: true }
}

/// Build a success response for directory pick.
#[must_use]
pub fn directory_pick_selected(path: String) -> DirectoryPickResponse {
    DirectoryPickResponse { path: Some(path), cancelled: false }
}

// ── File picker ─────────────────────────────────────────────────────────────

/// Validate a file-pick request, including filter rules.
///
/// The wildcard `*` extension is ONLY valid in a filter named exactly
/// `"All files"`; any other filter containing `*` returns `filters.invalid`.
///
/// # Errors
///
/// Returns `ContractError` with `filters.invalid` when filters violate the
/// wildcard rule (D-004-1).
#[allow(clippy::result_large_err)] // ContractError size is acceptable at this boundary
pub fn validate_file_pick(req: &FilePickRequest) -> Result<(), ContractError> {
    for filter in &req.filters {
        let has_wildcard = filter.extensions.iter().any(|ext| ext.contains('*'));
        if has_wildcard && filter.name != "All files" {
            return Err(ContractError::new(
                ErrorCode::FiltersInvalid,
                format!(
                    "Wildcard '*' extension is only valid in a filter named \"All files\", \
                     but found in filter \"{}\"",
                    filter.name
                ),
                ErrorSeverity::Blocking,
                false,
            ));
        }
    }
    Ok(())
}

/// Build a cancelled response for file pick.
#[must_use]
pub fn file_pick_cancelled() -> FilePickResponse {
    FilePickResponse { path: None, selected_filter: None, cancelled: true }
}

/// Build a success response for file pick.
#[must_use]
pub fn file_pick_selected(path: String, selected_filter: Option<String>) -> FilePickResponse {
    FilePickResponse { path: Some(path), selected_filter, cancelled: false }
}

// ── Reveal ──────────────────────────────────────────────────────────────────

/// The OS operations a reveal needs. The shells supply the platform opener;
/// tests supply a fake, so the path rules run without a desktop.
pub trait RevealOpener {
    /// Show `path` in the OS file manager with the item selected.
    ///
    /// # Errors
    /// Returns the OS failure message.
    fn reveal_item(&self, path: &Path) -> Result<(), String>;

    /// Open `directory` in the file manager without selecting anything: the
    /// Linux fallback when [`Self::reveal_item`] fails.
    ///
    /// # Errors
    /// Returns the OS failure message.
    fn open_directory(&self, directory: &Path) -> Result<(), String>;
}

/// Reveal an existing path in the OS file manager, without auditing.
///
/// The one reveal boundary both shells share: a missing path is refused
/// before the OS is asked, then the opener reveals the item, and on Linux a
/// failed reveal falls back to opening the parent directory
/// ([`RevealSelection::DirectoryOnly`]).
///
/// # Errors
/// `path.not_exists` when the path is missing, `os.command_failed` when its
/// metadata cannot be read, and `internal.error` when the OS reveal fails.
#[allow(clippy::result_large_err)] // ContractError size is acceptable at this boundary
pub fn reveal_path(
    opener: &impl RevealOpener,
    path: &Path,
) -> Result<RevealSelection, ContractError> {
    if let Err(error) = std::fs::metadata(path) {
        let code = if error.kind() == std::io::ErrorKind::NotFound {
            ErrorCode::PathNotExists
        } else {
            ErrorCode::OsCommandFailed
        };
        return Err(ContractError::new(
            code,
            format!("Path does not exist: {}", path.display()),
            ErrorSeverity::Blocking,
            false,
        ));
    }
    let Err(reveal_error) = opener.reveal_item(path) else {
        return Ok(RevealSelection::Target);
    };
    if cfg!(target_os = "linux") {
        match opener.open_directory(path.parent().unwrap_or(path)) {
            Ok(()) => return Ok(RevealSelection::DirectoryOnly),
            Err(fallback_error) => {
                tracing::warn!("reveal: xdg-open fallback also failed: {fallback_error}");
            }
        }
    }
    Err(ContractError::internal(format!("Failed to reveal path: {reveal_error}")))
}

/// [`reveal_path`] for the legacy shell, which publishes a best-effort
/// `native.reveal.failed` audit event on every failure.
///
/// # Errors
/// The [`reveal_path`] error, after the audit event is published.
#[allow(clippy::result_large_err)] // ContractError size is acceptable at this boundary
pub async fn reveal_path_with_audit(
    bus: &EventBus,
    opener: &impl RevealOpener,
    req: &RevealRequest,
) -> Result<RevealSelection, ContractError> {
    let result = reveal_path(opener, Path::new(&req.path));
    if let Err(error) = &result {
        let error_code = if error.code == ErrorCode::PathNotExists {
            error_codes::PATH_NOT_EXISTS
        } else {
            error_codes::OS_COMMAND_FAILED
        };
        let _ = bus
            .publish(
                TOPIC_NATIVE_REVEAL_FAILED,
                Source::System,
                NativeRevealFailed {
                    error_code: error_code.to_owned(),
                    entity_kind: req.entity_kind.map(|k| {
                        serde_json::to_value(k)
                            .ok()
                            .and_then(|v| v.as_str().map(String::from))
                            .unwrap_or_default()
                    }),
                    entity_id: req.entity_id.clone(),
                    request_id: req.request_id.clone(),
                },
            )
            .await;
    }
    result
}

/// Build a success response for reveal.
#[must_use]
pub fn reveal_success(selection: RevealSelection) -> RevealResponse {
    RevealResponse { revealed: true, selection }
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use contracts_core::native::{EntityKind, FileFilter};

    use super::*;

    // ── validate_file_pick ──────────────────────────────────────────────────

    #[test]
    fn rejects_wildcard_in_non_all_files_filter() {
        let req = FilePickRequest {
            request_id: "req-001".to_owned(),
            filters: vec![FileFilter {
                name: "Images".to_owned(),
                extensions: vec!["*".to_owned()],
            }],
            default_path: None,
        };
        let err = validate_file_pick(&req).unwrap_err();
        assert_eq!(err.code, ErrorCode::FiltersInvalid);
    }

    #[test]
    fn allows_wildcard_in_all_files_filter() {
        let req = FilePickRequest {
            request_id: "req-002".to_owned(),
            filters: vec![FileFilter {
                name: "All files".to_owned(),
                extensions: vec!["*".to_owned()],
            }],
            default_path: None,
        };
        assert!(validate_file_pick(&req).is_ok());
    }

    #[test]
    fn allows_normal_filters_without_wildcard() {
        let req = FilePickRequest {
            request_id: "req-003".to_owned(),
            filters: vec![
                FileFilter {
                    name: "FITS files".to_owned(),
                    extensions: vec!["fits".to_owned(), "fit".to_owned()],
                },
                FileFilter { name: "XISF files".to_owned(), extensions: vec!["xisf".to_owned()] },
            ],
            default_path: None,
        };
        assert!(validate_file_pick(&req).is_ok());
    }

    #[test]
    fn rejects_wildcard_mixed_with_normal_extensions() {
        let req = FilePickRequest {
            request_id: "req-004".to_owned(),
            filters: vec![FileFilter {
                name: "Mixed".to_owned(),
                extensions: vec!["fits".to_owned(), "*".to_owned()],
            }],
            default_path: None,
        };
        let err = validate_file_pick(&req).unwrap_err();
        assert_eq!(err.code, ErrorCode::FiltersInvalid);
    }

    // ── reveal_path / reveal_path_with_audit ────────────────────────────────

    /// Records what the reveal asked the OS for: each reveal and each folder
    /// opened, failing those its flags name.
    #[derive(Default)]
    struct FakeOpener {
        reveal_fails: bool,
        open_fails: bool,
        revealed: std::cell::RefCell<Vec<std::path::PathBuf>>,
        opened: std::cell::RefCell<Vec<std::path::PathBuf>>,
    }

    impl FakeOpener {
        /// Both the reveal and the Linux fallback fail.
        fn failing() -> Self {
            Self { reveal_fails: true, open_fails: true, ..Self::default() }
        }
    }

    fn outcome(fails: bool) -> Result<(), String> {
        if fails {
            Err("opener unavailable".to_owned())
        } else {
            Ok(())
        }
    }

    impl RevealOpener for FakeOpener {
        fn reveal_item(&self, path: &Path) -> Result<(), String> {
            self.revealed.borrow_mut().push(path.to_path_buf());
            outcome(self.reveal_fails)
        }

        fn open_directory(&self, directory: &Path) -> Result<(), String> {
            self.opened.borrow_mut().push(directory.to_path_buf());
            outcome(self.open_fails)
        }
    }

    fn reveal_request(request_id: &str, path: &Path) -> RevealRequest {
        RevealRequest {
            request_id: request_id.to_owned(),
            path: path.display().to_string(),
            entity_kind: Some(EntityKind::MasterCalibration),
            entity_id: Some("cal-99".to_owned()),
        }
    }

    async fn audit_bus() -> (EventBus, sqlx::SqlitePool) {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS events (\
             event_id INTEGER PRIMARY KEY AUTOINCREMENT,\
             topic TEXT NOT NULL,\
             source TEXT NOT NULL,\
             emitted_at TEXT NOT NULL,\
             payload TEXT NOT NULL\
             )",
        )
        .execute(&pool)
        .await
        .unwrap();
        (EventBus::with_pool(pool.clone()), pool)
    }

    async fn reveal_failures(pool: &sqlx::SqlitePool) -> Vec<String> {
        sqlx::query_scalar("SELECT payload FROM events WHERE topic = 'native.reveal.failed'")
            .fetch_all(pool)
            .await
            .unwrap()
    }

    #[test]
    fn reveal_refuses_a_missing_path_before_opening() {
        let scratch = tempfile::tempdir().unwrap();
        let opener = FakeOpener::default();

        let error = reveal_path(&opener, &scratch.path().join("missing")).unwrap_err();

        assert_eq!(error.code, ErrorCode::PathNotExists);
        assert!(opener.revealed.borrow().is_empty(), "a missing path never reaches the OS");
        assert!(opener.opened.borrow().is_empty(), "a missing path never reaches the OS");
    }

    #[test]
    fn reveal_selects_an_existing_path_through_the_opener() {
        let scratch = tempfile::tempdir().unwrap();
        let opener = FakeOpener::default();

        assert_eq!(reveal_path(&opener, scratch.path()).unwrap(), RevealSelection::Target);
        assert_eq!(*opener.revealed.borrow(), vec![scratch.path().to_path_buf()]);
        assert_eq!(*opener.opened.borrow(), Vec::<std::path::PathBuf>::new());
    }

    #[test]
    fn reveal_reports_a_failed_opener_as_an_error() {
        let scratch = tempfile::tempdir().unwrap();

        let error = reveal_path(&FakeOpener::failing(), scratch.path()).unwrap_err();

        assert_eq!(error.code, ErrorCode::InternalError);
    }

    /// Linux falls back to opening the parent folder when the reveal fails.
    #[cfg(target_os = "linux")]
    #[test]
    fn a_failed_reveal_opens_the_parent_folder_on_linux() {
        let scratch = tempfile::tempdir().unwrap();
        let file = scratch.path().join("masterDark.fit");
        std::fs::write(&file, b"master").unwrap();
        let opener = FakeOpener { reveal_fails: true, ..FakeOpener::default() };

        assert_eq!(reveal_path(&opener, &file).unwrap(), RevealSelection::DirectoryOnly);
        assert_eq!(*opener.revealed.borrow(), vec![file.clone()]);
        assert_eq!(*opener.opened.borrow(), vec![scratch.path().to_path_buf()]);
    }

    /// Elsewhere a failed reveal is the answer: no folder is opened instead.
    #[cfg(not(target_os = "linux"))]
    #[test]
    fn a_failed_reveal_opens_no_folder_off_linux() {
        let scratch = tempfile::tempdir().unwrap();
        let opener = FakeOpener { reveal_fails: true, ..FakeOpener::default() };

        assert!(reveal_path(&opener, scratch.path()).is_err());
        assert_eq!(*opener.opened.borrow(), Vec::<std::path::PathBuf>::new());
    }

    #[tokio::test]
    async fn audited_reveal_publishes_a_missing_path() {
        let (bus, pool) = audit_bus().await;
        let scratch = tempfile::tempdir().unwrap();
        let request = reveal_request("req-audit-missing", &scratch.path().join("missing"));

        let error =
            reveal_path_with_audit(&bus, &FakeOpener::default(), &request).await.unwrap_err();

        assert_eq!(error.code, ErrorCode::PathNotExists);
        let failures = reveal_failures(&pool).await;
        assert_eq!(failures.len(), 1, "one native.reveal.failed event: {failures:?}");
        assert!(failures[0].contains("path.not_exists"), "{failures:?}");
        assert!(failures[0].contains("req-audit-missing"), "{failures:?}");
    }

    #[tokio::test]
    async fn audited_reveal_publishes_a_failed_opener() {
        let (bus, pool) = audit_bus().await;
        let scratch = tempfile::tempdir().unwrap();
        let opener = FakeOpener::failing();
        let request = reveal_request("req-audit-os", scratch.path());

        assert!(reveal_path_with_audit(&bus, &opener, &request).await.is_err());

        let failures = reveal_failures(&pool).await;
        assert_eq!(failures.len(), 1, "one native.reveal.failed event: {failures:?}");
        assert!(failures[0].contains("os.command_failed"), "{failures:?}");
    }

    #[tokio::test]
    async fn audited_reveal_publishes_nothing_on_success() {
        let (bus, pool) = audit_bus().await;
        let scratch = tempfile::tempdir().unwrap();
        let request = reveal_request("req-audit-ok", scratch.path());

        let selection =
            reveal_path_with_audit(&bus, &FakeOpener::default(), &request).await.unwrap();

        assert_eq!(selection, RevealSelection::Target);
        assert_eq!(reveal_failures(&pool).await, Vec::<String>::new());
    }

    // ── Response builders ───────────────────────────────────────────────────

    #[test]
    fn directory_pick_cancelled_response() {
        let resp = directory_pick_cancelled();
        assert!(resp.path.is_none());
        assert!(resp.cancelled);
    }

    #[test]
    fn directory_pick_selected_response() {
        let resp = directory_pick_selected("/astro/raw".to_owned());
        assert_eq!(resp.path.as_deref(), Some("/astro/raw"));
        assert!(!resp.cancelled);
    }

    #[test]
    fn file_pick_cancelled_response() {
        let resp = file_pick_cancelled();
        assert!(resp.path.is_none());
        assert!(resp.selected_filter.is_none());
        assert!(resp.cancelled);
    }

    #[test]
    fn file_pick_selected_response() {
        let resp = file_pick_selected(
            "/astro/darks/master.fits".to_owned(),
            Some("FITS files".to_owned()),
        );
        assert_eq!(resp.path.as_deref(), Some("/astro/darks/master.fits"));
        assert_eq!(resp.selected_filter.as_deref(), Some("FITS files"));
        assert!(!resp.cancelled);
    }

    #[test]
    fn reveal_success_response() {
        let resp = reveal_success(RevealSelection::Target);
        assert!(resp.revealed);
        assert_eq!(resp.selection, RevealSelection::Target);
    }
}
