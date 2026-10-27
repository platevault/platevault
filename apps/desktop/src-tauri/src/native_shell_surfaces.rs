// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The library shell's native menu bar and tray, and its guarded Quit.
//!
//! Every label comes from the desktop-ui message catalogue. The host starts in
//! the default locale; the UI sends the active locale's labels
//! ([`library_native_menu_set_labels`]) on start and whenever the locale
//! changes.
//!
//! Quit (the menu, the tray, or closing the last window) asks first only
//! while an import, an index or an Apply runs (D-W157). Otherwise it exits at
//! once. The question is the UI's confirmation dialog, so it keeps the shared
//! Cancel-then-action order (D-W159): the host emits
//! [`NATIVE_QUIT_CONFIRM_EVENT`] and exits only when the UI answers that
//! request with Confirm ([`library_native_quit_answer`]).

use std::collections::HashSet;
use std::sync::{Mutex, PoisonError};

use persistence_library::RunningOperations;
use platevault_core::library::Library;
use platevault_core::{ErrorResponse, LibraryError, ProjectOperationKind};
use serde::{Deserialize, Serialize};
use tauri::menu::{IsMenuItem, Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, WindowEvent, Wry};
use uuid::Uuid;

use crate::commands::library::fail;

const MENU_ID_QUIT: &str = "library-menu-quit";
const TRAY_ID: &str = "platevault-library-tray";
const TRAY_ID_SHOW: &str = "library-tray-show";
const TRAY_ID_QUIT: &str = "library-tray-quit";
const DEFAULT_LOCALE: &str = "en-GB";

/// Emitted to the UI when a Quit needs the user's confirmation.
pub const NATIVE_QUIT_CONFIRM_EVENT: &str = "native_quit_confirm";

/// Every catalogue label the native menu bar and tray show.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NativeMenuLabels {
    pub about: String,
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
    pub show: String,
}

/// The same labels, read under their catalogue keys.
#[derive(Deserialize)]
#[allow(clippy::struct_field_names)] // the fields are the catalogue keys
struct CatalogueLabels {
    menu_about: String,
    shell_quit_app: String,
    menu_edit: String,
    menu_undo: String,
    menu_redo: String,
    menu_cut: String,
    menu_copy: String,
    menu_paste: String,
    menu_select_all: String,
    menu_window: String,
    menu_minimise: String,
    menu_close_window: String,
    menu_show: String,
}

impl From<CatalogueLabels> for NativeMenuLabels {
    fn from(keys: CatalogueLabels) -> Self {
        Self {
            about: keys.menu_about,
            quit: keys.shell_quit_app,
            edit: keys.menu_edit,
            undo: keys.menu_undo,
            redo: keys.menu_redo,
            cut: keys.menu_cut,
            copy: keys.menu_copy,
            paste: keys.menu_paste,
            select_all: keys.menu_select_all,
            window: keys.menu_window,
            minimise: keys.menu_minimise,
            close_window: keys.menu_close_window,
            show: keys.menu_show,
        }
    }
}

/// The catalogue labels of `locale`; an unknown locale reads the default one.
fn catalogue_labels(locale: &str) -> Result<NativeMenuLabels, String> {
    let catalogue = match locale {
        "pt-BR" => include_str!("../../../desktop-ui/messages/pt-BR.json"),
        _ => include_str!("../../../desktop-ui/messages/en-GB.json"),
    };
    serde_json::from_str::<CatalogueLabels>(catalogue)
        .map(NativeMenuLabels::from)
        .map_err(|error| format!("the {locale} catalogue lacks a native menu label: {error}"))
}

/// One labelled native item.
#[derive(Clone, Copy)]
enum Label {
    About,
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
    Show,
}

impl NativeMenuLabels {
    fn text(&self, label: Label) -> &str {
        match label {
            Label::About => &self.about,
            Label::Quit => &self.quit,
            Label::Edit => &self.edit,
            Label::Undo => &self.undo,
            Label::Redo => &self.redo,
            Label::Cut => &self.cut,
            Label::Copy => &self.copy,
            Label::Paste => &self.paste,
            Label::SelectAll => &self.select_all,
            Label::Window => &self.window,
            Label::Minimise => &self.minimise,
            Label::CloseWindow => &self.close_window,
            Label::Show => &self.show,
        }
    }
}

