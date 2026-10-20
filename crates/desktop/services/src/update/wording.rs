// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Updater-owned catalogue text, independent from OS completion notifications.

use std::path::{Path, PathBuf};

use serde::Deserialize;

use super::install::InstallWording;
use crate::locale::{self, ActiveLocale, ShippedMessages};
use crate::notifications::Notice;

#[derive(Debug, Deserialize)]
pub struct Wording {
    #[serde(rename = "update_admin_prompt")]
    admin_prompt: String,
    #[serde(rename = "update_notification_install_failed_title")]
    install_failed_title: String,
    #[serde(rename = "settings_advanced_updates_installfailed")]
    install_failed: String,
    #[serde(rename = "update_error_previous_app_not_restored")]
    previous_app_not_restored: String,
    #[serde(rename = "update_error_app_replaced")]
    app_replaced: String,
    #[serde(rename = "update_error_app_replaced_kept")]
    app_replaced_kept: String,
    #[serde(rename = "update_notification_installed_title")]
    installed_title: String,
    #[serde(rename = "update_notification_installed_kept_body")]
    installed_kept: String,
    /// Provisional copy: what a bundle the install keeps aside is called
    /// after the app's name (astro-plan-rx07l).
    #[serde(rename = "update_kept_aside_name")]
    set_aside: String,
}

static WORDING_BY_LOCALE: ShippedMessages<Wording> = ShippedMessages::new();

impl Wording {
    fn for_locale(locale: &'static crate::locale::ShippedLocale) -> &'static Self {
        WORDING_BY_LOCALE.get(locale)
    }

    pub(super) fn for_active(locale: &ActiveLocale) -> &'static Self {
        Self::for_locale(locale.get())
    }

    #[cfg(test)]
    pub(super) fn from_locale(locale: &'static crate::locale::ShippedLocale) -> &'static Self {
        Self::for_locale(locale)
    }

    /// The words the install of `version` shows the user, or gives what it
    /// keeps aside.
    pub(super) fn install(&self, version: &str) -> InstallWording {
        InstallWording {
            admin_prompt: locale::fill(&self.admin_prompt, &[("version", version)]),
            set_aside: self.set_aside.clone(),
        }
    }

    /// The notice of an install that failed and kept the previous app at
    /// `kept`.
    pub(super) fn previous_app_kept(&self, kept: &Path) -> Notice {
        self.install_failed(&locale::fill(
            &self.previous_app_not_restored,
            &[("path", &kept.display().to_string())],
        ))
    }

    /// The notice of an install refused because the app was moved or
    /// replaced after launch, which kept what it found in the app's place at
    /// `kept`.
    pub(super) fn app_replaced(&self, kept: &[PathBuf]) -> Notice {
        self.install_failed(&if kept.is_empty() {
            self.app_replaced.clone()
        } else {
            locale::fill(&self.app_replaced_kept, &[("path", &paths(kept))])
        })
    }

    /// The notice of an install that put the update in place but kept what
    /// it found in the app's place at `kept`.
    pub(super) fn installed_kept_aside(&self, kept: &[PathBuf]) -> Notice {
        Notice {
            title: self.installed_title.clone(),
            body: locale::fill(&self.installed_kept, &[("path", &paths(kept))]),
        }
    }

    fn install_failed(&self, reason: &str) -> Notice {
        Notice {
            title: self.install_failed_title.clone(),
            body: locale::fill(&self.install_failed, &[("message", reason)]),
        }
    }
}

/// `kept` as one `{path}` value, as the UI joins them.
fn paths(kept: &[PathBuf]) -> String {
    kept.iter().map(|kept| kept.display().to_string()).collect::<Vec<_>>().join(", ")
}
