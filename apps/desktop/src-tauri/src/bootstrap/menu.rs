// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The native application menu (spec 051 US5).
//!
//! Every label comes from the frontend message catalogue
//! (`apps/desktop/messages`). The menu is built with the base locale's labels,
//! embedded from that catalogue so the menu reads correctly before the webview
//! loads; the frontend then calls [`native_menu_set_labels`] with the active
//! locale's labels at startup and on every locale change.

use contracts_core::ContractError;
use serde::Deserialize;
use tauri::menu::{IsMenuItem, Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, Runtime, Wry};

/// Menu id for the native "Settings…" application-menu item (spec 051 US5).
pub const MENU_ID_SETTINGS: &str = "menu-settings";

/// Menu id for the app's own Quit item. `PredefinedMenuItem::quit` is not
/// used: on macOS it sends `terminate:` and on Windows it posts
/// `PostQuitMessage`, and neither reaches `RunEvent::ExitRequested`, so the
/// install-on-quit gate (`update_exit_gate`) would never see it.
/// `on_menu_event` answers this id with `app.exit(0)`, which does.
pub const MENU_ID_QUIT: &str = "menu-quit";

/// The App submenu's title: the app name, a proper noun no locale translates.
const APP_NAME: &str = "PlateVault";

/// The base-locale catalogue, embedded so the menu has labels before the
/// frontend can send the active locale's.
const BASE_CATALOGUE: &str = include_str!("../../../messages/en-GB.json");

/// Each native menu entry whose text comes from the catalogue.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MenuLabel {
    About,
    Settings,
    Quit,
    Edit,
    Undo,
    Redo,
    Cut,
    Copy,
    Paste,
    SelectAll,
    Window,
    Minimise,
    CloseWindow,
}

/// The visible text of every native menu entry, in one locale.
#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NativeMenuLabels {
    pub about: String,
    pub settings: String,
    pub quit: String,
    pub edit: String,
    pub undo: String,
    pub redo: String,
    pub cut: String,
    pub copy: String,
    pub paste: String,
    pub select_all: String,
    pub window: String,
    pub minimise: String,
    pub close_window: String,
}

impl NativeMenuLabels {
    fn text(&self, label: MenuLabel) -> &str {
        match label {
            MenuLabel::About => &self.about,
            MenuLabel::Settings => &self.settings,
            MenuLabel::Quit => &self.quit,
            MenuLabel::Edit => &self.edit,
            MenuLabel::Undo => &self.undo,
            MenuLabel::Redo => &self.redo,
            MenuLabel::Cut => &self.cut,
            MenuLabel::Copy => &self.copy,
            MenuLabel::Paste => &self.paste,
            MenuLabel::SelectAll => &self.select_all,
            MenuLabel::Window => &self.window,
            MenuLabel::Minimise => &self.minimise,
            MenuLabel::CloseWindow => &self.close_window,
        }
    }

    /// Reads the labels from a catalogue in the inlang message format.
    ///
    /// # Errors
    ///
    /// The catalogue is not JSON, or lacks a plain-text value for a label.
    fn from_catalogue(json: &str) -> Result<Self, String> {
        let catalogue: MenuCatalogue =
            serde_json::from_str(json).map_err(|e| format!("unreadable menu catalogue: {e}"))?;
        Ok(catalogue.into())
    }
}

/// The menu's keys in a message catalogue. Deserializing into this struct
/// skips every other message without allocating it.
#[derive(Deserialize)]
struct MenuCatalogue {
    #[serde(rename = "menu_about")]
    about: String,
    #[serde(rename = "menu_settings")]
    settings: String,
    #[serde(rename = "menu_quit")]
    quit: String,
    #[serde(rename = "menu_edit")]
    edit: String,
    #[serde(rename = "menu_undo")]
    undo: String,
    #[serde(rename = "menu_redo")]
    redo: String,
    #[serde(rename = "menu_cut")]
    cut: String,
    #[serde(rename = "menu_copy")]
    copy: String,
    #[serde(rename = "menu_paste")]
    paste: String,
    #[serde(rename = "common_select_all")]
    select_all: String,
    #[serde(rename = "menu_window")]
    window: String,
    #[serde(rename = "menu_minimise")]
    minimise: String,
    #[serde(rename = "menu_close_window")]
    close_window: String,
}