fn relabel(item: &MenuItemKind<Wry>, text: &str) -> tauri::Result<()> {
    match item {
        MenuItemKind::MenuItem(item) => item.set_text(text),
        MenuItemKind::Submenu(item) => item.set_text(text),
        MenuItemKind::Predefined(item) => item.set_text(text),
        MenuItemKind::Check(item) => item.set_text(text),
        MenuItemKind::Icon(item) => item.set_text(text),
    }
}

/// The labelled items of the installed menu bar and tray, for relabelling.
struct NativeItems(Vec<(Label, MenuItemKind<Wry>)>);

/// Quit requests the UI has not answered yet.
#[derive(Default)]
struct PendingQuits(Mutex<HashSet<Uuid>>);

/// A Quit that waits on the user, because work is running.
#[derive(Clone, Copy, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NativeQuitRequest {
    pub request_id: Uuid,
}

fn menu_bar(
    app: &AppHandle<Wry>,
    labels: &NativeMenuLabels,
) -> tauri::Result<(Menu<Wry>, Vec<(Label, MenuItemKind<Wry>)>)> {
    let about = PredefinedMenuItem::about(app, Some(&labels.about), None)?;
    let quit = MenuItem::with_id(app, MENU_ID_QUIT, &labels.quit, true, Some("CmdOrCtrl+Q"))?;
    let app_menu = Submenu::with_items(
        app,
        "PlateVault",
        true,
        &[&about, &PredefinedMenuItem::separator(app)?, &quit],
    )?;
    let cut = PredefinedMenuItem::cut(app, Some(&labels.cut))?;
    let copy = PredefinedMenuItem::copy(app, Some(&labels.copy))?;
    let paste = PredefinedMenuItem::paste(app, Some(&labels.paste))?;
    let select_all = PredefinedMenuItem::select_all(app, Some(&labels.select_all))?;
    let mut items = vec![
        (Label::About, about.kind()),
        (Label::Quit, quit.kind()),
        (Label::Cut, cut.kind()),
        (Label::Copy, copy.kind()),
        (Label::Paste, paste.kind()),
        (Label::SelectAll, select_all.kind()),
    ];
    // GTK has no Undo, Redo, Minimise or Close Window item (muda draws them
    // disabled), so Linux shows only what works: Cut, Copy, Paste and Select
    // All, and no Window menu.
    #[cfg(not(target_os = "linux"))]
    let menu = {
        let undo = PredefinedMenuItem::undo(app, Some(&labels.undo))?;
        let redo = PredefinedMenuItem::redo(app, Some(&labels.redo))?;
        let edit = Submenu::with_items(
            app,
            &labels.edit,
            true,
            &[&undo, &redo, &PredefinedMenuItem::separator(app)?, &cut, &copy, &paste, &select_all],
        )?;
        let minimise = PredefinedMenuItem::minimize(app, Some(&labels.minimise))?;
        let close = PredefinedMenuItem::close_window(app, Some(&labels.close_window))?;
        let window = Submenu::with_items(app, &labels.window, true, &[&minimise, &close])?;
        items.extend([
            (Label::Edit, edit.kind()),
            (Label::Undo, undo.kind()),
            (Label::Redo, redo.kind()),
            (Label::Window, window.kind()),
            (Label::Minimise, minimise.kind()),
            (Label::CloseWindow, close.kind()),
        ]);
        Menu::with_items(app, &[&app_menu, &edit, &window])?
    };
    #[cfg(target_os = "linux")]
    let menu = {
        let edit =
            Submenu::with_items(app, &labels.edit, true, &[&cut, &copy, &paste, &select_all])?;
        items.push((Label::Edit, edit.kind()));
        Menu::with_items(app, &[&app_menu, &edit])?
    };
    Ok((menu, items))
}

