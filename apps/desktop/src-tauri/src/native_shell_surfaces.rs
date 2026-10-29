// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The library shell's native menu bar and tray, and its guarded Quit.
//!
//! Every label comes from the desktop-ui message catalogue. The host starts in
//! the default locale; the UI sends the active locale's labels
//! ([`library_native_menu_set_labels`]) on start and whenever the locale
//! changes.
//!
//! Quit (the menu or its ⌘Q / Ctrl+Q shortcut, the tray, or closing the last
//! window) asks first only while an import, an index or an Apply runs
//! (D-W157). Otherwise it exits at once. The question is the UI's
//! confirmation dialog, so it keeps the shared Cancel-then-action order
//! (D-W159): the host emits [`NATIVE_QUIT_CONFIRM_EVENT`] with the work a
//! Quit would interrupt, and exits only when the UI answers that request with
//! Confirm ([`library_native_quit_answer`]). Cancel leaves the work running.
//! [`QuitGate`] owns that decision; the handlers here only carry it out.
//!
//! A quit from outside the app's own items exits unasked: the macOS Dock or
//! app-switcher Quit (`terminate:`, which tao answers without an
//! `ExitRequested`), signing out, a force quit or a crash. The work then reads
//! Interrupted with Retry on the next launch, as after a confirmed Quit.

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
// GTK has no Undo, Redo, Minimise or Close Window item, so Linux builds no
// Window menu and never labels those (see `menu_bar`).
#[cfg_attr(target_os = "linux", allow(dead_code))]
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

/// What a Quit would interrupt (D-W157): the running imports and indexes
/// (scans), and the Project of each running Apply. Other work, such as a
/// measurement, a storage move or another Project operation, ends with the
/// app unasked.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct QuitWork {
    pub imports: u32,
    pub indexes: u32,
    /// The name of each Project whose Apply runs.
    pub applies: Vec<String>,
}

impl QuitWork {
    fn of(running: &RunningOperations) -> Self {
        let count = |ids: &[Uuid]| u32::try_from(ids.len()).unwrap_or(u32::MAX);
        Self {
            imports: count(&running.imports),
            indexes: count(&running.scans),
            applies: running
                .projects
                .iter()
                .filter(|project| project.operation.kind == ProjectOperationKind::Apply)
                .map(|project| project.project_name.clone())
                .collect(),
        }
    }

    fn is_empty(&self) -> bool {
        self.imports == 0 && self.indexes == 0 && self.applies.is_empty()
    }
}

/// A Quit that waits on the user, because work is running.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NativeQuitRequest {
    pub request_id: Uuid,
    /// The work the Quit would interrupt; `None` when the catalog could not
    /// say, which asks rather than risk interrupting it.
    pub work: Option<QuitWork>,
}

/// What a Quit request does next.
#[derive(Debug, PartialEq, Eq)]
enum QuitStep {
    Exit,
    Ask(NativeQuitRequest),
}

/// What the UI's answer to a [`NativeQuitRequest`] does.
#[derive(Debug, PartialEq, Eq)]
enum QuitAnswer {
    Exit,
    /// Cancel: the app stays open and the work keeps running.
    StayOpen,
}

/// The D-W157 quit decision and the requests still waiting on the UI.
#[derive(Default)]
struct QuitGate(Mutex<HashSet<Uuid>>);

impl QuitGate {
    /// Exit at once when nothing a Quit would interrupt runs; otherwise
    /// record a request for the UI to answer. `work` is `None` when the
    /// running work is unknown.
    fn request(&self, work: Option<QuitWork>) -> QuitStep {
        if work.as_ref().is_some_and(QuitWork::is_empty) {
            return QuitStep::Exit;
        }
        let request_id = Uuid::new_v4();
        self.0.lock().unwrap_or_else(PoisonError::into_inner).insert(request_id);
        QuitStep::Ask(NativeQuitRequest { request_id, work })
    }

    /// Settle a waiting request: Confirm exits, Cancel stays open. `None`
    /// when `request_id` was already answered or never made.
    fn answer(&self, request_id: Uuid, confirmed: bool) -> Option<QuitAnswer> {
        let waiting = self.0.lock().unwrap_or_else(PoisonError::into_inner).remove(&request_id);
        waiting.then_some(if confirmed { QuitAnswer::Exit } else { QuitAnswer::StayOpen })
    }
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
    app.manage(QuitGate::default());
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
        let work = running_work(&app).await;
        let request = match app.state::<QuitGate>().request(work) {
            QuitStep::Exit => {
                app.exit(0);
                return;
            }
            QuitStep::Ask(request) => request,
        };
        // A tray or ⌘Q Quit can come while the window is minimised or behind
        // others; the question is asked in it, so bring it forward first.
        show_window(&app);
        if let Err(error) = app.emit(NATIVE_QUIT_CONFIRM_EVENT, request) {
            tracing::error!(%error, "the quit confirmation did not reach the UI");
        }
    });
}

