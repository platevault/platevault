// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The per-user appearance preference store (spec 064 LIB-FR-21, LIB-AC-45;
//! D-W166) over a real file: each change survives a restart, Restore
//! defaults resets every preference, an unknown stored value reads as its
//! default with a recorded reason, and the store writes nothing but its own
//! file.

use std::fs;
use std::path::Path;

use platevault_core::preferences::{PreferenceStore, PREFERENCES_FILE, VERSION, VERSION_KEY};
use platevault_core::*;
use serde_json::json;

fn entries(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

/// LIB-AC-45: a first start reads the defaults and writes nothing; each
/// change applies at once, writes only the store's file and is in effect
/// after a restart.
#[test]
fn changes_survive_a_restart_and_touch_only_the_store() {
    let temp = tempfile::tempdir().unwrap();
    let dir = temp.path().join("config");
    let path = dir.join(PREFERENCES_FILE);
    let store = PreferenceStore::open(&path);
    assert_eq!(store.view(), PreferencesView::default());
    assert!(!dir.exists(), "reading writes nothing");

    let themes = SystemThemes { dark: ThemeId::Nord, light: ThemeId::GruvboxLight };
    for change in [
        PreferenceChange::Theme { choice: ThemeChoice::System },
        PreferenceChange::SystemThemes { themes },
        PreferenceChange::Language { language: Language::PtBr },
        PreferenceChange::SingleKeyShortcuts { enabled: false },
    ] {
        store.change(change).unwrap();
    }
    let expected = AppearancePreferences {
        theme: ThemeChoice::System,
        system_themes: themes,
        language: Language::PtBr,
        single_key_shortcuts: false,
    };
    assert_eq!(store.view().preferences, expected);
    assert_eq!(entries(&dir), [PREFERENCES_FILE], "only the store's file, no leftovers");
    drop(store);

    let reopened = PreferenceStore::open(&path);
    assert_eq!(reopened.view(), PreferencesView { preferences: expected, fallbacks: vec![] });
    let fixed = PreferenceChange::Theme { choice: ThemeChoice::Fixed { theme: ThemeId::RosePine } };
    let view = reopened.change(fixed).unwrap();
    assert_eq!(view.preferences.theme, ThemeChoice::Fixed { theme: ThemeId::RosePine });
    assert_eq!(view.preferences.system_themes, themes, "the pair is kept for Match system");
}

/// LIB-FR-21: Restore defaults returns `platevault-dark`, the default pair,
/// English (UK) and shortcuts on, and that too survives a restart.
#[test]
fn restore_defaults_resets_every_preference() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join(PREFERENCES_FILE);
    let store = PreferenceStore::open(&path);
    store.change(PreferenceChange::Theme { choice: ThemeChoice::System }).unwrap();
    let themes = SystemThemes { dark: ThemeId::Dracula, light: ThemeId::SolarizedLight };
    store.change(PreferenceChange::SystemThemes { themes }).unwrap();
    store.change(PreferenceChange::Language { language: Language::PtBr }).unwrap();
    store.change(PreferenceChange::SingleKeyShortcuts { enabled: false }).unwrap();

    let view = store.restore_defaults().unwrap();
    assert_eq!(view.preferences, AppearancePreferences::default());
    assert_eq!(
        view.preferences,
        AppearancePreferences {
            theme: ThemeChoice::Fixed { theme: ThemeId::PlatevaultDark },
            system_themes: SystemThemes {
                dark: ThemeId::PlatevaultDark,
                light: ThemeId::PlatevaultLight
            },
            language: Language::EnGb,
            single_key_shortcuts: true,
        }
    );
    drop(store);
    assert_eq!(PreferenceStore::open(&path).view().preferences, AppearancePreferences::default());
}

