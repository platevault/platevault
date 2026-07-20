// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The native application menu (spec 051 US5).

/// Menu id for the native "Settings…" application-menu item (spec 051 US5).
pub(crate) const MENU_ID_SETTINGS: &str = "menu-settings";

/// Build the native application menu (spec 051 US5, T032): an App submenu
/// (About, Settings, Quit), a Window submenu, and a standard Edit submenu
/// (copy/cut/paste/select-all/undo/redo). The "Settings…" item has no native
/// dialog of its own — its click is handled by `on_menu_event` in
/// `build_app()`, which emits a frontend event for the existing Settings
/// route to handle (T033: reuse existing UI, no new native dialog).
pub(crate) fn build_native_menu(
    app: &tauri::App<tauri::Wry>,
) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

    let about = PredefinedMenuItem::about(app, Some("About PlateVault"), None)?;
    let settings =
        MenuItem::with_id(app, MENU_ID_SETTINGS, "Settings…", true, Some("CmdOrCtrl+,"))?;
    let quit = PredefinedMenuItem::quit(app, None)?;
    let app_menu = Submenu::with_items(
        app,
        "PlateVault",
        true,
        &[
            &about,
            &PredefinedMenuItem::separator(app)?,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[&PredefinedMenuItem::minimize(app, None)?, &PredefinedMenuItem::close_window(app, None)?],
    )?;

    Menu::with_items(app, &[&app_menu, &edit_menu, &window_menu])
}