/// Install the menu bar and the tray (Show, Quit) in the default
/// locale. A desktop without a tray (a Linux session with no status-notifier
/// host) keeps the menu bar and the window; only the tray is missing.
///
/// # Errors
/// The catalogue lacks a label, or the platform refuses the menu bar.
pub fn install(app: &AppHandle<Wry>) -> Result<(), String> {
    let labels = catalogue_labels(DEFAULT_LOCALE)?;
    let (menu, mut items) = menu_bar(app, &labels)
        .map_err(|error| format!("the native menu bar was refused: {error}"))?;
    app.set_menu(menu).map_err(|error| format!("the native menu bar was refused: {error}"))?;
    // Building a Linux tray panics inside libappindicator-sys when neither
    // indicator library is installed, so a panic is a missing tray too.
    let built = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| tray(app, &labels)));
    match built {
        Ok(Ok(tray_items)) => items.extend(tray_items),
        Ok(Err(error)) => tracing::warn!(%error, "no tray: this desktop refused it"),
        Err(_) => tracing::warn!("no tray: this desktop has no indicator library"),
    }
    app.manage(NativeItems(items));
    app.manage(PendingQuits::default());
    Ok(())
}

fn tray(
    app: &AppHandle<Wry>,
    labels: &NativeMenuLabels,
) -> tauri::Result<Vec<(Label, MenuItemKind<Wry>)>> {
    let show = MenuItem::with_id(app, TRAY_ID_SHOW, &labels.show, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, TRAY_ID_QUIT, &labels.quit, true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let mut tray = TrayIconBuilder::with_id(TRAY_ID).menu(&menu).show_menu_on_left_click(true);
    if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    }
    tray.build(app)?;
    Ok(vec![(Label::Show, show.kind()), (Label::Quit, quit.kind())])
}

/// Route a menu-bar or tray click.
pub fn on_menu(app: &AppHandle<Wry>, id: &str) {
    match id {
        MENU_ID_QUIT | TRAY_ID_QUIT => request_quit(app),
        TRAY_ID_SHOW => show_window(app),
        _ => (),
    }
}

/// Closing the window is a Quit too. It is held while the window still
/// exists, so the confirmation has a webview to ask in.
pub fn on_window_event(window: &tauri::Window<Wry>, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        request_quit(window.app_handle());
    }
}

fn show_window(app: &AppHandle<Wry>) {
    let Some(window) = app.webview_windows().into_values().next() else {
        return;
    };
    for result in [window.unminimize(), window.show(), window.set_focus()] {
        if let Err(error) = result {
            tracing::error!(%error, "the library window could not be shown");
        }
    }
}

/// Exit now, or, while an import, an index or an Apply runs, ask the UI.
fn request_quit(app: &AppHandle<Wry>) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if !work_runs(&app).await {
            app.exit(0);
            return;
        }
        let request_id = Uuid::new_v4();
        app.state::<PendingQuits>()
            .0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(request_id);
        if let Err(error) = app.emit(NATIVE_QUIT_CONFIRM_EVENT, NativeQuitRequest { request_id }) {
            tracing::error!(%error, "the quit confirmation did not reach the UI");
        }
    });
}

/// Whether an import, an index or an Apply runs. When the catalog cannot say,
/// it counts as running, so the user is asked rather than interrupted.
async fn work_runs(app: &AppHandle<Wry>) -> bool {
    let Some(library) = app.try_state::<std::sync::Arc<Library>>() else {
        return false;
    };
    match library.catalog().running_operations().await {
        Ok(running) => asks_before_quit(&running),
        Err(error) => {
            tracing::error!(%error, "running work is unknown; Quit asks first");
            true
        }
    }
}

/// Quit asks first while an import, an index (a scan) or an Apply runs
/// (D-W157); other work, such as a measurement, ends with the app.
fn asks_before_quit(running: &RunningOperations) -> bool {
    !running.imports.is_empty()
        || !running.scans.is_empty()
        || running
            .projects
            .iter()
            .any(|project| project.operation.kind == ProjectOperationKind::Apply)
}

/// Relabel the menu bar and the tray in the UI's active locale.
///
/// # Errors
/// The platform refuses a label change.
#[tauri::command]
#[specta::specta]
#[allow(clippy::needless_pass_by_value)] // Tauri injects arguments by value
pub fn library_native_menu_set_labels(
    app: AppHandle,
    labels: NativeMenuLabels,
) -> Result<(), ErrorResponse> {
    let Some(items) = app.try_state::<NativeItems>() else {
        return Ok(());
    };
    for (label, item) in &items.0 {
        relabel(item, labels.text(*label)).map_err(|error| {
            fail(None)(LibraryError::SourceUnavailable(format!(
                "a native label was refused: {error}"
            )))
        })?;
    }
    Ok(())
}