impl From<MenuCatalogue> for NativeMenuLabels {
    fn from(catalogue: MenuCatalogue) -> Self {
        let MenuCatalogue {
            about,
            settings,
            quit,
            edit,
            undo,
            redo,
            cut,
            copy,
            paste,
            select_all,
            window,
            minimise,
            close_window,
        } = catalogue;
        Self {
            about,
            settings,
            quit,
            edit,
            undo,
            redo,
            cut,
            copy,
            paste,
            select_all,
            window,
            minimise,
            close_window,
        }
    }
}

/// A menu entry whose visible text can change: the platform seam the label
/// tests replace.
trait Relabel {
    fn relabel(&self, text: &str) -> tauri::Result<()>;
}

impl<R: Runtime> Relabel for MenuItemKind<R> {
    fn relabel(&self, text: &str) -> tauri::Result<()> {
        match self {
            Self::MenuItem(item) => item.set_text(text),
            Self::Submenu(item) => item.set_text(text),
            Self::Predefined(item) => item.set_text(text),
            Self::Check(item) => item.set_text(text),
            Self::Icon(item) => item.set_text(text),
        }
    }
}

/// Sets every entry's text to its label in `labels`.
fn apply_labels<T: Relabel>(
    entries: &[(MenuLabel, T)],
    labels: &NativeMenuLabels,
) -> tauri::Result<()> {
    entries.iter().try_for_each(|(label, entry)| entry.relabel(labels.text(*label)))
}

/// The installed menu's relabelable entries, held as app state for
/// [`native_menu_set_labels`].
struct NativeMenu(Vec<(MenuLabel, MenuItemKind<Wry>)>);