/// An unknown stored value reads as its default with the reason recorded;
/// the others keep their stored values, and the file is left as it was
/// until a preference is next changed.
#[test]
fn unknown_stored_values_fall_back_with_a_reason() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join(PREFERENCES_FILE);
    let stored = json!({
        "theme": { "mode": "fixed", "theme": "neon" },
        "systemThemes": { "dark": "catppuccin-latte", "light": "tokyo-night-day" },
        "language": "fr-FR",
        "singleKeyShortcuts": false,
    })
    .to_string();
    fs::write(&path, &stored).unwrap();

    let store = PreferenceStore::open(&path);
    let view = store.view();
    assert_eq!(
        view.preferences,
        AppearancePreferences { single_key_shortcuts: false, ..AppearancePreferences::default() },
        "a known value is kept"
    );
    let reasons: Vec<_> = view
        .fallbacks
        .iter()
        .map(|fallback| (fallback.field, fallback.stored.as_deref(), fallback.reason))
        .collect();
    assert_eq!(
        reasons,
        [
            (
                Some(PreferenceField::Theme),
                Some(r#"{"mode":"fixed","theme":"neon"}"#),
                FallbackReason::Unknown
            ),
            (
                Some(PreferenceField::SystemThemes),
                Some(r#""catppuccin-latte""#),
                FallbackReason::WrongScheme
            ),
            (
                Some(PreferenceField::SystemThemes),
                Some(r#""tokyo-night-day""#),
                FallbackReason::Unknown
            ),
            (Some(PreferenceField::Language), Some(r#""fr-FR""#), FallbackReason::Unknown),
        ]
    );
    assert_eq!(fs::read_to_string(&path).unwrap(), stored, "reading repairs nothing");

    // Saving the language rewrites only the language: the values read as
    // defaults stay in the file, so a later start falls back again.
    store.change(PreferenceChange::Language { language: Language::PtBr }).unwrap();
    assert_eq!(store.view().fallbacks, view.fallbacks, "the start's record stays listed");
    drop(store);
    let reopened = PreferenceStore::open(&path).view();
    let fields: Vec<_> = reopened.fallbacks.iter().map(|fallback| fallback.field).collect();
    assert_eq!(
        fields,
        [
            Some(PreferenceField::Theme),
            Some(PreferenceField::SystemThemes),
            Some(PreferenceField::SystemThemes)
        ]
    );
    assert_eq!(
        reopened.preferences,
        AppearancePreferences {
            language: Language::PtBr,
            single_key_shortcuts: false,
            ..AppearancePreferences::default()
        }
    );

    // Changing the fallen-back preference replaces its stored value.
    let store = PreferenceStore::open(&path);
    store.change(PreferenceChange::Theme { choice: ThemeChoice::System }).unwrap();
    store.change(PreferenceChange::SystemThemes { themes: SystemThemes::default() }).unwrap();
    drop(store);
    let view = PreferenceStore::open(&path).view();
    assert!(view.fallbacks.is_empty(), "{view:?}");
}

/// A save writes the format version, and a fresh file starts at this
/// build's [`VERSION`].
#[test]
fn a_save_writes_the_format_version() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join(PREFERENCES_FILE);
    let store = PreferenceStore::open(&path);
    store.change(PreferenceChange::Language { language: Language::PtBr }).unwrap();
    let file: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(file, json!({ VERSION_KEY: VERSION, "language": "pt-BR" }));

    store.restore_defaults().unwrap();
    let file: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(
        file,
        json!({
            VERSION_KEY: VERSION,
            "theme": { "mode": "fixed", "theme": "platevault-dark" },
            "systemThemes": { "dark": "platevault-dark", "light": "platevault-light" },
            "language": "en-GB",
            "singleKeyShortcuts": true,
        })
    );
}

/// A newer build's file keeps its version and its keys when this build
/// saves, Restore defaults included, and this build reads what it knows.
#[test]
fn a_newer_builds_keys_and_version_survive_a_save() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join(PREFERENCES_FILE);
    let newer = json!({
        VERSION_KEY: VERSION + 1,
        "theme": { "mode": "fixed", "theme": "aurora" },
        "language": "pt-BR",
        "density": "compact",
        "sidebar": { "collapsed": true },
    });
    fs::write(&path, newer.to_string()).unwrap();

    let store = PreferenceStore::open(&path);
    assert_eq!(store.view().preferences.language, Language::PtBr, "a known value of any version");
    store.change(PreferenceChange::SingleKeyShortcuts { enabled: false }).unwrap();
    let file: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    let mut expected = newer;
    expected["singleKeyShortcuts"] = json!(false);
    assert_eq!(file, expected, "only the changed preference is rewritten");

    store.restore_defaults().unwrap();
    let file: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(file[VERSION_KEY], VERSION + 1, "a save never lowers the version");
    assert_eq!(file["density"], "compact");
    assert_eq!(file["sidebar"], json!({ "collapsed": true }));
    assert_eq!(file["theme"], json!({ "mode": "fixed", "theme": "platevault-dark" }));
}

/// A file that isn't a JSON object reads as the defaults, recorded as
/// unreadable; a missing preference is no fallback.
#[test]
fn an_unreadable_file_reads_as_the_defaults() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join(PREFERENCES_FILE);
    fs::write(&path, "theme = nord").unwrap();
    assert_eq!(
        PreferenceStore::open(&path).view(),
        PreferencesView {
            preferences: AppearancePreferences::default(),
            fallbacks: vec![PreferenceFallback {
                field: None,
                stored: None,
                reason: FallbackReason::Unreadable
            }],
        }
    );

    fs::write(&path, r#"{"language":"pt-BR"}"#).unwrap();
    let view = PreferenceStore::open(&path).view();
    assert!(view.fallbacks.is_empty(), "{view:?}");
    assert_eq!(view.preferences.language, Language::PtBr);
}

/// A Match system pair needs a dark theme for dark and a light one for
/// light; a refused pair changes nothing.
#[test]
fn a_pair_of_the_wrong_schemes_is_refused() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join(PREFERENCES_FILE);
    let store = PreferenceStore::open(&path);
    let swapped = SystemThemes { dark: ThemeId::CatppuccinLatte, light: ThemeId::Nord };
    let refused = store.change(PreferenceChange::SystemThemes { themes: swapped }).unwrap_err();
    assert!(matches!(refused, LibraryError::InvalidInput(_)), "{refused:?}");
    assert_eq!(store.view(), PreferencesView::default());
    assert!(!path.exists(), "nothing was written");
}

/// The store's themes and languages are the frontend's: the theme registry
/// with each theme's scheme, and the message catalogues' locales.
#[test]
fn themes_and_languages_match_the_frontend() {
    let ui = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/desktop-ui");
    let registry = fs::read_to_string(ui.join("src/app/themes.ts")).unwrap();
    let quoted = |line: &str, key: &str| -> String {
        let start = line.find(&format!("{key}: \"")).unwrap() + key.len() + 3;
        line[start..].split('"').next().unwrap().to_owned()
    };
    let frontend: Vec<(String, String)> = registry
        .lines()
        .map(str::trim)
        .filter(|line| line.starts_with("{ id: \""))
        .map(|line| (quoted(line, "id"), quoted(line, "scheme")))
        .collect();
    let store: Vec<(String, String)> = ThemeId::ALL
        .iter()
        .map(|theme| {
            let scheme = match theme.scheme() {
                ThemeScheme::Dark => "dark",
                ThemeScheme::Light => "light",
            };
            (theme.as_str().to_owned(), scheme.to_owned())
        })
        .collect();
    assert_eq!(store, frontend);

    let inlang = fs::read_to_string(ui.join("project.inlang/settings.json")).unwrap();
    let inlang: serde_json::Value = serde_json::from_str(&inlang).unwrap();
    let languages: Vec<&str> = Language::ALL.iter().map(|language| language.as_str()).collect();
    assert_eq!(inlang["locales"], json!(languages));
    assert_eq!(inlang["baseLocale"], Language::default().as_str());
}
