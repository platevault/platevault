// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Appearance preferences (spec 064 LIB-FR-21, LIB-AC-45; D-W143, D-W166):
//! the theme or the Match system pair, the language, and whether single-key
//! shortcuts are on. The app keeps them in its own per-user settings
//! store, outside every library: no catalog record, no Activity entry and no
//! library or user file. Restore defaults returns `platevault-dark`, English
//! (UK) and shortcuts on.
//!
//! The theme set mirrors the frontend registry (`apps/desktop-ui/src/app/themes.ts`)
//! and the languages its message catalogues (`project.inlang/settings.json`);
//! the store's tests compare both.

use serde::{Deserialize, Serialize};

/// Whether a theme is dark or light.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum ThemeScheme {
    Dark,
    Light,
}

/// A theme of the registry.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum ThemeId {
    PlatevaultDark,
    PlatevaultLight,
    GruvboxDark,
    GruvboxLight,
    Nord,
    Dracula,
    SolarizedDark,
    SolarizedLight,
    CatppuccinMocha,
    CatppuccinLatte,
    TokyoNight,
    OneDark,
    RosePine,
}

impl ThemeId {
    /// Every theme, in registry order.
    pub const ALL: [Self; 13] = [
        Self::PlatevaultDark,
        Self::PlatevaultLight,
        Self::GruvboxDark,
        Self::GruvboxLight,
        Self::Nord,
        Self::Dracula,
        Self::SolarizedDark,
        Self::SolarizedLight,
        Self::CatppuccinMocha,
        Self::CatppuccinLatte,
        Self::TokyoNight,
        Self::OneDark,
        Self::RosePine,
    ];

    /// The wire name, as serialized.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::PlatevaultDark => "platevault-dark",
            Self::PlatevaultLight => "platevault-light",
            Self::GruvboxDark => "gruvbox-dark",
            Self::GruvboxLight => "gruvbox-light",
            Self::Nord => "nord",
            Self::Dracula => "dracula",
            Self::SolarizedDark => "solarized-dark",
            Self::SolarizedLight => "solarized-light",
            Self::CatppuccinMocha => "catppuccin-mocha",
            Self::CatppuccinLatte => "catppuccin-latte",
            Self::TokyoNight => "tokyo-night",
            Self::OneDark => "one-dark",
            Self::RosePine => "rose-pine",
        }
    }

    #[must_use]
    pub const fn scheme(self) -> ThemeScheme {
        match self {
            Self::PlatevaultLight
            | Self::GruvboxLight
            | Self::SolarizedLight
            | Self::CatppuccinLatte => ThemeScheme::Light,
            Self::PlatevaultDark
            | Self::GruvboxDark
            | Self::Nord
            | Self::Dracula
            | Self::SolarizedDark
            | Self::CatppuccinMocha
            | Self::TokyoNight
            | Self::OneDark
            | Self::RosePine => ThemeScheme::Dark,
        }
    }
}

/// One fixed theme (the Dark or Light mode), or Match system, which follows
/// the OS between the two themes of [`SystemThemes`].
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum ThemeChoice {
    Fixed { theme: ThemeId },
    System,
}

/// The dark theme and the light theme Match system follows. The store
/// refuses a pair whose `dark` theme is light or whose `light` theme is dark.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct SystemThemes {
    pub dark: ThemeId,
    pub light: ThemeId,
}

impl SystemThemes {
    /// The pair's theme for `scheme`.
    #[must_use]
    pub const fn get(self, scheme: ThemeScheme) -> ThemeId {
        match scheme {
            ThemeScheme::Dark => self.dark,
            ThemeScheme::Light => self.light,
        }
    }
}

impl Default for SystemThemes {
    fn default() -> Self {
        Self { dark: ThemeId::PlatevaultDark, light: ThemeId::PlatevaultLight }
    }
}