/// Build the native application menu (spec 051 US5, T032): an App submenu
/// (About, Settings, Quit), a standard Edit submenu (undo/redo/cut/copy/
/// paste/select-all) and a Window submenu (minimise/close). Returns the menu
/// and its relabelable entries.
///
/// The Edit and Window entries stay muda's predefined items, so they keep
/// their OS roles and accelerators; only their text comes from `labels`. The
/// "Settings…" item has no native dialog of its own — its click is handled by
/// `on_menu_event` in `build_app()`, which emits a frontend event for the
/// existing Settings route to handle (T033: reuse existing UI, no new native
/// dialog). Quit is handled there too (see [`MENU_ID_QUIT`]).
fn build_native_menu(
    app: &tauri::App<Wry>,
    labels: &NativeMenuLabels,
) -> tauri::Result<(Menu<Wry>, NativeMenu)> {
    let about = PredefinedMenuItem::about(app, Some(&labels.about), None)?;
    let settings =
        MenuItem::with_id(app, MENU_ID_SETTINGS, &labels.settings, true, Some("CmdOrCtrl+,"))?;
    let quit = MenuItem::with_id(app, MENU_ID_QUIT, &labels.quit, true, Some("CmdOrCtrl+Q"))?;
    let app_menu = Submenu::with_items(
        app,
        APP_NAME,
        true,
        &[
            &about,
            &PredefinedMenuItem::separator(app)?,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let undo = PredefinedMenuItem::undo(app, Some(&labels.undo))?;
    let redo = PredefinedMenuItem::redo(app, Some(&labels.redo))?;
    let cut = PredefinedMenuItem::cut(app, Some(&labels.cut))?;
    let copy = PredefinedMenuItem::copy(app, Some(&labels.copy))?;
    let paste = PredefinedMenuItem::paste(app, Some(&labels.paste))?;
    let select_all = PredefinedMenuItem::select_all(app, Some(&labels.select_all))?;
    let edit_menu = Submenu::with_items(
        app,
        &labels.edit,
        true,
        &[&undo, &redo, &PredefinedMenuItem::separator(app)?, &cut, &copy, &paste, &select_all],
    )?;

    let minimise = PredefinedMenuItem::minimize(app, Some(&labels.minimise))?;
    let close_window = PredefinedMenuItem::close_window(app, Some(&labels.close_window))?;
    let window_menu = Submenu::with_items(app, &labels.window, true, &[&minimise, &close_window])?;

    let menu = Menu::with_items(app, &[&app_menu, &edit_menu, &window_menu])?;
    let entries = vec![
        (MenuLabel::About, about.kind()),
        (MenuLabel::Settings, settings.kind()),
        (MenuLabel::Quit, quit.kind()),
        (MenuLabel::Edit, edit_menu.kind()),
        (MenuLabel::Undo, undo.kind()),
        (MenuLabel::Redo, redo.kind()),
        (MenuLabel::Cut, cut.kind()),
        (MenuLabel::Copy, copy.kind()),
        (MenuLabel::Paste, paste.kind()),
        (MenuLabel::SelectAll, select_all.kind()),
        (MenuLabel::Window, window_menu.kind()),
        (MenuLabel::Minimise, minimise.kind()),
        (MenuLabel::CloseWindow, close_window.kind()),
    ];
    Ok((menu, NativeMenu(entries)))
}

/// Build the native menu in the base locale, set it as the app menu, and keep
/// its entries for [`native_menu_set_labels`]. A failure is logged and leaves
/// the app without a native menu, as before the menu existed.
pub fn install_native_menu(app: &tauri::App<Wry>) {
    if let Err(e) = try_install_native_menu(app) {
        tracing::warn!("native application menu not installed: {e}");
    }
}

fn try_install_native_menu(app: &tauri::App<Wry>) -> Result<(), String> {
    let labels = NativeMenuLabels::from_catalogue(BASE_CATALOGUE)?;
    let (menu, entries) =
        build_native_menu(app, &labels).map_err(|e| format!("failed to build it: {e}"))?;
    app.set_menu(menu).map_err(|e| format!("failed to set it: {e}"))?;
    app.manage(entries);
    Ok(())
}

/// `native_menu_set_labels` — the frontend sends the active locale's menu
/// labels from its catalogue, at startup and on every locale change. Without
/// an installed menu there is nothing to relabel, which is not an error.
///
/// # Errors
///
/// The platform refused to change an entry's text.
#[tauri::command]
#[specta::specta]
#[allow(clippy::needless_pass_by_value)] // Tauri injects arguments by value
pub fn native_menu_set_labels(
    app: AppHandle,
    labels: NativeMenuLabels,
) -> Result<(), ContractError> {
    let Some(menu) = app.try_state::<NativeMenu>() else {
        return Ok(());
    };
    apply_labels(&menu.0, &labels)
        .map_err(|e| ContractError::internal(format!("failed to relabel the native menu: {e}")))
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use super::*;

    const PT_BR_CATALOGUE: &str = include_str!("../../../messages/pt-BR.json");

    /// Records the last text it was given.
    #[derive(Default)]
    struct Recorder(RefCell<Option<String>>);

    impl Relabel for Recorder {
        fn relabel(&self, text: &str) -> tauri::Result<()> {
            *self.0.borrow_mut() = Some(text.to_owned());
            Ok(())
        }
    }

    impl Recorder {
        fn text(&self) -> Option<String> {
            self.0.borrow().clone()
        }
    }

    #[test]
    fn apply_labels_sets_each_entry_to_its_own_label() {
        let entries = [
            MenuLabel::About,
            MenuLabel::Quit,
            MenuLabel::Edit,
            MenuLabel::SelectAll,
            MenuLabel::CloseWindow,
        ]
        .map(|label| (label, Recorder::default()));
        let en_gb = NativeMenuLabels::from_catalogue(BASE_CATALOGUE).expect("en-GB labels");
        let pt_br = NativeMenuLabels::from_catalogue(PT_BR_CATALOGUE).expect("pt-BR labels");

        apply_labels(&entries, &en_gb).expect("apply en-GB");
        apply_labels(&entries, &pt_br).expect("apply pt-BR");

        let texts: Vec<_> = entries.iter().map(|(_, entry)| entry.text()).collect();
        assert_eq!(
            texts,
            [
                Some(pt_br.about.clone()),
                Some(pt_br.quit.clone()),
                Some(pt_br.edit.clone()),
                Some(pt_br.select_all.clone()),
                Some(pt_br.close_window.clone()),
            ]
        );
        assert_ne!(pt_br.about, en_gb.about, "pt-BR replaced the en-GB text");
    }

    #[test]
    fn every_shipped_catalogue_carries_every_menu_label() {
        let en_gb = NativeMenuLabels::from_catalogue(BASE_CATALOGUE).expect("en-GB labels");
        let pt_br = NativeMenuLabels::from_catalogue(PT_BR_CATALOGUE).expect("pt-BR labels");
        assert_eq!(en_gb.quit, "Quit PlateVault");
        assert_eq!(pt_br.quit, "Encerrar PlateVault");
    }

    #[test]
    fn a_catalogue_missing_a_label_names_the_key() {
        let err = NativeMenuLabels::from_catalogue(
            r#"{"$schema": "inlang", "inbox_title": "Inbox", "menu_about": "About"}"#,
        )
        .expect_err("incomplete catalogue");
        assert!(err.contains("missing field `menu_settings`"), "{err}");
    }
}
