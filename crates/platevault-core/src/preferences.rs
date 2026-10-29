// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The app's per-user settings store for the appearance preferences
//! (spec 064 LIB-FR-21, LIB-AC-45; D-W166): one JSON file outside every
//! library, which the shell keeps in the platform's per-user config
//! directory. A change writes only this file; it never touches the catalog,
//! Activity, a library or any other user file.
//!
//! Reading never fails. A missing file, or a missing preference, reads as
//! the default. A value the app doesn't know reads as its default with a
//! recorded [`PreferenceFallback`], which is logged and listed in every
//! [`PreferencesView`] of the session.
//!
//! A save rewrites only the preferences it changes. Every other key of the
//! file stays as it was: a value this build read as a default, and the keys
//! a newer build added. The file carries its format [`VERSION`]; a build
//! reads the preferences it knows from a file of any version, and a save
//! never lowers the version a newer build wrote.

use std::fs;
use std::io::{self, Write as _};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};

use serde::de::DeserializeOwned;
use serde::Deserialize as _;
use serde_json::{Map, Value};

use crate::{
    AppearancePreferences, FallbackReason, LibraryError, PreferenceChange, PreferenceFallback,
    PreferenceField, PreferencesView, SystemThemes, ThemeId, ThemeScheme,
};

/// The store's file name inside the directory the shell gives it.
pub const PREFERENCES_FILE: &str = "preferences.json";

/// The file format this build writes, under [`VERSION_KEY`].
pub const VERSION: u64 = 1;

/// The file's key for its format version.
pub const VERSION_KEY: &str = "version";

/// The appearance preferences in effect and the file that keeps them.
#[derive(Debug)]
pub struct PreferenceStore {
    path: PathBuf,
    /// Held across each write, so changes reach the file in the order they
    /// were made and memory only ever holds what the file holds.
    state: Mutex<State>,
}

#[derive(Debug)]
struct State {
    view: PreferencesView,
    /// The file's object as last read or written.
    file: Map<String, Value>,
}

impl PreferenceStore {
    /// Read the store at `path`.
    #[must_use]
    pub fn open(path: impl Into<PathBuf>) -> Self {
        let path = path.into();
        let (view, file) = read(&path);
        for fallback in &view.fallbacks {
            tracing::warn!(
                path = %path.display(),
                field = ?fallback.field,
                stored = ?fallback.stored,
                reason = ?fallback.reason,
                "stored preference read as its default"
            );
        }
        Self { path, state: Mutex::new(State { view, file }) }
    }

    /// The preferences in effect.
    #[must_use]
    pub fn view(&self) -> PreferencesView {
        self.lock().view.clone()
    }

    /// Save one changed preference and return the preferences in effect.
    ///
    /// # Errors
    /// `InvalidInput` for a Match system pair whose dark theme is light or
    /// whose light theme is dark; `PersistenceFailure` when the file can't
    /// be written, which leaves the preferences as they were.
    pub fn change(&self, change: PreferenceChange) -> Result<PreferencesView, LibraryError> {
        let mut next = self.lock().view.preferences;
        let field = match change {
            PreferenceChange::Theme { choice } => {
                next.theme = choice;
                PreferenceField::Theme
            }
            PreferenceChange::SystemThemes { themes } => {
                require_schemes(themes)?;
                next.system_themes = themes;
                PreferenceField::SystemThemes
            }
            PreferenceChange::Language { language } => {
                next.language = language;
                PreferenceField::Language
            }
            PreferenceChange::SingleKeyShortcuts { enabled } => {
                next.single_key_shortcuts = enabled;
                PreferenceField::SingleKeyShortcuts
            }
        };
        self.save(next, &[field])
    }

