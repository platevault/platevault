// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! What the updater says outside the webview, in the active locale: the
//! macOS administrator prompt (astro-plan-dwwup) and the notification an
//! install at quit raises when the previous app could not be put back
//! (astro-plan-gffqm). The text comes from the frontend's message catalogue;
//! the notification reuses the very lines the UI shows for that failure.

use std::path::Path;

use serde::Deserialize;

use crate::locale::{self, ShippedLocale};

/// The updater's text in one locale.
pub(crate) struct Wording {
    locale: &'static ShippedLocale,
    messages: Messages,
}

/// The catalogue messages [`Wording`] reads.
#[derive(Deserialize)]
struct Messages {
    /// The macOS authorization dialog's text, with `{version}`.
    #[serde(rename = "update_admin_prompt")]
    admin_prompt: String,
    /// The title of the notification for a failed install at quit.
    #[serde(rename = "update_notification_install_failed_title")]
    install_failed_title: String,
    /// The UI's line for a failed install, with `{message}`, and the reason
    /// it shows when the previous app was kept, with `{path}`.
    #[serde(rename = "settings_advanced_updates_installfailed")]
    install_failed: String,
    #[serde(rename = "update_error_previous_app_not_restored")]
    previous_app_not_restored: String,
}

/// An OS notification's text.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct Notice {
    pub title: String,
    pub body: String,
}

impl Wording {
    /// The wording in the shipped locale `tag` names, else in the base
    /// locale.
    ///
    /// # Errors
    ///
    /// The locale's catalogue lacks one of the updater's messages.
    pub(crate) fn in_locale(tag: &str) -> Result<Self, String> {
        let locale = locale::shipped_or_base(tag);
        Ok(Self { locale, messages: locale.messages()? })
    }

    /// The locale this wording is in.
    pub(crate) const fn locale(&self) -> &'static ShippedLocale {
        self.locale
    }

    /// The administrator prompt for installing `version`.
    pub(crate) fn admin_prompt(&self, version: &str) -> String {
        locale::fill(&self.messages.admin_prompt, &[("version", version)])
    }

    /// The notification for an install that left the previous app at `kept`:
    /// the line the UI shows for the same failure.
    pub(crate) fn previous_app_kept(&self, kept: &Path) -> Notice {
        let reason = locale::fill(
            &self.messages.previous_app_not_restored,
            &[("path", &kept.display().to_string())],
        );
        Notice {
            title: self.messages.install_failed_title.clone(),
            body: locale::fill(&self.messages.install_failed, &[("message", &reason)]),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{Notice, Wording};
    use crate::locale::SHIPPED_LOCALES;

    #[test]
    fn every_shipped_locale_has_the_updaters_wording() {
        for locale in &SHIPPED_LOCALES {
            let wording = Wording::in_locale(locale.tag).unwrap_or_else(|error| panic!("{error}"));
            assert_eq!(wording.locale().tag, locale.tag);
            let prompt = wording.admin_prompt("0.7.0");
            assert!(prompt.contains("PlateVault") && prompt.contains("0.7.0"), "{prompt}");
            assert!(!prompt.contains('{'), "every placeholder is filled: {prompt}");
        }
    }

    #[test]
    fn the_admin_prompt_names_plate_vault_and_the_update_in_each_language() {
        assert_eq!(
            Wording::in_locale("en-GB").expect("en-GB").admin_prompt("0.7.0"),
            "PlateVault needs an administrator's name and password to install update 0.7.0."
        );
        assert_eq!(
            Wording::in_locale("pt-BR").expect("pt-BR").admin_prompt("0.7.0"),
            "O PlateVault precisa do nome e da senha de um administrador para instalar a atualização 0.7.0."
        );
    }

    #[test]
    fn the_kept_app_notice_says_what_the_ui_says_in_each_language() {
        let kept = Path::new("/Applications/PlateVault (previous version).app");
        assert_eq!(
            Wording::in_locale("en-GB").expect("en-GB").previous_app_kept(kept),
            Notice {
                title: "Update not installed".to_owned(),
                body: "Could not install update: the previous version couldn't be put back. It's saved at /Applications/PlateVault (previous version).app.".to_owned(),
            }
        );
        assert_eq!(
            Wording::in_locale("pt-BR").expect("pt-BR").previous_app_kept(kept),
            Notice {
                title: "Atualização não instalada".to_owned(),
                body: "Não foi possível instalar a atualização: não foi possível restaurar a versão anterior. Ela está salva em /Applications/PlateVault (previous version).app.".to_owned(),
            }
        );
    }

    #[test]
    fn an_unknown_locale_falls_back_to_the_base_wording() {
        assert_eq!(Wording::in_locale("de-DE").expect("base").locale().tag, "en-GB");
    }
}