/// The UI's answer to a [`NativeQuitRequest`]: Confirm exits, Cancel keeps
/// the app open with the work still running.
///
/// # Errors
/// The request was already answered or never made.
#[tauri::command]
#[specta::specta]
#[allow(clippy::needless_pass_by_value)] // Tauri injects arguments by value
pub fn library_native_quit_answer(
    app: AppHandle,
    request_id: Uuid,
    confirmed: bool,
) -> Result<(), ErrorResponse> {
    let answered = app.try_state::<PendingQuits>().is_some_and(|pending| {
        pending.0.lock().unwrap_or_else(PoisonError::into_inner).remove(&request_id)
    });
    if !answered {
        return Err(fail(Some(request_id))(LibraryError::NotFound(format!(
            "quit request {request_id} is not waiting for an answer"
        ))));
    }
    if confirmed {
        app.exit(0);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use persistence_library::{RunningOperations, RunningProject};
    use platevault_core::{ProjectOperation, ProjectOperationKind, ProjectOperationState};
    use uuid::Uuid;

    use super::{asks_before_quit, catalogue_labels, Label, NativeMenuLabels};

    const LABELS: [Label; 13] = [
        Label::About,
        Label::Quit,
        Label::Edit,
        Label::Undo,
        Label::Redo,
        Label::Cut,
        Label::Copy,
        Label::Paste,
        Label::SelectAll,
        Label::Window,
        Label::Minimise,
        Label::CloseWindow,
        Label::Show,
    ];

    fn texts(labels: &NativeMenuLabels) -> Vec<&str> {
        LABELS.iter().map(|label| labels.text(*label)).collect()
    }

    /// Both shipped catalogues carry every native label, and Portuguese is
    /// translated rather than a copy of the English catalogue.
    #[test]
    fn both_catalogues_label_every_native_item() {
        let english = catalogue_labels("en-GB").expect("en-GB labels");
        let portuguese = catalogue_labels("pt-BR").expect("pt-BR labels");
        for (locale, labels) in [("en-GB", &english), ("pt-BR", &portuguese)] {
            assert!(
                texts(labels).iter().all(|text| !text.trim().is_empty()),
                "{locale} has a blank label"
            );
        }
        assert_ne!(english.quit, portuguese.quit);
        assert_ne!(english.show, portuguese.show);
    }

    /// A locale the app does not ship falls back to the default catalogue.
    #[test]
    fn an_unknown_locale_reads_the_default_catalogue() {
        assert_eq!(catalogue_labels("fr-FR"), catalogue_labels("en-GB"));
    }

    fn project(kind: ProjectOperationKind) -> RunningProject {
        RunningProject {
            operation: ProjectOperation {
                id: Uuid::new_v4(),
                project_id: Uuid::new_v4(),
                kind,
                state: ProjectOperationState::Active,
                reserved_at: "2026-10-27T00:00:00Z".to_owned(),
                settled_at: None,
            },
            project_name: "Cygnus".to_owned(),
        }
    }

    /// D-W157: Quit asks while an import, an index or an Apply runs, and
    /// exits at once otherwise, including while a measurement, a storage
    /// move or another Project operation runs.
    #[test]
    fn quit_asks_only_while_an_import_an_index_or_an_apply_runs() {
        let idle = RunningOperations::default();
        assert!(!asks_before_quit(&idle));
        for asking in [
            RunningOperations { imports: vec![Uuid::new_v4()], ..idle.clone() },
            RunningOperations { scans: vec![Uuid::new_v4()], ..idle.clone() },
            RunningOperations {
                projects: vec![project(ProjectOperationKind::Apply)],
                ..idle.clone()
            },
        ] {
            assert!(asks_before_quit(&asking), "{asking:?}");
        }
        let other = RunningOperations {
            measurements: vec![Uuid::new_v4()],
            storage: vec![Uuid::new_v4()],
            projects: vec![
                project(ProjectOperationKind::CopyToOutput),
                project(ProjectOperationKind::Archive),
            ],
            ..idle
        };
        assert!(!asks_before_quit(&other), "{other:?}");
    }
}
