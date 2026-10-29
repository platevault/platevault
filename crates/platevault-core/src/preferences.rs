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
//! [`PreferencesView`] of the session. The stored value stays on disk until
//! any preference is next changed, which saves every preference in effect.

use std::fs;
use std::io::{self, Write as _};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

use serde::de::DeserializeOwned;
use serde::Deserialize as _;
use serde_json::{Map, Value};

use crate::{
    AppearancePreferences, FallbackReason, LibraryError, PreferenceChange, PreferenceFallback,
    PreferenceField, PreferencesView, SystemThemes, ThemeId, ThemeScheme,
};

/// The store's file name inside the directory the shell gives it.
pub const PREFERENCES_FILE: &str = "preferences.json";

/// The appearance preferences in effect and the file that keeps them.
#[derive(Debug)]
pub struct PreferenceStore {
    path: PathBuf,
    /// Held across each write, so changes reach the file in the order they
    /// were made and memory only ever holds what the file holds.
    view: Mutex<PreferencesView>,
}

impl PreferenceStore {
    /// Read the store at `path`.
    #[must_use]
    pub fn open(path: impl Into<PathBuf>) -> Self {
        let path = path.into();
        let view = read(&path);
        for fallback in &view.fallbacks {
            tracing::warn!(
                path = %path.display(),
                field = ?fallback.field,
                stored = ?fallback.stored,
                reason = ?fallback.reason,
                "stored preference read as its default"
            );
        }
        Self { path, view: Mutex::new(view) }
    }

    /// The preferences in effect.
    #[must_use]
    pub fn view(&self) -> PreferencesView {
        self.lock().clone()
    }

    /// Save one changed preference and return the preferences in effect.
    ///
    /// # Errors
    /// `InvalidInput` for a Match system pair whose dark theme is light or
    /// whose light theme is dark; `PersistenceFailure` when the file can't
    /// be written, which leaves the preferences as they were.
    pub fn change(&self, change: PreferenceChange) -> Result<PreferencesView, LibraryError> {
        let mut view = self.lock();
        let mut next = view.preferences;
        match change {
            PreferenceChange::Theme { choice } => next.theme = choice,
            PreferenceChange::SystemThemes { themes } => {
                require_schemes(themes)?;
                next.system_themes = themes;
            }
            PreferenceChange::Language { language } => next.language = language,
            PreferenceChange::SingleKeyShortcuts { enabled } => next.single_key_shortcuts = enabled,
        }
        self.write(next)?;
        view.preferences = next;
        Ok(view.clone())
    }

    /// Restore defaults: `platevault-dark`, the `platevault-dark` and
    /// `platevault-light` pair for Match system, English (UK) and single-key
    /// shortcuts on.
    ///
    /// # Errors
    /// `PersistenceFailure` when the file can't be written, which leaves the
    /// preferences as they were.
    pub fn restore_defaults(&self) -> Result<PreferencesView, LibraryError> {
        let mut view = self.lock();
        let defaults = AppearancePreferences::default();
        self.write(defaults)?;
        view.preferences = defaults;
        Ok(view.clone())
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, PreferencesView> {
        // A panic mid-change leaves the last value both memory and file agree on.
        self.view.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Replace the file in one rename, so a crash leaves the old or the new one.
    fn write(&self, preferences: AppearancePreferences) -> Result<(), LibraryError> {
        let failed = |error: io::Error| {
            LibraryError::PersistenceFailure(format!(
                "cannot save preferences {}: {error}",
                self.path.display()
            ))
        };
        let dir = self.path.parent().filter(|dir| !dir.as_os_str().is_empty());
        let dir = dir.unwrap_or_else(|| Path::new("."));
        fs::create_dir_all(dir).map_err(failed)?;
        let mut file = tempfile::NamedTempFile::new_in(dir).map_err(failed)?;
        let text =
            serde_json::to_vec_pretty(&preferences).map_err(io::Error::from).map_err(failed)?;
        file.write_all(&text).map_err(failed)?;
        file.as_file().sync_all().map_err(failed)?;
        file.persist(&self.path).map_err(|error| failed(error.error))?;
        Ok(())
    }
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

fn read(path: &Path) -> PreferencesView {
    let unreadable = || PreferencesView {
        preferences: AppearancePreferences::default(),
        fallbacks: vec![PreferenceFallback {
            field: None,
            stored: None,
            reason: FallbackReason::Unreadable,
        }],
    };
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return PreferencesView::default(),
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
    PreferencesView { preferences, fallbacks }
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
