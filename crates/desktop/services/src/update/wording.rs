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

/// The updater text in the active locale.
pub struct Wording {
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
pub struct Notice {
    pub title: String,
    pub body: String,
}

impl Wording {
    pub fn from_locale(locale: &'static ShippedLocale) -> Self {
        Self { messages: locale.messages().expect("shipped updater catalogue is complete") }
    }
    /// The administrator prompt for installing `version`.
    pub fn admin_prompt(&self, version: &str) -> String {
        locale::fill(&self.messages.admin_prompt, &[("version", version)])
    }

    /// The notification for an install that left the previous app at `kept`:
    /// the line the UI shows for the same failure.
    pub fn previous_app_kept(&self, kept: &Path) -> Notice {
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
    use super::{Notice, Wording};
    use crate::locale::{self, SHIPPED_LOCALES};
    use std::path::Path;

    #[test]
    fn every_shipped_locale_has_the_updaters_wording() {
        for locale in &SHIPPED_LOCALES {
            let wording = Wording::from_locale(locale);
            assert!(wording.admin_prompt("0.7.0").contains("0.7.0"), "{}", locale.tag);
        }
    }

    #[test]
    fn the_admin_prompt_names_plate_vault_and_the_update_in_each_language() {
        assert_eq!(
            Wording::from_locale(locale::shipped_or_base("en-GB")).admin_prompt("0.7.0"),
            "PlateVault needs an administrator's name and password to install update 0.7.0."
        );
        assert_eq!(
            Wording::from_locale(locale::shipped_or_base("pt-BR")).admin_prompt("0.7.0"),
            "O PlateVault precisa do nome e da senha de um administrador para instalar a atualização 0.7.0."
        );
    }

    #[test]
    fn the_kept_app_notice_says_what_the_ui_says_in_each_language() {
        let kept = Path::new("/Applications/PlateVault (previous version).app");
        assert_eq!(
            Wording::from_locale(locale::shipped_or_base("en-GB")).previous_app_kept(kept),
            Notice {
                title: "Update not installed".to_owned(),
                body: "Could not install update: the previous version couldn't be put back. It's saved at /Applications/PlateVault (previous version).app.".to_owned(),
            }
        );
        assert_eq!(
            Wording::from_locale(locale::shipped_or_base("pt-BR")).previous_app_kept(kept),
            Notice {
                title: "Atualização não instalada".to_owned(),
                body: "Não foi possível instalar a atualização: não foi possível restaurar a versão anterior. Ela está salva em /Applications/PlateVault (previous version).app.".to_owned(),
            }
        );
    }
}