/// A language the app's message catalogues cover.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum Language {
    /// English (UK).
    #[default]
    #[serde(rename = "en-GB")]
    EnGb,
    /// Portuguese (Brazil).
    #[serde(rename = "pt-BR")]
    PtBr,
}

impl Language {
    pub const ALL: [Self; 2] = [Self::EnGb, Self::PtBr];

    /// The BCP 47 tag, as serialized.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::EnGb => "en-GB",
            Self::PtBr => "pt-BR",
        }
    }
}

/// The appearance preferences. [`Default`] is what Restore defaults sets.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct AppearancePreferences {
    pub theme: ThemeChoice,
    pub system_themes: SystemThemes,
    pub language: Language,
    /// `?`, `/`, `[`, G-sequences and Space on a table row (WCAG 2.1.4).
    /// Shortcuts with a modifier, such as ⌘K, stay on.
    pub single_key_shortcuts: bool,
}

impl Default for AppearancePreferences {
    fn default() -> Self {
        Self {
            theme: ThemeChoice::Fixed { theme: ThemeId::PlatevaultDark },
            system_themes: SystemThemes::default(),
            language: Language::EnGb,
            single_key_shortcuts: true,
        }
    }
}

/// One preference the user changed; the others keep their values.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "field", rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum PreferenceChange {
    Theme { choice: ThemeChoice },
    SystemThemes { themes: SystemThemes },
    Language { language: Language },
    SingleKeyShortcuts { enabled: bool },
}

/// A preference of [`AppearancePreferences`], as the store's file names it.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum PreferenceField {
    Theme,
    SystemThemes,
    Language,
    SingleKeyShortcuts,
}

impl PreferenceField {
    /// The key in the store's file.
    #[must_use]
    pub const fn key(self) -> &'static str {
        match self {
            Self::Theme => "theme",
            Self::SystemThemes => "systemThemes",
            Self::Language => "language",
            Self::SingleKeyShortcuts => "singleKeyShortcuts",
        }
    }
}

/// Why a stored preference reads as its default.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum FallbackReason {
    /// The store's file can't be read or holds no JSON object, so every
    /// preference reads as its default.
    Unreadable,
    /// The value is not one the app knows: an unknown theme or language,
    /// or a value of the wrong type.
    Unknown,
    /// A Match system slot holds a theme of the other scheme.
    WrongScheme,
}

/// A stored value the store read as its default, and why.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct PreferenceFallback {
    /// The preference that fell back; `None` when the whole file did.
    pub field: Option<PreferenceField>,
    /// The stored value as JSON text; `None` when the file was unreadable.
    pub stored: Option<String>,
    pub reason: FallbackReason,
}

/// The preferences in effect, with what the store read as a default when
/// the app started. A fallback stays listed for the session. The stored
/// value stays on disk until any preference is next changed, which saves
/// every preference as it is in effect.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct PreferencesView {
    pub preferences: AppearancePreferences,
    pub fallbacks: Vec<PreferenceFallback>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wire_names_match_serde() {
        for theme in ThemeId::ALL {
            assert_eq!(serde_json::to_value(theme).unwrap(), theme.as_str());
        }
        for language in Language::ALL {
            assert_eq!(serde_json::to_value(language).unwrap(), language.as_str());
        }
    }

    #[test]
    fn defaults_are_platevault_dark_english_and_shortcuts_on() {
        let defaults = AppearancePreferences::default();
        assert_eq!(
            serde_json::to_value(defaults).unwrap(),
            serde_json::json!({
                "theme": { "mode": "fixed", "theme": "platevault-dark" },
                "systemThemes": { "dark": "platevault-dark", "light": "platevault-light" },
                "language": "en-GB",
                "singleKeyShortcuts": true,
            })
        );
        let change = PreferenceChange::Theme { choice: ThemeChoice::System };
        assert_eq!(
            serde_json::to_value(change).unwrap(),
            serde_json::json!({ "field": "theme", "choice": { "mode": "system" } })
        );
    }
}