/// The work a Quit would interrupt, or `None` when the catalog cannot say.
/// A host without a library has none.
async fn running_work(app: &AppHandle<Wry>) -> Option<QuitWork> {
    let Some(library) = app.try_state::<std::sync::Arc<Library>>() else {
        return Some(QuitWork::default());
    };
    match library.catalog().running_operations().await {
        Ok(running) => Some(QuitWork::of(&running)),
        Err(error) => {
            tracing::error!(%error, "running work is unknown; Quit asks first");
            None
        }
    }
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
    let answer = app.try_state::<QuitGate>().and_then(|gate| gate.answer(request_id, confirmed));
    match answer {
        Some(QuitAnswer::Exit) => app.exit(0),
        Some(QuitAnswer::StayOpen) => {}
        None => {
            return Err(fail(Some(request_id))(LibraryError::NotFound(format!(
                "quit request {request_id} is not waiting for an answer"
            ))));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use persistence_library::{RunningOperations, RunningProject};
    use platevault_core::{ProjectOperation, ProjectOperationKind, ProjectOperationState};
    use uuid::Uuid;

    use super::{
        catalogue_labels, Label, NativeMenuLabels, QuitAnswer, QuitGate, QuitStep, QuitWork,
    };

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

    fn running(projects: Vec<RunningProject>) -> RunningOperations {
        RunningOperations { projects, ..RunningOperations::default() }
    }

    /// D-W157: Quit exits at once when idle, and while only a measurement, a
    /// storage move or a Project operation other than Apply runs.
    #[test]
    fn quit_exits_at_once_while_nothing_it_would_interrupt_runs() {
        let gate = QuitGate::default();
        let other = RunningOperations {
            measurements: vec![Uuid::new_v4()],
            storage: vec![Uuid::new_v4()],
            ..running(vec![
                project(ProjectOperationKind::CopyToOutput),
                project(ProjectOperationKind::Archive),
            ])
        };
        for idle in [RunningOperations::default(), other] {
            assert_eq!(gate.request(Some(QuitWork::of(&idle))), QuitStep::Exit, "{idle:?}");
        }
    }

    /// D-W157: while an import, an index or an Apply runs, Quit asks, and the
    /// request names that work.
    #[test]
    fn quit_asks_naming_a_running_import_index_or_apply() {
        let gate = QuitGate::default();
        let cases = [
            (
                RunningOperations {
                    imports: vec![Uuid::new_v4(), Uuid::new_v4()],
                    ..RunningOperations::default()
                },
                QuitWork { imports: 2, ..QuitWork::default() },
            ),
            (
                RunningOperations { scans: vec![Uuid::new_v4()], ..RunningOperations::default() },
                QuitWork { indexes: 1, ..QuitWork::default() },
            ),
            (
                running(vec![
                    project(ProjectOperationKind::Apply),
                    project(ProjectOperationKind::CopyToOutput),
                ]),
                QuitWork { applies: vec!["Cygnus".to_owned()], ..QuitWork::default() },
            ),
        ];
        for (busy, named) in cases {
            match gate.request(Some(QuitWork::of(&busy))) {
                QuitStep::Ask(request) => assert_eq!(request.work, Some(named)),
                QuitStep::Exit => panic!("exited while {busy:?} runs"),
            }
        }
    }

    /// When the catalog cannot say what runs, Quit asks rather than risk
    /// interrupting work.
    #[test]
    fn quit_asks_while_the_running_work_is_unknown() {
        let QuitStep::Ask(request) = QuitGate::default().request(None) else {
            panic!("exited with the running work unknown");
        };
        assert_eq!(request.work, None);
    }

    /// Cancel keeps the app open, Confirm exits, and each request is
    /// answered once.
    #[test]
    fn cancel_stays_open_confirm_exits_and_each_request_answers_once() {
        let gate = QuitGate::default();
        let busy = Some(QuitWork { imports: 1, ..QuitWork::default() });
        let (QuitStep::Ask(cancelled), QuitStep::Ask(confirmed)) =
            (gate.request(busy.clone()), gate.request(busy))
        else {
            panic!("a busy Quit exited");
        };
        assert_eq!(gate.answer(cancelled.request_id, false), Some(QuitAnswer::StayOpen));
        assert_eq!(
            gate.answer(cancelled.request_id, true),
            None,
            "a cancelled request answers twice"
        );
        assert_eq!(gate.answer(confirmed.request_id, true), Some(QuitAnswer::Exit));
        assert_eq!(gate.answer(Uuid::new_v4(), true), None, "a request never made answers");
    }
}
