// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Appearance preferences IPC (spec 064 LIB-FR-21, LIB-AC-45; D-W166): the
//! theme or Match system pair, the language and the single-key shortcut
//! preference, kept in the app's per-user settings store
//! ([`PreferenceStore`]) outside every library.
//!
//! [`FirstFrame`] hands each new webview the stored preferences before its
//! page loads, so a restart paints the chosen theme and language from the
//! first frame; the frontend reads them from `window.__PLATEVAULT_PREFERENCES__`.
//!
//! Registered only by the isolated rebuilt shell ([`crate::library_shell`])
//! under its `appearance` block. Failures follow the library
//! [`platevault_core::ErrorResponse`] conventions.

use std::sync::Arc;

use platevault_core::preferences::PreferenceStore;
use platevault_core::{PreferenceChange, PreferencesView, ThemeId, ThemeScheme};
use tauri::plugin::Plugin;
use tauri::{AppHandle, Manager, Runtime, State};

use super::library::{fail, Reply};

/// The preferences in effect, with what the store read as a default when
/// the app started. Reading never fails.
#[tauri::command]
#[specta::specta]
#[must_use]
#[allow(clippy::needless_pass_by_value)] // Tauri injects the managed state by value
pub fn library_preferences(store: State<'_, Arc<PreferenceStore>>) -> PreferencesView {
    store.view()
}

/// Save one changed preference; the others keep their values.
///
/// # Errors
/// `InvalidInput` for a Match system pair of the wrong schemes;
/// `PersistenceFailure` when the store can't be written.
#[tauri::command]
#[specta::specta]
pub async fn library_change_preference(
    store: State<'_, Arc<PreferenceStore>>,
    change: PreferenceChange,
) -> Reply<PreferencesView> {
    store.change(change).map_err(fail(None))
}

/// Restore defaults: `platevault-dark`, the `platevault-dark` and
/// `platevault-light` pair for Match system, English (UK) and single-key
/// shortcuts on.
///
/// # Errors
/// `PersistenceFailure` when the store can't be written.
#[tauri::command]
#[specta::specta]
pub async fn library_restore_default_preferences(
    store: State<'_, Arc<PreferenceStore>>,
) -> Reply<PreferencesView> {
    store.restore_defaults().map_err(fail(None))
}

/// The plugin whose initialization script carries the stored preferences
/// into each webview the shell creates, read from the managed
/// [`PreferenceStore`] at that moment.
pub struct FirstFrame<R: Runtime> {
    app: Option<AppHandle<R>>,
}

impl<R: Runtime> FirstFrame<R> {
    #[must_use]
    pub const fn new() -> Self {
        Self { app: None }
    }
}

impl<R: Runtime> Default for FirstFrame<R> {
    fn default() -> Self {
        Self::new()
    }
}

impl<R: Runtime> Plugin<R> for FirstFrame<R> {
    fn name(&self) -> &'static str {
        "platevault-first-frame"
    }

    fn initialize(
        &mut self,
        app: &AppHandle<R>,
        _config: serde_json::Value,
    ) -> Result<(), Box<dyn std::error::Error>> {
        self.app = Some(app.clone());
        Ok(())
    }

    fn initialization_script(&self) -> Option<String> {
        let store = self.app.as_ref()?.try_state::<Arc<PreferenceStore>>()?;
        first_frame_script(&store.view())
            .inspect_err(|error| tracing::error!(%error, "preferences not handed to the webview"))
            .ok()
    }
}

/// The function that paints the first frame (`first_frame.js`, which the
/// frontend's `first-frame.test.ts` runs in jsdom).
const PAINT_FIRST_FRAME: &str = include_str!("first_frame.js");

/// Call [`PAINT_FIRST_FRAME`] with `view` and the registry's dark themes: it
/// publishes `view` as `window.__PLATEVAULT_PREFERENCES__` and sets the
/// document root's theme, `dark` class and language as the frontend's
/// `preferences.ts` does. The script runs before the document is parsed, so
/// it waits for the root element when there is none yet.
fn first_frame_script(view: &PreferencesView) -> serde_json::Result<String> {
    let dark: Vec<&str> = ThemeId::ALL
        .iter()
        .filter(|theme| theme.scheme() == ThemeScheme::Dark)
        .map(|theme| theme.as_str())
        .collect();
    let dark = serde_json::to_string(&dark)?;
    let view = serde_json::to_string(view)?;
    Ok(format!("{}({view}, {dark});", PAINT_FIRST_FRAME.trim_end()))
}

#[cfg(test)]
mod tests {
    use platevault_core::{AppearancePreferences, ThemeChoice};

    use super::*;

    #[test]
    fn the_script_carries_the_view_and_the_dark_themes() {
        let view = PreferencesView {
            preferences: AppearancePreferences {
                theme: ThemeChoice::System,
                ..AppearancePreferences::default()
            },
            fallbacks: vec![],
        };
        let script = first_frame_script(&view).unwrap();
        let call = format!(
            r#"({}, ["platevault-dark","gruvbox-dark","nord","dracula","solarized-dark","catppuccin-mocha","tokyo-night","one-dark","rose-pine"]);"#,
            serde_json::to_string(&view).unwrap()
        );
        assert_eq!(script, format!("{}{call}", PAINT_FIRST_FRAME.trim_end()));
        assert!(
            PAINT_FIRST_FRAME.trim_end().ends_with("})"),
            "the file is one function expression"
        );
    }
}