    /// Restore defaults: `platevault-dark`, the `platevault-dark` and
    /// `platevault-light` pair for Match system, English (UK) and single-key
    /// shortcuts on.
    ///
    /// # Errors
    /// `PersistenceFailure` when the file can't be written, which leaves the
    /// preferences as they were.
    pub fn restore_defaults(&self) -> Result<PreferencesView, LibraryError> {
        self.save(AppearancePreferences::default(), &FIELDS)
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        // A panic mid-change leaves the last value both memory and file agree on.
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Write `fields` of `preferences` into the file, keeping its other keys,
    /// and make `preferences` the ones in effect.
    fn save(
        &self,
        preferences: AppearancePreferences,
        fields: &[PreferenceField],
    ) -> Result<PreferencesView, LibraryError> {
        let mut state = self.lock();
        let mut file = state.file.clone();
        for &field in fields {
            file.insert(field.key().to_owned(), stored_value(preferences, field));
        }
        let version = file.get(VERSION_KEY).and_then(Value::as_u64).unwrap_or(0).max(VERSION);
        file.insert(VERSION_KEY.to_owned(), version.into());
        self.write(&file)?;
        state.file = file;
        state.view.preferences = preferences;
        Ok(state.view.clone())
    }

    /// Replace the file in one rename, so a crash leaves the old or the new
    /// one, then make the rename durable on Unix by syncing the directory.
    fn write(&self, file: &Map<String, Value>) -> Result<(), LibraryError> {
        let failed = |error: io::Error| {
            LibraryError::PersistenceFailure(format!(
                "cannot save preferences {}: {error}",
                self.path.display()
            ))
        };
        let dir = self.path.parent().filter(|dir| !dir.as_os_str().is_empty());
        let dir = dir.unwrap_or_else(|| Path::new("."));
        fs::create_dir_all(dir).map_err(failed)?;
        let mut temp = tempfile::NamedTempFile::new_in(dir).map_err(failed)?;
        let text = serde_json::to_vec_pretty(file).map_err(io::Error::from).map_err(failed)?;
        temp.write_all(&text).map_err(failed)?;
        temp.as_file().sync_all().map_err(failed)?;
        temp.persist(&self.path).map_err(|error| failed(error.error))?;
        // The new file is already the one every read sees, so a failed sync
        // is no failed save: it only leaves the rename's durability to the OS.
        #[cfg(unix)]
        if let Err(error) = fs::File::open(dir).and_then(|dir| dir.sync_all()) {
            tracing::warn!(dir = %dir.display(), %error, "preferences directory not synced");
        }
        Ok(())
    }
}

/// Every preference, in the file's order.
const FIELDS: [PreferenceField; 4] = [
    PreferenceField::Theme,
    PreferenceField::SystemThemes,
    PreferenceField::Language,
    PreferenceField::SingleKeyShortcuts,
];

/// `field` of `preferences` as the file stores it.
fn stored_value(preferences: AppearancePreferences, field: PreferenceField) -> Value {
    let value = match field {
        PreferenceField::Theme => serde_json::to_value(preferences.theme),
        PreferenceField::SystemThemes => serde_json::to_value(preferences.system_themes),
        PreferenceField::Language => serde_json::to_value(preferences.language),
        PreferenceField::SingleKeyShortcuts => Ok(preferences.single_key_shortcuts.into()),
    };
    value.expect("appearance preferences serialize to JSON")
}

fn require_schemes(themes: SystemThemes) -> Result<(), LibraryError> {
    for scheme in [ThemeScheme::Dark, ThemeScheme::Light] {
        let theme = themes.get(scheme);
        if theme.scheme() != scheme {
            return Err(LibraryError::InvalidInput(format!(
                "Match system's {scheme:?} theme can't be {}, a {:?} theme",
                theme.as_str(),
                theme.scheme()
            )));
        }
    }
    Ok(())
}

/// The preferences in `path` and the file's object; an unreadable file is
/// an empty object, which the next save replaces.
fn read(path: &Path) -> (PreferencesView, Map<String, Value>) {
    let unreadable = || {
        let view = PreferencesView {
            preferences: AppearancePreferences::default(),
            fallbacks: vec![PreferenceFallback {
                field: None,
                stored: None,
                reason: FallbackReason::Unreadable,
            }],
        };
        (view, Map::new())
    };
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return (PreferencesView::default(), Map::new())
        }
        Err(error) => {
            tracing::warn!(path = %path.display(), %error, "preferences file unreadable");
            return unreadable();
        }
    };
    let Ok(Value::Object(stored)) = serde_json::from_str::<Value>(&text) else {
        return unreadable();
    };
    let mut fallbacks = Vec::new();
    let mut preferences = AppearancePreferences::default();
    if let Some(theme) = known(&stored, PreferenceField::Theme, &mut fallbacks) {
        preferences.theme = theme;
    }
    match stored.get(PreferenceField::SystemThemes.key()) {
        None => {}
        Some(Value::Object(pair)) => {
            preferences.system_themes = SystemThemes {
                dark: slot(pair, ThemeScheme::Dark, &mut fallbacks),
                light: slot(pair, ThemeScheme::Light, &mut fallbacks),
            };
        }
        Some(other) => {
            fallbacks.push(fallback(PreferenceField::SystemThemes, other, FallbackReason::Unknown));
        }
    }
    if let Some(language) = known(&stored, PreferenceField::Language, &mut fallbacks) {
        preferences.language = language;
    }
    if let Some(enabled) = known(&stored, PreferenceField::SingleKeyShortcuts, &mut fallbacks) {
        preferences.single_key_shortcuts = enabled;
    }
    (PreferencesView { preferences, fallbacks }, stored)
}

/// The stored `field`, when present and known.
fn known<T: DeserializeOwned>(
    stored: &Map<String, Value>,
    field: PreferenceField,
    fallbacks: &mut Vec<PreferenceFallback>,
) -> Option<T> {
    let value = stored.get(field.key())?;
    T::deserialize(value)
        .inspect_err(|_| fallbacks.push(fallback(field, value, FallbackReason::Unknown)))
        .ok()
}

/// The stored Match system theme for `scheme`, or the default one.
fn slot(
    pair: &Map<String, Value>,
    scheme: ThemeScheme,
    fallbacks: &mut Vec<PreferenceFallback>,
) -> ThemeId {
    let default = SystemThemes::default().get(scheme);
    let key = match scheme {
        ThemeScheme::Dark => "dark",
        ThemeScheme::Light => "light",
    };
    let Some(value) = pair.get(key) else { return default };
    let reason = match ThemeId::deserialize(value) {
        Ok(theme) if theme.scheme() == scheme => return theme,
        Ok(_) => FallbackReason::WrongScheme,
        Err(_) => FallbackReason::Unknown,
    };
    fallbacks.push(fallback(PreferenceField::SystemThemes, value, reason));
    default
}

fn fallback(field: PreferenceField, stored: &Value, reason: FallbackReason) -> PreferenceFallback {
    PreferenceFallback { field: Some(field), stored: Some(stored.to_string()), reason }
}
