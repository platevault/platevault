// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The host input OS notifications need (spec 051 US8): whether the main
//! window is focused. The notification policy and its delivery live in
//! `desktop_services::notifications`.

use tauri::{AppHandle, Manager, Runtime};

use crate::MAIN_WINDOW_LABEL;

/// The main window's focus state, or `None` if it cannot be determined (no
/// main window yet, or the runtime call failed).
pub fn main_window_focused<R: Runtime>(app: &AppHandle<R>) -> Option<bool> {
    app.get_webview_window(MAIN_WINDOW_LABEL)?.is_focused().ok()
}
